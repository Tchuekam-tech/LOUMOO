/**
 * LOUMOO — Delivery dispatch
 * ---------------------------------------------------------------------------
 * How a delivery gets from "needs a rider" to "a rider accepted it": the offer
 * window and its expiry (lazy and swept), the rider list with workload, and
 * auto-assign. Runs over the in-memory backends with a fake clock: no database,
 * no HTTP. See docs/DELIVERY_API.md ("Offer expiry", "auto-assign").
 */

require('../setup');

const assert = require('assert');
const config = require('../../server/config/env');

const { DeliveryService } = require('../../server/modules/delivery/application/DeliveryService');
const { DeliveryRepository } = require('../../server/modules/delivery/infrastructure/DeliveryRepository');
const { DeliveryEvents } = require('../../server/modules/delivery/infrastructure/DeliveryEvents');
const { OrderRepository } = require('../../server/modules/commerce/infrastructure/OrderRepository');
const { Order, FULFILLMENT_STATUS, DELIVERY_METHOD, PAYMENT_STATUS } = require('../../server/modules/commerce/domain/Order');

const MIN = 60 * 1000;
const OFFER_TTL_MS = 15 * MIN;

async function code(promise) {
  try {
    await promise;
    return 'OK';
  } catch (e) {
    return e.code || e.name || 'ERROR';
  }
}

function makeWorld({ offerTtlMs = OFFER_TTL_MS } = {}) {
  let t = Date.parse('2026-10-03T10:00:00.000Z');
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const orders = new OrderRepository({ db: null });
  const repo = new DeliveryRepository({ db: null });
  const events = new DeliveryEvents();
  const service = new DeliveryService({ repository: repo, orderRepository: orders, events, now: clock.now, offerTtlMs });
  return { clock, orders, repo, events, service };
}

let orderSeq = 0;
async function placeOrder(world, overrides = {}) {
  orderSeq += 1;
  const order = new Order({
    buyerId: 'buyer_1',
    sellerId: 'seller_1',
    items: [{ listingId: `lst_${orderSeq}`, title: 'Phone', unitPriceXaf: 50000, quantity: 1, sellerId: 'seller_1', storeName: 'Tech Shop' }],
    shippingAddress: { fullName: 'Awa Njoya', phone: '+237622222222', street: 'Rue 1', city: 'Douala' },
    deliveryMethod: DELIVERY_METHOD.HOME_DELIVERY,
    paymentStatus: PAYMENT_STATUS.PAID,
    fulfillmentStatus: FULFILLMENT_STATUS.PROCESSING,
    ...overrides
  });
  return world.orders.saveOrder(order);
}

const BUYER = { userId: 'buyer_1', userRole: 'customer' };
const SELLER = { userId: 'seller_1', userRole: 'seller' };
const OTHER_SELLER = { userId: 'seller_2', userRole: 'seller' };
const ADMIN = { userId: 'admin_1', userRole: 'admin' };
const RIDER = { userId: 'rider_1', userRole: 'customer' };
const RIDER2 = { userId: 'rider_2', userRole: 'customer' };

async function registerRiders(world, riders = [['rider_1', 'Alain'], ['rider_2', 'Bruno']]) {
  let n = 0;
  for (const [id, name] of riders) {
    n += 1;
    await world.service.registerDriver(id, { name, phone: `+23760000${String(n).padStart(4, '0')}` }, ADMIN);
  }
}

/** A delivery created for a fresh order, optionally already offered to a rider. */
async function newDelivery(world, { assignTo = null, overrides = {} } = {}) {
  const order = await placeOrder(world, overrides);
  const created = await world.service.createDelivery(order.id, SELLER, {});
  if (assignTo) await world.service.assignDriver(created.id, assignTo, SELLER);
  return { order, id: created.id };
}

