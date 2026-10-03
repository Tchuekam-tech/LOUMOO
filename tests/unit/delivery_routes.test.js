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

  const app = express();
  app.use(compression({ threshold: 0 })); // as in production: this is what buffers a badly-headed stream
  app.use(express.json());
  app.use('/api/v1/deliveries', router);
  app.use('/short/deliveries', shortLivedRouter);
  app.use(errorHandler);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const openStreams = [];

  async function call(method, path, user, body) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(user ? { 'x-test-user': user } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
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
        'POST /:id/assign', 'POST /:id/cancel', 'POST /:id/resolve', 'POST /:id/reconcile',
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
