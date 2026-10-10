/**
 * LOUMOO Unit Tests - The catalogue presents NanoAfrica as the seller of the curated products
 * ---------------------------------------------------------------------------
 * Every product of the curated dataset belongs to the house store (see
 * store/domain/HouseStore.js). What the buyer sees must say so, and must be the
 * REAL provisioned store when it exists:
 *
 *   1. Cards and details name NanoAfrica / store_nanoafrica whatever seller name the
 *      dataset still carries, with or without the store being provisioned.
 *   2. A store-scoped query for the house store returns the curated products; for any
 *      other store it returns none of them (as before).
 *   3. Provisioned: the product page's seller block, and the contact the cart reads,
 *      come from the store row (phone, logo, rating, city, verification).
 *      Not provisioned: no contact is invented.
 *   4. The "verified stores" refinement follows the house store's own verification.
 *   5. The placeholder the detail lookup fabricates for an unknown id is NOT presented
 *      as a NanoAfrica product.
 */

require('../setup');
const assert = require('assert');

const CatalogRepository = require('../../server/modules/catalog/infrastructure/CatalogRepository');
const { HOUSE_STORE } = require('../../server/modules/store/domain/HouseStore');

const PRODUCT = 'phone_google_google_pixel_10_pro_fold_512gb_j';

const HOUSE = {
  storeId: HOUSE_STORE.id,
  slug: HOUSE_STORE.slug,
  name: HOUSE_STORE.name,
  ownerId: 'usr_owner',
  status: 'ACTIVE',
  phone: '+237699000111',
  email: 'owner@example.test',
  logoUrl: 'https://cdn.example.test/nanoafrica.png',
  isVerified: true,
  verificationTier: 'official_brand',
  rating: 4.8,
  ratingCount: 12,
  city: 'Yaoundé'
};

function withHouse(house, fn) {
  const previous = CatalogRepository._houseService;
  CatalogRepository._houseService = { resolve: async () => house };
  return Promise.resolve(fn()).finally(() => { CatalogRepository._houseService = previous; });
}

async function testCuratedItemsBelongToTheHouseStoreUnprovisioned() {
  await withHouse(null, async () => {
    const page = await CatalogRepository.listPublishedListings({ limit: 5 });
    assert.ok(page.items.length > 0);
    for (const it of page.items) {
      assert.strictEqual(it.storeId, HOUSE_STORE.id);
      assert.strictEqual(it.storeName, 'NanoAfrica');
      assert.strictEqual(it.merchant, 'NanoAfrica');
      assert.ok(!it.storePhone && !it.sellerPhone, 'no contact is invented before the store exists');
    }

    const detail = await CatalogRepository.findPublicProductByIdOrSlug(PRODUCT);
    assert.strictEqual(detail.storeId, HOUSE_STORE.id);
    assert.strictEqual(detail.store.id, HOUSE_STORE.id);
    assert.strictEqual(detail.store.name, 'NanoAfrica');
    assert.strictEqual(detail.store.slug, 'nanoafrica');
    assert.strictEqual(detail.store.phoneNumber, null);
  });
}

async function testStoreScopedQueries() {
  await withHouse(null, async () => {
    const house = await CatalogRepository.listPublishedListings({ storeId: HOUSE_STORE.id, limit: 100 });
    assert.strictEqual(house.total, CatalogRepository.curatedProductCount(), 'the house store lists the whole curated catalogue');
    assert.ok(house.items.length === 100 && house.hasMore, 'paged like any other store');
    assert.ok(house.items.every((i) => i.storeId === HOUSE_STORE.id));

    const searched = await CatalogRepository.listPublishedListings({ storeId: HOUSE_STORE.id, search: 'pixel 10 pro fold', limit: 10 });
    assert.ok(searched.items.length >= 1 && searched.items.length < 20, 'other filters still apply inside the store');

    const other = await CatalogRepository.listPublishedListings({ storeId: 'store_somebody_else', limit: 10 });
    assert.strictEqual(other.total, 0, 'another store has none of the curated products');
    assert.strictEqual(other.items.length, 0);

    const storefront = await CatalogRepository.curatedStorefront({ limit: 7 });
    assert.strictEqual(storefront.items.length, 7);
    assert.strictEqual(storefront.total, CatalogRepository.curatedProductCount());
  });
}

async function testProvisionedStoreSuppliesTheSellerBlock() {
  await withHouse(HOUSE, async () => {
    const detail = await CatalogRepository.findPublicProductByIdOrSlug(PRODUCT);
    assert.deepStrictEqual(detail.store, {
      id: HOUSE_STORE.id,
      name: 'NanoAfrica',
      slug: 'nanoafrica',
      logoUrl: 'https://cdn.example.test/nanoafrica.png',
      phoneNumber: '+237699000111',
      whatsapp: '+237699000111',
      isVerified: true,
      verificationTier: 'official_brand',
      rating: 4.8,
      ratingCount: 12,
      city: 'Yaoundé'
    });
    assert.strictEqual(detail.sellerPhone, '+237699000111', 'the cart reads the owner contact');
    assert.strictEqual(detail.storePhone, '+237699000111');
    assert.strictEqual(detail.verified, true);

    const page = await CatalogRepository.listPublishedListings({ limit: 3 });
    assert.ok(page.items.every((i) => i.sellerPhone === '+237699000111'), 'list cards carry the owner contact too');
  });
}

async function testVerifiedRefinementFollowsTheHouseStore() {
  await withHouse(HOUSE, async () => {
    const r = await CatalogRepository.listPublishedListings({ verified: true, limit: 5 });
    assert.strictEqual(r.total, CatalogRepository.curatedProductCount(), 'a verified house store passes the refinement for all its products');
  });
  await withHouse({ ...HOUSE, isVerified: false }, async () => {
    const r = await CatalogRepository.listPublishedListings({ verified: true, limit: 5 });
    assert.strictEqual(r.total, 0, 'an unverified house store fails it');
  });
}

async function testFabricatedPlaceholderIsNotAHouseProduct() {
  await withHouse(HOUSE, async () => {
    const ghost = await CatalogRepository.findPublicProductByIdOrSlug('phone_made_up_thing_9000');
    assert.ok(ghost && ghost.title, 'the page still renders something for a stale link');
    assert.notStrictEqual(ghost.storeId, HOUSE_STORE.id, 'but it is not presented as a NanoAfrica product');
    assert.strictEqual(ghost.store.phoneNumber, null);
  });
}

async function testRealCardsPassThrough() {
  const real = { id: 'lst_1', storeId: 'store_real', storeName: 'Amina Electronics', verified: false, sellerPhone: '+237690112233' };
  assert.strictEqual(CatalogRepository._presentWithHouse(real, HOUSE), real, 'a real seller card is returned untouched');
  assert.strictEqual(await CatalogRepository._enrichCuratedDetail(real), real);
}

async function run() {
  await testCuratedItemsBelongToTheHouseStoreUnprovisioned();
  await testStoreScopedQueries();
  await testProvisionedStoreSuppliesTheSellerBlock();
  await testVerifiedRefinementFollowsTheHouseStore();
  await testFabricatedPlaceholderIsNotAHouseProduct();
  await testRealCardsPassThrough();
  console.log('house_store_catalog: 6 checks passed');
}

if (require.main === module) {
  run().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
