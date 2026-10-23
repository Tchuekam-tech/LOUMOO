/**
 * LOUMOO — the product page reads the product it is showing
 * ---------------------------------------------------------------------------
 * The product page's bindings were defined twice in the view props and the
 * later copy won. It read only the curated-catalogue shape, so for a seller's
 * product from the API (merchant / merchantCity / verified, attributes as an
 * object, store { ... }):
 *   - every unverified store was shown with the verified badge,
 *   - a product without photos showed three MacBook pictures,
 *   - the specs never rendered (an object has no .length),
 *   - missing fields fell back to "Orca Electronics Douala" and "XAF 745 000".
 * The same duplication made the sign-out button skip emptying the bag.
 *
 * Drives the REAL compiled app (Commerce App.dc.html) in a sandbox.
 */

require('../setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadComponent() {
  const content = fs.readFileSync(path.resolve(__dirname, '../../Commerce App.dc.html'), 'utf8');
  const scriptMatch = content.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'Must find data-dc-script block');

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(fnOrObj) {
      this.state = typeof fnOrObj === 'function'
        ? Object.assign({}, this.state, fnOrObj(this.state))
        : Object.assign({}, this.state, fnOrObj);
    }
  }
  const context = {
    DCLogic,
    console,
    setTimeout: () => {}, clearTimeout: () => {}, setInterval: () => {}, clearInterval: () => {},
    Promise,
    localStorage: {
      store: {},
      getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; },
      setItem(k, v) { this.store[k] = String(v); },
      removeItem(k) { delete this.store[k]; }
    },
    document: { documentElement: { setAttribute: () => {} } }
  };
  vm.createContext(context);
  vm.runInContext(scriptMatch[1] + "\nvar comp = new Component({});", context);
  const comp = context.comp;
  comp.go = (screen) => { comp.state.screen = screen; };
  comp.toast = () => {};
  return { comp, context };
}

const plain = (v) => JSON.parse(JSON.stringify(v));

function show(comp, product) {
  comp.state.currentProduct = product;
  comp.state.currentProductId = product ? product.id : null;
  comp.state.currentProductActiveImage = null;
  return comp.renderVals();
}

const { comp, context } = loadComponent();

/* 1. A seller's product from the API, unverified store, no photos ------------ */
let v = show(comp, {
  id: 'lst_1',
  title: 'Samsung Galaxy A15',
  brand: 'Samsung',
  category: 'electronics',
  condition: 'used',
  fulfillmentModel: 'DELIVERY_OR_PICKUP',
  price: 'XAF 95 000',
  priceNumeric: 95000,
  salePrice: null,
  merchant: 'Boutique Akwa',
  storeName: 'Boutique Akwa',
  merchantCity: 'Douala',
  verified: false,
  rating: 4.2,
  reviewsCount: 3,
  soldCount: 0,
  images: [],
  attributes: { storage_gb: 128, colour: 'Black' },
  store: { name: 'Boutique Akwa', city: 'Douala', rating: 0, isVerified: false }
});
assert.strictEqual(v.productStoreVerified, false, 'an unverified store is not shown as verified');
assert.strictEqual(v.currentProductBadge, '', 'and gets no "VERIFIED BOUTIQUE" badge');
assert.deepStrictEqual(plain(v.currentProductImages), [], 'a product without photos shows none, not MacBook pictures');
assert.deepStrictEqual(plain(v.currentProductAttributesList), [
  { key: 'storage gb', val: '128' },
  { key: 'colour', val: 'Black' }
], 'object-shaped attributes render as specs');
assert.strictEqual(v.productStoreName, 'Boutique Akwa');
assert.strictEqual(v.productStoreCity, 'Douala');
assert.strictEqual(v.productStoreRating, '', 'an unrated store shows no rating');
assert.strictEqual(v.currentProductPrice, 'XAF 95 000');
assert.strictEqual(v.currentProductSalePrice, '');
assert.strictEqual(v.currentProductConditionLabel, 'Used', 'the condition is the product\'s, with no invented "SEALED"');
assert.strictEqual(v.currentProductFulfillmentLabel, 'Delivery or pickup');
assert.strictEqual(v.currentProductReviewCount, 3);
assert.strictEqual(v.currentProductRating, '4.2');

/* 2. A verified store's product, with photos and a sale price ---------------- */
v = show(comp, {
  id: 'lst_2', title: 'iPhone 15', price: 'XAF 700 000', salePrice: 'XAF 650 000',
  storeName: 'Apple Hub', verified: true, store: { name: 'Apple Hub', city: 'Yaoundé', rating: 4.8, isVerified: true },
  images: ['/a.jpg', '/b.jpg']
});
assert.strictEqual(v.productStoreVerified, true);
assert.strictEqual(v.currentProductBadge, 'VERIFIED BOUTIQUE', 'a verified store earns the badge');
assert.strictEqual(v.productStoreRating, '4.8');
assert.strictEqual(v.productStoreCity, 'Yaoundé');
assert.strictEqual(v.currentProductPrice, 'XAF 650 000', 'the buyer pays the lower price');
assert.strictEqual(v.currentProductSalePrice, 'XAF 700 000', 'and the higher one is struck through');
assert.deepStrictEqual(plain(v.currentProductImages), ['/a.jpg', '/b.jpg']);
assert.strictEqual(v.currentProductActiveImage, '/a.jpg');

