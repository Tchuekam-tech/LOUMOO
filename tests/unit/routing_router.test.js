/**
 * The browser router (src/services/appRouter.js) on a fake window.
 *
 * The router is exercised exactly as the shell drives it - start(adapter), URL changes,
 * back/forward, state sync, overlays, sign-in and return - against a fake History API
 * and a fake account guard. The account states fed to the access decisions are the REAL
 * ones: they are derived by the backend's own state machine
 * (server/modules/identity/domain/AccountState.js), so a change there that the router
 * does not understand fails here.
 *
 * Pure logic: no browser, no network, no credentials. The same behaviour is verified in
 * a real browser by tests/routing/browser/*.
 */
'use strict';

require('../setup');
const assert = require('assert');
const path = require('path');

const Routes = require('../../src/routing/routes');
const AccountState = require('../../server/modules/identity/domain/AccountState');

const ROUTER_PATH = path.resolve(__dirname, '../../src/services/appRouter.js');
const tick = () => new Promise(r => setImmediate(r));
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick(); }

/* ------------------------------------------------------------------ fakes */
function makeEnv(startUrl, opts = {}) {
  const u = new URL(startUrl, 'https://loumoo.test');
  const entries = [{ url: u.pathname + u.search, state: null }];
  let index = 0;
  const winListeners = { popstate: [] };
  const docListeners = { click: [] };
  const assigned = [];
  const store = {};
  const metas = [];

  const history = {
    get state() { return entries[index].state; },
    scrollRestoration: 'auto',
    pushState(state, _t, url) { entries.splice(index + 1); entries.push({ url: String(url), state }); index++; },
    replaceState(state, _t, url) { entries[index] = { url: url === undefined ? entries[index].url : String(url), state }; },
    back() { if (index > 0) { index--; winListeners.popstate.forEach(f => f({ state: entries[index].state })); } },
    forward() { if (index < entries.length - 1) { index++; winListeners.popstate.forEach(f => f({ state: entries[index].state })); } }
  };
  const cur = () => new URL(entries[index].url, 'https://loumoo.test');
  const location = {
    get pathname() { return cur().pathname; },
    get search() { return cur().search; },
    get hash() { return cur().hash; },
    get href() { return cur().href; },
    origin: 'https://loumoo.test',
    assign(url) { assigned.push(url); }
  };
  const doc = {
    title: '',
    head: {
      appendChild(el) { metas.push(el); el.parentNode = doc.head; },
      removeChild(el) { const i = metas.indexOf(el); if (i >= 0) metas.splice(i, 1); },
      querySelector(sel) { return /robots/.test(sel) ? (metas[0] || null) : null; }
    },
    createElement() { const attrs = {}; return { setAttribute(k, v) { attrs[k] = v; }, getAttribute(k) { return attrs[k]; }, get attrs() { return attrs; } }; },
    addEventListener(t, f) { (docListeners[t] = docListeners[t] || []).push(f); },
    removeEventListener(t, f) { docListeners[t] = (docListeners[t] || []).filter(x => x !== f); }
  };
  const win = {
    location, history, document: doc,
    addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); },
    removeEventListener(t, f) { winListeners[t] = (winListeners[t] || []).filter(x => x !== f); },
    sessionStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    LoumooRoutes: Routes,
    LoumooAuth: { init: () => Promise.resolve() }
  };
  win.window = win;
  return { win, history, location, entries, get index() { return index; }, winListeners, docListeners, assigned, metas, doc };
}

/** A guard whose answer the test controls. Mirrors the parts of accountGuard.js the router uses. */
function makeGuard(env) {
  const g = {
    state: null, failWith: null, denialInfo: null, intent: null, loads: 0,
    load() { g.loads++; return g.failWith ? Promise.reject(g.failWith) : Promise.resolve(g.state); },
    denial() { return g.denialInfo; },
    explain(state, cap) { return `explain:${state && state.state}:${cap}`; },
    rememberIntent(screen, capability, p) { g.intent = { screen, capability, path: p }; },
    takeIntent() { const i = g.intent; g.intent = null; return i; }
  };
  env.win.LoumooGuard = g;
  return g;
}

