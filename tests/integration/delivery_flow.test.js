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
    // ----------------------------------------------------------------- schema
    console.log('  Checking the migration surface...');
    for (const table of ['delivery_drivers', 'deliveries', 'delivery_events', 'driver_locations']) {
      const { error } = await db().from(table).select('*', { count: 'exact', head: true });
      assert.ok(!error, `the service role must reach iam.${table}: ${error && error.message}`);
    }
    // retain_days < 1 is refused by the function itself, which proves it exists
    // and is callable by the service role without deleting any GPS history.
    const prune = await db().rpc('prune_driver_locations', { retain_days: 0 });
    assert.ok(prune.error && /at least 1/.test(prune.error.message), 'prune_driver_locations rejects a retention below one day');
    console.log('    ✓ Tables and the retention function are reachable.');

    // --------------------------------------------------------- authentication
    console.log('  Checking the real session guard...');
    const forged = { token: 'not.a.real.session' };
    for (const [method, path] of [['GET', '/drivers'], ['GET', '/driver/me'], ['GET', '/dlv_x'], ['POST', '/'], ['POST', '/dlv_x/location'], ['GET', '/dlv_x/stream']]) {
      const anonymous = await api(method, path, null, method === 'POST' ? {} : undefined);
      assert.strictEqual(anonymous.status, 401, `${method} ${path} needs a session`);
      const bogus = await api(method, path, forged, method === 'POST' ? {} : undefined);
      assert.strictEqual(bogus.status, 401, `${method} ${path} rejects a forged token`);
    }
    console.log('    ✓ Anonymous and forged callers are refused on every kind of route.');

    // ----------------------------------------------------------------- riders
    console.log('  Registering riders...');
    const riderBody = { name: 'Alain Mbarga', phone: '+237600000001' };
    assert.strictEqual((await api('POST', `/drivers/${cast.rider.id}`, cast.seller, riderBody)).status, 403, 'a seller cannot register riders');
    assert.strictEqual((await api('POST', `/drivers/${cast.rider.id}`, cast.buyer, riderBody)).status, 403, 'a customer cannot register riders');
    assert.strictEqual((await api('POST', `/drivers/${cast.rider.id}`, cast.admin, { ...riderBody, role: 'admin' })).status, 400, 'unknown keys are refused');
    assert.strictEqual((await api('POST', `/drivers/${cast.rider.id}`, cast.admin, { ...riderBody, status: 'banished' })).status, 400, 'status must be active or suspended');
    assert.strictEqual((await api('POST', `/drivers/${cast.rider.id}`, cast.admin, { name: 'No Phone' })).status, 400, 'a phone number is required');

    // A rider row has a foreign key to iam.profiles. The unit suites cannot see
    // that constraint; against the real database an unknown account id must come
    // back as a clean 400, not a 500 from the raw Postgres error.
    const ghost = await api('POST', '/drivers/profile_that_does_not_exist', cast.admin, riderBody);
    assert.strictEqual(ghost.status, 400, `an unknown account id is a validation error: ${JSON.stringify(ghost.body)}`);

    const registered = await api('POST', `/drivers/${cast.rider.id}`, cast.admin, riderBody);
    assert.strictEqual(registered.status, 200, JSON.stringify(registered.body));
    assert.deepStrictEqual(registered.body.data.driver, { id: cast.rider.id, name: riderBody.name, phone: riderBody.phone, status: 'active' });
    const second = await api('POST', `/drivers/${cast.rider2.id}`, cast.admin, { name: 'Bruno Essomba', phone: '+237600000002' });
    assert.strictEqual(second.status, 200, JSON.stringify(second.body));

    const driverRow = (await db().from('delivery_drivers').select('*').eq('profile_id', cast.rider.id).single()).data;
    assert.strictEqual(driverRow.display_name, riderBody.name, 'the rider is stored in iam.delivery_drivers');
    assert.strictEqual(driverRow.status, 'active');
    assert.strictEqual(driverRow.created_by, cast.admin.id, 'the registering admin is recorded');

    const listed = await api('GET', '/drivers', cast.seller);
    assert.strictEqual(listed.status, 200, '/drivers is the rider list, not a delivery called "drivers"');
    const listedIds = listed.body.data.drivers.map(d => d.id);
    assert.ok(listedIds.includes(cast.rider.id) && listedIds.includes(cast.rider2.id), 'sellers see the active riders');
    assert.ok(listed.body.data.drivers.every(d => Object.keys(d).sort().join() === 'id,name,phone'), 'the list carries only id, name and phone');
    assert.strictEqual((await api('GET', '/drivers', cast.buyer)).status, 403, 'customers cannot list riders');
    assert.strictEqual((await api('GET', '/driver/me', cast.stranger)).status, 403, 'a non-rider has no rider overview');
    console.log('    ✓ Riders: registration rules, foreign key, listing and the rider overview guard.');

    // ----------------------------------------------------------------- create
    console.log('  Creating a delivery...');
    const order = await placeOrder(cast);
    assert.strictEqual((await api('POST', '/', cast.seller, {})).status, 400, 'orderId is required');
    assert.strictEqual((await api('POST', '/', cast.seller, { orderId: order.id, buyerId: cast.stranger.id })).status, 400, 'a privileged field is refused');
    assert.strictEqual((await api('POST', '/', cast.seller, { orderId: order.id, status: 'delivered' })).status, 400, 'a status cannot be injected');
    assert.strictEqual((await api('POST', '/', cast.seller, { orderId: order.id, dropoffLocation: { lat: 95, lng: 0 } })).status, 400, 'a latitude out of range is refused');
    assert.strictEqual((await api('POST', '/', cast.seller, { orderId: 'ord_does_not_exist' })).status, 404, 'an unknown order is a 404');
    assert.strictEqual((await api('POST', '/', cast.stranger, { orderId: order.id })).status, 404, 'a stranger gets 404, not 403');
    assert.strictEqual((await api('POST', '/', cast.rival, { orderId: order.id })).status, 404, 'a seller of another store gets 404');
    assert.strictEqual((await api('POST', '/', cast.buyer, { orderId: order.id })).status, 404, 'the buyer cannot create it either');

    const pickupOrder = await placeOrder(cast, { deliveryMethod: 'STORE_PICKUP' });
    const pickupTry = await api('POST', '/', cast.seller, { orderId: pickupOrder.id });
    assert.strictEqual(pickupTry.status, 409, 'a store-pickup order never gets a delivery');

    const created = await api('POST', '/', cast.seller, { orderId: order.id, dropoffLocation: DROPOFF });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    assert.strictEqual(created.body.success, true);
    const deliveryId = created.body.data.delivery.id;
    assert.strictEqual(created.body.data.delivery.status, 'pending_assignment');
    assert.strictEqual(created.body.data.delivery.viewerRole, 'seller');
    assert.strictEqual(created.body.data.delivery.orderId, order.id);
    assert.ok(/Bonanjo/.test(created.body.data.delivery.dropoff.area || ''), 'the area comes from the order address');

    const row = (await db().from('deliveries').select('*').eq('id', deliveryId).single()).data;
    assert.strictEqual(row.status, 'pending_assignment');
    assert.strictEqual(row.buyer_id, cast.buyer.id, 'the buyer is denormalised from the order');
    assert.strictEqual(row.seller_id, cast.seller.id, 'the seller is denormalised from the order');
    assert.strictEqual(row.driver_id, null);
    assert.strictEqual(row.handover_nonce, 1);
    assert.strictEqual(row.code_attempts, 0);
    const firstEvents = (await db().from('delivery_events').select('*').eq('delivery_id', deliveryId).order('id')).data;
    assert.strictEqual(firstEvents.length, 1, 'one timeline entry for the creation');
    assert.strictEqual(firstEvents[0].status, 'pending_assignment');
    assert.strictEqual((await orderRow(order.id)).fulfillment_status, 'processing', 'creating a delivery leaves the order alone');

    const duplicate = await api('POST', '/', cast.seller, { orderId: order.id });
    assert.strictEqual(duplicate.status, 409, 'one open delivery per order');
    assert.strictEqual(duplicate.body.error.code, 'CONFLICT');

    // Four tabs, one parcel. The partial unique index
    // uq_deliveries_one_open_per_order is what makes this safe; the service's own
    // existing-delivery check alone would let several through.
    const raceOrder = await placeOrder(cast);
    const race = await Promise.all([1, 2, 3, 4].map(() => api('POST', '/', cast.seller, { orderId: raceOrder.id })));
    const winners = race.filter(r => r.status === 201);
    assert.strictEqual(winners.length, 1, 'exactly one concurrent create wins: ' + race.map(r => r.status).join(','));
    assert.ok(race.filter(r => r !== winners[0]).every(r => r.status === 409), 'the losers get a clean 409');
    const raceRows = (await db().from('deliveries').select('id').eq('order_id', raceOrder.id)).data;
    assert.strictEqual(raceRows.length, 1, 'and the database holds a single delivery for the order');

    // Row Level Security: only the service role may touch these tables. The
    // handover nonce and attempt counter must never be reachable with the public
    // key, whatever the API layer does.
    const { SupabaseDatabase } = require('../../server/infrastructure/database/SupabaseClient');
    for (const table of ['deliveries', 'delivery_events', 'delivery_drivers', 'driver_locations']) {
      const viaAnon = await SupabaseDatabase.getPublic().from(table).select('*').limit(5);
      assert.ok(viaAnon.error || (viaAnon.data || []).length === 0, 'the public key must not read iam.' + table);
    }
    const anonWrite = await SupabaseDatabase.getPublic().from('deliveries').update({ status: 'delivered' }).eq('id', deliveryId).select();
    assert.ok(anonWrite.error || (anonWrite.data || []).length === 0, 'the public key must not write deliveries');
    assert.strictEqual((await db().from('deliveries').select('status').eq('id', deliveryId).single()).data.status, 'pending_assignment', 'and the delivery is unchanged');
    console.log('    ✓ Creation: guards, rows, the one-open-delivery index under a race, and RLS.');

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
