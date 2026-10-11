/**
 * LOUMOO Unit Tests - A showcase product is refused, never filed under a fake seller
 * ---------------------------------------------------------------------------
 * The storefront mixes real listings (iam.listings) with curated showcase products
 * (src/data) that have no seller account. Until 2026-10-07 the order repository
 * resolved a bag line it could not find in iam.listings through the curated
 * catalogue and returned it with sellerId 'usr_seller_default'. The insert then
 * failed on orders_seller_id_fkey, the API answered 500, and every such checkout
 * read "LOUMOO is temporarily unavailable". No production order succeeded after
 * 2026-09-16.
 *
 * These checks drive the REAL OrderRepository lookup over a fake database (the
 * in-memory repositories in delivery_contact never reach the catalogue fallback,
 * which is how the bug passed CI):
 *
 *   1. A curated product that the catalogue DOES resolve is still not orderable
 *      while the house store is not provisioned: the repository answers null,
 *      never an invented seller.
 *   2. A real listing still resolves, with its own seller.
 *   3. A bag holding showcase products is refused with ONE 404 naming each of
 *      them, nothing is saved and nobody is told about an order that does not exist.
 *
 * Since NanoAfrica (the house store, see store/domain/HouseStore.js) took ownership
 * of the curated catalogue, a curated product IS orderable, but only through the
 * house store's database row:
 *
 *   4. Provisioned => the listing's seller is iam.stores.owner_id of store_nanoafrica,
 *      priced at the PAYABLE amount (the lower of price / salePrice).
 *   5. Only an EXACT dataset key is orderable: a made-up id, a partial id, a fuzzy
 *      match and prototype names are all refused.
 *   6. A suspended house store is refused with the usual message and nothing is saved.
 *   7. A full checkout of a curated product files the order under the owner.
 */

require('../setup');
const assert = require('assert');

const { OrderRepository } = require('../../server/modules/commerce/infrastructure/OrderRepository');
const { OrderCreationService } = require('../../server/modules/commerce/application/OrderCreationService');
const CatalogRepository = require('../../server/modules/catalog/infrastructure/CatalogRepository');
const NotificationService = require('../../server/modules/identity/application/NotificationService');
const { HouseStoreService } = require('../../server/modules/store/application/HouseStoreService');
const { HOUSE_STORE } = require('../../server/modules/store/domain/HouseStore');
const { catalogProducts } = require('../../server/modules/catalog/dataLoader');

// Two curated storefront products (src/data) of different "stores", as in the bag
// that failed in production, and one real listing.
const CURATED_A = 'phone_google_google_pixel_10_pro_fold_512gb_j';
const CURATED_B = 'phone_tecno_tecno_spark_20_pro_256gb_8gb_ram_';
const REAL_ID = 'lst_real_1';
const REAL_ROW = {
  id: REAL_ID,
  store_id: 'store_real_1',
  seller_id: 'seller_real_1',
  title: 'Galaxy S24 Ultra',
  slug: 'galaxy-s24-ultra',
  status: 'PUBLISHED',
  visibility: 'PUBLIC',
  currency: 'XAF',
  base_price_minor: 890000,
  sale_price_minor: null,
  has_variants: false,
  fulfillment_model: null,
  metadata: {},
  deleted_at: null,
  stores: { id: 'store_real_1', name: 'Amina Electronics', status: 'ACTIVE', owner_id: 'seller_real_1', phone_number: '+237690112233', metadata: {} }
};

const OWNER_ID = 'usr_nanoafrica_owner';
const HOUSE_ROW = {
  id: HOUSE_STORE.id,
  owner_id: OWNER_ID,
  name: HOUSE_STORE.name,
  slug: HOUSE_STORE.slug,
  status: 'ACTIVE',
  phone_number: '+237699000111',
  email: 'owner@example.test',
  logo_url: null,
  is_verified: true,
  verification_tier: 'official_brand',
  rating: '5.00',
  rating_count: 0,
  metadata: {},
  deleted_at: null
};

/**
 * Just enough of the Supabase query builder for findListingById, checkInventory
 * and the house store lookup: iam.listings holds `rows`, iam.stores holds `stores`,
 * and any write throws so a test fails loudly if an order would have been saved.
 */
function fakeDb(rows, stores = []) {
  const writes = [];
  const db = {
    writes,
    from(table) {
      const filters = {};
      const q = {
        select() { return q; },
        eq(col, val) { filters[col] = val; return q; },
        is() { return q; },
        in() { return q; },
        order() { return q; },
        limit() { return q; },
        insert(payload) { writes.push({ table, payload }); throw new Error(`unexpected write to ${table}`); },
        update(payload) { writes.push({ table, payload }); throw new Error(`unexpected write to ${table}`); },
        async maybeSingle() {
          if (table === 'listings') return { data: rows.find((r) => r.id === filters.id) || null, error: null };
          if (table === 'stores') return { data: stores.find((r) => r.id === filters.id) || null, error: null };
          return { data: null, error: null };
        },
        async single() { return q.maybeSingle(); },
        then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); }
      };
      return q;
    }
  };
  return db;
}

