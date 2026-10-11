/**
 * LOUMOO Unit Tests - The browser catalogue is the catalogue the server sells
 * ---------------------------------------------------------------------------
 * src/data/catalog_products.js is the source. The storefront does not load it: it
 * loads two files derived from it by build_redesign.py (_emit_catalog_assets),
 * src/data/catalog_products_bundle.js (window.PRODUCTS_DATA, which the shell reads
 * BEFORE any server data) and data/catalog.json. Neither deploy rebuilds them, so
 * the committed copies are what buyers get.
 *
 * They went stale once: the source said NanoAfrica sold everything, the bundle
 * still named a dozen placeholder merchants, and the bag, which splits an order and
 * charges a delivery fee per distinct store name, would have billed one purchase of
 * three phones three times. This test fails the moment they drift again.
 *
 *   1. The bundle is exactly what the emitter writes from the source.
 *   2. data/catalog.json is exactly the catalogue the server loads.
 *   3. Every product in both names the one house store, so a bag is ONE order.
 */

require('../setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { catalogProducts } = require('../../server/modules/catalog/dataLoader');
const { HOUSE_STORE } = require('../../server/modules/store/domain/HouseStore');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

async function run() {
  console.log('  Testing the derived browser catalogue is in sync with its source...');

  // 1. The emitter's own projection of the source.
  const source = read('src/data/catalog_products.js');
  const match = /export\s+const\s+catalogProducts\s*=\s*(\{[\s\S]*?\});?\s*$/.exec(source);
  assert.ok(match, 'the source has the shape the emitter expects');
  const expectedBundle = '/** LOUMOO Catalog Products Browser Bundle (Decoupled) */\nwindow.PRODUCTS_DATA = ' + match[1] + ';\n';
  assert.strictEqual(
    read('src/data/catalog_products_bundle.js'),
    expectedBundle,
    'src/data/catalog_products_bundle.js is stale: run build_redesign.py (or its _emit_catalog_assets step) and commit the result'
  );

  // 2. The JSON copy is what the server serves.
  assert.deepStrictEqual(
    JSON.parse(read('data/catalog.json')),
    JSON.parse(JSON.stringify(catalogProducts)),
    'data/catalog.json is stale: run build_redesign.py (or its _emit_catalog_assets step) and commit the result'
  );

  // 3. One merchant, so the bag groups every curated line into one order.
  const stores = new Set(Object.values(catalogProducts).map((p) => `${p.storeId}|${p.storeName}`));
  assert.deepStrictEqual([...stores], [`${HOUSE_STORE.id}|${HOUSE_STORE.name}`], 'every curated product names the house store');

  console.log('    \u2713 The bundle and JSON the storefront loads match the catalogue the server sells, under one store.');
}

module.exports = { run };
