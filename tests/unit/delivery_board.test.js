/**
 * LOUMOO — Delivery dispatch board and admin rider roster (contract v1.2)
 * ---------------------------------------------------------------------------
 * GET /dispatch: a seller's home-delivery orders that need or have a delivery.
 * GET /drivers?status=: the admin roster, suspended riders included.
 * Service level over the in-memory backends, the two new repository reads over a
 * query-builder stand-in, and the routes over real HTTP with a header-driven
 * stand-in for authentication. No database.
 */

require('../setup');

const assert = require('assert');
const http = require('http');
const express = require('express');
const config = require('../../server/config/env');

const errorHandler = require('../../server/shared/middleware/errorHandler');
const { AuthenticationError } = require('../../server/shared/errors/AppError');
const { createDeliveryRouter } = require('../../server/modules/delivery/presentation/routes/deliveryRoutes');
const { DeliveryService } = require('../../server/modules/delivery/application/DeliveryService');
const { DeliveryRepository } = require('../../server/modules/delivery/infrastructure/DeliveryRepository');
const { DeliveryEvents } = require('../../server/modules/delivery/infrastructure/DeliveryEvents');
const { OrderRepository } = require('../../server/modules/commerce/infrastructure/OrderRepository');
const { Order, FULFILLMENT_STATUS, DELIVERY_METHOD, PAYMENT_STATUS } = require('../../server/modules/commerce/domain/Order');

const MIN = 60 * 1000;
const OFFER_TTL_MS = 15 * MIN;

async function code(promise) {
  try { await promise; return 'OK'; } catch (e) { return e.code || e.name || 'ERROR'; }
}

function makeWorld() {
  let t = Date.parse('2026-10-04T10:00:00.000Z');
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const orders = new OrderRepository({ db: null });
  const repo = new DeliveryRepository({ db: null });
  const events = new DeliveryEvents();
  const service = new DeliveryService({ repository: repo, orderRepository: orders, events, now: clock.now, offerTtlMs: OFFER_TTL_MS });
  return { clock, orders, repo, events, service };
}

let seq = 0;
async function placeOrder(w, overrides = {}) {
  seq += 1;
  return w.orders.saveOrder(new Order({
    buyerId: 'buyer_1',
    sellerId: 'seller_1',
    items: [{ listingId: `lst_${seq}`, title: `Phone ${seq}`, unitPriceXaf: 50000, quantity: 2, sellerId: overrides.sellerId || 'seller_1', storeName: 'Tech Shop' }],
    shippingAddress: { fullName: 'Awa Njoya', phone: '+237622222222', street: 'Rue 1', neighbourhood: 'Bonanjo', city: 'Douala' },
    deliveryMethod: DELIVERY_METHOD.HOME_DELIVERY,
    paymentStatus: PAYMENT_STATUS.PAID,
    fulfillmentStatus: FULFILLMENT_STATUS.PROCESSING,
    ...overrides
  }));
}

const BUYER = { userId: 'buyer_1', userRole: 'customer' };
const SELLER = { userId: 'seller_1', userRole: 'seller' };
const SELLER2 = { userId: 'seller_2', userRole: 'seller' };
const ADMIN = { userId: 'admin_1', userRole: 'admin' };
const RIDER = { userId: 'rider_1', userRole: 'customer' };

/** Minimal Supabase query-builder stand-in over plain rows (see delivery_repository.test.js). */
function stubDb(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      const rows = tables[table] || [];
      const q = { filters: [], max: null, order: null };
      const log = (op, ...a) => { calls.push([table, op, ...a]); return q; };
      q.select = (c) => log('select', c);
      q.eq = (c, v) => { q.filters.push((r) => r[c] === v); return log('eq', c, v); };
      q.in = (c, vs) => { q.filters.push((r) => vs.includes(r[c])); return log('in', c, vs); };
      q.order = (c, o = {}) => { q.order = { c, asc: o.ascending !== false }; return log('order', c, o); };
      q.limit = (n) => { q.max = n; return log('limit', n); };
      q.then = (resolve) => {
        let out = rows.filter((r) => q.filters.every((f) => f(r)));
        if (q.order) out = [...out].sort((a, b) => (Date.parse(a[q.order.c]) - Date.parse(b[q.order.c])) * (q.order.asc ? 1 : -1));
        if (q.max != null) out = out.slice(0, q.max);
        return resolve({ data: out, error: null });
      };
      return q;
    }
  };
}

