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
 *     and say the item isn't available to order (an id the shell does not hold
 *     is asked of the API first: a compare offer can be a listing never loaded);
 *   - a curated id and a live listing (even one opened by its slug from a link)
 *     are still added, at their own price, under their own id;
 *   - an id is matched exactly, never by substring or title;
 *   - a 404 from the API is a not-found page (the router's, when it runs);
 *     any other failure is the retryable error state; neither is a product;
 *   - a late answer for a product the buyer already left changes nothing;
 *   - a bag saved before the fix is re-checked once the catalogue is in: a
 *     placeholder line for an id with no product is kept but marked unavailable,
 *     out of the total and the order; a real product saved at a placeholder
 *     price gets its real price; offline or no API changes nothing.
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
      Notification: { permission: 'default' },
      LoumooCircuit: require('../../src/services/deliveryCircuit')
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

async function testSeedIdIsRefusedByAddToBag() {
  const api = fakeApi();
  const { comp, toasts } = buildApp({ current: api });
  comp.setState({ screen: 'home', cartItems: [] });
  comp.renderVals().addToCart(SEED);
  await sleep(5);
  assert.deepStrictEqual(api.calls, [SEED], 'an id the shell does not hold is asked of the API');
  assert.strictEqual(comp.state.cartItems.length, 0, 'nothing is put in the bag for a demo seed id');
  assert.ok(NOT_AVAILABLE.test(toasts[toasts.length - 1] || ''), 'and the buyer is told it is not available to order');
  assert.ok(!toasts.some((t) => /Added/i.test(t)), 'never "Added ... to your bag"');
}

async function testUnknownIdIsRefusedEvenIfAStaleLineExists() {
  // A bag restored from before this fix may hold a placeholder line for the seed id.
  const { comp, toasts } = buildApp({ current: fakeApi() });
  const stale = { id: SEED, name: 'Elec Macbook Pro', price: 'XAF 85.000', priceXaf: 85000, qty: 1 };
  comp.setState({ screen: 'home', cartItems: [stale] });
  comp.renderVals().addToCart(SEED);
  await sleep(5);
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

async function testCompareOfferForAListingNeverLoadedIsAdded() {
  // Comparison v2's "Where to buy" adds the exact listing behind an offer; a
  // seller's database listing need not be in any rail the shell has loaded.
  const api = fakeApi({ LIVE });
  const { comp, toasts } = buildApp({ current: api });
  comp.setState({ screen: 'vsCompare', cartItems: [], catalogProducts: [] });
  comp.renderVals().addToCart(LIVE.id);
  await sleep(5);
  assert.deepStrictEqual(api.calls, [LIVE.id], 'the API is asked about it');
  assert.strictEqual(comp.state.cartItems.length, 1, 'and the real listing goes in the bag');
  assert.strictEqual(comp.state.cartItems[0].id, LIVE.id);
  assert.strictEqual(comp.state.cartItems[0].priceXaf, 185000, 'at its own price');
  assert.ok(/Added Sac Cuir Sahel/.test(toasts[toasts.length - 1]));
}

async function testOfflineAddSaysSoAndAddsNothing() {
  const api = fakeApi();
  api.failWith = 0;
  const { comp, toasts } = buildApp({ current: api });
  comp.setState({ screen: 'vsCompare', cartItems: [] });
  comp.renderVals().addToCart(LIVE.id);
  await sleep(5);
  assert.strictEqual(comp.state.cartItems.length, 0, 'nothing is added while offline');
  assert.ok(/connection/i.test(toasts[toasts.length - 1] || ''), 'and the buyer is told why, not that it does not exist');
}

function testNoApiRefusesAtOnce() {
  const { comp, toasts } = buildApp({ current: null });
  comp.setState({ screen: 'home', cartItems: [] });
  comp.renderVals().addToCart(SEED);
  assert.strictEqual(comp.state.cartItems.length, 0);
  assert.ok(NOT_AVAILABLE.test(toasts[toasts.length - 1] || ''), 'with no API there is nothing to ask');
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

// ── A bag saved before the fix ──────────────────────────────────────────────

// What an older build put in the bag for the seed id: a made-up line.
const PLACEHOLDER = { id: SEED, name: 'Elec Macbook Pro', price: 'XAF 85.000', priceXaf: 85000, store: 'Apple · Boutique Officielle', qty: 1 };
const ADDRESS = { id: 'a1', isDefault: true, recipientName: 'Awa Njoya', phoneNumber: '622222222', streetAddress: 'Rue 1, Bonanjo', city: 'Douala' };

async function testPlaceholderLineIsMarkedUnavailable() {
  const api = fakeApi();
  const { comp } = buildApp({ current: api });
  comp.setState({ cartItems: [Object.assign({}, PLACEHOLDER)] });
  comp._recheckCartLines();
  await sleep(5);
  assert.deepStrictEqual(api.calls, [SEED], 'an id the catalogue lacks is asked of the API');
  assert.strictEqual(comp.state.cartItems.length, 1, 'the line is kept, not silently deleted');
  assert.strictEqual(comp.state.cartItems[0].unavailable, true, 'and marked unavailable after the 404');
  const vals = comp.renderVals();
  assert.strictEqual(vals.cartItemsList[0].unavailable, true, 'the bag shows it as unavailable');
  assert.strictEqual(vals.cartItemsList[0].lineLabel, 'Unavailable', 'without its made-up price');
  assert.strictEqual(vals.cartSubtotalLabel, 'XAF 0', 'and it is not in the total');
  assert.ok(!/85[ .,]?000/.test(vals.cartTotal), 'the 85,000 is gone from what the buyer is told');
}

async function testRecheckIsPersistedAndRunsOnce() {
  const api = fakeApi();
  const { comp, sandbox } = buildApp({ current: api });
  comp.setState({ cartItems: [Object.assign({}, PLACEHOLDER)] });
  comp._recheckCartLines();
  await sleep(5);
  const stored = JSON.parse(sandbox.localStorage.getItem('loumoo_cart'));
  assert.strictEqual(stored[0].unavailable, true, 'the mark is saved with the bag');
  comp._recheckCartLines();
  await sleep(5);
  assert.strictEqual(api.calls.length, 1, 'a second call in the same load asks nothing');
}

async function testRealProductAtAPlaceholderPriceGetsItsPrice() {
  // Added before the catalogue had loaded: a real id, priced by the old fallback.
  const api = fakeApi();
  const { comp } = buildApp({ current: api });
  comp.setState({ cartItems: [{ id: CURATED, name: 'Laptop Apple Apple Macbook Pro 14 M3 Pro Gris 2', price: 'XAF 85.000', priceXaf: 85000, store: 'Apple · Boutique Officielle', qty: 2 }] });
  comp._recheckCartLines();
  await sleep(5);
  const line = comp.state.cartItems[0];
  assert.strictEqual(api.calls.length, 0, 'a curated id is checked against the catalogue, not the API');
  assert.strictEqual(line.unavailable, undefined, 'it is orderable');
  assert.strictEqual(line.priceXaf, 1395000, 'at its real price');
  assert.ok(/MacBook Pro/.test(line.name), 'under its real name');
  assert.strictEqual(line.qty, 2, 'and the quantity the buyer chose');
}

async function testLiveListingNotInTheCatalogueIsKept() {
  const api = fakeApi({ LIVE });
  const { comp } = buildApp({ current: api });
  comp.setState({ cartItems: [{ id: LIVE.id, name: 'Sac', price: '185 000 FCFA', priceXaf: 185000, store: 'Sahel Leather Works', qty: 1 }] });
  comp._recheckCartLines();
  await sleep(5);
  assert.deepStrictEqual(api.calls, [LIVE.id]);
  assert.strictEqual(comp.state.cartItems[0].unavailable, undefined, 'a listing the API still has stays orderable');
  assert.strictEqual(comp.state.cartItems[0].name, LIVE.title);
}

async function testOfflineOrNoApiDecidesNothing() {
  const api = fakeApi();
  api.failWith = 0;
  const offline = buildApp({ current: api }).comp;
  offline.setState({ cartItems: [Object.assign({}, PLACEHOLDER)] });
  offline._recheckCartLines();
  await sleep(5);
  assert.strictEqual(offline.state.cartItems[0].unavailable, undefined, 'offline is not "gone"');

  const noApi = buildApp({ current: null }).comp;
  noApi.setState({ cartItems: [Object.assign({}, PLACEHOLDER)] });
  noApi._recheckCartLines();
  await sleep(5);
  assert.strictEqual(noApi.state.cartItems[0].unavailable, undefined, 'nor is a missing API client');
}

function testUnpricedSavedLineIsUnavailableWithoutAsking() {
  const api = fakeApi();
  const { comp, sandbox } = buildApp({ current: api });
  sandbox.window.PRODUCTS_DATA.na_free_thing = { id: 'na_free_thing', title: 'Free thing', price: '', salePrice: '' };
  comp.setState({ cartItems: [{ id: 'na_free_thing', name: 'Free thing', priceXaf: 85000, qty: 1 }] });
  comp._recheckCartLines();
  assert.strictEqual(comp.state.cartItems[0].unavailable, true, 'a product with no price cannot be ordered');
  assert.strictEqual(api.calls.length, 0, 'and the catalogue already says so');
}

async function testOrderLeavesUnavailableLinesOut() {
  const api = fakeApi();
  const payloads = [];
  api.createOrder = async (payload) => {
    payloads.push(JSON.parse(JSON.stringify(payload)));
    return { id: 'ord_1', orderNumber: 'KM-T-1', items: payload.items, subtotalXaf: 0, shippingFeeXaf: 0, totalAmountXaf: 0, paymentStatus: 'pending', fulfillmentStatus: 'processing', createdAt: new Date().toISOString() };
  };
  api.getOrders = async () => ({ orders: [], total: 0 });
  api.getNotifications = async () => [];
  const { comp } = buildApp({ current: api });
  comp.setState({ authStatus: 'authenticated', addressesList: [ADDRESS], screen: 'checkout', cartItems: [
    Object.assign({}, PLACEHOLDER, { unavailable: true }),
    { id: CURATED, name: 'MacBook Pro', price: 'XAF 1.395.000', priceXaf: 1395000, store: 'NanoAfrica', qty: 1 }
  ] });
  comp.renderVals().placeOrder();
  await sleep(20);
  assert.strictEqual(payloads.length, 1, 'one order is placed');
  assert.deepStrictEqual(payloads[0].items.map((it) => it.listingId), [CURATED], 'with only the orderable line');
  assert.deepStrictEqual(comp.state.cartItems.map((it) => it.id), [SEED], 'the unavailable line is left in the bag to remove');
}

function testOnlyUnavailableLinesPlaceNothing() {
  const api = fakeApi();
  let sent = 0;
  api.createOrder = async () => { sent += 1; return null; };
  const { comp } = buildApp({ current: api });
  comp.setState({ authStatus: 'guest', screen: 'checkout', cartItems: [Object.assign({}, PLACEHOLDER, { unavailable: true })] });
  comp.renderVals().placeOrder();
  assert.strictEqual(sent, 0, 'nothing is sent');
  assert.strictEqual(comp.state.screen, 'checkout', 'a guest is not sent to sign in for nothing');
  assert.ok(/Remove the unavailable items/.test(comp.state.orderError), 'the buyer is told why');
  assert.deepStrictEqual(Array.from(comp.state.orderErrorItemIds), [SEED], 'and offered to remove them');
  comp.renderVals().removeUnavailableItems();
  assert.strictEqual(comp.state.cartItems.length, 0, '"Remove them from my bag" empties it');
}

function testAddingTheProductAgainRevivesItsLine() {
  const { comp } = buildApp({ current: fakeApi() });
  comp.setState({ screen: 'home', cartItems: [{ id: CURATED, name: 'old', price: 'XAF 85.000', priceXaf: 85000, store: 'x', qty: 1, unavailable: true }] });
  comp.renderVals().addToCart(CURATED);
  const line = comp.state.cartItems[0];
  assert.strictEqual(comp.state.cartItems.length, 1);
  assert.strictEqual(line.unavailable, undefined, 'a product that can be ordered clears the mark');
  assert.strictEqual(line.priceXaf, 1395000, 'and its line takes the real price');
  assert.strictEqual(line.qty, 2);
}

function testCatalogueSettledRunsTheCheck() {
  const { comp } = buildApp({ current: fakeApi() });
  let ran = 0;
  comp._ensureCatalogData(() => { ran += 1; });
  assert.strictEqual(ran, 1, 'with the catalogue already in, the callback runs at once');
}

(async () => {
  await testSeedIdIsRefusedByAddToBag();
  await testUnknownIdIsRefusedEvenIfAStaleLineExists();
  testUnpricedProductIsRefused();
  testCuratedIdIsAddedAtItsOwnPrice();
  testBuyNowRefusesASeedIdAndStaysPut();
  await testLiveListingOpenedBySlugIsAddedUnderItsId();
  await testCompareOfferForAListingNeverLoadedIsAdded();
  await testOfflineAddSaysSoAndAddsNothing();
  testNoApiRefusesAtOnce();
  testIdsAreMatchedExactly();
  await testUnknownProductIsNotFound();
  await testFailureIsTheRetryState();
  testNoApiIsTheRetryState();
  await testLateAnswerForAnotherProductIsIgnored();
  await testPlaceholderLineIsMarkedUnavailable();
  await testRecheckIsPersistedAndRunsOnce();
  await testRealProductAtAPlaceholderPriceGetsItsPrice();
  await testLiveListingNotInTheCatalogueIsKept();
  await testOfflineOrNoApiDecidesNothing();
  testUnpricedSavedLineIsUnavailableWithoutAsking();
  await testOrderLeavesUnavailableLinesOut();
  testOnlyUnavailableLinesPlaceNothing();
  testAddingTheProductAgainRevivesItsLine();
  testCatalogueSettledRunsTheCheck();
  console.log('no_fabricated_products: 24 checks passed');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
