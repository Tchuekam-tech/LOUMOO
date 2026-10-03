/**
 * LOUMOO — Delivery HTTP routes and live stream
 * ---------------------------------------------------------------------------
 * Drives the real delivery router over a real HTTP server (with the real error
 * handler and the real compression middleware, which is what buffers an SSE
 * stream if the headers are wrong) on top of the in-memory backends. No database.
 *
 * Authentication is replaced by a header-driven stand-in so the suite needs no
 * identity provider; a structural test pins that the PRODUCTION router puts
 * requireAuth in front of every single route.
 */

require('../setup');

const assert = require('assert');
const http = require('http');
const express = require('express');
const compression = require('compression');
const config = require('../../server/config/env');

const errorHandler = require('../../server/shared/middleware/errorHandler');
const { AuthenticationError } = require('../../server/shared/errors/AppError');
const { requireAuth } = require('../../server/modules/identity/presentation/guards/authGuard');
const productionRouter = require('../../server/modules/delivery/presentation/routes/deliveryRoutes');
const { createDeliveryRouter } = productionRouter;
const { DeliveryService } = require('../../server/modules/delivery/application/DeliveryService');
const { DeliveryRepository } = require('../../server/modules/delivery/infrastructure/DeliveryRepository');
const { DeliveryEvents } = require('../../server/modules/delivery/infrastructure/DeliveryEvents');
const { OrderRepository } = require('../../server/modules/commerce/infrastructure/OrderRepository');
const { Order, FULFILLMENT_STATUS, DELIVERY_METHOD, PAYMENT_STATUS } = require('../../server/modules/commerce/domain/Order');
const { eventForViewer } = require('../../server/modules/delivery/domain/Delivery');

const BUYER = 'buyer_1|customer';
const SELLER = 'seller_1|seller';
const ADMIN = 'admin_1|admin';
const RIDER = 'rider_1|customer';
const RIDER2 = 'rider_2|customer';
const STRANGER = 'stranger_1|customer';
const NEAR = { lat: 4.0511, lng: 9.7679 };

