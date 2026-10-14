/**
 * The route registry (src/routing/routes.js) - the single source of truth for the
 * frontend's URLs - is internally consistent and agrees with the two things it must
 * agree with: the shell's own screen list, and the backend's capability and role names.
 *
 * Pure logic: no browser, no network, no credentials.
 */
'use strict';

require('../setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const Routes = require('../../src/routing/routes');
const { capabilitiesFor, ACCOUNT_STATES } = require('../../server/modules/identity/domain/AccountState');
const { ROLES } = require('../../server/modules/identity/value-objects/Role');

const ROOT = path.resolve(__dirname, '../..');

function shellScreens() {
  const src = fs.readFileSync(path.join(ROOT, 'Commerce App.dc.html'), 'utf8');
  const m = /const SCREENS = \[([\s\S]*?)\];/.exec(src);
  assert.ok(m, 'could not find the SCREENS list in Commerce App.dc.html');
  return Array.from(m[1].matchAll(/'([A-Za-z]+)'/g)).map(x => x[1]);
}

function sampleParams(route) {
  const p = {};
  route.params.forEach(n => { p[n] = 'abc-123'; });
  return p;
}

async function run() {
  /* ---------------------------------------------------------- structure */
  const ids = Routes.routes.map(r => r.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'route ids must be unique');
  const paths = Routes.routes.map(r => r.path);
  assert.strictEqual(new Set(paths).size, paths.length, 'route paths must be unique');
  Routes.routes.forEach(r => {
    assert.ok(/^\/[a-z0-9\-/:A-Z]*$/.test(r.path), `${r.id}: path ${r.path} must be lower-case kebab segments and :params`);
    assert.ok(r.title, `${r.id} needs a title`);
    assert.ok(['screen', 'overlay', 'page', 'unavailable'].includes(r.kind), `${r.id}: unknown kind ${r.kind}`);
    if (r.parent) assert.ok(Routes.byId(r.parent), `${r.id}: parent '${r.parent}' is not a route`);
    if (r.fallback) assert.ok(Routes.byId(r.fallback), `${r.id}: fallback '${r.fallback}' is not a route`);
    if (r.direct === 'redirect') assert.ok(r.fallback, `${r.id}: direct:'redirect' needs a fallback`);
    if (r.kind === 'screen') assert.ok(r.screen, `${r.id}: a screen route names its screen`);
    if (r.kind === 'overlay') assert.ok(r.overlay, `${r.id}: an overlay route names its overlay`);
    if (r.kind === 'page') assert.ok(r.page && r.page.startsWith('/'), `${r.id}: a page route names its document`);
    if (r.kind === 'unavailable') assert.strictEqual(r.status, 'not-implemented', `${r.id}: unavailable areas say so`);
    // Every route parameter is either bound to shell state or consumed by an overlay.
    r.params.forEach(n => {
      const bound = r.bind && r.bind[n];
      const overlay = r.overlayArgs && r.overlayArgs.param === n;
      assert.ok(bound || overlay || r.kind === 'unavailable', `${r.id}: parameter :${n} is bound to nothing`);
    });
  });
  console.log(`    ✓ routing_registry: ${Routes.routes.length} routes are well-formed with unique ids and paths`);

  /* ------------------------------ every shell screen has a decision */
  const screens = shellScreens();
  const routed = new Set(Routes.routedScreens());
  const unrouted = Object.keys(Routes.unroutedScreens);
  screens.forEach(s => {
    assert.ok(routed.has(s) || unrouted.includes(s),
      `shell screen '${s}' has neither a route nor an entry in unroutedScreens (src/routing/routes.js)`);
  });
  routed.forEach(s => assert.ok(screens.includes(s), `route targets screen '${s}' that the shell does not have`));
  unrouted.forEach(s => {
    assert.ok(screens.includes(s), `unroutedScreens lists '${s}', which is not a shell screen`);
    assert.ok(!routed.has(s), `screen '${s}' is both routed and listed as unrouted`);
    assert.ok(Routes.unroutedScreens[s].length > 20, `unroutedScreens['${s}'] needs a real reason`);
  });
  console.log(`    ✓ routing_registry: all ${screens.length} shell screens are routed (${routed.size}) or deliberately unrouted (${unrouted.length})`);

  /* --------------------------- access policy uses real backend names */
  const everyCapability = new Set();
  Object.values(ACCOUNT_STATES).forEach(st => Object.keys(capabilitiesFor(st)).forEach(k => everyCapability.add(k)));
  const roles = Object.values(ROLES);
  Routes.routes.forEach(r => {
    const a = r.access;
    assert.ok(['public', 'capability', 'seller', 'role'].includes(a.kind), `${r.id}: unknown access kind`);
    if (a.kind === 'capability') assert.ok(everyCapability.has(a.capability), `${r.id}: capability '${a.capability}' does not exist in the backend`);
    if (a.kind === 'role') a.roles.forEach(role => assert.ok(roles.includes(role), `${r.id}: role '${role}' does not exist in the backend`));
  });
  console.log('    ✓ routing_registry: every capability and role named by an access policy exists in the backend');

  // The product areas the task names, by the canonical path.
  const canonical = {
    '/': 'home', '/marketplace': 'marketplace', '/markethub': 'markethub', '/store/:slug': 'storefront', '/sell': 'sell',
    '/rider': 'rider', '/delivery/:id': 'delivery', '/travel': 'travel', '/account': 'account', '/orders': 'orders',
    '/agency': 'agency', '/admin': 'admin', '/superadmin': 'superadmin'
  };
  Object.keys(canonical).forEach(p => {
    const r = Routes.routes.find(x => x.path === p);
    assert.ok(r && r.id === canonical[p], `canonical route ${p} must exist as '${canonical[p]}'`);
  });
  // MarketHub and agency are documented as NOT built: never served as if they were.
  ['markethub', 'agency'].forEach(id => {
    assert.strictEqual(Routes.byId(id).kind, 'unavailable', `${id} must stay 'unavailable' until a real product exists`);
    assert.ok(Routes.byId(id).notes.length > 30, `${id} must say why it is unavailable`);
  });
  console.log('    ✓ routing_registry: the 13 named areas exist; MarketHub and agency are honestly marked unavailable');

  /* ------------------------------------------------------------ resolving */
  const eq = (input, type, extra) => {
    const r = Routes.resolve(input);
    assert.strictEqual(r.type, type, `${input} -> expected ${type}, got ${r.type}`);
    if (extra) extra(r);
  };
  eq('/', 'route', r => assert.strictEqual(r.route.id, 'home'));
  eq('/rider', 'route', r => assert.strictEqual(r.route.id, 'rider'));
  eq('/rider/', 'route', r => assert.strictEqual(r.route.id, 'rider')); // trailing slash tolerated
  eq('/store/acme-1f3a', 'route', r => assert.deepStrictEqual(r.params, { slug: 'acme-1f3a' }));
  eq('/delivery/dlv_Ab12', 'route', r => assert.deepStrictEqual(r.params, { id: 'dlv_Ab12' }));
  eq('/orders/42/tracking', 'route', r => assert.strictEqual(r.route.id, 'orderTracking'));
  eq('/orders/42', 'route', r => assert.strictEqual(r.route.id, 'order'));
  eq('/hotels/voucher', 'route', r => assert.strictEqual(r.route.id, 'hotelVoucher')); // static beats :id
  eq('/hotels/h-9', 'route', r => assert.strictEqual(r.route.id, 'hotel'));
  eq('/announcements/campaigns', 'route', r => assert.strictEqual(r.route.id, 'announceCampaigns'));
  eq('/marketplace/category/fashion?x=1', 'route', r => assert.deepStrictEqual(r.params, { category: 'fashion' }));
  eq('/markethub', 'unavailable');
  eq('/agency', 'unavailable');
  eq('/nope', 'notfound');
  eq('/store', 'notfound');                 // a collection with no listing page of its own
  eq('/store/a/b', 'notfound');
  eq('/rider/extra', 'notfound');
  eq('/orders/42/', 'route');               // trailing slash
  eq('/src/services/riderHub.js', 'file');
  eq('/rider/src/services/riderHub.js', 'file'); // the nested-asset defect: a file, never a page
  eq('/Assets/brand/logo.png', 'file');
  eq('/store/a.b', 'file');                 // a dot makes it a file request, never a store
  eq('/store/%2e%2e', 'notfound');          // encoded traversal is not a slug
  eq('/store/%E0%A4%A', 'notfound');        // malformed percent-encoding
  eq('/store/' + 'a'.repeat(129), 'notfound'); // over-long id
  console.log('    ✓ routing_registry: resolve() - canonical, params, precedence, trailing slash, files, traversal, over-long ids');

  // Redirects: legacy aliases and casing, query strings kept.
  eq('/Rider', 'redirect', r => assert.strictEqual(r.to, '/rider'));
  eq('/RIDER?x=1', 'redirect', r => assert.strictEqual(r.to, '/rider?x=1'));
  eq('/Sell/Listings', 'redirect', r => assert.strictEqual(r.to, '/sell/listings'));
  eq('/index.html', 'redirect', r => assert.strictEqual(r.to, '/'));
  eq('/app?utm=a', 'redirect', r => assert.strictEqual(r.to, '/?utm=a'));
  eq('/Commerce%20App.dc.html', 'redirect', r => assert.strictEqual(r.to, '/'));
  eq('/seller/onboarding', 'redirect', r => assert.strictEqual(r.to, '/sell/onboarding'));
  eq('/seller/create-store', 'redirect', r => assert.strictEqual(r.to, '/sell/create-store'));
  Routes.aliases.forEach(a => {
    const t = Routes.resolve(a.to.replace(/:([A-Za-z]+)/g, 'abc-1'));
    assert.ok(t.type === 'route', `alias ${a.from} -> ${a.to} must land on a real route`);
  });
  // Parameterised aliases: the links the app used to generate for shared publications.
  eq('/listing/lst_9?utm=a', 'redirect', r => assert.strictEqual(r.to, '/product/lst_9?utm=a'));
  eq('/announce/spring-sale', 'redirect', r => assert.strictEqual(r.to, '/announcements/spring-sale'));
  eq('/Listing/lst_9', 'redirect', r => assert.strictEqual(r.to, '/product/lst_9'));
  eq('/listing', 'notfound');
  eq('/listing/a/b', 'notfound');
  eq('/listing/a.b', 'file');
  // The backend's account-state machine names its destinations in paths; every one must resolve.
  const { STATE_DESTINATION } = require('../../server/modules/identity/domain/AccountState');
  Object.entries(STATE_DESTINATION).forEach(([state, dest]) => {
    const r = Routes.resolve(dest);
    assert.ok(r.type === 'route' || r.type === 'redirect', `STATE_DESTINATION ${state} -> ${dest} has no route`);
  });
  console.log('    ✓ routing_registry: legacy aliases and casing redirect with the query kept; every backend STATE_DESTINATION resolves');

  /* ------------------------------------------------------------- building */
  Routes.routes.filter(r => r.kind !== 'unavailable').forEach(r => {
    const p = sampleParams(r);
    const built = Routes.build(r.id, p);
    assert.ok(built, `${r.id} must build`);
    const back = Routes.resolve(built);
    assert.strictEqual(back.type, 'route', `${r.id}: ${built} must resolve back to a route`);
    assert.strictEqual(back.route.id, r.id, `${r.id}: ${built} resolved to ${back.route && back.route.id}`);
    assert.deepStrictEqual(back.params, p, `${r.id}: params must round-trip`);
  });
  assert.strictEqual(Routes.build('storefront', {}), null, 'a missing parameter does not build');
  assert.strictEqual(Routes.build('storefront', { slug: 'a/b' }), null, 'a slash in a parameter does not build');
  assert.strictEqual(Routes.build('storefront', { slug: '../x' }), null, 'a traversal in a parameter does not build');
  assert.strictEqual(Routes.build('provider', { id: 'p1' }, { city: 'Douala' }), '/providers/p1?city=Douala');
  console.log('    ✓ routing_registry: build() round-trips with resolve() for every route and refuses unsafe parameters');

  /* ---------------------------------------------- screen -> URL (forState) */
  assert.strictEqual(Routes.forState('home', {}).path, '/');
  assert.strictEqual(Routes.forState('orderDetail', { currentOrder: { id: 'o9' } }).path, '/orders/o9');
  assert.strictEqual(Routes.forState('business', { currentStoreId: 'acme' }).path, '/store/acme');
  assert.strictEqual(Routes.forState('category', { activeCategorySlug: 'all' }).path, '/marketplace/categories');
  assert.strictEqual(Routes.forState('category', { activeCategorySlug: 'fashion' }).path, '/marketplace/category/fashion');
  assert.strictEqual(Routes.forState('signIn', {}).path, '/sign-in', 'the suspended alias must never be derived from state');
  const degraded = Routes.forState('business', {});
  assert.ok(degraded && degraded.degraded && degraded.path === '/stores', 'a parameterised screen with no value falls back to its listing, never to a lie');
  assert.strictEqual(Routes.forState('loading', {}), null);
  assert.strictEqual(Routes.forState('superAdmin', {}), null, 'the unreachable legacy admin prototype gets no URL');
  console.log('    ✓ routing_registry: forState() maps shell state to the right URL, with safe fallbacks');

  /* ---------------------------------------------------- returnTo is safe */
  const ok = p => Routes.safeReturnTo(p);
  assert.strictEqual(ok('/orders/42?x=1'), '/orders/42?x=1');
  assert.strictEqual(ok('/Rider'), '/rider', 'a wrong-case return path is repaired, not rejected');
  [
    '//evil.example/x', '/\\evil.example', 'https://evil.example/', 'javascript:alert(1)', '/sign-in', '/verify', '/onboarding',
    '/nope', '/markethub', 'orders', '', null, undefined, 42, '/orders\n/x', '/orders\u0000', '/' + 'a'.repeat(3000),
    '/store/a/b', '/account/suspended'
  ].forEach(bad => assert.strictEqual(ok(bad), null, `returnTo ${JSON.stringify(bad)} must be rejected`));
  assert.strictEqual(ok('/orders?next=//evil.example'), '/orders?next=//evil.example'.replace('//evil.example', '//evil.example'),
    'a query string is data, not a destination');
  console.log('    ✓ routing_registry: safeReturnTo() accepts only same-origin registered non-auth paths (no open redirect, no loop)');

  /* -------------------------------------- the page documents are real files */
  Routes.routes.filter(r => r.kind === 'page').forEach(r => {
    const f = path.join(ROOT, 'SuperAdmin', 'frontend', r.page.replace('/superadmin/', ''));
    assert.ok(fs.existsSync(f), `${r.id}: ${r.page} must exist in SuperAdmin/frontend`);
  });
  console.log('    ✓ routing_registry: the control-center document the page routes serve exists');
}

module.exports = { run };

if (require.main === module) {
  run().then(() => console.log('routing_registry: OK')).catch(e => { console.error(e); process.exit(1); });
}
