/**
 * LOUMOO Delivery Frontend API Client
 * ---------------------------------------------------------------------------
 * Talks to the delivery-tracking backend at /api/v1/deliveries/* (see
 * docs/DELIVERY_API.md). Mirrors the shape and auth handling of travelApi.js:
 * the bearer session token is resolved from the canonical LOUMOO client and
 * attached as `Authorization: Bearer <token>` on every request.
 *
 * The live feed (`subscribe`) uses fetch() streaming, NOT the browser's native
 * EventSource — the contract requires the Authorization header on the stream,
 * which EventSource cannot send, and query-string tokens are deliberately
 * unsupported. When the stream is unavailable (serverless 501, or a dropped
 * connection) it falls back to polling GET /:id, exactly as the contract says.
 */

const DELIVERY_API_BASE = '/api/v1/deliveries';

class DeliveryApiClient {
  constructor(baseUrl = DELIVERY_API_BASE) {
    this.baseUrl = baseUrl;
  }

  /** The same bearer the rest of the app uses (canonical client, then storage). */
  async _resolveToken() {
    if (typeof window === 'undefined') return null;
    for (const client of [window.LoumooAPI, window.loumooApi]) {
      if (client && typeof client.resolveToken === 'function') {
        try {
          const token = await client.resolveToken();
          if (token) return token;
        } catch (e) { /* fall through */ }
      }
    }
    try {
      return localStorage.getItem('loumoo_token')
        || localStorage.getItem('loumoo_auth_token')
        || sessionStorage.getItem('loumoo_token')
        || null;
    } catch (e) {
      return null;
    }
  }

  _headers(token, extra) {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(extra || {})
    };
  }

  /** One request. Returns the unwrapped `data` payload; throws a typed Error. */
  async _request(endpoint, options = {}) {
    const token = await this._resolveToken();
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: this._headers(token, options.headers)
    });
    const body = (await response.json().catch(() => null)) || {};
    if (!response.ok) {
      const err = new Error(body.error?.message || `Request failed with status ${response.status}`);
      err.code = body.error?.code || 'API_ERROR';
      err.status = response.status;
      err.details = body.error?.details || null;
      throw err;
    }
    // Backend envelope is { success, status, data }. Hand callers the payload.
    return body.data !== undefined ? body.data : body;
  }

  // -------------------------------------------------------------- read methods

  /**
   * The delivery for an order. `:orderId` may be the order id or its number.
   * Returns the open delivery, else the latest finished one. Throws 404 when
   * there is none, or when the order is not the caller's.
   * @returns {Promise<{delivery: object}>}
   */
  async getByOrder(orderId) {
    return this._request(`/by-order/${encodeURIComponent(orderId)}`);
  }

  /** A delivery by its id. @returns {Promise<{delivery: object}>} */
  async get(id) {
    return this._request(`/${encodeURIComponent(id)}`);
  }

  /**
   * The 4-digit handover code — the order BUYER only, and only from `accepted`
   * to `arrived`. Seller, admin and rider get 403.
   * @returns {Promise<{code: string, digits: number, attemptsRemaining: number}>}
   */
  async getCode(id) {
    return this._request(`/${encodeURIComponent(id)}/code`);
  }

  // ----------------------------------------------------------------- live feed

  /** Parse one SSE frame ("event:"/"data:"/":" lines) into {type,data}. */
  _parseSseFrame(frame) {
    const ev = { type: 'message', data: null };
    let sawField = false;
    for (const line of frame.split('\n')) {
      if (!line || line.startsWith(':')) continue; // keep-alive comment
      if (line.startsWith('event:')) { ev.type = line.slice(6).trim(); sawField = true; }
      else if (line.startsWith('data:')) {
        const raw = line.slice(5).trim();
        try { ev.data = JSON.parse(raw); } catch (e) { ev.data = raw; }
        sawField = true;
      }
      // "retry:" and unknown fields are ignored.
    }
    return sawField ? ev : null;
  }

  /**
   * Live updates for a delivery. Opens the SSE stream with the Authorization
   * header (fetch streaming, never native EventSource); if the stream is
   * unsupported (501 on serverless), refused before it starts, or drops without
   * a clean `end`, it falls back to polling GET /:id every ~7s. Visibility is
   * the server's: a buyer gets no location/eta until the parcel is picked up.
   *
   * @param {string} id delivery id
   * @param {object} handlers { onStatus, onLocation, onEta, onEnd, onError }
   *   - onStatus({status, at, etaMinutes?, distanceKm?})
   *   - onLocation({lat, lng, at, speedKmh?, heading?})
   *   - onEta({etaMinutes, distanceKm})
   *   - onEnd(reason)   reason: 'complete' | 'access_revoked'
   *   - onError(error)
   * @returns {{close: () => void}} call close() to stop and release the stream
   */
  subscribe(id, handlers = {}) {
    const noop = () => {};
    const h = {
      onStatus: handlers.onStatus || noop,
      onLocation: handlers.onLocation || noop,
      onEta: handlers.onEta || noop,
      onEnd: handlers.onEnd || noop,
      onError: handlers.onError || noop
    };
    const POLL_MS = 7000;
    const TERMINAL = ['delivered', 'cancelled'];

    let stopped = false;
    let controller = null;
    let pollTimer = null;

    const stop = () => {
      stopped = true;
      try { if (controller) controller.abort(); } catch (e) { /* ignore */ }
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    };

