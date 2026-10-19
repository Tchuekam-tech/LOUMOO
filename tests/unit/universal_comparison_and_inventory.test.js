/**
 * LOUMOO Comprehensive Test Suite:
 * 1. 1,000+ Pcs Guaranteed Inventory Verification across all catalog & dataset products.
 * 2. Empty compare page, real-id presets and tray limits in the shipped controller.
 * 3. Universal Multi-Entity Comparison (Products, Stores/Merchants, Hotels/Lodgings).
 */

require('../setup');
const { loadCompareRuntime } = require('../helpers/compareRuntime');
const assert = require('assert');

// 1. Data Sources
const { catalogProducts, products } = require('../../server/modules/catalog/dataLoader');
const ComparisonService = require('../../server/modules/catalog/application/ComparisonService');

async function run() {
  console.log('  Testing Inventory Stock & Universal Multi-Entity Comparison...');

  // =========================================================================
  // TEST SUITE 1: GUARANTEED INVENTORY (>= 1,000 PCS PER PRODUCT)
  // =========================================================================
  console.log('    1. Auditing inventory stock across 932+ catalog products...');
  assert.ok(catalogProducts && typeof catalogProducts === 'object', 'catalogProducts dataset loaded');
  const catalogKeys = Object.keys(catalogProducts);
  assert(catalogKeys.length >= 900, `Expected >= 900 catalog products, found ${catalogKeys.length}`);

  let totalCatalogChecked = 0;
  for (const key of catalogKeys) {
    const item = catalogProducts[key];
    assert.strictEqual(item.inStock, true, `Product ${key} must be inStock: true`);
    assert(Number(item.stockUnits) >= 1000, `Product ${key} stockUnits (${item.stockUnits}) must be >= 1000`);
    assert(Number(item.stockQuantity) >= 1000, `Product ${key} stockQuantity (${item.stockQuantity}) must be >= 1000`);
    assert(Number(item.stock) >= 1000, `Product ${key} stock (${item.stock}) must be >= 1000`);
    totalCatalogChecked++;
  }
  console.log(`      ✓ All ${totalCatalogChecked} catalog products have verified >= 1,000 pcs in stock.`);

  console.log('    2. Auditing products across vertical datasets (hotels, electronics, services)...');
  let verticalItemsChecked = 0;
  for (const category in products) {
    const items = products[category];
    if (Array.isArray(items)) {
      for (const item of items) {
        assert.strictEqual(item.inStock, true, `Vertical item ${item.id} must be inStock: true`);
        assert(Number(item.stockUnits) >= 1000, `Vertical item ${item.id} stockUnits must be >= 1000`);
        verticalItemsChecked++;
      }
    }
  }
  console.log(`      ✓ All ${verticalItemsChecked} vertical dataset items have verified >= 1,000 pcs in stock.`);

  // =========================================================================
  // TEST SUITE 2: EMPTY STATE, PRESETS AND TRAY IN THE SHIPPED CONTROLLER
  // =========================================================================
  console.log('    3. Testing the empty compare page in the shipped controller...');
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const rt = loadCompareRuntime({ withView: true });
  const comp = rt.comp;
  comp.componentDidMount();

  let vals = rt.vals();
  vals.clearVsAll();
  vals = rt.vals();
  assert.strictEqual(comp.state.vs, 0, 'Workspace cleared to 0 items');
  assert.strictEqual(vals.vsEmpty, true, 'Clean empty state active when 0 items');
  assert.strictEqual(vals.vsCanCompare, false, 'Nothing to compare yet');
  assert.strictEqual(comp.state.vsResult, null, 'Clearing drops the previous answer');
  // Without the live search runtime the picker offers nothing rather than a
  // fixed list with invented prices and stock.
  assert.deepStrictEqual(plain(vals.vsPickerResults), [], 'No built-in sample candidates');

  console.log('    4. Testing curated presets use real catalogue ids...');
  vals.loadVsPreset('ultrabooks');
  vals = rt.vals();
  assert.strictEqual(vals.vsEmpty, false);
  assert.deepStrictEqual(plain(comp.state.vsCompareIds), ['laptop_apple_apple_macbook_air_m2_13_6_pouces', 'laptop_apple_apple_macbook_pro_14_m3_pro_gris']);
  for (const id of comp.state.vsCompareIds) assert.ok(catalogProducts[id], `preset id ${id} exists in the catalogue`);

  vals.loadVsPreset('stores');
  vals = rt.vals();
  assert.deepStrictEqual(plain(comp.state.vsCompareIds), ['store_orca_electronics', 'store_kamertech_direct']);
  assert.strictEqual(vals.vsCompareTitle, 'Orca Electronics vs KamerTech Direct');

  vals.loadVsPreset('stays');
  vals = rt.vals();
  assert.deepStrictEqual(plain(comp.state.vsCompareIds), ['hotel-1', 'hotel-2']);
  assert.strictEqual(vals.vsCompareTitle, 'Sawa Luxury Hotel vs Résidence Akwa Palm');

  vals.loadVsPreset('smartphones');
  vals = rt.vals();
  const phoneIds = plain(comp.state.vsCompareIds);
  assert.deepStrictEqual(phoneIds, ['phone_tecno_tecno_camon_50_pro_5g_256gb_12gb_', 'phone_google_google_pixel_8_pro_128gb_unlocke']);
  for (const id of phoneIds) assert.ok(catalogProducts[id], `preset id ${id} exists in the catalogue`);
  assert.strictEqual(vals.vsCompareTitle, 'Tecno Camon 50 Pro 5G 256GB / 12GB RAM vs Google Pixel 8 Pro 128GB Unlocked Android 14');

  console.log('    5. Testing tray add, remove and the 4-item limit...');
  vals.clearCompare();
  vals = rt.vals();
  assert.strictEqual(vals.vsEmpty, true);
  for (const id of ['elec-1', 'store_orca_electronics', 'hotel-1', 'elec-dell-xps']) {
    vals.addToCompare(id);
    vals = rt.vals();
  }
  assert.strictEqual(comp.state.vs, 4);
  assert.strictEqual(vals.vsCanAddMore, false, 'vsCanAddMore false at 4 items maximum');
  vals.addToCompare('hotel-2');
  vals = rt.vals();
  assert.strictEqual(comp.state.vs, 4, 'Cannot exceed 4 items in comparison');
  vals.addToCompare('elec-1');
  assert.strictEqual(rt.vals().vsTrayCards.length, 4, 'An item already in the tray is not added twice');
  vals.removeFromCompare('hotel-1');
  vals = rt.vals();
  assert.strictEqual(comp.state.vs, 3);
  assert.strictEqual(vals.vsCanAddMore, true, 'vsCanAddMore true after removing item');
  assert(vals.vsTrayCards.every(c => !/1 000\+|1,000\+/.test(JSON.stringify(c))), 'No invented stock on tray cards');

  // Backend Comparison Service Integration
  console.log('    6. Testing Backend ComparisonService resolution for universal entities...');
  // 1) Products Comparison
  const prodComparison = await ComparisonService.getComparison(['elec-1', 'elec-macbook-pro']);
  assert.strictEqual(prodComparison.products.length, 2);
  assert.strictEqual(prodComparison.products[0].inStock, true);
  assert.strictEqual(prodComparison.products[1].inStock, true);
  // The datasets carry a 1000 placeholder, not a count: the comparison reports
  // availability and says the exact stock is unknown rather than repeating it.
  assert.strictEqual(prodComparison.products[0].stockKnown, false);
  assert.strictEqual(prodComparison.products[0].stockUnits, null);
  assert.ok(prodComparison.recommendation.recommendedProductId);

  // 2) Verified Stores Comparison
  const storeComparison = await ComparisonService.getComparison(['store_orca_electronics', 'store_kamertech_direct']);
  assert.strictEqual(storeComparison.products.length, 2);
  assert.strictEqual(storeComparison.products[0].title, 'Orca Electronics');
  assert.strictEqual(storeComparison.products[1].title, 'KamerTech Direct');
  // Boutiques are shown side by side; a product count is not a price to rank on.
  assert.strictEqual(storeComparison.products[0].priceNumeric, null);
  assert.strictEqual(storeComparison.recommendation.recommendedProductId, null);

  // 3) Hotels Comparison
  const hotelComparison = await ComparisonService.getComparison(['hotel-1', 'hotel-2']);
  assert.strictEqual(hotelComparison.products.length, 2);
  assert.strictEqual(hotelComparison.products[0].title, 'Sawa Luxury Hotel');
  assert.strictEqual(hotelComparison.products[1].title, 'Résidence Akwa Palm');
  assert.strictEqual(hotelComparison.products[0].entityType, 'hotel');

  // 4) Candidates Discovery Filtering
  const storeCandidatesRes = await ComparisonService.getCompareCandidates({ type: 'stores' });
  const storeCandidates = storeCandidatesRes.items || storeCandidatesRes;
  assert(storeCandidates.length >= 2, 'Found verified stores for comparison');
  const orcaCand = storeCandidates.find(c => c.title.includes('Orca'));
  assert.ok(orcaCand, 'Orca Electronics found in store candidates');

  console.log('    ✓ All Inventory & Universal Multi-Entity Comparison tests passed 100%!\n');
}

run().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