/* 3. A curated catalogue item keeps working ---------------------------------- */
v = show(comp, {
  id: 'cur_1', title: 'Tecno Camon 50', storeName: 'NanoAfrica', storeCity: 'Akwa, Douala', storeRating: '4.9',
  storeVerified: true, badge: '-10% PROMO', conditionLabel: 'Neuf', fulfillmentLabel: 'Livraison 24h',
  categoryLabel: 'Smartphones', price: 'XAF 187.200', salePrice: 'XAF 208.000', reviewCount: 24, soldCount: 45,
  coverImage: '/cover.jfif', images: ['/cover.jfif'],
  attributes: [{ key: 'Réseau', val: '5G' }]
});
assert.strictEqual(v.productStoreName, 'NanoAfrica');
assert.strictEqual(v.productStoreCity, 'Akwa, Douala');
assert.strictEqual(v.productStoreRating, '4.9');
assert.strictEqual(v.productStoreVerified, true);
assert.strictEqual(v.currentProductBadge, '-10% PROMO');
assert.strictEqual(v.currentProductConditionLabel, 'Neuf');
assert.strictEqual(v.currentProductFulfillmentLabel, 'Livraison 24h');
assert.strictEqual(v.currentProductCategoryLabel, 'Smartphones');
assert.deepStrictEqual(plain(v.currentProductAttributesList), [{ key: 'Réseau', val: '5G' }]);
assert.strictEqual(v.currentProductPrice, 'XAF 187.200');
assert.strictEqual(v.currentProductReviewCount, 24);
assert.strictEqual(v.currentProductHasSold, true);

/* 4. No product: nothing is invented ----------------------------------------- */
v = show(comp, null);
assert.strictEqual(v.currentProductTitle, '', 'no demo title');
assert.strictEqual(v.currentProductPrice, '', 'no demo price');
assert.strictEqual(v.productStoreName, '', 'no demo store');
assert.deepStrictEqual(plain(v.currentProductImages), []);
assert.strictEqual(v.productStoreVerified, false);

/* 5. Signing out empties the bag (shared device) ----------------------------- */
comp.state.cartItems = [{ id: 'lst_1', qty: 1 }];
context.localStorage.setItem('loumoo_cart', JSON.stringify(comp.state.cartItems));
comp.renderVals().signOut();
assert.deepStrictEqual(plain(comp.state.cartItems), [], 'the bag is emptied on sign-out');
assert.strictEqual(context.localStorage.getItem('loumoo_cart'), null, 'and so is its saved copy');

/* 6. The seller's own boutique card does not call every store verified ------ */
comp.state.store = { id: 'store_1', name: 'Akwa Phones', categoryId: 'electronics', isVerified: false };
assert.strictEqual(comp.renderVals().currentStoreIsVerified, false, 'an unverified boutique is not told it is verified');
comp.state.store = { id: 'store_1', name: 'Akwa Phones', categoryId: 'electronics', is_verified: true };
assert.strictEqual(comp.renderVals().currentStoreIsVerified, true);

/* 7. A listing whose store record did not load is not advertised as verified -- */
const CatalogRepository = require('../../server/modules/catalog/infrastructure/CatalogRepository');
const card = CatalogRepository._formatProductCard({ id: 'lst_9', title: 'Radio', base_price_minor: 5000, store_id: 'store_x' }, null, null, []);
assert.strictEqual(card.verified, false, 'no store record, no verified badge');
assert.ok(!/verified/i.test(card.storeName), `and no "verified" store name: ${card.storeName}`);

/* 8. A card reports the seller's real stock, not an invented 1000 ------------ */
const soldOut = CatalogRepository._formatProductCard({ id: 'lst_10', title: 'Lamp', base_price_minor: 5000 }, null, null, [],
  { track_inventory: true, on_hand: 3, reserved: 3, allow_backorder: false });
assert.strictEqual(soldOut.inStock, false, 'every unit held by open orders: out of stock');
assert.strictEqual(soldOut.stockUnits, 0);
const someLeft = CatalogRepository._formatProductCard({ id: 'lst_11', title: 'Lamp', base_price_minor: 5000 }, null, null, [],
  { track_inventory: true, on_hand: 5, reserved: 2, allow_backorder: false });
assert.deepStrictEqual([someLeft.inStock, someLeft.stockUnits, someLeft.stockKnown], [true, 3, true]);
const untracked = CatalogRepository._formatProductCard({ id: 'lst_12', title: 'Lamp', base_price_minor: 5000 }, null, null, [], null);
assert.deepStrictEqual([untracked.inStock, untracked.stockUnits, untracked.stockKnown], [true, null, false], 'untracked: available, count unknown');

/* 9. An unrated listing has no rating, not five stars ----------------------- */
assert.strictEqual(untracked.rating, null, 'no reviews, no rating');
const rated = CatalogRepository._formatProductCard({ id: 'lst_13', title: 'Lamp', base_price_minor: 5000, rating: 4.4, rating_count: 7 }, null, null, [], null);
assert.strictEqual(rated.rating, 4.4);

console.log('product_page_view: API and curated products, no invented store/price/photos/badge, sign-out empties the bag');
process.exit(0);
