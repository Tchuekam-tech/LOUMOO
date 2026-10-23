/**
 * LOUMOO Unit Tests - nanoDelivery is the house store's default delivery provider
 * ---------------------------------------------------------------------------
 * When someone orders from NanoAfrica for home delivery and picks no delivery
 * provider, the order is filed with the store's own agency (nanoDelivery) as its
 * preferred provider, so the owner's dispatch board starts on "Offer to
 * nanoDelivery". It is a DEFAULT, not a choice, and it must change nothing the
 * buyer was shown:
 *
 *   1. It applies when: home delivery, no pick by the buyer, the order's seller is
 *      the house store's owner (as the database says), and nanoDelivery is active,
 *      serves the order's city and has no tariff of its own (it quotes the
 *      standard city rate). The fee is identical to the same order without it, the
 *      buyer gets no deliveryNotice, and the seller's message says the provider
 *      was defaulted, not chosen.
 *   2. It does NOT apply, and the order is otherwise unchanged, when: the buyer
 *      chose a provider (kept, even over the default; a dropped pick is not
 *      replaced either), the order is a pickup, the seller is anyone else, the
 *      agency has its own tariff, serves other cities only, is suspended or is
 *      not provisioned, or the house store cannot be read.
 *   3. The seller is never taken from the request.
 */

require('../setup');
const assert = require('assert');

const { OrderCreationService } = require('../../server/modules/commerce/application/OrderCreationService');

const OWNER = 'usr_owner';
const NANO = {
  id: OWNER, name: 'nanoDelivery', phone: '+237600000000', status: 'active',
  serviceAreas: [], baseFeeXaf: null, isAgency: true, organizationId: 'org_nanodelivery'
};
const HOUSE = { storeId: 'store_nanoafrica', slug: 'nanoafrica', name: 'NanoAfrica', ownerId: OWNER, status: 'ACTIVE', phone: null };

function listing(id, sellerId, storeName, storeId) {
  return {
    id, title: `Item ${id}`, status: 'PUBLISHED', visibility: 'PUBLIC', deletedAt: null, storeStatus: 'ACTIVE',
    basePriceMinor: 10000, salePriceMinor: null, sku: null, sellerId, storeId, storeName, storePhone: '+237611111111'
  };
}

/**
 * @param {object} [options]
 * @param {object|null} [options.house] What the house store resolves to (null: not provisioned).
 * @param {object|null} [options.agency] The nanoDelivery provider record (null: not provisioned).
 * @param {object} [options.providers] Other providers by id, for a buyer's own pick.
 */
function harness({ house = HOUSE, agency = NANO, providers = {}, houseThrows = false } = {}) {
  const saved = [];
  const listings = {
    curated: listing('curated', OWNER, 'NanoAfrica', 'store_nanoafrica'),
    other: listing('other', 'seller_2', 'Books Corner', 'store_seller_2')
  };
  const repository = {
    findListingById: async (id) => listings[id] || null,
    findVariantById: async () => null,
    checkInventory: async () => ({ isAvailable: true, availableQuantity: 99 }),
    // These listings do not track stock, so there is nothing to hold or give back.
    reserveInventory: async () => ({ reserved: true, held: 0, trackInventory: false, availableQuantity: 99 }),
    releaseInventory: async () => false,
    saveOrder: async (order) => { order.id = `ord_${saved.length + 1}`; saved.push(order); return order; }
  };
  const calls = { resolve: 0, resolveDefaultProvider: 0 };
  const sent = [];
  const service = new OrderCreationService(repository, {
    notificationService: { create: async (userId, payload) => { sent.push({ userId, ...payload }); return null; } },
    sendEmail: async () => ({ sent: true }),
    getNotificationPreferences: async () => ({ channels: { email: false } }),
    recipients: { sellerEmail: async () => null, buyerContact: async () => null },
    resolveProvider: async (id) => providers[id] || null,
    houseStore: {
      resolve: async () => { calls.resolve += 1; if (houseThrows) throw new Error('db down'); return house; },
      resolveDefaultProvider: async () => { calls.resolveDefaultProvider += 1; return agency; }
    }
  });
  return { service, saved, calls, sent, to: (id) => sent.filter((n) => n.userId === id) };
}

