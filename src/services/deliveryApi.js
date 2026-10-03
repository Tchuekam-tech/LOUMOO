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

