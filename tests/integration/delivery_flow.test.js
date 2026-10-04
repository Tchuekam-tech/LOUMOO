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
const http = require('http');

async function waitFor(predicate, what, ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const value = predicate();
    if (value) return value;
    await sleep(25);
  }
  throw new Error('Timed out waiting for ' + what);
}

/**
 * Opens a Server-Sent Events stream the way the real client must: a plain HTTP
 * request with an Authorization header (the browser's native EventSource cannot
 * send one), asking for gzip so a buffering compression layer would show up.
 * Parses the standard framing into { type, data } events.
 */
async function openStream(path, user) {
  const base = await harness.start();
  await pace();
  return new Promise((resolve, reject) => {
    const stream = { events: [], buffer: '', raw: '', status: null, headers: null, ended: false, req: null };
    const headers = { 'Accept-Encoding': 'gzip' };
    if (user) headers.Authorization = 'Bearer ' + user.token;
    const req = http.get(base + path, { headers }, res => {
      stream.status = res.statusCode;
      stream.headers = res.headers;
      res.setEncoding('utf8');
      res.on('data', chunk => {
        stream.raw += chunk;
        stream.buffer += chunk;
        let at;
        while ((at = stream.buffer.indexOf('\n\n')) !== -1) {
          const block = stream.buffer.slice(0, at);
          stream.buffer = stream.buffer.slice(at + 2);
          const event = { type: 'message', data: null };
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) event.type = 'comment';
            else if (line.startsWith('event: ')) event.type = line.slice(7);
            else if (line.startsWith('retry: ')) { event.type = 'retry'; event.data = Number(line.slice(7)); }
            else if (line.startsWith('data: ')) event.data = JSON.parse(line.slice(6));
          }
          stream.events.push(event);
        }
      });
      res.on('end', () => { stream.ended = true; });
      res.on('close', () => { stream.ended = true; });
      resolve(stream);
    });
    stream.req = req;
    req.on('error', err => { if (!stream.ended) reject(err); });
  });
}

