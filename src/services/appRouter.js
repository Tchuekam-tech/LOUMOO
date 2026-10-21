/**
 * LOUMOO — application router
 * ---------------------------------------------------------------------------
 * Gives the single-document app real, bookmarkable, refresh-proof URLs using the
 * History API, driven entirely by the registry in src/routing/routes.js.
 *
 * The shell keeps owning its screens (`state.screen`). The router sits beside it
 * and does four things:
 *
 *   URL  -> screen   on load, refresh, back/forward and link clicks it resolves the
 *                    address against the registry, applies the access policy, and
 *                    asks the shell (through the adapter) to show the right thing.
 *   screen -> URL    after every shell state change it asks the registry which URL
 *                    the state represents and pushes it, so in-app navigation
 *                    updates the address bar instead of staying invisible.
 *   overlays         the rider hub, seller dispatch, delivery tracking... are
 *                    full-window tools owned by service modules. A route opens one
 *                    and closing it (by any means) leaves the route.
 *   access           protected routes are checked against the existing account
 *                    guard (src/services/accountGuard.js); a visitor who cannot be
 *                    let in is sent to the ONE place that lets them make progress
 *                    and brought back afterwards (`returnTo`). This is a UX layer:
 *                    the backend authorizes every request again.
 *
 * Nothing here knows about shell internals: the shell hands in an adapter
 * (see `start`). The public module APIs (`LoumooRiderHub.open()` etc.) remain, as
 * thin compatibility shims that call `openOverlay`, which navigates to the
 * canonical URL; there is exactly one navigation system.
 *
 * Loaded as a classic script; exposes `window.LoumooRouter`. Also requirable in
 * Node (tests drive it with a fake window).
 */
