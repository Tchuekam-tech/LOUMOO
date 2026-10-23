/**
 * LOUMOO — the hermetic "routing" fixture.
 * ---------------------------------------------------------------------------
 * Boots the local end-to-end stack (tests/e2e/support/localStack.js: PGlite
 * Postgres with the repo's migrations, the PostgREST/Auth/Storage stand-ins and
 * the REAL server/index.js as a child process on loopback) and provisions one
 * account per ROLE and ACCOUNT STATE the router has to tell apart, plus a real
 * order, delivery and rider, so a test can sign in as any of them and ask the
 * real server what that person may do.
 *
 *   const { startFixture } = require('./support/fixture');
 *   const fx = await startFixture();
 *   const r = await fx.api('GET', '/api/v1/me/state', { token: fx.personas.customer.token });
 *   ...
 *   await fx.stop();
 *
 * Everything is created THROUGH THE APPLICATION'S OWN ROUTES (sign-up, the
 * emailed code read from the development-mode `devOtp`, onboarding, store
 * creation/activation, uploads, listings, orders, deliveries, rider registration
 * and presence). The ONLY direct writes to the local database are the ones that
 * no public route can perform, each in its own clearly named function below:
 *
 *   1. promoteAdminLocal            primary_role -> 'admin'        (provision.js)
 *   2. promoteSuperAdminLocal       primary_role -> 'super_admin'  (this file)
 *   3. suspendAccountLocal          status/account_status -> 'suspended' (this file)
 *   4. unverifyEmailLocal           email_verified_at -> NULL      (this file; the one
 *      addition to the list agreed for this fixture, see its comment: no route can
 *      give a SIGNED-IN account an unverified email, and the Auth stand-in has no
 *      generateLink, which is what the password-reset route would need to try)
 *
 * Passwords are generated per run with crypto.randomBytes and are never written
 * anywhere; no .env file is read and no external host is contacted.
 */
'use strict';

require('../../setup'); // hermetic by default (see tests/helpers/requirements.js)

const crypto = require('crypto');
const requirements = require('../../helpers/requirements');
const { startLocalStack } = require('../../e2e/support/localStack');
const P = require('../../e2e/support/provision');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (v, n = 300) => { try { return (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, n); } catch (_) { return String(v).slice(0, n); } };

/**
 * The server runs with TRUST_PROXY=1 (what Railway sets, and the production
 * default) and every request below carries an X-Forwarded-For that is stable per
 * persona. The API's rate limiter keys on req.ip (120 requests a minute), so one
 * loopback address shared by ten personas would exhaust it in the middle of the
 * run; per-persona addresses give each persona its own budget exactly as ten real
 * users behind the ingress would have. It changes nothing about authorisation.
 */
function clientIpFor(label) {
  const h = crypto.createHash('sha1').update(String(label)).digest();
  return `10.${h[0]}.${h[1]}.${1 + (h[2] % 253)}`;
}

/** provision.js's Api, plus a per-client X-Forwarded-For and a bounded retry on a rate-limit 429. */
class ClientApi extends P.Api {
  constructor(baseUrl, label) { super(baseUrl); this.clientIp = clientIpFor(label); }

  async call(method, path, opts = {}) {
    const headers = { 'x-forwarded-for': this.clientIp, ...(opts.headers || {}) };
    for (let attempt = 0; ; attempt += 1) {
      const res = await super.call(method, path, { ...opts, headers });
      const retryAfter = Number(res.headers['retry-after']);
      if (res.status === 429 && retryAfter > 0 && attempt < 2) { await sleep(Math.min(retryAfter, 65) * 1000); continue; }
      return res;
    }
  }
}

function assertHermetic() {
  if (requirements.realServicesEnabled()) {
    throw new Error('startFixture refuses to run with LOUMOO_RUN_INTEGRATION set: this fixture is hermetic and must never be pointed at real services. Unset it.');
  }
}

/* ----------------------------------------------------------------------- */
/* The three direct local-database writes (no public route can do these)    */
/* ----------------------------------------------------------------------- */

/** LOCAL ONLY. primary_role -> super_admin (no route promotes anyone to the top role). */
async function promoteSuperAdminLocal(db, userId) {
  const r = await db.query(
    `UPDATE iam.profiles SET primary_role = 'super_admin', updated_at = now() WHERE clerk_user_id = $1 RETURNING id`, [userId]);
  if (!r.rows.length) throw new Error(`no profile for user ${userId}`);
  return r.rows[0].id;
}