const closeStream = stream => { try { stream.req.destroy(); } catch (e) { /* already gone */ } };
const typesOf = stream => stream.events.filter(e => e.type !== 'retry' && e.type !== 'comment').map(e => e.type);
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
    // v1.1 added the workload count (docs/DELIVERY_API.md, GET /drivers). Updated by the
    // driver-assignment branch WITHOUT running this suite (it needs the live database).
    assert.ok(listed.body.data.drivers.every(d => Object.keys(d).sort().join() === 'id,name,openDeliveries,phone'), 'the list carries id, name, phone and the workload count, and nothing else');
    assert.ok(listed.body.data.drivers.every(d => Number.isInteger(d.openDeliveries) && d.openDeliveries >= 0), 'openDeliveries is a count');
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

    // ------------------------------------------------------------------ reads
    console.log('  Reading deliveries as each participant...');
    assert.strictEqual((await api('GET', '/' + deliveryId, cast.stranger)).status, 404, 'a stranger gets 404');
    assert.strictEqual((await api('GET', '/' + deliveryId, cast.rival)).status, 404, 'so does another seller');
    assert.strictEqual((await api('GET', '/dlv_does_not_exist', cast.buyer)).status, 404, 'an unknown id is a 404');
    const buyerView = await api('GET', '/' + deliveryId, cast.buyer);
    assert.strictEqual(buyerView.status, 200);
    assert.strictEqual(buyerView.body.data.delivery.viewerRole, 'buyer');
    assert.strictEqual(buyerView.body.data.delivery.driver, null, 'no rider is shown before one is assigned');
    assert.strictEqual((await api('GET', '/' + deliveryId, cast.seller)).body.data.delivery.viewerRole, 'seller');
    assert.strictEqual((await api('GET', '/' + deliveryId, cast.admin)).body.data.delivery.viewerRole, 'admin');

    assert.strictEqual((await api('GET', '/by-order/' + order.id, cast.buyer)).body.data.delivery.id, deliveryId, 'lookup by order id');
    assert.strictEqual((await api('GET', '/by-order/' + order.orderNumber, cast.seller)).body.data.delivery.id, deliveryId, 'lookup by order number');
    assert.strictEqual((await api('GET', '/by-order/' + order.id, cast.stranger)).status, 404, 'a stranger cannot look an order up');

    // ----------------------------------------------------------------- assign
    console.log('  Assigning a rider...');
    assert.strictEqual((await api('POST', '/' + deliveryId + '/assign', cast.buyer, { driverId: cast.rider.id })).status, 403, 'the buyer is a participant but cannot assign a rider');
    assert.strictEqual((await api('POST', '/' + deliveryId + '/assign', cast.rival, { driverId: cast.rider.id })).status, 404, 'another seller cannot either');
    assert.strictEqual((await api('POST', '/' + deliveryId + '/assign', cast.seller, {})).status, 400, 'driverId is required');
    assert.strictEqual((await api('POST', '/' + deliveryId + '/assign', cast.seller, { driverId: cast.rider.id, status: 'delivered' })).status, 400, 'no status injection');
    assert.strictEqual((await api('POST', '/' + deliveryId + '/assign', cast.seller, { driverId: 'profile_that_does_not_exist' })).status, 400, 'an unknown rider is refused');
    assert.strictEqual((await api('POST', '/' + deliveryId + '/assign', cast.seller, { driverId: cast.stranger.id })).status, 400, 'a profile that is not a registered rider is refused');

    const assigned = await api('POST', '/' + deliveryId + '/assign', cast.seller, { driverId: cast.rider.id });
    assert.strictEqual(assigned.status, 200, JSON.stringify(assigned.body));
    assert.strictEqual(assigned.body.data.delivery.status, 'assigned');
    assert.strictEqual(assigned.body.data.delivery.driver.id, cast.rider.id);
    const assignedRow = (await db().from('deliveries').select('*').eq('id', deliveryId).single()).data;
    assert.strictEqual(assignedRow.driver_id, cast.rider.id, 'the rider is stored on the delivery');
    assert.ok(assignedRow.assigned_at, 'assigned_at is stamped');
    const buyerBeforeAccept = (await api('GET', '/' + deliveryId, cast.buyer)).body.data.delivery;
    assert.strictEqual(buyerBeforeAccept.driver, null, 'the buyer is not told who until the rider accepts');

    // A rider who has not accepted is shown the job card only: an area and a
    // point rounded to about a kilometre. Never the customer's name, phone,
    // street or exact location.
    const mine = await api('GET', '/driver/me', cast.rider);
    assert.strictEqual(mine.status, 200, JSON.stringify(mine.body));
    assert.strictEqual(mine.body.data.driver.id, cast.rider.id);
    const job = mine.body.data.deliveries.find(d => d.id === deliveryId);
    assert.ok(job, 'the assigned delivery is on the rider overview');
    assert.deepStrictEqual(Object.keys(job.dropoff).sort(), ['area', 'location'], 'a coarse drop-off only');
    assert.deepStrictEqual(job.dropoff.location, { lat: 4.05, lng: 9.77 }, 'the point is rounded to two decimals');
    for (const secret of ['Awa Njoya', '+237690123456', 'Rue de la Joie']) {
      assert.ok(!JSON.stringify(mine.body).includes(secret), 'the rider overview must not reveal ' + secret);
    }
    assert.strictEqual((await api('GET', '/' + deliveryId, cast.rider2)).status, 404, 'a rider who is not assigned cannot read it');

    // ----------------------------------------------------------------- accept
    console.log('  Accepting the job...');
    assert.strictEqual((await api('POST', '/' + deliveryId + '/accept', cast.stranger)).status, 404, 'a stranger gets 404');
    assert.strictEqual((await api('POST', '/' + deliveryId + '/accept', cast.rider2)).status, 404, 'a rider who is not assigned gets 404');
    assert.strictEqual((await api('POST', '/' + deliveryId + '/accept', cast.seller)).status, 403, 'the seller is a participant but not the rider');
    assert.strictEqual((await api('POST', '/' + deliveryId + '/accept', cast.buyer)).status, 403, 'the buyer is a participant but not the rider');

    // The same rider tapping twice: the compare-and-swap lets exactly one through.
    const taps = await Promise.all([api('POST', '/' + deliveryId + '/accept', cast.rider), api('POST', '/' + deliveryId + '/accept', cast.rider)]);
    assert.deepStrictEqual(taps.map(r => r.status).sort(), [200, 409], 'a double accept is one 200 and one 409: ' + taps.map(r => r.status).join(','));
    assert.strictEqual((await db().from('deliveries').select('status,accepted_at').eq('id', deliveryId).single()).data.status, 'accepted');
    assert.ok((await db().from('deliveries').select('accepted_at').eq('id', deliveryId).single()).data.accepted_at, 'accepted_at is stamped');

    const riderView = (await api('GET', '/' + deliveryId, cast.rider)).body.data.delivery;
    assert.strictEqual(riderView.viewerRole, 'driver');
    assert.ok(/Rue de la Joie/.test(riderView.dropoff.address || ''), 'after accepting, the rider sees the full address');
    const buyerAfterAccept = (await api('GET', '/' + deliveryId, cast.buyer)).body.data.delivery;
    assert.strictEqual(buyerAfterAccept.driver.id, cast.rider.id, 'the buyer now sees the rider');
    assert.strictEqual(buyerAfterAccept.driver.name, riderBody.name);

    // ---------------------------------------------------------- handover code
    console.log('  Checking who can read the handover code...');
    assert.strictEqual((await api('GET', '/' + deliveryId + '/code', cast.seller)).status, 403, 'the seller never sees the code');
    assert.strictEqual((await api('GET', '/' + deliveryId + '/code', cast.admin)).status, 403, 'nor does an admin');
    assert.strictEqual((await api('GET', '/' + deliveryId + '/code', cast.rider)).status, 403, 'nor the rider');
    assert.strictEqual((await api('GET', '/' + deliveryId + '/code', cast.stranger)).status, 404, 'a stranger gets 404');
    const codeRes = await api('GET', '/' + deliveryId + '/code', cast.buyer);
    assert.strictEqual(codeRes.status, 200, JSON.stringify(codeRes.body));
    const code = codeRes.body.data.code;
    assert.ok(/^\d{4}$/.test(code), 'the code is four digits');
    assert.strictEqual(codeRes.body.data.digits, 4);
    assert.strictEqual(codeRes.body.data.attemptsRemaining, 5);
    assert.strictEqual((await api('GET', '/' + deliveryId + '/code', cast.buyer)).body.data.code, code, 'the code is stable between reads');

    // Only the nonce is stored, so a database dump reveals no live code.
    const codeRow = (await db().from('deliveries').select('*').eq('id', deliveryId).single()).data;
    assert.ok(!Object.keys(codeRow).some(k => /code$/.test(k) && k !== 'code_attempts'), 'no column holds the code');
    assert.ok(!Object.values(codeRow).some(v => v === code), 'no stored value equals the code');
    assert.ok(Number.isInteger(codeRow.handover_nonce));
    console.log('    ✓ Reads, assignment, rider privacy, accept (with a race) and the code audience.');

    // -------------------------------------------------------------- locations
    console.log('  Posting GPS pings...');
    const pingPath = '/' + deliveryId + '/location';
    assert.strictEqual((await api('POST', pingPath, cast.rider, { lat: 'x', lng: 1 })).status, 400, 'a non-numeric latitude is refused');
    assert.strictEqual((await api('POST', pingPath, cast.rider, { lat: 95, lng: 0 })).status, 400, 'a latitude out of range is refused');
    assert.strictEqual((await api('POST', pingPath, cast.rider, { ...NEARBY, heading: 360 })).status, 400, 'a heading of 360 is refused');
    assert.strictEqual((await api('POST', pingPath, cast.rider, { ...NEARBY, speedKmh: -1 })).status, 400, 'a negative speed is refused');
    assert.strictEqual((await api('POST', pingPath, cast.rider, { ...NEARBY, accuracyM: 900 })).status, 400, 'a poor GPS fix is refused');
    assert.strictEqual((await api('POST', pingPath, cast.rider, { ...NEARBY, owner: 'me' })).status, 400, 'unknown keys are refused');
    assert.strictEqual((await api('POST', pingPath, cast.buyer, NEARBY)).status, 403, 'the buyer cannot post a position');
    assert.strictEqual((await api('POST', pingPath, cast.seller, NEARBY)).status, 403, 'neither can the seller');
    assert.strictEqual((await api('POST', pingPath, cast.stranger, NEARBY)).status, 404, 'a stranger gets 404');
    assert.strictEqual((await api('POST', pingPath, cast.rider2, NEARBY)).status, 404, 'an unassigned rider gets 404');
    const noTrail = await db().from('driver_locations').select('id', { count: 'exact', head: true }).eq('delivery_id', deliveryId);
    assert.strictEqual(noTrail.count, 0, 'refused pings leave no GPS rows');

    const firstPing = await api('POST', pingPath, cast.rider, { ...NEARBY, speedKmh: 18, heading: 359.99999, accuracyM: 8 });
    assert.strictEqual(firstPing.status, 200, JSON.stringify(firstPing.body));
    assert.strictEqual(firstPing.body.data.accepted, true);
    // ETA/distance are to the CUSTOMER and are only computed from pickup onward
    // (before that the rider is heading to the store); the contract shows them
    // null until picked_up, so an accepted-state ping carries null for both.
    assert.strictEqual(firstPing.body.data.etaMinutes, null, 'no ETA before pickup');
    assert.strictEqual(firstPing.body.data.distanceKm, null, 'and no distance-to-customer before pickup');

    // Throttle and plausibility compare the server clock against the last stored
    // point, so these pings go straight to the app WITHOUT the rate-limit pacer
    // (which can sleep for seconds) and the throttle check runs BEFORE the remote
    // DB reads below (also seconds) — otherwise a ping meant to land inside the 3s
    // window would arrive late and be accepted. A few unpaced calls stay under the limit.
    const ping = (user, body) => harness.request('POST', '/api/v1/deliveries' + pingPath, { token: user.token, body });

    // Immediately: a second point inside the 3s minimum interval is throttled.
    const tooSoon = await ping(cast.rider, NEARBY);
    assert.strictEqual(tooSoon.status, 200, 'an ignored ping is not an error');
    assert.deepStrictEqual(tooSoon.body.data, { accepted: false, reason: 'throttled' });

    // Only the first (accepted) point is stored — on the trail and the delivery row.
    const trail = (await db().from('driver_locations').select('*').eq('delivery_id', deliveryId)).data;
    assert.strictEqual(trail.length, 1, 'the accepted point is stored; the throttled one is not');
    assert.strictEqual(trail[0].driver_id, cast.rider.id);
    assert.strictEqual(trail[0].lat, NEARBY.lat);
    assert.strictEqual(trail[0].heading, 359.99999, 'a heading just under 360 survives the column (double precision, not float4)');
    const pinged = (await db().from('deliveries').select('last_location,eta_minutes,distance_km').eq('id', deliveryId).single()).data;
    assert.strictEqual(pinged.last_location.lat, NEARBY.lat, 'the latest point is on the delivery row');
    assert.strictEqual(pinged.eta_minutes, null, 'the delivery row carries no ETA while still accepted');
    assert.strictEqual(pinged.distance_km, null);

    // After the 3s window a nearby point is accepted.
    await sleep(3200);
    const secondPing = await ping(cast.rider, { lat: 4.0558, lng: 9.7679, speedKmh: 20 });
    assert.strictEqual(secondPing.body.data.accepted, true, 'three seconds later a new point is accepted: ' + JSON.stringify(secondPing.body));

    // ~110 km three seconds later is a GPS glitch, not a motorbike: rejected, not stored.
    await sleep(3200);
    const glitch = await ping(cast.rider, { lat: 5.0558, lng: 9.7679 });
    assert.strictEqual(glitch.status, 200);
    assert.deepStrictEqual(glitch.body.data, { accepted: false, reason: 'implausible_jump' });
    assert.strictEqual((await db().from('driver_locations').select('id', { count: 'exact', head: true }).eq('delivery_id', deliveryId)).count, 2, 'the glitch is not stored');

    // Before pickup the staff see the rider, the buyer does not.
    const sellerLive = (await api('GET', '/' + deliveryId, cast.seller)).body.data.delivery;
    assert.strictEqual(sellerLive.lastLocation.lat, 4.0558, 'the seller sees the latest accepted point');
    const buyerEarly = (await api('GET', '/' + deliveryId, cast.buyer)).body.data.delivery;
    assert.strictEqual(buyerEarly.lastLocation, null, 'the buyer sees no position before pickup');
    assert.strictEqual(buyerEarly.etaMinutes, null, 'and no ETA');
    assert.strictEqual(buyerEarly.distanceKm, null);

    // ----------------------------------------------------------------- pickup
    console.log('  Picking the parcel up...');
    const statusPath = '/' + deliveryId + '/status';
    assert.strictEqual((await api('POST', statusPath, cast.rider, {})).status, 400, 'a status is required');
    assert.strictEqual((await api('POST', statusPath, cast.rider, { status: 'delivered' })).status, 400, 'a rider cannot self-report delivered');
    assert.strictEqual((await api('POST', statusPath, cast.rider, { status: 'picked_up', rider: 'x' })).status, 400, 'unknown keys are refused');
    assert.strictEqual((await api('POST', statusPath, cast.seller, { status: 'picked_up' })).status, 403, 'the seller cannot move the rider along');
    assert.strictEqual((await api('POST', statusPath, cast.rider, { status: 'arrived' })).status, 409, 'arrived before picked_up is an illegal transition');
    assert.strictEqual((await orderRow(order.id)).fulfillment_status, 'processing', 'refused changes leave the order alone');

    const pickup = await api('POST', statusPath, cast.rider, { status: 'picked_up' });
    assert.strictEqual(pickup.status, 200, JSON.stringify(pickup.body));
    assert.strictEqual(pickup.body.data.delivery.status, 'picked_up');
    assert.strictEqual((await orderRow(order.id)).fulfillment_status, 'in_transit', 'pickup moves iam.orders to in_transit');
    assert.ok((await db().from('deliveries').select('picked_up_at').eq('id', deliveryId).single()).data.picked_up_at, 'picked_up_at is stamped');
    const viaOrders = await call('GET', '/api/v1/orders/' + order.id, cast.buyer);
    assert.strictEqual(viaOrders.status, 200, JSON.stringify(viaOrders.body));
    assert.strictEqual(viaOrders.body.data.order.fulfillmentStatus, 'in_transit', 'the buyer sees the new status through the ordinary order endpoint too (no stale cache)');

    // Once the parcel is on the road the buyer is shown where it is.
    const buyerLive = (await api('GET', '/' + deliveryId, cast.buyer)).body.data.delivery;
    assert.strictEqual(buyerLive.status, 'picked_up');
    assert.strictEqual(buyerLive.lastLocation.lat, 4.0558, 'the buyer now sees the rider position');
    assert.ok(Number.isInteger(buyerLive.etaMinutes), 'and an ETA');
    assert.ok(buyerLive.distanceKm > 0, 'and a distance');
    assert.ok(!('failureReason' in buyerLive) || buyerLive.failureReason === null, 'but never a failure reason');
    for (const hidden of ['handoverNonce', 'codeAttempts', 'handover_nonce', 'code_attempts']) {
      assert.ok(!JSON.stringify(buyerLive).includes(hidden), 'the delivery payload never carries ' + hidden);
    }

    // ------------------------------------------------------------- the stream
    console.log('  Opening the live stream through the full middleware stack...');
    const streamUrl = '/api/v1/deliveries/' + deliveryId + '/stream';
    const anonymousStream = await openStream(streamUrl, null);
    assert.strictEqual(anonymousStream.status, 401, 'the stream needs the Authorization header');
    const strangerStream = await openStream(streamUrl, cast.stranger);
    assert.strictEqual(strangerStream.status, 404, 'a stranger cannot stream');
    assert.strictEqual((await openStream('/api/v1/deliveries/dlv_does_not_exist/stream', cast.buyer)).status, 404);

    const buyerStream = await openStream(streamUrl, cast.buyer);
    const sellerStream = await openStream(streamUrl, cast.seller);
    assert.strictEqual(buyerStream.status, 200);
    assert.ok(/text\/event-stream/.test(buyerStream.headers['content-type']), 'served as event-stream');
    assert.ok(/no-transform/.test(buyerStream.headers['cache-control']), 'no-transform keeps compression from buffering the stream');
    assert.strictEqual(buyerStream.headers['content-encoding'], undefined, 'the stream is not compressed');
    await waitFor(() => typesOf(buyerStream).includes('status'), 'the buyer snapshot');
    await waitFor(() => typesOf(sellerStream).includes('status'), 'the seller snapshot');
    assert.strictEqual(buyerStream.events.find(e => e.type === 'status').data.status, 'picked_up', 'the snapshot is the current status');
    assert.ok(buyerStream.events.some(e => e.type === 'retry'), 'the client is told how long to wait before reconnecting');
    await waitFor(() => typesOf(buyerStream).includes('location'), 'the last position in the late-joiner snapshot');
    assert.strictEqual(buyerStream.events.find(e => e.type === 'location').data.lat, 4.0558, 'a late joiner gets the last accepted position');

    // A new point reaches both open streams within the request, no polling.
    await sleep(3200);
    const livePing = await api('POST', pingPath, cast.rider, { lat: 4.0555, lng: 9.7679, speedKmh: 21 });
    assert.strictEqual(livePing.body.data.accepted, true, JSON.stringify(livePing.body));
    await waitFor(() => buyerStream.events.some(e => e.type === 'location' && e.data.lat === 4.0555), 'the live position on the buyer stream');
    await waitFor(() => sellerStream.events.some(e => e.type === 'location' && e.data.lat === 4.0555), 'the live position on the seller stream');
    await waitFor(() => buyerStream.events.some(e => e.type === 'eta' && Number.isInteger(e.data.etaMinutes)), 'an ETA on the buyer stream');
    const wire = buyerStream.events.filter(e => e.type === 'location').pop().data;
    assert.strictEqual(wire.status, undefined, 'internal fields are not on the wire');
    assert.strictEqual(wire.nonce, undefined);
    console.log('    ✓ Stream: auth, snapshot, headers and live position through compression and the session guard.');

    // ------------------------------------------------------- arrive and hand over
    console.log('  Arriving and handing over...');
    const arrived = await api('POST', statusPath, cast.rider, { status: 'arrived' });
    assert.strictEqual(arrived.status, 200, JSON.stringify(arrived.body));
    assert.strictEqual((await orderRow(order.id)).fulfillment_status, 'in_transit', 'arriving does not complete the order');

    const completePath = '/' + deliveryId + '/complete';
    const attemptsUsed = async () => (await db().from('deliveries').select('code_attempts').eq('id', deliveryId).single()).data.code_attempts;
    assert.strictEqual((await api('POST', completePath, cast.rider, {})).status, 400, 'a code is required');
    assert.strictEqual((await api('POST', completePath, cast.rider, { code: 'abcd' })).status, 400, 'a malformed code is refused');
    assert.strictEqual((await api('POST', completePath, cast.rider, { code: '12345' })).status, 400, 'five digits is refused');
    assert.strictEqual(await attemptsUsed(), 0, 'a malformed code does not use a guess');
    assert.strictEqual((await api('POST', completePath, cast.buyer, { code })).status, 403, 'the buyer cannot complete it');
    assert.strictEqual((await api('POST', completePath, cast.seller, { code })).status, 403, 'neither can the seller');
    assert.strictEqual((await api('POST', completePath, cast.stranger, { code })).status, 404, 'a stranger gets 404');

    const wrong = await api('POST', completePath, cast.rider, { code: wrongCodeFor(code) });
    assert.strictEqual(wrong.status, 400, 'a wrong code is a 400');
    assert.strictEqual(wrong.body.error.message, 'Incorrect handover code', 'the top-level message names the failure');
    // The remaining-guess count is carried in the field detail, not the headline.
    const wrongDetail = (wrong.body.error.details || []).map(d => d.message).join(' ');
    assert.ok(/4\s+attempts?\s+left/i.test(wrongDetail), 'the detail says how many guesses are left: ' + wrongDetail);
    assert.strictEqual(await attemptsUsed(), 1, 'the wrong guess is counted in the database');
    assert.strictEqual((await api('GET', '/' + deliveryId + '/code', cast.buyer)).body.data.attemptsRemaining, 4, 'and the buyer can see how many remain');
    assert.strictEqual((await db().from('deliveries').select('status').eq('id', deliveryId).single()).data.status, 'arrived', 'a wrong code does not complete it');

    const done = await api('POST', completePath, cast.rider, { code });
    assert.strictEqual(done.status, 200, JSON.stringify(done.body));
    assert.strictEqual(done.body.data.delivery.status, 'delivered');
    assert.strictEqual((await orderRow(order.id)).fulfillment_status, 'delivered', 'the order is delivered in iam.orders');
    assert.ok((await db().from('deliveries').select('delivered_at').eq('id', deliveryId).single()).data.delivered_at, 'delivered_at is stamped');
    assert.strictEqual((await api('POST', completePath, cast.rider, { code })).status, 409, 'completing twice is refused');
    assert.notStrictEqual((await api('GET', '/' + deliveryId + '/code', cast.buyer)).status, 200, 'the code is no longer served once delivered');

    // Delivering ends every open stream, after the final status.
    await waitFor(() => buyerStream.events.some(e => e.type === 'end'), 'the end event on the buyer stream');
    await waitFor(() => sellerStream.events.some(e => e.type === 'end'), 'the end event on the seller stream');
    assert.strictEqual(buyerStream.events.find(e => e.type === 'end').data.reason, 'complete');
    assert.ok(buyerStream.events.some(e => e.type === 'status' && e.data.status === 'arrived'), 'the buyer saw arrived on the stream');
    const finalStatus = buyerStream.events.filter(e => e.type === 'status').pop();
    assert.strictEqual(finalStatus.data.status, 'delivered', 'the last status before the end is delivered');
    await waitFor(() => buyerStream.ended && sellerStream.ended, 'both streams to close');

    // The timeline is the complete, ordered story, and the GPS trail kept every accepted point.
    const story = (await db().from('delivery_events').select('status,previous_status,actor_id').eq('delivery_id', deliveryId).order('id')).data;
    assert.deepStrictEqual(story.map(e => e.status), ['pending_assignment', 'assigned', 'accepted', 'picked_up', 'arrived', 'delivered'], 'the timeline in order');
    assert.strictEqual(story[story.length - 1].actor_id, cast.rider.id, 'the rider is recorded as having delivered it');
    const apiTimeline = (await api('GET', '/' + deliveryId, cast.seller)).body.data.delivery.timeline;
    assert.deepStrictEqual(apiTimeline.map(e => e.status), story.map(e => e.status), 'the API timeline matches the table');
    assert.strictEqual((await db().from('driver_locations').select('id', { count: 'exact', head: true }).eq('delivery_id', deliveryId)).count, 3, 'three accepted points in the trail');
    console.log('    ✓ Full happy path: assign, accept, pings, pickup, arrive, code, delivered; order and streams follow.');

    // ------------------------------------------------------- after delivery
    console.log('  Guarding a delivered parcel...');
    const again = await api('POST', '/', cast.seller, { orderId: order.id });
    assert.strictEqual(again.status, 409, 'a delivered parcel never gets a second delivery');
    assert.ok(/delivered|processing/i.test(again.body.error.message), 'the refusal says why: ' + again.body.error.message);
    assert.strictEqual((await api('POST', '/' + deliveryId + '/cancel', cast.seller, { reason: 'too late' })).status, 409, 'a delivered delivery cannot be cancelled');
    assert.strictEqual((await api('POST', '/' + deliveryId + '/assign', cast.seller, { driverId: cast.rider2.id })).status, 409, 'nor re-assigned');
    const finished = await api('GET', '/by-order/' + order.id, cast.buyer);
    assert.strictEqual(finished.body.data.delivery.status, 'delivered', 'by-order falls back to the finished delivery');
    const riderAfter = (await api('GET', '/driver/me', cast.rider)).body.data.deliveries;
    assert.ok(!riderAfter.some(d => d.id === deliveryId), 'a finished job leaves the rider overview');

    // ---------------------------------------------------- five wrong codes: 423
    console.log('  Locking the handover after five wrong codes...');
    const lockJob = await openDelivery(cast, { accept: true });
    const lockId = lockJob.id;
    assert.strictEqual((await api('POST', '/' + lockId + '/status', cast.rider, { status: 'picked_up' })).status, 200);
    assert.strictEqual((await api('POST', '/' + lockId + '/status', cast.rider, { status: 'arrived' })).status, 200);
    const lockCode = (await api('GET', '/' + lockId + '/code', cast.buyer)).body.data.code;
    const lockGuess = wrongCodeFor(lockCode);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const miss = await api('POST', '/' + lockId + '/complete', cast.rider, { code: lockGuess });
      assert.strictEqual(miss.status, 400, 'wrong code ' + attempt + ' is a plain 400');
    }
    const lastMiss = await api('POST', '/' + lockId + '/complete', cast.rider, { code: lockGuess });
    assert.strictEqual(lastMiss.status, 423, 'the fifth wrong code locks the delivery with a real 423');
    assert.strictEqual(lastMiss.body.error.code, 'DELIVERY_LOCKED');
    assert.strictEqual((await db().from('deliveries').select('code_attempts').eq('id', lockId).single()).data.code_attempts, 5, 'five guesses recorded in the database');
    assert.strictEqual((await api('POST', '/' + lockId + '/complete', cast.rider, { code: lockCode })).status, 423, 'even the right code is now refused');
    assert.strictEqual((await api('POST', '/' + lockId + '/status', cast.rider, { status: 'failed', note: 'trying to escape the lock' })).status, 423, 'and reporting a failure is not a way out');
    assert.strictEqual((await db().from('deliveries').select('status').eq('id', lockId).single()).data.status, 'arrived', 'the delivery stays arrived');

    // Only an administrator can lift the lock.
    const unlockPath = '/' + lockId + '/resolve';
    assert.strictEqual((await api('POST', unlockPath, cast.seller, { action: 'unlock' })).status, 403, 'a seller cannot unlock');
    assert.strictEqual((await api('POST', unlockPath, cast.buyer, { action: 'unlock' })).status, 403, 'a buyer cannot unlock either (the role check runs before any lookup)');
    assert.strictEqual((await api('POST', unlockPath, cast.admin, { action: 'wipe' })).status, 400, 'an unknown action is refused');
    assert.strictEqual((await api('POST', unlockPath, cast.admin, { action: 'unlock', extra: 1 })).status, 400, 'unknown keys are refused');
    assert.strictEqual((await api('POST', unlockPath, cast.admin, { action: 'unlock' })).status, 200, 'an administrator can unlock');
    const unlocked = (await api('GET', '/' + lockId + '/code', cast.buyer)).body.data;
    assert.strictEqual(unlocked.attemptsRemaining, 5, 'the guess budget is refilled');
    assert.strictEqual((await db().from('deliveries').select('code_attempts,handover_nonce').eq('id', lockId).single()).data.code_attempts, 0);
    assert.ok((await db().from('deliveries').select('handover_nonce').eq('id', lockId).single()).data.handover_nonce >= 2, 'the nonce moved on, so the old code is retired');
    assert.strictEqual((await api('POST', '/' + lockId + '/complete', cast.rider, { code: unlocked.code })).status, 200, 'the new code completes it');
    assert.strictEqual((await orderRow(lockJob.order.id)).fulfillment_status, 'delivered');

    // Reconcile re-applies the order status and is idempotent.
    assert.strictEqual((await api('POST', '/' + lockId + '/reconcile', cast.seller)).status, 403, 'a seller cannot reconcile');
    const reconciled = await api('POST', '/' + lockId + '/reconcile', cast.admin);
    assert.strictEqual(reconciled.status, 200, JSON.stringify(reconciled.body));
    assert.deepStrictEqual(reconciled.body.data, { reconciled: true, deliveryStatus: 'delivered' });
    assert.strictEqual((await api('POST', '/' + lockId + '/reconcile', cast.admin)).status, 200, 'reconciling twice is fine');

    // Repair a drifted order: put it back to processing by hand, then reconcile.
    await db().from('orders').update({ fulfillment_status: 'processing' }).eq('id', lockJob.order.id);
    assert.strictEqual((await api('POST', '/' + lockId + '/reconcile', cast.admin)).status, 200);
    assert.strictEqual((await orderRow(lockJob.order.id)).fulfillment_status, 'delivered', 'reconcile walks the order back to delivered');

    // ------------------------------------------------------- failure and retry
    console.log('  Failing a delivery and retrying it with another rider...');
    const failJob = await openDelivery(cast, { accept: true });
    const failId = failJob.id;
    assert.strictEqual((await api('POST', '/' + failId + '/status', cast.rider, { status: 'picked_up' })).status, 200);
    assert.strictEqual((await api('POST', '/' + failId + '/status', cast.rider, { status: 'failed' })).status, 400, 'a failure needs a note');
    assert.strictEqual((await api('POST', '/' + failId + '/status', cast.rider, { status: 'failed', note: 'x'.repeat(501) })).status, 400, 'and the note is bounded');
    const failed = await api('POST', '/' + failId + '/status', cast.rider, { status: 'failed', note: 'Customer unreachable, phone off' });
    assert.strictEqual(failed.status, 200, JSON.stringify(failed.body));
    assert.strictEqual(failed.body.data.delivery.status, 'failed');
    assert.strictEqual(failed.body.data.delivery.failureReason, 'Customer unreachable, phone off', 'the rider sees the reason they gave');
    assert.strictEqual((await orderRow(failJob.order.id)).fulfillment_status, 'in_transit', 'a failed delivery leaves the order in_transit');
    assert.strictEqual((await api('GET', '/' + failId, cast.buyer)).body.data.delivery.failureReason, null, 'the buyer is not shown the failure reason');
    assert.strictEqual((await api('GET', '/' + failId, cast.seller)).body.data.delivery.failureReason, 'Customer unreachable, phone off', 'the seller is');
    const failedNonce = (await db().from('deliveries').select('handover_nonce').eq('id', failId).single()).data.handover_nonce;

    // Retry: another rider, a new code, and the first rider loses access.
    const retried = await api('POST', '/' + failId + '/assign', cast.seller, { driverId: cast.rider2.id });
    assert.strictEqual(retried.status, 200, JSON.stringify(retried.body));
    assert.strictEqual(retried.body.data.delivery.status, 'assigned');
    const retryRow = (await db().from('deliveries').select('handover_nonce,driver_id,failure_reason').eq('id', failId).single()).data;
    assert.ok(retryRow.handover_nonce > failedNonce, 'a retry issues a new handover code');
    assert.strictEqual(retryRow.driver_id, cast.rider2.id);
    assert.strictEqual((await api('GET', '/' + failId, cast.rider)).status, 404, 'the replaced rider loses access');
    assert.strictEqual((await api('POST', '/' + failId + '/accept', cast.rider)).status, 404, 'and cannot accept it any more');

    assert.strictEqual((await api('POST', '/' + failId + '/accept', cast.rider2)).status, 200);
    assert.strictEqual((await api('POST', '/' + failId + '/status', cast.rider2, { status: 'picked_up' })).status, 200);
    assert.strictEqual((await api('POST', '/' + failId + '/status', cast.rider2, { status: 'arrived' })).status, 200);
    const retryCode = (await api('GET', '/' + failId + '/code', cast.buyer)).body.data.code;
    assert.strictEqual((await api('POST', '/' + failId + '/complete', cast.rider2, { code: retryCode })).status, 200, 'the second rider completes it');
    assert.strictEqual((await orderRow(failJob.order.id)).fulfillment_status, 'delivered');
    const retryStory = (await db().from('delivery_events').select('status').eq('delivery_id', failId).order('id')).data.map(e => e.status);
    assert.deepStrictEqual(retryStory, ['pending_assignment', 'assigned', 'accepted', 'picked_up', 'failed', 'assigned', 'accepted', 'picked_up', 'arrived', 'delivered'], 'the timeline shows both attempts');

    // ------------------------------------------------------ decline and cancel
    console.log('  Declining and cancelling...');
    const cancelJob = await openDelivery(cast);
    const cancelId = cancelJob.id;
    assert.strictEqual((await api('POST', '/' + cancelId + '/cancel', cast.buyer, {})).status, 403, 'the buyer cannot cancel once a rider is assigned');
    assert.strictEqual((await api('POST', '/' + cancelId + '/cancel', cast.stranger, {})).status, 404, 'a stranger gets 404');
    assert.strictEqual((await api('POST', '/' + cancelId + '/cancel', cast.seller, { reason: 'x', nope: 1 })).status, 400, 'unknown keys are refused');

    const declined = await api('POST', '/' + cancelId + '/decline', cast.rider);
    assert.strictEqual(declined.status, 200, JSON.stringify(declined.body));
    assert.deepStrictEqual(declined.body.data.delivery, { id: cancelId, status: 'pending_assignment' }, 'a decline returns only the id and status');
    assert.strictEqual((await db().from('deliveries').select('driver_id').eq('id', cancelId).single()).data.driver_id, null, 'the rider is released');
    assert.strictEqual((await api('GET', '/' + cancelId, cast.rider)).status, 404, 'a rider who declined loses access');

    const buyerCancel = await api('POST', '/' + cancelId + '/cancel', cast.buyer, { reason: 'Changed my mind' });
    assert.strictEqual(buyerCancel.status, 200, 'the buyer may cancel while nobody is assigned: ' + JSON.stringify(buyerCancel.body));
    assert.strictEqual(buyerCancel.body.data.delivery.status, 'cancelled');
    assert.ok((await db().from('deliveries').select('cancelled_at').eq('id', cancelId).single()).data.cancelled_at, 'cancelled_at is stamped');
    assert.strictEqual((await orderRow(cancelJob.order.id)).fulfillment_status, 'processing', 'cancelling a delivery does not cancel the order');
    assert.strictEqual((await api('GET', '/by-order/' + cancelJob.order.id, cast.buyer)).body.data.delivery.status, 'cancelled', 'by-order shows the latest finished delivery');

    // The order is still processing, so the seller may start over with a new delivery.
    const restarted = await api('POST', '/', cast.seller, { orderId: cancelJob.order.id });
    assert.strictEqual(restarted.status, 201, 'a cancelled delivery frees the order: ' + JSON.stringify(restarted.body));
    assert.notStrictEqual(restarted.body.data.delivery.id, cancelId, 'it is a new delivery');
    assert.strictEqual((await db().from('deliveries').select('id', { count: 'exact', head: true }).eq('order_id', cancelJob.order.id)).count, 2, 'both rows are kept');

    // Cancelling the ORDER cancels its delivery while the parcel has not been collected.
    const cascadeJob = await openDelivery(cast, { accept: true });
    const orderCancel = await call('POST', '/api/v1/orders/' + cascadeJob.order.id + '/cancel', cast.buyer, { reason: 'Found it cheaper elsewhere' });
    assert.strictEqual(orderCancel.status, 200, JSON.stringify(orderCancel.body));
    assert.strictEqual((await orderRow(cascadeJob.order.id)).fulfillment_status, 'cancelled');
    const cascaded = (await db().from('deliveries').select('status,cancelled_at').eq('id', cascadeJob.id).single()).data;
    assert.strictEqual(cascaded.status, 'cancelled', 'cancelling the order cancelled the accepted delivery');
    assert.ok(cascaded.cancelled_at);
    const cascadeStory = (await db().from('delivery_events').select('status').eq('delivery_id', cascadeJob.id).order('id')).data.map(e => e.status);
    assert.strictEqual(cascadeStory[cascadeStory.length - 1], 'cancelled', 'and the timeline says so');

    // Once the rider has the parcel, neither side can cancel it away.
    const roadJob = await openDelivery(cast, { accept: true });
    assert.strictEqual((await api('POST', '/' + roadJob.id + '/status', cast.rider, { status: 'picked_up' })).status, 200);
    assert.strictEqual((await api('POST', '/' + roadJob.id + '/cancel', cast.seller, { reason: 'too late' })).status, 409, 'a seller cannot cancel a collected parcel');
    const lateOrderCancel = await call('POST', '/api/v1/orders/' + roadJob.order.id + '/cancel', cast.buyer, { reason: 'too late' });
    assert.ok(lateOrderCancel.status >= 400 && lateOrderCancel.status < 500, 'a buyer cannot cancel an in-transit order: ' + lateOrderCancel.status);
    assert.strictEqual((await db().from('deliveries').select('status').eq('id', roadJob.id).single()).data.status, 'picked_up', 'the delivery carries on');

    // -------------------------------------------------------- suspended riders
    console.log('  Suspending riders...');
    const queuedJob = await openDelivery(cast, { rider: cast.rider2 });
    const rider2Body = { name: 'Bruno Essomba', phone: '+237600000002' };
    const suspension = await api('POST', '/drivers/' + cast.rider2.id, cast.admin, { ...rider2Body, status: 'suspended' });
    assert.strictEqual(suspension.status, 200, JSON.stringify(suspension.body));
    assert.strictEqual(suspension.body.data.driver.status, 'suspended');
    const released = (await db().from('deliveries').select('status,driver_id').eq('id', queuedJob.id).single()).data;
    assert.deepStrictEqual(released, { status: 'pending_assignment', driver_id: null }, 'an un-started job goes back to the seller when the rider is suspended');

    assert.strictEqual((await api('GET', '/driver/me', cast.rider2)).status, 403, 'a suspended rider has no overview');
    assert.ok(!(await api('GET', '/drivers', cast.seller)).body.data.drivers.some(d => d.id === cast.rider2.id), 'and is not offered to sellers');
    assert.strictEqual((await api('POST', '/' + queuedJob.id + '/assign', cast.seller, { driverId: cast.rider2.id })).status, 400, 'a suspended rider cannot be assigned');

    // Editing the name must not quietly reactivate someone who was suspended.
    const renamed = await api('POST', '/drivers/' + cast.rider2.id, cast.admin, { name: 'Bruno E.', phone: rider2Body.phone });
    assert.strictEqual(renamed.body.data.driver.status, 'suspended', 'an omitted status leaves a suspended rider suspended');
    assert.strictEqual((await db().from('delivery_drivers').select('status').eq('profile_id', cast.rider2.id).single()).data.status, 'suspended');
    const reactivated = await api('POST', '/drivers/' + cast.rider2.id, cast.admin, { ...rider2Body, status: 'active' });
    assert.strictEqual(reactivated.body.data.driver.status, 'active', 'reactivating takes an explicit active');
    assert.strictEqual((await api('POST', '/' + queuedJob.id + '/assign', cast.seller, { driverId: cast.rider2.id })).status, 200, 'and the rider can be assigned again');

    // A rider suspended mid-job is refused, but a parcel already collected needs an admin.
    const suspendedMidJob = await api('POST', '/drivers/' + cast.rider.id, cast.admin, { ...riderBody, status: 'suspended' });
    assert.strictEqual(suspendedMidJob.status, 200);
    assert.strictEqual((await db().from('deliveries').select('status,driver_id').eq('id', roadJob.id).single()).data.status, 'picked_up', 'a collected parcel is not silently released');
    assert.strictEqual((await api('POST', '/' + roadJob.id + '/status', cast.rider, { status: 'arrived' })).status, 403, 'the suspended rider can no longer report progress');
    assert.strictEqual((await api('POST', '/' + roadJob.id + '/location', cast.rider, NEARBY)).status, 403, 'or post positions');
    assert.strictEqual((await api('POST', '/' + roadJob.id + '/resolve', cast.admin, { action: 'fail' })).status, 400, 'failing it needs a note');
    const adminFail = await api('POST', '/' + roadJob.id + '/resolve', cast.admin, { action: 'fail', note: 'Rider suspended with the parcel' });
    assert.strictEqual(adminFail.status, 200, JSON.stringify(adminFail.body));
    assert.strictEqual(adminFail.body.data.delivery.status, 'failed');
    assert.strictEqual((await api('POST', '/' + roadJob.id + '/assign', cast.seller, { driverId: cast.rider2.id })).status, 200, 'the seller can now hand it to another rider');
    console.log('    ✓ Failure and retry, locks, cancellation (and its cascade), suspension and admin repair.');

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
