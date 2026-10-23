/**
 * LOUMOO Unit Tests — Checkout holds the stock it sells
 * ---------------------------------------------------------------------------
 * Until this change the order path only ever READ stock: `checkInventory` asked
 * whether enough was on the shelf and nothing ever took it off. Two buyers
 * racing for the last unit both saw it free and both orders were accepted, and
 * no order — delivered or cancelled — ever moved `on_hand` or `reserved`. A
 * seller's stock figure therefore never changed, whatever they sold.
 *
 * What must hold now:
 *
 *   1. Placing an order holds its units (`reserved` goes up by the quantity).
 *   2. The second buyer for the last unit is refused, not oversold.
 *   3. An order that fails AFTER the hold (an unsaveable bag, a refused line)
 *      puts every unit it had taken back.
 *   4. Delivering the order consumes the hold: `on_hand` and `reserved` both
 *      fall, in one write, so they cannot disagree.
 *   5. Cancelling the order releases the hold: `reserved` falls, `on_hand` does not.
 *   6. Untracked stock and backorder-friendly listings hold nothing and are
 *      never refused.
 *   7. The hold is a compare-and-swap: a writer whose read went stale loses and
 *      retries against the new figure rather than clobbering it.
 */

require('../setup');
const assert = require('assert');

const { OrderRepository } = require('../../server/modules/commerce/infrastructure/OrderRepository');
const { OrderCreationService } = require('../../server/modules/commerce/application/OrderCreationService');
const { OrderLifecycleService } = require('../../server/modules/commerce/application/OrderLifecycleService');
const { FULFILLMENT_STATUS } = require('../../server/modules/commerce/domain/Order');
const NotificationService = require('../../server/modules/identity/application/NotificationService');

const LISTING_ID = 'lst_stock_1';
const SELLER_ID = 'seller_stock_1';
const BUYER_ID = 'buyer_stock_1';

const LISTING = {
  id: LISTING_ID,
  storeId: 'store_stock_1',
  sellerId: SELLER_ID,
  title: 'Last One In Stock',
  status: 'PUBLISHED',
  visibility: 'PUBLIC',
  currency: 'XAF',
  basePriceMinor: 50000,
  salePriceMinor: null,
  storeName: 'Amina Electronics',
  storeStatus: 'ACTIVE',
  storePhone: '+237690112233',
  deletedAt: null
};

const SHIPPING = { fullName: 'Awa Njoya', phone: '+237622222222', street: 'Rue 1', city: 'Douala' };

/** A repository whose listing and stock live in memory — no database, no network. */
function repoWithStock(inventory) {
  const repo = new OrderRepository({ db: null });
  repo.seedListing(LISTING);
  repo.seedInventory(LISTING_ID, null, { onHand: 0, reserved: 0, trackInventory: true, allowBackorder: false, ...inventory });
  return repo;
}

function stockOf(repo) {
  return repo._inMemoryInventory.get(`${LISTING_ID}:null`);
}

/** A creation service that talks to nobody: no delivery module, no locks, no messages. */
function creationService(repo) {
  return new OrderCreationService(repo, {
    resolveProvider: async () => null,
    houseStore: { resolve: async () => null, resolveDefaultProvider: async () => null },
    lockService: { acquireLock: async () => 'token', releaseLock: async () => true },
    // Each test gets its own registry so an earlier buyer never blocks a later one.
    activeLocks: new Set(),
    notificationService: { create: async () => null },
    recipients: { buyerContact: async () => null, sellerEmail: async () => null },
    sendEmail: async () => ({ sent: true }),
    getNotificationPreferences: async () => ({ channels: { email: false } })
  });
}

function placeOrder(service, { quantity = 1, buyerId = BUYER_ID } = {}) {
  return service.createOrder(buyerId, {
    items: [{ listingId: LISTING_ID, quantity }],
    shippingAddress: SHIPPING,
    deliveryMethod: 'HOME_DELIVERY'
  });
}

function silenceNotifications() {
  const original = NotificationService.create;
  NotificationService.create = async () => null;
  return () => { NotificationService.create = original; };
}

async function testOrderHoldsItsUnits() {
  const repo = repoWithStock({ onHand: 5 });
  const order = await placeOrder(creationService(repo), { quantity: 2 });

  assert.ok(order.id, 'the order was placed');
  const stock = stockOf(repo);
  assert.strictEqual(stock.reserved, 2, 'the two units it sold are held');
  assert.strictEqual(stock.onHand, 5, 'and none has left the shelf yet — nothing is delivered');
}