(function (root) {
  'use strict';
  if (!root) return;
  if (root.LoumooRouter && root.LoumooRouter.__version) return; // never initialise twice

  var Routes = root.LoumooRoutes;
  if (!Routes && typeof require === 'function') { try { Routes = require('../routing/routes'); } catch (e) { /* browser */ } }
  if (!Routes) return;

  var MAX_REDIRECTS = 5;       // a chain longer than this is a loop, not a journey
  var RECENT_APPLY_MS = 3000;  // state-derived canonicalisation inside this window replaces, not pushes
  var PAGE_NAV_KEY = 'loumoo_page_nav';

  var S = {
    started: false,
    adapter: null,
    cur: null,            // { routeId, params, pathname, search, appliedAt }
    idx: 0,               // position among this tab's in-app history entries
    seq: 0,               // navigation sequence: a stale async result is discarded
    applying: 0,          // >0 while the router itself is changing the shell
    overlay: null,        // { name, routeId, handle, baseScreen }
    closingOverlay: false,
    redirects: 0,
    readyPromise: null,
    bound: false,
    headApplied: false,   // set once the first route has been applied (see applyRoute)
    lastSyncSig: ''
  };

  /* ------------------------------------------------------------------ utils */
  function win() { return root.window || root; }
  function loc() { return win().location; }
  function hist() { return win().history; }
  function docu() { return root.document || (win().document); }

  function safeStorage() {
    try { return win().localStorage || null; } catch (e) { return null; }
  }
  function safeSession() {
    try { return win().sessionStorage || null; } catch (e) { return null; }
  }

  function fullPath(route, params, search) {
    var p = Routes.build(route.id, params || {});
    return p ? p + (search || '') : null;
  }

  function currentLocation() {
    var l = loc();
    return { pathname: Routes.normalizePath(l.pathname || '/'), search: l.search || '' };
  }

  function setRobots(noindex) {
    var d = docu();
    if (!d || !d.head) return;
    var el = d.head.querySelector('meta[name="robots"][data-loumoo-router]');
    if (noindex) {
      if (!el) {
        el = d.createElement('meta');
        el.setAttribute('name', 'robots');
        el.setAttribute('data-loumoo-router', '1');
        d.head.appendChild(el);
      }
      el.setAttribute('content', 'noindex');
    } else if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  function setTitle(title) {
    var d = docu();
    if (!d) return;
    d.title = title && title !== 'LOUMOO' && title.indexOf('LOUMOO') === -1 ? title + ' — LOUMOO' : (title || 'LOUMOO');
  }

  // Keep the whole document head (title, description, canonical, robots,
  // OpenGraph, Twitter) in step as the visitor navigates, using the shared
  // model the server prerender uses (src/seo/seoModel.js). The server already
  // wrote entity-level tags into the landing HTML; this covers in-app
  // navigation. Falls back to the minimal title/robots behaviour when the SEO
  // model is not present (e.g. the Node test harness).
  // The canonical origin the SERVER wrote into this page (its canonical link comes
  // from PUBLIC_SITE_URL / the registry ORIGIN), so in-app navigation keeps the same
  // host the landing HTML declared. Read once, before applyTags() replaces that
  // link; never derived from location, which may be a preview or the redirecting apex.
  var siteOriginCache = null;
  function siteOrigin(seo) {
    if (siteOriginCache) return siteOriginCache;
    var d = docu();
    var link = d && d.head && d.head.querySelector && d.head.querySelector('link[rel="canonical"][data-loumoo-seo]');
    var m = link && /^(https:\/\/[A-Za-z0-9.-]+(?::\d+)?)(?:\/|$)/.exec(link.getAttribute('href') || '');
    siteOriginCache = (m && m[1]) || (Routes && Routes.ORIGIN) || seo.DEFAULT_SITE_URL;
    return siteOriginCache;
  }

  /**
   * True when the server prerendered this document's head FOR `path` (the content
   * block records the path it rendered; its canonical may differ, e.g. a product
   * opened by id canonicalises to its slug).
   */
  function serverHeadFor(path) {
    var d = docu();
    var block = d && d.getElementById && d.getElementById('loumoo-prerender');
    var rendered = block && block.getAttribute && block.getAttribute('data-path');
    if (!rendered || !d.head || !d.head.querySelector || !d.head.querySelector('[data-loumoo-seo]')) return false;
    var p = String(path || '/').split('?')[0].split('#')[0] || '/';
    return rendered === p;
  }

  function applyHead(resolved, path, titleOverride) {
    var seo = root.LoumooSeo;
    var d = docu();
    if (seo && d && d.head && typeof seo.applyHead === 'function') {
      try {
        seo.applyHead(d, resolved, {
          siteUrl: siteOrigin(seo),
          path: path || (loc() && loc().pathname) || '/',
          titleOverride: titleOverride
        });
        return;
      } catch (e) { /* fall through to the minimal path */ }
    }
    if (resolved && resolved.type === 'route' && resolved.route) {
      setRobots(false);
      setTitle(resolved.route.title || titleOverride);
    } else {
      setRobots(true);
      setTitle(titleOverride || 'Page not found');
    }
  }

  function toast(msg) {
    if (msg && S.adapter && typeof S.adapter.toast === 'function') {
      try { S.adapter.toast(msg); } catch (e) { /* cosmetic */ }
    }
  }

  /* ---------------------------------------------------------------- history */
  function readIdx() {
    var h = hist();
    var st = h && h.state;
    return st && typeof st.idx === 'number' ? st.idx : 0;
  }

  function writeHistory(path, mode) {
    var h = hist();
    if (!h) return;
    if (mode === 'replace') {
      h.replaceState({ loumoo: 1, idx: S.idx }, '', path);
    } else {
      S.idx += 1;
      h.pushState({ loumoo: 1, idx: S.idx }, '', path);
    }
  }

  /* -------------------------------------------------------------- readiness */
  // The account guard needs the API client to have its token provider; the auth
  // service installs it in init() (idempotent). Wait for that once, then every
  // access check is a plain guard.load().
  function ready() {
    if (S.readyPromise) return S.readyPromise;
    var auth = root.LoumooAuth || root.LoumooClerk;
    var p;
    try { p = auth && typeof auth.init === 'function' ? Promise.resolve(auth.init()) : Promise.resolve(); }
    catch (e) { p = Promise.resolve(); }
    S.readyPromise = p.then(function () { return null; }, function () { return null; });
    return S.readyPromise;
  }

  /* ----------------------------------------------------------------- access */
  var SIGN_IN = '/sign-in';

  function signInUrl(intentPath) {
    var rt = intentPath && Routes.safeReturnTo(intentPath);
    return SIGN_IN + (rt ? '?returnTo=' + encodeURIComponent(rt) : '');
  }

  function rememberIntent(route, capability, path) {
    var g = root.LoumooGuard;
    if (g && typeof g.rememberIntent === 'function') g.rememberIntent(route.screen || null, capability || null, path || null);
  }

  /** Where a state-machine `destination` ('/verify', '/seller/onboarding', ...) really lives. */
  function destinationPath(dest) {
    if (typeof dest !== 'string') return null;
    var r = Routes.resolve(dest);
    if (r.type === 'redirect') return r.to;
    if (r.type === 'route') return Routes.parseUrl(dest).pathname;
    return null;
  }

  /**
   * Pure decision: may `state` (the /me/state envelope or null) open `route`?
   *   { allow: true }
   *   { redirect: '/path', replace: true, reason, intent: true }
   *   { forbidden: true, reason }
   */
  function evaluate(route, params, state, ctx) {
    var access = route.access || Routes.access.PUBLIC;
    var signedIn = Boolean(state && state.isAuthenticated);
    var here = fullPath(route, params, ctx.search);

    if (route.guestOnly) {
      // Only a fully-ready account is bounced off the sign-in screen. Anyone else
      // (verification pending, suspended, onboarding) is exactly who it is for,
      // so redirecting them would be a loop.
      var readyState = signedIn && (state.state === 'ACCOUNT_READY' || state.state === 'SELLER_READY');
      if (readyState && ctx.mode !== 'state') {
        var back = takeReturnToInternal(ctx.search);
        return { redirect: back || '/', replace: true };
      }
      return { allow: true };
    }

    if (access.kind === 'public') return { allow: true };

    if (!signedIn) {
      var g = root.LoumooGuard;
      var denial = g && typeof g.denial === 'function' ? g.denial() : null;
      if (denial && denial.status === 403) {
        // A rejected-but-present session is a suspended account, not a signed-out visitor.
        return { redirect: '/account/suspended', replace: true, reason: 'This account is suspended. Contact LOUMOO support.' };
      }
      rememberIntent(route, access.capability || null, here);
      return { redirect: signInUrl(here), replace: true, reason: 'Sign in to continue.', intent: true };
    }

    if (access.kind === 'role') {
      var role = state.user && state.user.primaryRole;
      if (access.roles.indexOf(role) === -1) return { forbidden: true, reason: 'You do not have access to this area.' };
      return { allow: true };
    }

    var caps = state.capabilities || {};

    if (access.kind === 'seller') {
      if (!caps.canStartSelling) return deniedByState(route, 'canStartSelling', state, here);
      var storeId = state.seller && state.seller.storeId;
      if (!storeId) {
        rememberIntent(route, 'canCreateListing', here);
        return { redirect: '/sell/create-store', replace: true, reason: 'Create your Boutique to start publishing listings across Cameroon', intent: true };
      }
      if (!caps.canCreateListing) {
        rememberIntent(route, 'canCreateListing', here);
        return { redirect: '/sell/onboarding', replace: true, reason: 'Finish activating your boutique to publish listings', intent: true };
      }
      return { allow: true };
    }

    if (access.kind === 'capability') {
      if (caps[access.capability]) return { allow: true };
      return deniedByState(route, access.capability, state, here);
    }
    return { allow: true };
  }

  function deniedByState(route, capability, state, here) {
    var g = root.LoumooGuard;
    var reason = g && typeof g.explain === 'function' ? g.explain(state, capability) : 'You cannot do this yet.';
    var dest = destinationPath(state.destination);
    var destRoute = dest ? Routes.resolve(dest) : null;
    // A destination that is the requested route itself (or home, which is where a
    // fully-set-up buyer already is) cannot help: say why instead of looping.
    if (!dest || dest === '/' || (destRoute && destRoute.type === 'route' && destRoute.route.id === route.id)) {
      return { forbidden: true, reason: reason };
    }
    rememberIntent(route, capability, here);
    return { redirect: dest, replace: true, reason: reason, intent: true };
  }

  function decide(route, params, ctx) {
    var access = route.access || Routes.access.PUBLIC;
    if (access.kind === 'public' && !route.guestOnly) return Promise.resolve({ allow: true });
    var guard = root.LoumooGuard;
    if (!guard || typeof guard.load !== 'function') return Promise.resolve({ allow: true, degraded: true });
    return ready().then(function () { return guard.load(); }).then(function (state) {
      return evaluate(route, params, state, ctx);
    }, function () {
      // The account state could not be fetched. A network failure proves nothing
      // about who the visitor is, so (like accountGuard.resolve) let the attempt
      // through: the server is the real gate and answers each request correctly.
      return { allow: true, degraded: true };
    });
  }

  /* ----------------------------------------------------------------- return */
  function paramFromSearch(search, name) {
    if (!search) return null;
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(search);
    if (!m) return null;
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return null; }
  }

  function takeReturnToInternal(search) {
    var fromUrl = Routes.safeReturnTo(paramFromSearch(search, 'returnTo'));
    var g = root.LoumooGuard;
    var intent = g && typeof g.takeIntent === 'function' ? g.takeIntent() : null;
    var fromIntent = intent && intent.path ? Routes.safeReturnTo(intent.path) : null;
    return fromUrl || fromIntent || null;
  }

  /* --------------------------------------------------------------- overlays */
  function overlayModule(name) {
    switch (name) {
      case 'rider': return { m: root.LoumooRiderHub, call: function (m, a, c) { return m.mount({ onClose: c }); } };
      case 'sellerDispatch': return { m: root.LoumooSellerDispatch, call: function (m, a, c) { return m.mount({ orderId: a.orderId || null, onClose: c }); } };
      case 'tracking': return { m: root.LoumooDeliveryTracking, call: function (m, a, c) { return m.mount({ orderId: a.orderId || null, deliveryId: a.deliveryId || null, onClose: c }); } };
      case 'providerProfile': return { m: root.LoumooProviderProfile, call: function (m, a, c) { return m.mount({ providerId: a.providerId, city: a.city || null, onClose: c }); } };
      case 'providerFollowed': return { m: root.LoumooProviderProfile, call: function (m, a, c) { return m.mountFollowed({ onClose: c }); } };
      case 'ridersAdmin': return { m: root.LoumooRidersAdmin, call: function (m, a, c) { return m.mount({ onClose: c }); } };
      default: return null;
    }
  }

  function overlayArgsFor(route, params, search) {
    var spec = route.overlayArgs;
    var args = {};
    if (spec) {
      if (spec.param) args[spec.as] = params[spec.param];
      if (spec.query) {
        Object.keys(spec.query).forEach(function (q) {
          var v = paramFromSearch(search, q);
          if (v != null) args[spec.query[q]] = v;
        });
      }
    }
    return args;
  }

  function closeOverlay() {
    var o = S.overlay;
    if (!o) return;
    S.overlay = null;
    S.closingOverlay = true;
    try { if (o.handle && typeof o.handle.close === 'function') o.handle.close(); } catch (e) { /* already gone */ }
    S.closingOverlay = false;
  }

  /** The overlay was dismissed by the user (Done / Esc / scrim / its own close button). */
  function overlayDismissed(token) {
    if (S.closingOverlay) return;
    if (!S.overlay || S.overlay !== token) return;
    S.overlay = null;
    leaveOverlayRoute();
  }

  function leaveOverlayRoute() {
    var cur = S.cur;
    var route = cur && Routes.byId(cur.routeId);
    if (S.idx > 0) { hist().back(); return; }   // popstate then shows the previous place
    var parent = route && route.parent && Routes.byId(route.parent);
    var target = parent ? Routes.build(parent.id, {}) : '/';
    navigate(target || '/', { replace: true, mode: 'overlay-close' });
  }

  function openOverlayForRoute(route, params, search, baseScreen) {
    var spec = overlayModule(route.overlay);
    if (!spec || !spec.m || typeof spec.m.mount !== 'function' && typeof spec.m.mountFollowed !== 'function') {
      toast('This tool could not be loaded. Please reload the page.');
      return false;
    }
    var token = { name: route.overlay, routeId: route.id, handle: null, baseScreen: baseScreen || null };
    S.overlay = token;
    var handle = null;
    try {
      handle = spec.call(spec.m, overlayArgsFor(route, params, search), function () { overlayDismissed(token); });
    } catch (e) {
      S.overlay = null;
      toast('This tool could not be opened.');
      return false;
    }
    token.handle = handle;
    return true;
  }

  /* ------------------------------------------------------------------ apply */
  function showNotFound(info) {
    closeOverlay();
    applyHead(
      { type: info.kind === 'unavailable' ? 'unavailable' : 'notfound' },
      (info && info.path) || null,
      info.kind === 'forbidden' ? 'No access' : (info.kind === 'unavailable' ? (info.title || 'Not available') : 'Page not found')
    );
    S.applying += 1;
    try { if (S.adapter && S.adapter.showNotFound) S.adapter.showNotFound(info); }
    finally { S.applying -= 1; }
  }

  function applyRoute(route, params, search, mode) {
    // 'mode' is how the address bar was (or will be) written: push | replace | pop | initial.
    var direction = mode === 'pop' ? 'pop' : (mode === 'push' ? 'push' : 'replace');
    // On the very first route the router applies, the server prerender has already
    // written this URL's head (entity title/JSON-LD, a 404's noindex, a category's
    // own title) into the HTML. That is what a rendering crawler must end up with, so
    // keep it rather than overwrite it with the route-level fallback. (A one-shot
    // flag, not `mode`: navigate() hands the first load to applyRoute as 'replace',
    // so a `mode === 'initial'` test here never matched.) In-app navigation, a
    // client-side redirect to another path, or a page served without a prerendered
    // head (render failure) keeps the head in sync as before.
    var landing = fullPath(route, params, search);
    var keepServerHead = !S.headApplied && serverHeadFor(landing);
    S.headApplied = true;
    if (!keepServerHead) {
      applyHead({ type: 'route', route: route, params: params }, landing);
    }

    if (route.kind === 'overlay') {
      closeOverlay();
      S.applying += 1;
      try {
        // The shell must have a real screen under the overlay; it tells us which, because
        // its own state update may not have landed yet when we are called.
        var base = S.adapter && S.adapter.ensureBase ? S.adapter.ensureBase(route) : null;
        openOverlayForRoute(route, params, search, base);
      } finally { S.applying -= 1; }
      return Promise.resolve({ shown: true });
    }

    closeOverlay();
    S.applying += 1;
    var result;
    try {
      result = S.adapter && S.adapter.showScreen
        ? S.adapter.showScreen(route.screen, route, params, { direction: direction, search: search })
        : null;
    } finally { S.applying -= 1; }

    return Promise.resolve(result).then(function (r) {
      if (r && r.notFound) showNotFound({ kind: 'notfound', path: fullPath(route, params, search), resource: route.id });
      else if (r && r.error) showNotFound({ kind: 'error', path: fullPath(route, params, search), resource: route.id });
      return r || { shown: true };
    });
  }

  /**
   * Resolve a target and make it so.
   * @param {string} target     '/path?query'
   * @param {object} opts       { replace, mode: 'push'|'replace'|'pop'|'initial' }
   */
  function navigate(target, opts) {
    opts = opts || {};
    var mySeq = ++S.seq;
    var u = Routes.parseUrl(target);
    var res = Routes.resolve(u.pathname + u.search);

    if (res.type === 'redirect') {
      if (++S.redirects > MAX_REDIRECTS) { S.redirects = 0; return fail('redirect-loop', u); }
      var again = navigate(res.to, { replace: true, mode: opts.mode === 'initial' ? 'initial' : 'replace' });
      return again;
    }
    S.redirects = 0;

    var mode = opts.mode || (opts.replace ? 'replace' : 'push');
    var writeMode = (mode === 'push') ? 'push' : 'replace';

    if (res.type === 'file') {
      // Not an application route (a file path). Let the server answer it.
      loc().assign(u.pathname + u.search);
      return Promise.resolve({ external: true });
    }

    if (res.type === 'notfound' || res.type === 'unavailable') {
      var path = u.pathname + u.search;
      if (mode !== 'pop' && mode !== 'initial' && sameAsCurrent(path)) writeMode = 'replace';
      if (mode !== 'pop') writeHistory(path, writeMode);
      S.cur = { routeId: null, params: {}, pathname: u.pathname, search: u.search, appliedAt: Date.now(), source: 'url' };
      showNotFound({
        kind: res.type === 'unavailable' ? 'unavailable' : 'notfound',
        path: path,
        title: res.route ? res.route.title : null
      });
      return Promise.resolve({ notFound: true });
    }

    var route = res.route;
    var params = res.params;

    if (route.kind === 'page') {
      return pageNavigation(route, u);
    }

    if (route.direct === 'redirect' && mode === 'initial' && route.fallback) {
      var fb = Routes.build(route.fallback, {});
      if (fb) return navigate(fb, { replace: true, mode: 'initial' });
    }

    var ctx = { mode: 'url', search: u.search };
    return decide(route, params, ctx).then(function (d) {
      if (mySeq !== S.seq) return { stale: true };
      if (d.redirect) {
        if (d.reason) toast(d.reason);
        if (++S.redirects > MAX_REDIRECTS) { S.redirects = 0; return fail('redirect-loop', u); }
        var next = navigate(d.redirect, { replace: true, mode: mode === 'initial' ? 'initial' : 'replace' });
        return next;
      }
      S.redirects = 0;
      var path = fullPath(route, params, u.search) || (u.pathname + u.search);
      if (d.forbidden) {
        if (mode !== 'pop') writeHistory(path, mode === 'initial' ? 'replace' : writeMode);
        S.cur = { routeId: route.id, params: params, pathname: u.pathname, search: u.search, appliedAt: Date.now(), source: 'url' };
        showNotFound({ kind: 'forbidden', path: path, message: d.reason });
        return { forbidden: true };
      }
      if (mode !== 'pop') {
        if (mode !== 'initial' && sameAsCurrent(path)) writeMode = 'replace';
        writeHistory(path, mode === 'initial' ? 'replace' : writeMode);
      }
      S.cur = { routeId: route.id, params: params, pathname: Routes.build(route.id, params), search: u.search, appliedAt: Date.now(), source: 'url' };
      return applyRoute(route, params, u.search, mode === 'initial' ? 'replace' : mode);
    });
  }

  function sameAsCurrent(path) {
    var l = currentLocation();
    var u = Routes.parseUrl(path);
    return l.pathname === u.pathname && l.search === u.search;
  }

  function fail(code, u) {
    showNotFound({ kind: 'forbidden', path: u.pathname + u.search, message: 'We could not open this page (' + code + ').' });
    return Promise.resolve({ failed: code });
  }

  /** A route that is its own document (the admin control center): do a real navigation. */
  function pageNavigation(route, u) {
    var ss = safeSession();
    var now = Date.now();
    try {
      var last = ss && Number(ss.getItem(PAGE_NAV_KEY));
      // The gateway should answer this URL with the page, not with this app. If it
      // sent us back here within seconds, stop rather than reload forever.
      if (last && now - last < 4000) {
        showNotFound({ kind: 'unavailable', path: u.pathname, title: route.title });
        return Promise.resolve({ failed: 'page-loop' });
      }
      if (ss) ss.setItem(PAGE_NAV_KEY, String(now));
    } catch (e) { /* storage unavailable: navigate anyway */ }
    loc().assign(u.pathname + u.search);
    return Promise.resolve({ external: true });
  }

  /* ----------------------------------------------------------------- events */
  function onPopState() {
    if (!S.started) return;
    S.idx = readIdx();
    var l = currentLocation();
    S.redirects = 0;
    navigate(l.pathname + l.search, { replace: true, mode: 'pop' });
  }

  function onClick(e) {
    if (!S.started || e.defaultPrevented) return;
    if (e.button !== undefined && e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var el = e.target;
    while (el && el.nodeType === 1 && el.tagName !== 'A') el = el.parentNode;
    if (!el || el.nodeType !== 1 || el.tagName !== 'A') return;
    var href = el.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;
    var target = el.getAttribute('target');
    if (target && target !== '_self') return;
    if (el.hasAttribute('download') || el.getAttribute('rel') === 'external') return;
    var url;
    try { url = new URL(el.href, loc().href); } catch (err) { return; }
    if (url.origin !== loc().origin) return;
    var res = Routes.resolve(url.pathname + url.search);
    var routable = res.type === 'redirect' || (res.type === 'route' && res.route.kind !== 'page');
    if (!routable) return;       // files, API, SuperAdmin pages: the browser handles those
    e.preventDefault();
    navigate(url.pathname + url.search + (url.hash || ''), { mode: 'push' });
  }

  function bind() {
    if (S.bound) return;           // never a second set of listeners
    S.bound = true;
    var w = win();
    if (w.addEventListener) w.addEventListener('popstate', onPopState);
    var d = docu();
    if (d && d.addEventListener) d.addEventListener('click', onClick, false);
  }

  function unbind() {
    if (!S.bound) return;
    S.bound = false;
    var w = win();
    if (w.removeEventListener) w.removeEventListener('popstate', onPopState);
    var d = docu();
    if (d && d.removeEventListener) d.removeEventListener('click', onClick, false);
  }

  /* ------------------------------------------------------------------- sync */
  /**
   * Called by the shell after every state change. Keeps the address bar in step
   * with `state.screen` (and the route parameters bound to state).
   */
  function syncFromState(state) {
    if (!S.started || S.applying > 0 || !state) return;
    var screen = state.screen;
    if (!screen || screen === 'loading' || screen === 'networkError') return;

    if (screen === 'notFound') return; // the router put it there; the URL is the visitor's own

    if (S.overlay) {
      // An overlay owns the URL while it is open. Only a real change of the
      // screen underneath is a navigation.
      if (state.screen === S.overlay.baseScreen) return;
      closeOverlay();
    }

    var r = Routes.forState(screen, state);
    if (!r) return;
    var l = currentLocation();
    var sameRoute = S.cur && S.cur.routeId === r.route.id;
    if (l.pathname === r.path) {
      if (!sameRoute) S.cur = { routeId: r.route.id, params: r.params, pathname: r.path, search: l.search, appliedAt: Date.now(), source: 'state' };
      return;
    }

    // Only an entry the router itself just created from a URL may be tidied in place (the shell
    // reporting the record's canonical id a moment after opening it). A visitor moving between
    // two records of the same kind is a real navigation and gets its own history entry.
    var recentlyApplied = S.cur && S.cur.source === 'url' && (Date.now() - S.cur.appliedAt) < RECENT_APPLY_MS;
    var mode = (sameRoute && recentlyApplied) ? 'replace' : 'push';
    var keepSearch = sameRoute ? l.search : '';
    var path = r.path + keepSearch;
    writeHistory(path, mode);
    S.cur = { routeId: r.route.id, params: r.params, pathname: r.path, search: keepSearch, appliedAt: Date.now(), source: 'state' };
    applyHead({ type: 'route', route: r.route, params: r.params }, path);

    var access = r.route.access;
    if (access && access.kind !== 'public') enforceFromState(r.route, r.params, keepSearch);
  }

  /** In-app navigation to a protected screen gets the same check as a typed URL. */
  function enforceFromState(route, params, search) {
    var mySeq = ++S.seq;
    decide(route, params, { mode: 'state', search: search }).then(function (d) {
      if (mySeq !== S.seq || !S.cur || S.cur.routeId !== route.id) return;
      if (d.redirect) {
        if (d.reason) toast(d.reason);
        navigate(d.redirect, { replace: true, mode: 'replace' });
      } else if (d.forbidden) {
        showNotFound({ kind: 'forbidden', path: fullPath(route, params, search), message: d.reason });
      }
    });
  }

  /* ----------------------------------------------------------------- public */
  function start(adapter) {
    S.adapter = adapter;
    if (S.started) return Promise.resolve({ restarted: true });
    S.started = true;
    var h = hist();
    if (h) {
      try { if ('scrollRestoration' in h) h.scrollRestoration = 'manual'; } catch (e) { /* read-only */ }
      S.idx = readIdx();
      var st = h.state;
      if (!st || !st.loumoo) h.replaceState({ loumoo: 1, idx: S.idx }, '', loc().pathname + loc().search + loc().hash);
    }
    bind();
    var l = currentLocation();
    return navigate(l.pathname + l.search, { replace: true, mode: 'initial' });
  }

  function stop() {
    unbind();
    closeOverlay();
    S.started = false;
    S.adapter = null;
    S.cur = null;
    S.readyPromise = null;
    S.seq += 1;
  }

  /** Navigate to a path or { id, params, query }. */
  function go(target, opts) {
    if (target && typeof target === 'object') {
      var built = Routes.build(target.id, target.params || {}, target.query || null);
      if (!built) return Promise.resolve({ failed: 'bad-target' });
      target = built;
    }
    if (!S.started) {
      loc().assign(target);
      return Promise.resolve({ external: true });
    }
    return navigate(target, opts && opts.replace ? { replace: true, mode: 'replace' } : { mode: 'push' });
  }

  /**
   * Compatibility entry for the service modules: `LoumooRiderHub.open()` etc.
   * Navigates to the canonical URL of the overlay; the route then opens it.
   */
  function openOverlay(name, args) {
    args = args || {};
    var cands = Routes.routes.filter(function (r) { return r.kind === 'overlay' && r.overlay === name; });
    // A candidate that needs an argument is chosen only when the caller supplied it
    // ('deliveryId' sorts before 'orderId': the delivery is the more specific handle).
    var withArg = cands.filter(function (r) {
      return r.overlayArgs && args[r.overlayArgs.as] != null && args[r.overlayArgs.as] !== '';
    }).sort(function (a, b) { return a.overlayArgs.as < b.overlayArgs.as ? -1 : 1; });
    var pick = withArg[0] || cands.filter(function (r) { return !r.overlayArgs; })[0] || null;
    if (!pick) return null;
    var params = {};
    var query = {};
    if (pick.overlayArgs) {
      if (pick.overlayArgs.param) params[pick.overlayArgs.param] = args[pick.overlayArgs.as];
      if (pick.overlayArgs.query) Object.keys(pick.overlayArgs.query).forEach(function (q) {
        var v = args[pick.overlayArgs.query[q]];
        if (v != null && v !== '') query[q] = v;
      });
    }
    if (S.overlay && S.overlay.routeId === pick.id) return S.overlay.handle || null; // already open: do not re-navigate
    var path = Routes.build(pick.id, params, query);
    if (!path) return null;
    go(path);
    return null;
  }

  /** In-app Back: one history step when there is one, else up to the parent place. */
  function back(fallbackRouteId) {
    if (!S.started) return false;
    if (S.idx > 0) { hist().back(); return true; }
    var route = S.cur && Routes.byId(S.cur.routeId);
    var parentId = fallbackRouteId || (route && route.parent);
    var target = parentId ? Routes.build(parentId, {}) : null;
    if (!target || target === currentLocation().pathname) return false;
    navigate(target, { replace: true, mode: 'replace' });
    return true;
  }

  /** The address bar shows a resource that does not exist (404 from its API). */
  function notFound(info) {
    if (!S.started) return;
    info = info || {};
    var l = currentLocation();
    showNotFound({ kind: info.kind || 'notfound', path: l.pathname + l.search, message: info.message || null, resource: info.resource || null });
  }

  /** The resource behind the address was found under a better name: tidy the URL in place. */
  function canonicalize(path) {
    if (!S.started || !path) return;
    var l = currentLocation();
    var u = Routes.parseUrl(path);
    if (l.pathname === u.pathname) return;
    var res = Routes.resolve(u.pathname);
    if (res.type !== 'route') return;
    hist().replaceState({ loumoo: 1, idx: S.idx }, '', u.pathname + l.search);
    S.cur = { routeId: res.route.id, params: res.params, pathname: u.pathname, search: l.search, appliedAt: Date.now(), source: 'url' };
  }

  /** After sign-in / verification / onboarding: where the visitor was headed, or null. */
  function takeReturnTo() {
    return takeReturnToInternal(currentLocation().search);
  }

  /** Initial screen for the shell's first render: avoid flashing Home on a deep link. */
  function initialScreen() {
    try {
      var p = Routes.normalizePath(loc().pathname || '/');
      return p === '/' ? 'home' : 'loading';
    } catch (e) { return 'home'; }
  }

  root.LoumooRouter = {
    __version: 1,
    start: start,
    stop: stop,
    navigate: go,
    replace: function (t) { return go(t, { replace: true }); },
    back: back,
    openOverlay: openOverlay,
    syncFromState: syncFromState,
    notFound: notFound,
    canonicalize: canonicalize,
    takeReturnTo: takeReturnTo,
    initialScreen: initialScreen,
    isActive: function () { return S.started; },
    current: function () { return S.cur ? { routeId: S.cur.routeId, params: S.cur.params, pathname: S.cur.pathname, search: S.cur.search } : null; },
    overlayOpen: function () { return S.overlay ? S.overlay.name : null; },
    historyIndex: function () { return S.idx; },
    // Exposed for the unit tests: the pure access decision.
    _evaluate: evaluate
  };

  if (typeof module === 'object' && module && module.exports) module.exports = root.LoumooRouter;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
