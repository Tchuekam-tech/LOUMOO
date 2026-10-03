/**
 * LOUMOO — Delivery service
 * ---------------------------------------------------------------------------
 * End-to-end coverage of the delivery use cases over the in-memory backends (no
 * database, no HTTP): authorisation, the full happy path, every refusal, the
 * order-status linkage, GPS policy, the handover-code guess budget, and the
 * compare-and-swap behaviour under concurrent requests.
 */

require('../setup');

const assert = require('assert');
const config = require('../../server/config/env');

const { DeliveryService } = require('../../server/modules/delivery/application/DeliveryService');
const { DeliveryRepository } = require('../../server/modules/delivery/infrastructure/DeliveryRepository');
const { DeliveryEvents } = require('../../server/modules/delivery/infrastructure/DeliveryEvents');
const { OrderRepository } = require('../../server/modules/commerce/infrastructure/OrderRepository');
const { Order, FULFILLMENT_STATUS, DELIVERY_METHOD, PAYMENT_STATUS } = require('../../server/modules/commerce/domain/Order');
const { codeFor } = require('../../server/modules/delivery/domain/HandoverCode');
const { MAX_HANDOVER_ATTEMPTS } = require('../../server/modules/delivery/domain/Delivery');

async function code(promise) {
  try {
    await promise;
    return 'OK';
  } catch (e) {
    return e.code || e.name || 'ERROR';
  }
}

function makeWorld() {
  let t = Date.parse('2026-10-03T10:00:00.000Z');
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const orders = new OrderRepository({ db: null });
  const repo = new DeliveryRepository({ db: null });
  const events = new DeliveryEvents();
  const service = new DeliveryService({ repository: repo, orderRepository: orders, events, now: clock.now });
  return { clock, orders, repo, events, service };
}

async function placeOrder(world, overrides = {}) {
  const order = new Order({
    buyerId: 'buyer_1',
    sellerId: 'seller_1',
    items: [{ listingId: 'lst_1', title: 'Phone', unitPriceXaf: 50000, quantity: 1, sellerId: 'seller_1', storeName: 'Tech Shop' }],
    shippingAddress: { fullName: 'Awa Njoya', phone: '+237622222222', street: 'Rue 1', city: 'Douala' },
    deliveryMethod: DELIVERY_METHOD.HOME_DELIVERY,
    paymentStatus: PAYMENT_STATUS.PAID,
    fulfillmentStatus: FULFILLMENT_STATUS.PROCESSING,
    ...overrides
  });
  return world.orders.saveOrder(order);
}

/**
 * Minimal stand-in for the Supabase query builder over an `orders` table held in
 * a Map, covering the reads and the conditional update OrderRepository performs.
 */
function stubOrdersDb(rows) {
  return {
    from(table) {
      assert.strictEqual(table, 'orders');
      const q = { filters: {}, patch: null };
      const matching = () => [...rows.values()].filter((r) => Object.entries(q.filters).every(([c, v]) => r[c] === v));
      q.select = () => q;
      q.eq = (col, val) => { q.filters[col] = val; return q; };
      q.update = (patch) => { q.patch = patch; return q; };
      q.maybeSingle = async () => ({ data: matching()[0] ? { ...matching()[0] } : null, error: null });
      q.single = async () => {
        const row = matching()[0];
        if (!row) return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        if (q.patch) Object.assign(row, q.patch);
        return { data: { ...row }, error: null };
      };
      return q;
    }
  };
}

const BUYER = { userId: 'buyer_1', userRole: 'customer' };
const SELLER = { userId: 'seller_1', userRole: 'seller' };
const ADMIN = { userId: 'admin_1', userRole: 'admin' };
const RIDER = { userId: 'rider_1', userRole: 'customer' };
const RIDER2 = { userId: 'rider_2', userRole: 'customer' };
const STRANGER = { userId: 'stranger_1', userRole: 'customer' };
const NEAR = { lat: 4.0511, lng: 9.7679 };

async function setupDelivery(world, { accept = false, pickup = false, arrive = false, dropoff = true } = {}) {
  await world.service.registerDriver('rider_1', { name: 'Alain', phone: '+237600000001' }, ADMIN);
  await world.service.registerDriver('rider_2', { name: 'Bruno', phone: '+237600000002' }, ADMIN);
  const order = await placeOrder(world);
  const created = await world.service.createDelivery(order.id, SELLER, dropoff ? { dropoffLocation: { lat: 4.0601, lng: 9.7679 } } : {});
  await world.service.assignDriver(created.id, 'rider_1', SELLER);
  if (accept || pickup || arrive) await world.service.acceptDelivery(created.id, RIDER);
  if (pickup || arrive) await world.service.recordLocation(created.id, { ...NEAR }, RIDER);
  if (pickup || arrive) { world.clock.advance(5000); await world.service.updateStatus(created.id, 'picked_up', null, RIDER); }
  if (arrive) await world.service.updateStatus(created.id, 'arrived', null, RIDER);
  return { order, deliveryId: created.id };
}