/** A house-store service over a fake database that does (null: does not) hold the store row. */
function houseService(rowOverrides) {
  const stores = rowOverrides === null ? [] : [{ ...HOUSE_ROW, ...(rowOverrides || {}) }];
  return new HouseStoreService({ db: fakeDb([], stores) });
}

function recordNotifications() {
  const original = NotificationService.create;
  const sent = [];
  NotificationService.create = async (userId, n) => { sent.push({ userId, ...n }); return null; };
  return { sent, restore() { NotificationService.create = original; } };
}

/** The price the buyer pays for a dataset product: the LOWER of price / salePrice. */
function payable(id) {
  const p = catalogProducts[id];
  const digits = (v) => parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  return Math.min(digits(p.price), digits(p.salePrice));
}

const shipping = { fullName: 'Awa Njoya', phone: '+237622222222', street: 'Rue 1', city: 'Douala' };

async function testCuratedProductIsNotAListing() {
  // The premise: the catalogue really does resolve these ids, so the old
  // fallback WOULD have engaged and invented a seller for them.
  const curated = await CatalogRepository.findPublicProductByIdOrSlug(CURATED_A);
  assert.ok(curated && curated.title, 'the curated catalogue resolves the showcase product');
  assert.ok(!curated.sellerId, 'and it has no seller account');

  const repo = new OrderRepository({ db: fakeDb([REAL_ROW]), houseStore: houseService(null) });
  assert.strictEqual(await repo.findListingById(CURATED_A), null, 'a showcase product is not an orderable listing until the house store is provisioned');
  assert.strictEqual(await repo.findListingById(CURATED_B), null);
}

async function testRealListingStillResolves() {
  const repo = new OrderRepository({ db: fakeDb([REAL_ROW]), houseStore: houseService(null) });
  const listing = await repo.findListingById(REAL_ID);
  assert.ok(listing, 'a real listing resolves');
  assert.strictEqual(listing.sellerId, 'seller_real_1', 'under its own seller');
  assert.strictEqual(listing.storeName, 'Amina Electronics');
  assert.strictEqual(listing.status, 'PUBLISHED');
}

async function testBagWithShowcaseItemsIsRefusedOnce() {
  const rec = recordNotifications();
  try {
    const db = fakeDb([REAL_ROW]);
    const service = new OrderCreationService(new OrderRepository({ db, houseStore: houseService(null) }), {
      resolveProvider: async () => null
    });
    let error = null;
    try {
      await service.createOrder('buyer_1', {
        items: [
          { id: CURATED_A, listingId: CURATED_A, quantity: 1, unitPriceXaf: 1035000 },
          { id: CURATED_B, listingId: CURATED_B, quantity: 1, unitPriceXaf: 121500 }
        ],
        shippingAddress: shipping,
        deliveryMethod: 'HOME_DELIVERY'
      });
    } catch (e) { error = e; }

    assert.ok(error, 'the bag is refused');
    assert.strictEqual(error.statusCode, 404, 'as not found, which the checkout explains as a showcase item');
    assert.strictEqual(error.code, 'NOT_FOUND');
    assert.ok(error.message.includes(CURATED_A) && error.message.includes(CURATED_B),
      'one refusal names every showcase item, so the buyer removes them all at once');
    assert.ok(!/usr_seller_default|str_default/.test(JSON.stringify(error)), 'no invented seller or store anywhere');
    assert.strictEqual(db.writes.length, 0, 'nothing was written');
    assert.strictEqual(rec.sent.length, 0, 'nobody was told about an order that does not exist');
  } finally {
    rec.restore();
  }
}

async function testProvisionedStoreOwnsTheCuratedProduct() {
  const repo = new OrderRepository({ db: fakeDb([REAL_ROW]), houseStore: houseService() });
  const listing = await repo.findListingById(CURATED_A);
  assert.ok(listing, 'a curated product is orderable once the house store exists');
  assert.strictEqual(listing.sellerId, OWNER_ID, 'its seller is the owner of the house store row');
  assert.strictEqual(listing.storeId, HOUSE_STORE.id);
  assert.strictEqual(listing.storeName, 'NanoAfrica');
  assert.strictEqual(listing.storePhone, '+237699000111', 'the owner phone travels with the listing');
  assert.strictEqual(listing.storeStatus, 'ACTIVE');
  assert.strictEqual(listing.status, 'PUBLISHED');
  assert.strictEqual(listing.visibility, 'PUBLIC');
  assert.strictEqual(listing.currency, 'XAF');
  assert.strictEqual(listing.basePriceMinor, payable(CURATED_A), 'the buyer is charged the payable price');
  assert.ok(listing.basePriceMinor < 1150000, 'never the higher compare-at price');
  assert.strictEqual(listing.salePriceMinor, null);
  assert.ok(!/usr_seller_default|str_default/.test(JSON.stringify(listing)), 'no invented seller');

  // The payable price is the LOWER of the pair whichever way the data was edited.
  const odd = new OrderRepository({
    db: fakeDb([]),
    houseStore: houseService(),
    curatedCatalog: {
      odd_item: { title: 'Odd', price: 'XAF 100.000', salePrice: 'XAF 80.000' },
      free_item: { title: 'No price' }
    }
  });
  assert.strictEqual((await odd.findListingById('odd_item')).basePriceMinor, 80000);
  assert.strictEqual(await odd.findListingById('free_item'), null, 'a product with no price cannot be ordered');

  // A real listing is untouched by all of this.
  assert.strictEqual((await repo.findListingById(REAL_ID)).sellerId, 'seller_real_1');
}

