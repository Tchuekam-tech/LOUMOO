/**
 * LOUMOO — Test Harness
 * ---------------------------------------------------------------------------
 * Boots the real Express app against the real database and provisions real
 * principals at each point of the account lifecycle.
 *
 * Deliberately NOT mocked: the whole point of these suites is to prove that a
 * request which bypasses the UI still hits real guards, real ownership checks
 * and real validation. A mocked auth layer would prove nothing.
 *
 * Test authentication uses the `loumoo_test:<secret>:<clerkUserId>` scheme,
 * which `ClerkIdentityProvider` accepts ONLY when NODE_ENV is not 'production'
 * and LOUMOO_TEST_AUTH_SECRET is set. `tests/setup.js` guarantees both.
 */

require('../setup');

const http = require('http');
const crypto = require('crypto');

const app = require('../../server/index');
const config = require('../../server/config/env');
const { SupabaseDatabase } = require('../../server/infrastructure/database/SupabaseClient');
const { ONBOARDING_STATUS, SELLER_STATUS, ONBOARDING_STEPS } = require('../../server/modules/identity/domain/AccountState');
const { TEST_SUPER_ADMIN_SUBJECT } = require('../../SuperAdmin/backend/middleware/superAdminGuard');

let server = null;
let baseUrl = null;
const createdProfiles = [];
const createdStores = [];
const createdListings = [];

const db = () => SupabaseDatabase.getAdmin();

/* ------------------------------------------------------------------ server */

