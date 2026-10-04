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
const logger = require('../../server/shared/logging/logger');

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
      const sellerBefore = sentTo('seller_1', 'A rider did not respond').length;
      const riderBefore = sentTo('rider_1', 'A delivery offer expired').length;

      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'OFFER_EXPIRED', 'at the deadline the offer is gone');
      const seller = await w.service.getDelivery(id, SELLER);
      assert.strictEqual(seller.status, 'pending_assignment', 'the failed accept released it to the seller');
      assert.strictEqual(seller.driver, null, 'with no rider on it');
      assert.strictEqual(seller.offerExpiresAt, null);
      assert.strictEqual((await w.repo.findById(id)).assignedAt, null, 'assignedAt is cleared');
      const last = seller.timeline[seller.timeline.length - 1];
      assert.strictEqual(last.status, 'pending_assignment');
      assert.strictEqual(last.note, 'Offer expired: no response from the rider', 'the timeline says why');
      assert.strictEqual(sentTo('seller_1', 'A rider did not respond').length - sellerBefore, 1, 'the seller is told');
      assert.strictEqual(sentTo('rider_1', 'A delivery offer expired').length - riderBefore, 1, 'and so is the rider');
      assert.strictEqual(notifications.length - before, 2, 'and nobody else');

      assert.strictEqual(await code(w.service.getDelivery(id, RIDER)), 'NOT_FOUND', 'the rider has lost access, as after a decline');
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'OFFER_EXPIRED', 'a second accept is still "too late", not "not found": the lapse released it but it was theirs');
      assert.deepStrictEqual((await w.service.getRiderOverview(RIDER)).deliveries, [], 'it is gone from their job list');
      assert.strictEqual(sentTo('seller_1', 'A rider did not respond').length - sellerBefore, 1, 'nothing fires twice');
    }

    // --------------------------------------------- lazy release on every read path
    for (const [label, read] of [
      ['seller GET /:id', (w, id) => w.service.getDelivery(id, SELLER)],
      ['buyer GET /:id', (w, id) => w.service.getDelivery(id, BUYER)],
      ['buyer GET /by-order', (w, id, order) => w.service.getDeliveryByOrder(order.id, BUYER)],
      ['seller GET /by-order', (w, id, order) => w.service.getDeliveryByOrder(order.orderNumber, SELLER)]
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

    // -------------------------------------- the rider is told how long they have
    {
      for (const [ttl, expected] of [
        [OFFER_TTL_MS, 'Open LOUMOO to accept or decline it within 15 minutes.'],
        [MIN, 'Open LOUMOO to accept or decline it within 1 minute.'],
        [90 * 1000, 'Open LOUMOO to accept or decline it within 1 minute.'],     // rounded down, never up
        [150 * 1000, 'Open LOUMOO to accept or decline it within 2 minutes.'],
        [30 * 1000, 'Open LOUMOO to accept or decline it within 30 seconds.'],   // sub-minute windows are said in seconds
        [10 * 1000, 'Open LOUMOO to accept or decline it within 10 seconds.'],
        [1000, 'Open LOUMOO to accept or decline it within 1 second.'],
        [0, 'Open LOUMOO to accept or decline it.']
      ]) {
        const w = makeWorld({ offerTtlMs: ttl });
        await registerRiders(w);
        const before = notifications.length;
        await newDelivery(w, { assignTo: 'rider_1' });
        const sent = notifications.slice(before).filter((n) => n.userId === 'rider_1' && n.title === 'New delivery assigned');
        assert.strictEqual(sent.length, 1, 'exactly one offer notification');
        assert.strictEqual(sent[0].body, expected, `window ${ttl} ms`);
      }
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
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'OFFER_EXPIRED', 'the first rider cannot sneak back in, and is told why');
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

    // ------------------------------------------- the rider list and its workload
    {
      const w = makeWorld();
      await registerRiders(w, [['rider_1', 'Alain'], ['rider_2', 'Bruno'], ['rider_3', 'Chantal']]);
      const ids = async (caller, opts) => (await w.service.listDrivers(caller, opts)).map((d) => d.id);

      assert.deepStrictEqual(await ids(SELLER), ['rider_1', 'rider_2', 'rider_3'], 'with nobody busy the order is by name');
      assert.ok((await w.service.listDrivers(SELLER)).every((d) => d.openDeliveries === 0));

      // rider_1 carries two jobs (one offered, one accepted), rider_3 one that is on the road.
      const a = await newDelivery(w, { assignTo: 'rider_1' });
      const b = await newDelivery(w, { assignTo: 'rider_1' });
      await w.service.acceptDelivery(b.id, RIDER);
      const c = await newDelivery(w, { assignTo: 'rider_3' });
      await w.repo.updateWhere(c.id, {}, { status: 'picked_up' });
      const list = await w.service.listDrivers(SELLER);
      assert.deepStrictEqual(list.map((d) => [d.id, d.openDeliveries]), [['rider_2', 0], ['rider_3', 1], ['rider_1', 2]],
        'least busy first, and an offer counts as work from the moment it is made');
      assert.deepStrictEqual(Object.keys(list[0]).sort(), ['id', 'name', 'openDeliveries', 'phone'], 'no declined flag without a delivery id');

      // Only jobs that occupy a rider count.
      const d = await newDelivery(w, { assignTo: 'rider_2' });
      await w.repo.updateWhere(d.id, {}, { status: 'failed' });
      const e = await newDelivery(w, { assignTo: 'rider_2' });
      await w.repo.updateWhere(e.id, {}, { status: 'delivered' });
      const f = await newDelivery(w, { assignTo: 'rider_2' });
      await w.repo.updateWhere(f.id, {}, { status: 'cancelled' });
      assert.strictEqual((await w.service.listDrivers(SELLER)).find((r) => r.id === 'rider_2').openDeliveries, 0,
        'failed, delivered and cancelled jobs do not make a rider busy');

      // Handing a job back lowers the count at once.
      await w.service.declineDelivery(a.id, RIDER);
      assert.strictEqual((await w.service.listDrivers(SELLER)).find((r) => r.id === 'rider_1').openDeliveries, 1);

      // Who may ask.
      assert.strictEqual(await code(w.service.listDrivers(BUYER)), 'PERMISSION_DENIED', 'a customer cannot list riders');
      assert.strictEqual(await code(w.service.listDrivers(RIDER)), 'PERMISSION_DENIED', 'nor can a rider');
      assert.deepStrictEqual((await ids(ADMIN)).length, 3, 'an admin can');
    }
    {
      // Tie-breaks are by name, then id, whatever order the riders were registered in. The
      // exact collation of "Alain" vs "alain" depends on the runtime's ICU data, so what is
      // pinned is that the result does not depend on registration order, and the id fallback.
      const riders = [['rider_z', 'Alain'], ['rider_b', 'Zoe'], ['rider_a', 'Zoe'], ['rider_c', 'alain']];
      const orders = [];
      for (const registration of [riders, [...riders].reverse(), [riders[2], riders[0], riders[3], riders[1]]]) {
        const w = makeWorld();
        await registerRiders(w, registration);
        orders.push((await w.service.listDrivers(SELLER)).map((d) => d.id));
      }
      assert.deepStrictEqual(orders[1], orders[0], 'registration order does not change the ranking');
      assert.deepStrictEqual(orders[2], orders[0], 'nor does any other order');
      assert.deepStrictEqual(orders[0].slice(0, 2).sort(), ['rider_c', 'rider_z'], 'both Alains sort before Zoe');
      assert.deepStrictEqual(orders[0].slice(-2), ['rider_a', 'rider_b'], 'equal names fall back to the id');
    }
    {
      const w = makeWorld();
      await registerRiders(w);
      await w.service.registerDriver('rider_2', { name: 'Bruno', phone: '+237600000002', status: 'suspended' }, ADMIN);
      assert.deepStrictEqual((await w.service.listDrivers(SELLER)).map((d) => d.id), ['rider_1'], 'a suspended rider is not offered');
    }

    // ---------------------------------------- "who already handed this one back"
    {
      const w = makeWorld();
      await registerRiders(w, [['rider_1', 'Alain'], ['rider_2', 'Bruno'], ['rider_3', 'Chantal'], ['rider_4', 'Dora']]);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      const flags = async (caller = SELLER) => Object.fromEntries((await w.service.listDrivers(caller, { deliveryId: id })).map((r) => [r.id, r.declined]));

      assert.deepStrictEqual(await flags(), { rider_1: false, rider_2: false, rider_3: false, rider_4: false }, 'nobody has handed it back yet');

      await w.service.declineDelivery(id, RIDER);
      assert.strictEqual((await flags()).rider_1, true, 'a decline is remembered');

      await w.service.assignDriver(id, 'rider_2', SELLER);
      await w.service.acceptDelivery(id, RIDER2);
      await w.service.declineDelivery(id, RIDER2); // releasing an accepted job
      assert.strictEqual((await flags()).rider_2, true, 'releasing an accepted job is remembered');

      await w.service.assignDriver(id, 'rider_3', SELLER);
      w.clock.advance(OFFER_TTL_MS + MIN);
      await w.service.expireStaleOffers();
      assert.strictEqual((await flags()).rider_3, true, 'an offer left to lapse is remembered');

      await w.service.assignDriver(id, 'rider_4', SELLER);
      await w.service.assignDriver(id, 'rider_1', SELLER); // the seller takes the offer from rider_4
      assert.strictEqual((await flags()).rider_4, false, 'a rider the seller replaced did not turn it down');

      assert.deepStrictEqual(await flags(ADMIN), await flags(), 'an admin sees the same flags');
      assert.strictEqual(await code(w.service.listDrivers(OTHER_SELLER, { deliveryId: id })), 'NOT_FOUND', "another seller cannot read this delivery's history");
      assert.strictEqual(await code(w.service.listDrivers(SELLER, { deliveryId: 'dlv_missing' })), 'NOT_FOUND');
      assert.strictEqual(await code(w.service.listDrivers(BUYER, { deliveryId: id })), 'PERMISSION_DENIED', 'the buyer is stopped by the role check first');

      // Another delivery is a clean slate.
      const other = await newDelivery(w);
      const otherFlags = (await w.service.listDrivers(SELLER, { deliveryId: other.id })).map((r) => r.declined);
      assert.ok(otherFlags.every((f) => f === false), 'handing back one delivery says nothing about another');
    }

    // ---------------------------------------------------------------- auto-assign
    {
      const w = makeWorld();
      await registerRiders(w, [['rider_1', 'Alain'], ['rider_2', 'Bruno'], ['rider_3', 'Chantal']]);
      const heldBy = async (id) => (await w.repo.findById(id)).driverId;

      // Nobody busy: the tie goes to the name.
      const first = await newDelivery(w);
      const out = await w.service.autoAssignDriver(first.id, SELLER);
      assert.strictEqual(out.status, 'assigned');
      assert.strictEqual(out.driver.id, 'rider_1', 'with a tie the first name wins');
      assert.strictEqual(out.viewerRole, 'seller', 'the response is the seller view');
      assert.strictEqual(out.offerExpiresAt, new Date(w.clock.now() + OFFER_TTL_MS).toISOString(), 'and it starts the offer window');
      assert.strictEqual(out.timeline[out.timeline.length - 1].note, 'Auto-assigned to Alain', 'the timeline says it was automatic');
      assert.strictEqual(sentTo('rider_1', 'New delivery assigned').length >= 1, true, 'the chosen rider is notified');

      // Work spreads out: each pick makes that rider busier.
      const second = await newDelivery(w);
      await w.service.autoAssignDriver(second.id, SELLER);
      const third = await newDelivery(w);
      await w.service.autoAssignDriver(third.id, ADMIN);
      assert.deepStrictEqual([await heldBy(second.id), await heldBy(third.id)], ['rider_2', 'rider_3'], 'the next two go to the two idle riders');
      const fourth = await newDelivery(w);
      await w.service.autoAssignDriver(fourth.id, SELLER);
      assert.strictEqual(await heldBy(fourth.id), 'rider_1', 'then it starts over at the top of the tie');

      // Who may call it.
      const fresh = await newDelivery(w);
      assert.strictEqual(await code(w.service.autoAssignDriver(fresh.id, OTHER_SELLER)), 'NOT_FOUND', "another seller cannot touch someone else's delivery");
      assert.strictEqual(await code(w.service.autoAssignDriver(fresh.id, BUYER)), 'PERMISSION_DENIED', 'the buyer cannot');
      assert.strictEqual(await code(w.service.autoAssignDriver(fresh.id, RIDER)), 'NOT_FOUND', 'a rider with no stake in it gets a 404');
      assert.strictEqual(await code(w.service.autoAssignDriver('dlv_missing', SELLER)), 'NOT_FOUND');
      assert.strictEqual(await code(w.service.autoAssignDriver(fresh.id, { userRole: 'seller' })), 'PERMISSION_DENIED', 'no identity is refused');
      assert.strictEqual((await w.repo.findById(fresh.id)).status, 'pending_assignment', 'none of that changed it');
    }

    // --------------------------------- auto-assign: who it never picks, and why
    {
      const w = makeWorld();
      await registerRiders(w, [['rider_1', 'Alain'], ['rider_2', 'Bruno']]);
      // The buyer is also a registered rider (and the idlest): never their own parcel.
      await w.service.registerDriver('buyer_1', { name: 'Aaron', phone: '+237600000099' }, ADMIN);
      const own = await newDelivery(w);
      const picked = await w.service.autoAssignDriver(own.id, SELLER);
      assert.notStrictEqual(picked.driver.id, 'buyer_1', 'a rider who is the buyer is skipped');
      assert.strictEqual(picked.driver.id, 'rider_1');
    }
    {
      const w = makeWorld();
      await registerRiders(w, [['rider_1', 'Alain'], ['rider_2', 'Bruno']]);
      await w.service.registerDriver('rider_1', { name: 'Alain', phone: '+237600000001', status: 'suspended' }, ADMIN);
      const d = await newDelivery(w);
      assert.strictEqual((await w.service.autoAssignDriver(d.id, SELLER)).driver.id, 'rider_2', 'a suspended rider is never picked');
    }
    {
      // Declined, released and lapsed all keep a rider off the next pick, even when they are the idlest.
      const w = makeWorld();
      await registerRiders(w, [['rider_1', 'Alain'], ['rider_2', 'Bruno'], ['rider_3', 'Chantal'], ['rider_4', 'Dora']]);
      const { id } = await newDelivery(w);
      const pick = async () => (await w.service.autoAssignDriver(id, SELLER)).driver.id;

      assert.strictEqual(await pick(), 'rider_1');
      await w.service.declineDelivery(id, RIDER);
      assert.strictEqual(await pick(), 'rider_2', 'after a decline the next rider is offered it, not the same one again');

      await w.service.acceptDelivery(id, RIDER2);
      await w.service.declineDelivery(id, RIDER2);
      assert.strictEqual(await pick(), 'rider_3', 'after a release the same holds');

      w.clock.advance(OFFER_TTL_MS + MIN); // rider_3 sits on it
      assert.strictEqual(await pick(), 'rider_4', 'a lapsed offer is released first, and that rider is passed over');

      await w.service.declineDelivery(id, { userId: 'rider_4', userRole: 'customer' });
      assert.strictEqual(await code(w.service.autoAssignDriver(id, SELLER)), 'NO_RIDER_AVAILABLE', 'when everyone has passed there is nobody left');
      const stuck = await w.repo.findById(id);
      assert.strictEqual(stuck.status, 'pending_assignment', 'the delivery is left as it was');
      assert.strictEqual(stuck.driverId, null);
      // The seller can still choose by hand: a person may know something the rule does not.
      assert.strictEqual((await w.service.assignDriver(id, 'rider_1', SELLER)).driver.id, 'rider_1', 'manual assignment is never blocked by the history');
    }
    {
      const w = makeWorld();
      const d = await newDelivery(w);
      assert.strictEqual(await code(w.service.autoAssignDriver(d.id, SELLER)), 'NO_RIDER_AVAILABLE', 'no riders registered at all');
    }

    // ------------------------------------------ auto-assign when it is re-offering
    {
      const w = makeWorld();
      await registerRiders(w, [['rider_1', 'Alain'], ['rider_2', 'Bruno']]);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      // rider_1 holds the offer (and is the only one with work): re-offering must move it.
      w.clock.advance(5 * MIN);
      const moved = await w.service.autoAssignDriver(id, SELLER);
      assert.strictEqual(moved.driver.id, 'rider_2', 're-offering skips the rider who already holds the offer');
      assert.strictEqual(moved.offerExpiresAt, new Date(w.clock.now() + OFFER_TTL_MS).toISOString(), 'and restarts the window');

      // With nobody else eligible it refuses rather than pointlessly re-offering to the holder.
      const w2 = makeWorld();
      await registerRiders(w2, [['rider_1', 'Alain']]);
      const lone = await newDelivery(w2, { assignTo: 'rider_1' });
      const before = await w2.repo.findById(lone.id);
      assert.strictEqual(await code(w2.service.autoAssignDriver(lone.id, SELLER)), 'NO_RIDER_AVAILABLE');
      const after = await w2.repo.findById(lone.id);
      assert.strictEqual(after.assignedAt, before.assignedAt, 'the holder keeps their original deadline');
      assert.strictEqual(after.driverId, 'rider_1');
    }

    {
      // The offer lapses WHILE auto-assign is running (after it read the delivery, before it ranks):
      // the seller's re-offer must still go through, not fail with a spurious "changed by someone else".
      const w = makeWorld();
      await registerRiders(w, [['rider_1', 'Alain'], ['rider_2', 'Bruno']]);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS - 5); // 5 ms before the deadline
      const original = w.service._assertOrderNotCancelled.bind(w.service);
      w.service._assertOrderNotCancelled = async (d) => { w.clock.advance(10); return original(d); }; // time passes mid-call
      const moved = await w.service.autoAssignDriver(id, SELLER);
      assert.strictEqual(moved.status, 'assigned');
      assert.strictEqual(moved.driver.id, 'rider_2', 'the re-offer went through');
      assert.strictEqual(moved.offerExpiresAt, new Date(w.clock.now() + OFFER_TTL_MS).toISOString(), 'with a fresh window');
    }

    {
      // Authorisation comes before the platform-wide sweep. Releasing lapsed
      // offers is up to two hundred swaps, each with a timeline row and two
      // notifications, so a caller who may not touch this delivery must not be
      // able to set it going — least of all by naming an id that does not exist.
      // The bystander below is a dead offer nothing has read: only a sweep of
      // the whole platform would move it.
      const w = makeWorld();
      await registerRiders(w);
      const target = await newDelivery(w, { assignTo: 'rider_1' });
      const bystander = await newDelivery(w, { assignTo: 'rider_2' });
      w.clock.advance(OFFER_TTL_MS + MIN);

      for (const [what, id, caller, expected] of [
        ['an id that does not exist, from a customer who is nobody here', 'dlv_does_not_exist', { userId: 'nobody_1', userRole: 'customer' }, 'NOT_FOUND'],
        ['a delivery belonging to another seller', target.id, OTHER_SELLER, 'NOT_FOUND'],
        ['their own order, asked as the buyer', target.id, BUYER, 'PERMISSION_DENIED']
      ]) {
        assert.strictEqual(await code(w.service.autoAssignDriver(id, caller)), expected, `refused: ${what}`);
        assert.strictEqual((await w.repo.findById(bystander.id)).status, 'assigned',
          `and ${what} did not make the server sweep the platform`);
      }

      // The seller may, and then the sweep runs as before: the dead offer is
      // released first and the rider who went silent is not offered it again.
      const moved = await w.service.autoAssignDriver(target.id, SELLER);
      assert.strictEqual(moved.driver.id, 'rider_2', 'the seller still gets a re-offer after the release');
      assert.strictEqual((await w.repo.findById(bystander.id)).status, 'pending_assignment',
        'and an authorised call does sweep the bystander');
    }

    // ------------------------------------------ auto-assign: states it works from
    {
      const w = makeWorld();
      await registerRiders(w);
      for (const status of ['accepted', 'picked_up', 'arrived', 'delivered', 'cancelled']) {
        const d = await newDelivery(w);
        await w.repo.updateWhere(d.id, {}, { status, driverId: status === 'cancelled' ? null : 'rider_1' });
        assert.strictEqual(await code(w.service.autoAssignDriver(d.id, SELLER)), 'CONFLICT', `cannot auto-assign a delivery that is ${status}`);
        assert.strictEqual((await w.repo.findById(d.id)).status, status, `and ${status} is left alone`);
      }
      // A failed delivery is retried through the same path as assign: new code, fresh rider.
      const failed = await newDelivery(w, { assignTo: 'rider_1' });
      await w.repo.updateWhere(failed.id, {}, { status: 'failed' });
      const nonceBefore = (await w.repo.findById(failed.id)).handoverNonce;
      const retried = await w.service.autoAssignDriver(failed.id, SELLER);
      assert.strictEqual(retried.status, 'assigned');
      assert.strictEqual((await w.repo.findById(failed.id)).handoverNonce, nonceBefore + 1, 'a retry issues a new handover code');

      // An order cancelled meanwhile stops it.
      const cancelled = await newDelivery(w);
      const order = await w.orders.findOrderById(cancelled.order.id);
      await w.orders.updateFulfillmentStatusAtomic(order.id, 'processing', 'cancelled', { note: 'test', updatedBy: 'test' });
      assert.strictEqual(await code(w.service.autoAssignDriver(cancelled.id, SELLER)), 'CONFLICT', 'a cancelled order cannot be dispatched');
    }

    // ----------------- concurrent auto-assigns on DIFFERENT deliveries spread out, not pile up
    {
      const w = makeWorld();
      await registerRiders(w, [['rider_1', 'Alain'], ['rider_2', 'Bruno'], ['rider_3', 'Chantal'], ['rider_4', 'Dora']]);
      const deliveries = [];
      for (let i = 0; i < 4; i += 1) deliveries.push(await newDelivery(w));
      // A bulk "assign all": four calls at once. Unserialised, all four rank before any offer lands
      // (every rider at zero) and the name tie-break hands every delivery to rider_1.
      const results = await Promise.all(deliveries.map((d) => w.service.autoAssignDriver(d.id, SELLER)));
      assert.deepStrictEqual(results.map((r) => r.status), ['assigned', 'assigned', 'assigned', 'assigned']);
      assert.deepStrictEqual(results.map((r) => r.driver.id).sort(), ['rider_1', 'rider_2', 'rider_3', 'rider_4'],
        'each rider got exactly one: the picks saw each other');
      assert.ok((await w.service.listDrivers(SELLER)).every((r) => r.openDeliveries === 1), 'and every rider carries one job');

      // A failing call in the queue does not block the ones behind it.
      const first = await newDelivery(w);
      const second = await newDelivery(w);
      let failed = false;
      const apply = w.service._applyAssignment.bind(w.service);
      w.service._applyAssignment = async (...args) => {
        if (!failed) { failed = true; throw new Error('boom'); }
        return apply(...args);
      };
      const mixed = await Promise.all([code(w.service.autoAssignDriver(first.id, SELLER)), code(w.service.autoAssignDriver(second.id, SELLER))]);
      assert.deepStrictEqual(mixed, ['Error', 'OK'], 'a failure inside the queue is not a wedge: the next call still runs');
      assert.strictEqual((await w.repo.findById(first.id)).status, 'pending_assignment', 'and the failed one changed nothing');
    }

    // ------------------------------------------------ auto-assign under a race
    {
      const w = makeWorld();
      await registerRiders(w, [['rider_1', 'Alain'], ['rider_2', 'Bruno']]);
      const { id } = await newDelivery(w);
      const results = await Promise.all([
        code(w.service.autoAssignDriver(id, SELLER)),
        code(w.service.autoAssignDriver(id, SELLER)),
        code(w.service.autoAssignDriver(id, ADMIN))
      ]);
      // All three read the delivery as pending before any swap lands, so the compare-and-swap
      // is the only thing between them: exactly one wins and the other two get a clean 409.
      // (Without the swap all three would succeed and the rider would be notified three times.)
      assert.deepStrictEqual(results.slice().sort(), ['CONFLICT', 'CONFLICT', 'OK'], `one winner, two clean conflicts, got ${results.join(',')}`);
      const final = await w.repo.findById(id);
      assert.strictEqual(final.status, 'assigned');
      assert.ok(['rider_1', 'rider_2'].includes(final.driverId));
      const assignedEvents = (await w.repo.listEvents(id)).filter((e) => e.status === 'assigned');
      assert.strictEqual(assignedEvents.length, 1, 'one timeline row: the losers left none');
    }

    // ------------------------ a late accept is "too late" however the offer was released
    {
      // Released by the sweeper, with no read in between: still 409, not 404.
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS + 5000);
      assert.deepStrictEqual(await w.service.expireStaleOffers(), { expired: 1 });
      assert.strictEqual((await w.repo.findById(id)).driverId, null, 'it really was released before the rider tapped Accept');
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'OFFER_EXPIRED', 'so the rider is told it was too late');
    }
    {
      // The failed accept itself releases the offer. Checked in storage, with no service read in
      // between (a read would release it lazily and hide a missing release in accept).
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS);
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'OFFER_EXPIRED');
      const stored = await w.repo.findById(id);
      assert.strictEqual(stored.status, 'pending_assignment', 'released by the accept itself');
      assert.strictEqual(stored.driverId, null);
      assert.strictEqual(stored.assignedAt, null);
    }
    {
      // A decline or a release is not a lapse: afterwards the delivery is simply not theirs.
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      await w.service.declineDelivery(id, RIDER);
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'NOT_FOUND', 'after their own decline: not found');
      await w.service.assignDriver(id, 'rider_2', SELLER);
      await w.service.acceptDelivery(id, RIDER2);
      await w.service.declineDelivery(id, RIDER2); // releasing an accepted job
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER2)), 'NOT_FOUND', 'after releasing it: not found');
    }
    {
      // Only the rider it lapsed on is told "expired". Everyone else keeps the old answers.
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS + MIN);
      await w.service.expireStaleOffers();
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER2)), 'NOT_FOUND', 'a rider who was never offered it');
      assert.strictEqual(await code(w.service.acceptDelivery(id, { userId: 'stranger_1', userRole: 'customer' })), 'NOT_FOUND', 'a stranger');
      assert.strictEqual(await code(w.service.acceptDelivery(id, BUYER)), 'PERMISSION_DENIED', 'the buyer is a participant without the rider role');
      assert.strictEqual(await code(w.service.acceptDelivery('dlv_missing', RIDER)), 'NOT_FOUND', 'and an id that does not exist');
      // The latest hand-back is what counts: lapse, re-offer, decline, then a stale accept is a plain 404.
      await w.service.assignDriver(id, 'rider_1', SELLER);
      await w.service.declineDelivery(id, RIDER);
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'NOT_FOUND', 'their most recent hand-back was a decline');
      // And a fresh offer after a lapse is accepted normally.
      await w.service.assignDriver(id, 'rider_1', SELLER);
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'OK', 'a new offer to a rider whose last one lapsed works');
    }

    {
      // A seller delivering their own parcel, or an admin acting as a rider, is a participant who
      // is no longer the holder after the release: still "too late", not a bare 403.
      const w = makeWorld();
      await registerRiders(w);
      await w.service.registerDriver('seller_1', { name: 'Shop Owner', phone: '+237600000050' }, ADMIN);
      await w.service.registerDriver('admin_1', { name: 'Admin Rider', phone: '+237600000051' }, ADMIN);

      const own = await newDelivery(w, { assignTo: 'seller_1' });
      const adminJob = await newDelivery(w, { assignTo: 'admin_1' });
      w.clock.advance(OFFER_TTL_MS + 5000);
      assert.deepStrictEqual(await w.service.expireStaleOffers(), { expired: 2 });
      assert.strictEqual(await code(w.service.acceptDelivery(own.id, SELLER)), 'OFFER_EXPIRED', 'the seller who was offered their own parcel');
      assert.strictEqual(await code(w.service.acceptDelivery(adminJob.id, ADMIN)), 'OFFER_EXPIRED', 'the admin who was offered a delivery');

      // Only the lapse earns it. A seller never offered this delivery is still told it is not theirs...
      const other = await newDelivery(w, { assignTo: 'rider_1' });
      assert.strictEqual(await code(w.service.acceptDelivery(other.id, SELLER)), 'PERMISSION_DENIED', 'never offered: 403, as before');
      // ...and so is one whose latest hand-back was a decline, not a lapse.
      await w.service.assignDriver(own.id, 'seller_1', SELLER);
      await w.service.declineDelivery(own.id, SELLER);
      assert.strictEqual(await code(w.service.acceptDelivery(own.id, SELLER)), 'PERMISSION_DENIED', 'after their own decline: 403');
      // A fresh offer after a lapse is theirs and works.
      await w.service.assignDriver(own.id, 'seller_1', SELLER);
      assert.strictEqual(await code(w.service.acceptDelivery(own.id, SELLER)), 'OK', 'a new offer to the same seller can be accepted');
      // A rider who is suspended while HOLDING a fresh offer is refused for that reason, not told
      // "expired" because an earlier offer of theirs once lapsed. (Suspension normally releases their
      // offers; the rider record is changed directly here to reach the state.)
      const lapsed = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS + 5000);
      await w.service.expireStaleOffers();
      await w.service.assignDriver(lapsed.id, 'rider_1', SELLER); // a fresh offer to the rider whose last one lapsed
      await w.repo.upsertDriver({ profileId: 'rider_1', name: 'Alain', phone: '+237600000001', status: 'suspended' });
      assert.strictEqual(await code(w.service.acceptDelivery(lapsed.id, RIDER)), 'PERMISSION_DENIED',
        'a suspended holder is told their account is not active, not that the offer expired');
      // The buyer, a participant without the role, is never told "expired".
      assert.strictEqual(await code(w.service.acceptDelivery(adminJob.id, BUYER)), 'PERMISSION_DENIED', 'the buyer gets the plain refusal');
    }

    // ------------------------------- a rider who never answers does not win every offer
    {
      const w = makeWorld();
      await registerRiders(w, [['rider_1', 'Alain'], ['rider_2', 'Bruno']]);
      const first = await newDelivery(w);
      assert.strictEqual((await w.service.autoAssignDriver(first.id, SELLER)).driver.id, 'rider_1', 'a tie goes to the first name');

      w.clock.advance(OFFER_TTL_MS + MIN); // Alain never answers
      const second = await newDelivery(w);
      assert.strictEqual((await w.service.autoAssignDriver(second.id, SELLER)).driver.id, 'rider_2',
        'the next delivery skips the rider who just let one lapse, even though their load is back to 0');
      await w.service.acceptDelivery(second.id, RIDER2);
      const third = await newDelivery(w);
      assert.strictEqual((await w.service.autoAssignDriver(third.id, SELLER)).driver.id, 'rider_2', 'and so does the one after, while they are the only responder');
      await w.service.acceptDelivery(third.id, RIDER2); // Bruno answers this one too, so he never lapses below
      assert.deepStrictEqual((await w.service.listDrivers(SELLER)).map((r) => [r.id, r.openDeliveries]), [['rider_2', 2], ['rider_1', 0]],
        'the list puts them last, but still shows the true count and still shows them');

      // It fades: still counted at exactly an hour after the lapse, gone one millisecond later.
      w.clock.advance(60 * MIN);
      assert.deepStrictEqual((await w.service.listDrivers(SELLER)).map((r) => r.id), ['rider_2', 'rider_1'], 'exactly an hour on, still last');
      w.clock.advance(1);
      assert.deepStrictEqual((await w.service.listDrivers(SELLER)).map((r) => r.id), ['rider_1', 'rider_2'], 'a millisecond later they rank by load again');

      // A seller can still pick them by hand: the rule steers, it does not ban.
      const fourth = await newDelivery(w);
      assert.strictEqual((await w.service.assignDriver(fourth.id, 'rider_1', SELLER)).driver.id, 'rider_1');
    }
    {
      // A decline means the rider is answering, so it does not push them down.
      const w = makeWorld();
      await registerRiders(w, [['rider_1', 'Alain'], ['rider_2', 'Bruno']]);
      const first = await newDelivery(w, { assignTo: 'rider_1' });
      await w.service.declineDelivery(first.id, RIDER);
      const second = await newDelivery(w);
      assert.strictEqual((await w.service.autoAssignDriver(second.id, SELLER)).driver.id, 'rider_1', 'a rider who declined is still first in line for a different delivery');
    }

    // --------------------- a dead offer is released before riders are ranked or listed
    {
      const w = makeWorld();
      await registerRiders(w, [['rider_z', 'Zed'], ['rider_b', 'Bruno']]);
      const dead = await newDelivery(w, { assignTo: 'rider_z' });
      const live = await newDelivery(w, { assignTo: 'rider_b' });
      await w.service.acceptDelivery(live.id, { userId: 'rider_b', userRole: 'customer' });
      w.clock.advance(20 * MIN); // nobody has read `dead`, and there is no sweeper
      assert.strictEqual((await w.repo.findById(dead.id)).status, 'assigned', 'still assigned in storage');
      const told = sentTo('seller_1', 'A rider did not respond').length;

      const list = await w.service.listDrivers(SELLER);
      assert.deepStrictEqual(list.map((r) => [r.id, r.openDeliveries]), [['rider_b', 1], ['rider_z', 0]],
        'listing riders does not count the dead offer as work');
      assert.strictEqual((await w.repo.findById(dead.id)).status, 'pending_assignment', 'and released it');
      assert.strictEqual(sentTo('seller_1', 'A rider did not respond').length - told, 1, 'so the seller is told even with no sweeper');
    }
    {
      // If releasing fails, ranking still works: the listing must not depend on it.
      const w = makeWorld();
      await registerRiders(w);
      w.service.expireStaleOffers = async () => { throw new Error('database is down'); };
      const originalWarn = logger.warn;
      const warned = [];
      logger.warn = (m) => warned.push(String(m));
      try {
        assert.deepStrictEqual((await w.service.listDrivers(SELLER)).map((r) => r.id), ['rider_1', 'rider_2'], 'the list still comes back');
        const d = await newDelivery(w);
        assert.strictEqual((await w.service.autoAssignDriver(d.id, SELLER)).status, 'assigned', 'and so does auto-assign');
      } finally {
        logger.warn = originalWarn;
      }
      assert.ok(warned.some((m) => /Could not release lapsed offers/.test(m) && /database is down/.test(m)), 'the failure is logged, not swallowed silently');
    }

    // ----------------------------------------- failure paths that were never exercised
    {
      // One bad row does not stop the sweep.
      const w = makeWorld();
      await registerRiders(w);
      const a = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(MIN);
      const b = await newDelivery(w, { assignTo: 'rider_2' });
      w.clock.advance(OFFER_TTL_MS + MIN);
      const original = w.service._expireOffer.bind(w.service);
      w.service._expireOffer = async (d) => { if (d.id === a.id) throw new Error('boom'); return original(d); };
      const originalError = logger.error;
      const errors = [];
      logger.error = (m) => errors.push(String(m));
      try {
        assert.deepStrictEqual(await w.service.expireStaleOffers(), { expired: 1 }, 'the second offer is still released');
      } finally {
        logger.error = originalError;
      }
      assert.strictEqual((await w.repo.findById(a.id)).status, 'assigned', 'the failing one is left for the next sweep');
      assert.strictEqual((await w.repo.findById(b.id)).status, 'pending_assignment');
      assert.ok(errors.some((m) => m.includes(a.id) && /boom/.test(m)), 'and the failure names the delivery');
    }
    {
      // A failing DATABASE (not a bad row) stops the sweep after one attempt instead of repeating the failure
      // for every remaining offer; the next tick retries.
      const { InfrastructureError } = require('../../server/shared/errors/AppError');
      const w = makeWorld();
      await registerRiders(w);
      for (let i = 0; i < 4; i += 1) await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS + MIN);
      let attempts = 0;
      w.service._expireOffer = async () => { attempts += 1; throw new InfrastructureError('Supabase', 'DeliveryRepository.updateWhere'); };
      const originalError = logger.error;
      const errors = [];
      logger.error = (m) => errors.push(String(m));
      try {
        assert.deepStrictEqual(await w.service.expireStaleOffers(), { expired: 0 });
      } finally {
        logger.error = originalError;
      }
      assert.strictEqual(attempts, 1, 'one attempt, not four');
      assert.ok(errors.some((m) => /database looks unhealthy/.test(m)), 'and it says why it stopped');
    }
    {
      // Ranking drains a backlog of lapsed offers in bounded rounds: more than one batch, but not unbounded.
      const w = makeWorld();
      await registerRiders(w);
      const ids = [];
      for (let i = 0; i < 210; i += 1) ids.push((await newDelivery(w, { assignTo: 'rider_1' })).id);
      w.clock.advance(OFFER_TTL_MS + MIN);
      const list = await w.service.listDrivers(SELLER);
      const stillAssigned = [];
      for (const id of ids) if ((await w.repo.findById(id)).status === 'assigned') stillAssigned.push(id);
      assert.strictEqual(stillAssigned.length, 10, '4 rounds of 50: 200 released in one call, the other 10 left for the next');
      assert.strictEqual(list.find((r) => r.id === 'rider_1').openDeliveries, 10, 'so the count is that of the remainder, not of all 210');
      await w.service.listDrivers(SELLER);
      assert.strictEqual((await w.repo.findById(stillAssigned[0])).status, 'pending_assignment', 'the next call finishes the rest');
    }
    {
      // A short round ends the draining: it does not keep querying for nothing.
      for (const [lapsed, expectedQueries] of [[0, 1], [3, 1], [50, 2], [60, 2], [120, 3]]) {
        const w = makeWorld();
        await registerRiders(w);
        for (let i = 0; i < lapsed; i += 1) await newDelivery(w, { assignTo: 'rider_1' });
        w.clock.advance(OFFER_TTL_MS + MIN);
        let queries = 0;
        const findStale = w.repo.findStaleOffers.bind(w.repo);
        w.repo.findStaleOffers = async (...args) => { queries += 1; return findStale(...args); };
        await w.service.listDrivers(SELLER);
        assert.strictEqual(queries, expectedQueries, `${lapsed} lapsed offers take ${expectedQueries} stale-offer queries, not more`);
      }
    }
    {
      // Losing the swap to a fresh re-offer returns the fresh delivery, not the stale snapshot.
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS + MIN);
      const stale = await w.repo.findById(id);
      await w.service.assignDriver(id, 'rider_1', SELLER); // a fresh offer to the same rider wins the race
      const seen = await w.service._releaseIfLapsed(stale);
      assert.strictEqual(seen.status, 'assigned');
      assert.notStrictEqual(seen.assignedAt, stale.assignedAt, 'it is the fresh offer, with the fresh deadline');
      assert.strictEqual((await w.repo.findById(id)).driverId, 'rider_1', 'and nothing was released');
    }
    {
      // Failing to release inside accept must not turn "too late" into a 500.
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS);
      w.service._expireOffer = async () => { throw new Error('database is down'); };
      const originalError = logger.error;
      const errors = [];
      logger.error = (m) => errors.push(String(m));
      try {
        assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'OFFER_EXPIRED', 'still a clean 409');
      } finally {
        logger.error = originalError;
      }
      assert.ok(errors.some((m) => /Could not release lapsed offer/.test(m)), 'with the failure logged');
    }
    {
      // A failing release must never turn a READ into an error: housekeeping is best effort.
      const w = makeWorld();
      await registerRiders(w);
      const { id, order } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS + MIN);
      w.service._expireOffer = async () => { throw new Error('write path is down'); };
      const originalWarn = logger.warn;
      const originalErr = logger.error;
      const warned = [];
      logger.warn = (m) => warned.push(String(m));
      logger.error = () => {}; // accept logs its own best-effort release failure
      try {
        const seen = await w.service.getDelivery(id, SELLER);
        assert.strictEqual(seen.status, 'assigned', 'the seller still gets the delivery, as it is');
        assert.ok(Date.parse(seen.offerExpiresAt) < w.clock.now(), 'with a deadline that has visibly passed');
        assert.strictEqual((await w.service.getDeliveryByOrder(order.id, BUYER)).status, 'assigned', 'by order too');
        assert.strictEqual(await w.service.getViewerRole(id, RIDER), 'driver', "the stream's access check does not throw either");
        assert.strictEqual((await w.service.getRiderOverview(RIDER)).deliveries.length, 1, "nor does the rider's job list");
        assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'OFFER_EXPIRED', 'and accept still refuses a lapsed offer');
      } finally {
        logger.warn = originalWarn;
        logger.error = originalErr;
      }
      assert.ok(warned.some((m) => /Could not release lapsed offer/.test(m) && /write path is down/.test(m)), 'the failure is logged');
    }
    {
      // The lapse row is retried once, because three decisions read it. One transient failure: nothing is lost.
      const w = makeWorld();
      await registerRiders(w, [['rider_1', 'Alain'], ['rider_2', 'Bruno']]);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      w.clock.advance(OFFER_TTL_MS + MIN);
      const insert = w.repo.insertEvent.bind(w.repo);
      let calls = 0;
      w.repo.insertEvent = async (e) => { calls += 1; if (calls === 1) throw new Error('blip'); return insert(e); };
      const originalError = logger.error;
      const errors = [];
      logger.error = (m) => errors.push(String(m));
      try {
        assert.deepStrictEqual(await w.service.expireStaleOffers(), { expired: 1 });
      } finally {
        logger.error = originalError;
      }
      assert.strictEqual(calls, 2, 'tried twice');
      assert.strictEqual(errors.length, 0, 'and a recovered write is not reported as a failure');
      assert.strictEqual(await code(w.service.acceptDelivery(id, RIDER)), 'OFFER_EXPIRED', 'so the late accept still knows it lapsed');
      assert.strictEqual((await w.service.listDrivers(SELLER, { deliveryId: id })).find((r) => r.id === 'rider_1').declined, true, 'and the history is intact');
    }
    {
      // Two failures in a row: the swap still stands, the loss is logged, and the event is still published.
      const w = makeWorld();
      await registerRiders(w);
      const { id } = await newDelivery(w, { assignTo: 'rider_1' });
      const heard = [];
      w.events.subscribe(id, (e) => heard.push(e));
      w.clock.advance(OFFER_TTL_MS + MIN);
      let calls = 0;
      w.repo.insertEvent = async () => { calls += 1; throw new Error('still down'); };
      const originalError = logger.error;
      const errors = [];
      logger.error = (m) => errors.push(String(m));
      try {
        assert.deepStrictEqual(await w.service.expireStaleOffers(), { expired: 1 }, 'a lost timeline row does not undo the release');
      } finally {
        logger.error = originalError;
      }
      assert.strictEqual(calls, 2, 'one retry, not a loop');
      assert.ok(errors.some((m) => /Timeline write failed/.test(m) && /still down/.test(m)), 'the loss is logged');
      assert.strictEqual((await w.repo.findById(id)).status, 'pending_assignment');
      assert.ok(heard.some((e) => e.type === 'status' && e.status === 'pending_assignment'), 'and the live event still went out');
    }
    {
      // The rider cap is applied, and says so.
      const w = makeWorld();
      for (let i = 0; i < 510; i += 1) {
        await w.service.registerDriver(`rider_${String(i).padStart(4, '0')}`, { name: `Rider ${String(i).padStart(4, '0')}`, phone: '+237600000000' }, ADMIN);
      }
      const originalWarn = logger.warn;
      const warned = [];
      logger.warn = (m) => warned.push(String(m));
      try {
        assert.strictEqual((await w.service.listDrivers(SELLER)).length, 500, 'at most 500 riders are considered');
      } finally {
        logger.warn = originalWarn;
      }
      assert.ok(warned.some((m) => /500-row cap/.test(m)), 'and reaching the cap is logged');
    }

    // ------------- the production default and the environment variable that sets it
    {
      const KEY = 'DELIVERY_OFFER_TTL_MINUTES';
      const saved = process.env[KEY];
      const deps = () => ({ repository: new DeliveryRepository({ db: null }), orderRepository: new OrderRepository({ db: null }) });
      const ttl = (extra = {}) => new DeliveryService({ ...deps(), ...extra }).offerTtlMs;
      try {
        delete process.env[KEY];
        assert.strictEqual(ttl(), 15 * MIN, 'with nothing configured the window is 15 minutes');
        for (const [value, expected] of [
          ['30', 30 * MIN], ['0', 0], ['  ', 15 * MIN], ['', 15 * MIN], ['abc', 15 * MIN], ['-5', 15 * MIN],
          ['0.5', 30 * 1000], ['1e12', 7 * 24 * 60 * MIN], ['0.00000001', 1000]
        ]) {
          process.env[KEY] = value;
          assert.strictEqual(ttl(), expected, `${KEY}=${JSON.stringify(value)}`);
        }
        process.env[KEY] = '30';
        assert.strictEqual(ttl({ offerTtlMs: 0 }), 0, 'an explicit option beats the environment (0 = off)');
        assert.strictEqual(ttl({ offerTtlMs: 2 * MIN }), 2 * MIN, 'whatever it is');
        assert.strictEqual(ttl({ offerTtlMs: null }), 30 * MIN, 'a non-number option is ignored, so the environment applies');
        assert.strictEqual(ttl({ offerTtlMs: NaN }), 15 * MIN, 'a NaN option falls back to the default, never to "off"');
        assert.strictEqual(ttl({ offerTtlMs: -1 }), 15 * MIN, 'as does a negative one');
      } finally {
        if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved;
      }
    }

    console.log('    ✓ Delivery dispatch: offer window, lazy and swept expiry hold.');
  } finally {
    NotificationService.create = originalCreate;
    if (!hadSecret) config.supabase.jwtSecret = hadSecret;
  }
}

module.exports = { run };
