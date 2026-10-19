/**
 * LOUMOO Unit Tests - The shell never invents a product or a price
 * ---------------------------------------------------------------------------
 * Drives the REAL compiled app (Commerce App.dc.html) in a sandbox with the
 * curated catalogue loaded and a fake API. The shell used to turn any id it did
 * not know into a synthesised in-stock listing at XAF 85.000: a seed demo id such
 * as `elec-macbook-pro` went into the bag as "Elec Macbook Pro" at 85,000 for a
 * laptop that sells for 1.25M, and the product page could never show not-found.
 * What must hold now:
 *
 *   - Add to bag / Buy now refuse an unknown or unpriced id, leave the bag alone
 *     and say the item isn't available to order;
 *   - a curated id and a live listing (even one opened by its slug from a link)
 *     are still added, at their own price, under their own id;
 *   - an id is matched exactly, never by substring or title;
 *   - a 404 from the API is a not-found page (the router's, when it runs);
 *     any other failure is the retryable error state; neither is a product;
 *   - a late answer for a product the buyer already left changes nothing.
 */

require('../setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const CURATED = 'laptop_apple_apple_macbook_pro_14_m3_pro_gris_2';
const SEED = 'elec-macbook-pro';
const NOT_AVAILABLE = /isn.t available to order/i;

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function buildApp(apiRef, routerRef = { current: null }) {
  const html = fs.readFileSync(path.join(ROOT, 'Commerce App.dc.html'), 'utf8');
  const match = html.match(/<script\s+type=["']text\/x-dc["'][^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'Commerce App.dc.html must contain the app script');

  const toasts = [];
  const sandbox = {
    console, Math, Date, JSON, Promise, String, Number, Boolean, Array, Object, RegExp, Error, Set, Map,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat,
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    document: {
      documentElement: { setAttribute: () => {} },
      body: {},
      hidden: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById: () => ({ click: () => {}, scrollBy: () => {} }),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ click: () => {}, files: [] })
    },
    window: {
      location: { href: 'http://localhost:3000' },
      open: () => ({}),
      addEventListener: () => {},
      removeEventListener: () => {},
      Notification: { permission: 'default' }
    },
    localStorage: {
      _data: {},
      getItem(k) { return this._data[k] || null; },
      setItem(k, v) { this._data[k] = String(v); },
      removeItem(k) { delete this._data[k]; },
      clear() { this._data = {}; }
    },
    DCLogic: class {
      constructor() { this.state = {}; this.props = {}; }
      setState(updater, cb) {
        this.state = Object.assign({}, this.state, typeof updater === 'function' ? updater(this.state) : updater);
        if (cb) cb();
      }
    },
    getClerk: () => null,
    getGuard: () => null,
    friendlyError: (e) => (e && e.message) || String(e)
  };
  // The app's own getApi() / getRouter() read window.LoumooAPI / window.LoumooRouter.
  Object.defineProperty(sandbox.window, 'LoumooAPI', { get: () => apiRef.current, configurable: true });
  Object.defineProperty(sandbox.window, 'LoumooRouter', { get: () => routerRef.current, configurable: true });
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/data/catalog_products_bundle.js'), 'utf8'), sandbox);
  assert.ok(sandbox.window.PRODUCTS_DATA[CURATED], 'the curated catalogue is loaded');
  vm.runInContext(match[1] + '\nvar comp = new Component();', sandbox);
  const comp = sandbox.comp;
  assert.ok(comp, 'the app component builds');
  comp.toast = (m) => toasts.push(m);
  comp._unmounted = false;
  return { comp, toasts, sandbox };
}

/** A fake API whose getProduct answers from `listings`, or fails as told. */
function fakeApi(listings = {}) {
  const api = { calls: [], failWith: null, pending: {} };
  api.getProduct = (id) => {
    api.calls.push(id);
    if (api.pending[id]) return api.pending[id].promise;
    if (api.failWith != null) {
      const err = new Error(api.failWith === 0 ? 'Cannot reach LOUMOO. Check your connection and try again.' : 'Listing not found');
      err.status = api.failWith;
      return Promise.reject(err);
    }
    const hit = Object.values(listings).find((l) => l.id === id || l.slug === id);
    if (!hit) {
      const err = new Error(`Product with id '${id}' was not found`);
      err.status = 404;
      return Promise.reject(err);
    }
    return Promise.resolve(hit);
  };
  /** Make getProduct(id) wait until the test settles it. */
  api.hold = (id) => {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    api.pending[id] = { promise, resolve, reject };
    return api.pending[id];
  };
  return api;
}

const LIVE = {
  id: 'lst_live_1', slug: 'sac-cuir-sahel', title: 'Sac Cuir Sahel', price: '185 000 FCFA', priceNumeric: 185000,
  storeName: 'Sahel Leather Works', coverImage: 'bag.jpg'
};

// ── The bag ────────────────────────────────────────────────────────────────

function testSeedIdIsRefusedByAddToBag() {
  const { comp, toasts } = buildApp({ current: fakeApi() });
  comp.setState({ screen: 'home', cartItems: [] });
  comp.renderVals().addToCart(SEED);
  assert.strictEqual(comp.state.cartItems.length, 0, 'nothing is put in the bag for a demo seed id');
  assert.ok(NOT_AVAILABLE.test(toasts[toasts.length - 1] || ''), 'and the buyer is told it is not available to order');
  assert.ok(!toasts.some((t) => /Added/i.test(t)), 'never "Added ... to your bag"');
}

function testUnknownIdIsRefusedEvenIfAStaleLineExists() {
  // A bag restored from before this fix may hold a placeholder line for the seed id.
  const { comp, toasts } = buildApp({ current: fakeApi() });
  const stale = { id: SEED, name: 'Elec Macbook Pro', price: 'XAF 85.000', priceXaf: 85000, qty: 1 };
  comp.setState({ screen: 'home', cartItems: [stale] });
  comp.renderVals().addToCart(SEED);
  assert.strictEqual(comp.state.cartItems[0].qty, 1, 'the placeholder line is not topped up');
  assert.ok(NOT_AVAILABLE.test(toasts[toasts.length - 1] || ''));
}

function testUnpricedProductIsRefused() {
  const { comp, toasts, sandbox } = buildApp({ current: fakeApi() });
  sandbox.window.PRODUCTS_DATA.na_free_thing = { id: 'na_free_thing', title: 'Free thing', price: '', salePrice: '' };
  comp.setState({ screen: 'home', cartItems: [] });
  comp.renderVals().addToCart('na_free_thing');
  assert.strictEqual(comp.state.cartItems.length, 0, 'a product with no price is not orderable');
  assert.ok(NOT_AVAILABLE.test(toasts[toasts.length - 1] || ''));
}

function testCuratedIdIsAddedAtItsOwnPrice() {
  const { comp, toasts } = buildApp({ current: fakeApi() });
  comp.setState({ screen: 'home', cartItems: [] });
  comp.renderVals().addToCart(CURATED);
  assert.strictEqual(comp.state.cartItems.length, 1);
  const line = comp.state.cartItems[0];
  assert.strictEqual(line.id, CURATED);
  assert.strictEqual(line.priceXaf, 1395000, 'the MacBook Pro goes in at 1,395,000, not 85,000');
  assert.ok(/MacBook Pro/i.test(line.name));
  assert.ok(/Added/.test(toasts[toasts.length - 1]));
}

function testBuyNowRefusesASeedIdAndStaysPut() {
  const { comp, toasts } = buildApp({ current: fakeApi() });
  comp.setState({ screen: 'product', currentProductId: SEED, currentProduct: null, cartItems: [], qty: 1 });
  comp.renderVals().buyNowProduct();
  assert.strictEqual(comp.state.cartItems.length, 0, 'Buy now adds nothing');
  assert.strictEqual(comp.state.screen, 'product', 'and does not jump to checkout');
  assert.ok(NOT_AVAILABLE.test(toasts[toasts.length - 1] || ''));
}

async function testLiveListingOpenedBySlugIsAddedUnderItsId() {
  const { comp } = buildApp({ current: fakeApi({ LIVE }) });
  comp.setState({ cartItems: [], catalogProducts: [] });
  comp.openProduct(LIVE.slug);
  await sleep(5);
  assert.strictEqual(comp.state.currentProduct && comp.state.currentProduct.id, LIVE.id, 'the listing is fetched by its slug');
  comp.renderVals().addToCart();
  assert.strictEqual(comp.state.cartItems.length, 1, 'the open live listing can be added');
  assert.strictEqual(comp.state.cartItems[0].id, LIVE.id, 'under the id checkout looks up, not the slug');
  assert.strictEqual(comp.state.cartItems[0].priceXaf, 185000);
}

// ── Resolving an id ─────────────────────────────────────────────────────────

function testIdsAreMatchedExactly() {
  const { comp } = buildApp({ current: fakeApi() });
  assert.strictEqual(comp._resolveProductItem(SEED), null, 'a demo seed id is not a product');
  assert.strictEqual(comp._resolveProductItem('macbook'), null, 'nor is a word of a title');
  assert.strictEqual(comp._resolveProductItem(CURATED.slice(0, -4)), null, 'nor a truncated id');
  assert.strictEqual(comp._resolveProductItem(CURATED.replace(/_/g, '-')), null, 'nor the id with other separators');
  assert.ok(comp._resolveProductItem(CURATED), 'the exact id resolves');
  assert.deepStrictEqual(Object.keys(comp._resolveProduct(SEED)), [], '_resolveProduct answers {} for an unknown id');
  assert.strictEqual(comp._cartEntry(SEED), null, '_cartEntry builds no line for it');
  assert.strictEqual(typeof comp._synthesizeAvailableListing, 'undefined', 'the synthesiser is gone');
}

// ── The product page ────────────────────────────────────────────────────────

async function testUnknownProductIsNotFound() {
  const routerCalls = [];
  const router = { isActive: () => true, notFound: (info) => routerCalls.push(info), syncFromState: () => {} };
  const { comp } = buildApp({ current: fakeApi() }, { current: router });
  comp.openProduct('does-not-exist');
  assert.strictEqual(comp.state.productLoading, true, 'an id the shell does not hold is asked of the API');
  await sleep(5);
  assert.strictEqual(comp.state.productNotFound, true, 'a 404 is not-found');
  assert.strictEqual(comp.state.currentProduct, null, 'with no stand-in product');
  assert.strictEqual(comp.state.productLoading, false);
  assert.strictEqual(routerCalls.length, 1, 'the router is told, so it shows its not-found screen');
  assert.strictEqual(routerCalls[0].resource, 'product');
}

async function testFailureIsTheRetryState() {
  const api = fakeApi();
  api.failWith = 0;
  const { comp } = buildApp({ current: api });
  comp.openProduct('lst_maybe_real');
  await sleep(5);
  assert.strictEqual(comp.state.productNotFound, false, 'offline is not "not found"');
  assert.ok(/connection/i.test(comp.state.productError), 'it is the retryable error state');
  assert.strictEqual(comp.state.currentProduct, null, 'with no stand-in product');
}

function testNoApiIsTheRetryState() {
  const { comp } = buildApp({ current: null });
  comp.openProduct('lst_maybe_real');
  assert.strictEqual(comp.state.productNotFound, false);
  assert.ok(comp.state.productError, 'without an API client the page says it could not load');
  assert.strictEqual(comp.state.currentProduct, null);
}

async function testLateAnswerForAnotherProductIsIgnored() {
  const routerCalls = [];
  const router = { isActive: () => true, notFound: (info) => routerCalls.push(info), syncFromState: () => {} };
  const api = fakeApi();
  const held = api.hold('lst_slow');
  const { comp } = buildApp({ current: api }, { current: router });
  comp.openProduct('lst_slow');
  comp.openProduct(CURATED);
  const err = new Error('gone'); err.status = 404;
  held.reject(err);
  await sleep(5);
  assert.strictEqual(comp.state.currentProductId, CURATED, 'the buyer is on the product they opened last');
  assert.strictEqual(comp.state.productNotFound, false, 'the old 404 does not blank it');
  assert.strictEqual(routerCalls.length, 0, 'nor replace it with the not-found screen');
}

(async () => {
  testSeedIdIsRefusedByAddToBag();
  testUnknownIdIsRefusedEvenIfAStaleLineExists();
  testUnpricedProductIsRefused();
  testCuratedIdIsAddedAtItsOwnPrice();
  testBuyNowRefusesASeedIdAndStaysPut();
  await testLiveListingOpenedBySlugIsAddedUnderItsId();
  testIdsAreMatchedExactly();
  await testUnknownProductIsNotFound();
  await testFailureIsTheRetryState();
  testNoApiIsTheRetryState();
  await testLateAnswerForAnotherProductIsIgnored();
  console.log('no_fabricated_products: 11 checks passed');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
