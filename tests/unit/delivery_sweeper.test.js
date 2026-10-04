/**
 * LOUMOO — Delivery offer sweeper
 * ---------------------------------------------------------------------------
 * The background timer that returns unanswered rider offers to their sellers:
 * what it calls, that ticks never overlap, that a failing sweep cannot escape
 * the timer, that it never keeps the process alive, and that it does not even
 * schedule when expiry is off. Timers are injected, so nothing here waits.
 * Pairs with the end-to-end expiry cases in delivery_dispatch.test.js.
 */

require('../setup');

const assert = require('assert');
const logger = require('../../server/shared/logging/logger');
const { startOfferSweeper, DEFAULT_INTERVAL_MS, DEFAULT_BATCH } = require('../../server/modules/delivery/infrastructure/OfferSweeper');
const { DeliveryService } = require('../../server/modules/delivery/application/DeliveryService');
const { DeliveryRepository } = require('../../server/modules/delivery/infrastructure/DeliveryRepository');
const { DeliveryEvents } = require('../../server/modules/delivery/infrastructure/DeliveryEvents');
const { OrderRepository } = require('../../server/modules/commerce/infrastructure/OrderRepository');
const { Order, FULFILLMENT_STATUS, DELIVERY_METHOD, PAYMENT_STATUS } = require('../../server/modules/commerce/domain/Order');

/** A fake timer API recording what the sweeper schedules. */
function fakeTimers() {
  const t = { scheduled: [], cleared: [], unrefCalled: false };
  t.setIntervalFn = (fn, ms) => {
    const handle = { fn, ms, unref() { t.unrefCalled = true; } };
    t.scheduled.push(handle);
    return handle;
  };
  t.clearIntervalFn = (h) => t.cleared.push(h);
  return t;
}

const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