async function testSecondBuyerForTheLastUnitIsRefused() {
  const repo = repoWithStock({ onHand: 1 });
  const service = creationService(repo);

  await placeOrder(service, { quantity: 1, buyerId: 'buyer_first' });
  assert.strictEqual(stockOf(repo).reserved, 1, 'the first buyer holds the only unit');

  let error = null;
  try {
    await placeOrder(service, { quantity: 1, buyerId: 'buyer_second' });
  } catch (err) { error = err; }

  assert.ok(error, 'the second buyer is refused rather than oversold');
  assert.strictEqual(error.statusCode, 409, 'as a conflict');
  assert.ok(/Insufficient stock/i.test(error.message), `the refusal says why: ${error.message}`);
  assert.ok(/Only 0 unit/.test(error.message), 'and names what is actually left');
  assert.strictEqual(stockOf(repo).reserved, 1, 'the refused order held nothing of its own');
}

async function testAFailedOrderPutsEveryUnitBack() {
  const repo = repoWithStock({ onHand: 4 });
  // The bag's second line does not exist, so the order is refused AFTER the
  // first line was already held. Nothing may stay held.
  repo.saveOrder = async () => { throw new Error('database refused the insert'); };

  let error = null;
  try {
    await placeOrder(creationService(repo), { quantity: 3 });
  } catch (err) { error = err; }

  assert.ok(error, 'the order failed');
  assert.strictEqual(stockOf(repo).reserved, 0, 'and the three units it had taken went back on the shelf');
  assert.strictEqual(stockOf(repo).onHand, 4, 'with the shelf itself untouched');
}

async function testRefusedLineReleasesTheLinesBeforeIt() {
  const repo = repoWithStock({ onHand: 10 });
  // A second listing with one unit left; the bag asks for two of it.
  const SECOND = 'lst_stock_2';
  repo.seedListing({ ...LISTING, id: SECOND, title: 'Nearly Gone' });
  repo.seedInventory(SECOND, null, { onHand: 1, reserved: 0, trackInventory: true, allowBackorder: false });

  let error = null;
  try {
    await creationService(repo).createOrder(BUYER_ID, {
      items: [
        { listingId: LISTING_ID, quantity: 2 },
        { listingId: SECOND, quantity: 2 }
      ],
      shippingAddress: SHIPPING,
      deliveryMethod: 'HOME_DELIVERY'
    });
  } catch (err) { error = err; }

  assert.ok(error, 'the bag is refused');
  assert.ok(/Nearly Gone/.test(error.message), 'naming the line that could not be held');
  assert.strictEqual(stockOf(repo).reserved, 0, 'the first line, already held, was given back');
  assert.strictEqual(repo._inMemoryInventory.get(`${SECOND}:null`).reserved, 0, 'and the refused line holds nothing');
}

async function testDeliveryConsumesTheHold() {
  const restore = silenceNotifications();
  try {
    const repo = repoWithStock({ onHand: 5 });
    const order = await placeOrder(creationService(repo), { quantity: 2 });

    // The delivery module moves the order along its own path; the stock settles
    // wherever the status does, which is why the hook lives in the repository.
    await repo.updateFulfillmentStatusAtomic(order.id, FULFILLMENT_STATUS.PROCESSING, FULFILLMENT_STATUS.IN_TRANSIT, { updatedBy: 'rider' });
    assert.strictEqual(stockOf(repo).reserved, 2, 'a parcel in transit is still only held');
    assert.strictEqual(stockOf(repo).onHand, 5);

    await repo.updateFulfillmentStatusAtomic(order.id, FULFILLMENT_STATUS.IN_TRANSIT, FULFILLMENT_STATUS.DELIVERED, { updatedBy: 'rider' });
    const stock = stockOf(repo);
    assert.strictEqual(stock.onHand, 3, 'delivering it takes the units off the shelf');
    assert.strictEqual(stock.reserved, 0, 'and drops the hold in the same move, so the two cannot disagree');
  } finally {
    restore();
  }
}

async function testCancellationReleasesTheHold() {
  const restore = silenceNotifications();
  try {
    const repo = repoWithStock({ onHand: 5 });
    const order = await placeOrder(creationService(repo), { quantity: 2 });
    assert.strictEqual(stockOf(repo).reserved, 2);

    await new OrderLifecycleService(repo).cancelOrder(order.id, BUYER_ID, 'Changed my mind');

    const stock = stockOf(repo);
    assert.strictEqual(stock.reserved, 0, 'a cancelled order gives its units back');
    assert.strictEqual(stock.onHand, 5, 'and nothing was ever sold');
  } finally {
    restore();
  }
}

