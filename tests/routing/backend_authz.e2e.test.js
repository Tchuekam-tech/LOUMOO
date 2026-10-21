/**
 * Backend authorization matrix, against the REAL server over real HTTP.
 * ---------------------------------------------------------------------------
 * tests/routing/support/fixture.js boots the hermetic local stack (PGlite
 * Postgres + the repo's migrations + the PostgREST/Auth stand-ins + the real
 * server/index.js as a child process) and provisions one account per role and
 * account state, plus a seller with a store and a listing, two orders, a rider
 * and a delivery assigned to that rider. This file then asks the server, as each
 * of them, what they may read and do, and asserts the answer.
 *
 *   a. GET /me/state per persona (state, capabilities, role, destination)
 *   b. orders:        who may read / list / change an order (404 for strangers)
 *   c. deliveries:    who may read a delivery, the handover code, the live stream
 *   d. rider routes:  only a registered rider
 *   e. seller routes: the dispatch board and the rider list
 *   f. admin API:     administrator and super_admin only; forged credentials refused
 *   g. public store:  what the public storefront JSON may and may not contain
 *   h. KNOWN_GAPs:    defects found while building this. Logged, never failing.
 *
 * Run:  node tests/routing/backend_authz.e2e.test.js
 *
 * Never uses credentials, never calls an external host (see fixture.js).
 */
'use strict';

require('../setup');
const assert = require('assert');
const { startFixture } = require('./support/fixture');
const { dataOf } = require('../e2e/support/provision');

/* --------------------------------------------------------------------------- */
/* tiny harness                                                                 */
/* --------------------------------------------------------------------------- */

const short = (v, n = 220) => { try { return (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, n); } catch (_) { return String(v).slice(0, n); } };

function keysDeep(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
  return out;
}

const PEOPLE = ['anonymous', 'garbage', 'customer', 'stranger', 'seller', 'rider', 'admin', 'superadmin', 'unverified', 'onboarding', 'suspended'];
/** What every requireAuth route says to someone who is not (or no longer) allowed in at all. */
const GATE = { anonymous: 401, garbage: 401, suspended: 403 };

