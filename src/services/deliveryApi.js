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

const DELIVERY_API_PATH = '/api/v1/deliveries';
// A read that has not answered by now is not going to: say so instead of leaving a screen on
// "Loading...". Generous on purpose: this is mobile data, and the payloads are small.
const READ_TIMEOUT_MS = 25000;

/**
 * The API base. Same-origin by default, but in production the frontend
 * (Netlify) and the API (Railway) are different origins, so an absolute origin
 * can be set once before the app loads:
 *     window.LOUMOO_API_ORIGIN = 'https://loumoo-production.up.railway.app';
 * Streaming and CORS then need that origin allowed on the server.
 */
function resolveApiBase() {
  var origin = (typeof window !== 'undefined' && window.LOUMOO_API_ORIGIN)
    ? String(window.LOUMOO_API_ORIGIN).replace(/\/+$/, '')
    : '';
  return origin + DELIVERY_API_PATH;
}

class DeliveryApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl || resolveApiBase();
    this.readTimeoutMs = READ_TIMEOUT_MS;
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
    // Only a READ is given a deadline. An aborted write may still have happened, and the caller
    // would then retry it blind.
    const isRead = String(options.method || 'GET').toUpperCase() === 'GET';
    let controller = null;
    let timer = null;
    let init = options;
    if (isRead && !options.signal && typeof AbortController !== 'undefined' && this.readTimeoutMs > 0) {
      controller = new AbortController();
      init = { ...options, signal: controller.signal };
      timer = setTimeout(() => controller.abort(), this.readTimeoutMs);
    }
    let response;
    let body;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...init,
        headers: this._headers(token, options.headers)
      });
      body = (await response.json().catch(() => null)) || {};
    } catch (e) {
      if (controller && controller.signal.aborted) {
        const timeout = new Error('This is taking longer than usual. Check your connection and try again.');
        timeout.code = 'TIMEOUT';
        timeout.status = 0;
        throw timeout;
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
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
   * The delivery providers a buyer can prefer at checkout for a city. Any signed-in
   * user may ask. No rider contact is returned — only the choosable facts (name,
   * photo, vehicle, rating-or-null, deliveries completed, the fee they quote).
   * @param {string} [city] the delivery city; omitted lists providers for anywhere.
   * @returns {Promise<{city: string|null, providers: Array<{id, name, photoUrl, vehicleType, isAgency, rating, completedDeliveries, openDeliveries, serviceAreas, feeXaf}>}>}
   */
  async getProviders(city) {
    return this._request(`/providers${this._qs({ city })}`);
  }

  /**
   * One provider's public marketplace profile (item B): the choosable facts plus,
   * best-effort, the caller's follow state and recent reviews. No phone. 404 for
   * an unknown or suspended provider. @returns {Promise<{provider: object}>}
   */
  async getProvider(id, city) {
    return this._request(`/providers/${encodeURIComponent(id)}${this._qs({ city })}`);
  }

  /** The riders & agencies the signed-in user follows. @returns {Promise<{providers: Array}>} */
  async followedProviders() {
    return this._request('/providers/following');
  }

  /** An agency's active rider members (item C). @returns {Promise<{agency, riders: Array}>} */
  async agencyRiders(agencyId) {
    return this._request(`/providers/${encodeURIComponent(agencyId)}/riders`);
  }

  /**
   * The 4-digit handover code — the order BUYER only, and only from `accepted`
   * to `arrived`. Seller, admin and rider get 403.
   * @returns {Promise<{code: string, digits: number, attemptsRemaining: number}>}
   */
  async getCode(id) {
    return this._request(`/${encodeURIComponent(id)}/code`);
  }

  // ------------------------------------------------------------ write helpers

  _post(endpoint, body) {
    return this._request(endpoint, { method: 'POST', body: JSON.stringify(body || {}) });
  }

  /** `/api/v1` on the same origin as the delivery API (for the few non-delivery reads). */
  _apiRoot() {
    return this.baseUrl.replace(/\/deliveries\/?$/, '');
  }

  _qs(params) {
    const pairs = Object.keys(params || {})
      .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`);
    return pairs.length ? `?${pairs.join('&')}` : '';
  }

  // ------------------------------------------------------- seller / admin (v1.2)

  /**
   * The seller's dispatch board: home-delivery orders that need or have a delivery.
   * @param {{view?: 'active'|'completed', limit?: number}} opts
   * @returns {Promise<{items: Array<{order: object, delivery: object|null}>}>}
   */
  async dispatchBoard({ view = 'active', limit } = {}) {
    return this._request(`/dispatch${this._qs({ view, limit })}`);
  }

  /** Create the delivery for an order. @returns {Promise<{delivery: object}>} */
  async create(orderId, { pickup, dropoffLocation, dropoffAddress } = {}) {
    const body = { orderId };
    if (pickup) body.pickup = pickup;
    if (dropoffLocation) body.dropoffLocation = dropoffLocation;
    if (dropoffAddress) body.dropoffAddress = dropoffAddress;
    return this._post('/', body);
  }

  /**
   * Riders who can take a delivery right now (active, online, not busy), ranked
   * (responsive, then least busy). With a deliveryId each rider also carries
   * `declined` for THAT delivery. `summary` says how many riders are registered
   * and how many of them are available, so an empty list can be explained.
   * @returns {Promise<{drivers: Array<{id, name, phone, openDeliveries, declined?}>, summary?: {registered: number, available: number}}>}
   */
  async listDrivers({ deliveryId } = {}) {
    return this._request(`/drivers${this._qs({ deliveryId })}`);
  }

  /** Offer the delivery to a chosen rider. @returns {Promise<{delivery: object}>} */
  async assign(id, driverId) {
    return this._post(`/${encodeURIComponent(id)}/assign`, { driverId });
  }

  /** Let the server pick the rider. @returns {Promise<{delivery: object}>} */
  async autoAssign(id) {
    return this._post(`/${encodeURIComponent(id)}/auto-assign`);
  }

  /** An agency delegates a delivery it holds to one of its riders (item C). */
  async delegate(id, riderId) {
    return this._post(`/${encodeURIComponent(id)}/delegate`, { riderId });
  }

  /** Cancel before pickup. @returns {Promise<{delivery: object}>} */
  async cancel(id, reason) {
    return this._post(`/${encodeURIComponent(id)}/cancel`, reason ? { reason } : {});
  }

  // ------------------------------------------------- follow a provider (item B)
  // A rider or agency is followed/reviewed as its account id through the shared
  // social graph (POST /api/v1/social/*, target_type 'user') — no parallel
  // follow system. These hit the API root beside /deliveries.

  /** Follow a provider (rider or agency) by its id. */
  async followProvider(providerId) {
    return this._socialPost('/social/follow', { targetType: 'user', targetId: providerId });
  }

  /** Stop following a provider. */
  async unfollowProvider(providerId) {
    return this._socialPost('/social/unfollow', { targetType: 'user', targetId: providerId });
  }

  /** Leave a short review (endorsement) on a provider. */
  async reviewProvider(providerId, note) {
    return this._socialPost('/social/recommendations', { targetType: 'user', targetId: providerId, note });
  }

  async _socialPost(path, body) {
    const token = await this._resolveToken();
    const res = await fetch(`${this._apiRoot()}${path}`, {
      method: 'POST',
      headers: this._headers(token),
      body: JSON.stringify(body || {})
    });
    const b = (await res.json().catch(() => null)) || {};
    if (!res.ok) {
      const err = new Error(b.error?.message || `Request failed with status ${res.status}`);
      err.code = b.error?.code || 'API_ERROR';
      err.status = res.status;
      throw err;
    }
    return b.data !== undefined ? b.data : b;
  }

  // ------------------------------------------------------------------- rider

  /**
   * The signed-in rider's profile, open jobs and availability; 403 for a non-rider.
   * @returns {Promise<{driver: object, deliveries: object[], presence?: object}>}
   */
  async riderOverview() {
    return this._request('/driver/me');
  }

  // --------------------------------------------------------- rider presence
  // Availability is the SERVER's decision. These calls name an ACTION and carry
  // at most a position; there is deliberately no way to send a status or a rider
  // id (the server rejects both). Each resolves to `{ presence }`.

  /** A position the server accepts, or null: only finite numbers are ever sent. */
  _presenceBody(loc) {
    const body = {};
    if (loc && typeof loc.lat === 'number' && isFinite(loc.lat) && typeof loc.lng === 'number' && isFinite(loc.lng)) {
      body.lat = loc.lat;
      body.lng = loc.lng;
      if (typeof loc.accuracyM === 'number' && isFinite(loc.accuracyM) && loc.accuracyM >= 0) body.accuracyM = loc.accuracyM;
    }
    return body;
  }

  /** The rider's own availability as the server sees it right now. */
  async riderPresence() {
    return this._request('/driver/presence');
  }

  /** Go online (also leaves a pause). `loc` is `{lat, lng, accuracyM?}`, optional. */
  async riderOnline(loc) {
    return this._post('/driver/presence/online', this._presenceBody(loc));
  }

  /** Go offline. 409 RIDER_BUSY while carrying an accepted delivery. */
  async riderOffline() {
    return this._post('/driver/presence/offline');
  }

  /** Take a break: stay here, receive no new offers. 409 RIDER_BUSY while on a delivery. */
  async riderPause() {
    return this._post('/driver/presence/pause');
  }

  /** End a pause. */
  async riderResume(loc) {
    return this._post('/driver/presence/resume', this._presenceBody(loc));
  }

  /**
   * "Still here." Keeps an online rider online; it can never bring an offline or
   * paused rider back. Not the delivery GPS endpoint (postLocation).
   */
  async riderHeartbeat(loc) {
    return this._post('/driver/presence/heartbeat', this._presenceBody(loc));
  }

  async accept(id) {
    return this._post(`/${encodeURIComponent(id)}/accept`);
  }

  /** Decline an offer, or release an accepted job. @returns {Promise<{delivery: {id, status}}>} */
  async decline(id) {
    return this._post(`/${encodeURIComponent(id)}/decline`);
  }

  /** 'picked_up' | 'arrived' | 'failed' (failed needs a note). */
  async setStatus(id, status, note) {
    return this._post(`/${encodeURIComponent(id)}/status`, note ? { status, note } : { status });
  }

  /**
   * One GPS point. A 200 can still be `{accepted: false, reason}` (throttled,
   * implausible_jump, busy), which is not an error.
   */
  async postLocation(id, { lat, lng, speedKmh, heading, accuracyM }) {
    const body = { lat, lng };
    if (speedKmh != null && isFinite(speedKmh)) body.speedKmh = Math.max(0, speedKmh);
    if (heading != null && isFinite(heading)) body.heading = ((heading % 360) + 360) % 360;
    if (accuracyM != null && isFinite(accuracyM)) body.accuracyM = accuracyM;
    return this._post(`/${encodeURIComponent(id)}/location`, body);
  }

  /** Verify the buyer's 4-digit code and complete the delivery. */
  async complete(id, code) {
    return this._post(`/${encodeURIComponent(id)}/complete`, { code: String(code) });
  }

  // ------------------------------------------------------------------- admin

  /** Every rider with status and workload. @param {'all'|'active'|'suspended'} status */
  async riderRoster(status = 'all') {
    return this._request(`/drivers${this._qs({ status })}`);
  }

  /** Register, edit, suspend or reactivate a rider — or an agency (isAgency + organizationId). */
  async registerDriver(profileId, { name, phone, status, isAgency, organizationId } = {}) {
    const body = { name, phone };
    if (status) body.status = status;
    if (isAgency !== undefined) body.isAgency = isAgency;
    if (organizationId !== undefined) body.organizationId = organizationId;
    return this._post(`/drivers/${encodeURIComponent(profileId)}`, body);
  }

  /**
   * Admin user directory search (SuperAdmin API), to find the account to register
   * as a rider. @returns {Promise<Array<{id, name, email, phone, role, city}>>}
   */
  async searchUsers(query, { limit = 20 } = {}) {
    const token = await this._resolveToken();
    const res = await fetch(`${this._apiRoot()}/admin/users${this._qs({ search: query, limit })}`, { headers: this._headers(token) });
    const body = (await res.json().catch(() => null)) || {};
    if (!res.ok) {
      const err = new Error(body.error?.message || `Request failed with status ${res.status}`);
      err.code = body.error?.code || 'API_ERROR';
      err.status = res.status;
      throw err;
    }
    const users = (body.data && body.data.users) || [];
    return users.map((u) => ({
      id: u.id,
      name: u.full_name || u.display_name || u.name || null,
      email: u.email || null,
      phone: u.phone_number || u.phone || null,
      role: u.primary_role || u.role || null,
      city: u.city || null
    }));
  }

  /** The signed-in account's id (for the "not a rider yet" screen), or null. */
  async whoAmI() {
    try {
      const token = await this._resolveToken();
      const res = await fetch(`${this._apiRoot()}/me/state`, { headers: this._headers(token) });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) || {};
      const d = body.data || body;
      const p = d.profile || d.user || d.account || d;
      return (p && (p.id || p.profileId || p.userId)) || null;
    } catch (e) {
      return null;
    }
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

    const startPolling = () => {
      if (stopped || pollTimer) return;
      let lastStatus = null;
      let lastAt = null;
      const tick = async () => {
        if (stopped) return;
        try {
          const { delivery } = await this.get(id);
          if (!delivery || stopped) return;
          if (delivery.status !== lastStatus) {
            lastStatus = delivery.status;
            h.onStatus({ status: delivery.status, at: delivery.updatedAt, etaMinutes: delivery.etaMinutes, distanceKm: delivery.distanceKm });
          }
          if (delivery.lastLocation && delivery.lastLocation.at !== lastAt) {
            lastAt = delivery.lastLocation.at;
            h.onLocation(delivery.lastLocation);
          }
          if (delivery.etaMinutes != null) h.onEta({ etaMinutes: delivery.etaMinutes, distanceKm: delivery.distanceKm });
          if (TERMINAL.includes(delivery.status)) { stop(); h.onEnd('complete'); }
        } catch (err) {
          if (err.status === 404 || err.status === 403) { stop(); h.onEnd('access_revoked'); }
          else h.onError(err);
        }
      };
      tick();
      pollTimer = setInterval(tick, POLL_MS);
    };

    const runStream = async () => {
      if (stopped) return;
      controller = new AbortController();
      let res;
      try {
        const token = await this._resolveToken();
        res = await fetch(`${this.baseUrl}/${encodeURIComponent(id)}/stream`, {
          headers: this._headers(token, { Accept: 'text/event-stream' }),
          signal: controller.signal
        });
      } catch (err) {
        if (!stopped) startPolling(); // couldn't open the stream → poll
        return;
      }
      if (res.status === 501) return startPolling(); // serverless: streaming unsupported
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        if (res.status === 404 || res.status === 403) { stop(); return h.onEnd('access_revoked'); }
        const err = new Error(body?.error?.message || `Stream failed (${res.status})`);
        err.code = body?.error?.code; err.status = res.status;
        h.onError(err);
        return startPolling();
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let ended = false;
      let reconnect = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const ev = this._parseSseFrame(buffer.slice(0, idx));
            buffer = buffer.slice(idx + 2);
            if (!ev) continue;
            if (ev.type === 'status') h.onStatus(ev.data);
            else if (ev.type === 'location') h.onLocation(ev.data);
            else if (ev.type === 'eta') h.onEta(ev.data);
            else if (ev.type === 'end') {
              const reason = (ev.data && ev.data.reason) || 'complete';
              if (reason === 'timeout' || reason === 'server_restart') reconnect = true;
              else { ended = true; h.onEnd(reason); }
            }
          }
          if (ended || reconnect) break;
        }
      } catch (err) {
        // aborted on stop(), or the connection dropped mid-read
      }
      if (stopped || ended) return;
      if (reconnect) return setTimeout(() => runStream(), 1500); // transient: reopen
      startPolling(); // dropped without an end event → poll
    };

    runStream();
    return { close: stop };
  }
}

const deliveryApi = new DeliveryApiClient();

if (typeof window !== 'undefined') {
  window.deliveryApi = deliveryApi;
  window.LoumooDeliveryAPI = deliveryApi;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DeliveryApiClient, deliveryApi };
}