/** LOCAL ONLY. Suspends an account (the only public path is the admin's `suspend`, which is store-level). */
async function suspendAccountLocal(db, userId) {
  const r = await db.query(
    `UPDATE iam.profiles SET status = 'suspended', account_status = 'suspended', updated_at = now() WHERE clerk_user_id = $1 RETURNING id`, [userId]);
  if (!r.rows.length) throw new Error(`no profile for user ${userId}`);
  return r.rows[0].id;
}

/**
 * LOCAL ONLY. Clears the profile's email confirmation so a session that was issued
 * at verification time now belongs to an account in CONTACT_VERIFICATION_REQUIRED.
 *
 * Why this is needed: sign-up + verify-otp IS the verification, password login
 * refuses an unconfirmed address (401), and the only other route that mints a
 * session without verify-otp (reset-password) cannot resolve a user that has no
 * profile yet without GoTrue's `generateLink`, which the local Auth stand-in does
 * not provide. So the one state "holds a valid session, email not verified" has no
 * route that produces it here. (`pending` below covers "signed up, no session".)
 */
async function unverifyEmailLocal(db, userId) {
  const r = await db.query(
    `UPDATE iam.profiles SET email_verified_at = NULL, updated_at = now() WHERE clerk_user_id = $1 RETURNING id`, [userId]);
  if (!r.rows.length) throw new Error(`no profile for user ${userId}`);
  return r.rows[0].id;
}

/**
 * The server caches a signed-in user's profile row for five minutes and a direct
 * UPDATE does not clear it. An ordinary profile edit does (ProfileRepository.update
 * invalidates), and it is let through by the stale-but-valid cached row, so one is
 * made right after a local role/status change. A 403 means the guard already read
 * the fresh row (cache expired), which is just as good.
 */
async function bustProfileCache(api, token) {
  const r = await api.call('PATCH', '/api/v1/users/me', { token, body: { bio: 'LOUMOO fixture' } });
  if (![200, 403].includes(r.status)) throw new Error(`could not refresh the profile cache: PATCH /users/me -> ${r.status} ${short(r.body)}`);
}

/* ----------------------------------------------------------------------- */
/* Persona catalogue                                                         */
/* ----------------------------------------------------------------------- */

const IDENTITY = {
  customer:   { first: 'Cara',   last: 'Customer',   phone: '+237690000101' },
  stranger:   { first: 'Sam',    last: 'Stranger',   phone: '+237690000102' },
  seller:     { first: 'Sela',   last: 'Seller',     phone: '+237690000103' },
  rider:      { first: 'Rio',    last: 'Rider',      phone: '+237690000104' },
  admin:      { first: 'Ada',    last: 'Admin',      phone: '+237690000105' },
  superadmin: { first: 'Sue',    last: 'Superadmin', phone: '+237690000106' },
  onboarding: { first: 'Olu',    last: 'Onboarding', phone: '+237690000107' },
  suspended:  { first: 'Sid',    last: 'Suspended',  phone: '+237690000108' },
  unverified: { first: 'Una',    last: 'Unverified', phone: '+237690000109' },
  pending:    { first: 'Pia',    last: 'Pending',    phone: '+237690000110' },
};

/** What GET /api/v1/me/state must say for each persona once the fixture is built. */
const EXPECTED_STATE = {
  customer: 'ACCOUNT_READY', stranger: 'ACCOUNT_READY', seller: 'SELLER_READY', rider: 'ACCOUNT_READY',
  admin: 'ACCOUNT_READY', superadmin: 'ACCOUNT_READY', onboarding: 'ONBOARDING_REQUIRED',
  unverified: 'CONTACT_VERIFICATION_REQUIRED', suspended: 'SUSPENDED (403)', pending: 'no session',
};