async function testOnlyAnExactCuratedKeyIsOrderable() {
  const repo = new OrderRepository({ db: fakeDb([REAL_ROW]), houseStore: houseService() });

  // The premise: the browsing lookup WOULD accept these, which is why it must not decide orders.
  const partial = CURATED_A.slice(0, CURATED_A.length - 4);
  const fuzzy = await CatalogRepository.findPublicProductByIdOrSlug(partial);
  assert.ok(fuzzy && fuzzy.title, 'the catalogue fuzzy-matches a partial id');
  const fabricated = await CatalogRepository.findPublicProductByIdOrSlug('phone_made_up_thing_9000');
  assert.ok(fabricated && fabricated.title, 'and fabricates a placeholder for an unknown id');

  for (const id of [
    partial,
    CURATED_A + '_x',
    CURATED_A.toUpperCase(),
    ' ' + CURATED_A,
    'phone_made_up_thing_9000',
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty'
  ]) {
    assert.strictEqual(await repo.findListingById(id), null, `"${id}" is not an exact curated key, so it is refused`);
  }
  assert.ok(await repo.findListingById(CURATED_A), 'while the exact key is accepted');
}

async function testSuspendedHouseStoreIsRefused() {
  const rec = recordNotifications();
  try {
    const db = fakeDb([REAL_ROW]);
    const repo = new OrderRepository({ db, houseStore: houseService({ status: 'SUSPENDED' }) });
    const listing = await repo.findListingById(CURATED_A);
    assert.strictEqual(listing.storeStatus, 'SUSPENDED', 'the store status is reported as it is');

    const service = new OrderCreationService(repo, { resolveProvider: async () => null });
    let error = null;
    try {
      await service.createOrder('buyer_1', {
        items: [{ id: CURATED_A, listingId: CURATED_A, quantity: 1, unitPriceXaf: payable(CURATED_A) }],
        shippingAddress: shipping,
        deliveryMethod: 'HOME_DELIVERY'
      });
    } catch (e) { error = e; }
    assert.ok(error, 'a suspended boutique takes no order');
    assert.ok(/not accepting orders/i.test(error.message), `usual message, got: ${error && error.message}`);
    assert.strictEqual(rec.sent.length, 0);
    assert.strictEqual(db.writes.length, 0);
  } finally {
    rec.restore();
  }
}

async function testCuratedCheckoutIsFiledUnderTheOwner() {
  const rec = recordNotifications();
  try {
    // db: null => the repository keeps the order in memory, so the order can be read back.
    const repo = new OrderRepository({ db: null, houseStore: houseService() });
    const service = new OrderCreationService(repo, { resolveProvider: async () => null });
    const body = (price) => ({
      items: [{ id: CURATED_B, listingId: CURATED_B, quantity: 2, unitPriceXaf: price }],
      shippingAddress: shipping,
      deliveryMethod: 'HOME_DELIVERY'
    });

    // Charging the higher compare-at price is refused: the server owns the price.
    let wrongPrice = null;
    try { await service.createOrder('buyer_1', body(135000)); } catch (e) { wrongPrice = e; }
    assert.ok(wrongPrice, 'the higher was-price is not accepted');

    const order = await service.createOrder('buyer_2', body(payable(CURATED_B)));
    assert.strictEqual(order.sellerId, OWNER_ID, 'the order is filed under the house store owner');
    assert.strictEqual(order.items.length, 1);
    assert.strictEqual(order.items[0].storeId, HOUSE_STORE.id);
    assert.strictEqual(order.subtotalXaf, payable(CURATED_B) * 2);
    assert.ok(rec.sent.some((n) => n.userId === OWNER_ID), 'and the owner is told about it');
  } finally {
    rec.restore();
  }
}

async function run() {
  await testCuratedProductIsNotAListing();
  await testRealListingStillResolves();
  await testBagWithShowcaseItemsIsRefusedOnce();
  await testProvisionedStoreOwnsTheCuratedProduct();
  await testOnlyAnExactCuratedKeyIsOrderable();
  await testSuspendedHouseStoreIsRefused();
  await testCuratedCheckoutIsFiledUnderTheOwner();
  console.log('order_showcase_items: 7 checks passed');
}

if (require.main === module) {
  run().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
