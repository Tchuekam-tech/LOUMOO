/**
 * LOUMOO Integration Tests — Delivery tracking against the real database
 * ---------------------------------------------------------------------------
 * Drives the real Express app (real session guard, real error handler, real
 * rate limiter) over HTTP against the real Supabase database, with migration
 * 013 applied. The unit suites (delivery_domain / _service / _routes) prove the
 * logic with in-memory stand-ins; this one proves the parts they cannot:
 *
 *   - the SQL itself: constraints, the one-open-delivery-per-order index,
 *     compare-and-swap updates, foreign keys and the service-role-only RLS;
 *   - the real authentication guard and role lookup (admin, seller, buyer, rider);
 *   - the order status actually moving in iam.orders as the delivery progresses;
 *   - the live stream through the full middleware stack.
 *
 * When migration 013 has not been applied the suite prints a SKIPPED notice and
 * passes, so `npm test` stays usable on a database that is behind. Set
 * LOUMOO_REQUIRE_DELIVERY_DB=1 to make that a failure instead (CI).
 */

require('../setup');
const assert = require('assert');
const harness = require('../helpers/harness');

const { db } = harness;

// PostgREST answers PGRST205 for a table that is not in its schema cache; a
// plain Postgres error 42P01 means the same thing from a direct connection.
const MISSING_TABLE_CODES = ['PGRST205', '42P01'];

