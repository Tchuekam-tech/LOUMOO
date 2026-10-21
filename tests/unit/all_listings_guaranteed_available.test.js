/**
 * Curated catalogue availability
 *
 * Verifies:
 * 1. Every product in the marketplace hub & discovery rails is a valid, available listing.
 * 2. Every product has >= 1000 pcs in stock and inStock === true.
 *
 * It used to also require that an unknown id never 404s and instead becomes a
 * synthesised, purchasable listing. That was the bug: see
 * no_fabricated_products.test.js and product_detail_not_found.test.js.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('Universal Available Listings Suite', async (t) => {
  const root = path.resolve(__dirname, '../..');

  // 1. Verify Catalog Products Bundle and Dataset
  await t.test('All 970+ catalog products have guaranteed inStock: true and stock >= 1000', () => {
    const bundlePath = path.join(root, 'src/data/catalog_products_bundle.js');
    assert.ok(fs.existsSync(bundlePath), 'catalog_products_bundle.js exists');

    const sandbox = { window: {} };
    vm.createContext(sandbox);
    const bundleCode = fs.readFileSync(bundlePath, 'utf-8');
    vm.runInContext(bundleCode, sandbox);

    const catalog = sandbox.window.PRODUCTS_DATA;
    assert.ok(catalog && typeof catalog === 'object', 'PRODUCTS_DATA is an object');
    const keys = Object.keys(catalog);
    assert.ok(keys.length >= 970, `Catalog has ${keys.length} items (expected >= 970)`);

    // Verify key featured products exist
    const featured = [
      'tecno_camon40', 'samsung_s24_ultra', 'galaxy_s26_ultra', 'iphone_17_pro_max',
      'iphone_15_pro', 'macbook_m2', 'surface_laptop', 'ps5_slim', 'airpods_max',
      'airpods_4', 'jbl_flip6', 'alexa_speaker', 'apple_airtag', 'dji_osmo_pocket3',
      'action_cam', 'lapel_mic', 'mifa_a90', 'power_bank', 'nike_air_force_1',
      'chelsea_boots', 'dress_loafers', 'leather_satchel', 'stiletto_heels',
      'ankara_palazzo', 'artisan_sandals', 'beaded_bracelet', 'shea_lotion',
      'home_station_expresso_infusion_barista_maison', 'cold_press_juicer',
      'espresso_maker', 'oraimo_airfryer', 'na_double_monk_01', 'na_danbaoly_bag_02',
      'na_pedro_backpack_03', 'na_boat_speaker_04', 'na_pixel_10_pro_05',
      'na_amina_muaddi_06', 'na_noire_birkin_07', 'na_bigtree_heels_08',
      'na_artisan_brogue_09', 'na_tobacco_vanille_10', 'na_infinity_necklace_11'
    ];

    for (const fid of featured) {
      const p = catalog[fid];
      assert.ok(p, `Featured item ${fid} exists in PRODUCTS_DATA`);
      assert.strictEqual(p.inStock, true, `${fid} inStock must be true`);
      const units = p.stockUnits || p.stockQuantity || p.stock || 0;
      assert.ok(units >= 1000, `${fid} stock must be >= 1000 (got ${units})`);
      assert.ok(p.title && p.title.length > 0, `${fid} must have a title`);
      assert.ok(p.price && p.price.length > 0, `${fid} must have a price`);
      assert.ok(p.coverImage && p.coverImage.length > 0, `${fid} must have a coverImage`);
    }

    // Check all products for 1000+ pcs
    for (const k of keys) {
      const p = catalog[k];
      assert.strictEqual(p.inStock, true, `Product ${k} inStock must be true`);
      const units = p.stockUnits || p.stockQuantity || p.stock || 0;
      assert.ok(units >= 1000, `Product ${k} must have >= 1000 units (got ${units})`);
    }
  });

  // 2. Verify all openProduct calls in views map to existing items
  await t.test('All openProduct calls in views resolve to available catalog listings', () => {
    const homeView = fs.readFileSync(path.join(root, 'src/views/home_view.py'), 'utf-8');
    const re = /openProduct\(['"]([^'"]+)['"]\)/g;
    let m;
    const ids = new Set();
    while ((m = re.exec(homeView)) !== null) {
      ids.add(m[1]);
    }

    const bundlePath = path.join(root, 'src/data/catalog_products_bundle.js');
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(bundlePath, 'utf-8'), sandbox);
    const catalog = sandbox.window.PRODUCTS_DATA;

    for (const id of ids) {
      assert.ok(catalog[id], `home_view.py product ${id} must be in catalog bundle`);
    }
  });
});
