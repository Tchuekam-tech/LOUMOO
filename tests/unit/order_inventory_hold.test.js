/**
 * LOUMOO — an order holds its stock until it ends
 * ---------------------------------------------------------------------------
 * Placing an order only CHECKED stock (on_hand - reserved) and never held it,
 * so a listing with one unit left could be sold to every buyer who asked, and
 * cancellation or delivery never moved the numbers either. Now:
 *   placing  -> reserved += q   (all lines or none; a short line is a 409)
 *   cancel   -> reserved -= q
 *   deliver  -> on_hand -= q, reserved -= q
 * and an untracked listing is never touched.
 *
 * Hermetic: the real OrderCreationService and OrderLifecycleService over an
 * in-memory OrderRepository.
 */

require('../setup');

const assert = require('assert');
const { OrderRepository } = require('../../server/modules/commerce/infrastructure/OrderRepository');
const { OrderCreationService } = require('../../server/modules/commerce/application/OrderCreationService');
const { OrderLifecycleService } = require('../../server/modules/commerce/application/OrderLifecycleService');

function listing(id, price = 10000) {
  return {
    id, title: `Item ${id}`, status: 'PUBLISHED', visibility: 'PUBLIC', deletedAt: null, storeStatus: 'ACTIVE',
    basePriceMinor: price, salePriceMinor: null, sku: null, sellerId: 'seller_1', storeId: 'store_1', storeName: 'Shop', storePhone: '+237611111111'
  };
}

const body = (lines) => ({
  items: lines.map(([listingId, quantity]) => ({ listingId, quantity })),
  deliveryMethod: 'STORE_PICKUP',
  shippingAddress: { fullName: 'Awa Buyer', phone: '+237690000000', city: 'Douala' }
});

async function refusedFor409(fn) {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert.ok(err, 'the order was accepted');
  assert.strictEqual(err.statusCode || err.status, 409, `a stock refusal is a 409: ${err.message}`);
  return err;
}

(async () => {
  const repo = new OrderRepository({ db: null });
  repo.seedListing(listing('last_one'));
  repo.seedListing(listing('plenty'));
  repo.seedListing(listing('untracked'));
  repo.seedInventory('last_one', null, { onHand: 1, reserved: 0, trackInventory: true });
  repo.seedInventory('plenty', null, { onHand: 5, reserved: 0, trackInventory: true });
  repo.seedInventory('untracked', null, { onHand: 0, reserved: 0, trackInventory: false });
  const inv = (id) => ({ ...repo._inMemoryInventory.get(`${id}:null`) });
  const creation = new OrderCreationService(repo);
  const lifecycle = new OrderLifecycleService(repo);

  // 1. The last unit is held by the first buyer; the second is refused.
  const first = await creation.createOrder('buyer_a', body([['last_one', 1]]));
  assert.deepStrictEqual([inv('last_one').onHand, inv('last_one').reserved], [1, 1], 'placing holds the unit');
  const err = await refusedFor409(() => creation.createOrder('buyer_b', body([['last_one', 1]])));
  assert.ok(/Only 0 unit/.test(err.message), err.message);

  // 2. All lines or none: a short line releases what the order had already held.
  await refusedFor409(() => creation.createOrder('buyer_c', body([['plenty', 2], ['last_one', 1]])));
  assert.strictEqual(inv('plenty').reserved, 0, 'the plentiful line was given back');

  // 3. Cancelling gives the unit back, so the next buyer can have it.
  await lifecycle.cancelOrder(first.id, 'buyer_a', 'Changed my mind');
  assert.deepStrictEqual([inv('last_one').onHand, inv('last_one').reserved], [1, 0], 'cancelling releases the hold');
  const second = await creation.createOrder('buyer_b', body([['last_one', 1], ['plenty', 2]]));
  assert.strictEqual(inv('plenty').reserved, 2);

  // 4. Handing it over consumes the stock (a pickup the seller marks delivered).
  await lifecycle.updateFulfillmentStatus(second.id, 'in_transit', 'seller_1', { userRole: 'seller', note: 'Ready' });
  assert.strictEqual(inv('last_one').reserved, 1, 'still held while on its way');
  await lifecycle.updateFulfillmentStatus(second.id, 'delivered', 'seller_1', { userRole: 'seller', note: 'Collected' });
  assert.deepStrictEqual([inv('last_one').onHand, inv('last_one').reserved], [0, 0], 'delivery consumes the unit');
  assert.deepStrictEqual([inv('plenty').onHand, inv('plenty').reserved], [3, 0]);

  // 5. An untracked listing is never refused and never moved.
  const third = await creation.createOrder('buyer_d', body([['untracked', 4]]));
  assert.deepStrictEqual(inv('untracked'), { onHand: 0, reserved: 0, trackInventory: false });
  assert.deepStrictEqual(OrderRepository.heldInventory(third), [], 'and the order holds nothing');

  console.log('order_inventory_hold: placing holds stock, cancelling releases it, delivering consumes it');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