const ADDRESS = { fullName: 'Awa Njoya', phone: '+237622222222', street: 'Rue 1', city: 'Douala', neighbourhood: 'Bonanjo' };

function place(h, { listingId = 'curated', deliveryMethod = 'HOME_DELIVERY', shippingAddress = ADDRESS, ...rest } = {}) {
  return h.service.createOrder('buyer_1', { items: [{ listingId, quantity: 1 }], deliveryMethod, shippingAddress, ...rest });
}

async function testDefaultApplies() {
  const h = harness();
  const order = await place(h);
  assert.strictEqual(order.preferredDriverId, OWNER, 'the order is filed with nanoDelivery as its preferred provider');
  assert.strictEqual(order.sellerId, OWNER, 'the seller is the owner, from the house store row');
  assert.strictEqual(order.deliveryNotice, undefined, 'a default is not announced to the buyer as a change');
  assert.ok(!('deliveryNotice' in order.toJSON()));

  // Fee-neutral: byte-for-byte the same pricing as the same order with no house default.
  const baseline = harness({ house: null });
  const plain = await place(baseline);
  assert.strictEqual(plain.preferredDriverId, null);
  assert.deepStrictEqual(
    [order.subtotalXaf, order.shippingFeeXaf, order.totalAmountXaf],
    [plain.subtotalXaf, plain.shippingFeeXaf, plain.totalAmountXaf],
    'the buyer pays exactly what they were quoted'
  );

  await h.service.notificationsSettled();
  const note = h.to(OWNER)[0];
  assert.ok(note.body.includes('Delivery provider: nanoDelivery (default: the customer did not choose one)'), note.body);
  assert.ok(!/chosen by the customer/.test(note.body), 'it is not presented as the buyer\'s choice');
  assert.ok(note.body.includes('Offer it to nanoDelivery from Deliveries.'));
  assert.deepStrictEqual(
    { id: note.metadata.details.provider.id, name: note.metadata.details.provider.name, source: note.metadata.details.provider.source },
    { id: OWNER, name: 'nanoDelivery', source: 'default' }
  );
  assert.ok(h.to('buyer_1')[0].body.includes('NanoAfrica') && h.to('buyer_1')[0].body.includes('nanoDelivery'), 'the buyer is told the store and the provider');
}

async function testDefaultServesTheCity() {
  // A declared service area that includes the order's city (folded: Douala == douala).
  const h = harness({ agency: { ...NANO, serviceAreas: ['douala', 'yaounde'] } });
  assert.strictEqual((await place(h)).preferredDriverId, OWNER);
  // Accents and case do not matter, the same way the tariff table matches cities.
  const h2 = harness({ agency: { ...NANO, serviceAreas: ['yaounde'] } });
  const accent = await place(h2, { shippingAddress: { ...ADDRESS, city: 'YAOUNDÉ' } });
  assert.strictEqual(accent.preferredDriverId, OWNER);
}

async function testBuyersExplicitChoiceWins() {
  const speedy = { id: 'rider_9', name: 'Speedy Riders', status: 'active', serviceAreas: [], baseFeeXaf: null };
  const h = harness({ providers: { rider_9: speedy } });
  const order = await place(h, { preferredDriverId: 'rider_9' });
  assert.strictEqual(order.preferredDriverId, 'rider_9', 'the buyer\'s pick is kept');
  assert.strictEqual(h.calls.resolveDefaultProvider, 0, 'the default is not even looked up');
  await h.service.notificationsSettled();
  const note = h.to(OWNER)[0];
  assert.ok(note.body.includes('Delivery provider: Speedy Riders (chosen by the customer)'));
  assert.strictEqual(note.metadata.details.provider.source, 'buyer');

  // A pick that fell away is dropped (and the buyer told), but it is not replaced by the default.
  for (const [pick, provider, reason] of [
    ['rider_gone', null, 'gone'],
    ['rider_susp', { id: 'rider_susp', name: 'Parked', status: 'suspended', serviceAreas: [], baseFeeXaf: null }, 'suspended'],
    ['rider_far', { id: 'rider_far', name: 'Far Away', status: 'active', serviceAreas: ['bamenda'], baseFeeXaf: null }, 'out_of_area']
  ]) {
    const d = harness({ providers: provider ? { [pick]: provider } : {} });
    const dropped = await place(d, { preferredDriverId: pick });
    assert.strictEqual(dropped.preferredDriverId, null, `${reason}: no dead pick on the order`);
    assert.strictEqual(dropped.deliveryNotice && dropped.deliveryNotice.reason, reason, `${reason}: the buyer is told`);
    assert.strictEqual(d.calls.resolveDefaultProvider, 0, `${reason}: and nanoDelivery does not silently take over`);
  }
}

