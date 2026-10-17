/**
 * LOUMOO Comprehensive Test Suite:
 * 1. 1,000+ Pcs Guaranteed Inventory Verification across all catalog & dataset products.
 * 2. Clean Empty Comparison Page Lifecycle & Preset Loading.
 * 3. Universal Multi-Entity Comparison (Products, Stores/Merchants, Hotels/Lodgings).
 */

require('../setup');
const fs = require('fs');
const vm = require('vm');
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
  // TEST SUITE 2: CLEAN EMPTY COMPARISON PAGE & UNIVERSAL PROTOTYPE RUNTIME
  // =========================================================================
  console.log('    3. Testing Clean Empty Comparison Page in prototype component...');
  const content = fs.readFileSync('Commerce App.dc.html', 'utf8');
  const scriptMatch = content.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'Found data-dc-script in Commerce App.dc.html');

  class DCLogic {
    constructor(props) {
      this.props = props || {};
      this.state = {};
    }
    setState(fnOrObj, cb) {
      if (typeof fnOrObj === 'function') {
        this.state = Object.assign({}, this.state, fnOrObj(this.state));
      } else {
        this.state = Object.assign({}, this.state, fnOrObj);
      }
      if (typeof cb === 'function') cb();
    }
  }

  const context = {
    DCLogic,
    console,
    setTimeout: (fn, ms) => {
      if (ms && ms >= 4000) return 1;
      if (typeof fn === 'function') fn();
      return 1;
    },
    clearTimeout: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { documentElement: { setAttribute: () => {} } }
  };

  vm.createContext(context);
  vm.runInContext(scriptMatch[1] + "\nvar comp = new Component({ userName: 'TestBuyer' });", context);
  const comp = context.comp;
  comp.componentDidMount();

  // Test clearing to empty workspace
  let vals = comp.renderVals();
  vals.clearVsAll();
  vals = comp.renderVals();

  assert.strictEqual(comp.state.vs, 0, 'Workspace cleared to 0 items');
  assert.strictEqual(vals.vsEmpty, true, 'Clean empty state active when 0 items');
  assert.strictEqual(vals.vsSlot1Active, false, 'Slot 1 inactive in clean empty state');
  assert.strictEqual(vals.vsSlot2Active, false, 'Slot 2 inactive in clean empty state');
  assert.strictEqual(vals.vsSlot3Active, false, 'Slot 3 inactive in clean empty state');
  assert.strictEqual(vals.vsSlot4Active, false, 'Slot 4 inactive in clean empty state');

  // Verify search and candidates picker
  assert.ok(Array.isArray(vals.vsPickerResults), 'Candidate search results array provided');
  assert(vals.vsPickerResults.length > 0, 'Candidates populated for quick addition');
  const laptopCand = vals.vsPickerResults.find(c => c.id === 'elec-1');
  assert.ok(laptopCand, 'Laptop candidate found in picker');
  assert.strictEqual(laptopCand.stockLabel, 'En stock (1 000+ pcs)');

  // Test Curated Presets
  console.log('    4. Testing Curated Fast-Start Presets...');
  // Preset 1: Ultrabooks
  vals.loadVsPreset('ultrabooks');
  vals = comp.renderVals();
  assert.strictEqual(vals.vsEmpty, false, 'Not empty after loading Ultrabooks preset');
  assert.strictEqual(comp.state.vs, 2, '2 items in Ultrabooks comparison');
  assert.strictEqual(vals.vsSlot1Active, true, 'Slot 1 active for MacBook Air');
  assert.strictEqual(vals.vsSlot2Active, true, 'Slot 2 active for MacBook Pro');

  // Preset 2: Verified Stores
  vals.loadVsPreset('stores');
  vals = comp.renderVals();
  assert.strictEqual(comp.state.vs, 2, '2 stores in Stores comparison');
  assert.strictEqual(JSON.stringify(comp.state.vsCompareIds), JSON.stringify(['store_orca_electronics', 'store_kamertech_direct']));
  assert.strictEqual(vals.vsIsCustomComparison, true, 'Flagged as custom multi-entity comparison');
  assert.strictEqual(vals.vsCompareTitle, 'Orca Electronics vs KamerTech Direct');

  // Preset 3: Stays / Hotels
  vals.loadVsPreset('stays');
  vals = comp.renderVals();
  assert.strictEqual(comp.state.vs, 2, '2 stays in Hotels comparison');
  assert.strictEqual(JSON.stringify(comp.state.vsCompareIds), JSON.stringify(['hotel-1', 'hotel-2']));
  assert.strictEqual(vals.vsCompareTitle, 'Sawa Luxury Hotel vs Résidence Akwa Palm');

  // Preset 4: Smartphones
  vals.loadVsPreset('smartphones');
  vals = comp.renderVals();
  assert.strictEqual(comp.state.vs, 2, '2 smartphones in Phones comparison');
  assert.strictEqual(JSON.stringify(comp.state.vsCompareIds), JSON.stringify(['cat-prod-1', 'cat-prod-2']));
  assert.strictEqual(vals.vsCompareTitle, 'Tecno Camon 50 Pro 5G vs Google Pixel 8 Pro Unlocked');

  // =========================================================================
  // TEST SUITE 3: DYNAMIC UNIVERSAL ENTITY COMPARISON & MATRIX RESOLUTION
  // =========================================================================
  console.log('    5. Testing universal add, remove, and slot limits...');
  vals.clearCompare();
  vals = comp.renderVals();
  assert.strictEqual(vals.vsEmpty, true);

  // Add a catalog product
  vals.addToCompare('elec-1');
  vals = comp.renderVals();
  assert.strictEqual(comp.state.vs, 1);
  assert.strictEqual(vals.vsSlot1Active, true);

  // Add a verified store
  vals.addToCompare('store_orca_electronics');
  vals = comp.renderVals();
  assert.strictEqual(comp.state.vs, 2);

  // Add a hotel stay
  vals.addToCompare('hotel-1');
  vals = comp.renderVals();
  assert.strictEqual(comp.state.vs, 3);

  // Add 4th item (laptop)
  vals.addToCompare('elec-dell-xps');
  vals = comp.renderVals();
  assert.strictEqual(comp.state.vs, 4);
  assert.strictEqual(vals.vsCanAddMore, false, 'vsCanAddMore false at 4 items maximum');

  // Attempt to add 5th item -> blocked by max limit 4
  vals.addToCompare('hotel-2');
  vals = comp.renderVals();
  assert.strictEqual(comp.state.vs, 4, 'Cannot exceed 4 items in comparison');

  // Remove an item
  vals.removeFromCompare('hotel-1');
  vals = comp.renderVals();
  assert.strictEqual(comp.state.vs, 3);
  assert.strictEqual(vals.vsCanAddMore, true, 'vsCanAddMore true after removing item');

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