// Header-driven stand-in for requireAuth: "x-test-user: <id>|<role>".
function fakeAuth(req, res, next) {
  const header = req.headers['x-test-user'];
  if (!header) return next(new AuthenticationError('Authentication required.'));
  const [id, role = 'customer'] = String(header).split('|');
  req.principal = { id, primaryRole: role };
  req.userId = id;
  return next();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, what, ms = 3000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = predicate();
    if (v) return v;
    await sleep(15);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function main() {
  let t = Date.parse('2026-10-03T10:00:00.000Z');
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const orders = new OrderRepository({ db: null });
  const repo = new DeliveryRepository({ db: null });
  const events = new DeliveryEvents();
  const service = new DeliveryService({ repository: repo, orderRepository: orders, events, now: clock.now });

  // Stand-in for the live account lookup the production router performs: lets a
  // test suspend or demote a user while their stream is open.
  const revokedUsers = new Set();
  const demotedUsers = new Set();
  const revalidate = async (who) => {
    if (revokedUsers.has(who.userId)) return null;
    return demotedUsers.has(who.userId) ? { userId: who.userId, userRole: 'customer' } : who;
  };

  const limits = { heartbeatMs: 40, maxStreamMs: 60000, maxStreamsPerUser: 3 };
  const router = createDeliveryRouter({ service, authenticate: fakeAuth, events, revalidate, ...limits });
  const shortLivedRouter = createDeliveryRouter({ service, authenticate: fakeAuth, events, revalidate, heartbeatMs: 40, maxStreamMs: 200, maxStreamsPerUser: 3 });
  const LEAK_HEARTBEAT_MS = 37; // unique, so a leaked heartbeat interval is attributable to these routers
  const leakRouter = createDeliveryRouter({ service, authenticate: fakeAuth, events, revalidate, heartbeatMs: LEAK_HEARTBEAT_MS, maxStreamMs: 60000, maxStreamsPerUser: 50 });
  const noStreamRouter = createDeliveryRouter({ service, authenticate: fakeAuth, events, revalidate, streamSupported: false });

  const app = express();
  app.use(compression({ threshold: 0 })); // as in production: this is what buffers a badly-headed stream
  app.use(express.json());
  app.use('/api/v1/deliveries', router);
  app.use('/short/deliveries', shortLivedRouter);
  app.use('/leak/deliveries', leakRouter);
  app.use('/nostream/deliveries', noStreamRouter);
  app.use(errorHandler);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const openStreams = [];

  async function call(method, path, user, body) {
    // The timeout matters: if a stream route regressed and answered 200, fetch would
    // wait on the open response forever and stall the whole master test runner.
    const res = await fetch(base + path, {
      method,
      headers: { ...(user ? { 'x-test-user': user } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000)
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, body: json };
  }
  const api = (method, path, user, body) => call(method, `/api/v1/deliveries${path}`, user, body);

  function openStream(path, user) {
    return new Promise((resolve, reject) => {
      const st = { events: [], raw: '', ended: false, status: null, headers: null, buffer: '' };
      const req = http.get(base + path, { headers: { 'x-test-user': user, 'accept-encoding': 'gzip' } }, (res) => {
        st.status = res.statusCode;
        st.headers = res.headers;
        st.res = res;
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          st.raw += chunk;
          st.buffer += chunk;
          let idx;
          while ((idx = st.buffer.indexOf('\n\n')) !== -1) {
            const block = st.buffer.slice(0, idx);
            st.buffer = st.buffer.slice(idx + 2);
            const ev = { type: 'message', data: null };
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) ev.type = 'comment';
              else if (line.startsWith('event: ')) ev.type = line.slice(7);
              else if (line.startsWith('retry: ')) { ev.type = 'retry'; ev.data = Number(line.slice(7)); }
              else if (line.startsWith('data: ')) ev.data = JSON.parse(line.slice(6));
            }
            st.events.push(ev);
          }
        });
        res.on('end', () => { st.ended = true; });
        res.on('close', () => { st.ended = true; });
        resolve(st);
      });
      st.req = req;
      req.on('error', (err) => { if (!st.ended) reject(err); });
      openStreams.push(st);
    });
  }
  const typesOf = (st) => st.events.filter((e) => e.type !== 'retry' && e.type !== 'comment').map((e) => e.type);
  const closeStream = (st) => { try { st.req.destroy(); } catch (e) { /* gone */ } };

  async function placeOrder(overrides = {}) {
    const order = new Order({
      buyerId: 'buyer_1',
      sellerId: 'seller_1',
      items: [{ listingId: 'lst_1', title: 'Phone', unitPriceXaf: 50000, quantity: 1, sellerId: 'seller_1', storeName: 'Tech Shop' }],
      shippingAddress: { fullName: 'Awa Njoya', phone: '+237622222222', street: 'Rue 1', neighbourhood: 'Bonanjo', city: 'Douala' },
      deliveryMethod: DELIVERY_METHOD.HOME_DELIVERY,
      paymentStatus: PAYMENT_STATUS.PAID,
      fulfillmentStatus: FULFILLMENT_STATUS.PROCESSING,
      ...overrides
    });
    return orders.saveOrder(order);
  }

  async function newAssignedDelivery({ accept = false } = {}) {
    const order = await placeOrder();
    const created = await api('POST', '/', SELLER, { orderId: order.id, dropoffLocation: { lat: 4.0601, lng: 9.7679 } });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.delivery.id;
    assert.strictEqual((await api('POST', `/${id}/assign`, SELLER, { driverId: 'rider_1' })).status, 200);
    if (accept) assert.strictEqual((await api('POST', `/${id}/accept`, RIDER)).status, 200);
    return { order, id };
  }

  // The suite replaces notifications so nothing touches a real table.
  const NotificationService = require('../../server/modules/identity/application/NotificationService');
  const originalCreate = NotificationService.create;
  NotificationService.create = async () => null;
  const hadSecret = config.supabase.jwtSecret;
  if (!hadSecret) config.supabase.jwtSecret = 'unit-test-delivery-secret-0123456789abcdef';

  try {
    // ---------------------------------------------------------- route table
    {
      const table = productionRouter.stack
        .filter((l) => l.route)
        .flatMap((l) => Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path}`))
        .sort();
      const expected = [
        'GET /drivers', 'POST /drivers/:profileId', 'GET /driver/me', 'GET /by-order/:orderId', 'POST /',
        'GET /:id/stream', 'GET /:id/code', 'GET /:id',
        'POST /:id/assign', 'POST /:id/auto-assign', 'POST /:id/cancel', 'POST /:id/resolve', 'POST /:id/reconcile',
        'POST /:id/accept', 'POST /:id/decline', 'POST /:id/status', 'POST /:id/location', 'POST /:id/complete'
      ].sort();
      assert.deepStrictEqual(table, expected, 'the route table matches docs/DELIVERY_API.md (update both together)');

      // Every production route is behind the real authentication guard.
      for (const layer of productionRouter.stack.filter((l) => l.route)) {
        assert.strictEqual(layer.route.stack[0].handle, requireAuth, `${layer.route.path} must start with requireAuth`);
      }
      // Literal paths come before /:id so "drivers" is never read as a delivery id.
      const order = productionRouter.stack.filter((l) => l.route).map((l) => l.route.path);
      assert.ok(order.indexOf('/drivers') < order.indexOf('/:id'));
      assert.ok(order.indexOf('/driver/me') < order.indexOf('/:id/code'));
    }

    // The production router really does refuse anonymous callers (no database involved).
    {
      const prodApp = express();
      prodApp.use(express.json());
      prodApp.use('/d', productionRouter);
      prodApp.use(errorHandler);
      const prodServer = http.createServer(prodApp);
      await new Promise((resolve) => prodServer.listen(0, '127.0.0.1', resolve));
      const prodBase = `http://127.0.0.1:${prodServer.address().port}`;
      for (const [method, path] of [['GET', '/drivers'], ['GET', '/x1'], ['POST', '/'], ['GET', '/x1/stream'], ['POST', '/x1/location'], ['GET', '/x1/code']]) {
        const res = await fetch(prodBase + '/d' + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
        assert.strictEqual(res.status, 401, `${method} ${path} without a session is 401`);
      }
      await new Promise((resolve) => prodServer.close(resolve));
    }

    // ------------------------------------------------------- authentication
    for (const [method, path] of [['GET', '/drivers'], ['GET', '/driver/me'], ['GET', '/dlv_x'], ['POST', '/'], ['POST', '/dlv_x/location']]) {
      const r = await api(method, path, null, method === 'POST' ? {} : undefined);
      assert.strictEqual(r.status, 401, `${method} ${path} needs a session`);
      assert.strictEqual(r.body.error.code, 'UNAUTHENTICATED');
    }

    // ---------------------------------------------------------------- riders
    assert.strictEqual((await api('POST', '/drivers/rider_1', SELLER, { name: 'Alain', phone: '+237600000001' })).status, 403, 'only admins register riders');
    assert.strictEqual((await api('POST', '/drivers/rider_1', ADMIN, { name: 'Alain', phone: '+237600000001', role: 'admin' })).status, 400, 'unknown keys are rejected');
    assert.strictEqual((await api('POST', '/drivers/rider_1', ADMIN, { name: 'Alain', phone: '+237600000001', status: 'banished' })).status, 400, 'status must be a known value');
    const registered = await api('POST', '/drivers/rider_1', ADMIN, { name: 'Alain', phone: '+237600000001' });
    assert.strictEqual(registered.status, 200);
    assert.strictEqual(registered.body.data.driver.status, 'active');
    await api('POST', '/drivers/rider_2', ADMIN, { name: 'Bruno', phone: '+237600000002' });

    const listed = await api('GET', '/drivers', SELLER);
    assert.strictEqual(listed.status, 200, '/drivers is the rider list, not a delivery called "drivers"');
    assert.deepStrictEqual(listed.body.data.drivers.map((d) => d.id).sort(), ['rider_1', 'rider_2']);
    assert.strictEqual((await api('GET', '/drivers', BUYER)).status, 403, 'customers cannot list riders');
    assert.strictEqual((await api('GET', '/driver/me', STRANGER)).status, 403, 'non-riders have no rider overview');

    // ---------------------------------------------------------------- create
    const order = await placeOrder();
    assert.strictEqual((await api('POST', '/', SELLER, {})).status, 400, 'orderId is required');
    assert.strictEqual((await api('POST', '/', SELLER, { orderId: order.id, buyerId: 'attacker' })).status, 400, 'privileged fields are refused');
    assert.strictEqual((await api('POST', '/', SELLER, { orderId: order.id, status: 'delivered' })).status, 400, 'status cannot be injected on create');
    assert.strictEqual((await api('POST', '/', SELLER, { orderId: order.id, dropoffLocation: { lat: 1, lng: 2, alt: 3 } })).status, 400, 'strict nested objects');
    assert.strictEqual((await api('POST', '/', SELLER, { orderId: order.id, dropoffLocation: { lat: 95, lng: 0 } })).status, 400, 'range errors come from the service');
    assert.strictEqual((await api('POST', '/', STRANGER, { orderId: order.id })).status, 404, 'a stranger gets 404');
    const created = await api('POST', '/', SELLER, { orderId: order.id, dropoffLocation: { lat: 4.0601, lng: 9.7679 } });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.success, true);
    const deliveryId = created.body.data.delivery.id;
    assert.strictEqual(created.body.data.delivery.status, 'pending_assignment');
    assert.strictEqual(created.body.data.delivery.viewerRole, 'seller');
    const dup = await api('POST', '/', SELLER, { orderId: order.id });
    assert.strictEqual(dup.status, 409, 'one open delivery per order');
    assert.strictEqual(dup.body.error.code, 'CONFLICT');

    // ----------------------------------------------------------------- reads
    assert.strictEqual((await api('GET', `/${deliveryId}`, STRANGER)).status, 404);
    assert.strictEqual((await api('GET', '/dlv_nope', BUYER)).status, 404);
    const buyerView = await api('GET', `/${deliveryId}`, BUYER);
    assert.strictEqual(buyerView.status, 200);
    assert.strictEqual(buyerView.body.data.delivery.viewerRole, 'buyer');
    assert.strictEqual((await api('GET', `/by-order/${order.id}`, BUYER)).body.data.delivery.id, deliveryId);
    assert.strictEqual((await api('GET', `/by-order/${order.orderNumber}`, SELLER)).body.data.delivery.id, deliveryId, 'order number works');
    assert.strictEqual((await api('GET', `/by-order/${order.id}`, STRANGER)).status, 404);

    // ---------------------------------------------------------------- assign
    assert.strictEqual((await api('POST', `/${deliveryId}/assign`, BUYER, { driverId: 'rider_1' })).status, 403);
    assert.strictEqual((await api('POST', `/${deliveryId}/assign`, SELLER, {})).status, 400);
    assert.strictEqual((await api('POST', `/${deliveryId}/assign`, SELLER, { driverId: 'rider_1', status: 'delivered' })).status, 400, 'no status injection on assign');
    assert.strictEqual((await api('POST', `/${deliveryId}/assign`, SELLER, { driverId: 'ghost' })).status, 400);
    const assigned = await api('POST', `/${deliveryId}/assign`, SELLER, { driverId: 'rider_1' });
    assert.strictEqual(assigned.status, 200);
    assert.strictEqual(assigned.body.data.delivery.driver.id, 'rider_1');

    // ----------------------------------------------------------- rider flow
    const mine = await api('GET', '/driver/me', RIDER);
    assert.strictEqual(mine.status, 200);
    assert.deepStrictEqual(mine.body.data.deliveries.map((d) => d.id), [deliveryId]);
    assert.deepStrictEqual(Object.keys(mine.body.data.deliveries[0].dropoff).sort(), ['area', 'location'], 'before accepting, a coarse drop-off only');

    assert.strictEqual((await api('POST', `/${deliveryId}/accept`, STRANGER)).status, 404);
    assert.strictEqual((await api('POST', `/${deliveryId}/accept`, SELLER)).status, 403);
    assert.strictEqual((await api('POST', `/${deliveryId}/accept`, RIDER, { surprise: true })).status, 200, 'accept takes no body, extra keys on an empty action are ignored');
    assert.strictEqual((await api('POST', `/${deliveryId}/accept`, RIDER)).status, 409, 'second accept conflicts');

    assert.strictEqual((await api('POST', `/${deliveryId}/location`, RIDER, { lat: 'x', lng: 1 })).status, 400);
    assert.strictEqual((await api('POST', `/${deliveryId}/location`, RIDER, { ...NEAR, owner: 'me' })).status, 400, 'strict');
    assert.strictEqual((await api('POST', `/${deliveryId}/location`, RIDER, { ...NEAR, accuracyM: 900 })).status, 400, 'poor GPS fix refused');
    assert.strictEqual((await api('POST', `/${deliveryId}/location`, BUYER, { ...NEAR })).status, 403);
    const ping = await api('POST', `/${deliveryId}/location`, RIDER, { ...NEAR, speedKmh: 18, heading: 45, accuracyM: 8 });
    assert.strictEqual(ping.status, 200);
    assert.strictEqual(ping.body.data.accepted, true);
    clock.advance(1000);
    const throttled = await api('POST', `/${deliveryId}/location`, RIDER, { ...NEAR });
    assert.strictEqual(throttled.status, 200, 'an ignored ping is not an error');
    assert.deepStrictEqual(throttled.body.data, { accepted: false, reason: 'throttled' });

    assert.strictEqual((await api('POST', `/${deliveryId}/status`, RIDER, { status: 'delivered' })).status, 400, 'a rider cannot self-report delivered');
    assert.strictEqual((await api('POST', `/${deliveryId}/status`, RIDER, {})).status, 400);
    clock.advance(5000);
    const picked = await api('POST', `/${deliveryId}/status`, RIDER, { status: 'picked_up' });
    assert.strictEqual(picked.status, 200);
    assert.strictEqual((await orders.findOrderById(order.id)).fulfillmentStatus, FULFILLMENT_STATUS.IN_TRANSIT, 'pickup moved the order through the route');
    assert.strictEqual((await api('POST', `/${deliveryId}/status`, RIDER, { status: 'arrived' })).status, 200);

    // ----------------------------------------------------- handover & finish
    assert.strictEqual((await api('GET', `/${deliveryId}/code`, SELLER)).status, 403);
    assert.strictEqual((await api('GET', `/${deliveryId}/code`, STRANGER)).status, 404);
    const codeRes = await api('GET', `/${deliveryId}/code`, BUYER);
    assert.strictEqual(codeRes.status, 200);
    const code = codeRes.body.data.code;
    assert.ok(/^\d{4}$/.test(code));
    assert.strictEqual(codeRes.body.data.digits, 4);
    const wrong = String((Number(code) + 1) % 10000).padStart(4, '0');
    assert.strictEqual((await api('POST', `/${deliveryId}/complete`, RIDER, {})).status, 400);
    assert.strictEqual((await api('POST', `/${deliveryId}/complete`, RIDER, { code: 'abcd' })).status, 400);
    assert.strictEqual((await api('POST', `/${deliveryId}/complete`, RIDER, { code: wrong })).status, 400, 'wrong code');
    assert.strictEqual((await api('POST', `/${deliveryId}/complete`, BUYER, { code })).status, 403, 'the buyer cannot complete');
    const done = await api('POST', `/${deliveryId}/complete`, RIDER, { code });
    assert.strictEqual(done.status, 200);
    assert.strictEqual(done.body.data.delivery.status, 'delivered');
    assert.strictEqual((await orders.findOrderById(order.id)).fulfillmentStatus, FULFILLMENT_STATUS.DELIVERED);
    assert.strictEqual((await api('POST', `/${deliveryId}/complete`, RIDER, { code })).status, 409, 'replay refused');

    // --------------------------------------- 423 reaches the client as a 423
    {
      const { id } = await newAssignedDelivery({ accept: true });
      clock.advance(5000);
      await api('POST', `/${id}/location`, RIDER, { ...NEAR });
      clock.advance(5000);
      await api('POST', `/${id}/status`, RIDER, { status: 'picked_up' });
      await api('POST', `/${id}/status`, RIDER, { status: 'arrived' });
      const real = (await api('GET', `/${id}/code`, BUYER)).body.data.code;
      const bad = String((Number(real) + 1) % 10000).padStart(4, '0');
      let last;
      for (let i = 0; i < 5; i += 1) last = await api('POST', `/${id}/complete`, RIDER, { code: bad });
      assert.strictEqual(last.status, 423, 'the fifth wrong code locks the delivery with a real 423');
      assert.strictEqual(last.body.error.code, 'DELIVERY_LOCKED');
      assert.strictEqual((await api('POST', `/${id}/complete`, RIDER, { code: real })).status, 423, 'even the right code is refused');
      assert.strictEqual((await api('POST', `/${id}/status`, RIDER, { status: 'failed', note: 'escape' })).status, 423, 'and failing is not an escape');

      assert.strictEqual((await api('POST', `/${id}/resolve`, SELLER, { action: 'unlock' })).status, 403);
      assert.strictEqual((await api('POST', `/${id}/resolve`, ADMIN, { action: 'wipe' })).status, 400);
      assert.strictEqual((await api('POST', `/${id}/resolve`, ADMIN, { action: 'unlock', extra: 1 })).status, 400);
      assert.strictEqual((await api('POST', `/${id}/resolve`, ADMIN, { action: 'unlock' })).status, 200);
      const fresh = (await api('GET', `/${id}/code`, BUYER)).body.data;
      assert.strictEqual(fresh.attemptsRemaining, 5);
      assert.strictEqual((await api('POST', `/${id}/complete`, RIDER, { code: fresh.code })).status, 200);
      assert.strictEqual((await api('POST', `/${id}/reconcile`, SELLER)).status, 403);
      assert.strictEqual((await api('POST', `/${id}/reconcile`, ADMIN)).status, 200);
    }

    // ---------------------------------------------------- cancel / decline
    {
      const { id } = await newAssignedDelivery();
      assert.strictEqual((await api('POST', `/${id}/cancel`, BUYER, {})).status, 403, 'the buyer cannot cancel once a rider is assigned');
      assert.strictEqual((await api('POST', `/${id}/cancel`, SELLER, { reason: 'x', nope: 1 })).status, 400);
      const declined = await api('POST', `/${id}/decline`, RIDER);
      assert.strictEqual(declined.status, 200);
      assert.deepStrictEqual(declined.body.data.delivery, { id, status: 'pending_assignment' });
      const cancelled = await api('POST', `/${id}/cancel`, BUYER, { reason: 'Changed my mind' });
      assert.strictEqual(cancelled.status, 200, 'the buyer may cancel while nobody is assigned');
      assert.strictEqual(cancelled.body.data.delivery.status, 'cancelled');
    }

    // ------------------------------------------------------------ the stream
    {
      assert.strictEqual((await api('GET', '/dlv_nope/stream', BUYER)).status, 404);
      const { id } = await newAssignedDelivery();
      assert.strictEqual((await api('GET', `/${id}/stream`, STRANGER)).status, 404, 'strangers cannot stream');
      assert.strictEqual((await api('GET', `/${id}/stream`, null)).status, 401);

      const buyerStream = await openStream(`/api/v1/deliveries/${id}/stream`, BUYER);
      const sellerStream = await openStream(`/api/v1/deliveries/${id}/stream`, SELLER);
      assert.strictEqual(buyerStream.status, 200);
      assert.ok(/text\/event-stream/.test(buyerStream.headers['content-type']));
      assert.ok(/no-transform/.test(buyerStream.headers['cache-control']), 'no-transform keeps the compression middleware from buffering the stream');
      assert.strictEqual(buyerStream.headers['content-encoding'], undefined, 'the stream is not compressed');
      await waitFor(() => typesOf(buyerStream).includes('status'), 'the buyer snapshot');
      const snap = buyerStream.events.find((e) => e.type === 'status').data;
      assert.strictEqual(snap.status, 'assigned');
      assert.ok(buyerStream.events.some((e) => e.type === 'retry'), 'the client is told how long to wait before reconnecting');
      await waitFor(() => buyerStream.events.some((e) => e.type === 'comment'), 'a keep-alive comment');

      // Accept: both see it. Position before pickup: the seller sees it, the buyer does not.
      await api('POST', `/${id}/accept`, RIDER);
      await waitFor(() => buyerStream.events.some((e) => e.type === 'status' && e.data.status === 'accepted'), 'accepted on the buyer stream');
      clock.advance(5000);
      await api('POST', `/${id}/location`, RIDER, { ...NEAR, speedKmh: 20 });
      await waitFor(() => sellerStream.events.some((e) => e.type === 'location'), 'the seller sees the rider');
      await sleep(80);
      assert.ok(!typesOf(buyerStream).includes('location'), 'the buyer is NOT sent the rider position before pickup');
      assert.ok(!typesOf(buyerStream).includes('eta'));

      // After pickup the buyer gets position and ETA too.
      clock.advance(5000);
      await api('POST', `/${id}/status`, RIDER, { status: 'picked_up' });
      await waitFor(() => buyerStream.events.some((e) => e.type === 'status' && e.data.status === 'picked_up'), 'picked_up');
      // Move the rider ~0.65 km closer over 30 s (78 km/h: plausible), so the ETA actually changes.
      clock.advance(30000);
      await api('POST', `/${id}/location`, RIDER, { lat: 4.057, lng: 9.7679 });
      const live = await waitFor(() => buyerStream.events.find((e) => e.type === 'location'), 'a live position for the buyer');
      assert.strictEqual(live.data.lat, 4.057);
      assert.strictEqual(live.data.status, undefined, 'internal fields are not on the wire');
      await waitFor(() => buyerStream.events.some((e) => e.type === 'eta' && e.data.etaMinutes >= 1), 'an ETA for the buyer');

      // Connecting late still yields the current state, including the last position.
      const late = await openStream(`/api/v1/deliveries/${id}/stream`, BUYER);
      await waitFor(() => typesOf(late).includes('location'), 'the snapshot includes the last position');
      assert.strictEqual(late.events.find((e) => e.type === 'status').data.status, 'picked_up');
      closeStream(late);

      // Finishing the delivery ends every stream.
      await api('POST', `/${id}/status`, RIDER, { status: 'arrived' });
      const realCode = (await api('GET', `/${id}/code`, BUYER)).body.data.code;
      await api('POST', `/${id}/complete`, RIDER, { code: realCode });
      await waitFor(() => buyerStream.events.some((e) => e.type === 'end'), 'the end event');
      assert.strictEqual(buyerStream.events.find((e) => e.type === 'end').data.reason, 'complete');
      assert.ok(buyerStream.events.some((e) => e.type === 'status' && e.data.status === 'delivered'), 'the final status is delivered before the end');
      await waitFor(() => buyerStream.ended && sellerStream.ended, 'both streams to close');

      // A finished delivery: snapshot, then immediately closed.
      const after = await openStream(`/api/v1/deliveries/${id}/stream`, BUYER);
      await waitFor(() => after.ended, 'a finished delivery stream to close');
      assert.deepStrictEqual(typesOf(after).slice(-2), ['status', 'end']);
      assert.strictEqual(events.listenerCount(id), 0, 'nothing stays subscribed once a delivery\'s streams have all ended');
    }

    // A replaced rider loses their stream.
    {
      const { id } = await newAssignedDelivery();
      const riderStream = await openStream(`/api/v1/deliveries/${id}/stream`, RIDER);
      await waitFor(() => typesOf(riderStream).includes('status'), 'the rider snapshot');
      assert.strictEqual((await api('POST', `/${id}/assign`, SELLER, { driverId: 'rider_2' })).status, 200);
      await waitFor(() => riderStream.events.some((e) => e.type === 'end'), 'the access-revoked end');
      assert.strictEqual(riderStream.events.find((e) => e.type === 'end').data.reason, 'access_revoked');
      await waitFor(() => riderStream.ended, 'the replaced rider stream to close');
    }

    // Per-user cap, and the slot is released when a stream closes.
    {
      const { id } = await newAssignedDelivery();
      const held = [];
      for (let i = 0; i < limits.maxStreamsPerUser; i += 1) {
        const st = await openStream(`/api/v1/deliveries/${id}/stream`, BUYER);
        await waitFor(() => typesOf(st).includes('status'), `stream ${i + 1} to open`);
        held.push(st);
      }
      assert.strictEqual(router.openStreamCount(), limits.maxStreamsPerUser, 'the router counts open streams');
      const over = await api('GET', `/${id}/stream`, BUYER);
      assert.strictEqual(over.status, 429, 'a 4th concurrent stream is refused');
      assert.strictEqual(over.body.error.code, 'RATE_LIMITED');
      const otherUser = await openStream(`/api/v1/deliveries/${id}/stream`, SELLER);
      assert.strictEqual(otherUser.status, 200, 'the cap is per user, not global');
      held.push(otherUser);
      // 3 buyer streams + 1 seller stream are open; closing one frees exactly one slot.
      closeStream(held[0]);
      await waitFor(() => router.openStreamCount() === limits.maxStreamsPerUser, 'the closed stream to release its slot');
      const reopened = await openStream(`/api/v1/deliveries/${id}/stream`, BUYER);
      assert.strictEqual(reopened.status, 200, 'after a stream closes, the user can open another');
      await waitFor(() => typesOf(reopened).includes('status'), 'the reopened stream snapshot');
      held.push(reopened);
      for (const st of held.slice(1)) closeStream(st);
    }

    // Streams have a maximum life; the client reconnects.
    {
      const { id } = await newAssignedDelivery();
      const st = await openStream(`/short/deliveries/${id}/stream`, BUYER);
      await waitFor(() => st.events.some((e) => e.type === 'end'), 'the lifetime end', 2000);
      assert.strictEqual(st.events.find((e) => e.type === 'end').data.reason, 'timeout');
      await waitFor(() => st.ended, 'the stream to close after its lifetime');
    }

    // The live account is re-checked while a stream is open (suspension, deletion, demotion).
    {
      const { id } = await newAssignedDelivery();
      const buyerStream = await openStream(`/api/v1/deliveries/${id}/stream`, BUYER);
      await waitFor(() => typesOf(buyerStream).includes('status'), 'a buyer snapshot');
      revokedUsers.add('buyer_1'); // the account is suspended after the stream opened
      await waitFor(() => buyerStream.events.some((e) => e.type === 'end'), 'the revocation to close the stream', 2000);
      assert.strictEqual(buyerStream.events.find((e) => e.type === 'end').data.reason, 'access_revoked');
      revokedUsers.delete('buyer_1');

      const adminStream = await openStream(`/api/v1/deliveries/${id}/stream`, ADMIN);
      await waitFor(() => typesOf(adminStream).includes('status'), 'an admin snapshot');
      demotedUsers.add('admin_1'); // demoted: no longer an admin, and not a participant either
      await waitFor(() => adminStream.events.some((e) => e.type === 'end'), 'the demotion to close the stream', 2000);
      assert.strictEqual(adminStream.events.find((e) => e.type === 'end').data.reason, 'access_revoked', 'a demoted admin keeps nothing from their old role');
      demotedUsers.delete('admin_1');
    }

    // Slot reservation is race-free: a burst of simultaneous connects cannot exceed the cap.
    {
      const { id } = await newAssignedDelivery();
      await waitFor(() => router.openStreamCount() === 0, 'earlier streams to be released before the burst');
      const burst = await Promise.all(Array.from({ length: limits.maxStreamsPerUser + 2 }, () => openStream(`/api/v1/deliveries/${id}/stream`, BUYER)));
      const statuses = burst.map((b) => b.status).sort();
      assert.strictEqual(statuses.filter((c) => c === 200).length, limits.maxStreamsPerUser, 'exactly the cap is admitted');
      assert.strictEqual(statuses.filter((c) => c === 429).length, 2, 'the rest are refused');
      burst.forEach(closeStream);
      await waitFor(() => router.openStreamCount() === 0, 'the burst streams to be released');
      assert.strictEqual(events.listenerCount(id), 0, 'no subscription outlives its stream');
    }

    // A client that leaves while the snapshot is still loading leaks nothing.
    {
      const { id } = await newAssignedDelivery();
      const original = service.getDelivery.bind(service);
      service.getDelivery = async (...args) => { const r = await original(...args); await sleep(200); return r; };
      try {
        const st = await openStream(`/api/v1/deliveries/${id}/stream`, BUYER).catch(() => null);
        // the response has not started (snapshot pending); abandon the request
        const pending = new Promise((resolve) => setTimeout(resolve, 60));
        await pending;
        if (st) closeStream(st);
        await sleep(350);
      } finally {
        service.getDelivery = original;
      }
      assert.strictEqual(router.openStreamCount(), 0, 'the reserved slot is released when the client disconnects mid-snapshot');
      assert.strictEqual(events.listenerCount(id), 0, 'and so is the subscription');
    }

    // A terminal event that lands while the snapshot is loading ends the stream
    // cleanly and does NOT leave a heartbeat timer running behind it.
    {
      const liveHeartbeats = new Set();
      const realSetInterval = global.setInterval;
      const realClearInterval = global.clearInterval;
      global.setInterval = (fn, ms, ...rest) => {
        const handle = realSetInterval(fn, ms, ...rest);
        if (ms === LEAK_HEARTBEAT_MS) liveHeartbeats.add(handle);
        return handle;
      };
      global.clearInterval = (handle) => { liveHeartbeats.delete(handle); return realClearInterval(handle); };

      const original = service.getDelivery.bind(service);
      let slow = true;
      service.getDelivery = async (...args) => { const r = await original(...args); if (slow) await sleep(250); return r; };
      try {
        const { id } = await newAssignedDelivery();
        const streamPromise = openStream(`/leak/deliveries/${id}/stream`, BUYER);
        await sleep(60); // the snapshot was read (non-terminal) and is being held back
        slow = false;
        assert.strictEqual((await api('POST', `/${id}/cancel`, SELLER, { reason: 'while you were connecting' })).status, 200);
        const st = await streamPromise;
        await waitFor(() => st.ended, 'the stream to end after the buffered terminal event', 3000);
        assert.strictEqual(st.events.find((e) => e.type === 'end').data.reason, 'complete');
        await sleep(2 * LEAK_HEARTBEAT_MS + 20);
        assert.strictEqual(liveHeartbeats.size, 0, 'no heartbeat interval survives an ended stream');
        assert.ok(!st.events.some((e) => e.type === 'comment'), 'and no keep-alive was ever written to the closed stream');
      } finally {
        service.getDelivery = original;
        global.setInterval = realSetInterval;
        global.clearInterval = realClearInterval;
      }
      assert.strictEqual(leakRouter.openStreamCount(), 0);
    }

    // A GET that carries a body (read by express.json()) still gets its stream, not a hung response.
    {
      const { id } = await newAssignedDelivery();
      const st = await new Promise((resolve, reject) => {
        // A regression here means NO response at all, so the test itself must not wait forever.
        const hung = setTimeout(() => reject(new Error('a GET carrying a body was left hanging with no response')), 3000);
        const state = { events: [], buffer: '', ended: false, status: null };
        const req = http.request(`${base}/api/v1/deliveries/${id}/stream`, {
          method: 'GET',
          headers: { 'x-test-user': BUYER, 'content-type': 'application/json', 'content-length': 2 }
        }, (res) => {
          clearTimeout(hung);
          state.status = res.statusCode;
          state.res = res;
          res.setEncoding('utf8');
          res.on('data', (c) => { state.buffer += c; if (/event: status/.test(state.buffer)) state.sawStatus = true; });
          res.on('close', () => { state.ended = true; });
          resolve(state);
        });
        state.req = req;
        req.on('error', (e) => { if (!state.ended) reject(e); });
        req.write('{}');
        req.end();
        openStreams.push(state);
      });
      assert.strictEqual(st.status, 200, 'a GET with a body is answered');
      await waitFor(() => st.sawStatus, 'the snapshot on a GET-with-body stream');
      closeStream(st);
    }

    // Serverless runtimes answer at once instead of hanging.
    {
      const { id } = await newAssignedDelivery();
      const started = Date.now();
      const res = await call('GET', `/nostream/deliveries/${id}/stream`, BUYER);
      assert.strictEqual(res.status, 501);
      assert.strictEqual(res.body.error.code, 'STREAM_UNSUPPORTED');
      assert.ok(Date.now() - started < 1500, 'it answers immediately');
      assert.strictEqual((await call('GET', `/nostream/deliveries/${id}`, BUYER)).status, 200, 'polling the same delivery still works');
      assert.strictEqual(noStreamRouter.openStreamCount(), 0, 'no slot is ever reserved');
      assert.strictEqual((await call('GET', `/nostream/deliveries/${id}/stream`, null)).status, 401, 'unauthenticated callers still get 401, not 501');
      assert.strictEqual((await call('GET', `/nostream/deliveries/dlv_nope/stream`, BUYER)).status, 501, 'the unsupported answer does not depend on the delivery');
      assert.ok(productionRouter.isServerlessRuntime({ AWS_LAMBDA_FUNCTION_NAME: 'api' }));
      assert.ok(productionRouter.isServerlessRuntime({ NETLIFY: 'true' }));
      assert.ok(productionRouter.isServerlessRuntime({ VERCEL: '1' }));
      assert.ok(!productionRouter.isServerlessRuntime({}));
    }

    // Graceful shutdown ends every open stream with a reason.
    {
      const { id } = await newAssignedDelivery();
      const a = await openStream(`/api/v1/deliveries/${id}/stream`, BUYER);
      const b = await openStream(`/api/v1/deliveries/${id}/stream`, SELLER);
      await waitFor(() => typesOf(a).includes('status') && typesOf(b).includes('status'), 'both snapshots');
      router.closeAllStreams('server_restart');
      await waitFor(() => a.ended && b.ended, 'both streams to close on shutdown');
      assert.strictEqual(a.events.find((e) => e.type === 'end').data.reason, 'server_restart');
      assert.strictEqual(b.events.find((e) => e.type === 'end').data.reason, 'server_restart');
      assert.strictEqual(router.openStreamCount(), 0);
      router.closeAllStreams(); // idempotent with nothing open
    }

    // Validation details are bounded and flat.
    {
      const junk = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`junk${i}`, i]));
      const res = await api('POST', '/', SELLER, { orderId: 'x', ...junk });
      assert.strictEqual(res.status, 400);
      const details = res.body.error.details;
      assert.ok(Array.isArray(details) && details.length <= 5, `details are capped (${details && details.length})`);
      for (const d of details) {
        assert.deepStrictEqual(Object.keys(d).sort(), ['field', 'message']);
        assert.ok(String(d.message).length <= 200);
      }
      assert.ok(JSON.stringify(res.body).length < 2000, 'the error body stays small whatever the client sent');
    }

    // Editing a rider never silently reactivates a suspended one.
    {
      await api('POST', '/drivers/rider_suspended', ADMIN, { name: 'Chris', phone: '+237600000003', status: 'suspended' });
      const edited = await api('POST', '/drivers/rider_suspended', ADMIN, { name: 'Chris N.', phone: '+237600000003' });
      assert.strictEqual(edited.status, 200);
      assert.strictEqual(edited.body.data.driver.status, 'suspended', 'omitting status leaves it suspended');
      assert.strictEqual(edited.body.data.driver.name, 'Chris N.', 'but the edit applied');
      const reactivated = await api('POST', '/drivers/rider_suspended', ADMIN, { name: 'Chris N.', phone: '+237600000003', status: 'active' });
      assert.strictEqual(reactivated.body.data.driver.status, 'active', 'reactivating takes an explicit status');
      const brandNew = await api('POST', '/drivers/rider_fresh', ADMIN, { name: 'Dan', phone: '+237600000004' });
      assert.strictEqual(brandNew.body.data.driver.status, 'active', 'a new rider starts active');
    }

    // Every stream has been released.
    for (const st of openStreams) closeStream(st);
    await waitFor(() => router.openStreamCount() === 0 && shortLivedRouter.openStreamCount() === 0, 'all streams to be released', 4000);

    // ------------------------------------------------ eventForViewer, directly
    {
      const loc = { type: 'location', status: 'accepted', lat: 1, lng: 2, at: 't', speedKmh: 3, heading: 4 };
      assert.strictEqual(eventForViewer(loc, 'buyer'), null, 'buyer: no position before pickup');
      assert.deepStrictEqual(eventForViewer(loc, 'seller'), { lat: 1, lng: 2, at: 't', speedKmh: 3, heading: 4 });
      assert.deepStrictEqual(eventForViewer({ ...loc, status: 'picked_up' }, 'buyer'), { lat: 1, lng: 2, at: 't', speedKmh: 3, heading: 4 });
      assert.strictEqual(eventForViewer({ type: 'eta', status: 'assigned', etaMinutes: 3, distanceKm: 1 }, 'buyer'), null);
      assert.deepStrictEqual(eventForViewer({ type: 'eta', status: 'arrived', etaMinutes: 0, distanceKm: 0 }, 'buyer'), { etaMinutes: 0, distanceKm: 0 });
      assert.deepStrictEqual(
        eventForViewer({ type: 'status', status: 'accepted', at: 't', etaMinutes: 9, distanceKm: 2 }, 'buyer'),
        { status: 'accepted', at: 't', etaMinutes: null, distanceKm: null },
        'a buyer status event before pickup carries no ETA'
      );
      assert.strictEqual(eventForViewer({ type: 'status', status: 'accepted', at: 't', etaMinutes: 9, distanceKm: 2 }, 'driver').etaMinutes, 9);
      assert.strictEqual(eventForViewer({ type: 'mystery', status: 'accepted' }, 'seller'), null, 'unknown event types are dropped');
      assert.strictEqual(eventForViewer(null, 'seller'), null);
      assert.strictEqual(eventForViewer({}, 'seller'), null);
    }

    // -------------------------------- dispatch: auto-assign, rider list, offer expiry
    // Its own server and repositories: auto-assign ranks every active rider, so the
    // riders and deliveries the sections above left behind must not skew it.
    {
      const ordersD = new OrderRepository({ db: null });
      const repoD = new DeliveryRepository({ db: null });
      const eventsD = new DeliveryEvents();
      const OFFER_MS = 15 * 60 * 1000;
      const serviceD = new DeliveryService({ repository: repoD, orderRepository: ordersD, events: eventsD, now: clock.now, offerTtlMs: OFFER_MS });
      const appD = express();
      appD.use(express.json());
      appD.use('/d', createDeliveryRouter({ service: serviceD, authenticate: fakeAuth, events: eventsD, revalidate }));
      appD.use(errorHandler);
      const serverD = http.createServer(appD);
      await new Promise((resolve) => serverD.listen(0, '127.0.0.1', resolve));
      const baseD = `http://127.0.0.1:${serverD.address().port}`;
      const OTHER_SELLER = 'seller_2|seller';
      const d = async (method, path, user, body) => {
        const res = await fetch(`${baseD}/d${path}`, {
          method,
          headers: { ...(user ? { 'x-test-user': user } : {}), 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(8000)
        });
        let json = null;
        try { json = await res.json(); } catch (e) { /* no body */ }
        return { status: res.status, body: json };
      };
      const newDelivery = async () => {
        const order = await ordersD.saveOrder(new Order({
          buyerId: 'buyer_1',
          sellerId: 'seller_1',
          items: [{ listingId: 'lst_d', title: 'Phone', unitPriceXaf: 50000, quantity: 1, sellerId: 'seller_1', storeName: 'Tech Shop' }],
          shippingAddress: { fullName: 'Awa Njoya', phone: '+237622222222', street: 'Rue 1', neighbourhood: 'Bonanjo', city: 'Douala' },
          deliveryMethod: DELIVERY_METHOD.HOME_DELIVERY,
          paymentStatus: PAYMENT_STATUS.PAID,
          fulfillmentStatus: FULFILLMENT_STATUS.PROCESSING
        }));
        const created = await d('POST', '/', SELLER, { orderId: order.id });
        assert.strictEqual(created.status, 201, JSON.stringify(created.body));
        return created.body.data.delivery.id;
      };

      try {
        await d('POST', '/drivers/rider_1', ADMIN, { name: 'Alain', phone: '+237600000001' });
        await d('POST', '/drivers/rider_2', ADMIN, { name: 'Bruno', phone: '+237600000002' });
        const id = await newDelivery();

        // Authentication and roles.
        const anon = await d('POST', `/${id}/auto-assign`, null, {});
        assert.strictEqual(anon.status, 401, 'auto-assign needs a session');
        assert.strictEqual(anon.body.error.code, 'UNAUTHENTICATED');
        assert.strictEqual((await d('POST', `/${id}/auto-assign`, BUYER, {})).status, 403, 'the buyer cannot dispatch their own order');
        assert.strictEqual((await d('POST', `/${id}/auto-assign`, STRANGER, {})).status, 404, 'a stranger gets a 404, not a hint that it exists');
        assert.strictEqual((await d('POST', `/${id}/auto-assign`, OTHER_SELLER, {})).status, 404, "another seller cannot dispatch it");
        assert.strictEqual((await d('POST', '/dlv_missing/auto-assign', SELLER, {})).status, 404);
        assert.strictEqual((await repoD.findById(id)).status, 'pending_assignment', 'none of those changed anything');

        // The call itself. A body is ignored: the server decides, not the client.
        const auto = await d('POST', `/${id}/auto-assign`, SELLER, { driverId: 'rider_2', status: 'delivered', surprise: true });
        assert.strictEqual(auto.status, 200, JSON.stringify(auto.body));
        const delivery = auto.body.data.delivery;
        assert.strictEqual(delivery.status, 'assigned');
        assert.strictEqual(delivery.driver.id, 'rider_1', 'the server chose, ignoring the body');
        assert.strictEqual(delivery.viewerRole, 'seller');
        assert.strictEqual(delivery.offerExpiresAt, new Date(clock.now() + OFFER_MS).toISOString(), 'the response carries the deadline');

        // offerExpiresAt over the wire: staff and rider see it, the buyer never does.
        assert.strictEqual((await d('GET', `/${id}`, RIDER)).body.data.delivery.offerExpiresAt, delivery.offerExpiresAt);
        assert.strictEqual((await d('GET', `/${id}`, BUYER)).body.data.delivery.offerExpiresAt, null);
        assert.strictEqual((await d('GET', '/driver/me', RIDER)).body.data.deliveries[0].offerExpiresAt, delivery.offerExpiresAt, "and so does the rider's own list");

        // The rider list: workload, order, and the optional deliveryId.
        const list = await d('GET', '/drivers', SELLER);
        assert.strictEqual(list.status, 200);
        assert.deepStrictEqual(list.body.data.drivers.map((r) => [r.id, r.openDeliveries]), [['rider_2', 0], ['rider_1', 1]], 'least busy first, with the count');
        assert.ok(list.body.data.drivers.every((r) => !('declined' in r)), 'no declined flag without a deliveryId');
        const withHistory = await d('GET', `/drivers?deliveryId=${id}`, SELLER);
        assert.strictEqual(withHistory.status, 200);
        assert.ok(withHistory.body.data.drivers.every((r) => r.declined === false), 'with one, every rider has the flag');
        assert.strictEqual((await d('GET', '/drivers?_=1700000000', SELLER)).status, 200, 'unrelated query keys are ignored');
        const empty = await d('GET', '/drivers?deliveryId=', SELLER);
        assert.strictEqual(empty.status, 400, 'an empty deliveryId is a 400');
        assert.strictEqual(empty.body.error.code, 'VALIDATION_ERROR');
        assert.strictEqual((await d('GET', '/drivers?deliveryId=a&deliveryId=b', SELLER)).status, 400, 'a repeated deliveryId is a 400, not a crash');
        assert.strictEqual((await d('GET', `/drivers?deliveryId=${'x'.repeat(200)}`, SELLER)).status, 400, 'an over-long deliveryId is a 400');
        assert.strictEqual((await d('GET', '/drivers?deliveryId=dlv_missing', SELLER)).status, 404);
        assert.strictEqual((await d('GET', `/drivers?deliveryId=${id}`, OTHER_SELLER)).status, 404, "another seller cannot read this delivery's history");
        assert.strictEqual((await d('GET', `/drivers?deliveryId=${id}`, BUYER)).status, 403, 'a customer cannot list riders at all');

        // A decline is remembered and steers the next pick.
        assert.strictEqual((await d('POST', `/${id}/decline`, RIDER)).status, 200);
        const afterDecline = await d('GET', `/drivers?deliveryId=${id}`, SELLER);
        // Both are idle again, so they tie on workload and the order falls back to the name.
        assert.deepStrictEqual(afterDecline.body.data.drivers.map((r) => [r.id, r.declined]), [['rider_1', true], ['rider_2', false]]);
        const second = await d('POST', `/${id}/auto-assign`, SELLER);
        assert.strictEqual(second.body.data.delivery.driver.id, 'rider_2', 'the rider who declined is not offered it again');

        // Nobody left: a clean 409 with its own code, and the delivery is untouched.
        assert.strictEqual((await d('POST', `/${id}/decline`, RIDER2)).status, 200);
        const none = await d('POST', `/${id}/auto-assign`, SELLER);
        assert.strictEqual(none.status, 409);
        assert.strictEqual(none.body.error.code, 'NO_RIDER_AVAILABLE');
        assert.strictEqual(none.body.success, false);
        assert.strictEqual((await repoD.findById(id)).status, 'pending_assignment');

        // An unanswered offer: 409 OFFER_EXPIRED on accept, then it is back with the seller.
        assert.strictEqual((await d('POST', `/${id}/assign`, SELLER, { driverId: 'rider_1' })).status, 200);
        clock.advance(OFFER_MS);
        const late = await d('POST', `/${id}/accept`, RIDER);
        assert.strictEqual(late.status, 409, 'accepting at the deadline is refused');
        assert.strictEqual(late.body.error.code, 'OFFER_EXPIRED');
        assert.strictEqual((await d('GET', '/driver/me', RIDER)).body.data.deliveries.length, 0, 'it has left the rider\'s list');
        assert.strictEqual((await d('GET', `/${id}`, RIDER)).status, 404, 'and the rider no longer has access');
        const back = await d('GET', `/${id}`, SELLER);
        assert.strictEqual(back.body.data.delivery.status, 'pending_assignment', 'the seller sees it waiting for a new rider');
        assert.strictEqual(back.body.data.delivery.offerExpiresAt, null);
      } finally {
        if (serverD.closeAllConnections) serverD.closeAllConnections();
        await new Promise((resolve) => serverD.close(resolve));
      }
    }

    console.log('    ✓ Delivery routes: wiring, validation, status codes and the live stream hold.');
  } finally {
    NotificationService.create = originalCreate;
    if (!hadSecret) config.supabase.jwtSecret = hadSecret;
    for (const st of openStreams) closeStream(st);
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function run() {
  console.log('  Testing Delivery routes and stream...');
  await main();
}

module.exports = { run };