async function run() {
  console.log('  Testing Delivery dispatch board and rider roster...');

  const hadSecret = config.supabase.jwtSecret;
  if (!hadSecret) config.supabase.jwtSecret = 'unit-test-delivery-secret-0123456789abcdef';
  const NotificationService = require('../../server/modules/identity/application/NotificationService');
  const originalCreate = NotificationService.create;
  NotificationService.create = async () => null;

  try {
    // ------------------------------------------------------------- who may ask
    {
      const w = makeWorld();
      assert.strictEqual(await code(w.service.getDispatchBoard(BUYER)), 'PERMISSION_DENIED', 'a customer has no dispatch board');
      assert.strictEqual(await code(w.service.getDispatchBoard(RIDER)), 'PERMISSION_DENIED', 'nor does a rider');
      assert.strictEqual(await code(w.service.getDispatchBoard({ userRole: 'seller' })), 'PERMISSION_DENIED', 'no identity is refused');
      assert.strictEqual(await code(w.service.getDispatchBoard(SELLER, { view: 'everything' })), 'VALIDATION_ERROR', 'an unknown view is refused');
      assert.deepStrictEqual(await w.service.getDispatchBoard(SELLER), { items: [] }, 'an empty board is an empty list');
    }

    // ------------------------------------------- what a seller's board contains
    {
      const w = makeWorld();
      await w.service.registerDriver('rider_1', { name: 'Alain', phone: '+237600000001' }, ADMIN);
      const needsRider = await placeOrder(w);
      const offered = await placeOrder(w);
      const pickup = await placeOrder(w, { deliveryMethod: DELIVERY_METHOD.STORE_PICKUP });
      const otherSellers = await placeOrder(w, { sellerId: 'seller_2' });
      const cancelled = await placeOrder(w, { fulfillmentStatus: FULFILLMENT_STATUS.CANCELLED });
      const refunded = await placeOrder(w, { paymentStatus: PAYMENT_STATUS.REFUNDED });
      const done = await placeOrder(w, { fulfillmentStatus: FULFILLMENT_STATUS.DELIVERED });
      const created = await w.service.createDelivery(offered.id, SELLER, {});
      await w.service.assignDriver(created.id, 'rider_1', SELLER);

      const board = await w.service.getDispatchBoard(SELLER);
      const ids = board.items.map((i) => i.order.id);
      assert.deepStrictEqual(ids.sort(), [needsRider.id, offered.id].sort(),
        'only this seller\'s live home-delivery orders: no pickup, other seller, cancelled, refunded or delivered');
      assert.ok(!ids.includes(pickup.id) && !ids.includes(otherSellers.id) && !ids.includes(cancelled.id) && !ids.includes(refunded.id) && !ids.includes(done.id));

      const bare = board.items.find((i) => i.order.id === needsRider.id);
      assert.strictEqual(bare.delivery, null, 'an order with no delivery yet says so');
      assert.deepStrictEqual(Object.keys(bare.order).sort(),
        ['area', 'buyerName', 'fulfillmentStatus', 'id', 'itemCount', 'orderNumber', 'paymentStatus', 'placedAt', 'title', 'totalXaf'],
        'the order summary carries exactly the documented fields');
      assert.strictEqual(bare.order.itemCount, 2, 'quantities are summed');
      assert.strictEqual(bare.order.area, 'Bonanjo, Douala');
      assert.strictEqual(bare.order.buyerName, 'Awa Njoya');
      assert.ok(bare.order.title && bare.order.title.startsWith('Phone'));

      const live = board.items.find((i) => i.order.id === offered.id).delivery;
      assert.strictEqual(live.status, 'assigned');
      assert.strictEqual(live.viewerRole, 'seller', 'the seller view');
      assert.strictEqual(live.driver.name, 'Alain', 'with the rider');
      assert.strictEqual(live.offerExpiresAt, new Date(w.clock.now() + OFFER_TTL_MS).toISOString(), 'and the offer deadline');
      assert.deepStrictEqual(live.timeline, [], 'the timeline is left to GET /:id');

      const completed = await w.service.getDispatchBoard(SELLER, { view: 'completed' });
      assert.deepStrictEqual(completed.items.map((i) => i.order.id), [done.id], 'delivered orders are in the completed view');

      assert.deepStrictEqual((await w.service.getDispatchBoard(SELLER2)).items.map((i) => i.order.id), [otherSellers.id], 'each seller sees only their own');
      const adminBoard = await w.service.getDispatchBoard(ADMIN);
      assert.deepStrictEqual(adminBoard.items.map((i) => i.order.id).sort(), [needsRider.id, offered.id, otherSellers.id].sort(), 'an admin sees every seller\'s');
      assert.strictEqual(adminBoard.items.find((i) => i.order.id === offered.id).delivery.viewerRole, 'admin');

      // The newest live order here is the refunded one: excluding it must not eat the limit.
      assert.strictEqual((await w.service.getDispatchBoard(SELLER, { limit: 1 })).items.length, 1, 'the limit applies, after exclusions');
    }

    // ------------------------------------- the open delivery wins over an old one
    {
      const w = makeWorld();
      await w.service.registerDriver('rider_1', { name: 'Alain', phone: '+237600000001' }, ADMIN);
      const order = await placeOrder(w);
      const first = await w.service.createDelivery(order.id, SELLER, {});
      await w.service.cancelDelivery(first.id, 'Wrong pickup point', SELLER);
      w.clock.advance(MIN);
      const second = await w.service.createDelivery(order.id, SELLER, {});
      const row = (await w.service.getDispatchBoard(SELLER)).items.find((i) => i.order.id === order.id);
      assert.strictEqual(row.delivery.id, second.id, 'the board shows the open delivery, not the cancelled one');
    }

    // ------------------------------------------- lapsed offers, and who can sweep
    {
      const w = makeWorld();
      await w.service.registerDriver('rider_1', { name: 'Alain', phone: '+237600000001' }, ADMIN);
      const order = await placeOrder(w);
      const d = await w.service.createDelivery(order.id, SELLER, {});
      await w.service.assignDriver(d.id, 'rider_1', SELLER);
      w.clock.advance(OFFER_TTL_MS + MIN);

      assert.strictEqual(await code(w.service.getDispatchBoard(BUYER)), 'PERMISSION_DENIED');
      assert.strictEqual((await w.repo.findById(d.id)).status, 'assigned', 'a refused caller made the platform do nothing');

      const row = (await w.service.getDispatchBoard(SELLER)).items.find((i) => i.order.id === order.id);
      assert.strictEqual(row.delivery.status, 'pending_assignment', 'the board never shows a dead offer');
      assert.strictEqual(row.delivery.offerExpiresAt, null);
    }

    // ------------------------------------------------------------ the roster
    {
      const w = makeWorld();
      await w.service.registerDriver('rider_b', { name: 'Bruno', phone: '+237600000002' }, ADMIN);
      await w.service.registerDriver('rider_a', { name: 'Alain', phone: '+237600000001' }, ADMIN);
      await w.service.registerDriver('rider_z', { name: 'Aaron', phone: '+237600000003', status: 'suspended' }, ADMIN);
      const order = await placeOrder(w);
      const d = await w.service.createDelivery(order.id, SELLER, {});
      await w.service.assignDriver(d.id, 'rider_b', SELLER);

      assert.strictEqual(await code(w.service.listRiderRoster(SELLER)), 'PERMISSION_DENIED', 'sellers never see suspended riders');
      assert.strictEqual(await code(w.service.listRiderRoster(BUYER)), 'PERMISSION_DENIED');
      assert.strictEqual(await code(w.service.listRiderRoster(ADMIN, { status: 'banned' })), 'VALIDATION_ERROR');

      const all = await w.service.listRiderRoster(ADMIN);
      assert.deepStrictEqual(all.map((r) => [r.id, r.status, r.openDeliveries]),
        [['rider_a', 'active', 0], ['rider_b', 'active', 1], ['rider_z', 'suspended', 0]],
        'active riders first, by name, each with status and workload; suspended last');
      assert.deepStrictEqual(Object.keys(all[0]).sort(), ['id', 'name', 'openDeliveries', 'phone', 'status']);
      assert.deepStrictEqual((await w.service.listRiderRoster(ADMIN, { status: 'suspended' })).map((r) => r.id), ['rider_z']);
      assert.deepStrictEqual((await w.service.listRiderRoster(ADMIN, { status: 'active' })).map((r) => r.id), ['rider_a', 'rider_b']);
    }

    // ------------------------------------------------- the two repository reads
    {
      // findOrdersBySeller: the delivery method lives in JSON, and a row without it is home delivery.
      const row = (id, seller, status, method, at) => ({
        id, order_number: `LM-${id}`, buyer_id: 'b', seller_id: seller, total_amount_xaf: 1000,
        items: [{ listingId: `lst_${id}`, title: 'X', quantity: 1, unitPriceXaf: 1000 }],
        shipping_address: method === undefined ? { city: 'Douala' } : { city: 'Douala', _deliveryMethod: method },
        payment_status: 'paid', fulfillment_status: status, created_at: at
      });
      const db = stubDb({ orders: [
        row('a', 's1', 'processing', 'HOME_DELIVERY', '2026-10-04T09:00:00Z'),
        row('b', 's1', 'processing', undefined, '2026-10-04T09:30:00Z'),        // no key: home delivery
        row('c', 's1', 'processing', 'STORE_PICKUP', '2026-10-04T09:45:00Z'),
        row('d', 's2', 'processing', 'HOME_DELIVERY', '2026-10-04T09:50:00Z'),
        row('e', 's1', 'delivered', 'HOME_DELIVERY', '2026-10-04T08:00:00Z')
      ] });
      const repo = new OrderRepository({ db });
      const got = await repo.findOrdersBySeller('s1', { statuses: ['processing'] });
      assert.deepStrictEqual(got.map((o) => o.id), ['b', 'a'], 'newest first; a row with no method key counts as home delivery; pickup dropped');
      assert.ok(db.calls.some(([t, op, c, v]) => t === 'orders' && op === 'eq' && c === 'seller_id' && v === 's1'), 'filtered by seller in SQL');
      assert.ok(db.calls.some(([t, op, c]) => op === 'in' && c === 'fulfillment_status'), 'and by status');
      assert.ok(!db.calls.some(([t, op, c]) => String(c).includes('_deliveryMethod')), 'but never by the JSON key in SQL');
      assert.deepStrictEqual((await repo.findOrdersBySeller(null, { statuses: ['processing'] })).map((o) => o.id), ['d', 'b', 'a'], 'null seller: everyone');
      assert.deepStrictEqual((await repo.findOrdersBySeller('s1', { statuses: ['processing'], limit: 1 })).map((o) => o.id), ['b']);

      // One unreadable row is skipped (and logged), not allowed to blank the board.
      const logger = require('../../server/shared/logging/logger');
      const broken = row('x', 's1', 'processing', 'HOME_DELIVERY', '2026-10-04T09:59:00Z');
      broken.items = [{ title: 'no listing id' }];
      const warned = [];
      const originalWarn = logger.warn;
      logger.warn = (m) => warned.push(String(m));
      try {
        const withBroken = new OrderRepository({ db: stubDb({ orders: [broken, row('a', 's1', 'processing', 'HOME_DELIVERY', '2026-10-04T09:00:00Z')] }) });
        assert.deepStrictEqual((await withBroken.findOrdersBySeller('s1', { statuses: ['processing'] })).map((o) => o.id), ['a'], 'the good row still comes back');
      } finally {
        logger.warn = originalWarn;
      }
      assert.ok(warned.some((m) => /Skipping unreadable order x/.test(m)), 'and the bad one is named in the log');
    }
    {
      // findLatestByOrders: open beats finished, else the newest finished; absent when none.
      const repo = new DeliveryRepository({ db: null });
      const mk = (id, orderId, status, createdAt) => ({ id, orderId, buyerId: 'b', sellerId: 's', driverId: null, status, pickup: {}, dropoff: {}, createdAt, updatedAt: createdAt });
      await repo.insertDelivery(mk('d1', 'o1', 'cancelled', '2026-10-04T09:00:00Z'));
      await repo.insertDelivery(mk('d2', 'o1', 'assigned', '2026-10-04T08:00:00Z'));
      await repo.insertDelivery(mk('d3', 'o2', 'cancelled', '2026-10-04T07:00:00Z'));
      await repo.insertDelivery(mk('d4', 'o2', 'delivered', '2026-10-04T09:30:00Z'));
      const map = await repo.findLatestByOrders(['o1', 'o2', 'o3', 'o1', null]);
      assert.strictEqual(map.get('o1').id, 'd2', 'the open delivery wins even when older');
      assert.strictEqual(map.get('o2').id, 'd4', 'otherwise the newest finished one');
      assert.strictEqual(map.has('o3'), false, 'no delivery: absent');
      assert.strictEqual((await repo.findLatestByOrders([])).size, 0);
    }

    // ---------------------------------------------------------------- over HTTP
    {
      const w = makeWorld();
      await w.service.registerDriver('rider_1', { name: 'Alain', phone: '+237600000001' }, ADMIN);
      await w.service.registerDriver('rider_9', { name: 'Zed', phone: '+237600000009', status: 'suspended' }, ADMIN);
      await placeOrder(w);
      const fakeAuth = (req, res, next) => {
        const header = req.headers['x-test-user'];
        if (!header) return next(new AuthenticationError('Authentication required.'));
        const [id, role = 'customer'] = String(header).split('|');
        req.principal = { id, primaryRole: role };
        req.userId = id;
        return next();
      };
      const app = express();
      app.use(express.json());
      app.use('/d', createDeliveryRouter({ service: w.service, authenticate: fakeAuth, events: w.events }));
      app.use(errorHandler);
      const server = http.createServer(app);
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${server.address().port}/d`;
      const get = async (path, user) => {
        const res = await fetch(base + path, { headers: user ? { 'x-test-user': user } : {}, signal: AbortSignal.timeout(8000) });
        let body = null; try { body = await res.json(); } catch (e) { /* none */ }
        return { status: res.status, body };
      };
      try {
        assert.strictEqual((await get('/dispatch')).status, 401, 'needs a session');
        assert.strictEqual((await get('/dispatch', 'buyer_1|customer')).status, 403);
        const ok = await get('/dispatch', 'seller_1|seller');
        assert.strictEqual(ok.status, 200);
        assert.strictEqual(ok.body.data.items.length, 1, 'the envelope carries { items }');
        assert.strictEqual(ok.body.data.items[0].delivery, null);
        assert.strictEqual((await get('/dispatch?view=completed', 'seller_1|seller')).status, 200);
        for (const bad of ['?view=all', '?limit=0', '?limit=101', '?limit=abc', '?view=active&view=completed']) {
          assert.strictEqual((await get('/dispatch' + bad, 'seller_1|seller')).status, 400, `${bad} is a 400`);
        }
        assert.strictEqual((await get('/dispatch?_=1', 'seller_1|seller')).status, 200, 'unknown query keys are ignored');

        assert.strictEqual((await get('/drivers?status=all', 'seller_1|seller')).status, 403, 'a seller cannot read the roster');
        const roster = await get('/drivers?status=all', 'admin_1|admin');
        assert.strictEqual(roster.status, 200);
        assert.deepStrictEqual(roster.body.data.drivers.map((r) => [r.id, r.status]), [['rider_1', 'active'], ['rider_9', 'suspended']]);
        assert.strictEqual((await get('/drivers?status=banned', 'admin_1|admin')).status, 400);
        const plain = await get('/drivers', 'seller_1|seller');
        assert.deepStrictEqual(plain.body.data.drivers.map((r) => r.id), ['rider_1'], 'without status: the seller list, unchanged');
        assert.ok(!('status' in plain.body.data.drivers[0]), 'which does not carry a status');
      } finally {
        if (server.closeAllConnections) server.closeAllConnections();
        await new Promise((r) => server.close(r));
      }
    }

    console.log('    ✓ Delivery board and roster: roles, filtering, open-over-finished, sweep after auth, HTTP validation hold.');
  } finally {
    NotificationService.create = originalCreate;
    if (!hadSecret) config.supabase.jwtSecret = hadSecret;
  }
}

module.exports = { run };