async function testUntrackedAndBackorderStockHoldNothing() {
  const untracked = repoWithStock({ onHand: 0, trackInventory: false });
  await placeOrder(creationService(untracked), { quantity: 9 });
  assert.strictEqual(stockOf(untracked).reserved, 0, 'a listing that does not track stock holds nothing');

  const backorder = repoWithStock({ onHand: 0, allowBackorder: true });
  const order = await placeOrder(creationService(backorder), { quantity: 9 });
  assert.ok(order.id, 'a backorder-friendly listing is never refused for being empty');
  assert.strictEqual(stockOf(backorder).reserved, 9, 'though it still records what it owes');
}

/**
 * The database half of the hold. The fake row behaves like Postgres under the
 * compare-and-swap: an UPDATE ... WHERE reserved = <what I read> matches nothing
 * once somebody else has moved it.
 */
function casDb(row) {
  const state = { ...row };
  let onBeforeUpdate = null;
  const db = {
    state,
    interceptOnce(fn) { onBeforeUpdate = fn; },
    from(table) {
      assert.strictEqual(table, 'listing_inventory', 'only the stock table is touched');
      const filters = {};
      let patch = null;
      const q = {
        select() { return q; },
        eq(col, val) { filters[col] = val; return q; },
        is() { return q; },
        update(payload) { patch = payload; return q; },
        async maybeSingle() {
          if (!patch) return { data: { ...state }, error: null };
          if (onBeforeUpdate) { const fn = onBeforeUpdate; onBeforeUpdate = null; fn(state); }
          // The WHERE clause, as Postgres would apply it.
          const matches = Object.entries(filters).every(([col, val]) => state[col] === val);
          if (!matches) return { data: null, error: null };
          Object.assign(state, patch);
          return { data: { id: state.id }, error: null };
        }
      };
      return q;
    }
  };
  return db;
}

async function testTheHoldIsACompareAndSwap() {
  const db = casDb({ id: 'inv_1', on_hand: 10, reserved: 0, track_inventory: true, allow_backorder: false });
  const repo = new OrderRepository({ db });

  const first = await repo.reserveInventory(LISTING_ID, null, 3);
  assert.strictEqual(first.reserved, true, 'an uncontended hold lands');
  assert.strictEqual(db.state.reserved, 3);

  // Somebody else takes four units between this caller's read and its write. The
  // swap must miss, and the retry must hold against the NEW figure (3 + 4 = 7),
  // never write the 3 + 2 = 5 it first computed.
  db.interceptOnce((state) => { state.reserved = 7; });
  const second = await repo.reserveInventory(LISTING_ID, null, 2);
  assert.strictEqual(second.reserved, true, 'the loser of the race retries and succeeds');
  assert.strictEqual(db.state.reserved, 9, 'against the figure it found on the retry, not the stale one');

  // Nothing is left: the next buyer is refused rather than pushed past on_hand.
  const third = await repo.reserveInventory(LISTING_ID, null, 2);
  assert.strictEqual(third.reserved, false, 'the hold stops at what is on the shelf');
  assert.strictEqual(third.availableQuantity, 1);
  assert.strictEqual(db.state.reserved, 9, 'and a refused hold writes nothing');
}

async function testConsumeNeverLetsTheTwoFiguresDisagree() {
  const db = casDb({ id: 'inv_1', on_hand: 10, reserved: 4, track_inventory: true, allow_backorder: false });
  const repo = new OrderRepository({ db });

  await repo.consumeInventory(LISTING_ID, null, 4);
  assert.strictEqual(db.state.on_hand, 6, 'the units leave the shelf');
  assert.strictEqual(db.state.reserved, 0, 'and the hold goes with them, in one write');

  // A release can never drive the hold below zero.
  await repo.releaseInventory(LISTING_ID, null, 5);
  assert.strictEqual(db.state.reserved, 0, 'releasing more than is held floors at zero');
}

async function run() {
  const tests = [
    ['an order holds the units it sells', testOrderHoldsItsUnits],
    ['the second buyer for the last unit is refused', testSecondBuyerForTheLastUnitIsRefused],
    ['a failed order puts every unit back', testAFailedOrderPutsEveryUnitBack],
    ['a refused line releases the lines before it', testRefusedLineReleasesTheLinesBeforeIt],
    ['delivery consumes the hold', testDeliveryConsumesTheHold],
    ['cancellation releases the hold', testCancellationReleasesTheHold],
    ['untracked and backorder stock hold nothing', testUntrackedAndBackorderStockHoldNothing],
    ['the hold is a compare-and-swap', testTheHoldIsACompareAndSwap],
    ['consume never lets the two figures disagree', testConsumeNeverLetsTheTwoFiguresDisagree]
  ];

  let failures = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failures += 1;
      console.error(`  ✗ ${name}\n    ${err && err.stack ? err.stack : err}`);
    }
  }

  console.log(`\nInventory reservation: ${tests.length - failures}/${tests.length} passed.`);
  if (failures) process.exitCode = 1;
}

run();