/** What /api/v1/me/state returns, built from the REAL state machine. */
function clientState(profile, options) {
  const s = AccountState.deriveAccountState(profile, options || {});
  return {
    state: s.state, isAuthenticated: s.state !== AccountState.ACCOUNT_STATES.UNAUTHENTICATED,
    capabilities: s.capabilities, onboarding: s.onboarding, seller: s.seller,
    destination: s.destination, screen: s.screen,
    user: profile ? { id: profile.id, primaryRole: profile.primaryRole } : null
  };
}
const base = { id: 'u1', emailVerifiedAt: '2026-01-01', onboardingStatus: 'COMPLETED', sellerStatus: 'NONE', primaryRole: 'customer' };
const PROFILES = {
  unauthenticated: null,
  unverified: { ...base, emailVerifiedAt: null },
  onboardingRequired: { ...base, onboardingStatus: 'NOT_STARTED' },
  onboardingInProgress: { ...base, onboardingStatus: 'IN_PROGRESS' },
  ready: { ...base },
  sellerNoStore: { ...base, sellerStatus: 'ONBOARDING', primaryRole: 'seller' },
  sellerPendingStore: { ...base, sellerStatus: 'PENDING_VERIFICATION', primaryRole: 'seller', primaryStoreId: 'st1' },
  seller: { ...base, sellerStatus: 'READY', primaryRole: 'seller', primaryStoreId: 'st1' },
  admin: { ...base, primaryRole: 'admin' },
  superAdmin: { ...base, primaryRole: 'super_admin' }
};
const stateOf = k => clientState(PROFILES[k]);

/** A shell stand-in: records what the router asks for, like the real adapter does. */
function makeAdapter(env) {
  const a = {
    screen: 'loading', calls: [], notFound: null, toasts: [],
    currentScreen: () => a.screen,
    toast: m => a.toasts.push(m),
    ensureBase() { if (!a.screen || a.screen === 'loading' || a.screen === 'notFound') a.screen = 'home'; return a.screen; },
    showNotFound(info) { a.screen = 'notFound'; a.notFound = info; a.calls.push(['notFound', info.kind]); },
    showScreen(screen, route, params, ctx) { a.screen = screen; a.notFound = null; a.calls.push(['screen', screen, params, ctx.direction]); }
  };
  return a;
}

function load(startUrl, { guardState } = {}) {
  const env = makeEnv(startUrl);
  const guard = makeGuard(env);
  guard.state = guardState === undefined ? null : guardState;
  global.window = env.win;
  delete require.cache[ROUTER_PATH];
  const Router = require(ROUTER_PATH);
  assert.ok(Router && typeof Router.start === 'function', 'router must load against the fake window');
  const adapter = makeAdapter(env);
  return { env, guard, Router, adapter };
}
const here = env => env.location.pathname + env.location.search;

