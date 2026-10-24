/**
 * LOUMOO Unit Tests — the junk-cleanup planner classifies safely (cleanup brief, Steps 2 & 3)
 * ---------------------------------------------------------------------------
 * planCleanup() decides what the "you run" script (scripts/cleanup_junk_data.js) would delete,
 * archive or keep. This proves the dangerous decision WITHOUT a database:
 *
 *   - a test store with no order/review is deleted; one referenced by an order or a review is
 *     ARCHIVED (never hard-deleted), honouring the brief's rule;
 *   - a store flagged is_test=true is caught even when its name/slug look ordinary;
 *   - placeholder listings (untitled-draft-listing-*, harness-test-listing-*) delete/archive the
 *     same way; one under a doomed test store is left to the store's cascade, not double-counted;
 *   - of a family of duplicate listings the OLDEST survives and the rest are archived with a 301
 *     from each old slug to the survivor;
 *   - real stores and listings are untouched.
 */

require('../setup');
const assert = require('assert');
const { planCleanup } = require('../../scripts/cleanup_junk_data');

const store = (id, slug, name, extra) => Object.assign({ id, slug, name, status: 'ACTIVE', visibility: 'PUBLIC', is_test: false, deleted_at: null }, extra);
const listing = (id, slug, title, store_id, storeName, extra) => Object.assign({
  id, slug, title, store_id, category_id: 'electronics', base_price_minor: 85000000,
  status: 'PUBLISHED', created_at: '2026-09-01T00:00:00Z', deleted_at: null, stores: { name: storeName }
}, extra);

