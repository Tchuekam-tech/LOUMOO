/**
 * LOUMOO — Canonical Browser Runtime API Client
 * ---------------------------------------------------------------------------
 * Single source of truth for all frontend -> backend communication.
 *
 * Written UMD-safe (no ESM syntax) so it can be consumed in three ways:
 *   1. Classic <script> tag  -> exposes window.LoumooAPI  (used by Commerce App.dc.html)
 *   2. CommonJS require()    -> used by the Node test suites
 *   3. Re-exported by src/services/apiClient.js for ESM module consumers
 *
 * It maps 1:1 onto the endpoints already implemented in:
 *   server/modules/identity/presentation/routes/authRoutes.js
 *   server/modules/identity/presentation/routes/userRoutes.js
 *   server/modules/identity/presentation/routes/identityRoutes.js
 *   server/modules/catalog/routes/catalogRoutes.js
 *
 * No business logic lives here. No mock persistence. The backend use cases are
 * authoritative; this layer only transports and normalises envelopes.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    module.exports.LoumooAPI = api;
  }
  if (root) {
    root.LoumooAPI = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TOKEN_KEY = 'loumoo_token';

  /* ---------------------------------------------------------------------- */
  /* Environment helpers (safe in browser, Node vm sandbox, and SSR)         */
  /* ---------------------------------------------------------------------- */

  function hasWindow() {
    return typeof window !== 'undefined' && !!window;
  }

  function safeStorage() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (e) { /* blocked by privacy settings */ }
    return null;
  }

  function safeSessionStorage() {
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage) return sessionStorage;
    } catch (e) { /* blocked by privacy settings */ }
    return null;
  }

  function tokenStorage() {
    return safeSessionStorage() || safeStorage();
  }

  function baseUrl(instance) {
    if (instance && instance._baseUrl) return instance._baseUrl;
    if (hasWindow() && window.LOUMOO_API_URL) return window.LOUMOO_API_URL;
    if (typeof globalThis !== 'undefined' && globalThis.LOUMOO_API_URL) return globalThis.LOUMOO_API_URL;
    if (typeof process !== 'undefined' && process.env && process.env.LOUMOO_API_URL) return process.env.LOUMOO_API_URL;
    if (hasWindow()) return '';           // same-origin: server/index.js serves the app
    return 'http://localhost:8080';
  }

  /**
   * The backend uses two success envelopes across its modules:
   *   { status: 'success', data: {...} }   (identity / users)
   *   { success: true,     data: {...} }   (catalog / system)
   * Both are unwrapped to the inner `data` here so screens never branch on it.
   */
  function unwrap(body) {
    if (!body || typeof body !== 'object') return body;
    if (Object.prototype.hasOwnProperty.call(body, 'data')) return body.data;
    return body;
  }

  /**
   * Normalises AppError responses from server/shared/middleware/errorHandler.js
   * into a plain Error carrying `status` and `code` for the UI to branch on.
   * Never surfaces stack traces or internal details to the user.
   */
  function toClientError(status, body) {
    var message = 'Something went wrong. Please try again.';
    var code = 'UNKNOWN';

    if (body && body.error) {
      if (body.error.message) message = body.error.message;
      if (body.error.code) code = body.error.code;
    } else if (body && body.message) {
      message = body.message;
    }

    if (status === 401) code = code === 'UNKNOWN' ? 'UNAUTHENTICATED' : code;
    if (status === 403) code = code === 'UNKNOWN' ? 'FORBIDDEN' : code;
    if (status === 429) {
      code = 'RATE_LIMITED';
      message = 'Too many attempts. Please wait a moment and try again.';
    }
    if (status >= 500) {
      code = 'SERVER_ERROR';
      message = 'The LOUMOO service is temporarily unavailable. Please try again.';
    }

    var err = new Error(message);
    err.status = status;
    err.code = code;
    return err;
  }

  function LoumooApiClient() {
    var store = tokenStorage();
    this.token = store ? (store.getItem(TOKEN_KEY) || store.getItem('loumoo_supabase_session_token')) : null;
    this._tokenProvider = null;
    this._baseUrl = null;
    this._inflight = {};
  }

  LoumooApiClient.prototype.setBaseUrl = function (url) {
    this._baseUrl = url || null;
    return this;
  };

  /* ---------------------------------------------------------------------- */
  /* Session token                                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * Registers the live Supabase session-token source.
   *
   * Supabase access tokens are short-lived and refreshed by the auth service;
   * the client asks for a fresh token per request instead of silently using an
   * expired cached copy.
   */
  LoumooApiClient.prototype.setTokenProvider = function (fn) {
    this._tokenProvider = typeof fn === 'function' ? fn : null;
  };

  LoumooApiClient.prototype.resolveToken = function () {
    var self = this;
    if (this._tokenProvider) {
      try {
        return Promise.resolve(this._tokenProvider()).then(function (t) {
          return t || self.token || null;
        }).catch(function () { return self.token || null; });
      } catch (e) { /* fall through to the stored token */ }
    }
    return Promise.resolve(this.token || null);
  };

  LoumooApiClient.prototype.setAuthToken = function (token) {
    this.token = token || null;
    var store = tokenStorage();
    if (!store) return;
    try {
      if (token) store.setItem(TOKEN_KEY, token);
      else store.removeItem(TOKEN_KEY);
      var legacy = safeStorage();
      if (legacy && legacy !== store) legacy.removeItem(TOKEN_KEY);
    } catch (e) { /* quota / private mode */ }
  };

  LoumooApiClient.prototype.getAuthToken = function () {
    return this.token;
  };

  /**
   * Wipes every trace of the previous principal from this browser.
   * Called on sign-out, on account deletion, and whenever the server reports
   * the session is no longer valid — so user A's private data can never remain
   * visible to user B on a shared device.
   */
  LoumooApiClient.prototype.clearSession = function () {
    this.setAuthToken(null);
    this._inflight = {};
    var store = safeStorage();
    var sessionStore = safeSessionStorage();
    if (sessionStore) {
      try { sessionStore.removeItem(TOKEN_KEY); } catch (e) { /* noop */ }
    }
    if (!store) return;
    try {
      store.removeItem('loumoo_auth_user');
      store.removeItem('loumoo_onboarding_draft');
    } catch (e) { /* noop */ }
  };

  /* ---------------------------------------------------------------------- */
  /* Core transport                                                         */
  /* ---------------------------------------------------------------------- */

  LoumooApiClient.prototype.request = function (endpoint, options) {
    var self = this;
    options = options || {};

    if (typeof fetch === 'undefined') {
      return Promise.reject(toClientError(0, {
        error: { message: 'Network unavailable', code: 'OFFLINE' }
      }));
    }

    var headers = {};
    if (!options.rawBody) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    if (options.headers) {
      for (var h in options.headers) {
        if (Object.prototype.hasOwnProperty.call(options.headers, h)) {
          headers[h] = options.headers[h];
        }
      }
    }

    return this.resolveToken().then(function (token) {
      if (token) headers.Authorization = 'Bearer ' + token;

      var init = { method: options.method || 'GET', headers: headers };
      if (options.signal) init.signal = options.signal;
      if (options.rawBody !== undefined && options.rawBody !== null) {
        init.body = options.rawBody;
      } else if (options.body !== undefined) {
        init.body = JSON.stringify(options.body);
      }

      return fetch(baseUrl(self) + endpoint, init);
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          // A rejected token means the session is gone — drop it immediately so
          // stale private data cannot be re-requested with dead credentials.
          if (res.status === 401) self.setAuthToken(null);
          throw toClientError(res.status, body);
        }
        return unwrap(body);
      });
    }, function (networkErr) {
      if (networkErr && networkErr.name === 'AbortError') throw networkErr;
      var err = new Error('Cannot reach LOUMOO. Check your connection and try again.');
      err.status = 0;
      err.code = 'OFFLINE';
      err.cause = networkErr;
      throw err;
    });
  };

  function qs(params) {
    if (!params) return '';
    var parts = [];
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      var v = params[k];
      if (v === undefined || v === null || v === '') continue;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
    return parts.length ? '?' + parts.join('&') : '';
  }

  /* ====================================================================== */
  /* AUTHENTICATION  — server/modules/identity/.../authRoutes.js            */
  /* ====================================================================== */

  /**
   * GET /api/v1/auth/config — the browser-safe Supabase bootstrap
   * key, which verification channels this deployment actually supports).
   */
  LoumooApiClient.prototype.getAuthConfig = function () {
    return this.request('/api/v1/auth/config');
  };

  /**
   * POST /api/v1/auth/session — called once after Supabase
   * authenticates the browser. Provisions the LOUMOO profile on first sign-in
   * and returns the authoritative account state.
   *
   * There is no payload: the identity is taken from the verified session token
   * alone, so nothing the page could send can influence which account it gets.
   */
  LoumooApiClient.prototype.establishSession = function () {
    return this.request('/api/v1/auth/session', { method: 'POST' });
  };

  LoumooApiClient.prototype.signOut = function () {
    var self = this;
    return this.request('/api/v1/auth/logout', { method: 'POST' })
      .catch(function () { return { success: true }; })
      .then(function (res) {
        self.clearSession();
        return res;
      });
  };

  /* ---------------------------- Account state ---------------------------- */

  /**
   * GET /api/v1/me/state — THE authoritative answer to "who is this and what
   * may they do". Every guard in the UI reads this; nothing is inferred from
   * localStorage.
   */
  LoumooApiClient.prototype.getAccountState = function () {
    return this.request('/api/v1/me/state');
  };

  LoumooApiClient.prototype.resolveCapability = function (capability) {
    return this.request('/api/v1/me/state/resolve' + qs({ capability: capability }));
  };

  /* ---------------------------- Verification ----------------------------- */

  LoumooApiClient.prototype.getVerificationStatus = function () {
    return this.request('/api/v1/auth/verification');
  };

  /** Re-reads Supabase-backed verification state. */
  LoumooApiClient.prototype.refreshVerification = function () {
    return this.request('/api/v1/auth/verification/refresh', { method: 'POST' });
  };

  LoumooApiClient.prototype.requestEmailVerification = function () {
    return this.request('/api/v1/auth/verification/email', { method: 'POST' });
  };

  LoumooApiClient.prototype.requestPhoneVerification = function (phoneNumber) {
    return this.request('/api/v1/auth/verification/phone', {
      method: 'POST',
      body: { phoneNumber: phoneNumber }
    });
  };

  /* ----------------------------- Onboarding ------------------------------ */

  LoumooApiClient.prototype.getOnboarding = function () {
    return this.request('/api/v1/me/onboarding');
  };

  LoumooApiClient.prototype.getOnboardingSteps = function () {
    return this.request('/api/v1/me/onboarding/steps');
  };

  LoumooApiClient.prototype.startOnboarding = function (intent) {
    return this.request('/api/v1/me/onboarding/start', {
      method: 'POST',
      body: { intent: intent || 'buyer' }
    });
  };

  LoumooApiClient.prototype.submitOnboardingStep = function (stepKey, payload) {
    return this.request('/api/v1/me/onboarding/steps/' + encodeURIComponent(stepKey), {
      method: 'POST',
      body: payload || {}
    });
  };

  LoumooApiClient.prototype.startSelling = function () {
    return this.request('/api/v1/me/selling/start', { method: 'POST' });
  };

  /* --------------------------- Adaptive onboarding ------------------------ */

  /** GET /api/v1/me/adaptive — conversation state + next question spec. */
  LoumooApiClient.prototype.getAdaptiveConversation = function () {
    return this.request('/api/v1/me/adaptive');
  };

  /** POST /api/v1/me/adaptive/answers — one answer: { questionKey, text?, chip?, chips?, skip? } */
  LoumooApiClient.prototype.submitAdaptiveAnswer = function (payload) {
    return this.request('/api/v1/me/adaptive/answers', {
      method: 'POST',
      body: payload || {}
    });
  };

  /** POST /api/v1/me/adaptive/complete — seal onboarding, install the mission. */
  LoumooApiClient.prototype.completeAdaptiveOnboarding = function (payload) {
    return this.request('/api/v1/me/adaptive/complete', {
      method: 'POST',
      body: payload || {}
    });
  };

  /** POST /api/v1/me/adaptive/restart — "change my goal": fresh conversation. */
  LoumooApiClient.prototype.restartAdaptiveOnboarding = function () {
    return this.request('/api/v1/me/adaptive/restart', { method: 'POST', body: {} });
  };

  /* ------------------------------- Uploads ------------------------------- */

  /**
   * POST /api/v1/uploads/listing-media — sends the raw image bytes.
   *
   * The server determines the real format from the bytes, so no filename or
   * Content-Type is sent that it could be tempted to trust. Returns an opaque
   * `uploadId` which the listing endpoints accept.
   */
  LoumooApiClient.prototype.uploadListingImage = function (fileOrBlob, listingId) {
    return this.request(
      '/api/v1/uploads/listing-media' + qs({ listingId: listingId }),
      {
        method: 'POST',
        rawBody: fileOrBlob,
        headers: { 'Content-Type': 'application/octet-stream' }
      }
    );
  };

  LoumooApiClient.prototype.discardUpload = function (uploadId) {
    return this.request('/api/v1/uploads/' + encodeURIComponent(uploadId), { method: 'DELETE' });
  };

  LoumooApiClient.prototype.getUploadLimits = function () {
    return this.request('/api/v1/uploads/limits');
  };

  /* ====================================================================== */
  /* USER & PROFILE — server/modules/identity/.../userRoutes.js             */
  /* ====================================================================== */

  /**
   * GET /api/v1/users/me — the authoritative session probe.
   * Resolves to the profile when the session is valid, or null when it is not.
   * This (not localStorage) is what the UI treats as the source of truth.
   */
  LoumooApiClient.prototype.getMe = function () {
    var self = this;
    // Skip the round trip only when there is genuinely no credential to try —
    // the live Supabase provider is consulted, not just browser state.
    return this.resolveToken().then(function (token) {
      if (!token) return null;
      return self._fetchMe();
    });
  };

  LoumooApiClient.prototype._fetchMe = function () {
    var self = this;
    return this.request('/api/v1/users/me').then(function (data) {
      return (data && data.user) || null;
    }).catch(function (err) {
      if (err.status === 401 || err.status === 403) {
        self.clearSession();
        return null;
      }
      throw err;
    });
  };

  LoumooApiClient.prototype.updateMe = function (updates) {
    return this.request('/api/v1/users/me', { method: 'PATCH', body: updates });
  };

  LoumooApiClient.prototype.getPublicUser = function (userId) {
    return this.request('/api/v1/users/' + encodeURIComponent(userId) + '/public')
      .then(function (data) { return (data && data.user) || null; });
  };

  /* --- 04.02 Account dashboard read model --- */
  LoumooApiClient.prototype.getDashboard = function () {
    return this.request('/api/v1/users/me/dashboard');
  };

  /* --- 04.04 Saved items --- */
  LoumooApiClient.prototype.getSavedItems = function (params) {
    return this.request('/api/v1/users/me/saved-items' + qs(params));
  };

  LoumooApiClient.prototype.saveItem = function (item) {
    return this.request('/api/v1/users/me/saved-items', { method: 'POST', body: item });
  };

  LoumooApiClient.prototype.removeSavedItem = function (productId) {
    return this.request('/api/v1/users/me/saved-items/' + encodeURIComponent(productId), {
      method: 'DELETE'
    });
  };

  /* --- 04.05 Followed stores --- */
  LoumooApiClient.prototype.getFollowedStores = function (params) {
    return this.request('/api/v1/users/me/followed-stores' + qs(params));
  };

  LoumooApiClient.prototype.followStore = function (store) {
    return this.request('/api/v1/users/me/followed-stores', { method: 'POST', body: store });
  };

  LoumooApiClient.prototype.unfollowStore = function (storeId) {
    return this.request('/api/v1/users/me/followed-stores/' + encodeURIComponent(storeId), {
      method: 'DELETE'
    });
  };

  /* --- 04.06 Purchase history --- */
  LoumooApiClient.prototype.getPurchases = function (params) {
    return this.request('/api/v1/users/me/purchases' + qs(params));
  };

  LoumooApiClient.prototype.getOrder = function (orderId) {
    return this.request('/api/v1/users/me/purchases/' + encodeURIComponent(orderId))
      .then(function (data) { return (data && data.order) || null; });
  };

  // Place a new order from the bag (payment deferred — pay on delivery).
  LoumooApiClient.prototype.createOrder = function (payload) {
    return this.request('/api/v1/users/me/orders', { method: 'POST', body: payload })
      .then(function (data) { return (data && data.order) || null; });
  };

  /* --- Reviews --- */
  LoumooApiClient.prototype.createReview = function (payload) {
    return this.request('/api/v1/reviews', { method: 'POST', body: payload })
      .then(function (data) { return (data && data.review) || null; });
  };

  LoumooApiClient.prototype.getReviews = function (targetType, targetId, params) {
    return this.request('/api/v1/reviews/' + encodeURIComponent(targetType) + '/' + encodeURIComponent(targetId) + qs(params));
  };

  /* --- Travel --- */
  LoumooApiClient.prototype.searchTravel = function (params) {
    return this.request('/api/v1/travel/search' + qs(params));
  };

  LoumooApiClient.prototype.getTravelDestinations = function () {
    return this.request('/api/v1/travel/destinations');
  };

  LoumooApiClient.prototype.getTravelHotels = function (params) {
    return this.request('/api/v1/travel/hotels' + qs(params));
  };

  LoumooApiClient.prototype.getTravelHotel = function (hotelId) {
    return this.request('/api/v1/travel/hotels/' + encodeURIComponent(hotelId));
  };

  LoumooApiClient.prototype.getTravelHotelRooms = function (hotelId, params) {
    return this.request('/api/v1/travel/hotels/' + encodeURIComponent(hotelId) + '/rooms' + qs(params));
  };

  LoumooApiClient.prototype.getTravelExcursions = function (params) {
    return this.request('/api/v1/travel/excursions' + qs(params));
  };

  LoumooApiClient.prototype.getTravelExcursion = function (excursionId) {
    return this.request('/api/v1/travel/excursions/' + encodeURIComponent(excursionId));
  };

  LoumooApiClient.prototype.getTravelFlights = function (params) {
    return this.request('/api/v1/travel/flights' + qs(params));
  };

  LoumooApiClient.prototype.getBusSchedules = function (params) {
    return this.request('/api/v1/travel/bus/schedules' + qs(params));
  };

  LoumooApiClient.prototype.getTravelBuses = function (params) {
    return this.request('/api/v1/travel/buses' + qs(params));
  };

  LoumooApiClient.prototype.getTravelTrains = function (params) {
    return this.request('/api/v1/travel/trains' + qs(params));
  };

  LoumooApiClient.prototype.getTravelRides = function (params) {
    return this.request('/api/v1/travel/rides' + qs(params));
  };

  LoumooApiClient.prototype.getTravelBusOperators = function () {
    return this.request('/api/v1/travel/bus/operators');
  };

  LoumooApiClient.prototype.getTravelBusSeats = function (scheduleId) {
    return this.request('/api/v1/travel/bus/seats/' + encodeURIComponent(scheduleId));
  };

  LoumooApiClient.prototype.getTravelTrainSchedules = function (params) {
    return this.request('/api/v1/travel/train/schedules' + qs(params));
  };

  LoumooApiClient.prototype.getTravelTaxiQuote = function (params) {
    return this.request('/api/v1/travel/taxi/quote' + qs(params));
  };

  LoumooApiClient.prototype.getTravelPackages = function (params) {
    return this.request('/api/v1/travel/packages' + qs(params));
  };

  LoumooApiClient.prototype.getTravelPackage = function (packageId) {
    return this.request('/api/v1/travel/packages/' + encodeURIComponent(packageId));
  };

  LoumooApiClient.prototype.getVisaDestinations = function () {
    return this.request('/api/v1/travel/visa/destinations');
  };

  LoumooApiClient.prototype.submitVisaApplication = function (payload) {
    return this.request('/api/v1/travel/visa/applications', { method: 'POST', body: payload });
  };

  LoumooApiClient.prototype.createTravelBooking = function (payload) {
    var key = payload && (payload.idempotencyKey || payload.clientRequestId);
    var options = { method: 'POST', body: payload };
    if (key) options.headers = { 'X-Idempotency-Key': key };
    return this.request('/api/v1/travel/bookings', options)
      .then(function (data) { return data || null; });
  };

  LoumooApiClient.prototype.getTravelBookings = function (params) {
    return this.request('/api/v1/travel/bookings' + qs(params));
  };

  LoumooApiClient.prototype.getTravelBooking = function (bookingId) {
    return this.request('/api/v1/travel/bookings/' + encodeURIComponent(bookingId));
  };

  LoumooApiClient.prototype.cancelTravelBooking = function (bookingId, reason) {
    return this.request('/api/v1/travel/bookings/' + encodeURIComponent(bookingId) + '/cancel', {
      method: 'POST',
      body: { reason: reason || 'Customer request' }
    });
  };

  LoumooApiClient.prototype.getMyTrips = function (params) {
    return this.request('/api/v1/travel/bookings/my-trips' + qs(params));
  };

  LoumooApiClient.prototype.getTravelTrips = function (params) {
    return this.request('/api/v1/travel/trips' + qs(params));
  };

  LoumooApiClient.prototype.getTravelTrip = function (tripId) {
    return this.request('/api/v1/travel/trips/' + encodeURIComponent(tripId));
  };

  LoumooApiClient.prototype.getTravelTickets = function () {
    return this.request('/api/v1/travel/tickets');
  };

  LoumooApiClient.prototype.getTravelTicket = function (ticketId) {
    return this.request('/api/v1/travel/tickets/' + encodeURIComponent(ticketId));
  };

  /* --- Notifications feed --- */
  LoumooApiClient.prototype.getNotifications = function (params) {
    return this.request('/api/v1/users/me/notifications' + qs(params))
      .then(function (data) { return (data && data.notifications) || []; });
  };

  LoumooApiClient.prototype.markNotificationRead = function (id) {
    return this.request('/api/v1/users/me/notifications/' + encodeURIComponent(id) + '/read', { method: 'POST' });
  };

  LoumooApiClient.prototype.markAllNotificationsRead = function () {
    return this.request('/api/v1/users/me/notifications/read-all', { method: 'POST' });
  };

  /* --- 04.07 Activity history --- */
  LoumooApiClient.prototype.getActivities = function (params) {
    return this.request('/api/v1/users/me/activities' + qs(params));
  };

  /* --- 04.08 Addresses --- */
  LoumooApiClient.prototype.getAddresses = function () {
    return this.request('/api/v1/users/me/addresses')
      .then(function (data) { return (data && data.addresses) || []; });
  };

  LoumooApiClient.prototype.addAddress = function (address) {
    return this.request('/api/v1/users/me/addresses', { method: 'POST', body: address })
      .then(function (data) { return (data && data.address) || null; });
  };

  LoumooApiClient.prototype.updateAddress = function (id, updates) {
    return this.request('/api/v1/users/me/addresses/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: updates
    }).then(function (data) { return (data && data.address) || null; });
  };

  LoumooApiClient.prototype.deleteAddress = function (id) {
    return this.request('/api/v1/users/me/addresses/' + encodeURIComponent(id), {
      method: 'DELETE'
    });
  };

  LoumooApiClient.prototype.setDefaultAddress = function (id) {
    return this.request('/api/v1/users/me/addresses/' + encodeURIComponent(id) + '/default', {
      method: 'POST'
    }).then(function (data) { return (data && data.address) || null; });
  };

  /* --- 04.09 Notification preferences --- */
  LoumooApiClient.prototype.getNotificationPreferences = function () {
    return this.request('/api/v1/users/me/notifications/preferences')
      .then(function (data) { return (data && data.preferences) || null; });
  };

  LoumooApiClient.prototype.updateNotificationPreferences = function (updates) {
    return this.request('/api/v1/users/me/notifications/preferences', {
      method: 'PATCH',
      body: updates
    }).then(function (data) { return (data && data.preferences) || null; });
  };

  /* --- 02.14 Privacy & consent --- */
  LoumooApiClient.prototype.getPrivacy = function () {
    return this.request('/api/v1/users/me/privacy')
      .then(function (data) { return (data && data.preferences) || null; });
  };

  LoumooApiClient.prototype.updatePrivacy = function (updates) {
    return this.request('/api/v1/users/me/privacy', { method: 'PATCH', body: updates });
  };

  /* --- 02.08 / 02.12 Sessions & security --- */
  LoumooApiClient.prototype.getSessions = function () {
    return this.request('/api/v1/users/me/sessions')
      .then(function (data) { return (data && data.sessions) || []; });
  };

  LoumooApiClient.prototype.revokeSession = function (sessionId) {
    return this.request('/api/v1/users/me/sessions/' + encodeURIComponent(sessionId), {
      method: 'DELETE'
    });
  };

  /* --- 02.13 Account deletion --- */
  LoumooApiClient.prototype.deleteAccount = function (confirmText, reason) {
    var self = this;
    return this.request('/api/v1/users/me', {
      method: 'DELETE',
      body: { confirmText: confirmText, reason: reason }
    }).then(function (result) {
      self.clearSession();
      return result;
    });
  };

  /* ====================================================================== */
  /* STORE & BUSINESS — server/modules/store/presentation/routes/storeRoutes.js */
  /* ====================================================================== */

  /* --- 05.01 Create a store --- */
  LoumooApiClient.prototype.createStore = function (payload) {
    return this.request('/api/v1/stores', { method: 'POST', body: payload });
  };

  LoumooApiClient.prototype.getMyStore = function () {
    return this.request('/api/v1/stores/me');
  };

  LoumooApiClient.prototype.getStoreDiscovery = function (params) {
    return this.request('/api/v1/stores/discovery' + qs(params));
  };

  /* --- 05.03 Store management --- */
  LoumooApiClient.prototype.getStore = function (storeId) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId));
  };

  LoumooApiClient.prototype.updateStore = function (storeId, updates) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId), { method: 'PATCH', body: updates });
  };

  /* --- 05.04 Store profile --- */
  LoumooApiClient.prototype.getStoreProfile = function (storeId) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/profile');
  };

  LoumooApiClient.prototype.updateStoreProfile = function (storeId, updates) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/profile', { method: 'PATCH', body: updates });
  };

  /* --- 05.02 Store onboarding --- */
  LoumooApiClient.prototype.getStoreOnboarding = function (storeId) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/onboarding');
  };

  LoumooApiClient.prototype.updateStoreOnboarding = function (storeId, step, payload) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/onboarding', {
      method: 'PATCH',
      body: { step: step, payload: payload }
    });
  };

  /* --- 05.05 Store verification --- */
  LoumooApiClient.prototype.getStoreVerification = function (storeId) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/verification');
  };

  LoumooApiClient.prototype.submitStoreVerification = function (storeId, payload) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/verification', { method: 'POST', body: payload });
  };

  /* --- 05.09 Store analytics --- */
  LoumooApiClient.prototype.getStoreAnalytics = function (storeId, period) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/analytics' + qs({ period: period || '30d' }));
  };

  /* --- 05.10 Store settings --- */
  LoumooApiClient.prototype.getStoreSettings = function (storeId) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/settings');
  };

  LoumooApiClient.prototype.updateStoreSettings = function (storeId, updates) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/settings', { method: 'PATCH', body: updates });
  };

  /* --- 05.11 Business opening hours --- */
  LoumooApiClient.prototype.getStoreHours = function (storeId) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/hours');
  };

  LoumooApiClient.prototype.updateStoreHours = function (storeId, updates) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/hours', { method: 'PATCH', body: updates });
  };

  /* --- 05.12 Business location --- */
  LoumooApiClient.prototype.getStoreLocation = function (storeId) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/location');
  };

  LoumooApiClient.prototype.updateStoreLocation = function (storeId, updates) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/location', { method: 'PATCH', body: updates });
  };

  /* --- 05.07 Store discovery & 05.06 Categories --- */
  LoumooApiClient.prototype.discoverStores = function (params) {
    return this.request('/api/v1/stores/discovery' + qs(params));
  };

  LoumooApiClient.prototype.getStoreCategories = function () {
    return this.request('/api/v1/stores/categories');
  };

  /* --- 05.08 Follow / unfollow store --- */
  LoumooApiClient.prototype.followStoreById = function (storeId) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/follow', { method: 'POST' });
  };

  LoumooApiClient.prototype.unfollowStoreById = function (storeId) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/follow', { method: 'DELETE' });
  };

  LoumooApiClient.prototype.getStoreFollowStatus = function (storeId) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/follow-status');
  };

  /* ====================================================================== */
  /* UNIVERSAL LISTINGS & COMMERCE — server/modules/listing/presentation/routes/listingRoutes.js */
  /* ====================================================================== */

  LoumooApiClient.prototype.getTaxonomy = function () {
    return this.request('/api/v1/listings/taxonomy');
  };

  LoumooApiClient.prototype.getCategorySchema = function (categoryId) {
    return this.request('/api/v1/listings/taxonomy/' + encodeURIComponent(categoryId) + '/schema');
  };

  LoumooApiClient.prototype.createListing = function (payload) {
    return this.request('/api/v1/listings', { method: 'POST', body: payload });
  };

  LoumooApiClient.prototype.getSellerListings = function (params) {
    return this.request('/api/v1/listings/seller' + qs(params));
  };

  LoumooApiClient.prototype.getListing = function (id) {
    return this.request('/api/v1/listings/' + encodeURIComponent(id));
  };

  LoumooApiClient.prototype.updateListing = function (id, updates) {
    return this.request('/api/v1/listings/' + encodeURIComponent(id), { method: 'PATCH', body: updates });
  };

  LoumooApiClient.prototype.getListingPreview = function (id) {
    return this.request('/api/v1/listings/' + encodeURIComponent(id) + '/preview');
  };

  LoumooApiClient.prototype.publishListing = function (id) {
    return this.request('/api/v1/listings/' + encodeURIComponent(id) + '/publish', { method: 'POST' });
  };

  LoumooApiClient.prototype.pauseListing = function (id) {
    return this.request('/api/v1/listings/' + encodeURIComponent(id) + '/pause', { method: 'POST' });
  };

  LoumooApiClient.prototype.archiveListing = function (id) {
    return this.request('/api/v1/listings/' + encodeURIComponent(id) + '/archive', { method: 'POST' });
  };

  /**
   * Attaches images that were already uploaded and validated.
   * Takes upload ids, never URLs: a client-supplied URL would let anyone point
   * a listing at arbitrary remote content.
   */
  LoumooApiClient.prototype.addListingMedia = function (id, uploadIds) {
    var ids = Array.isArray(uploadIds) ? uploadIds : [uploadIds];
    return this.request('/api/v1/listings/' + encodeURIComponent(id) + '/media', {
      method: 'POST',
      body: { uploadIds: ids }
    });
  };

  LoumooApiClient.prototype.getListingMedia = function (id) {
    return this.request('/api/v1/listings/' + encodeURIComponent(id) + '/media');
  };

  LoumooApiClient.prototype.reorderListingMedia = function (id, mediaIds) {
    return this.request('/api/v1/listings/' + encodeURIComponent(id) + '/media/order', {
      method: 'PATCH',
      body: { mediaIds: mediaIds }
    });
  };

  LoumooApiClient.prototype.setListingCover = function (id, mediaId) {
    return this.request('/api/v1/listings/' + encodeURIComponent(id) + '/media/' + encodeURIComponent(mediaId) + '/cover', {
      method: 'POST'
    });
  };

  /** The canonical listing form rules, so the wizard validates what the server validates. */
  LoumooApiClient.prototype.getListingSchema = function () {
    return this.request('/api/v1/listings/schema');
  };

  LoumooApiClient.prototype.removeListingMedia = function (id, mediaId) {
    return this.request('/api/v1/listings/' + encodeURIComponent(id) + '/media/' + encodeURIComponent(mediaId), { method: 'DELETE' });
  };

  LoumooApiClient.prototype.generateListingVariants = function (id, optionsMap, basePriceMinor) {
    return this.request('/api/v1/listings/' + encodeURIComponent(id) + '/variants', {
      method: 'POST',
      body: { optionsMap: optionsMap, basePriceMinor: basePriceMinor }
    });
  };

  LoumooApiClient.prototype.updateListingVariant = function (id, variantId, updates) {
    return this.request('/api/v1/listings/' + encodeURIComponent(id) + '/variants/' + encodeURIComponent(variantId), {
      method: 'PATCH',
      body: updates
    });
  };

  LoumooApiClient.prototype.updateListingInventory = function (id, onHand, variantId) {
    return this.request('/api/v1/listings/' + encodeURIComponent(id) + '/inventory', {
      method: 'PATCH',
      body: { onHand: onHand, variantId: variantId }
    });
  };

  LoumooApiClient.prototype.getListingAiSuggestions = function (payload) {
    return this.request('/api/v1/listings/ai/suggest', { method: 'POST', body: payload });
  };

  /* ====================================================================== */
  /* CATALOG — server/modules/catalog/routes/catalogRoutes.js               */
  /* ====================================================================== */

  LoumooApiClient.prototype.getProducts = function (params) {
    return this.request('/api/v1/products' + qs(params));
  };

  LoumooApiClient.prototype.getProduct = function (id) {
    return this.request('/api/v1/products/' + encodeURIComponent(id));
  };

  LoumooApiClient.prototype.getCategories = function () {
    return this.request('/api/v1/categories');
  };

  // GET /api/v1/products?q=... — request() unwraps the envelope, so a successful
  // call resolves to the canonical { items, total, page, limit } payload. The
  // rejection is re-thrown so callers can distinguish a real failure (show the
  // error state) from a genuine zero-result response ({ items: [] }).
  LoumooApiClient.prototype.search = function (params, signal) { return this.request('/api/v1/search' + qs(params), { signal: signal }); };
  LoumooApiClient.prototype.suggestSearch = function (params, signal) { return this.request('/api/v1/search/suggest' + qs(params), { signal: signal }); };
  LoumooApiClient.prototype.searchCapabilities = function () { return this.request('/api/v1/search/capabilities'); };
  LoumooApiClient.prototype.searchAssistant = function (body, signal) { return this.request('/api/v1/search/assistant', { method:'POST', body:body, signal:signal }); };
  LoumooApiClient.prototype.searchVisual = function (body, signal) { return this.request('/api/v1/search/visual', { method:'POST', body:body, signal:signal }); };
  LoumooApiClient.prototype.startCombiSession = function (signal) { return this.request('/api/v1/search/voice/session', { method:'POST', body:{}, signal:signal }); };
  LoumooApiClient.prototype.searchProducts = function (query, params, signal) {
    var p = Object.assign({ q: query }, params || {});
    return this.request('/api/v1/products' + qs(p), { signal:signal });
  };


  /* ====================================================================== */
  /* ANNOUNCEMENTS & COMMERCIAL DISTRIBUTION                                 */
  /* server/modules/announcement/presentation/routes/announcementRoutes.js   */
  /* ====================================================================== */

  /** The broadcast type catalogue — the studio renders its fields from it. */
  LoumooApiClient.prototype.getAnnouncementSchema = function () {
    return this.request('/api/v1/announcements/schema');
  };

  LoumooApiClient.prototype.getListingVariants = function (id) {
    return this.request('/api/v1/listings/' + encodeURIComponent(id) + '/variants');
  };

  LoumooApiClient.prototype.getAnnouncementFeed = function (params) {
    return this.request('/api/v1/announcements' + qs(params));
  };

  LoumooApiClient.prototype.getAnnouncement = function (idOrSlug) {
    return this.request('/api/v1/announcements/' + encodeURIComponent(idOrSlug));
  };

  LoumooApiClient.prototype.getSellerAnnouncements = function (storeId, params) {
    return this.request('/api/v1/announcements/seller/' + encodeURIComponent(storeId) + qs(params));
  };

  LoumooApiClient.prototype.getStoreCampaignsOverview = function (storeId) {
    return this.request('/api/v1/announcements/seller/' + encodeURIComponent(storeId) + '/campaigns-overview');
  };

  LoumooApiClient.prototype.createAnnouncement = function (payload) {
    return this.request('/api/v1/announcements', {
      method: 'POST',
      body: payload
    });
  };

  LoumooApiClient.prototype.updateAnnouncement = function (id, payload) {
    return this.request('/api/v1/announcements/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: payload
    });
  };

  LoumooApiClient.prototype.publishAnnouncement = function (id) {
    return this.request('/api/v1/announcements/' + encodeURIComponent(id) + '/publish', {
      method: 'POST'
    });
  };

  LoumooApiClient.prototype.scheduleAnnouncement = function (id, scheduledFor, expiresAt) {
    return this.request('/api/v1/announcements/' + encodeURIComponent(id) + '/schedule', {
      method: 'POST',
      body: { scheduledFor: scheduledFor, expiresAt: expiresAt }
    });
  };

  LoumooApiClient.prototype.cancelAnnouncementSchedule = function (id) {
    return this.request('/api/v1/announcements/' + encodeURIComponent(id) + '/cancel-schedule', {
      method: 'POST'
    });
  };

  LoumooApiClient.prototype.archiveAnnouncement = function (id) {
    return this.request('/api/v1/announcements/' + encodeURIComponent(id) + '/archive', {
      method: 'POST'
    });
  };

  LoumooApiClient.prototype.deleteAnnouncement = function (id) {
    return this.request('/api/v1/announcements/' + encodeURIComponent(id), {
      method: 'DELETE'
    });
  };

  LoumooApiClient.prototype.recordAnnouncementEvent = function (id, eventType, metadata) {
    return this.request('/api/v1/announcements/' + encodeURIComponent(id) + '/events', {
      method: 'POST',
      body: { eventType: eventType, metadata: metadata }
    });
  };

  LoumooApiClient.prototype.getAnnouncementAnalytics = function (id) {
    return this.request('/api/v1/announcements/' + encodeURIComponent(id) + '/analytics');
  };


  /* ══════════════════════════════════════════════════════════════════════════
     10. PRODUCT COMPARISON & HEAD-TO-HEAD DECISION ENGINE SDK
     ══════════════════════════════════════════════════════════════════════════ */

  LoumooApiClient.prototype.compareProducts = function (productIds, userPriorities) {
    var idsStr = Array.isArray(productIds) ? productIds.join(',') : productIds;
    var query = { ids: idsStr };
    if (userPriorities) {
      query.priorities = typeof userPriorities === 'object' ? JSON.stringify(userPriorities) : userPriorities;
    }
    return this.request('/api/v1/catalog/compare' + qs(query));
  };

  /* ══════════════════════════════════════════════════════════════════════════
     11. BINARY MEDIA & VERIFICATION DOCUMENT UPLOADS
     ══════════════════════════════════════════════════════════════════════════ */

  LoumooApiClient.prototype.uploadListingMedia = function (fileOrBuffer, listingId) {
    var url = '/api/v1/uploads/listing-media' + (listingId ? '?listingId=' + encodeURIComponent(listingId) : '');
    return this.request(url, {
      method: 'POST',
      rawBody: fileOrBuffer,
      headers: { 'Content-Type': (fileOrBuffer && fileOrBuffer.type) || 'application/octet-stream' }
    });
  };

  LoumooApiClient.prototype.uploadVerificationDocument = function (fileOrBuffer, docType) {
    var type = docType || 'cni_front';
    return this.request('/api/v1/uploads/verification-document?docType=' + encodeURIComponent(type), {
      method: 'POST',
      rawBody: fileOrBuffer,
      headers: { 'Content-Type': (fileOrBuffer && fileOrBuffer.type) || 'application/octet-stream' }
    });
  };

  /* ══════════════════════════════════════════════════════════════════════════
     12. STORE & MERCHANT SDK
     ══════════════════════════════════════════════════════════════════════════ */

  LoumooApiClient.prototype.getMyStore = function () {
    return this.request('/api/v1/stores/me');
  };

  LoumooApiClient.prototype.getStore = function (storeId) {
    if (!storeId || storeId === 'me' || storeId === 'mine') {
      return this.request('/api/v1/stores/me');
    }
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId));
  };

  LoumooApiClient.prototype.createStore = function (payload) {
    return this.request('/api/v1/stores', {
      method: 'POST',
      body: payload
    });
  };

  LoumooApiClient.prototype.getStoreAnalytics = function (storeIdOrPeriod, optionalPeriod) {
    var hasStoreId = Boolean(optionalPeriod);
    var storeId = hasStoreId ? storeIdOrPeriod : null;
    var period = optionalPeriod || storeIdOrPeriod || '30d';
    if (storeId) {
      return this.request('/api/v1/stores/' + encodeURIComponent(storeId) + '/analytics' + qs({ period: period }));
    }
    return this.request('/api/v1/stores/analytics' + qs({ period: period }));
  };

  LoumooApiClient.prototype.updateStore = function (storeId, payload) {
    return this.request('/api/v1/stores/' + encodeURIComponent(storeId), {
      method: 'PATCH',
      body: payload
    });
  };

  /* ══════════════════════════════════════════════════════════════════════════
     13. TRAVEL, MOBILITY & HOSPITALITY SDK
     ══════════════════════════════════════════════════════════════════════════ */

  LoumooApiClient.prototype.searchTravel = function (params) {
    return this.request('/api/travel/search' + qs(params || {}));
  };

  LoumooApiClient.prototype.getTravelDestinations = function () {
    return this.request('/api/travel/destinations');
  };

  LoumooApiClient.prototype.getTravelHotels = function (params) {
    return this.request('/api/travel/hotels' + qs(params || {}));
  };

  LoumooApiClient.prototype.getTravelHotel = function (id) {
    return this.request('/api/travel/hotels/' + encodeURIComponent(id));
  };

  LoumooApiClient.prototype.getTravelHotelRooms = function (id, params) {
    return this.request('/api/travel/hotels/' + encodeURIComponent(id) + '/rooms' + qs(params || {}));
  };

  LoumooApiClient.prototype.getTravelExcursions = function (params) {
    return this.request('/api/travel/excursions' + qs(params || {}));
  };

  LoumooApiClient.prototype.getTravelExcursion = function (id) {
    return this.request('/api/travel/excursions/' + encodeURIComponent(id));
  };

  LoumooApiClient.prototype.getTravelBuses = function (params) {
    return this.request('/api/travel/bus/schedules' + qs(params || {}));
  };

  LoumooApiClient.prototype.getBusSchedules = function (params) {
    return this.request('/api/travel/bus/schedules' + qs(params || {}));
  };

  LoumooApiClient.prototype.getTravelBusOperators = function () {
    return this.request('/api/travel/bus/operators');
  };

  LoumooApiClient.prototype.getTravelBusSeats = function (scheduleId) {
    return this.request('/api/travel/bus/seats/' + encodeURIComponent(scheduleId));
  };

  LoumooApiClient.prototype.getTravelTrains = function (params) {
    return this.request('/api/travel/train/schedules' + qs(params || {}));
  };

  LoumooApiClient.prototype.getTravelFlights = function (params) {
    return this.request('/api/travel/flights' + qs(params || {}));
  };

  LoumooApiClient.prototype.getTravelRideQuote = function (params) {
    return this.request('/api/travel/taxi/quote' + qs(params || {}));
  };

  LoumooApiClient.prototype.getTravelPackages = function () {
    return this.request('/api/travel/packages');
  };

  LoumooApiClient.prototype.getTravelPackage = function (id) {
    return this.request('/api/travel/packages/' + encodeURIComponent(id));
  };

  LoumooApiClient.prototype.getVisaDestinations = function () {
    return this.request('/api/travel/visa/destinations');
  };

  LoumooApiClient.prototype.submitVisaApplication = function (payload) {
    return this.request('/api/travel/visa/applications', {
      method: 'POST',
      body: payload
    });
  };

  LoumooApiClient.prototype.createTravelBooking = function (payload, idempotencyKey) {
    var headers = {};
    var key = idempotencyKey || ('idem_trv_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8));
    headers['X-Idempotency-Key'] = key;
    return this.request('/api/travel/bookings', {
      method: 'POST',
      headers: headers,
      body: payload
    });
  };

  LoumooApiClient.prototype.payTravelBooking = function (bookingId, paymentPayload) {
    return this.request('/api/travel/bookings/' + encodeURIComponent(bookingId) + '/pay', {
      method: 'POST',
      body: paymentPayload || {}
    });
  };

  LoumooApiClient.prototype.getTravelBooking = function (id) {
    return this.request('/api/travel/bookings/' + encodeURIComponent(id));
  };

  LoumooApiClient.prototype.getTravelBookingByReference = function (ref) {
    return this.request('/api/travel/bookings/reference/' + encodeURIComponent(ref));
  };

  LoumooApiClient.prototype.cancelTravelBooking = function (id, reason) {
    return this.request('/api/travel/bookings/' + encodeURIComponent(id) + '/cancel', {
      method: 'POST',
      body: { reason: reason || 'Customer request' }
    });
  };

  LoumooApiClient.prototype.getMyTrips = function (params) {
    var query = typeof params === 'string' ? { status: params } : (params || {});
    return this.request('/api/travel/trips' + qs(query));
  };

  LoumooApiClient.prototype.getTravelTickets = function () {
    return this.request('/api/travel/tickets');
  };

  LoumooApiClient.prototype.getTravelTicket = function (id) {
    return this.request('/api/travel/tickets/' + encodeURIComponent(id));
  };

  /* ══════════════════════════════════════════════════════════════════════════
     13. ORDER CORE & COMMERCE LIFECYCLE
     ══════════════════════════════════════════════════════════════════════════ */

  LoumooApiClient.prototype.createOrder = function (payload) {
    return this.request('/api/v1/orders', {
      method: 'POST',
      body: payload
    });
  };

  LoumooApiClient.prototype.getOrders = function (params) {
    return this.request('/api/v1/orders' + qs(params));
  };

  LoumooApiClient.prototype.getOrder = function (id) {
    return this.request('/api/v1/orders/' + encodeURIComponent(id));
  };

  LoumooApiClient.prototype.cancelOrder = function (id, reason) {
    return this.request('/api/v1/orders/' + encodeURIComponent(id) + '/cancel', {
      method: 'POST',
      body: { reason: reason }
    });
  };

  LoumooApiClient.prototype.getHealth = function () {
    return this.request('/api/v1/health').catch(function (e) {
      return { status: 'offline', error: e.message };
    });
  };

  /* ══════════════════════════════════════════════════════════════════════════
     14. SUPERADMIN & PLATFORM CONTROL (PHASE 3)
     ══════════════════════════════════════════════════════════════════════════ */

  /**
   * GET /api/v1/admin/overview
   * Real-time operational dashboard metrics (GMV, active stores, orders, KYC queue).
   */
  LoumooApiClient.prototype.getAdminOverview = function () {
    return this.request('/api/v1/admin/overview');
  };

  /**
   * GET /api/v1/admin/stores
   * Filterable store directory for administration and compliance.
   */
  LoumooApiClient.prototype.getAdminStores = function (filter) {
    return this.request('/api/v1/admin/stores' + qs(filter));
  };

  /**
   * GET /api/v1/admin/stores/:id
   */
  LoumooApiClient.prototype.getAdminStore = function (id) {
    return this.request('/api/v1/admin/stores/' + encodeURIComponent(id));
  };

  /**
   * PATCH /api/v1/admin/stores/:id
   * Updates store metadata, verified status, contact details, or tier.
   */
  LoumooApiClient.prototype.updateAdminStore = function (id, updates) {
    return this.request('/api/v1/admin/stores/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: updates || {}
    });
  };

  /**
   * POST /api/v1/admin/stores/:id/verify-kyc
   */
  LoumooApiClient.prototype.verifyAdminStoreKyc = function (id, tier, reason) {
    return this.request('/api/v1/admin/stores/' + encodeURIComponent(id) + '/verify-kyc', {
      method: 'POST',
      body: { tier: tier || 'pro_merchant', reason: reason || 'Store KYC verified' }
    });
  };

  /**
   * POST /api/v1/admin/stores/:id/reject-kyc
   */
  LoumooApiClient.prototype.rejectAdminStoreKyc = function (id, reason) {
    return this.request('/api/v1/admin/stores/' + encodeURIComponent(id) + '/reject-kyc', {
      method: 'POST',
      body: { reason: reason || 'KYC documentation insufficient' }
    });
  };

  /**
   * POST /api/v1/admin/stores/:id/suspend
   */
  LoumooApiClient.prototype.suspendAdminStore = function (id, reason) {
    return this.request('/api/v1/admin/stores/' + encodeURIComponent(id) + '/suspend', {
      method: 'POST',
      body: { reason: reason || 'Violation of marketplace terms' }
    });
  };

  /**
   * POST /api/v1/admin/stores/:id/reactivate
   */
  LoumooApiClient.prototype.reactivateAdminStore = function (id, reason) {
    return this.request('/api/v1/admin/stores/' + encodeURIComponent(id) + '/reactivate', {
      method: 'POST',
      body: { reason: reason || 'Store reactivated by administrator' }
    });
  };

  /**
   * GET /api/v1/admin/listings
   * Filterable listings catalog for content and price moderation.
   */
  LoumooApiClient.prototype.getAdminListings = function (filter) {
    return this.request('/api/v1/admin/listings' + qs(filter));
  };

  /**
   * GET /api/v1/admin/listings/:id
   */
  LoumooApiClient.prototype.getAdminListing = function (id) {
    return this.request('/api/v1/admin/listings/' + encodeURIComponent(id));
  };

  /**
   * POST /api/v1/admin/listings/:id/moderate
   * Moderates a listing (e.g. APPROVED, REJECTED, SUSPENDED, or custom updates).
   */
  LoumooApiClient.prototype.moderateListing = function (id, action) {
    var body = typeof action === 'string' ? { action: action } : (action || {});
    return this.request('/api/v1/admin/listings/' + encodeURIComponent(id) + '/moderate', {
      method: 'POST',
      body: body
    });
  };

  /**
   * GET /api/v1/admin/users
   * User directory query with role and KYC filters.
   */
  LoumooApiClient.prototype.getAdminUsers = function (filter) {
    return this.request('/api/v1/admin/users' + qs(filter));
  };

  /**
   * GET /api/v1/admin/users/:id
   */
  LoumooApiClient.prototype.getAdminUser = function (id) {
    return this.request('/api/v1/admin/users/' + encodeURIComponent(id));
  };

  /**
   * PATCH /api/v1/admin/users/:id
   */
  LoumooApiClient.prototype.updateAdminUser = function (id, updates) {
    return this.request('/api/v1/admin/users/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: updates || {}
    });
  };

  /**
   * PATCH /api/v1/admin/users/:id/role
   * Updates a user's RBAC role (customer, seller, moderator, admin, super_admin).
   */
  LoumooApiClient.prototype.updateAdminUserRole = function (id, role) {
    var body = typeof role === 'string' ? { role: role } : (role || {});
    return this.request('/api/v1/admin/users/' + encodeURIComponent(id) + '/role', {
      method: 'PATCH',
      body: body
    });
  };

  /**
   * PATCH /api/v1/admin/users/:id/kyc
   * Updates user identity verification status (unverified, pending, verified, rejected).
   */
  LoumooApiClient.prototype.updateAdminUserKyc = function (id, status) {
    var body = typeof status === 'string' ? { status: status } : (status || {});
    return this.request('/api/v1/admin/users/' + encodeURIComponent(id) + '/kyc', {
      method: 'PATCH',
      body: body
    });
  };

  /**
   * GET /api/v1/admin/orders
   * Comprehensive order and payment inspection.
   */
  LoumooApiClient.prototype.getAdminOrders = function (filter) {
    return this.request('/api/v1/admin/orders' + qs(filter));
  };

  /**
   * GET /api/v1/admin/orders/:id
   */
  LoumooApiClient.prototype.getAdminOrder = function (id) {
    return this.request('/api/v1/admin/orders/' + encodeURIComponent(id));
  };

  /**
   * POST /api/v1/admin/orders/:id/escrow
   * Arbitrates and settles escrow transactions (RELEASE, REFUND, HOLD).
   */
  LoumooApiClient.prototype.resolveAdminEscrow = function (id, action) {
    var body = typeof action === 'string' ? { action: action } : (action || {});
    return this.request('/api/v1/admin/orders/' + encodeURIComponent(id) + '/escrow', {
      method: 'POST',
      body: body
    });
  };

  /**
   * GET /api/config
   * Retrieves public platform configuration and dynamic system settings.
   */
  LoumooApiClient.prototype.getPublicConfig = function () {
    return this.request('/api/config');
  };

  /**
   * GET /api/v1/admin/config
   * Admin configuration retrieval alias.
   */
  LoumooApiClient.prototype.getAdminConfig = function () {
    return this.request('/api/v1/admin/config');
  };

  /**
   * GET /api/v1/admin/settings
   * Retrieves all dynamic, zero-code system configurations.
   */
  LoumooApiClient.prototype.getSystemSettings = function () {
    return this.request('/api/v1/admin/settings');
  };

  /**
   * GET /api/v1/admin/settings/:key
   */
  LoumooApiClient.prototype.getSystemSetting = function (key) {
    return this.request('/api/v1/admin/settings/' + encodeURIComponent(key));
  };

  /**
   * PUT /api/v1/admin/settings
   * Updates platform configuration parameters dynamically.
   */
  LoumooApiClient.prototype.updateSystemSettings = function (payload) {
    return this.request('/api/v1/admin/settings', {
      method: 'PUT',
      body: payload || {}
    });
  };

  /**
   * PUT /api/v1/admin/settings/:key
   */
  LoumooApiClient.prototype.updateSystemSetting = function (key, value, reason) {
    return this.request('/api/v1/admin/settings/' + encodeURIComponent(key), {
      method: 'PUT',
      body: { value: value, reason: reason }
    });
  };

  /**
   * GET /api/v1/admin/audit-logs
   * Immutable audit history recording all administrative actions.
   */
  LoumooApiClient.prototype.getAdminAuditLogs = function (filter) {
    return this.request('/api/v1/admin/audit-logs' + qs(filter));
  };

  /**
   * GET /api/v1/admin/audit-logs/actions
   * Distinct action types recorded in audit logs.
   */
  LoumooApiClient.prototype.getAdminAuditActions = function () {
    return this.request('/api/v1/admin/audit-logs/actions');
  };

  /**
   * GET /api/v1/admin/audit-logs/export
   * Exports audit log records formatted as CSV or JSON.
   */
  LoumooApiClient.prototype.exportAdminAuditLogs = function (filter, format) {
    var query = filter ? Object.assign({}, filter) : {};
    if (format) query.format = format;
    return this.request('/api/v1/admin/audit-logs/export' + qs(query));
  };

  /**
   * GET /api/v1/admin/settings/categories
   */
  LoumooApiClient.prototype.getSettingsCategories = function () {
    return this.request('/api/v1/admin/settings/categories');
  };

  /**
   * GET /api/v1/admin/settings/category/:category
   */
  LoumooApiClient.prototype.getSettingsByCategory = function (category) {
    return this.request('/api/v1/admin/settings/category/' + encodeURIComponent(category));
  };

  /**
   * POST /api/v1/admin/settings/reset/:key
   */
  LoumooApiClient.prototype.resetSystemSetting = function (key, reason) {
    return this.request('/api/v1/admin/settings/reset/' + encodeURIComponent(key), {
      method: 'POST',
      body: { reason: reason }
    });
  };

  /**
   * POST /api/v1/admin/maintenance
   */
  LoumooApiClient.prototype.setMaintenanceMode = function (enabled, bannerText, allowAdminBypass) {
    return this.request('/api/v1/admin/maintenance', {
      method: 'POST',
      body: {
        enabled: !!enabled,
        banner_text: bannerText || '',
        allow_admin_bypass: allowAdminBypass !== undefined ? allowAdminBypass : true
      }
    });
  };

  /**
   * GET /api/v1/admin/health/deep
   */
  LoumooApiClient.prototype.getDeepHealth = function () {
    return this.request('/api/v1/admin/health/deep');
  };

  LoumooApiClient.prototype.getAuditLogs = function (filter) {
    return this.getAdminAuditLogs(filter);
  };

  LoumooApiClient.prototype.getAuditActions = function () {
    return this.getAdminAuditActions();
  };

  LoumooApiClient.prototype.exportAuditLogs = function (filter, format) {
    return this.exportAdminAuditLogs(filter, format);
  };

  LoumooApiClient.prototype.resetSetting = function (key, reason) {
    return this.resetSystemSetting(key, reason);
  };

  var instance = new LoumooApiClient();
  instance.LoumooApiClient = LoumooApiClient;
  instance.TOKEN_KEY = TOKEN_KEY;
  return instance;
});