async function run() {
  console.log('  Testing Delivery dispatch...');

  const hadSecret = config.supabase.jwtSecret;
  if (!hadSecret) config.supabase.jwtSecret = 'unit-test-delivery-secret-0123456789abcdef';

  // Keep the suite pure: no notification rows, whatever the machine's credentials.
  const NotificationService = require('../../server/modules/identity/application/NotificationService');
  const originalCreate = NotificationService.create;
  const notifications = [];
  NotificationService.create = async (userId, payload) => { notifications.push({ userId, ...payload }); return null; };
  const sentTo = (userId, title) => notifications.filter((n) => n.userId === userId && n.title === title);

  try {
    // ----------------------------------------------------- the offer's deadline
    {
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      const deadline = new Date(w.clock.now() + OFFER_TTL_MS).toISOString();

      assert.strictEqual((await w.service.getDelivery(id, SELLER)).offerExpiresAt, deadline, 'the seller sees when the offer lapses');
      assert.strictEqual((await w.service.getDelivery(id, ADMIN)).offerExpiresAt, deadline, 'and so does an admin');
      assert.strictEqual((await w.service.getDelivery(id, RIDER)).offerExpiresAt, deadline, 'and the rider holding it');
      assert.strictEqual((await w.service.getDelivery(id, BUYER)).offerExpiresAt, null, 'the buyer never learns of the offer');
      const overview = await w.service.getRiderOverview(RIDER);
      assert.strictEqual(overview.deliveries[0].offerExpiresAt, deadline, "the rider's job list carries the countdown too");

      await w.service.acceptDelivery(id, RIDER);
      assert.strictEqual((await w.service.getDelivery(id, SELLER)).offerExpiresAt, null, 'once accepted there is no deadline');
    }

    // ------------------------------------------- accepting at, before and after it
    {
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS - 1);
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'OK', 'one millisecond before the deadline the rider can still accept');
      assert.strictEqual((await w.service.getDelivery(id, SELLER)).status, 'accepted');
    }
    {
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS);
      const before = notifications.length;

      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'OFFER_EXPIRED', 'at the deadline the offer is gone');
      const seller = await w.service.getDelivery(id, SELLER);
      assert.strictEqual(seller.status, 'pending_assignment', 'the failed accept released it to the seller');
      assert.strictEqual(seller.driver, null, 'with no rider on it');
      assert.strictEqual(seller.offerExpiresAt, null);
      assert.strictEqual((await w.repo.findById(id)).assignedAt, null, 'assignedAt is cleared');
      const last = seller.timeline[seller.timeline.length - 1];
      assert.strictEqual(last.status, 'pending_assignment');
      assert.strictEqual(last.note, 'Offer expired: no response from the rider', 'the timeline says why');
      assert.strictEqual(sentTo('seller_1', 'A rider did not respond').length, 1, 'the seller is told');
      assert.strictEqual(sentTo('rider_1', 'A delivery offer expired').length, 1, 'and so is the rider');
      assert.strictEqual(notifications.length - before, 2, 'and nobody else');

      assert.strictEqual(await code(w.service.getDelivery(id, RIDER)), 'NOT_FOUND', 'the rider has lost access, as after a decline');
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'NOT_FOUND', 'a second accept is a 404: they no longer hold it');
      assert.deepStrictEqual((await w.service.getRiderOverview(RIDER)).deliveries, [], 'it is gone from their job list');
      assert.strictEqual(sentTo('seller_1', 'A rider did not respond').length, 1, 'nothing fires twice');
    }

    // --------------------------------------------- lazy release on every read path
    for (const [label, read] of [
      ['seller GET /:id', (w, id) => w.service.getDelivery(id, SELLER)],
      ['buyer GET /:id', (w, id) => w.service.getDelivery(id, BUYER)],
      ['buyer GET /by-order', (w, id, order) => w.service.getDeliveryByOrder(order.id, BUYER)],
      ['seller GET /by-order', (w, id, order) => w.service.getDeliveryByOrder(order.orderNumber, SELLER)],
      ['stream access check', async (w, id) => { await w.service.getViewerRole(id, SELLER); return w.service.getDelivery(id, SELLER); }]
    ]) {
      const w = makeWorld();
      await registerRiders(w);
      const { id, order } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS + MIN);
      const seen = await read(w, id, order);
      assert.strictEqual(seen.status, 'pending_assignment', `${label}: a lapsed offer reads as pending, not assigned`);
      assert.strictEqual((await w.repo.findById(id)).driverId, null, `${label}: and was really released`);
    }
    {
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS + MIN);
      assert.strictEqual(await w.service.getViewerRole(id, RIDER), null, "the live stream's access check drops the rider");
      assert.strictEqual(await w.service.getViewerRole(id, SELLER), 'seller', 'and keeps the seller');
    }
    {
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS + MIN);
      const overview = await w.service.getRiderOverview(RIDER);
      assert.deepStrictEqual(overview.deliveries, [], "GET /driver/me no longer lists a lapsed offer");
      assert.strictEqual((await w.repo.findById(id)).status, 'pending_assignment', 'and released it');
    }

    // ----------------------------------------------------- accepted never expires
    {
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(MIN);
      await w.service.acceptDelivery(id, RIDER);
      w.clock.advance(10 * 60 * MIN);
      assert.strictEqual((await w.service.getDelivery(id, SELLER)).status, 'accepted', 'ten hours later it is still the rider\'s');
      assert.deepStrictEqual(await w.service.expireStaleOffers(), { expired: 0 }, 'the sweep leaves an accepted job alone');
      assert.strictEqual((await w.service.getRiderOverview(RIDER)).deliveries.length, 1);
    }

    // --------------------------------------------- re-assigning starts a new window
    {
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(10 * MIN);
      await w.service.assignDriver(id, 'rider_2', SELLER);
      assert.strictEqual((await w.service.getDelivery(id, SELLER)).offerExpiresAt, new Date(w.clock.now() + OFFER_TTL_MS).toISOString(),
        'a re-assignment restarts the clock');
      w.clock.advance(10 * MIN); // 20 minutes after the FIRST offer
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER2)), 'OK', 'the new rider is judged on their own window');
    }
    {
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(14 * MIN);
      await w.service.assignDriver(id, 'rider_1', SELLER); // a nudge to the same rider
      w.clock.advance(2 * MIN);
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'OK', 'offering again to the same rider also restarts the window');
    }

    // ----------------------------------------------------------- expiry switched off
    {
      const w = makeWorld({ offerTtlMs: 0 });
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      assert.strictEqual((await w.service.getDelivery(id, SELLER)).offerExpiresAt, null, 'no deadline is shown');
      w.clock.advance(24 * 60 * MIN);
      assert.deepStrictEqual(await w.service.expireStaleOffers(), { expired: 0 }, 'the sweep does nothing');
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'OK', 'a day later the rider can still accept');
    }

    // ------------------------------------------------------------------ the sweep
    {
      const w = makeWorld();
      await registerRiders(w);
      const a = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(5 * MIN);
      const b = await newDelivery(w, { assignTo: 'rider_2' });
      w.clock.advance(5 * MIN);
      const c = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(6 * MIN); // a: 16 min old (lapsed), b: 11 (open), c: 6 (open)
      assert.deepStrictEqual(await w.service.expireStaleOffers(), { expired: 1 }, 'only the lapsed offer is released');
      assert.strictEqual((await w.repo.findById(a.id)).status, 'pending_assignment');
      assert.strictEqual((await w.repo.findById(b.id)).status, 'assigned');
      assert.strictEqual((await w.repo.findById(c.id)).status, 'assigned');
      assert.deepStrictEqual(await w.service.expireStaleOffers(), { expired: 0 }, 'a second sweep finds nothing new');

      w.clock.advance(10 * MIN); // b and c lapse
      assert.deepStrictEqual(await w.service.expireStaleOffers({ limit: 1 }), { expired: 1 }, 'the limit bounds one sweep');
      assert.deepStrictEqual(await w.service.expireStaleOffers({ limit: 1 }), { expired: 1 });
      assert.deepStrictEqual(await w.service.expireStaleOffers({ limit: 1 }), { expired: 0 }, 'and the backlog drains over several sweeps');
      assert.strictEqual((await w.repo.findById(b.id)).status, 'pending_assignment');
      assert.strictEqual((await w.repo.findById(c.id)).status, 'pending_assignment');
    }
    {
      // Two sweeps at once (two instances, or a sweep racing a read) release it once.
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS + MIN);
      const before = sentTo('seller_1', 'A rider did not respond').length;
      const results = await Promise.all([w.service.expireStaleOffers(), w.service.expireStaleOffers(), w.service.getDelivery(id, SELLER)]);
      assert.strictEqual(results[0].expired + results[1].expired, 1, 'exactly one sweep wins the swap');
      assert.strictEqual(sentTo('seller_1', 'A rider did not respond').length - before, 1, 'the seller is told once');
      assert.strictEqual((await w.service.getDelivery(id, SELLER)).timeline.filter((e) => e.note && e.note.startsWith('Offer expired')).length, 1,
        'one timeline row');
    }
    {
      // A sweep that read a stale snapshot must not clobber a fresh offer to the same rider.
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS + MIN);
      const stale = await w.repo.findById(id); // what the sweeper read
      await w.service.assignDriver(id, 'rider_1', SELLER); // the seller re-offers to the same rider meanwhile
      assert.strictEqual(await w.service._expireOffer(stale), null, 'the swap is refused: the offer is a new one');
      const fresh = await w.repo.findById(id);
      assert.strictEqual(fresh.status, 'assigned');
      assert.strictEqual(fresh.driverId, 'rider_1', 'the fresh offer survives');
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'OK', 'and can be accepted');
    }

    // --------------------------------------------- after expiry the seller moves on
    {
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS + MIN);
      await w.service.expireStaleOffers();
      const reassigned = await w.service.assignDriver(id, 'rider_2', SELLER);
      assert.strictEqual(reassigned.status, 'assigned');
      assert.strictEqual(reassigned.driver.id, 'rider_2', 'the seller can offer it to someone else');
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER2)), 'OK');
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'NOT_FOUND', 'the first rider cannot sneak back in');
    }

    // ------------------------------------------------- the live stream hears of it
    {
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      const heard = [];
      const unsubscribe = w.events.subscribe(id, (e) => heard.push(e));
      w.clock.advance(OFFER_TTL_MS + MIN);
      await w.service.expireStaleOffers();
      unsubscribe();
      assert.ok(heard.some((e) => e.type === 'status' && e.status === 'pending_assignment'), 'an expiry is published like any status change');
    }

    // --------------------------------------------------- only the right people read
    {
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS + MIN);
      // A stranger probing a lapsed offer learns nothing: the same 404 as for an id that does not exist.
      // (The release itself is not a secret and would have happened on the next sweep anyway.)
      assert.strictEqual(await code(w.service.getDelivery(id, OTHER_SELLER)), 'NOT_FOUND');
      assert.strictEqual(await code(w.service.getDelivery('dlv_does_not_exist', OTHER_SELLER)), 'NOT_FOUND', 'indistinguishable from a missing id');
    }

    console.log('    ✓ Delivery dispatch: offer window, lazy and swept expiry hold.');
  } finally {
    NotificationService.create = originalCreate;
    if (!hadSecret) config.supabase.jwtSecret = hadSecret;
  }
}

module.exports = { run };