async function migrationIsApplied() {
  const { error } = await db().from('deliveries').select('id').limit(1);
  if (!error) return true;
  if (MISSING_TABLE_CODES.includes(error.code)) return false;
  throw new Error(`delivery_flow: could not probe iam.deliveries: ${error.code || ''} ${error.message}`);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The app's global limiter allows 120 requests a minute per peer, and every
// request from this process comes from the same peer (docs/DELIVERY_API.md,
// decision 7). This suite makes well over that in total, so it paces itself:
// never more than REQUEST_BUDGET requests in any rolling minute.
const REQUEST_BUDGET = 90;
const WINDOW_MS = 60 * 1000;
const sentAt = [];

async function pace() {
  for (;;) {
    const now = Date.now();
    while (sentAt.length && now - sentAt[0] >= WINDOW_MS) sentAt.shift();
    if (sentAt.length < REQUEST_BUDGET) {
      sentAt.push(now);
      return;
    }
    await sleep(WINDOW_MS - (now - sentAt[0]) + 25);
  }
}

/**
 * One paced HTTP call. A 429 that carries Retry-After comes from the global
 * limiter, so it is waited out and retried; a 429 without it (the per-user
 * stream cap) is a real answer and is returned as is.
 */
async function call(method, path, user, body) {
  for (let attempt = 0; ; attempt += 1) {
    await pace();
    const res = await harness.request(method, path, { token: user ? user.token : null, body });
    const retryAfter = Number(res.headers['retry-after']);
    if (res.status === 429 && retryAfter > 0 && attempt < 3) {
      await sleep(Math.min(retryAfter, 65) * 1000);
      continue;
    }
    return res;
  }
}

const api = (method, path, user, body) => call(method, `/api/v1/deliveries${path}`, user, body);
/**
 * Real principals, each a row in iam.profiles that the real session guard will
 * resolve: the seller of the goods, the buyer, a stranger, a rival seller (a
 * seller, but not of this order), an administrator and two riders.
 */
async function makeCast() {
  const seller = await harness.createUser({ stage: 'seller_ready' });
  const store = await harness.createStore(seller, { status: 'ACTIVE' });
  const listing = await harness.createListing(seller, store, {
    title: 'Delivery Test Blender',
    base_price_minor: 45000,
    currency: 'XAF',
    status: 'PUBLISHED'
  });

  const rival = await harness.createUser({ stage: 'seller_ready' });
  const buyer = await harness.createUser({ stage: 'ready' });
  const stranger = await harness.createUser({ stage: 'ready' });
  const rider = await harness.createUser({ stage: 'ready' });
  const rider2 = await harness.createUser({ stage: 'ready' });
  const admin = await harness.createUser({ stage: 'ready' });

  // Administrators are profiles with an admin primary role; promoting the row
  // before its first request means the role is read fresh by the session guard.
  const { error } = await db().from('profiles').update({ primary_role: 'admin' }).eq('id', admin.id);
  if (error) throw new Error(`delivery_flow: could not promote the admin: ${error.message}`);

  return { seller, store, listing, rival, buyer, stranger, rider, rider2, admin };
}
const createdOrderIds = [];

/** Places a real order through POST /api/v1/orders as the buyer. */
async function placeOrder(cast, { deliveryMethod = 'HOME_DELIVERY' } = {}) {
  const res = await call('POST', '/api/v1/orders', cast.buyer, {
    items: [{ listingId: cast.listing.id, quantity: 1 }],
    deliveryMethod,
    shippingAddress: {
      fullName: 'Awa Njoya',
      phone: '+237690123456',
      street: 'Rue de la Joie',
      neighbourhood: 'Bonanjo',
      city: 'Douala'
    }
  });
  assert.strictEqual(res.status, 201, `order placement failed: ${JSON.stringify(res.body)}`);
  const order = res.body.data.order;
  createdOrderIds.push(order.id);
  return order;
}

/** The order row as the database holds it, bypassing every cache. */
async function orderRow(orderId) {
  const { data, error } = await db().from('orders').select('*').eq('id', orderId).single();
  if (error) throw new Error(`delivery_flow: could not read order ${orderId}: ${error.message}`);
  return data;
}
// A point in Douala, and one a few hundred metres away for the rider's pings.
const DROPOFF = { lat: 4.0511, lng: 9.7679 };
const NEARBY = { lat: 4.0561, lng: 9.7679 };

/**
 * A fresh order with a delivery created by the seller and assigned to `rider`
 * (and accepted by them when `accept` is set). Returns { order, id }.
 */
async function openDelivery(cast, { rider = cast.rider, accept = false } = {}) {
  const order = await placeOrder(cast);
  const created = await api('POST', '/', cast.seller, { orderId: order.id, dropoffLocation: DROPOFF });
  assert.strictEqual(created.status, 201, `delivery creation failed: ${JSON.stringify(created.body)}`);
  const id = created.body.data.delivery.id;

  const assigned = await api('POST', `/${id}/assign`, cast.seller, { driverId: rider.id });
  assert.strictEqual(assigned.status, 200, `assign failed: ${JSON.stringify(assigned.body)}`);

  if (accept) {
    const accepted = await api('POST', `/${id}/accept`, rider);
    assert.strictEqual(accepted.status, 200, `accept failed: ${JSON.stringify(accepted.body)}`);
  }
  return { order, id };
}

/** A 4-digit code that is guaranteed not to be `code`. */
const wrongCodeFor = code => String((Number(code) + 1) % 10000).padStart(4, '0');
/**
 * Removes everything this suite created. Deliveries reference orders and
 * profiles with ON DELETE RESTRICT, so they (and then the orders) must go
 * before the harness deletes the profiles, or those deletes fail silently and
 * leave rows behind. Deleting a delivery cascades to its events and GPS trail.
 */
async function removeDeliveryData(cast) {
  const quiet = async fn => { try { return await fn(); } catch (e) { return { error: e }; } };

  if (createdOrderIds.length) {
    await quiet(() => db().from('deliveries').delete().in('order_id', createdOrderIds));
    await quiet(() => db().from('orders').delete().in('id', createdOrderIds));
  }
  if (cast) {
    await quiet(() => db().from('delivery_drivers').delete().in('profile_id', [cast.rider.id, cast.rider2.id]));
  }

  if (createdOrderIds.length) {
    const left = await quiet(() => db().from('orders').select('id', { count: 'exact', head: true }).in('id', createdOrderIds));
    if (left && left.count) console.warn(`  WARNING: ${left.count} test order(s) could not be removed.`);
  }
  createdOrderIds.length = 0;
}
async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  DELIVERY TRACKING — DATABASE-BACKED INTEGRATION TEST');
  console.log('═══════════════════════════════════════════════════════════\n');

  if (!(await migrationIsApplied())) {
    const message = 'Migration 013_delivery_tracking.sql is not applied to this database.';
    if (process.env.LOUMOO_REQUIRE_DELIVERY_DB === '1') throw new Error(message);
    console.log(`  SKIPPED: ${message}`);
    console.log('  Apply it, then re-run: node tests/integration/delivery_flow.test.js\n');
    return;
  }

  await harness.start();

  let cast = null;
  try {
    cast = await makeCast();
    // @@SECTIONS@@
  } finally {
    await removeDeliveryData(cast);
    await harness.cleanup();
  }
}

if (require.main === module) {
  run()
    .then(() => {
      // The app keeps timers alive (rate limiter, caches), so a standalone run
      // would hang after the last assertion. Give stdout a moment to flush.
      setTimeout(() => process.exit(0), 250).unref();
    })
    .catch(err => {
      console.error('Test Failed:', err);
      process.exit(1);
    });
}

module.exports = { run };