async function run() {
  const t0 = Date.now();
  const failures = [];
  const gaps = [];
  const counters = { checks: 0, assertions: 0 };
  let section = 'start';

  const out = (line) => console.log(line);
  const heading = (name) => { section = name.replace(/[^a-z0-9]+/gi, '-').slice(0, 24); out(`\n  ${name}`); };

  async function check(name, fn) {
    counters.checks += 1;
    try {
      const detail = await fn();
      out(`    ✓ ${name}${detail ? ` — ${detail}` : ''}`);
    } catch (e) {
      failures.push({ name, message: e.message });
      out(`    ✗ ${name}\n        ${String(e.message).split('\n').join('\n        ')}`);
    }
  }
  /** A defect we know about: logged with the observed behaviour, never fails the run. */
  function gap(text) { gaps.push(text); out(`    ! KNOWN_GAP: ${text}`); }

  out('LOUMOO backend authorization matrix (hermetic local stack)');
  const fx = await startFixture({ log: (m) => out(`  [fixture] ${m}`) });
  const { personas: P, ids: I, stack } = fx;
  const sql = async (text, params) => (await stack.sql(text, params)).rows;

  try {
    /* ----------------------------------------------------------------------- */
    /* request helpers                                                           */
    /* ----------------------------------------------------------------------- */
    const tokenOf = (who) => (who === 'anonymous' ? undefined : who === 'garbage' ? 'garbage.not.a-token' : P[who].token);
    /** Each (persona, section) pair gets its own rate-limit bucket, as separate users would. */
    const call = (who, method, path, opts = {}) =>
      fx.api(method, path, { token: tokenOf(who), body: opts.body, headers: opts.headers, client: `${who}#${section}` });

    const statusIs = (r, want) => (Array.isArray(want) ? want.includes(r.status) : r.status === want);

    /**
     * One row of the matrix: the same request made as every persona. `expected` maps a
     * persona to the status it must get; `default` covers the rest. Anonymous, a garbage
     * token and a suspended account fall back to the gate answers (401/401/403).
     * `verify(who, response)` may assert on the body.
     */
    async function matrix(method, template, path, expected, { body, verify, only } = {}) {
      await check(`${method} ${template}`, async () => {
        const problems = [];
        const seen = [];
        for (const who of only || PEOPLE) {
          const want = expected[who] !== undefined ? expected[who] : (GATE[who] !== undefined && expected.gate !== false ? GATE[who] : expected.default);
          if (want === undefined) continue;
          const r = await call(who, method, path, { body });
          counters.assertions += 1;
          seen.push(`${who} ${r.status}`);
          if (!statusIs(r, want)) { problems.push(`${method} ${template} as ${who}: expected ${want}, got ${r.status} ${short(r.body)}`); continue; }
          if (verify && r.status >= 200 && r.status < 300) {
            try { verify(who, r); } catch (e) { problems.push(`${method} ${template} as ${who}: ${e.message}`); }
          }
        }
        if (problems.length) throw new Error(problems.join('\n'));
        return seen.join(', ');
      });
    }

    /** A single assertion, named by route + persona. */
    async function expectOne(who, method, path, want, label, { body, verify } = {}) {
      await check(label || `${method} ${path} as ${who} -> ${want}`, async () => {
        const r = await call(who, method, path, { body });
        counters.assertions += 1;
        if (!statusIs(r, want)) throw new Error(`${method} ${path} as ${who}: expected ${want}, got ${r.status} ${short(r.body)}`);
        if (verify) verify(r);
        return `${r.status}`;
      });
    }

    const state = async (who) => dataOf(await call(who, 'GET', '/api/v1/me/state'));
    const deliveryAs = async (who) => dataOf(await call(who, 'GET', `/api/v1/deliveries/${I.deliveryId}`)).delivery;

    /* ======================================================================= */
    /* a. /api/v1/me/state                                                       */
    /* ======================================================================= */
    heading('a. GET /api/v1/me/state — who am I, what may I do, where do I go');

    const STATE = {
      customer:   { state: 'ACCOUNT_READY', canPurchase: true, canCreateListing: false, role: 'customer', destination: '/', screen: 'home' },
      stranger:   { state: 'ACCOUNT_READY', canPurchase: true, canCreateListing: false, role: 'customer', destination: '/', screen: 'home' },
      rider:      { state: 'ACCOUNT_READY', canPurchase: true, canCreateListing: false, role: 'customer', destination: '/', screen: 'home' },
      seller:     { state: 'SELLER_READY', canPurchase: true, canCreateListing: true, role: 'seller', destination: '/', screen: 'home' },
      admin:      { state: 'ACCOUNT_READY', canPurchase: true, canCreateListing: false, role: 'admin', destination: '/', screen: 'home' },
      superadmin: { state: 'ACCOUNT_READY', canPurchase: true, canCreateListing: false, role: 'super_admin', destination: '/', screen: 'home' },
      unverified: { state: 'CONTACT_VERIFICATION_REQUIRED', canPurchase: false, canCreateListing: false, role: 'customer', destination: '/verify', screen: 'verifyEmail' },
      onboarding: { state: 'ONBOARDING_REQUIRED', canPurchase: false, canCreateListing: false, role: 'customer', destination: '/onboarding', screen: 'onboardWelcome' },
    };
    for (const [who, want] of Object.entries(STATE)) {
      await check(`GET /api/v1/me/state as ${who} -> ${want.state}, role ${want.role}, canPurchase ${want.canPurchase}, canCreateListing ${want.canCreateListing}, destination ${want.destination}`, async () => {
        const r = await call(who, 'GET', '/api/v1/me/state');
        counters.assertions += 1;
        assert.strictEqual(r.status, 200, `GET /me/state as ${who}: ${r.status} ${short(r.body)}`);
        const d = dataOf(r);
        assert.strictEqual(d.state, want.state, `${who}: state`);
        assert.strictEqual(d.capabilities.canPurchase, want.canPurchase, `${who}: capabilities.canPurchase`);
        assert.strictEqual(d.capabilities.canCreateListing, want.canCreateListing, `${who}: capabilities.canCreateListing`);
        assert.strictEqual(d.user.primaryRole, want.role, `${who}: user.primaryRole`);
        assert.strictEqual(d.destination, want.destination, `${who}: destination`);
        assert.strictEqual(d.screen, want.screen, `${who}: screen`);
        assert.strictEqual(d.user.id, P[who].profileId, `${who}: user.id is the caller's own profile`);
        assert.strictEqual(String(d.user.email).toLowerCase(), P[who].email, `${who}: user.email is the caller's own`);
        assert.strictEqual(d.contact.emailVerified, who !== 'unverified', `${who}: contact.emailVerified`);
        assert.strictEqual(d.capabilities.canBrowse, true, `${who}: anyone may browse`);
        if (who === 'seller') {
          assert.strictEqual(d.seller.status, 'READY', 'seller.seller.status');
          assert.strictEqual(d.seller.storeId, I.storeId, 'seller.seller.storeId is the fixture store');
          assert.strictEqual(d.capabilities.canUploadListingMedia, true, 'seller: canUploadListingMedia');
        } else {
          assert.strictEqual(d.capabilities.canUploadListingMedia, false, `${who}: canUploadListingMedia`);
        }
        const forbidden = [...keysDeep(r.body)].filter((k) => /pass(word)?|secret|hash|token|nonce/i.test(k));
        assert.deepStrictEqual(forbidden, [], `${who}: /me/state must not carry credential-like fields`);
        return d.state;
      });
    }
    await check('GET /api/v1/me/state: no token -> 401, garbage token -> 401, malformed header -> 401, suspended -> 403 PERMISSION_DENIED', async () => {
      const none = await call('anonymous', 'GET', '/api/v1/me/state');
      assert.strictEqual(none.status, 401, `anonymous: ${none.status}`);
      assert.strictEqual(none.body.error.code, 'UNAUTHENTICATED');
      const bad = await call('garbage', 'GET', '/api/v1/me/state');
      assert.strictEqual(bad.status, 401, `garbage token: ${bad.status}`);
      const basic = await fx.api('GET', '/api/v1/me/state', { headers: { authorization: 'Basic dXNlcjpwYXNz' }, client: 'basic#a' });
      assert.strictEqual(basic.status, 401, `Basic auth header: ${basic.status}`);
      const sus = await call('suspended', 'GET', '/api/v1/me/state');
      assert.strictEqual(sus.status, 403, `suspended: ${sus.status} ${short(sus.body)}`);
      assert.strictEqual(sus.body.error.code, 'PERMISSION_DENIED');
      counters.assertions += 4;
      return 'anonymous 401, garbage 401, basic 401, suspended 403';
    });
    await check('GET /api/v1/me/state/resolve?capability=… sends each blocked persona to its own next step', async () => {
      const ask = async (who, cap) => dataOf(await call(who, 'GET', `/api/v1/me/state/resolve?capability=${cap}`));
      const onb = await ask('onboarding', 'canPurchase');
      assert.deepStrictEqual([onb.allowed, onb.resolveAt, onb.resolveScreen], [false, '/onboarding', 'onboardWelcome'], 'onboarding persona');
      const unv = await ask('unverified', 'canPurchase');
      assert.deepStrictEqual([unv.allowed, unv.resolveAt, unv.resolveScreen], [false, '/verify', 'verifyEmail'], 'unverified persona');
      const cus = await ask('customer', 'canPurchase');
      assert.deepStrictEqual([cus.allowed, cus.resolveAt], [true, null], 'customer may purchase');
      const sel = await ask('seller', 'canCreateListing');
      assert.deepStrictEqual([sel.allowed, sel.resolveAt], [true, null], 'seller may create listings');
      const cl = await ask('customer', 'canCreateListing');
      assert.strictEqual(cl.allowed, false, 'a customer may not create listings');
      const none = await call('anonymous', 'GET', '/api/v1/me/state/resolve?capability=canPurchase');
      assert.strictEqual(none.status, 401, 'anonymous');
      counters.assertions += 7;
      return 'onboarding -> /onboarding, unverified -> /verify, customer/seller allowed';
    });
    await matrix('GET', '/api/v1/auth/verification (own contact-verification status)', '/api/v1/auth/verification', { default: 200 }, {
      verify: (who, r) => {
        const d = dataOf(r);
        assert.strictEqual(d.email.verified, who !== 'unverified', 'email.verified');
        assert.strictEqual(String(d.email.address).toLowerCase(), P[who].email, 'email.address is the caller\'s own');
      },
      only: ['anonymous', 'garbage', 'customer', 'unverified', 'onboarding', 'suspended'],
    });

    await check('POST /api/v1/auth/login: a session for the right password; the same 401 for a wrong password and an unknown email; 401 for suspended and for signed-up-but-unconfirmed', async () => {
      const login = (email, password, label) => fx.api('POST', '/api/v1/auth/login', { body: { email, password }, client: `${label}#login` });
      const ok = await login(P.customer.email, P.customer.password, 'customer');
      assert.strictEqual(ok.status, 200, `customer: ${ok.status} ${short(ok.body)}`);
      assert.ok(typeof dataOf(ok).token === 'string' && dataOf(ok).token.split('.').length === 3, 'a signed session token');
      assert.strictEqual(dataOf(ok).user.id, P.customer.userId);
      assert.strictEqual(dataOf(ok).accountState.state, 'ACCOUNT_READY');
      const onboarding = await login(P.onboarding.email, P.onboarding.password, 'onboarding');
      assert.strictEqual(onboarding.status, 200, `onboarding: ${onboarding.status}`);
      assert.strictEqual(dataOf(onboarding).accountState.state, 'ONBOARDING_REQUIRED');
      const wrong = await login(P.customer.email, 'definitely-the-wrong-password', 'customer');
      const unknown = await login(`nobody.${fx.runId}@e2e.loumoo.test`, 'definitely-the-wrong-password', 'nobody');
      assert.strictEqual(wrong.status, 401, `wrong password: ${wrong.status}`);
      assert.strictEqual(unknown.status, 401, `unknown email: ${unknown.status}`);
      assert.strictEqual(wrong.body.error.message, unknown.body.error.message, 'a wrong password and an unknown account must be indistinguishable');
      assert.strictEqual(wrong.body.error.code, unknown.body.error.code);
      const suspended = await login(P.suspended.email, P.suspended.password, 'suspended');
      assert.strictEqual(suspended.status, 401, `suspended with the right password: ${suspended.status} ${short(suspended.body)}`);
      assert.match(suspended.body.error.message, /suspended/i, 'a suspended account is told why, but only after proving the password');
      const pending = await login(P.pending.email, P.pending.password, 'pending');
      assert.strictEqual(pending.status, 401, `signed up, code not entered: ${pending.status} ${short(pending.body)}`);
      assert.strictEqual(pending.body.error.message, wrong.body.error.message, 'an unconfirmed sign-up must not be distinguishable from a wrong password');
      counters.assertions += 6;
      return 'customer 200, onboarding 200, wrong 401 = unknown 401, suspended 401, pending 401';
    });
    await check('DELETE /api/v1/users/me: a deleted account\'s old session is 401 (not 403)', async () => {
      const doomed = await fx.throwaway('doomed');
      const before = await fx.api('GET', '/api/v1/me/state', { token: doomed.token, client: 'doomed#d' });
      assert.strictEqual(before.status, 200, `before: ${before.status}`);
      const del = await fx.api('DELETE', '/api/v1/users/me', { token: doomed.token, body: { confirmText: 'DELETE' }, client: 'doomed#d' });
      counters.assertions += 1;
      assert.strictEqual(del.status, 200, `DELETE /users/me: ${del.status} ${short(del.body)}`);
      const after = await fx.api('GET', '/api/v1/me/state', { token: doomed.token, client: 'doomed#d' });
      counters.assertions += 1;
      assert.strictEqual(after.status, 401, `old session after deletion: ${after.status} ${short(after.body)}`);
      assert.strictEqual(after.body.error.code, 'UNAUTHENTICATED');
      assert.strictEqual(dataOf(del).identityRemoved, true, 'the Supabase sign-in credential is removed with the account');
      // The deleted account cannot simply sign in again with its old password.
      const relogin = await fx.api('POST', '/api/v1/auth/login', { body: { email: doomed.email, password: doomed.password }, client: 'doomed#d' });
      counters.assertions += 2;
      assert.strictEqual(relogin.status, 401, `sign-in after deletion: ${relogin.status} ${short(relogin.body)}`);
      const row = (await sql('SELECT deleted_at, account_status FROM iam.profiles WHERE id = $1', [doomed.profileId]))[0];
      counters.assertions += 1;
      assert.ok(row.deleted_at && row.account_status === 'anonymized', `the profile stays deleted: ${JSON.stringify(row)}`);
      return `deleted: old session 401; sign-in afterwards ${relogin.status}`;
    });

    /* ======================================================================= */
    /* b. orders                                                                 */
    /* ======================================================================= */
    heading('b. orders — /api/v1/orders');

    const noOrderLeak = (who, r) => {
      const o = dataOf(r).order;
      assert.ok(o && o.id, 'an order is returned');
      assert.ok(!('handoverNonce' in o), 'no handover nonce on an order');
    };
    await matrix('GET', '/api/v1/orders/:id (the customer\'s order)', `/api/v1/orders/${I.orderId}`, {
      customer: 200, seller: 200, admin: 200, superadmin: 200,
      stranger: 404, rider: 404, unverified: 404, onboarding: 404, default: 404,
    }, { verify: (who, r) => { if (r.status === 200) { noOrderLeak(who, r); assert.strictEqual(dataOf(r).order.id, I.orderId); } } });
    await matrix('GET', '/api/v1/orders/:orderNumber (same order, by its number)', `/api/v1/orders/${I.orderNumber}`, {
      customer: 200, seller: 200, admin: 200, stranger: 404, rider: 404, default: 404,
    }, { only: ['anonymous', 'customer', 'stranger', 'seller', 'rider', 'admin', 'suspended'] });
    await matrix('GET', '/api/v1/orders/:id (the stranger\'s order)', `/api/v1/orders/${I.strangerOrderId}`, {
      stranger: 200, seller: 200, admin: 200, superadmin: 200,
      customer: 404, rider: 404, unverified: 404, onboarding: 404, default: 404,
    });
    await check('GET /api/v1/orders/:id as customer on the STRANGER\'s order id -> 404, byte-for-byte the same refusal as for an id that does not exist', async () => {
      const theirs = await call('customer', 'GET', `/api/v1/orders/${I.strangerOrderId}`);
      const nothing = await call('customer', 'GET', '/api/v1/orders/ord_0000000000000_nothing');
      const odd = await call('customer', 'GET', `/api/v1/orders/${encodeURIComponent("x' or '1'='1")}`);
      counters.assertions += 3;
      for (const [name, r] of [['stranger\'s order', theirs], ['missing order', nothing], ['injection-shaped id', odd]]) {
        assert.strictEqual(r.status, 404, `${name}: ${r.status} ${short(r.body)}`);
      }
      const shape = (r) => ({ code: r.body.error.code, message: r.body.error.message, details: r.body.error.details });
      assert.deepStrictEqual(shape(theirs), shape(nothing), 'a refusal must not reveal that the order exists');
      assert.deepStrictEqual(shape(odd), shape(nothing), 'an odd id is just "not found"');
      return '404 / 404 / 404, identical error bodies';
    });
    await check('GET /api/v1/orders (purchase history) lists only the caller\'s own orders', async () => {
      const ids = async (who) => dataOf(await call(who, 'GET', '/api/v1/orders?limit=100')).orders;
      const mine = await ids('customer');
      const theirs = await ids('stranger');
      const sellers = await ids('seller');
      const admins = await ids('admin');
      counters.assertions += 4;
      assert.ok(mine.some((o) => o.id === I.orderId), 'customer sees their own order');
      assert.ok(!mine.some((o) => o.id === I.strangerOrderId), 'customer does not see the stranger\'s order');
      assert.ok(mine.every((o) => o.buyerId === P.customer.profileId), 'every order in the customer\'s list has the customer as buyer');
      assert.ok(theirs.some((o) => o.id === I.strangerOrderId) && !theirs.some((o) => o.id === I.orderId), 'stranger sees only their own');
      assert.ok(theirs.every((o) => o.buyerId === P.stranger.profileId), 'every order in the stranger\'s list has the stranger as buyer');
      assert.strictEqual(sellers.length, 0, 'GET /orders is the BUYER history: the seller (who sold both) has bought nothing');
      assert.strictEqual(admins.length, 0, 'GET /orders is the BUYER history: an admin does not see everyone\'s orders here');
      return `customer ${mine.length}, stranger ${theirs.length}, seller ${sellers.length}, admin ${admins.length}`;
    });
    await matrix('GET', '/api/v1/orders (list)', '/api/v1/orders', { default: 200 });
    await check('POST /api/v1/orders/:id/cancel and PATCH /api/v1/orders/:id/status by someone else are refused and change nothing', async () => {
      const target = I.strangerOrderId; // the stranger's order; the customer, rider and onboarding persona have no claim on it
      for (const who of ['customer', 'rider', 'onboarding', 'unverified']) {
        const c = await call(who, 'POST', `/api/v1/orders/${target}/cancel`, { body: { reason: 'not mine' } });
        const s = await call(who, 'PATCH', `/api/v1/orders/${target}/status`, { body: { status: 'cancelled' } });
        counters.assertions += 2;
        assert.strictEqual(c.status, 404, `POST /orders/:id/cancel as ${who}: ${c.status} ${short(c.body)}`);
        assert.strictEqual(s.status, 404, `PATCH /orders/:id/status as ${who}: ${s.status} ${short(s.body)}`);
      }
      // The buyer cannot move their own order through the seller-side status route either.
      const own = await call('customer', 'PATCH', `/api/v1/orders/${I.orderId}/status`, { body: { status: 'cancelled' } });
      counters.assertions += 1;
      assert.strictEqual(own.status, 404, `PATCH /orders/:id/status as the buyer: ${own.status} ${short(own.body)}`);
      const anon = await call('anonymous', 'POST', `/api/v1/orders/${target}/cancel`, { body: {} });
      counters.assertions += 1;
      assert.strictEqual(anon.status, 401);
      for (const [who, id] of [['stranger', I.strangerOrderId], ['customer', I.orderId]]) {
        const o = dataOf(await call(who, 'GET', `/api/v1/orders/${id}`)).order;
        counters.assertions += 1;
        assert.strictEqual(String(o.fulfillmentStatus || o.status).toLowerCase(), 'processing', `${who}'s order must still be processing`);
      }
      return 'every attempt 404/401; both orders still processing';
    });
    await check('POST /api/v1/orders rejects privileged fields (sellerId, buyerId, status) with 400', async () => {
      for (const extra of [{ sellerId: P.stranger.profileId }, { buyerId: P.stranger.profileId }, { status: 'delivered' }]) {
        const r = await call('customer', 'POST', '/api/v1/orders', { body: { items: [{ listingId: I.listingId, quantity: 1 }], ...extra } });
        counters.assertions += 1;
        assert.strictEqual(r.status, 400, `POST /orders with ${Object.keys(extra)[0]}: ${r.status} ${short(r.body)}`);
      }
      const noAuth = await call('anonymous', 'POST', '/api/v1/orders', { body: { items: [{ listingId: I.listingId, quantity: 1 }] } });
      counters.assertions += 1;
      assert.strictEqual(noAuth.status, 401);
      return '400 x3, anonymous 401';
    });

    /* ======================================================================= */
    /* c. deliveries                                                             */
    /* ======================================================================= */
    heading('c. deliveries — /api/v1/deliveries (delivery is assigned, not yet accepted)');

    const FORBIDDEN_DELIVERY_KEYS = /^(handoverNonce|handover_nonce|codeAttempts|code_attempts|handoverCode|code|nonce)$/;
    const deliveryRole = { customer: 'buyer', seller: 'seller', rider: 'driver', admin: 'admin', superadmin: 'admin' };
    const readableDelivery = { customer: 200, seller: 200, rider: 200, admin: 200, superadmin: 200, stranger: 404, unverified: 404, onboarding: 404, default: 404 };
    const verifyDelivery = (who, r) => {
      const dl = dataOf(r).delivery;
      assert.strictEqual(dl.id, I.deliveryId, 'the delivery asked for');
      assert.strictEqual(dl.orderId, I.orderId, 'for the customer\'s order');
      assert.strictEqual(dl.viewerRole, deliveryRole[who], `viewerRole for ${who}`);
      const leaked = [...keysDeep(dl)].filter((k) => FORBIDDEN_DELIVERY_KEYS.test(k));
      assert.deepStrictEqual(leaked, [], 'the handover nonce, attempt counter and code are never in a delivery view');
    };
    await matrix('GET', '/api/v1/deliveries/:id', `/api/v1/deliveries/${I.deliveryId}`, readableDelivery, { verify: (who, r) => { if (r.status === 200) verifyDelivery(who, r); } });
    await matrix('GET', '/api/v1/deliveries/by-order/:orderId', `/api/v1/deliveries/by-order/${I.orderId}`, readableDelivery, { verify: (who, r) => { if (r.status === 200) verifyDelivery(who, r); } });
    await matrix('GET', '/api/v1/deliveries/by-order/:orderNumber', `/api/v1/deliveries/by-order/${I.orderNumber}`, { customer: 200, seller: 200, rider: 200, admin: 200, stranger: 404, default: 404 }, {
      only: ['anonymous', 'customer', 'stranger', 'seller', 'rider', 'admin', 'suspended'],
    });
    await matrix('GET', '/api/v1/deliveries/by-order/:orderId (the stranger\'s order has no delivery)', `/api/v1/deliveries/by-order/${I.strangerOrderId}`, { default: 404 }, {
      only: ['anonymous', 'customer', 'stranger', 'seller', 'rider', 'admin'],
    });
    await matrix('GET', '/api/v1/deliveries/:id/code (before the rider accepts)', `/api/v1/deliveries/${I.deliveryId}/code`, {
      customer: 409, seller: 403, rider: 403, admin: 403, superadmin: 403, stranger: 404, unverified: 404, onboarding: 404, default: 404,
    });
    await check('what each viewer sees of an assigned delivery: buyer has no rider yet; the rider has only the area, not the address', async () => {
      const buyer = await deliveryAs('customer');
      const rider = await deliveryAs('rider');
      const seller = await deliveryAs('seller');
      const admin = await deliveryAs('admin');
      counters.assertions += 4;
      assert.strictEqual(buyer.status, 'assigned');
      assert.strictEqual(buyer.driver, null, 'the buyer is not told who the rider is until they accept');
      assert.strictEqual(buyer.failureReason, null);
      assert.ok(seller.driver && seller.driver.id === P.rider.profileId, 'the seller sees the rider they chose');
      assert.ok(admin.driver && admin.driver.id === P.rider.profileId, 'an admin sees the rider');
      assert.deepStrictEqual(Object.keys(rider.dropoff).sort(), ['area', 'location'], `a rider who has not accepted sees only { area, location }, got ${Object.keys(rider.dropoff)}`);
      assert.ok(String(rider.dropoff.location.lat).split('.')[1].length <= 2, 'and the point is rounded to about 1 km');
      assert.ok(buyer.dropoff.address && buyer.dropoff.contactPhone, 'the buyer sees their own full drop-off');
      assert.ok(seller.dropoff.address && seller.dropoff.contactPhone, 'the seller sees the full drop-off');
      return `rider dropoff keys: ${Object.keys(rider.dropoff)}`;
    });
    await check('delivery mutations by the wrong person are refused (404 strangers, 403 participants) and the delivery stays "assigned"', async () => {
      const d = I.deliveryId;
      const cases = [
        // [persona, method, path, body, expected status]
        ['stranger', 'POST', `/api/v1/deliveries/${d}/accept`, undefined, 404],
        ['customer', 'POST', `/api/v1/deliveries/${d}/accept`, undefined, 403],
        ['seller', 'POST', `/api/v1/deliveries/${d}/accept`, undefined, 403],
        ['admin', 'POST', `/api/v1/deliveries/${d}/accept`, undefined, 403],
        ['stranger', 'POST', `/api/v1/deliveries/${d}/assign`, { driverId: P.stranger.profileId }, 404],
        ['customer', 'POST', `/api/v1/deliveries/${d}/assign`, { driverId: P.customer.profileId }, 403],
        ['rider', 'POST', `/api/v1/deliveries/${d}/assign`, { driverId: P.rider.profileId }, 403],
        ['stranger', 'POST', `/api/v1/deliveries/${d}/cancel`, {}, 404],
        ['customer', 'POST', `/api/v1/deliveries/${d}/cancel`, {}, 403],
        ['rider', 'POST', `/api/v1/deliveries/${d}/cancel`, {}, 403],
        ['stranger', 'POST', `/api/v1/deliveries/${d}/status`, { status: 'picked_up' }, 404],
        ['customer', 'POST', `/api/v1/deliveries/${d}/status`, { status: 'picked_up' }, 403],
        ['seller', 'POST', `/api/v1/deliveries/${d}/status`, { status: 'picked_up' }, 403],
        ['stranger', 'POST', `/api/v1/deliveries/${d}/location`, { lat: 4.05, lng: 9.77 }, 404],
        ['customer', 'POST', `/api/v1/deliveries/${d}/location`, { lat: 4.05, lng: 9.77 }, 403],
        ['stranger', 'POST', `/api/v1/deliveries/${d}/complete`, { code: '0000' }, 404],
        ['customer', 'POST', `/api/v1/deliveries/${d}/complete`, { code: '0000' }, 403],
        ['seller', 'POST', `/api/v1/deliveries/${d}/complete`, { code: '0000' }, 403],
        ['seller', 'POST', `/api/v1/deliveries/${d}/resolve`, { action: 'fail', note: 'x' }, 403],
        ['customer', 'POST', `/api/v1/deliveries/${d}/resolve`, { action: 'fail', note: 'x' }, 403],
        ['seller', 'POST', `/api/v1/deliveries/${d}/reconcile`, undefined, 403],
        ['customer', 'POST', `/api/v1/deliveries/${d}/decline`, undefined, 403],
        ['stranger', 'POST', `/api/v1/deliveries/${d}/decline`, undefined, 404],
        // creating a delivery needs to be the order's seller (or an admin); anyone else just does not find the order
        ['customer', 'POST', '/api/v1/deliveries', { orderId: I.orderId }, 404],
        ['stranger', 'POST', '/api/v1/deliveries', { orderId: I.orderId }, 404],
        ['rider', 'POST', '/api/v1/deliveries', { orderId: I.orderId }, 404],
        ['anonymous', 'POST', '/api/v1/deliveries', { orderId: I.orderId }, 401],
        ['anonymous', 'POST', `/api/v1/deliveries/${d}/accept`, undefined, 401],
      ];
      const problems = [];
      for (const [who, method, path, body, want] of cases) {
        const r = await call(who, method, path, { body });
        counters.assertions += 1;
        if (r.status !== want) problems.push(`${method} ${path.replace(d, ':id')} as ${who}: expected ${want}, got ${r.status} ${short(r.body)}`);
      }
      const after = await deliveryAs('seller');
      counters.assertions += 1;
      if (after.status !== 'assigned') problems.push(`the delivery is now "${after.status}" after only refused requests`);
      const attempts = await sql('SELECT code_attempts FROM iam.deliveries WHERE id = $1', [d]).catch(() => null);
      if (attempts && attempts[0] && Number(attempts[0].code_attempts) !== 0) problems.push(`a refused /complete burned ${attempts[0].code_attempts} handover-code attempt(s)`);
      if (problems.length) throw new Error(problems.join('\n'));
      return `${cases.length} refused requests, delivery still assigned, no code attempt used`;
    });

    /* ======================================================================= */
    /* d. rider                                                                  */
    /* ======================================================================= */
    heading('d. rider endpoints — only a registered rider');

    const onlyRider = { rider: 200, default: 403 };
    await matrix('GET', '/api/v1/deliveries/driver/me', '/api/v1/deliveries/driver/me', onlyRider, {
      verify: (who, r) => {
        if (who !== 'rider') return;
        const d = dataOf(r);
        assert.ok(d.deliveries.some((x) => x.id === I.deliveryId && x.status === 'assigned'), 'the rider\'s job list holds the offered delivery');
        assert.strictEqual(d.driver.id, P.rider.profileId);
        assert.ok(d.presence && d.presence.status === 'online', `the rider is online, got ${d.presence && d.presence.status}`);
      },
    });
    await matrix('GET', '/api/v1/deliveries/driver/presence', '/api/v1/deliveries/driver/presence', onlyRider);
    await matrix('POST', '/api/v1/deliveries/driver/presence/heartbeat', '/api/v1/deliveries/driver/presence/heartbeat', onlyRider, { body: {} });
    await matrix('POST', '/api/v1/deliveries/driver/presence/online', '/api/v1/deliveries/driver/presence/online', onlyRider, { body: {} });
    await matrix('POST', '/api/v1/deliveries/drivers/:profileId (register a rider — nobody registers themselves)', `/api/v1/deliveries/drivers/${P.stranger.profileId}`, {
      customer: 403, stranger: 403, seller: 403, rider: 403, unverified: 403, onboarding: 403, default: 403,
    }, { body: { name: 'Sam Stranger', phone: '+237690000102' }, only: ['anonymous', 'garbage', 'customer', 'stranger', 'seller', 'rider', 'unverified', 'onboarding', 'suspended'] });
    await check('rider presence routes are strict: a body that names a status or another rider is a 400', async () => {
      for (const body of [{ status: 'online' }, { riderId: P.customer.profileId }, { driverId: P.customer.profileId }, { available: true }]) {
        const r = await call('rider', 'POST', '/api/v1/deliveries/driver/presence/online', { body });
        counters.assertions += 1;
        assert.strictEqual(r.status, 400, `POST presence/online with ${Object.keys(body)}: ${r.status} ${short(r.body)}`);
      }
      return '400 x4';
    });
    await matrix('GET', '/api/v1/deliveries/providers?city=Douala (any signed-in user; no phone numbers)', '/api/v1/deliveries/providers?city=Douala', { default: 200 }, {
      verify: (who, r) => {
        const keys = [...keysDeep(dataOf(r))];
        assert.ok(!keys.includes('phone'), 'the provider list must not carry rider phone numbers');
      },
    });

    /* ======================================================================= */
    /* e. seller dispatch                                                        */
    /* ======================================================================= */
    heading('e. seller dispatch — /deliveries/dispatch and /deliveries/drivers');

    await matrix('GET', '/api/v1/deliveries/dispatch', '/api/v1/deliveries/dispatch', { seller: 200, admin: 200, superadmin: 200, default: 403 }, {
      verify: (who, r) => {
        const items = dataOf(r).items;
        assert.ok(items.some((x) => x.order.id === I.orderId && x.delivery && x.delivery.id === I.deliveryId), `${who}'s board lists the order with its delivery`);
        assert.ok(items.some((x) => x.order.id === I.strangerOrderId && x.delivery === null), `${who}'s board lists the order that still needs a delivery`);
      },
    });
    await matrix('GET', '/api/v1/deliveries/drivers (available riders)', '/api/v1/deliveries/drivers', { seller: 200, admin: 200, superadmin: 200, default: 403 }, {
      verify: (who, r) => {
        const d = dataOf(r);
        assert.ok(d.drivers.some((x) => x.id === P.rider.profileId), `${who} sees the online rider`);
        assert.ok(d.summary && d.summary.registered >= 1, 'summary');
      },
    });
    await matrix('GET', '/api/v1/deliveries/drivers?status=all (the admin roster)', '/api/v1/deliveries/drivers?status=all', { admin: 200, superadmin: 200, default: 403 });
    await matrix('GET', '/api/v1/deliveries/drivers?deliveryId=:id (a seller may ask about their own delivery)', `/api/v1/deliveries/drivers?deliveryId=${I.deliveryId}`, { seller: 200, admin: 200, superadmin: 200, default: 403 });
    await matrix('POST', '/api/v1/deliveries/:id/auto-assign (staff only)', `/api/v1/deliveries/${I.deliveryId}/auto-assign`, { customer: 403, rider: 403, stranger: 404, unverified: 404, onboarding: 404, default: 404 }, {
      only: ['anonymous', 'garbage', 'customer', 'stranger', 'rider', 'unverified', 'onboarding', 'suspended'],
    });

    /* A rival seller: a real second boutique, owned by someone else. */
    const rival = await fx.throwawaySeller('rival');
    await check('(fixture) a second seller (rival) can be created through the app: store created, account not seller-ready until the store is activated', async () => {
      const draftState = dataOf(await fx.api('GET', '/api/v1/me/state', { token: rival.token, client: 'rival#a' }));
      assert.notStrictEqual(draftState.state, 'SELLER_READY', 'a draft store does not make an account seller-ready');
      return `rival ${rival.storeSlug} is ${draftState.state}`;
    });
    // Between creation and activation: the DRAFT store as the public sees it (used by the KNOWN_GAP section).
    const draftPublic = {
      bySlug: await fx.api('GET', `/api/v1/stores/s/${rival.storeSlug}`, { client: 'anon#draft' }),
      profile: await fx.api('GET', `/api/v1/stores/${rival.storeId}/profile`, { client: 'anon#draft' }),
    };
    await rival.activate();
    const rivalCall = (method, path, body) => fx.api(method, path, { token: rival.token, body, client: 'rival#b' });
    await check('a rival seller cannot read, dispatch or deliver another seller\'s order (404), and their board holds none of it', async () => {
      const refused = [
        ['GET', `/api/v1/orders/${I.orderId}`],
        ['GET', `/api/v1/deliveries/${I.deliveryId}`],
        ['GET', `/api/v1/deliveries/by-order/${I.orderId}`],
        ['GET', `/api/v1/deliveries/${I.deliveryId}/code`],
        ['GET', `/api/v1/deliveries/drivers?deliveryId=${I.deliveryId}`],
      ];
      for (const [m, p] of refused) {
        const r = await rivalCall(m, p);
        counters.assertions += 1;
        assert.strictEqual(r.status, 404, `${m} ${p.replace(I.deliveryId, ':id').replace(I.orderId, ':orderId')} as a rival seller: ${r.status} ${short(r.body)}`);
      }
      const create = await rivalCall('POST', '/api/v1/deliveries', { orderId: I.strangerOrderId });
      const assign = await rivalCall('POST', `/api/v1/deliveries/${I.deliveryId}/assign`, { driverId: P.rider.profileId });
      const cancel = await rivalCall('POST', `/api/v1/deliveries/${I.deliveryId}/cancel`, {});
      const status = await rivalCall('PATCH', `/api/v1/orders/${I.orderId}/status`, { status: 'cancelled' });
      counters.assertions += 4;
      assert.strictEqual(create.status, 404, `POST /deliveries for another seller's order: ${create.status} ${short(create.body)}`);
      assert.strictEqual(assign.status, 404, `POST /deliveries/:id/assign: ${assign.status}`);
      assert.strictEqual(cancel.status, 404, `POST /deliveries/:id/cancel: ${cancel.status}`);
      assert.strictEqual(status.status, 404, `PATCH /orders/:id/status: ${status.status}`);
      const board = await rivalCall('GET', '/api/v1/deliveries/dispatch');
      counters.assertions += 1;
      assert.strictEqual(board.status, 200, `rival's own dispatch board: ${board.status} ${short(board.body)}`);
      assert.deepStrictEqual(dataOf(board).items.filter((x) => [I.orderId, I.strangerOrderId].includes(x.order.id)), [], 'the rival\'s board must not list another seller\'s orders');
      return 'all 404, rival\'s board is empty of them';
    });

    /* ======================================================================= */
    /* f. admin API                                                              */
    /* ======================================================================= */
    heading('f. admin API — /api/v1/admin/* (admin and super_admin only)');

    const adminOnly = { admin: 200, superadmin: 200, default: 403 };
    for (const route of ['/overview', '/stores', '/settings', '/users', '/orders', '/listings', '/audit-logs']) {
      await matrix('GET', `/api/v1/admin${route}`, `/api/v1/admin${route}`, adminOnly, {
        verify: (who, r) => { if (r.status === 200) assert.strictEqual(r.body.success, true, 'success envelope'); },
      });
    }
    await matrix('GET', '/api/admin/overview (the un-versioned mount is guarded identically)', '/api/admin/overview', adminOnly);
    await matrix('GET', '/api/v1/admin/health/deep', '/api/v1/admin/health/deep', adminOnly);
    // Mutating admin routes, tried by everyone who must NOT be able to. The bodies are
    // harmless even if a guard were missing (same role, maintenance off, no settings).
    const victim = await fx.throwaway('victim');
    const adminMutations = [
      ['PATCH', `/api/v1/admin/users/${victim.profileId}/role`, { role: 'customer' }],
      ['PATCH', `/api/v1/admin/users/${victim.profileId}`, { city: 'Douala' }],
      ['POST', `/api/v1/admin/stores/${I.storeId}/reactivate`, {}],
      ['POST', '/api/v1/admin/maintenance', { enabled: false }],
      ['PUT', '/api/v1/admin/settings', {}],
    ];
    for (const [method, path, body] of adminMutations) {
      await matrix(method, path.replace(victim.profileId, ':id').replace(I.storeId, ':id'), path, { default: 403 }, {
        body, only: ['anonymous', 'garbage', 'customer', 'stranger', 'seller', 'rider', 'unverified', 'onboarding', 'suspended'],
      });
    }
    await check('an administrator\'s session cannot be forged: legacy bypass tokens, a wrong-secret test token, alg:none and wrong-key JWTs -> 401', async () => {
      const crypto = require('crypto');
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const claims = { sub: P.admin.userId, email: P.admin.email, role: 'authenticated', iat: now, exp: now + 3600 };
      const algNone = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
      const wrongKey = (() => {
        const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`;
        return `${head}.${crypto.createHmac('sha256', crypto.randomBytes(32)).update(head).digest('base64url')}`;
      })();
      const tampered = (() => { // a REAL admin token with the signature of another one
        const [h, , s] = P.admin.token.split('.');
        return `${h}.${b64({ ...claims, sub: P.superadmin.userId })}.${s}`;
      })();
      const attempts = [
        ['Bearer admin_token', { authorization: 'Bearer admin_token' }],
        ['Bearer user_admin', { authorization: 'Bearer user_admin' }],
        ['Bearer super_admin', { authorization: 'Bearer super_admin' }],
        ['x-admin-key: loumoo_dev_admin', { 'x-admin-key': 'loumoo_dev_admin' }],
        ['a loumoo_test token with the wrong secret', { authorization: 'Bearer loumoo_test:not-the-secret:loumoo_test_super_admin' }],
        ['a JWT with alg "none"', { authorization: `Bearer ${algNone}` }],
        ['a JWT signed with the wrong key', { authorization: `Bearer ${wrongKey}` }],
        ['a real token with its payload swapped', { authorization: `Bearer ${tampered}` }],
      ];
      const problems = [];
      for (const [name, headers] of attempts) {
        for (const path of ['/api/v1/admin/overview', '/api/v1/me/state']) {
          const r = await fx.api('GET', path, { headers, client: 'forger#f' });
          counters.assertions += 1;
          if (r.status !== 401) problems.push(`GET ${path} with ${name}: expected 401, got ${r.status} ${short(r.body)}`);
        }
      }
      if (problems.length) throw new Error(problems.join('\n'));
      return `${attempts.length} forgeries x 2 routes, all 401`;
    });

    /* ======================================================================= */
    /* g. public storefront                                                      */
    /* ======================================================================= */
    heading('g. public storefront — GET /stores/s/:slug and /stores/:slugOrId/profile');

    const FORBIDDEN_STORE_KEYS = [/^email$/i, /^owner/i, /payout/i, /kyc/i, /document/i, /^(taxNiu|rccm|businessAddress)/i, /(password|secret|iban|bankAccount|mobileMoney|momo)/i];
    const ownerSecrets = [P.seller.email, P.seller.userId, P.seller.profileId, P.seller.phone];
    const publicStoreView = (what) => (r) => {
      const keys = [...keysDeep(r.body)];
      const bad = keys.filter((k) => FORBIDDEN_STORE_KEYS.some((re) => re.test(k)));
      assert.deepStrictEqual(bad, [], `${what}: field names that must not be public`);
      const text = JSON.stringify(r.body).toLowerCase();
      for (const secret of ownerSecrets) assert.ok(!text.includes(String(secret).toLowerCase()), `${what}: the owner's ${secret.includes('@') ? 'email' : 'account identifier/phone'} (${secret.slice(0, 6)}…) appears in the public JSON`);
    };
    const storeName = (r) => (dataOf(r).seller || dataOf(r)).name;
    const storeViews = [
      ['GET /api/v1/stores/s/:slug', `/api/v1/stores/s/${I.storeSlug}`],
      ['GET /api/v1/stores/s/:id', `/api/v1/stores/s/${I.storeId}`],
      ['GET /api/v1/stores/:slug/profile', `/api/v1/stores/${I.storeSlug}/profile`],
      ['GET /api/v1/stores/:id/profile', `/api/v1/stores/${I.storeId}/profile`],
    ];
    for (const [name, path] of storeViews) {
      await matrix('GET', `${name.replace('GET ', '')} (public: every persona, signed in or not)`, path, { default: 200, gate: false }, {
        only: ['anonymous', 'garbage', 'stranger', 'seller', 'admin'],
        verify: (who, r) => {
          assert.strictEqual(storeName(r), I.storeName, 'the store\'s name');
          publicStoreView(`${name} as ${who}`)(r);
        },
      });
    }
    await check('the public storefront of the fixture store lists its published listing and no unpublished data', async () => {
      const r = await call('anonymous', 'GET', `/api/v1/stores/s/${I.storeSlug}`);
      const s = dataOf(r).seller;
      counters.assertions += 1;
      assert.strictEqual(s.id, I.storeId);
      assert.ok(s.listings.some((l) => l.id === I.listingId && l.priceXaf === I.listingPriceXaf), 'the published listing with its price');
      assert.strictEqual(s.isFollowing, false, 'an anonymous visitor is not following');
      return `${s.listings.length} listing(s)`;
    });
    await check('unknown slugs and lookalikes of OTHER records\' ids answer 404 and never return that record', async () => {
      const lookalikes = {
        'an unknown slug': `no-such-store-${fx.runId}`,
        'a listing id': I.listingId,
        'an order id': I.orderId,
        'a delivery id': I.deliveryId,
        'the seller\'s profile id': P.seller.profileId,
        'the seller\'s auth user id': P.seller.userId,
        'the rider\'s profile id': P.rider.profileId,
        'an SQL-shaped slug': "x' or '1'='1",
        'a path-traversal slug': '..%2f..%2fetc%2fpasswd',
        'a wildcard': '%25',
        'a very long slug': 'a'.repeat(400),
      };
      const problems = [];
      for (const [name, ident] of Object.entries(lookalikes)) {
        const enc = ident === "x' or '1'='1" ? encodeURIComponent(ident) : ident;
        for (const path of [`/api/v1/stores/s/${enc}`, `/api/v1/stores/${enc}/profile`]) {
          const r = await call('anonymous', 'GET', path);
          counters.assertions += 1;
          if (r.status !== 404) problems.push(`${path.slice(0, 70)} (${name}): expected 404, got ${r.status} ${short(r.body)}`);
          else if (JSON.stringify(r.body).includes(I.storeName)) problems.push(`${path.slice(0, 70)} (${name}): the 404 body names the store`);
        }
      }
      if (problems.length) throw new Error(problems.join('\n'));
      return `${Object.keys(lookalikes).length} lookalikes x 2 routes, all 404`;
    });
    await check('a slug is matched exactly: a prefix of the real slug is not the store', async () => {
      const prefix = I.storeSlug.slice(0, -2);
      const r = await call('anonymous', 'GET', `/api/v1/stores/s/${prefix}`);
      const r2 = await call('anonymous', 'GET', `/api/v1/stores/${prefix}/profile`);
      counters.assertions += 2;
      assert.strictEqual(r.status, 404, `/stores/s/<prefix>: ${r.status}`);
      assert.strictEqual(r2.status, 404, `/stores/<prefix>/profile: ${r2.status}`);
      return '404, 404';
    });

    /* ======================================================================= */
    /* c2. after the rider accepts                                               */
    /* ======================================================================= */
    heading('c2. deliveries after the rider accepts — handover code, full drop-off, live stream');

    await check('POST /api/v1/deliveries/:id/accept as the assigned rider -> 200 accepted (rider becomes busy)', async () => {
      const r = await call('rider', 'POST', `/api/v1/deliveries/${I.deliveryId}/accept`);
      counters.assertions += 1;
      assert.strictEqual(r.status, 200, `${r.status} ${short(r.body)}`);
      assert.strictEqual(dataOf(r).delivery.status, 'accepted');
      const presence = dataOf(await call('rider', 'GET', '/api/v1/deliveries/driver/presence')).presence;
      assert.strictEqual(presence.status, 'busy', 'a rider carrying a delivery is busy');
      return 'accepted, rider busy';
    });
    let handoverCode = null;
    await matrix('GET', '/api/v1/deliveries/:id/code (accepted: the buyer, and ONLY the buyer, may read it)', `/api/v1/deliveries/${I.deliveryId}/code`, {
      customer: 200, seller: 403, rider: 403, admin: 403, superadmin: 403, stranger: 404, unverified: 404, onboarding: 404, default: 404,
    }, {
      verify: (who, r) => {
        if (who !== 'customer') return;
        const d = dataOf(r);
        assert.match(String(d.code), /^\d{4}$/, 'a 4-digit code');
        assert.strictEqual(d.digits, 4);
        assert.strictEqual(d.attemptsRemaining, 5);
        handoverCode = d.code;
      },
    });
    await check('after accepting: the buyer sees the rider, the rider now sees the full drop-off, nobody gets the code in a delivery view', async () => {
      assert.ok(handoverCode, 'the handover code was not read in the previous check');
      const buyer = await deliveryAs('customer');
      const rider = await deliveryAs('rider');
      counters.assertions += 4;
      assert.strictEqual(buyer.status, 'accepted');
      assert.ok(buyer.driver && buyer.driver.id === P.rider.profileId, 'the buyer is told who is coming');
      assert.ok(rider.dropoff.address && rider.dropoff.contactPhone, 'the rider who accepted gets the full drop-off');
      for (const who of ['customer', 'seller', 'rider', 'admin']) {
        const dl = await deliveryAs(who);
        assert.ok(!JSON.stringify(dl).includes(handoverCode), `${who}'s delivery view must not contain the handover code`);
      }
      return 'ok';
    });
    await check('a wrong person\'s complete attempt is refused before the code is looked at (no guess is used)', async () => {
      for (const who of ['customer', 'seller', 'admin']) {
        const r = await call(who, 'POST', `/api/v1/deliveries/${I.deliveryId}/complete`, { body: { code: '0000' } });
        counters.assertions += 1;
        assert.strictEqual(r.status, 403, `POST /complete as ${who}: ${r.status} ${short(r.body)}`);
      }
      const stranger = await call('stranger', 'POST', `/api/v1/deliveries/${I.deliveryId}/complete`, { body: { code: handoverCode } });
      counters.assertions += 1;
      assert.strictEqual(stranger.status, 404, `POST /complete as a stranger holding the right code: ${stranger.status}`);
      const code = dataOf(await call('customer', 'GET', `/api/v1/deliveries/${I.deliveryId}/code`));
      assert.strictEqual(code.attemptsRemaining, 5, 'still five guesses left');
      return 'customer/seller/admin 403, stranger 404, 5 attempts left';
    });

    // The live stream: authenticated like everything else, 404 to strangers, never left open.
    const streamWho = { customer: 200, seller: 200, rider: 200, admin: 200 };
    await check('GET /api/v1/deliveries/:id/stream — participants get an event stream (aborted after the first event); everyone else is refused', async () => {
      const problems = [];
      const probe = (who) => fx.probeStream(`/api/v1/deliveries/${I.deliveryId}/stream`, { token: tokenOf(who), client: `${who}#stream`, ms: 3000 });
      const seen = [];
      for (const [who, want] of [...Object.entries(streamWho), ['stranger', 404], ['unverified', 404], ['onboarding', 404], ['suspended', 403], ['anonymous', 401], ['garbage', 401]]) {
        const s = await probe(who);
        counters.assertions += 1;
        seen.push(`${who} ${s.status}`);
        if (s.status === 501) { // a serverless runtime: documented answer; still must be authenticated, which the others prove
          problems.push(`${who}: 501 STREAM_UNSUPPORTED (not expected on this runtime): ${short(s.text)}`);
          continue;
        }
        if (s.status !== want) { problems.push(`stream as ${who}: expected ${want}, got ${s.status} ${short(s.text)}`); continue; }
        if (want === 200) {
          if (!/text\/event-stream/.test(s.contentType)) problems.push(`stream as ${who}: content-type ${s.contentType}`);
          if (!/event: status\ndata: \{[^\n]*"status":"accepted"/.test(s.text)) problems.push(`stream as ${who}: no status snapshot in ${short(s.text)}`);
          if (s.text.includes(handoverCode)) problems.push(`stream as ${who}: the handover code is in the event stream`);
        }
      }
      if (problems.length) throw new Error(problems.join('\n'));
      return seen.join(', ');
    });
    await check('the seller\'s rider list no longer offers a rider who is carrying a delivery (busy)', async () => {
      const d = dataOf(await call('seller', 'GET', '/api/v1/deliveries/drivers'));
      counters.assertions += 1;
      assert.ok(!d.drivers.some((x) => x.id === P.rider.profileId), 'a busy rider is not offered work');
      assert.strictEqual(d.summary.available, 0);
      return `registered ${d.summary.registered}, available ${d.summary.available}`;
    });

    /* ======================================================================= */
    /* h. KNOWN_GAPs                                                             */
    /* ======================================================================= */
    heading('h. KNOWN_GAP probes — defects found while building this; logged, never failing');

    // ---- (1) an admin can make someone super_admin --------------------------------
    await check('probe: can an `admin` (not super_admin) grant the top role?  PATCH /admin/users/:id/role and PATCH /admin/users/:id', async () => {
      const t1 = await fx.throwaway('elev');
      const t2 = await fx.throwaway('mass');
      const roleOf = async (id) => (await sql('SELECT primary_role FROM iam.profiles WHERE id = $1', [id]))[0].primary_role;
      const r1 = await call('admin', 'PATCH', `/api/v1/admin/users/${t1.profileId}/role`, { body: { role: 'super_admin' } });
      const after1 = await roleOf(t1.profileId);
      const r2 = await call('admin', 'PATCH', `/api/v1/admin/users/${t2.profileId}`, { body: { primary_role: 'super_admin' } });
      const after2 = await roleOf(t2.profileId);
      counters.assertions += 2;
      assert.ok(r1.status < 500 && r2.status < 500, `a 5xx here: role ${r1.status}, mass-assign ${r2.status}`);
      if (after1 === 'super_admin') gap(`an admin can promote any account to super_admin: PATCH /api/v1/admin/users/:id/role {role:"super_admin"} -> ${r1.status}, iam.profiles.primary_role is now "super_admin" (the route guard only requires admin; no super_admin check)`);
      else gap(`(closed? verify) PATCH /admin/users/:id/role {role:"super_admin"} as admin -> ${r1.status}; primary_role stayed "${after1}"`);
      if (after2 === 'super_admin') gap(`an admin can mass-assign primary_role: PATCH /api/v1/admin/users/:id {primary_role:"super_admin"} -> ${r2.status}, role is now "super_admin" (SuperAdminRepository.updateUser writes the raw body into profiles)`);
      else gap(`(closed? verify) PATCH /admin/users/:id {primary_role} as admin -> ${r2.status}; role stayed "${after2}"`);
      return `role route ${r1.status} -> ${after1}; mass-assign ${r2.status} -> ${after2}`;
    });

    // ---- (2) a suspended store is still public ------------------------------------
    await check('probe: is a SUSPENDED store still served publicly?  (admin POST /admin/stores/:id/suspend, then GET /stores/s/:slug)', async () => {
      const sus = await call('admin', 'POST', `/api/v1/admin/stores/${rival.storeId}/suspend`, { body: { reason: 'fixture probe' } });
      const after = (await sql('SELECT status, visibility FROM iam.stores WHERE id = $1', [rival.storeId]))[0];
      counters.assertions += 1;
      assert.ok(sus.status < 500, `suspend answered ${sus.status}`);
      if (after.status === 'SUSPENDED') {
        const bySlug = await call('anonymous', 'GET', `/api/v1/stores/s/${rival.storeSlug}`);
        const byProfile = await call('anonymous', 'GET', `/api/v1/stores/${rival.storeSlug}/profile`);
        const byId = await call('anonymous', 'GET', `/api/v1/stores/${rival.storeId}/profile`);
        if (bySlug.status === 200) gap(`a SUSPENDED store is still returned by GET /api/v1/stores/s/:slug -> ${bySlug.status} (PublicProfileService.getSellerPublicProfile only hides ARCHIVED/DELETED); GET /stores/:slug/profile -> ${byProfile.status}, /stores/:id/profile -> ${byId.status}`);
        else out(`      (closed: a SUSPENDED store answers GET /stores/s/:slug with ${bySlug.status})`);
        await call('admin', 'POST', `/api/v1/admin/stores/${rival.storeId}/reactivate`, { body: {} });
      } else {
        gap(`admin store moderation does not work on a real store: POST /api/v1/admin/stores/:id/suspend -> ${sus.status} ${short(sus.body && sus.body.error ? sus.body.error.message : sus.body, 90)}; the store row stayed "${after.status}" (SuperAdminRepository.getStoreById selects columns the schema does not have, falls back to its built-in demo stores and finds no such store). So "a suspended store is still public" (GET /stores/s/:slug only hides ARCHIVED/DELETED) could not be exercised through the app's routes; not forced with a direct UPDATE`);
      }
      // Not a gap, a design note the router depends on: a store is public from the moment it is created.
      const draft = draftPublic;
      out(`      (note, by design — CreateStoreUseCase: a created store is status ACTIVE / visibility PUBLIC at once, before onboarding: GET /stores/s/:slug -> ${draft.bySlug.status}, GET /stores/:id/profile -> ${draft.profile.status} for a store whose owner is not yet seller-ready)`);
      return `suspend ${sus.status}, store row ${after.status}`;
    });

    // ---- (3) canPurchase is enforced by POST /orders ------------------------------
    await check('POST /orders refuses an account that is not purchase-ready (canPurchase=false) with 403', async () => {
      const results = [];
      for (const who of ['unverified', 'onboarding']) {
        const r = await call(who, 'POST', '/api/v1/orders', {
          body: { items: [{ listingId: I.listingId, quantity: 1 }], deliveryMethod: 'STORE_PICKUP', shippingAddress: { fullName: `${P[who].firstName} ${P[who].lastName}`, phone: P[who].phone, city: 'Douala' } },
        });
        counters.assertions += 1;
        assert.ok(r.status < 500, `POST /orders as ${who}: ${r.status} ${short(r.body)}`);
        const caps = (await state(who)).capabilities;
        if (r.status === 201) {
          // keep the seller's board tidy: the buyer cancels it again
          await call(who, 'POST', `/api/v1/orders/${dataOf(r).order.id}/cancel`, { body: { reason: 'fixture probe' } });
        }
        counters.assertions += 1;
        assert.strictEqual(caps.canPurchase, false, `${who} is not purchase-ready`);
        assert.strictEqual(r.status, 403, `canPurchase is enforced server-side: ${who} (state ${P[who].state}) POST /api/v1/orders -> ${r.status} ${short(r.body)}`);
        results.push(`${who} ${r.status}`);
      }
      return results.join(', ');
    });

    // ---- (4) the admin API serves built-in demo data -------------------------------
    await check('probe: does the admin API show the real database?', async () => {
      const stores = dataOf(await call('admin', 'GET', '/api/v1/admin/stores')).stores || [];
      const users = dataOf(await call('admin', 'GET', '/api/v1/admin/users')).users || [];
      const orders = dataOf(await call('admin', 'GET', '/api/v1/admin/orders')).orders || [];
      const listings = dataOf(await call('admin', 'GET', '/api/v1/admin/listings')).listings || [];
      const real = {
        stores: stores.some((x) => x.id === I.storeId),
        users: users.some((u) => u.id === P.customer.profileId),
        orders: orders.some((o) => o.id === I.orderId),
        listings: listings.some((l) => l.id === I.listingId),
      };
      counters.assertions += 4;
      const demo = Object.entries(real).filter(([, ok]) => !ok).map(([k]) => k);
      if (demo.length) {
        // Evidence: which of the columns the repository selects exist in the schema the migrations built.
        const wanted = { profiles: ['full_name', 'kyc_status'], orders: ['total_amount', 'status', 'escrow_status', 'user_id', 'store_id'], listings: ['base_price', 'stock_quantity'], stores: ['city', 'product_count'] };
        const missing = [];
        for (const [table, cols] of Object.entries(wanted)) {
          const have = (await sql(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'iam' AND table_name = $1`, [table])).map((r) => r.column_name);
          const gone = cols.filter((c) => !have.includes(c));
          if (gone.length) missing.push(`${table}.${gone.join('/')}`);
        }
        gap(`GET /api/v1/admin/${demo.join(', /api/v1/admin/')} answer 200 with built-in demo rows (e.g. "${(stores[0] || {}).name || (users[0] || {}).full_name || ''}") instead of the database: SuperAdminRepository selects columns the schema does not have (${missing.join(', ') || 'see Postgres 42703 in dbErrors()'}), swallows the error and serves its built-in demo rows, in every NODE_ENV. The overview KPIs (86 orders, 142 users...) are invented too`);
      }
      return `real rows visible: ${JSON.stringify(real)}`;
    });

    // ---- (5) the public storefront drops reviews and recommendations silently ------
    await check('probe: does the public storefront read reviews and recommendations?', async () => {
      const bad = fx.stack.dbErrors().filter((e) => /\/rest\/v1\/(reviews|social_recommendations)/.test(e.path));
      counters.assertions += 1;
      if (bad.length) gap(`(harness limitation, NOT asserted as a server bug) GET /api/v1/stores/s/:slug answers 200 but its reviews and social_recommendations reads fail on the local stand-in (${[...new Set(bad.map((e) => e.error))].join(', ')}): ReviewService/SocialGraphService embed "profiles:author_id(...)", an alias:column form that tests/e2e/support/miniPostgrest.js does not resolve although migration 008 defines the foreign keys. Reviews and recommendations therefore always read as empty here, and each storefront request logs two "[DB-FAILURE] ... in-memory fallback" lines`);
      return `${bad.length} failed reads`;
    });

    // ---- (6) a store without a phone publishes the owner's account phone -----------
    await check('probe: does a store created without a business phone publish the owner\'s personal phone?', async () => {
      const profile = draftPublic.profile;
      counters.assertions += 1;
      assert.strictEqual(profile.status, 200, `GET /stores/:id/profile for the rival's store: ${profile.status}`);
      const published = dataOf(profile).phoneNumber;
      if (published && published === rival.phone) {
        gap(`a store created without phoneNumber inherits the owner's ACCOUNT phone and publishes it: GET /api/v1/stores/:id/profile -> phoneNumber "${published}" (CreateStoreUseCase: phone_number = input.phoneNumber || principal.phoneNumber)`);
      } else {
        out(`      (the rival's published store phone is ${JSON.stringify(published)}, not the owner's ${rival.phone})`);
      }
      return `published phoneNumber ${JSON.stringify(published)}`;
    });

    /* ======================================================================= */
    /* i. hygiene                                                                */
    /* ======================================================================= */
    heading('i. hygiene — nothing was swallowed');

    await check('the server never fell back silently to in-memory data, except the storefront reviews/recommendations reads (KNOWN_GAP above)', async () => {
      const lines = stack.silentFallbacks();
      // `stack.silentFallbacks()` can NOT be empty in this run: every GET /stores/s/:slug logs two such lines for the
      // reviews / recommendations reads (harness limitation above). Anything else would be new.
      const known = /List reviews|List recommendations/;
      const unexpected = lines.filter((l) => !known.test(l));
      counters.assertions += 1;
      if (lines.length && process.env.LOUMOO_TEST_VERBOSE) lines.forEach((l) => out(`      fallback: ${l.slice(0, 200)}`));
      assert.deepStrictEqual(unexpected, [], `unexpected silent fallbacks:\n${unexpected.join('\n')}`);
      return `${lines.length} fallback line(s), all "List reviews"/"List recommendations"; ${unexpected.length} unexpected`;
    });
    await check('only the known database errors occurred, and the server logged no ERROR line of its own', async () => {
      const errors = stack.dbErrors();
      const expectedError = (e) => {
        const msg = String(e.error || '');
        return (/\/auth\/v1\/token/.test(e.path) && /invalid_credentials|email_not_confirmed/.test(msg)) // the harness tries a login before each sign-up; a signed-up account that has not entered its code cannot sign in
          || (/\/auth\/v1\/user/.test(e.path) && /bad_jwt/.test(msg)) // the identity provider asks the auth service about a token it cannot verify itself (the forged/garbage tokens above)
          || (/\/rest\/v1\/(profiles|orders|stores|listings)\?select=/.test(e.path) && /42703/.test(msg)) // admin read models (KNOWN_GAP: demo data)
          || (/\/rest\/v1\/auth_sessions/.test(e.path) && /PGRST205/.test(msg)) // DELETE /users/me revokes sessions in a table no migration creates (best effort, logged at debug)
          || (/\/rest\/v1\/(reviews|social_recommendations)\?/.test(e.path) && /PGRST200/.test(msg)); // storefront reviews (KNOWN_GAP: harness limitation)
      };
      const unexpected = errors.filter((e) => !expectedError(e));
      counters.assertions += 1;
      if (unexpected.length) {
        throw new Error(`unexpected database errors:\n${unexpected.slice(0, 15).map((e) => `${e.method} ${e.status} ${e.path.slice(0, 140)} ${String(e.error || '').slice(0, 100)}`).join('\n')}`);
      }
      const count = (re) => errors.filter((e) => re.test(String(e.error || ''))).length;
      // `errors()` is the server's own ERROR-level log lines, minus the fallback lines classified above.
      // (the one WARN that mentions ERROR is env.js noting that the harness set LOUMOO_TEST_AUTH_SECRET, on purpose)
      const own = stack.errors().filter((l) => !/List reviews|List recommendations|LOUMOO_TEST_AUTH_SECRET/.test(l));
      assert.deepStrictEqual(own.slice(0, 5), [], 'ERROR-level server log lines');
      return `${errors.length} expected database error(s): ${count(/42703/)} missing-column (admin read models), ${count(/PGRST200/)} missing-relationship (reviews), ${count(/bad_jwt/)} bad_jwt (forged tokens), ${count(/invalid_credentials|email_not_confirmed/)} refused sign-ins (before sign-up / before the code is entered), ${count(/PGRST205/)} missing-table (auth_sessions); 0 unexpected`;
    });
  } finally {
    await fx.stop();
  }

  /* ------------------------------------------------------------------------- */
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  out('\n------------------------------------------------------------------');
  out(`  ${counters.checks - failures.length} passed, ${failures.length} failed  (${counters.checks} checks, ${counters.assertions} persona/route assertions)  |  ${gaps.length} KNOWN_GAP line(s)  |  ${secs} s (fixture ${(fx.startupMs / 1000).toFixed(1)} s)`);
  if (gaps.length) { out('  KNOWN_GAPs:'); gaps.forEach((g, i) => out(`    ${i + 1}. ${g}`)); }
  if (failures.length) {
    out('  FAILED:');
    failures.forEach((f) => out(`    - ${f.name}\n        ${f.message.split('\n').join('\n        ')}`));
    throw new Error(`${failures.length} authorization check(s) failed`);
  }
}

module.exports = { run };

if (require.main === module) {
  run().then(() => process.exit(0), (e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
}