async function run() {
  console.log('  Testing the junk-cleanup planner...');

  const stores = [
    store('s_real', 'giantech-empire-p2lt', 'Giantech Empire'),
    store('s_test_free', 'test-boutique-free01', 'Test Boutique free01'),
    store('s_test_ref', 'test-boutique-ref001', 'Test Boutique ref001'),
    store('s_loop', 'loop-test-boutique-kwfn', 'Loop Test Boutique'),
    store('s_flagged', 'renamed-ordinary-shop', 'Renamed Ordinary Shop', { is_test: true })
  ];

  const MB = { title: 'MacBook Air M3 Space Gray 16GB', category_id: 'electronics', base_price_minor: 85000000 };
  const listings = [
    // under a test store that will be deleted → must not be counted on its own (cascade handles it)
    listing('l_under_test', 'sony-wh-1000xm5-aaa111', 'Sony WH-1000XM5', 's_test_free', 'Test Boutique free01'),
    listing('l_under_test_ref', 'pixel-ref-bbb222', 'Pixel (ref)', 's_test_ref', 'Test Boutique ref001'),
    // placeholder listings under a REAL store
    listing('l_ph_free', 'untitled-draft-listing-lgp4', 'Item s25', 's_real', 'Giantech Empire'),
    listing('l_ph_ref', 'untitled-draft-listing-k4x5', 'Samsung Galaxy S24 Ultra', 's_real', 'Giantech Empire'),
    listing('l_harness', 'harness-test-listing-mto5p4', 'Harness item', 's_real', 'Giantech Empire'),
    // three duplicate MacBooks, same seller NAME across three real stores, different ages
    listing('l_mb_old', 'macbook-air-m3-aaaaaa', MB.title, 's_real', 'Kamer Tech Solutions', { ...MB, created_at: '2026-09-07T08:45:57Z' }),
    listing('l_mb_mid', 'macbook-air-m3-bbbbbb', MB.title, 's_real', 'Kamer Tech Solutions', { ...MB, created_at: '2026-09-07T08:47:51Z' }),
    listing('l_mb_new', 'macbook-air-m3-cccccc', MB.title, 's_real', 'Kamer Tech Solutions', { ...MB, created_at: '2026-09-07T08:49:23Z' }),
    // a genuine, unique, real listing — untouched
    listing('l_keep', 'apple-iphone-15-pro-max-cegz00', 'Apple iPhone 15 Pro Max', 's_real', 'Giantech Empire', { base_price_minor: 89000000 })
  ];

  const orders = [
    { id: 'o1', seller_id: 'usr_x', items: [{ listingId: 'l_under_test_ref', title: 'Pixel (ref)' }] }, // references a test store's listing
    { id: 'o2', seller_id: 'usr_y', items: JSON.stringify([{ slug: 'untitled-draft-listing-k4x5' }]) }    // references a placeholder listing (as a string)
  ];
  const reviews = [{ target_type: 'product', target_id: 'l_keep' }]; // on the real listing; irrelevant to junk

  const plan = planCleanup({ stores, listings, orders, reviews });

  // Test stores: free01 + loop deleted; ref001 archived (an order names its listing); flagged archived? it has no refs → delete
  assert.deepStrictEqual(plan.stores.delete.map((s) => s.id).sort(), ['s_flagged', 's_loop', 's_test_free'], 'unreferenced test stores (incl. the is_test-flagged one) are deleted');
  assert.deepStrictEqual(plan.stores.archive.map((s) => s.id), ['s_test_ref'], 'a test store referenced by an order is archived, not deleted');
  assert.ok(plan.stores.delete.find((s) => s.id === 's_flagged'), 'a store is caught by is_test=true even with an ordinary name/slug');

  // Placeholder listings under the REAL store: lgp4 + harness deleted, k4x5 archived (order references it). The two under test stores are NOT listed here.
  assert.deepStrictEqual(plan.listings.delete.map((l) => l.id).sort(), ['l_harness', 'l_ph_free'], 'unreferenced placeholder listings deleted');
  assert.deepStrictEqual(plan.listings.archive.map((l) => l.id), ['l_ph_ref'], 'a placeholder listing referenced by an order is archived');
  assert.ok(!plan.listings.delete.concat(plan.listings.archive).some((l) => ['l_under_test', 'l_under_test_ref'].includes(l.id)), 'listings under a doomed test store are left to the cascade, not double-counted');

  // Duplicates: oldest MacBook kept, other two archived + redirected to it.
  assert.deepStrictEqual(plan.duplicates.keep.map((l) => l.id), ['l_mb_old'], 'the oldest duplicate survives');
  assert.deepStrictEqual(plan.duplicates.archive.map((l) => l.id).sort(), ['l_mb_mid', 'l_mb_new'], 'the newer duplicates are archived');
  assert.ok(plan.duplicates.archive.every((l) => l.keptId === 'l_mb_old'), 'archived duplicates point at the survivor');
  assert.deepStrictEqual(
    plan.duplicates.redirects.map((r) => `${r.old_slug}->${r.target_listing_id}`).sort(),
    ['macbook-air-m3-bbbbbb->l_mb_old', 'macbook-air-m3-cccccc->l_mb_old'],
    'a 301 is registered from each archived slug to the survivor'
  );

  // The real, unique listing is never a duplicate and never deleted/archived.
  assert.ok(!plan.duplicates.archive.concat(plan.listings.delete, plan.listings.archive).some((l) => l.id === 'l_keep'), 'the genuine listing is untouched');
  assert.ok(!plan.duplicates.keep.some((l) => l.id === 'l_keep'), 'a unique listing is not even reported as a kept duplicate');

  assert.deepStrictEqual(plan.counts, {
    storesScanned: 5, listingsScanned: 9,
    testStoresDeleted: 3, testStoresArchived: 1,
    placeholderListingsDeleted: 2, placeholderListingsArchived: 1,
    duplicatesKept: 1, duplicatesArchived: 2, redirects: 2
  }, 'the before/after counts are exact');

  console.log('    ✓ planCleanup: deletes unreferenced junk, archives referenced rows, keeps the oldest of a duplicate family with 301s, leaves real data alone');
}

module.exports = { run };