async function startFixture(opts = {}) {
  assertHermetic();
  const t0 = Date.now();
  const log = opts.log || (() => {});
  const runId = crypto.randomBytes(4).toString('hex');

  const stack = await startLocalStack({
    nodeEnv: 'development', // development exposes the signup/reset code as `devOtp`
    logFile: opts.logFile,
    appPort: opts.appPort,
    dataDir: opts.dataDir,
    env: {
      TRUST_PROXY: '1',                      // see clientIpFor()
      DELIVERY_OFFER_TTL_MINUTES: '0',       // an assigned offer never lapses while a test is looking at it
      RIDER_PRESENCE_TTL_SECONDS: '3600',    // the rider stays "online" without a heartbeat for an hour
      ...(opts.env || {}),
    },
  });
  log(`stack up in ${Date.now() - t0} ms at ${stack.baseUrl}`);
  const { baseUrl, db } = stack;

  const personas = {};
  const ids = {};
  const apis = {};
  let throwawayCount = 0;
  const apiFor = (label) => (apis[label] = apis[label] || new ClientApi(baseUrl, label));

  const fail = (persona, what, detail) => {
    const e = new Error(`fixture: could not provision persona "${persona}" (${what})${detail ? `: ${detail}` : ''}`);
    return e;
  };

  /** Sign up + confirm the emailed code + (optionally) the onboarding wizard. Returns the persona record (not stored). */
  async function makeAccount(label, id, { onboard = 'buyer' } = {}) {
    const api = apiFor(label);
    const email = `${label}.${runId}@e2e.loumoo.test`;
    const password = crypto.randomBytes(18).toString('base64url');
    let reg;
    try {
      reg = await P.registerAccount(api, { email, password, firstName: id.first, lastName: id.last, city: 'Douala', phone: id.phone });
    } catch (e) { throw fail(label, 'sign-up / verify-otp', e.message); }
    let state;
    try {
      state = onboard
        ? await P.completeOnboarding(api, reg.token, { intent: onboard, firstName: id.first, lastName: id.last, phone: id.phone, city: 'Douala', address: 'Rue de la Joie, Bonanjo', sellerType: 'individual' })
        : await P.accountState(api, reg.token);
    } catch (e) { throw fail(label, 'onboarding', e.message); }
    const profileId = await P.profileIdFor(db, reg.userId);
    if (!profileId) throw fail(label, 'profile row', 'no iam.profiles row for the new user');
    return {
      name: label, email, password, userId: reg.userId, profileId, token: reg.token,
      firstName: id.first, lastName: id.last, phone: id.phone, state: state.state,
    };
  }

  async function buildAccount(label, { onboard = 'buyer' } = {}) {
    const persona = await makeAccount(label, IDENTITY[label], { onboard });
    personas[label] = persona;
    return persona;
  }

  /**
   * `unverified`: holds a session, but the profile's email is NOT verified
   * (state CONTACT_VERIFICATION_REQUIRED). Built as an ordinary verified account and
   * then un-verified with unverifyEmailLocal() (see there for why no route can do it).
   * POST /auth/login would mark the email verified again (it mirrors the auth
   * service's confirmation), so signIn('unverified') hands back the original token.
   */
  async function buildUnverified() {
    const p = await buildAccount('unverified', { onboard: null });
    try {
      await unverifyEmailLocal(db, p.userId);
      await bustProfileCache(apiFor('unverified'), p.token);
    } catch (e) { throw fail('unverified', 'clearing the email confirmation', e.message); }
    p.loginHealsState = true;
    return p;
  }

  /** `pending`: signed up, code not entered. No session exists (and none can); `devOtp` is the code, valid for 15 minutes. */
  async function buildPending() {
    const label = 'pending';
    const id = IDENTITY[label];
    const api = apiFor(label);
    const email = `${label}.${runId}@e2e.loumoo.test`;
    const password = crypto.randomBytes(18).toString('base64url');
    try {
      const r = await api.must('POST', '/api/v1/auth/signup', { body: { email, password, firstName: id.first, lastName: id.last, city: 'Douala', phone: id.phone } });
      personas[label] = {
        name: label, email, password, userId: null, profileId: null, token: null,
        firstName: id.first, lastName: id.last, phone: id.phone, state: null,
        devOtp: P.dataOf(r).devOtp || null, signedUpAt: new Date().toISOString(),
      };
    } catch (e) { throw fail(label, 'signup', e.message); }
  }

  /* ---------------------------------------------------------------- phase 1: accounts */
  const sellerP = (async () => {
    const seller = await buildAccount('seller', { onboard: 'seller' });
    const api = apiFor('seller');
    const storeName = `Fixture Electronics ${runId}`;
    try {
      const created = await api.call('POST', '/api/v1/stores', {
        token: seller.token,
        body: { name: storeName, categoryId: 'electronics', sellerType: 'SHOP', description: 'Hermetic fixture boutique for authorization tests.', city: 'Douala', phoneNumber: '+237690000199' },
      });
      if (created.status !== 201 && created.status !== 200) throw new Error(`POST /stores -> ${created.status} ${short(created.body)}`);
      const active = await P.ensureActiveStore(api, seller.token, { name: storeName, category: 'electronics', city: 'Douala' });
      if (active.state !== 'SELLER_READY') throw new Error(`after activation the seller is ${active.state}, not SELLER_READY`);
      ids.storeId = active.storeId;
      const mine = P.dataOf(await api.must('GET', '/api/v1/stores/me', { token: seller.token })).store;
      ids.storeSlug = mine.slug;
      ids.storeName = mine.name;
    } catch (e) { throw fail('seller', 'store', e.message); }
    try {
      const listing = await P.ensurePublishedListing(api, seller.token, {
        categoryId: 'smartphones',
        listingType: 'PHYSICAL_PRODUCT',
        title: `Fixture Phone ${runId}`,
        description: 'A sealed handset used by the hermetic authorization tests. One-year warranty, official Cameroon distribution.',
        condition: 'new',
        currency: 'XAF',
        basePriceMinor: 85000,
        city: 'douala',
        attributes: { brand: 'Samsung', model: 'Galaxy S24 Ultra', storage: '256GB', ram: '12GB', color: 'Black' },
        inventory: { trackInventory: true, quantity: 25 },
      });
      ids.listingId = listing.id;
      ids.listingTitle = `Fixture Phone ${runId}`;
      ids.listingPriceXaf = 85000;
      if (String(listing.status).toUpperCase() !== 'PUBLISHED') throw new Error(`listing status is ${listing.status}, not PUBLISHED`);
    } catch (e) { throw fail('seller', 'listing', e.message); }
    return seller;
  })();

  const others = [
    buildAccount('customer'),
    buildAccount('stranger'),
    buildAccount('rider'),
    buildAccount('admin'),
    buildAccount('superadmin'),
    buildAccount('suspended'),
    buildAccount('onboarding', { onboard: null }),
    buildUnverified(),
    buildPending(),
  ];

  await Promise.all([sellerP, ...others]);

  // The three local, no-route-exists role/status changes.
  try {
    await P.promoteAdminLocal(db, personas.admin.userId);
    await bustProfileCache(apiFor('admin'), personas.admin.token);
    await promoteSuperAdminLocal(db, personas.superadmin.userId);
    await bustProfileCache(apiFor('superadmin'), personas.superadmin.token);
    await suspendAccountLocal(db, personas.suspended.userId);
    await bustProfileCache(apiFor('suspended'), personas.suspended.token);
  } catch (e) { throw fail('admin/superadmin/suspended', 'role or status change', e.message); }

  /* ---------------------------------------------------------------- phase 2: rider, orders, delivery */
  const adminApi = apiFor('admin');
  const sellerApi = apiFor('seller');
  const riderApi = apiFor('rider');
  const mustOk = async (api, what, method, path, o, expect) => {
    const r = await api.call(method, path, o);
    if (!(expect || [200, 201]).includes(r.status)) throw new Error(`${what}: ${method} ${path} -> ${r.status} ${short(r.body)}`);
    return r;
  };

  try {
    const driver = await P.registerRider(adminApi, personas.admin.token, personas.rider.profileId, { name: `${IDENTITY.rider.first} ${IDENTITY.rider.last}`, phone: IDENTITY.rider.phone });
    if (!driver || driver.status !== 'active') throw new Error(`rider status is ${driver && driver.status}`);
    await mustOk(riderApi, 'rider goes online', 'POST', '/api/v1/deliveries/driver/presence/online', { token: personas.rider.token, body: {} });
  } catch (e) { throw fail('rider', 'registration / presence', e.message); }

  const shipping = (p) => ({ fullName: `${p.firstName} ${p.lastName}`, phone: p.phone, street: 'Rue de la Joie', neighbourhood: 'Bonanjo', city: 'Douala' });
  const placeOrder = async (label) => {
    const p = personas[label];
    const r = await mustOk(apiFor(label), `${label} places an order`, 'POST', '/api/v1/orders', {
      token: p.token,
      body: { items: [{ listingId: ids.listingId, quantity: 1 }], deliveryMethod: 'HOME_DELIVERY', shippingAddress: shipping(p) },
    }, [201]);
    return P.dataOf(r).order;
  };

  let order; let strangerOrder;
  try {
    order = await placeOrder('customer');
    ids.orderId = order.id; ids.orderNumber = order.orderNumber;
    if (order.sellerId !== personas.seller.profileId) throw new Error(`the order's sellerId is ${order.sellerId}, not the seller's profile ${personas.seller.profileId}`);
    strangerOrder = await placeOrder('stranger');
    ids.strangerOrderId = strangerOrder.id; ids.strangerOrderNumber = strangerOrder.orderNumber;
  } catch (e) { throw fail('customer/stranger', 'order', e.message); }

  try {
    const created = await mustOk(sellerApi, 'seller creates the delivery', 'POST', '/api/v1/deliveries', {
      token: personas.seller.token, body: { orderId: ids.orderId, dropoffLocation: { lat: 4.0511, lng: 9.7679 } },
    }, [201]);
    ids.deliveryId = P.dataOf(created).delivery.id;
    const assigned = await mustOk(sellerApi, 'seller assigns the rider', 'POST', `/api/v1/deliveries/${ids.deliveryId}/assign`, {
      token: personas.seller.token, body: { driverId: personas.rider.profileId },
    });
    const status = P.dataOf(assigned).delivery.status;
    if (status !== 'assigned') throw new Error(`delivery status after assigning is ${status}, not assigned`);
  } catch (e) { throw fail('seller/rider', 'delivery', e.message); }
  ids.riderProfileId = personas.rider.profileId;
  ids.sellerProfileId = personas.seller.profileId;

  /* ---------------------------------------------------------------- verify what we built */
  for (const label of Object.keys(personas)) {
    const p = personas[label];
    if (!p.token) continue;
    const r = await apiFor(label).call('GET', '/api/v1/me/state', { token: p.token });
    if (label === 'suspended') {
      if (r.status !== 403) throw fail(label, 'suspension', `GET /me/state answered ${r.status} (expected 403): the profile cache was not refreshed`);
      p.state = 'SUSPENDED';
      continue;
    }
    if (r.status !== 200) throw fail(label, 'session', `GET /me/state -> ${r.status} ${short(r.body)}`);
    const d = P.dataOf(r);
    if (d.state !== EXPECTED_STATE[label]) throw fail(label, 'state', `expected ${EXPECTED_STATE[label]}, got ${d.state}`);
    const wantRole = { admin: 'admin', superadmin: 'super_admin', seller: 'seller' }[label] || 'customer';
    if (d.user.primaryRole !== wantRole) throw fail(label, 'role', `expected primaryRole ${wantRole}, got ${d.user.primaryRole} (profile cache not refreshed?)`);
    p.state = d.state;
    p.primaryRole = d.user.primaryRole;
  }

  /* ---------------------------------------------------------------- the fixture object */
  const client = (token, override) => {
    if (override) return apiFor(override);
    if (!token) return apiFor('anonymous');
    const owner = Object.keys(personas).find((k) => personas[k].token === token);
    return apiFor(owner || `token:${crypto.createHash('sha1').update(token).digest('hex').slice(0, 8)}`);
  };

  const fx = {
    baseUrl, stack, personas, ids, runId,
    startupMs: Date.now() - t0,

    /**
     * One HTTP call to the real server. Returns { status, body, headers }.
     * opts: { token, body, headers, raw, client } (client: persona label whose rate-limit bucket to use).
     */
    api(method, path, opts = {}) {
      return client(opts.token, opts.client).call(method, path, { body: opts.body, token: opts.token, headers: opts.headers, raw: opts.raw });
    },

    /**
     * A fresh session token from POST /api/v1/auth/login. Not possible for `pending`
     * (no session exists), `suspended` (login refuses a suspended account) and
     * `unverified` (login would mark the email verified, destroying the persona's
     * state, so its original token is returned instead).
     */
    async signIn(name) {
      const p = personas[name];
      if (!p) throw new Error(`signIn: no persona "${name}" (have ${Object.keys(personas).join(', ')})`);
      if (!p.token) throw new Error(`signIn(${name}): this persona has no session and cannot sign in (signed up, code not entered)`);
      if (p.loginHealsState) return p.token;
      const r = await apiFor(name).call('POST', '/api/v1/auth/login', { body: { email: p.email, password: p.password } });
      if (r.status !== 200) {
        const e = new Error(`signIn(${name}): POST /auth/login -> ${r.status} ${short(r.body)}`);
        e.response = r;
        throw e;
      }
      return P.dataOf(r).token;
    },

    /**
     * Headers for a BROWSER context so it gets its own rate-limit bucket (the API allows 120 requests a
     * minute per client address). Without them a browser's requests land in the single `peer:127.0.0.1`
     * bucket that all of the fixture's own traffic also counts against, and a page opened right after
     * startFixture() is answered 429. Use a different `label` per browser context.
     */
    clientHeaders(label = 'browser') { return { 'x-forwarded-for': clientIpFor(`browser:${label}`) }; },

    /** The localStorage entries the SPA needs to start already signed in as `name` (src/services/clerkSession.js). */
    localStorageFor(name) {
      const p = personas[name];
      if (!p || !p.token) throw new Error(`localStorageFor(${name}): no session token`);
      return { loumoo_token: p.token };
    },

    /**
     * Opens GET path with the given token and aborts after `ms` (default 2500) or after
     * the first event, whichever is first. Never leaves a connection open.
     * Returns { status, contentType, text } (text = what arrived before the abort).
     */
    async probeStream(path, { token, ms = 2500, client: who } = {}) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), ms);
      const headers = { 'x-forwarded-for': client(token, who).clientIp };
      if (token) headers.authorization = `Bearer ${token}`;
      let text = '';
      try {
        const res = await fetch(baseUrl + path, { headers, signal: ac.signal });
        const contentType = res.headers.get('content-type') || '';
        if (!/text\/event-stream/i.test(contentType)) {
          return { status: res.status, contentType, text: await res.text() };
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            text += dec.decode(value, { stream: true });
            if (/\n\n[\s\S]*\n\n/.test(text) || /event: status\ndata: .*\n\n/.test(text)) break;
          }
        } catch (_) { /* aborted */ }
        return { status: res.status, contentType, text };
      } catch (e) {
        if (ac.signal.aborted) return { status: 0, contentType: '', text, aborted: true };
        throw e;
      } finally {
        clearTimeout(timer);
        ac.abort();
      }
    },

    /** A throw-away verified buyer account (never one of the personas), made through the app's routes. */
    async throwaway(label = 'throwaway') {
      const tag = `${label}${++throwawayCount}`;
      const p = await makeAccount(tag, { first: 'Tess', last: 'Throwaway', phone: `+2376900002${String(throwawayCount).padStart(2, '0')}` }, { onboard: 'buyer' });
      p.api = apiFor(tag);
      return p;
    },

    /**
     * A throw-away SELLER with a store created WITHOUT a business phone (the store
     * must not inherit the owner's account phone), left in DRAFT until
     * `activate()` is called. After activation (PATCH /stores/:id/location + onboarding
     * ACTIVE, the app's own routes) the account is SELLER_READY with role 'seller'.
     */
    async throwawaySeller(label = 'tseller') {
      const tag = `${label}${++throwawayCount}`;
      const p = await makeAccount(tag, { first: 'Tess', last: 'Throwaway', phone: `+2376900002${String(throwawayCount).padStart(2, '0')}` }, { onboard: 'seller' });
      const api = apiFor(tag);
      const name = `Rival Boutique ${runId} ${throwawayCount}`;
      const created = await api.call('POST', '/api/v1/stores', { token: p.token, body: { name, categoryId: 'electronics', sellerType: 'SHOP', description: 'A second boutique, owned by someone else.', city: 'Douala' } });
      if (created.status !== 201 && created.status !== 200) throw new Error(`throwawaySeller: POST /stores -> ${created.status} ${short(created.body)}`);
      const store = P.dataOf(created);
      p.api = api;
      p.storeId = store.id;
      p.storeSlug = store.slug;
      p.activate = async () => {
        await api.must('PATCH', `/api/v1/stores/${store.id}/location`, { token: p.token, body: { city: 'Douala', region: 'Littoral', country: 'CM' } });
        await api.must('PATCH', `/api/v1/stores/${store.id}/onboarding`, { token: p.token, body: { step: 'ACTIVE' } });
        const st = await P.accountState(api, p.token);
        if (st.state !== 'SELLER_READY') throw new Error(`throwawaySeller.activate: account is ${st.state}, not SELLER_READY`);
        return st;
      };
      return p;
    },

    /** Public summary (no passwords) for logging. */
    describe() {
      const out = {};
      for (const [k, p] of Object.entries(personas)) out[k] = { email: p.email, state: p.state, primaryRole: p.primaryRole, profileId: p.profileId, hasToken: Boolean(p.token) };
      return { baseUrl, startupMs: fx.startupMs, ids, personas: out };
    },

    async stop() { await stack.stop(); },
  };

  log(`fixture ready in ${fx.startupMs} ms`);
  return fx;
}

module.exports = { startFixture, EXPECTED_STATE, IDENTITY, promoteSuperAdminLocal, suspendAccountLocal, unverifyEmailLocal, clientIpFor };