async function run() {
  console.log('  Testing Delivery service...');

  const hadSecret = config.supabase.jwtSecret;
  if (!hadSecret) config.supabase.jwtSecret = 'unit-test-delivery-secret-0123456789abcdef';

  // Keep the suite pure: no notification rows, whatever the machine's credentials.
  const NotificationService = require('../../server/modules/identity/application/NotificationService');
  const originalCreate = NotificationService.create;
  const notifications = [];
  NotificationService.create = async (userId, payload) => { notifications.push({ userId, ...payload }); return null; };

  try {
    // ------------------------------------------------------------------ riders
    {
      const w = makeWorld();
      assert.strictEqual(await code(w.service.registerDriver('rider_1', { name: 'A', phone: '+237600000001' }, SELLER)), 'PERMISSION_DENIED', 'only admins register riders');
      assert.strictEqual(await code(w.service.registerDriver('', { name: 'A', phone: '+237600000001' }, ADMIN)), 'VALIDATION_ERROR');
      assert.strictEqual(await code(w.service.registerDriver('rider_1', { name: '', phone: '+237600000001' }, ADMIN)), 'VALIDATION_ERROR');
      assert.strictEqual(await code(w.service.registerDriver('rider_1', { name: 'A', phone: '12' }, ADMIN)), 'VALIDATION_ERROR');
      await w.service.registerDriver('rider_1', { name: 'Alain', phone: '+237600000001' }, ADMIN);
      assert.deepStrictEqual((await w.service.listDrivers(SELLER)).map((d) => d.id), ['rider_1']);
      assert.strictEqual(await code(w.service.listDrivers(BUYER)), 'PERMISSION_DENIED', 'customers cannot list riders');
      assert.strictEqual(await code(w.service.getRiderOverview(STRANGER)), 'PERMISSION_DENIED', 'non-riders have no rider overview');
      await w.service.registerDriver('rider_2', { name: 'Bruno', phone: '+237600000002', status: 'suspended' }, ADMIN);
      assert.deepStrictEqual((await w.service.listDrivers(ADMIN)).map((d) => d.id), ['rider_1'], 'suspended riders are not listed');
      assert.strictEqual(await code(w.service.listDrivers({ userRole: 'admin' })), 'PERMISSION_DENIED', 'a caller with no identity is refused');
    }

    // ------------------------------------------------------------------ create
    {
      const w = makeWorld();
      const order = await placeOrder(w);
      assert.strictEqual(await code(w.service.createDelivery(order.id, STRANGER)), 'NOT_FOUND', 'a non-seller cannot create (404, not 403)');
      assert.strictEqual(await code(w.service.createDelivery(order.id, BUYER)), 'NOT_FOUND', 'the buyer cannot create either');
      assert.strictEqual(await code(w.service.createDelivery('ord_missing', SELLER)), 'NOT_FOUND');
      assert.strictEqual(await code(w.service.createDelivery(order.id, { userRole: 'seller' })), 'PERMISSION_DENIED', 'no identity is refused');

      assert.strictEqual(await code(w.service.createDelivery(order.id, SELLER, { dropoffLocation: { lat: 200, lng: 0 } })), 'VALIDATION_ERROR', 'bad coordinates are refused');
      assert.strictEqual(await code(w.service.createDelivery(order.id, SELLER, { pickup: { label: 'x'.repeat(500) } })), 'VALIDATION_ERROR');

      const created = await w.service.createDelivery(order.id, SELLER, { dropoffLocation: { lat: 4.06, lng: 9.77 } });
      assert.strictEqual(created.status, 'pending_assignment');
      assert.strictEqual(created.orderId, order.id);
      assert.strictEqual(created.orderNumber, order.orderNumber);
      assert.strictEqual(created.viewerRole, 'seller');
      assert.strictEqual(created.pickup.label, 'Tech Shop');
      assert.strictEqual(created.dropoff.label, 'Awa Njoya');
      assert.strictEqual(created.dropoff.address, 'Rue 1, Douala');
      assert.deepStrictEqual(created.dropoff.location, { lat: 4.06, lng: 9.77 });
      assert.ok(created.id.startsWith('dlv_'));
      assert.strictEqual(created.timeline.length, 1);

      assert.strictEqual(await code(w.service.createDelivery(order.id, SELLER)), 'CONFLICT', 'one open delivery per order');
      assert.strictEqual(await code(w.service.createDelivery(order.id, ADMIN)), 'CONFLICT', 'admins hit the same rule');

      // Concurrent double-click: exactly one wins.
      const w2 = makeWorld();
      const o2 = await placeOrder(w2);
      const results = await Promise.allSettled([w2.service.createDelivery(o2.id, SELLER), w2.service.createDelivery(o2.id, SELLER)]);
      assert.strictEqual(results.filter((r) => r.status === 'fulfilled').length, 1, 'only one of two simultaneous creates succeeds');

      const pickupOrder = await placeOrder(w, { deliveryMethod: DELIVERY_METHOD.STORE_PICKUP });
      assert.strictEqual(await code(w.service.createDelivery(pickupOrder.id, SELLER)), 'CONFLICT', 'store-pickup orders have no delivery');
      const shipped = await placeOrder(w, { fulfillmentStatus: FULFILLMENT_STATUS.IN_TRANSIT });
      assert.strictEqual(await code(w.service.createDelivery(shipped.id, SELLER)), 'CONFLICT', 'only processing orders');
      const refunded = await placeOrder(w, { paymentStatus: PAYMENT_STATUS.REFUNDED });
      assert.strictEqual(await code(w.service.createDelivery(refunded.id, SELLER)), 'CONFLICT', 'refunded orders are not delivered');

      // An admin can create for someone else's order.
      const adminOrder = await placeOrder(w, { sellerId: 'seller_9', items: [{ listingId: 'l', title: 'T', unitPriceXaf: 1, quantity: 1, sellerId: 'seller_9' }] });
      const byAdmin = await w.service.createDelivery(adminOrder.id, ADMIN);
      assert.strictEqual(byAdmin.viewerRole, 'admin');
    }

    // ------------------------------------------------------- reads / visibility
    {
      const w = makeWorld();
      const { order, deliveryId } = await setupDelivery(w);
      assert.strictEqual(await code(w.service.getDelivery(deliveryId, STRANGER)), 'NOT_FOUND', 'strangers get 404');
      assert.strictEqual(await code(w.service.getDelivery('dlv_nope', BUYER)), 'NOT_FOUND', 'unknown id is the same 404');
      assert.strictEqual(await code(w.service.getDelivery(deliveryId, RIDER2)), 'NOT_FOUND', 'an unassigned rider is a stranger');
      assert.strictEqual(await code(w.service.getDelivery(deliveryId, {})), 'PERMISSION_DENIED');

      const asBuyer = await w.service.getDelivery(deliveryId, BUYER);
      assert.strictEqual(asBuyer.viewerRole, 'buyer');
      assert.strictEqual(asBuyer.driver, null, 'the buyer is not told who is assigned until acceptance');
      const asSeller = await w.service.getDelivery(deliveryId, SELLER);
      assert.strictEqual(asSeller.driver.name, 'Alain');
      const byOrder = await w.service.getDeliveryByOrder(order.id, BUYER);
      assert.strictEqual(byOrder.id, deliveryId);
      assert.strictEqual((await w.service.getDeliveryByOrder(order.orderNumber, SELLER)).id, deliveryId, 'order number works too');
      assert.strictEqual(await code(w.service.getDeliveryByOrder(order.id, STRANGER)), 'NOT_FOUND');
      const lonely = await placeOrder(w);
      assert.strictEqual(await code(w.service.getDeliveryByOrder(lonely.id, BUYER)), 'NOT_FOUND', 'no delivery yet is a 404');

      // Handover code: buyer only, and only once a rider has accepted.
      assert.strictEqual(await code(w.service.getHandoverCode(deliveryId, BUYER)), 'CONFLICT', 'no code before acceptance');
      await w.service.acceptDelivery(deliveryId, RIDER);
      const handover = await w.service.getHandoverCode(deliveryId, BUYER);
      assert.ok(/^\d{4}$/.test(handover.code));
      assert.strictEqual(handover.attemptsRemaining, MAX_HANDOVER_ATTEMPTS);
      assert.strictEqual((await w.service.getHandoverCode(deliveryId, BUYER)).code, handover.code, 'stable across calls');
      assert.strictEqual(await code(w.service.getHandoverCode(deliveryId, SELLER)), 'PERMISSION_DENIED', 'the seller cannot read the code');
      assert.strictEqual(await code(w.service.getHandoverCode(deliveryId, ADMIN)), 'PERMISSION_DENIED', 'nor can an admin');
      assert.strictEqual(await code(w.service.getHandoverCode(deliveryId, RIDER)), 'PERMISSION_DENIED', 'nor the rider');
      assert.strictEqual(await code(w.service.getHandoverCode(deliveryId, STRANGER)), 'NOT_FOUND');

      const accepted = await w.service.getDelivery(deliveryId, BUYER);
      assert.strictEqual(accepted.driver.name, 'Alain', 'buyer sees the rider once accepted');
      assert.ok(!('code' in accepted) && !('handoverCode' in accepted), 'no code field in the delivery view');
      assert.ok(!/handover|nonce|attempt/i.test(Object.keys(accepted).join(',')), 'no handover internals in the delivery view');
    }

    // ------------------------------------------------------------------ assign
    {
      const w = makeWorld();
      await w.service.registerDriver('rider_1', { name: 'Alain', phone: '+237600000001' }, ADMIN);
      await w.service.registerDriver('rider_2', { name: 'Bruno', phone: '+237600000002' }, ADMIN);
      await w.service.registerDriver('buyer_1', { name: 'Awa', phone: '+237600000003' }, ADMIN);
      await w.service.registerDriver('sus', { name: 'Sus', phone: '+237600000004', status: 'suspended' }, ADMIN);
      const order = await placeOrder(w);
      const { id } = await w.service.createDelivery(order.id, SELLER);

      assert.strictEqual(await code(w.service.assignDriver(id, 'rider_1', BUYER)), 'PERMISSION_DENIED', 'the buyer cannot assign');
      assert.strictEqual(await code(w.service.assignDriver(id, 'rider_1', RIDER)), 'NOT_FOUND', 'an unrelated user cannot assign');
      assert.strictEqual(await code(w.service.assignDriver(id, '', SELLER)), 'VALIDATION_ERROR');
      assert.strictEqual(await code(w.service.assignDriver(id, 'ghost', SELLER)), 'VALIDATION_ERROR', 'unknown rider');
      assert.strictEqual(await code(w.service.assignDriver(id, 'sus', SELLER)), 'VALIDATION_ERROR', 'suspended rider');
      assert.strictEqual(await code(w.service.assignDriver(id, 'buyer_1', SELLER)), 'VALIDATION_ERROR', 'the buyer cannot be their own rider');

      const assigned = await w.service.assignDriver(id, 'rider_1', SELLER);
      assert.strictEqual(assigned.status, 'assigned');
      assert.strictEqual(assigned.driver.id, 'rider_1');
      const reassigned = await w.service.assignDriver(id, 'rider_2', SELLER);
      assert.strictEqual(reassigned.driver.id, 'rider_2', 'an un-accepted delivery can be handed to someone else');
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'NOT_FOUND', 'the replaced rider lost access');

      await w.service.acceptDelivery(id, RIDER2);
      assert.strictEqual(await code(w.service.assignDriver(id, 'rider_1', SELLER)), 'CONFLICT', 'cannot re-assign after acceptance');
      assert.ok(notifications.some((n) => n.userId === 'rider_2' && /assigned/i.test(n.title)), 'the rider is told');
    }

    // Two sellers' tabs assigning different riders at once: one wins.
    {
      const w = makeWorld();
      await w.service.registerDriver('rider_1', { name: 'Alain', phone: '+237600000001' }, ADMIN);
      await w.service.registerDriver('rider_2', { name: 'Bruno', phone: '+237600000002' }, ADMIN);
      const order = await placeOrder(w);
      const { id } = await w.service.createDelivery(order.id, SELLER);
      const results = await Promise.allSettled([w.service.assignDriver(id, 'rider_1', SELLER), w.service.assignDriver(id, 'rider_2', ADMIN)]);
      assert.strictEqual(results.filter((r) => r.status === 'fulfilled').length, 1, 'a racing assignment is rejected, not silently overwritten');
    }

    // -------------------------------------------------------------- accept/decline
    {
      const w = makeWorld();
      const { deliveryId } = await setupDelivery(w);
      assert.strictEqual(await code(w.service.acceptDelivery(deliveryId, STRANGER)), 'NOT_FOUND');
      assert.strictEqual(await code(w.service.acceptDelivery(deliveryId, SELLER)), 'PERMISSION_DENIED', 'the seller is not the rider');
      const results = await Promise.allSettled([w.service.acceptDelivery(deliveryId, RIDER), w.service.acceptDelivery(deliveryId, RIDER)]);
      assert.strictEqual(results.filter((r) => r.status === 'fulfilled').length, 1, 'a double tap on Accept succeeds once');
      const released = await w.service.declineDelivery(deliveryId, RIDER);
      assert.strictEqual(released.status, 'pending_assignment', 'a rider who accepted can still release the job');
      await w.service.assignDriver(deliveryId, 'rider_1', SELLER);
      await w.service.acceptDelivery(deliveryId, RIDER);
      w.clock.advance(5000);
      await w.service.updateStatus(deliveryId, 'picked_up', null, RIDER);
      assert.strictEqual(await code(w.service.declineDelivery(deliveryId, RIDER)), 'CONFLICT', 'but not once the parcel is collected');

      const w2 = makeWorld();
      const s2 = await setupDelivery(w2);
      const declined = await w2.service.declineDelivery(s2.deliveryId, RIDER);
      assert.strictEqual(declined.status, 'pending_assignment');
      assert.strictEqual(await code(w2.service.getDelivery(s2.deliveryId, RIDER)), 'NOT_FOUND', 'a rider who declined no longer sees it');
      assert.strictEqual((await w2.service.getDelivery(s2.deliveryId, SELLER)).driver, null, 'the seller sees it is unassigned again');
      assert.ok(notifications.some((n) => n.userId === 'seller_1' && /declined/i.test(n.title)));
      await w2.service.assignDriver(s2.deliveryId, 'rider_2', SELLER);
    }

    // ------------------------------------------------------------ status flow
    {
      const w = makeWorld();
      const { order, deliveryId } = await setupDelivery(w, { accept: true });
      assert.strictEqual(await code(w.service.updateStatus(deliveryId, 'delivered', null, RIDER)), 'VALIDATION_ERROR', 'a rider cannot self-report delivered');
      assert.strictEqual(await code(w.service.updateStatus(deliveryId, 'cancelled', null, RIDER)), 'VALIDATION_ERROR');
      assert.strictEqual(await code(w.service.updateStatus(deliveryId, 'arrived', null, RIDER)), 'CONFLICT', 'must pick up before arriving');
      assert.strictEqual(await code(w.service.updateStatus(deliveryId, 'picked_up', null, SELLER)), 'PERMISSION_DENIED');
      assert.strictEqual(await code(w.service.updateStatus(deliveryId, 'picked_up', null, STRANGER)), 'NOT_FOUND');

      assert.strictEqual((await w.orders.findOrderById(order.id)).fulfillmentStatus, FULFILLMENT_STATUS.PROCESSING);
      const picked = await w.service.updateStatus(deliveryId, 'picked_up', null, RIDER);
      assert.strictEqual(picked.status, 'picked_up');
      assert.strictEqual((await w.orders.findOrderById(order.id)).fulfillmentStatus, FULFILLMENT_STATUS.IN_TRANSIT, 'pickup moves the order in transit');
      assert.strictEqual(await code(w.service.updateStatus(deliveryId, 'picked_up', null, RIDER)), 'CONFLICT', 'cannot pick up twice');

      const arrived = await w.service.updateStatus(deliveryId, 'arrived', null, RIDER);
      assert.strictEqual(arrived.etaMinutes, 0);
      assert.strictEqual((await w.orders.findOrderById(order.id)).fulfillmentStatus, FULFILLMENT_STATUS.IN_TRANSIT, 'arriving does not change the order');
      assert.ok(notifications.some((n) => n.userId === 'buyer_1' && /arrived/i.test(n.title)));
    }

    // A cancelled order cannot be picked up.
    {
      const w = makeWorld();
      const { order, deliveryId } = await setupDelivery(w, { accept: true });
      await w.orders.updateFulfillmentStatusAtomic(order.id, FULFILLMENT_STATUS.PROCESSING, FULFILLMENT_STATUS.CANCELLED, { note: 'test' });
      assert.strictEqual(await code(w.service.updateStatus(deliveryId, 'picked_up', null, RIDER)), 'CONFLICT');
      assert.strictEqual((await w.service.getDelivery(deliveryId, SELLER)).status, 'accepted', 'a refused pickup changes nothing');
    }

    // ------------------------------------------------------------ GPS policy
    {
      const w = makeWorld();
      const { deliveryId } = await setupDelivery(w);
      assert.strictEqual(await code(w.service.recordLocation(deliveryId, { ...NEAR }, RIDER)), 'CONFLICT', 'no tracking before the rider accepts');
      await w.service.acceptDelivery(deliveryId, RIDER);

      assert.strictEqual(await code(w.service.recordLocation(deliveryId, {}, RIDER)), 'VALIDATION_ERROR', 'a missing position is an error, not 0,0');
      assert.strictEqual(await code(w.service.recordLocation(deliveryId, { lat: 95, lng: 0 }, RIDER)), 'VALIDATION_ERROR');
      assert.strictEqual(await code(w.service.recordLocation(deliveryId, { ...NEAR, accuracyM: 500 }, RIDER)), 'VALIDATION_ERROR', 'low-accuracy fixes are refused');
      assert.strictEqual(await code(w.service.recordLocation(deliveryId, { ...NEAR, heading: 400 }, RIDER)), 'VALIDATION_ERROR');
      assert.strictEqual(await code(w.service.recordLocation(deliveryId, { ...NEAR, speedKmh: -3 }, RIDER)), 'VALIDATION_ERROR');
      assert.strictEqual(await code(w.service.recordLocation(deliveryId, { ...NEAR }, BUYER)), 'PERMISSION_DENIED', 'only the rider can post a position');
      assert.strictEqual(await code(w.service.recordLocation(deliveryId, { ...NEAR }, STRANGER)), 'NOT_FOUND');

      const first = await w.service.recordLocation(deliveryId, { ...NEAR, speedKmh: 20, heading: 90, accuracyM: 12 }, RIDER);
      assert.strictEqual(first.accepted, true);
      assert.strictEqual(first.etaMinutes, null, 'no ETA until the parcel is picked up');
      assert.deepStrictEqual((await w.repo.listLocations(deliveryId)).map((p) => p.lat), [NEAR.lat], 'accepted pings are kept as history');

      w.clock.advance(1000);
      assert.deepStrictEqual(await w.service.recordLocation(deliveryId, { lat: 4.0512, lng: 9.7679 }, RIDER), { accepted: false, reason: 'throttled' });
      w.clock.advance(3000);
      const jump = await w.service.recordLocation(deliveryId, { lat: 8.0, lng: 14.0 }, RIDER);
      assert.deepStrictEqual(jump, { accepted: false, reason: 'implausible_jump' }, 'a 500 km jump in 4 seconds is a glitch');
      assert.strictEqual((await w.repo.listLocations(deliveryId)).length, 1, 'rejected pings are not stored');

      // After the plausibility window, even a far point is accepted (the rider was offline).
      w.clock.advance(120000);
      const farAfterGap = await w.service.recordLocation(deliveryId, { lat: 4.2, lng: 9.8 }, RIDER);
      assert.strictEqual(farAfterGap.accepted, true);

      // Buyer sees no rider position before pickup; seller does.
      assert.strictEqual((await w.service.getDelivery(deliveryId, BUYER)).lastLocation, null);
      assert.ok((await w.service.getDelivery(deliveryId, SELLER)).lastLocation);

      // After pickup, ETA is computed to the drop-off and the buyer can see the rider.
      // (The rider drove back from the far point: a long gap, so the move is plausible.)
      w.clock.advance(120000);
      await w.service.recordLocation(deliveryId, { ...NEAR }, RIDER);
      await w.service.updateStatus(deliveryId, 'picked_up', null, RIDER);
      w.clock.advance(5000);
      const enRoute = await w.service.recordLocation(deliveryId, { ...NEAR }, RIDER);
      assert.ok(enRoute.etaMinutes >= 1 && enRoute.distanceKm > 1, `ETA to a drop-off ~1 km away, got ${JSON.stringify(enRoute)}`);
      const buyerView = await w.service.getDelivery(deliveryId, BUYER);
      assert.ok(buyerView.lastLocation && buyerView.etaMinutes === enRoute.etaMinutes, 'the buyer sees the rider and ETA after pickup');

      // No tracking once the delivery is over.
      await w.service.updateStatus(deliveryId, 'arrived', null, RIDER);
      w.clock.advance(5000);
      assert.strictEqual((await w.service.recordLocation(deliveryId, { ...NEAR }, RIDER)).etaMinutes, 0, 'arrived means 0 minutes');
    }

    // --------------------------------------------------- handover & completion
    {
      const w = makeWorld();
      const { order, deliveryId } = await setupDelivery(w, { pickup: true });
      assert.strictEqual(await code(w.service.completeDelivery(deliveryId, '1234', RIDER)), 'CONFLICT', 'cannot complete before arriving');
      await w.service.updateStatus(deliveryId, 'arrived', null, RIDER);

      const real = (await w.service.getHandoverCode(deliveryId, BUYER)).code;
      const wrong = String((Number(real) + 1) % 10000).padStart(4, '0');
      assert.strictEqual(await code(w.service.completeDelivery(deliveryId, 'abcd', RIDER)), 'VALIDATION_ERROR', 'non-numeric');
      assert.strictEqual(await code(w.service.completeDelivery(deliveryId, '12', RIDER)), 'VALIDATION_ERROR', 'too short');
      assert.strictEqual(await code(w.service.completeDelivery(deliveryId, undefined, RIDER)), 'VALIDATION_ERROR');
      assert.strictEqual(await code(w.service.completeDelivery(deliveryId, real, BUYER)), 'PERMISSION_DENIED', 'the buyer cannot complete');
      assert.strictEqual(await code(w.service.completeDelivery(deliveryId, real, SELLER)), 'PERMISSION_DENIED', 'the seller cannot complete');

      // Format errors do not burn guesses.
      assert.strictEqual((await w.service.getHandoverCode(deliveryId, BUYER)).attemptsRemaining, MAX_HANDOVER_ATTEMPTS);

      for (let i = 1; i < MAX_HANDOVER_ATTEMPTS; i += 1) {
        assert.strictEqual(await code(w.service.completeDelivery(deliveryId, wrong, RIDER)), 'VALIDATION_ERROR', `wrong guess ${i}`);
      }
      assert.strictEqual((await w.service.getHandoverCode(deliveryId, BUYER)).attemptsRemaining, 1);
      assert.strictEqual(await code(w.service.completeDelivery(deliveryId, wrong, RIDER)), 'DELIVERY_LOCKED', 'the last wrong guess locks the delivery');
      assert.strictEqual(await code(w.service.completeDelivery(deliveryId, real, RIDER)), 'DELIVERY_LOCKED', 'even the right code cannot unlock it');
      assert.strictEqual((await w.service.getDelivery(deliveryId, SELLER)).status, 'arrived', 'a locked delivery stays arrived');
      assert.ok(notifications.some((n) => n.userId === 'seller_1' && /locked/i.test(n.title)), 'the seller is told');
      assert.strictEqual((await w.orders.findOrderById(order.id)).fulfillmentStatus, FULFILLMENT_STATUS.IN_TRANSIT);

      // A locked delivery is frozen for the rider: they cannot report `failed` to walk around the lock.
      assert.strictEqual(await code(w.service.updateStatus(deliveryId, 'failed', 'escape attempt', RIDER)), 'DELIVERY_LOCKED');
      assert.strictEqual((await w.service.getDelivery(deliveryId, SELLER)).status, 'arrived');
      assert.strictEqual(await code(w.service.cancelDelivery(deliveryId, 'x', ADMIN)), 'CONFLICT', 'not cancellable once picked up');

      // Only an administrator resolves it.
      assert.strictEqual(await code(w.service.resolveDelivery(deliveryId, { action: 'unlock' }, SELLER)), 'PERMISSION_DENIED');
      assert.strictEqual(await code(w.service.resolveDelivery(deliveryId, { action: 'unlock' }, RIDER)), 'PERMISSION_DENIED');
      assert.strictEqual(await code(w.service.resolveDelivery(deliveryId, { action: 'unlock' }, BUYER)), 'PERMISSION_DENIED');
      assert.strictEqual(await code(w.service.resolveDelivery(deliveryId, { action: 'explode' }, ADMIN)), 'VALIDATION_ERROR');
      const unlocked = await w.service.resolveDelivery(deliveryId, { action: 'unlock', note: 'Customer confirmed by phone' }, ADMIN);
      assert.strictEqual(unlocked.status, 'arrived');
      const fresh = await w.service.getHandoverCode(deliveryId, BUYER);
      assert.notStrictEqual(fresh.code, real, 'unlocking issues a new code, so the guesses made so far are void');
      assert.strictEqual(fresh.attemptsRemaining, MAX_HANDOVER_ATTEMPTS);
      assert.strictEqual(await code(w.service.resolveDelivery(deliveryId, { action: 'unlock' }, ADMIN)), 'CONFLICT', 'cannot unlock what is not locked');
      assert.strictEqual((await w.service.completeDelivery(deliveryId, fresh.code, RIDER)).status, 'delivered', 'the rider can finish after the unlock');
    }

    // Right code completes; the order follows; replays are refused.
    {
      const w = makeWorld();
      const { order, deliveryId } = await setupDelivery(w, { arrive: true });
      const real = (await w.service.getHandoverCode(deliveryId, BUYER)).code;
      assert.strictEqual(real, codeFor(deliveryId, 1));
      const done = await w.service.completeDelivery(deliveryId, real, RIDER);
      assert.strictEqual(done.status, 'delivered');
      assert.strictEqual((await w.orders.findOrderById(order.id)).fulfillmentStatus, FULFILLMENT_STATUS.DELIVERED, 'completion delivers the order');
      assert.strictEqual(await code(w.service.completeDelivery(deliveryId, real, RIDER)), 'CONFLICT', 'cannot complete twice');
      assert.strictEqual(await code(w.service.updateStatus(deliveryId, 'failed', 'x', RIDER)), 'CONFLICT', 'a delivered delivery is final');
      assert.strictEqual(await code(w.service.cancelDelivery(deliveryId, 'x', SELLER)), 'CONFLICT');
      const timeline = (await w.service.getDelivery(deliveryId, SELLER)).timeline.map((e) => e.status);
      assert.deepStrictEqual(timeline, ['pending_assignment', 'assigned', 'accepted', 'picked_up', 'arrived', 'delivered'], 'the timeline records every step in order');
      assert.strictEqual(await code(w.service.getHandoverCode(deliveryId, BUYER)), 'CONFLICT', 'no code after delivery');
      // A new delivery is now allowed for the same order only if the order were still processing; it is not.
      assert.strictEqual(await code(w.service.createDelivery(order.id, SELLER)), 'CONFLICT');
    }

    // Concurrent guesses can never exceed the budget.
    {
      const w = makeWorld();
      const { deliveryId } = await setupDelivery(w, { arrive: true });
      const real = (await w.service.getHandoverCode(deliveryId, BUYER)).code;
      const wrong = String((Number(real) + 1) % 10000).padStart(4, '0');
      const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => w.service.completeDelivery(deliveryId, wrong, RIDER)));
      const codes = outcomes.map((o) => (o.status === 'rejected' ? o.reason.code : 'OK'));
      const d = await w.repo.findById(deliveryId);
      assert.ok(!codes.includes('OK'), 'no wrong guess ever succeeds');
      assert.ok(d.codeAttempts >= 1 && d.codeAttempts <= MAX_HANDOVER_ATTEMPTS, `attempts stay within the budget (${d.codeAttempts})`);
      // Every guess that was reported as counted must be reflected in the stored
      // counter. Without the compare-and-swap, concurrent guesses overwrite each
      // other's increment and the counter ends BELOW the number of counted guesses.
      const counted = codes.filter((c) => c === 'VALIDATION_ERROR').length;
      const lockedAtBump = d.codeAttempts >= MAX_HANDOVER_ATTEMPTS ? 1 : 0; // the guess that reached the cap throws LOCKED
      assert.strictEqual(d.codeAttempts, counted + lockedAtBump, 'no guess is lost to a race');
      // And the repository CAS itself refuses a stale expectation.
      assert.strictEqual(await w.repo.updateWhere(deliveryId, { codeAttempts: 999 }, { codeAttempts: 0 }), null, 'a stale compare-and-swap changes nothing');
      assert.strictEqual((await w.repo.findById(deliveryId)).codeAttempts, d.codeAttempts);
    }

    // ------------------------------------------------------- failure and retry
    {
      const w = makeWorld();
      const { order, deliveryId } = await setupDelivery(w, { pickup: true });
      assert.strictEqual(await code(w.service.updateStatus(deliveryId, 'failed', '   ', RIDER)), 'VALIDATION_ERROR', 'a reason is required');
      assert.strictEqual(await code(w.service.updateStatus(deliveryId, 'failed', undefined, RIDER)), 'VALIDATION_ERROR');
      const oldCode = (await w.service.getHandoverCode(deliveryId, BUYER)).code;
      const failed = await w.service.updateStatus(deliveryId, 'failed', 'Customer not reachable', RIDER);
      assert.strictEqual(failed.status, 'failed');
      assert.strictEqual(failed.failureReason, 'Customer not reachable');
      assert.strictEqual((await w.service.getDelivery(deliveryId, BUYER)).failureReason, null, 'the buyer does not see internal notes');
      assert.strictEqual((await w.orders.findOrderById(order.id)).fulfillmentStatus, FULFILLMENT_STATUS.IN_TRANSIT, 'a failed delivery leaves the order in transit');
      assert.strictEqual(await code(w.service.cancelDelivery(deliveryId, 'x', SELLER)), 'CONFLICT', 'a failed delivery is retried, not cancelled');

      const retry = await w.service.assignDriver(deliveryId, 'rider_2', SELLER);
      assert.strictEqual(retry.status, 'assigned');
      assert.strictEqual(retry.driver.id, 'rider_2');
      assert.strictEqual(retry.lastLocation, null, 'the old rider\'s trail is cleared');
      assert.strictEqual(retry.failureReason, null);
      await w.service.acceptDelivery(deliveryId, RIDER2);
      const newCode = (await w.service.getHandoverCode(deliveryId, BUYER)).code;
      assert.notStrictEqual(newCode, oldCode, 'a retry gets a fresh code');
      assert.strictEqual((await w.service.getHandoverCode(deliveryId, BUYER)).attemptsRemaining, MAX_HANDOVER_ATTEMPTS, 'no guesses were spent, so the budget is intact');
      assert.strictEqual(await code(w.service.getDelivery(deliveryId, RIDER)), 'NOT_FOUND', 'the first rider no longer has access');
    }

    // ------------------------------------------------------------------ cancel
    {
      const w = makeWorld();
      const { order, deliveryId } = await setupDelivery(w);
      assert.strictEqual(await code(w.service.cancelDelivery(deliveryId, 'x', STRANGER)), 'NOT_FOUND');
      assert.strictEqual(await code(w.service.cancelDelivery(deliveryId, 'x', RIDER)), 'PERMISSION_DENIED', 'a rider cannot cancel');
      assert.strictEqual(await code(w.service.cancelDelivery(deliveryId, 'x', BUYER)), 'PERMISSION_DENIED', 'the buyer cannot cancel once a rider is assigned');
      const cancelled = await w.service.cancelDelivery(deliveryId, 'Seller out of stock', SELLER);
      assert.strictEqual(cancelled.status, 'cancelled');
      assert.strictEqual((await w.orders.findOrderById(order.id)).fulfillmentStatus, FULFILLMENT_STATUS.PROCESSING, 'cancelling a delivery does not cancel the order');
      assert.strictEqual(await code(w.service.acceptDelivery(deliveryId, RIDER)), 'CONFLICT', 'a cancelled delivery cannot be accepted');
      assert.ok(notifications.some((n) => n.userId === 'rider_1' && /cancelled/i.test(n.title)), 'the rider is told');
      // The order is free to be dispatched again.
      const again = await w.service.createDelivery(order.id, SELLER);
      assert.strictEqual(again.status, 'pending_assignment');
      assert.notStrictEqual(again.id, deliveryId);
      assert.strictEqual((await w.service.getDeliveryByOrder(order.id, BUYER)).id, again.id, 'by-order returns the open delivery, not the cancelled one');

      // A buyer may cancel while nobody is assigned.
      const w2 = makeWorld();
      const o2 = await placeOrder(w2);
      const { id } = await w2.service.createDelivery(o2.id, SELLER);
      const byBuyer = await w2.service.cancelDelivery(id, 'Changed my mind', BUYER);
      assert.strictEqual(byBuyer.status, 'cancelled');
      assert.strictEqual(byBuyer.viewerRole, 'buyer');
    }

    // The guess budget is per delivery, not per attempt: arrived -> failed -> re-assign must not refill it.
    {
      const w = makeWorld();
      const { deliveryId } = await setupDelivery(w, { arrive: true });
      const real = (await w.service.getHandoverCode(deliveryId, BUYER)).code;
      const wrong = String((Number(real) + 1) % 10000).padStart(4, '0');
      for (let i = 0; i < 3; i += 1) await code(w.service.completeDelivery(deliveryId, wrong, RIDER));
      await w.service.updateStatus(deliveryId, 'failed', 'Customer absent', RIDER);
      await w.service.assignDriver(deliveryId, 'rider_1', SELLER);
      await w.service.acceptDelivery(deliveryId, RIDER);
      const after = await w.service.getHandoverCode(deliveryId, BUYER);
      assert.strictEqual(after.attemptsRemaining, MAX_HANDOVER_ATTEMPTS - 3, 'a retry does not refill the guess budget');
      assert.notStrictEqual(after.code, real, 'but it does get a new code');
    }

    // Suspension revokes work in flight, not just new accepts.
    {
      const w = makeWorld();
      const { deliveryId } = await setupDelivery(w, { pickup: true });
      await w.service.registerDriver('rider_1', { name: 'Alain', phone: '+237600000001', status: 'suspended' }, ADMIN);
      assert.strictEqual(await code(w.service.updateStatus(deliveryId, 'arrived', null, RIDER)), 'PERMISSION_DENIED', 'a suspended rider is locked out mid-delivery');
      assert.strictEqual(await code(w.service.recordLocation(deliveryId, { ...NEAR }, RIDER)), 'PERMISSION_DENIED');
      assert.strictEqual(await code(w.service.completeDelivery(deliveryId, '1234', RIDER)), 'PERMISSION_DENIED');
      assert.strictEqual((await w.service.getDelivery(deliveryId, SELLER)).status, 'picked_up', 'a parcel already collected is not silently reassigned');
      assert.ok(notifications.some((n) => n.userId === 'seller_1' && /suspended/i.test(n.title)), 'the seller is told it needs an administrator');

      // The administrator fails it, and the seller can send another rider.
      assert.strictEqual(await code(w.service.resolveDelivery(deliveryId, { action: 'fail' }, ADMIN)), 'VALIDATION_ERROR', 'a reason is required');
      assert.strictEqual(await code(w.service.resolveDelivery(deliveryId, { action: 'fail', note: 'x' }, SELLER)), 'PERMISSION_DENIED');
      const failed = await w.service.resolveDelivery(deliveryId, { action: 'fail', note: 'Rider suspended mid-delivery' }, ADMIN);
      assert.strictEqual(failed.status, 'failed');
      assert.strictEqual((await w.service.assignDriver(deliveryId, 'rider_2', SELLER)).driver.id, 'rider_2');
    }
    {
      const w = makeWorld();
      const { deliveryId } = await setupDelivery(w, { accept: true });
      await w.service.registerDriver('rider_1', { name: 'Alain', phone: '+237600000001', status: 'suspended' }, ADMIN);
      const d = await w.service.getDelivery(deliveryId, SELLER);
      assert.strictEqual(d.status, 'pending_assignment', 'an un-started job goes back to the seller');
      assert.strictEqual(d.driver, null);
    }

    // A seller who delivers their own parcel can use the rider endpoints.
    {
      const w = makeWorld();
      await w.service.registerDriver('seller_1', { name: 'Shop owner', phone: '+237600000009' }, ADMIN);
      const order = await placeOrder(w);
      const { id } = await w.service.createDelivery(order.id, SELLER, { dropoffLocation: { lat: 4.0601, lng: 9.7679 } });
      await w.service.assignDriver(id, 'seller_1', SELLER);
      const accepted = await w.service.acceptDelivery(id, SELLER);
      assert.strictEqual(accepted.viewerRole, 'driver', 'acting as the rider, they get the rider view');
      w.clock.advance(5000);
      assert.strictEqual((await w.service.updateStatus(id, 'picked_up', null, SELLER)).status, 'picked_up');
      assert.strictEqual((await w.service.getDelivery(id, SELLER)).viewerRole, 'seller', 'reading it back, they are still the seller');
    }

    // Order cancellation and deliveries.
    {
      const w = makeWorld();
      const { order, deliveryId } = await setupDelivery(w, { accept: true });
      const cancelled = await w.service.cancelForOrder(order.id, { reason: 'Buyer cancelled the order' });
      assert.strictEqual(cancelled.status, 'cancelled', 'cancelling the order cancels its un-collected delivery');
      assert.ok(notifications.some((n) => n.userId === 'rider_1' && /cancelled/i.test(n.title)), 'the rider is told');
      assert.strictEqual(await w.service.cancelForOrder('ord_unknown'), null, 'no delivery, nothing to do');
      assert.strictEqual(await w.service.cancelForOrder(order.id), null, 'idempotent');
      assert.strictEqual((await w.service.getDelivery(deliveryId, SELLER)).status, 'cancelled');

      const w2 = makeWorld();
      const s2 = await setupDelivery(w2, { pickup: true });
      assert.strictEqual(await w2.service.cancelForOrder(s2.order.id, {}), null, 'a collected parcel is not cancelled behind the rider\'s back');
      assert.strictEqual((await w2.service.getDelivery(s2.deliveryId, SELLER)).status, 'picked_up');

      // Order cancelled WITHOUT the hook having run (e.g. a failed hook): the rider cannot continue.
      const w3 = makeWorld();
      const s3 = await setupDelivery(w3);
      await w3.orders.updateFulfillmentStatusAtomic(s3.order.id, FULFILLMENT_STATUS.PROCESSING, FULFILLMENT_STATUS.CANCELLED, { note: 't' });
      assert.strictEqual(await code(w3.service.acceptDelivery(s3.deliveryId, RIDER)), 'CONFLICT', 'cannot accept a cancelled order');
      assert.strictEqual(await code(w3.service.assignDriver(s3.deliveryId, 'rider_2', SELLER)), 'CONFLICT', 'cannot assign a cancelled order');
    }

    // A missed pickup sync is repaired on the way to delivered; a delivered parcel is never re-dispatched.
    {
      const w = makeWorld();
      const { order, deliveryId } = await setupDelivery(w, { arrive: true });
      const stored = await w.orders.findOrderById(order.id);
      stored.fulfillmentStatus = FULFILLMENT_STATUS.PROCESSING; // pretend the in_transit sync was lost
      const real = (await w.service.getHandoverCode(deliveryId, BUYER)).code;
      await w.service.completeDelivery(deliveryId, real, RIDER);
      assert.strictEqual((await w.orders.findOrderById(order.id)).fulfillmentStatus, FULFILLMENT_STATUS.DELIVERED, 'processing -> in_transit -> delivered');
      stored.fulfillmentStatus = FULFILLMENT_STATUS.PROCESSING; // and pretend the delivered sync was lost too
      assert.strictEqual(await code(w.service.createDelivery(order.id, SELLER)), 'CONFLICT', 'no second delivery for a parcel already handed over');
      assert.strictEqual(await code(w.service.reconcileOrder(deliveryId, SELLER)), 'PERMISSION_DENIED', 'reconciliation is an admin tool');
      await w.service.reconcileOrder(deliveryId, ADMIN);
      assert.strictEqual((await w.orders.findOrderById(order.id)).fulfillmentStatus, FULFILLMENT_STATUS.DELIVERED, 'reconcile repairs it');
    }

    // A failing audit write after the state change must not fail the request or skip the order sync.
    {
      const w = makeWorld();
      const { order, deliveryId } = await setupDelivery(w, { accept: true });
      const realInsert = w.repo.insertEvent.bind(w.repo);
      w.repo.insertEvent = async () => { throw new Error('timeline store is down'); };
      const picked = await w.service.updateStatus(deliveryId, 'picked_up', null, RIDER);
      w.repo.insertEvent = realInsert;
      assert.strictEqual(picked.status, 'picked_up', 'the rider gets success: the change did happen');
      assert.strictEqual((await w.orders.findOrderById(order.id)).fulfillmentStatus, FULFILLMENT_STATUS.IN_TRANSIT, 'and the order still follows');
      assert.strictEqual(await code(w.service.updateStatus(deliveryId, 'picked_up', null, RIDER)), 'CONFLICT', 'a retry is correctly refused, not double-applied');
    }

    // Stale position writes cannot overwrite a newer one.
    {
      const w = makeWorld();
      const { deliveryId } = await setupDelivery(w, { accept: true });
      const stale = await w.repo.findById(deliveryId);
      w.clock.advance(5000);
      assert.strictEqual((await w.service.recordLocation(deliveryId, { ...NEAR }, RIDER)).accepted, true);
      assert.strictEqual(
        await w.repo.updateWhere(deliveryId, { updatedAt: stale.updatedAt }, { lastLocation: { lat: 1, lng: 1, at: 'old' } }),
        null,
        'a write based on an out-of-date read is refused'
      );
      assert.deepStrictEqual((await w.repo.findById(deliveryId)).lastLocation.lat, NEAR.lat, 'the newer position survived');
      // Two pings computed from the same read: exactly one lands, the other is told it was superseded.
      w.clock.advance(5000);
      const pings = await Promise.all([
        w.service.recordLocation(deliveryId, { lat: 4.0520, lng: 9.7679 }, RIDER),
        w.service.recordLocation(deliveryId, { lat: 4.0530, lng: 9.7679 }, RIDER)
      ]);
      assert.strictEqual(pings.filter((p) => p.accepted).length, 1, 'only one of two simultaneous pings is stored');
      assert.ok(pings.some((p) => p.reason === 'busy'), 'the loser is told why');
    }

    // Account deletion scrubs the rider record and releases their un-started work.
    {
      const w = makeWorld();
      const { deliveryId } = await setupDelivery(w, { accept: true });
      await w.service.onAccountDeleted('rider_1');
      const scrubbed = await w.repo.findDriver('rider_1');
      assert.strictEqual(scrubbed.name, 'Anonymized Rider');
      assert.strictEqual(scrubbed.phone, '+237000000000');
      assert.strictEqual(scrubbed.status, 'suspended', 'a deleted rider is no longer assignable');
      assert.deepStrictEqual((await w.service.listDrivers(SELLER)).map((d) => d.id), ['rider_2']);
      assert.strictEqual((await w.service.getDelivery(deliveryId, SELLER)).status, 'pending_assignment');
      await w.service.onAccountDeleted('somebody_who_is_not_a_rider'); // no-op, no throw
      await w.service.onAccountDeleted('');
    }

    // ----------------------------------------------------------- rider overview
    {
      const w = makeWorld();
      const { deliveryId } = await setupDelivery(w, { accept: true });
      const overview = await w.service.getRiderOverview(RIDER);
      assert.strictEqual(overview.driver.id, 'rider_1');
      assert.deepStrictEqual(overview.deliveries.map((d) => d.id), [deliveryId]);
      assert.strictEqual(overview.deliveries[0].viewerRole, 'driver');
      assert.strictEqual(overview.deliveries[0].dropoff.contactPhone, '+237622222222', 'after accepting, the rider has the customer phone');
      assert.deepStrictEqual((await w.service.getRiderOverview(RIDER2)).deliveries, [], 'another rider sees nothing');
      {
        const w2 = makeWorld();
        const s2 = await setupDelivery(w2); // assigned, NOT accepted
        const pending = (await w2.service.getRiderOverview(RIDER)).deliveries[0];
        assert.deepStrictEqual(Object.keys(pending.dropoff).sort(), ['area', 'location'], 'before accepting: area and a coarse point only');
        assert.strictEqual(pending.dropoff.area, 'Douala');
        assert.deepStrictEqual(pending.dropoff.location, { lat: 4.06, lng: 9.77 });
        assert.ok(s2.deliveryId);
      }
      await w.service.registerDriver('rider_1', { name: 'Alain', phone: '+237600000001', status: 'suspended' }, ADMIN);
      assert.strictEqual(await code(w.service.getRiderOverview(RIDER)), 'PERMISSION_DENIED', 'a suspended rider is locked out');
      assert.strictEqual(await code(w.service.acceptDelivery(deliveryId, RIDER)), 'NOT_FOUND', 'and their un-started work was released, so they have no access to it');
    }

    // ------------------------------------------------------------------ events
    {
      const w = makeWorld();
      const received = [];
      await w.service.registerDriver('rider_1', { name: 'Alain', phone: '+237600000001' }, ADMIN);
      const order = await placeOrder(w);
      const { id } = await w.service.createDelivery(order.id, SELLER, { dropoffLocation: { lat: 4.0601, lng: 9.7679 } });
      const unsubscribe = w.events.subscribe(id, (e) => received.push(e));
      await w.service.assignDriver(id, 'rider_1', SELLER);
      await w.service.acceptDelivery(id, RIDER);
      await w.service.recordLocation(id, { ...NEAR }, RIDER);
      assert.deepStrictEqual(received.map((e) => e.type), ['status', 'status', 'location']);
      assert.strictEqual(received[2].status, 'accepted', 'location events carry the status so the stream can apply visibility rules');
      unsubscribe();
      w.clock.advance(5000);
      await w.service.updateStatus(id, 'picked_up', null, RIDER);
      assert.strictEqual(received.length, 3, 'an unsubscribed listener hears nothing more');
      assert.strictEqual(w.events.listenerCount(id), 0);
      // A throwing listener must not break the write that triggered it.
      w.events.subscribe(id, () => { throw new Error('boom'); });
      w.clock.advance(5000);
      assert.strictEqual((await w.service.updateStatus(id, 'arrived', null, RIDER)).status, 'arrived');
    }

    // ------------------------------------------------------------- reconciliation
    {
      const w = makeWorld();
      const { order, deliveryId } = await setupDelivery(w, { pickup: true });
      // Simulate a failed order sync: the order was never moved.
      await w.orders.updateFulfillmentStatusAtomic(order.id, FULFILLMENT_STATUS.IN_TRANSIT, FULFILLMENT_STATUS.DELIVERED, { note: 'manual' }).catch(() => {});
      const fresh = makeWorld();
      const o = await placeOrder(fresh);
      await fresh.service.registerDriver('rider_1', { name: 'A', phone: '+237600000001' }, ADMIN);
      const d = await fresh.service.createDelivery(o.id, SELLER);
      await fresh.service.assignDriver(d.id, 'rider_1', SELLER);
      await fresh.service.acceptDelivery(d.id, RIDER);
      await fresh.service.updateStatus(d.id, 'picked_up', null, RIDER);
      // Roll the order back to processing to emulate a lost sync, then repair it.
      const stored = await fresh.orders.findOrderById(o.id);
      stored.fulfillmentStatus = FULFILLMENT_STATUS.PROCESSING;
      await fresh.service.reconcileOrder(d.id, ADMIN);
      assert.strictEqual((await fresh.orders.findOrderById(o.id)).fulfillmentStatus, FULFILLMENT_STATUS.IN_TRANSIT, 'reconcileOrder repairs a missed sync');
      await fresh.service.reconcileOrder(d.id, ADMIN); // idempotent
      assert.ok(deliveryId && order);
    }

    // Orders are read FRESH from the database for every decision. OrderRepository's
    // ordinary read serves a per-instance cache that is never refreshed, so an order
    // cancelled or refunded elsewhere would still look live to this service.
    {
      const makeRow = (over = {}) => ({
        id: 'ord_db_1', buyer_id: 'buyer_1', seller_id: 'seller_1', order_number: 'KM-TEST-DB1', total_amount_xaf: 50000,
        items: [{ listingId: 'lst_1', title: 'Phone', unitPriceXaf: 50000, quantity: 1, sellerId: 'seller_1', storeName: 'Tech Shop' }],
        shipping_address: { fullName: 'Awa', phone: '+237622222222', city: 'Douala', _deliveryMethod: 'HOME_DELIVERY' },
        payment_status: 'paid', fulfillment_status: 'processing',
        created_at: '2026-10-03T09:00:00.000Z', updated_at: '2026-10-03T09:00:00.000Z', ...over
      });

      // The repository itself.
      const rows = new Map([['ord_db_1', makeRow()]]);
      const orders = new OrderRepository({ db: stubOrdersDb(rows) });
      assert.strictEqual((await orders.findOrderById('ord_db_1')).fulfillmentStatus, 'processing');
      rows.get('ord_db_1').fulfillment_status = 'cancelled'; // cancelled by another request
      assert.strictEqual((await orders.findOrderById('ord_db_1')).fulfillmentStatus, 'processing', 'the ordinary read is stale: this is why a fresh read exists');
      assert.strictEqual((await orders.findOrderByIdFresh('ord_db_1')).fulfillmentStatus, 'cancelled', 'the fresh read sees the database');
      assert.strictEqual((await orders.findOrderById('ord_db_1')).fulfillmentStatus, 'cancelled', 'and refreshes the cache');
      assert.strictEqual((await orders.findOrderByIdFresh('KM-TEST-DB1')).id, 'ord_db_1', 'an order number resolves too');
      rows.delete('ord_db_1');
      assert.strictEqual(await orders.findOrderByIdFresh('ord_db_1'), null, 'a row that is gone is gone');
      assert.strictEqual(await orders.findOrderById('ord_db_1'), null, 'including from the cache');
      assert.strictEqual(await orders.findOrderByIdFresh(''), null);
      assert.strictEqual(await new OrderRepository({ db: null }).findOrderByIdFresh('nope'), null, 'no database: falls back to memory');

      // The atomic status update compares against the database, not a cached copy.
      const rows2 = new Map([['ord_db_1', makeRow()]]);
      const orders2 = new OrderRepository({ db: stubOrdersDb(rows2) });
      await orders2.findOrderById('ord_db_1'); // warm the cache at "processing"
      rows2.get('ord_db_1').fulfillment_status = 'in_transit'; // moved on elsewhere
      assert.strictEqual(
        await code(orders2.updateFulfillmentStatusAtomic('ord_db_1', 'processing', 'in_transit', { note: 'x' })),
        'CONFLICT',
        'a stale cache must not turn into a silent success or a bogus transition'
      );

      // The delivery service's decisions.
      const rows3 = new Map([['ord_db_1', makeRow()]]);
      const orders3 = new OrderRepository({ db: stubOrdersDb(rows3) });
      const w = { repo: new DeliveryRepository({ db: null }) };
      const service = new DeliveryService({ repository: w.repo, orderRepository: orders3, events: new DeliveryEvents() });
      await orders3.findOrderById('ord_db_1'); // the cache believes: processing, paid
      rows3.get('ord_db_1').fulfillment_status = 'cancelled';
      assert.strictEqual(await code(service.createDelivery('ord_db_1', SELLER)), 'CONFLICT', 'a delivery is not created for an order that was cancelled elsewhere');
      rows3.get('ord_db_1').fulfillment_status = 'processing';
      rows3.get('ord_db_1').payment_status = 'refunded';
      assert.strictEqual(await code(service.createDelivery('ord_db_1', SELLER)), 'CONFLICT', 'nor for one that was refunded elsewhere');
      rows3.get('ord_db_1').payment_status = 'paid';
      const made = await service.createDelivery('ord_db_1', SELLER);
      assert.strictEqual(made.status, 'pending_assignment', 'once the database says it is deliverable, it is');
    }

    // Re-registering a rider without a status keeps whatever the rider already had.
    {
      const w = makeWorld();
      await w.service.registerDriver('rider_1', { name: 'Alain', phone: '+237600000001', status: 'suspended' }, ADMIN);
      await w.service.registerDriver('rider_1', { name: 'Alain B.', phone: '+237600000001' }, ADMIN);
      const kept = await w.repo.findDriver('rider_1');
      assert.strictEqual(kept.status, 'suspended', 'an omitted status never reactivates a suspended rider');
      assert.strictEqual(kept.name, 'Alain B.');
      assert.strictEqual(await code(w.service.registerDriver('rider_1', { name: 'A', phone: '+237600000001', status: 'banished' }, ADMIN)), 'VALIDATION_ERROR');
      await w.service.registerDriver('rider_1', { name: 'Alain B.', phone: '+237600000001', status: 'active' }, ADMIN);
      assert.strictEqual((await w.repo.findDriver('rider_1')).status, 'active', 'reactivation is explicit');
      await w.service.registerDriver('rider_new', { name: 'New', phone: '+237600000009' }, ADMIN);
      assert.strictEqual((await w.repo.findDriver('rider_new')).status, 'active', 'a new rider starts active');
    }

    console.log('    ✓ Delivery service: authorisation, flow, GPS policy, handover budget and races hold.');
  } finally {
    NotificationService.create = originalCreate;
    if (!hadSecret) config.supabase.jwtSecret = hadSecret;
  }
}

module.exports = { run };