async function run() {
  console.log('  Testing Delivery offer sweeper...');

  const logs = { info: [], error: [] };
  const originalInfo = logger.info;
  const originalError = logger.error;
  logger.info = (m) => logs.info.push(String(m));
  logger.error = (m) => logs.error.push(String(m));

  try {
    // ------------------------------------------------------------- construction
    assert.throws(() => startOfferSweeper({}), TypeError, 'a service is required');
    assert.throws(() => startOfferSweeper({ service: {} }), TypeError, 'and it must be able to sweep');
    assert.throws(() => startOfferSweeper({ service: { expireStaleOffers() {}, offerTtlMs: 1 }, intervalMs: 10 }), RangeError, 'a busy-loop interval is refused');
    assert.throws(() => startOfferSweeper({ service: { expireStaleOffers() {}, offerTtlMs: 1 }, intervalMs: NaN }), RangeError);
    assert.strictEqual(DEFAULT_INTERVAL_MS, 60000, 'it sweeps once a minute');

    // ------------------------------------------------------------- scheduling
    {
      const timers = fakeTimers();
      const calls = [];
      const service = { offerTtlMs: 900000, expireStaleOffers: async (opts) => { calls.push(opts); return { expired: 0 }; } };
      const sweeper = startOfferSweeper({ service, ...timers });
      assert.strictEqual(timers.scheduled.length, 1, 'one timer');
      assert.strictEqual(timers.scheduled[0].ms, DEFAULT_INTERVAL_MS);
      assert.strictEqual(timers.unrefCalled, true, 'the timer never keeps the process alive');
      assert.strictEqual(sweeper.timer, timers.scheduled[0]);

      await timers.scheduled[0].fn();
      assert.deepStrictEqual(calls, [{ limit: DEFAULT_BATCH }], 'a tick runs one bounded sweep');
      await sweeper.tick();
      assert.strictEqual(calls.length, 2, 'tick() is the same sweep, callable directly');

      sweeper.stop();
      assert.deepStrictEqual(timers.cleared, [timers.scheduled[0]], 'stop() clears exactly that timer');
    }
    {
      const timers = fakeTimers();
      const calls = [];
      const service = { offerTtlMs: 900000, expireStaleOffers: async (opts) => { calls.push(opts); return { expired: 0 }; } };
      startOfferSweeper({ service, intervalMs: 5000, limit: 7, ...timers });
      assert.strictEqual(timers.scheduled[0].ms, 5000, 'the interval is configurable');
      await timers.scheduled[0].fn();
      assert.deepStrictEqual(calls, [{ limit: 7 }], 'and so is the batch size');
    }

    // ----------------------------------------------------------- expiry switched off
    {
      for (const offerTtlMs of [0, undefined, -1, NaN]) {
        const timers = fakeTimers();
        const sweeper = startOfferSweeper({ service: { offerTtlMs, expireStaleOffers: async () => ({ expired: 0 }) }, ...timers });
        assert.strictEqual(timers.scheduled.length, 0, `no timer when the window is ${offerTtlMs}`);
        assert.strictEqual(sweeper.timer, null);
        assert.doesNotThrow(() => sweeper.stop(), 'stop() is still safe');
      }
      assert.ok(logs.info.some((m) => /offer expiry is off/.test(m)), 'it says so, rather than going quiet');
    }

    // ---------------------------------------------------------------- no overlap
    {
      const timers = fakeTimers();
      const gate = deferred();
      let started = 0;
      const service = { offerTtlMs: 900000, expireStaleOffers: async () => { started += 1; await gate.promise; return { expired: 2 }; } };
      const sweeper = startOfferSweeper({ service, ...timers });

      // Not awaited one by one: without the guard these would all be inside the
      // service at once (and a naive `await` would just hang the suite).
      const first = sweeper.tick();
      const second = sweeper.tick(); // lands while the first is still running
      const third = sweeper.tick();
      assert.strictEqual(started, 1, 'a tick during a running sweep does nothing');
      gate.resolve();
      assert.deepStrictEqual(await first, { expired: 2 });
      assert.deepStrictEqual(await second, { expired: 0, skipped: true });
      assert.deepStrictEqual(await third, { expired: 0, skipped: true });
      await sweeper.tick();
      assert.strictEqual(started, 2, 'once it finishes the next tick sweeps again');
    }

    // ------------------------------------------------------------ failures contained
    {
      const timers = fakeTimers();
      let n = 0;
      const service = {
        offerTtlMs: 900000,
        expireStaleOffers: async () => { n += 1; if (n === 1) throw new Error('database is down'); return { expired: 1 }; }
      };
      const sweeper = startOfferSweeper({ service, ...timers });
      const before = logs.error.length;
      const failed = await timers.scheduled[0].fn(); // must resolve, not reject: a timer has nobody to catch it
      assert.deepStrictEqual(failed, { expired: 0, failed: true });
      assert.ok(logs.error.slice(before).some((m) => /database is down/.test(m)), 'the failure is logged with its reason');
      assert.deepStrictEqual(await sweeper.tick(), { expired: 1 }, 'and the next sweep still runs: a failure does not wedge the lock');
    }

    // --------------------------------------------------------------------- logging
    {
      const timers = fakeTimers();
      const service = { offerTtlMs: 900000, expireStaleOffers: async () => ({ expired: 3 }) };
      const sweeper = startOfferSweeper({ service, ...timers });
      const before = logs.info.length;
      await sweeper.tick();
      assert.ok(logs.info.slice(before).some((m) => /returned 3 lapsed offer/.test(m)), 'a sweep that released offers says how many');
      const quiet = { offerTtlMs: 900000, expireStaleOffers: async () => ({ expired: 0 }) };
      const before2 = logs.info.length;
      await startOfferSweeper({ service: quiet, ...fakeTimers() }).tick();
      assert.strictEqual(logs.info.length, before2, 'an empty sweep logs nothing (it runs every minute)');
    }

    // --------------------------------------- against the real service, end to end
    {
      let now = Date.parse('2026-10-03T10:00:00.000Z');
      const orders = new OrderRepository({ db: null });
      const repo = new DeliveryRepository({ db: null });
      const service = new DeliveryService({
        repository: repo, orderRepository: orders, events: new DeliveryEvents(), now: () => now, offerTtlMs: 15 * 60 * 1000
      });
      const NotificationService = require('../../server/modules/identity/application/NotificationService');
      const originalCreate = NotificationService.create;
      NotificationService.create = async () => null;
      try {
        const ADMIN = { userId: 'admin_1', userRole: 'admin' };
        const SELLER = { userId: 'seller_1', userRole: 'seller' };
        await service.registerDriver('rider_1', { name: 'Alain', phone: '+237600000001' }, ADMIN);
        const order = await orders.saveOrder(new Order({
          buyerId: 'buyer_1',
          sellerId: 'seller_1',
          items: [{ listingId: 'lst_s', title: 'Phone', unitPriceXaf: 50000, quantity: 1, sellerId: 'seller_1', storeName: 'Tech Shop' }],
          shippingAddress: { fullName: 'Awa Njoya', phone: '+237622222222', street: 'Rue 1', city: 'Douala' },
          deliveryMethod: DELIVERY_METHOD.HOME_DELIVERY,
          paymentStatus: PAYMENT_STATUS.PAID,
          fulfillmentStatus: FULFILLMENT_STATUS.PROCESSING
        }));
        const created = await service.createDelivery(order.id, SELLER, {});
        await service.assignDriver(created.id, 'rider_1', SELLER);

        const timers = fakeTimers();
        const sweeper = startOfferSweeper({ service, ...timers });
        await sweeper.tick();
        assert.strictEqual((await repo.findById(created.id)).status, 'assigned', 'an open offer is left alone');
        now += 16 * 60 * 1000;
        const result = await sweeper.tick();
        assert.deepStrictEqual(result, { expired: 1 });
        assert.strictEqual((await repo.findById(created.id)).status, 'pending_assignment', 'a lapsed offer goes back to the seller');
        assert.deepStrictEqual(await sweeper.tick(), { expired: 0 }, 'and the next sweep finds nothing');
      } finally {
        NotificationService.create = originalCreate;
      }
    }

    console.log('    ✓ Delivery offer sweeper: scheduling, no overlap, contained failures and the real sweep hold.');
  } finally {
    logger.info = originalInfo;
    logger.error = originalError;
  }
}

module.exports = { run };
