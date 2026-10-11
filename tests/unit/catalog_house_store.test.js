/**
 * LOUMOO Unit Tests - The curated catalogue is sold by the house store (NanoAfrica)
 * ---------------------------------------------------------------------------
 * Until a real seller lists goods, every product in src/data/catalog_products.js
 * belongs to NanoAfrica. The server decides WHO owns an order from the database
 * row of that store, never from this file, but what a buyer reads (the seller
 * card, the description, the bag) comes from here, so it must not name a merchant
 * that does not exist.
 *
 *   1. Every product names NanoAfrica / store_nanoafrica, verified, and the ids
 *      are the constants the server uses.
 *   2. The shipped file is already in the state the assignment script produces
 *      (a second run would change nothing).
 *   3. The script rewrites a seller named in a description, in LF and CRLF files,
 *      and keeps a brand that merely shares a placeholder store's name.
 *   4. It only touches the intended fields, and keeps the ship-from city.
 *   5. No description still credits one of the old placeholder merchants.
 */

require('../setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { catalogProducts } = require('../../server/modules/catalog/dataLoader');
const { HOUSE_STORE } = require('../../server/modules/store/domain/HouseStore');
const {
  assignCatalogToHouseStore,
  assertOnlyIntendedChanges,
  rewriteDescription
} = require('../../scripts/assign_catalog_to_house_store');

const DATASET = path.resolve(__dirname, '..', '..', 'src', 'data', 'catalog_products.js');

// The placeholder merchants the dataset was generated with.
const OLD_MERCHANTS = [
  'Orca Electronics', 'Digital Corner', 'SmartTech Cameroun', 'Apple Hub Douala',
  'Galaxy Center Yaoundé', 'Oraimo Official Store', 'TechPro Omnisports', 'Cameroon Gadgets Express',
  'Kraasa Official', 'Maison de la Haute Couture', 'K-Walk Footwear', 'Joaillerie Royale Yaoundé',
  'Horlogerie Suisse Douala', 'AfroLuxe Paris & Douala', 'Sneaker Lounge 237', 'Art de la Table Yaoundé',
  'Électro Douala Express', 'Maison & Confort Akwa', 'Le Comptoir Électroménager', 'K-Kitchen & Déco Bastos',
  'Chef Pro Cameroun', 'LOUMOO Verified Partner', 'Apple Premium Reseller Akwa', 'Maison Blanche Douala',
  'ElectroHome Douala', 'Acoustic Pro Yaoundé', 'Luxury Club Douala', 'Zulu Heritage Akwa'
];

function sample(eol) {
  return [
    'export const catalogProducts = {',
    '  "p_one": {',
    '    "id": "p_one",',
    '    "brand": "Armonía Milano",',
    '    "title": "Mocassins Armonía Milano",',
    '    "storeName": "Armonía Milano",',
    '    "storeCity": "Bonapriso, Douala",',
    '    "storeRating": "4.8",',
    '    "storeVerified": false,',
    '    "description": "Mocassins Armonía Milano en cuir. Prix garanti par Armonía Milano avec LOUMOO.",',
    '    "inStock": true',
    '  }',
    '};',
    ''
  ].join(eol);
}

function testEveryProductBelongsToTheHouseStore() {
  const products = Object.values(catalogProducts);
  assert.ok(products.length > 900, 'the curated catalogue loaded');
  for (const p of products) {
    assert.strictEqual(p.storeName, HOUSE_STORE.name, `${p.id} storeName`);
    assert.strictEqual(p.storeId, HOUSE_STORE.id, `${p.id} storeId`);
    assert.strictEqual(p.storeVerified, true, `${p.id} storeVerified`);
    assert.ok(p.storeCity, `${p.id} keeps its ship-from city`);
  }
}

function testShippedFileIsAlreadyAssigned() {
  const source = fs.readFileSync(DATASET, 'utf8');
  const { text, changed, products } = assignCatalogToHouseStore(source);
  assert.strictEqual(changed, 0, 'a second run must change nothing');
  assert.strictEqual(text, source, 'and must reproduce the file byte for byte');
  assert.strictEqual(products, Object.keys(catalogProducts).length);
}

function testRewriteHandlesLfAndCrlf() {
  for (const eol of ['\n', '\r\n']) {
    const { text, changed, products } = assignCatalogToHouseStore(sample(eol));
    assert.strictEqual(products, 1);
    assert.strictEqual(changed, 1);
    assert.ok(text.includes(`"storeName": "NanoAfrica",${eol}    "storeId": "store_nanoafrica",${eol}`), 'storeId follows storeName');
    assert.ok(text.includes('"storeVerified": true,'), 'verified');
    assert.ok(text.includes('"storeCity": "Bonapriso, Douala"'), 'city kept');
    assert.ok(text.includes('Prix garanti par NanoAfrica avec LOUMOO.'), 'description seller rewritten');
    assert.ok(text.includes('"brand": "Armonía Milano"') && text.includes('"title": "Mocassins Armonía Milano"'), 'brand kept');
    assert.ok(text.includes('Mocassins Armonía Milano en cuir.'), 'brand in a description kept');
    assert.strictEqual(text.split(eol).length, sample(eol).split(eol).length + 1, 'exactly one line added');
    // Idempotent on the rewritten text too.
    assert.strictEqual(assignCatalogToHouseStore(text).changed, 0);
  }
}

function testRewriteOnlyTouchesTheSellerPosition() {
  assert.strictEqual(rewriteDescription('remise chez Orca Electronics.', 'Orca Electronics'), 'remise chez NanoAfrica.');
  assert.strictEqual(rewriteDescription('par Orca Electronicsx', 'Orca Electronics'), 'par Orca Electronicsx');
  assert.strictEqual(rewriteDescription('Orca Electronics vend', 'Orca Electronics'), 'Orca Electronics vend');
  assert.strictEqual(rewriteDescription('chez NanoAfrica', 'NanoAfrica'), 'chez NanoAfrica');
}

function testRewriteChangesOnlyIntendedFields() {
  const before = sample('\n');
  const { text } = assignCatalogToHouseStore(before);
  assertOnlyIntendedChanges(before, text);

  const tampered = text.replace('"storeCity": "Bonapriso, Douala"', '"storeCity": "Paris"');
  assert.throws(() => assertOnlyIntendedChanges(before, tampered), /storeCity changed/);
}

function testNoDescriptionCreditsAnOldMerchant() {
  for (const p of Object.values(catalogProducts)) {
    for (const merchant of OLD_MERCHANTS) {
      const credited = new RegExp(`\\b(par|chez) ${merchant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u');
      assert.ok(!credited.test(p.description), `${p.id} description still credits ${merchant}`);
    }
  }
}

async function run() {
  testEveryProductBelongsToTheHouseStore();
  testShippedFileIsAlreadyAssigned();
  testRewriteHandlesLfAndCrlf();
  testRewriteOnlyTouchesTheSellerPosition();
  testRewriteChangesOnlyIntendedFields();
  testNoDescriptionCreditsAnOldMerchant();
  console.log('catalog_house_store: 6 checks passed');
}

if (require.main === module) {
  run().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