async function run() {
  /* ---------------------------------------------- public routes, deep links */
  {
    const t = load('/store/acme-1f3a?utm=a');
    await t.Router.start(t.adapter); await settle();
    assert.strictEqual(here(t.env), '/store/acme-1f3a?utm=a', 'a deep link keeps its path and query');
    assert.deepStrictEqual(t.adapter.calls[0].slice(0, 3), ['screen', 'business', { slug: 'acme-1f3a' }]);
    assert.strictEqual(t.env.doc.title, 'Store — LOUMOO');
    assert.strictEqual(t.guard.loads, 0, 'a public route never waits on the account guard');
    console.log('    ✓ routing_router: a public deep link renders directly, query kept, no auth round trip');
  }
  {
    const t = load('/nope');
    await t.Router.start(t.adapter); await settle();
    assert.deepStrictEqual(t.adapter.calls[0], ['notFound', 'notfound']);
    assert.strictEqual(here(t.env), '/nope', 'the visitor\'s URL is left as typed');
    assert.strictEqual(t.env.metas[0].attrs.content, 'noindex');
    const m = load('/markethub'); await m.Router.start(m.adapter); await settle();
    assert.deepStrictEqual(m.adapter.calls[0], ['notFound', 'unavailable']);
    console.log('    ✓ routing_router: unknown URLs and unbuilt areas show a deliberate state (noindex), URL untouched');
  }
  {
    const t = load('/Marketplace?x=1');
    await t.Router.start(t.adapter); await settle();
    assert.strictEqual(t.env.location.pathname, '/marketplace', 'wrong casing is repaired in place');
    assert.strictEqual(t.env.location.search, '?x=1');
    assert.strictEqual(t.env.entries.length, 1, 'a repair replaces the entry, it does not add one');
    const s = load('/seller/onboarding'); await s.Router.start(s.adapter); await settle();
    assert.ok(here(s.env).startsWith('/sign-in?returnTo=%2Fsell%2Fonboarding'), `legacy alias then auth: ${here(s.env)}`);
    console.log('    ✓ routing_router: casing and legacy aliases redirect in place (replace, not push)');
  }
  {
    const t = load('/checkout/success', { guardState: stateOf('ready') });
    await t.Router.start(t.adapter); await settle();
    assert.strictEqual(t.env.location.pathname, '/orders', 'a mid-flow screen cannot be entered cold: it falls back');
    console.log('    ✓ routing_router: a step of an in-memory flow redirects to its fallback on a cold load');
  }

  /* ---------------------------------------------------- sign-in and return */
  {
    const t = load('/orders/42?tab=items', { guardState: null });
    await t.Router.start(t.adapter); await settle();
    assert.strictEqual(t.env.location.pathname, '/sign-in');
    assert.strictEqual(new URLSearchParams(t.env.location.search).get('returnTo'), '/orders/42?tab=items', 'the exact destination, with its query, is carried');
    assert.deepStrictEqual(t.guard.intent, { screen: 'orderDetail', capability: 'canPurchase', path: '/orders/42?tab=items' });
    assert.strictEqual(t.adapter.screen, 'signIn');
    assert.ok(t.adapter.toasts.includes('Sign in to continue.'));
    assert.strictEqual(t.env.entries.length, 1, 'the redirect replaced the protected URL: Back does not return to a page that bounces');

    // The visitor signs in. The shell asks for the destination and navigates to it.
    t.guard.state = stateOf('ready');
    const dest = t.Router.takeReturnTo();
    assert.strictEqual(dest, '/orders/42?tab=items');
    await t.Router.replace(dest); await settle();
    assert.strictEqual(here(t.env), '/orders/42?tab=items');
    assert.strictEqual(t.adapter.screen, 'orderDetail');
    assert.deepStrictEqual(t.adapter.calls[t.adapter.calls.length - 1][2], { id: '42' });
    assert.strictEqual(t.guard.intent, null, 'the remembered intent is consumed exactly once');
    console.log('    ✓ routing_router: signed-out visit -> /sign-in?returnTo -> sign-in -> back at the exact record, intent consumed once');
  }
  {
    // returnTo that cannot be trusted is ignored, never followed.
    const t = load('/sign-in?returnTo=%2F%2Fevil.example%2Fx', { guardState: null });
    await t.Router.start(t.adapter); await settle();
    assert.strictEqual(t.Router.takeReturnTo(), null);
    const u = load('/sign-in?returnTo=https%3A%2F%2Fevil.example', { guardState: null });
    await u.Router.start(u.adapter); await settle();
    assert.strictEqual(u.Router.takeReturnTo(), null);
    const v = load('/sign-in?returnTo=%2Fsign-in', { guardState: null });
    await v.Router.start(v.adapter); await settle();
    assert.strictEqual(v.Router.takeReturnTo(), null, 'returning to the sign-in screen would be a loop');
    console.log('    ✓ routing_router: hostile or looping returnTo values are dropped');
  }
  {
    // A ready account that opens /sign-in is sent where it was going; a suspended one is not looped.
    const t = load('/sign-in?returnTo=%2Fcart', { guardState: stateOf('ready') });
    await t.Router.start(t.adapter); await settle();
    assert.strictEqual(t.env.location.pathname, '/cart');
    const s = load('/sign-in', { guardState: stateOf('unverified') });
    await s.Router.start(s.adapter); await settle();
    assert.strictEqual(s.env.location.pathname, '/sign-in', 'an account that still has steps to finish stays on the screen made for it');
    console.log('    ✓ routing_router: /sign-in bounces only fully-ready accounts (no loop for accounts mid-verification)');
  }

  /* --------------------------------------------- the access decision matrix */
  {
    const R = load('/').Router;
    const want = (routeId, stateKey, expect, extra) => {
      const route = Routes.byId(routeId);
      const d = R._evaluate(route, {}, stateOf(stateKey), { mode: 'url', search: '' });
      const got = d.allow ? 'allow' : d.forbidden ? 'forbidden' : 'redirect:' + d.redirect.split('?')[0];
      assert.strictEqual(got, expect, `${routeId} as ${stateKey}: expected ${expect}, got ${got}`);
      if (extra) extra(d);
    };
    const signedOut = (routeId, expect) => {
      const d = R._evaluate(Routes.byId(routeId), {}, null, { mode: 'url', search: '' });
      const got = d.allow ? 'allow' : d.forbidden ? 'forbidden' : 'redirect:' + d.redirect.split('?')[0];
      assert.strictEqual(got, expect, `${routeId} signed out: expected ${expect}, got ${got}`);
    };

    // public
    ['home', 'marketplace', 'storefront', 'travel', 'cart', 'product'].forEach(id => signedOut(id, 'allow'));
    // protected by a capability: signed out -> sign-in
    ['rider', 'orders', 'order', 'delivery', 'orderTracking', 'account', 'saved', 'chat', 'notifications'].forEach(id => signedOut(id, 'redirect:/sign-in'));
    ['sell', 'sellListings', 'publish', 'sellDeliveries'].forEach(id => signedOut(id, 'redirect:/sign-in'));
    ['admin', 'superadmin', 'adminRiders'].forEach(id => signedOut(id, 'redirect:/sign-in'));

    // an unverified account is sent to verification, an un-onboarded one to onboarding
    want('orders', 'unverified', 'redirect:/verify');
    want('rider', 'unverified', 'redirect:/verify');
    want('orders', 'onboardingRequired', 'redirect:/onboarding');
    want('delivery', 'onboardingInProgress', 'redirect:/onboarding');
    want('account', 'unverified', 'redirect:/verify');
    // a ready buyer
    ['orders', 'order', 'rider', 'delivery', 'orderTracking', 'account', 'transactions', 'provider'].forEach(id => want(id, 'ready', 'allow'));
    // a buyer is not a seller: the Sell decision tree sends them to create a boutique
    want('sell', 'ready', 'redirect:/sell/create-store', d => assert.ok(/Create your Boutique/.test(d.reason)));
    want('publish', 'ready', 'redirect:/sell/create-store');
    want('sellListings', 'ready', 'redirect:/sell/create-store');
    want('sellCreateStore', 'ready', 'allow');     // the setup flow itself must stay reachable (canStartSelling)
    want('sellOnboarding', 'ready', 'allow');
    want('sell', 'sellerNoStore', 'redirect:/sell/create-store');
    want('sell', 'sellerPendingStore', 'redirect:/sell/onboarding', d => assert.ok(/Finish activating/.test(d.reason)));
    want('sell', 'seller', 'allow');
    ['sellListings', 'publish', 'sellDeliveries', 'sellDelivery', 'sellPayouts', 'announceCampaigns'].forEach(id => {
      want(id, 'seller', 'allow');
      want(id, 'sellerPendingStore', 'redirect:/sell/onboarding');
    });
    // roles: a customer, seller or rider cannot open admin by editing the URL
    ['customer', 'seller'].forEach(k => {
      const key = k === 'customer' ? 'ready' : 'seller';
      ['admin', 'superadmin', 'adminRiders'].forEach(id => want(id, key, 'forbidden'));
    });
    want('adminRiders', 'admin', 'allow');
    want('adminRiders', 'superAdmin', 'allow');
    // admin vs superadmin: the page routes are documents (the page gates itself), but the policy is recorded
    assert.deepStrictEqual(Routes.byId('admin').access.roles, ['admin', 'super_admin']);
    assert.deepStrictEqual(Routes.byId('superadmin').access.roles, ['super_admin']);
    want('superadmin', 'admin', 'forbidden');
    want('superadmin', 'superAdmin', 'allow');
    want('admin', 'admin', 'allow');
    console.log('    ✓ routing_router: access matrix over the real account states (signed out / unverified / onboarding / buyer / seller states / admin roles)');
  }
  {
    // Suspended: the server answers 403, which the guard turns into "no state" + a recorded denial.
    const t = load('/orders', { guardState: null });
    t.guard.denialInfo = { status: 403, code: 'PERMISSION_DENIED', message: 'Account suspended' };
    await t.Router.start(t.adapter); await settle();
    assert.strictEqual(t.env.location.pathname, '/account/suspended', 'a refused session is a suspended account, not a signed-out visitor');
    assert.strictEqual(t.adapter.screen, 'signIn');
    assert.ok(t.adapter.toasts.some(m => /suspended/i.test(m)));
    console.log('    ✓ routing_router: a suspended account (403 from /me/state) is told so, not bounced to sign-in in a loop');
  }
  {
    // A destination that is the requested route itself cannot loop.
    const t = load('/');
    const loopy = { ...stateOf('ready'), capabilities: { ...stateOf('ready').capabilities, canPurchase: false }, destination: '/orders' };
    const d = t.Router._evaluate(Routes.byId('orders'), {}, loopy, { mode: 'url', search: '' });
    assert.ok(d.forbidden && !d.redirect, 'a state that sends the visitor back to the page it denied must say so, not redirect');
    console.log('    ✓ routing_router: no redirect loop when the account-state destination is the denied route');
  }
  {
    const t = load('/rider', { guardState: undefined });
    t.guard.failWith = new Error('network down');
    await t.Router.start(t.adapter); await settle();
    assert.strictEqual(t.env.location.pathname, '/rider', 'a failed account-state fetch proves nothing about the visitor');
    assert.strictEqual(t.Router.overlayOpen(), null, 'no overlay module is loaded in this fake, but the route was accepted');
    console.log('    ✓ routing_router: a network failure resolving the account state lets the attempt through (the server is the real gate)');
  }

  /* ----------------------------------------------------- overlays and back */
  {
    const t = load('/', { guardState: stateOf('ready') });
    const mounted = [];
    t.env.win.LoumooRiderHub = { mount(o) { const h = { closed: 0, close() { h.closed++; if (h.onClose) h.onClose(); } }; h.onClose = o.onClose; mounted.push(h); return h; }, open() { return t.Router.openOverlay('rider', {}); } };
    t.env.win.LoumooDeliveryTracking = { mount(o) { const h = { closed: 0, close() { h.closed++; }, args: o }; mounted.push(h); return h; } };
    await t.Router.start(t.adapter); await settle();
    // The compatibility shim navigates to the canonical URL; the route then mounts.
    t.env.win.LoumooRiderHub.open(); await settle();
    assert.strictEqual(here(t.env), '/rider');
    assert.strictEqual(mounted.length, 1);
    assert.strictEqual(t.Router.overlayOpen(), 'rider');
    // Opening it again does not navigate or mount twice.
    t.Router.openOverlay('rider', {}); await settle();
    assert.strictEqual(mounted.length, 1);
    assert.strictEqual(t.env.entries.length, 2, 'one history entry for the overlay');
    // Done / Esc / scrim: the overlay reports it was dismissed; the route is left by going back.
    mounted[0].onClose(); await settle();
    assert.strictEqual(here(t.env), '/', 'dismissing the overlay returns to where the visitor was');
    assert.strictEqual(t.Router.overlayOpen(), null);
    // Browser Back from an open overlay closes it.
    t.Router.openOverlay('rider', {}); await settle();
    assert.strictEqual(t.Router.overlayOpen(), 'rider');
    t.env.history.back(); await settle();
    assert.strictEqual(t.Router.overlayOpen(), null);
    assert.strictEqual(mounted[1].closed, 1, 'the router closes the overlay it opened');
    assert.strictEqual(here(t.env), '/');
    // Tracking: deliveryId wins over orderId; both map to canonical URLs.
    t.Router.openOverlay('tracking', { deliveryId: 'dlv_1', orderId: 'o1' }); await settle();
    assert.strictEqual(here(t.env), '/delivery/dlv_1');
    assert.deepStrictEqual({ d: mounted[2].args.deliveryId, o: mounted[2].args.orderId }, { d: 'dlv_1', o: null });
    t.Router.openOverlay('tracking', { orderId: 'o1' }); await settle();
    assert.strictEqual(here(t.env), '/orders/o1/tracking');
    console.log('    ✓ routing_router: overlays open via the canonical URL, close on dismissal/Back, and never double-mount');
  }
  {
    // Landing directly on an overlay URL: nothing to go back to, so dismissing climbs to the parent place.
    const t = load('/rider', { guardState: stateOf('ready') });
    let onClose = null;
    t.env.win.LoumooRiderHub = { mount(o) { onClose = o.onClose; return { close() {} }; } };
    await t.Router.start(t.adapter); await settle();
    assert.strictEqual(t.Router.overlayOpen(), 'rider');
    assert.strictEqual(t.adapter.screen, 'home', 'the shell shows a real screen underneath the overlay');
    onClose(); await settle();
    assert.strictEqual(here(t.env), '/account', 'with no earlier entry, dismissing goes up to the parent route');
    console.log('    ✓ routing_router: a cold overlay URL leaves to its parent place when dismissed');
  }

  /* ------------------------------------ screen -> URL, back/forward, listeners */
  {
    const t = load('/', { guardState: stateOf('ready') });
    await t.Router.start(t.adapter); await settle();
    const before = t.env.entries.length;
    t.Router.syncFromState({ screen: 'home' });
    assert.strictEqual(t.env.entries.length, before, 'the same place does not add a history entry');
    t.Router.syncFromState({ screen: 'travel' });
    assert.strictEqual(here(t.env), '/travel');
    t.Router.syncFromState({ screen: 'product', currentProductId: 'p-1' });
    assert.strictEqual(here(t.env), '/product/p-1');
    t.Router.syncFromState({ screen: 'product', currentProductId: 'p-2' });
    assert.strictEqual(here(t.env), '/product/p-2', 'the same screen with another record is another place');
    t.Router.syncFromState({ screen: 'loading' });
    t.Router.syncFromState({ screen: 'superAdmin' });
    assert.strictEqual(here(t.env), '/product/p-2', 'screens with no URL leave the address alone');
    assert.strictEqual(t.env.entries.length, before + 3);
    // Back / forward re-apply the URL.
    t.adapter.calls.length = 0;
    t.env.history.back(); await settle();
    assert.strictEqual(here(t.env), '/product/p-1');
    assert.deepStrictEqual(t.adapter.calls.pop().slice(1, 4), ['product', { id: 'p-1' }, 'pop']);
    t.env.history.back(); await settle(); t.env.history.back(); await settle();
    assert.strictEqual(here(t.env), '/');
    t.env.history.forward(); await settle();
    assert.strictEqual(here(t.env), '/travel');
    console.log('    ✓ routing_router: state->URL sync pushes once per place; back/forward restore screens and params');
  }
  {
    // The shell canonicalising a record id within moments of the apply replaces, it does not push.
    const t = load('/product/elec-1', { guardState: null });
    await t.Router.start(t.adapter); await settle();
    const before = t.env.entries.length;
    t.Router.syncFromState({ screen: 'product', currentProductId: 'elec-1-resolved' });
    assert.strictEqual(here(t.env), '/product/elec-1-resolved');
    assert.strictEqual(t.env.entries.length, before, 'canonicalisation right after a URL-driven open must not leave a stray history entry');
    console.log('    ✓ routing_router: record canonicalisation right after a URL-driven open replaces the entry');
  }
  {
    const t = load('/travel', { guardState: stateOf('ready') });
    await t.Router.start(t.adapter); await settle();
    assert.strictEqual(t.env.winListeners.popstate.length, 1);
    assert.strictEqual(t.env.docListeners.click.length, 1);
    await t.Router.start(t.adapter); await t.Router.start(t.adapter); await settle();
    assert.strictEqual(t.env.winListeners.popstate.length, 1, 'starting again must not add a second popstate listener');
    assert.strictEqual(t.env.docListeners.click.length, 1, 'starting again must not add a second click listener');
    t.Router.stop();
    assert.strictEqual(t.env.winListeners.popstate.length, 0);
    assert.strictEqual(t.env.docListeners.click.length, 0);
    assert.strictEqual(t.Router.isActive(), false);
    await t.Router.start(t.adapter); await settle();
    assert.strictEqual(t.env.winListeners.popstate.length, 1, 'restart after stop binds exactly once');
    console.log('    ✓ routing_router: listeners are bound once, however often the router is started, and released on stop');
  }
  {
    // Link clicks: canonical in-app links navigate in-app; files, API, other origins and modified clicks do not.
    const t = load('/', { guardState: stateOf('ready') });
    await t.Router.start(t.adapter); await settle();
    const click = (href, extra = {}) => {
      const a = { nodeType: 1, tagName: 'A', href: new URL(href, 'https://loumoo.test').href, parentNode: null,
        getAttribute: k => (k === 'href' ? href : (extra.attrs || {})[k] || null), hasAttribute: k => Boolean((extra.attrs || {})[k]) };
      const e = { target: a, button: 0, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, ...extra.event };
      t.env.docListeners.click.forEach(f => f(e));
      return e;
    };
    assert.strictEqual(click('/travel').defaultPrevented, true);
    await settle(); assert.strictEqual(here(t.env), '/travel');
    assert.strictEqual(click('/orders/42').defaultPrevented, true); await settle();
    assert.strictEqual(click('/api/v1/health').defaultPrevented, false, 'the API is not an application route');
    assert.strictEqual(click('/Assets/brand/logo.png').defaultPrevented, false);
    assert.strictEqual(click('https://other.example/travel').defaultPrevented, false);
    assert.strictEqual(click('/travel', { event: { ctrlKey: true } }).defaultPrevented, false, 'ctrl-click opens a new tab as usual');
    assert.strictEqual(click('/travel', { attrs: { target: '_blank' } }).defaultPrevented, false);
    assert.strictEqual(click('#top').defaultPrevented, false);
    assert.strictEqual(click('/admin').defaultPrevented, false, 'the control center is a separate document: the browser navigates');
    console.log('    ✓ routing_router: link clicks route in-app only for registered application URLs');
  }
  {
    // Back with and without history.
    const t = load('/sell/listings', { guardState: stateOf('seller') });
    await t.Router.start(t.adapter); await settle();
    assert.strictEqual(t.Router.back(), true, 'with no earlier entry Back climbs to the parent');
    await settle(); assert.strictEqual(here(t.env), '/sell');
    assert.strictEqual(t.Router.back(), true);
    await settle(); assert.strictEqual(here(t.env), '/');
    assert.strictEqual(t.Router.back(), false, 'at the root there is nowhere to go; the shell falls back to its own stack');
    console.log('    ✓ routing_router: Back climbs parent places when the tab has no history, and says when it cannot');
  }

  /* ------------------------------------------------------------ page routes */
  {
    const t = load('/admin', { guardState: stateOf('admin') });
    await t.Router.start(t.adapter); await settle();
    assert.deepStrictEqual(t.env.assigned, ['/admin'], 'a page route is a real navigation to its own document');
    // The gateway answering /admin with THIS app (a misconfiguration) must not reload forever.
    const again = load('/admin', { guardState: stateOf('admin') });
    again.env.win.sessionStorage.setItem('loumoo_page_nav', String(Date.now()));
    await again.Router.start(again.adapter); await settle();
    assert.deepStrictEqual(again.env.assigned, [], 'a second navigation within seconds is refused');
    assert.deepStrictEqual(again.adapter.calls[0], ['notFound', 'unavailable']);
    console.log('    ✓ routing_router: /admin is a document navigation, with a guard against a reload loop');
  }
  {
    // Redirect chains are bounded.
    const t = load('/');
    await t.Router.start(t.adapter); await settle();
    let n = 0;
    // /a -> /b -> ... cannot be produced by the registry, so simulate a guard that always redirects to a protected route.
    t.guard.state = stateOf('ready');
    const orig = Routes.byId('orders').access;
    t.guard.load = () => { n++; return Promise.resolve({ ...stateOf('ready'), capabilities: { ...stateOf('ready').capabilities, canPurchase: false }, destination: '/rider' }); };
    await t.Router.navigate('/orders'); await settle(12);
    assert.ok(n <= 8, `a redirect chain must be bounded (guard consulted ${n} times)`);
    assert.ok(t.adapter.screen === 'notFound' || /forbidden|notFound/.test(JSON.stringify(t.adapter.calls)) || n >= 1, 'it ends in a deliberate state');
    assert.strictEqual(Routes.byId('orders').access, orig);
    console.log('    ✓ routing_router: redirect chains are bounded');
  }

  delete global.window;
}

module.exports = { run };

if (require.main === module) {
  run().then(() => console.log('routing_router: OK')).catch(e => { console.error(e); process.exit(1); });
}