async function testDefaultDoesNotApply() {
  const cases = [
    ['a pickup', harness(), { deliveryMethod: 'STORE_PICKUP' }, 'curated'],
    ['a different seller', harness(), {}, 'other'],
    ['an agency with its own tariff (the fee would change)', harness({ agency: { ...NANO, baseFeeXaf: 2500 } }), {}, 'curated'],
    ['an agency that serves other cities only', harness({ agency: { ...NANO, serviceAreas: ['yaounde'] } }), {}, 'curated'],
    ['a suspended agency', harness({ agency: { ...NANO, status: 'suspended' } }), {}, 'curated'],
    ['an agency that is not provisioned', harness({ agency: null }), {}, 'curated'],
    ['a house store that is not provisioned', harness({ house: null }), {}, 'curated'],
    ['a house store that cannot be read', harness({ houseThrows: true }), {}, 'curated']
  ];
  const reference = harness({ house: null });
  for (const [what, h, extra, listingId] of cases) {
    const order = await place(h, { listingId, ...extra });
    assert.strictEqual(order.preferredDriverId, null, `no default for ${what}`);
    assert.strictEqual(order.deliveryNotice, undefined, `and no notice for ${what}`);
    // Pricing is exactly that of an order that never heard of the house store.
    const baseline = await place(reference, { listingId, ...extra });
    assert.deepStrictEqual(
      [order.subtotalXaf, order.shippingFeeXaf, order.totalAmountXaf],
      [baseline.subtotalXaf, baseline.shippingFeeXaf, baseline.totalAmountXaf],
      `${what}: pricing untouched`
    );
  }

  // A pickup never consults the agency; a different seller never gets the owner's agency.
  const pickup = harness();
  await place(pickup, { deliveryMethod: 'STORE_PICKUP' });
  assert.strictEqual(pickup.calls.resolveDefaultProvider, 0);
  const other = harness();
  await place(other, { listingId: 'other' });
  assert.strictEqual(other.calls.resolveDefaultProvider, 0, 'the agency is only fetched for the owner\'s own orders');
}

async function testSellerNeverComesFromTheRequest() {
  const h = harness();
  for (const field of ['sellerId', 'seller_id', 'storeId']) {
    let error = null;
    try {
      await h.service.createOrder('buyer_1', { items: [{ listingId: 'other', quantity: 1 }], shippingAddress: ADDRESS, [field]: OWNER });
    } catch (e) { error = e; }
    assert.ok(error && error.statusCode === 400, `a request naming ${field} is refused`);
  }
  assert.strictEqual(h.saved.length, 0, 'nothing was saved');

  // Ordering somebody else's listing never earns the owner's agency, whatever else is in the request.
  const o = await place(h, { listingId: 'other', preferredDriverId: undefined });
  assert.strictEqual(o.sellerId, 'seller_2');
  assert.strictEqual(o.preferredDriverId, null);
}

async function run() {
  await testDefaultApplies();
  await testDefaultServesTheCity();
  await testBuyersExplicitChoiceWins();
  await testDefaultDoesNotApply();
  await testSellerNeverComesFromTheRequest();
  console.log('order_default_provider: 5 checks passed');
}

if (require.main === module) {
  run().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
