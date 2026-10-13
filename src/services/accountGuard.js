/**
 * LOUMOO — Client Account Guard
 * ---------------------------------------------------------------------------
 * ONE guard for every protected screen in the application.
 *
 * It holds no opinion of its own. It caches the server's answer from
 * `GET /api/v1/me/state` and routes accordingly. If this file were deleted,
 * nothing would become accessible that isn't already permitted — the server
 * refuses regardless. Its job is to spare the user a pointless round trip and
 * a confusing error.
 *
 * Two guarantees:
 *
 *   NO REDIRECT LOOPS  Each state maps to exactly one destination screen, and
 *                      a screen is never a destination for a state it would
 *                      itself block. The mapping comes from the server.
 *
 *   INTENT PRESERVED   The screen the user was trying to reach is remembered
 *                      and restored once they satisfy the requirement — so
 *                      "sell an item" resumes at the listing wizard, not home.
 *
 * Loaded as a classic script; exposes `window.LoumooGuard`.
 */
(function (root) {
  'use strict';

  var INTENT_KEY = 'loumoo_post_auth_intent';

  var cache = {
    state: null,       // the last server answer
    fetchedAt: 0,
    inflight: null,
    denial: null,      // why the server refused the session: { status, code, message } or null
    generation: 0      // bumped by invalidate() so a late answer is discarded
  };

  var FRESHNESS_MS = 15000;

  function api() {
    return root.LoumooAPI || null;
  }

  function safeStorage() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (e) { /* private mode */ }
    return null;
  }

  var LoumooGuard = {
    /* --------------------------------------------------------------- state */

    /**
     * Returns the server's account state, re-fetching when stale.
     * @param {boolean} force  Bypass the short freshness window.
     */
    load: function (force) {
      var client = api();
      if (!client) return Promise.resolve(null);

      var fresh = !force
        && cache.state
        && (Date.now() - cache.fetchedAt) < FRESHNESS_MS;

      if (fresh) return Promise.resolve(cache.state);
      if (cache.inflight) return cache.inflight;

      // A request started before invalidate() (e.g. sign-out) must not write its
      // now-stale answer back into the cache when it finally settles.
      var generation = cache.generation;

      // Do not make an unauthenticated network call if no token exists
      return client.resolveToken().then(function (token) {
        if (!token) {
          if (generation === cache.generation) {
            cache.state = null;
            cache.denial = null;
            cache.fetchedAt = Date.now();
            cache.inflight = null;
          }
          return null;
        }

        var request = client.getAccountState()
        .then(function (state) {
          if (generation !== cache.generation) return state;
          cache.state = state;
          cache.denial = null;
          cache.fetchedAt = Date.now();
          cache.inflight = null;
          return state;
        })
        .catch(function (err) {
          var current = generation === cache.generation;
          if (current) cache.inflight = null;
          // A rejected session is a real answer: the user is signed out.
          if (err && (err.status === 401 || err.status === 403)) {
            if (current) {
              cache.state = null;
              // 401 = no valid session (signed out / expired). 403 = a session that is
              // valid but refused (a suspended account): callers must tell them apart.
              cache.denial = { status: err.status, code: err.code || null, message: err.message || null };
              cache.fetchedAt = Date.now();
            }
            return null;
          }
          // A network failure is NOT proof of anything. Keep what we had.
          throw err;
        });

        if (generation === cache.generation) cache.inflight = request;
        return request;
      });
    },

    /** The cached state without any network call. May be null. */
    peek: function () {
      return cache.state;
    },

    /** Why the last state request was refused ({ status, code, message }), or null. */
    denial: function () {
      return cache.denial;
    },

    /** Drops the cache — call after sign-out or any state-changing action. */
    invalidate: function () {
      cache.state = null;
      cache.denial = null;
      cache.fetchedAt = 0;
      cache.inflight = null;
      cache.generation += 1;
    },

    /** Replaces the cache with a state the server just returned. */
    adopt: function (state) {
      if (!state) return;
      cache.state = state;
      cache.fetchedAt = Date.now();
    },

    /* ---------------------------------------------------------- capability */

    can: function (capability) {
      return Boolean(cache.state
        && cache.state.capabilities
        && cache.state.capabilities[capability]);
    },

    isAuthenticated: function () {
      return Boolean(cache.state && cache.state.isAuthenticated);
    },

    /* ------------------------------------------------------------- routing */

    /**
     * Decides where a user wanting `capability` should actually go.
     *
     * @returns {Promise<{allowed:boolean, screen:string|null, reason:string|null}>}
     *   allowed -> proceed to the requested screen
     *   else    -> `screen` is the ONE place that lets them make progress
     */
    resolve: function (capability, requestedScreen) {
      var self = this;

      return this.load().then(function (state) {
        if (!state || !state.isAuthenticated) {
          self.rememberIntent(requestedScreen, capability);
          return {
            allowed: false,
            screen: 'signIn',
            reason: 'Sign in to continue.'
          };
        }

        if (!capability || state.capabilities[capability]) {
          return { allowed: true, screen: requestedScreen || null, reason: null };
        }

        self.rememberIntent(requestedScreen, capability);

        return {
          allowed: false,
          // The destination comes from the server's state machine, so it is
          // always a screen the user can actually make progress on.
          screen: state.screen,
          reason: self.explain(state, capability),
          state: state.state,
          onboarding: state.onboarding
        };
      }).catch(function () {
        // Offline: let the attempt through. The server is the real gate and
        // will answer correctly — blocking here on a network blip would strand
        // a legitimate user on a screen they are entitled to use.
        return { allowed: true, screen: requestedScreen || null, reason: null, degraded: true };
      });
    },

    /** Plain-language reason, matched to where the user actually is. */
    explain: function (state, capability) {
      switch (state.state) {
        case 'CONTACT_VERIFICATION_REQUIRED':
          return 'Verify your email address to continue.';
        case 'ONBOARDING_REQUIRED':
          return 'Finish setting up your LOUMOO account to continue.';
        case 'ONBOARDING_IN_PROGRESS':
          return state.onboarding && state.onboarding.nextStep
            ? 'A few more details and you are done.'
            : 'Finish setting up your account to continue.';
        case 'ACCOUNT_READY':
          return capability === 'canCreateListing' || capability === 'canUploadListingMedia'
            ? 'Set up your boutique to start selling on LOUMOO.'
            : 'This needs a little more account setup.';
        case 'SELLER_VERIFICATION_REQUIRED':
          return 'Finish setting up your boutique before you can list items.';
        case 'SUSPENDED':
          return 'This account is suspended. Contact LOUMOO support.';
        default:
          return 'You cannot do this yet.';
      }
    },

    /* -------------------------------------------------------------- intent */

    /**
     * Remembers where the user was heading, so completing a requirement
     * returns them there instead of dumping them on the home screen.
     */
    rememberIntent: function (screen, capability, path) {
      if (!screen && !path) return;
      var store = safeStorage();
      if (!store) return;
      try {
        store.setItem(INTENT_KEY, JSON.stringify({
          screen: screen || null,
          // The full address (path + query) the user was heading to. It is only ever
          // honoured after the router has validated it against the route registry.
          path: typeof path === 'string' ? path.slice(0, 2048) : null,
          capability: capability || null,
          at: Date.now()
        }));
      } catch (e) { /* quota */ }
    },

    /**
     * Consumes the remembered destination.
     *
     * @param {string[]} allowedScreens  The application's screen whitelist (optional when only
     *        the validated `path` is wanted; the router validates that against its registry).
     *        Validating against it means a tampered localStorage value can
     *        never become an open redirect to an arbitrary destination.
     * @param {number} maxAgeMs  Ignore stale intents (default 1 hour).
     */
    takeIntent: function (allowedScreens, maxAgeMs) {
      var store = safeStorage();
      if (!store) return null;

      var raw;
      try {
        raw = store.getItem(INTENT_KEY);
        store.removeItem(INTENT_KEY);
      } catch (e) { return null; }

      if (!raw) return null;

      try {
        var intent = JSON.parse(raw);
        if (!intent || (!intent.screen && !intent.path)) return null;
        if (intent.screen && Array.isArray(allowedScreens) && allowedScreens.indexOf(intent.screen) === -1) return null;
        var age = Date.now() - (intent.at || 0);
        if (age > (maxAgeMs || 3600000)) return null;
        return intent;
      } catch (e) {
        return null;
      }
    },

    clearIntent: function () {
      var store = safeStorage();
      if (!store) return;
      try { store.removeItem(INTENT_KEY); } catch (e) { /* noop */ }
    }
  };

  root.LoumooGuard = LoumooGuard;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LoumooGuard;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