async function start() {
  if (server) return baseUrl;
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

async function stop() {
  if (server) {
    await new Promise(resolve => server.close(resolve));
    server = null;
    baseUrl = null;
  }
}

/* ------------------------------------------------------------------- HTTP  */

/**
 * Issues a raw HTTP request against the running app.
 * @returns {Promise<{status:number, body:any, headers:object}>}
 */
async function request(method, path, { token = null, body = undefined, raw = null, headers = {} } = {}) {
  await start();

  const init = { method, headers: { ...headers } };
  if (token) init.headers.Authorization = `Bearer ${token}`;

  const bodyAllowed = !['GET', 'HEAD'].includes(method.toUpperCase());

  if (raw && bodyAllowed) {
    init.body = raw;
    init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/octet-stream';
  } else if (body !== undefined && bodyAllowed) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

  return {
    status: res.status,
    body: parsed,
    headers: Object.fromEntries(res.headers.entries())
  };
}

/* -------------------------------------------------------------- principals */

function tokenFor(clerkUserId) {
  return `loumoo_test:${config.testAuth.secret}:${clerkUserId}`;
}

/**
 * Token for the one test subject the SuperAdmin guard treats as a super
 * administrator. It needs no profile row — the guard resolves it from the
 * verified test token alone — so suites using it stay hermetic.
 */
function superAdminToken() {
  return tokenFor(TEST_SUPER_ADMIN_SUBJECT);
}

/**
 * Creates a profile at a chosen point in the lifecycle.
 *
 * @param {object} options
 * @param {'unverified'|'verified'|'onboarding'|'ready'|'seller_onboarding'|'seller_ready'} options.stage
 */
async function createUser({ stage = 'ready', suffix = '' } = {}) {
  const unique = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}${suffix}`;
  const clerkUserId = `user_test_${unique}`;

  const row = {
    clerk_user_id: clerkUserId,
    email: `${unique}@loumoo-test.cm`,
    first_name: 'Test',
    last_name: 'Principal',
    city: 'douala',
    primary_role: 'customer',
    status: 'active',
    account_status: 'active',
    onboarding_status: ONBOARDING_STATUS.NOT_STARTED,
    seller_status: SELLER_STATUS.NONE
  };

  const now = new Date().toISOString();

  if (stage !== 'unverified') row.email_verified_at = now;

  if (stage === 'onboarding') {
    row.onboarding_status = ONBOARDING_STATUS.IN_PROGRESS;
    row.onboarding_started_at = now;
  }

  if (['ready', 'seller_onboarding', 'seller_ready'].includes(stage)) {
    row.onboarding_status = ONBOARDING_STATUS.COMPLETED;
    row.onboarding_started_at = now;
    row.onboarding_completed_at = now;
  }

  if (stage === 'seller_onboarding') row.seller_status = SELLER_STATUS.ONBOARDING;
  if (stage === 'seller_ready') {
    row.seller_status = SELLER_STATUS.READY;
    row.primary_role = 'seller';
  }

  const { data, error } = await db().from('profiles').insert(row).select('*').single();
  if (error) throw new Error(`harness: could not create ${stage} user: ${error.message}`);

  createdProfiles.push(data.id);

  // Mirror the derived onboarding step rows so `nextStep` resolves correctly.
  if (row.onboarding_status !== ONBOARDING_STATUS.NOT_STARTED) {
    const keys = row.onboarding_status === ONBOARDING_STATUS.COMPLETED
      ? ONBOARDING_STEPS.filter(s => !s.sellerOnly).map(s => s.key)
      : ONBOARDING_STEPS.filter(s => s.derived).map(s => s.key);

    await db().from('onboarding_progress').upsert(
      keys.map(k => ({ user_id: data.id, step_key: k, status: 'COMPLETED', completed_at: now })),
      { onConflict: 'user_id,step_key' }
    );
  }

  return { ...data, token: tokenFor(clerkUserId), clerkUserId };
}

/** Creates an ACTIVE boutique owned by `user` and links it to their profile. */
async function createStore(user, { status = 'ACTIVE', name = null, id = null } = {}) {
  const unique = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const storeId = id || `store_test_${unique}`;
  const storeName = name || `Test Boutique ${unique}`;
  const slug = `${storeName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${unique}`;

  const { data, error } = await db().from('stores').insert({
    id: storeId,
    owner_id: user.id,
    name: storeName,
    slug,
    description: 'Harness-created boutique for automated tests.',
    category_id: 'electronics',
    phone_number: '+237690112233',
    email: user.email,
    status,
    visibility: 'PUBLIC',
    // Harness-created stores are flagged so they never reach a public surface (sitemap, store list).
    // Needs migration 023 applied to the target database (the hermetic PGlite DB applies it; a real
    // integration DB must have it before these suites run). Belt-and-suspenders: the name/slug also
    // match IndexingPolicy's test patterns, so filtering works even without the flag.
    is_test: true,
    onboarding_step: status === 'ACTIVE' ? 'ACTIVE' : 'IN_PROGRESS',
    onboarding_completed: status === 'ACTIVE'
  }).select('*').single();

  if (error) throw new Error(`harness: could not create store: ${error.message}`);
  createdStores.push(storeId);

  await db().from('store_members').insert({
    store_id: storeId,
    user_id: user.id,
    role: 'owner',
    permissions: ['*']
  });

  await db().from('profiles').update({ primary_store_id: storeId }).eq('id', user.id);

  return data;
}

async function createListing(user, store, overrides = {}) {
  const unique = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const { data, error } = await db().from('listings').insert({
    id: `lst_test_${unique}`,
    store_id: store.id,
    seller_id: user.id,
    listing_type: 'PHYSICAL_PRODUCT',
    category_id: 'smartphones',
    title: 'Harness Test Smartphone Listing',
    slug: `harness-test-listing-${unique}`,
    description: 'A listing created directly by the automated test harness for ownership checks.',
    condition: 'new',
    status: 'DRAFT',
    visibility: 'PUBLIC',
    currency: 'XAF',
    base_price_minor: 250000,
    fulfillment_model: 'DELIVERY_OR_PICKUP',
    metadata: { city: 'douala' },
    ...overrides
  }).select('*').single();

  if (error) throw new Error(`harness: could not create listing: ${error.message}`);
  createdListings.push(data.id);
  return data;
}

/* ------------------------------------------------------------ test fixtures */

/** A minimal but structurally valid 1x1-scaled PNG of the requested size. */
function makePng(width = 640, height = 480) {
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;    // bit depth
  ihdrData[9] = 6;    // colour type RGBA
  ihdrData[10] = 0;   // compression
  ihdrData[11] = 0;   // filter
  ihdrData[12] = 0;   // interlace

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };

  // Padding keeps the fixture above the service's minimum-size floor.
  const filler = Buffer.alloc(2048, 0x42);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdrData),
    chunk('IDAT', filler),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

/* ------------------------------------------------------------------ cleanup */

async function cleanup() {
  const quiet = async fn => { try { await fn(); } catch (e) { /* best effort */ } };

  for (const id of createdListings.splice(0)) {
    await quiet(() => db().from('listing_media').delete().eq('listing_id', id));
    await quiet(() => db().from('listings').delete().eq('id', id));
  }
  for (const id of createdStores.splice(0)) {
    await quiet(() => db().from('listings').delete().eq('store_id', id));
    await quiet(() => db().from('store_members').delete().eq('store_id', id));
    await quiet(() => db().from('stores').delete().eq('id', id));
  }
  for (const id of createdProfiles.splice(0)) {
    await quiet(() => db().schema('system').from('upload_sessions').delete().eq('owner_id', id));
    await quiet(() => db().from('onboarding_progress').delete().eq('user_id', id));
    await quiet(() => db().from('stores').delete().eq('owner_id', id));
    await quiet(() => db().from('profiles').delete().eq('id', id));
  }
  await stop();
}

module.exports = {
  start, stop, request, cleanup,
  createUser, createStore, createListing,
  tokenFor, superAdminToken, makePng,
  db
};
