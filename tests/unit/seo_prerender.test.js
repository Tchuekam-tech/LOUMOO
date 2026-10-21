/**
 * LOUMOO — per-route SEO head + on-the-fly prerender (Priority 2, items 5-7).
 * ---------------------------------------------------------------------------
 * Hermetic: injects into a tiny shell string and stubs the product/store repos,
 * so it needs no database. Proves:
 *   - public pages: full indexable head (title/description/canonical/OG/Twitter)
 *     + a content block, the static <title> replaced, and CDN-cacheable;
 *   - private pages: noindex, not cacheable;
 *   - unknown routes AND unknown products/stores: a real 404 (no 200 soft-404);
 *   - a DB error degrades to a route-level 200 (never a false 404);
 *   - product/store pages carry entity-level OG + JSON-LD;
 *   - inject() is idempotent (re-rendering never duplicates the head/content).
 */

require('../setup');
const assert = require('assert');

const PrerenderService = require('../../server/modules/system/seo/PrerenderService');
const CatalogRepository = require('../../server/modules/catalog/infrastructure/CatalogRepository');
const StoreRepository = require('../../server/modules/store/infrastructure/StoreRepository');

const SHELL = '<!doctype html><html><head><title>Static Shell Title</title><base href="/"></head><body>\n<x-dc></x-dc>\n</body></html>';
const SITE = 'https://loumoo.store';

const render = (url) => PrerenderService.renderPage({ url, shellHtml: SHELL, siteUrl: SITE });

async function run() {
  /* 1. Public static route: full indexable head + content, one <title>. */
  let r = await render('/stores');
  assert.strictEqual(r.status, 200, '/stores is 200');
  assert.ok(r.html.includes('<meta name="robots" content="index,follow"'), '/stores is index,follow');
  assert.ok(r.html.includes('<link rel="canonical" href="https://loumoo.store/stores"'), '/stores canonical is absolute');
  assert.ok(r.html.includes('property="og:title"') && r.html.includes('name="twitter:card"'), '/stores has OG + Twitter');
  assert.ok(r.html.includes('<meta name="description"'), '/stores has a description');
  assert.ok(r.html.includes('id="loumoo-prerender"'), '/stores has a content block');
  assert.ok(!r.html.includes('Static Shell Title'), 'the static <title> is replaced');
  assert.strictEqual((r.html.match(/<title>/g) || []).length, 1, 'exactly one <title>');
  assert.ok(r.cacheable, 'a public indexable page is CDN-cacheable');

  /* 2. Private route: noindex, not cacheable. */
  r = await render('/account');
  assert.strictEqual(r.status, 200, '/account resolves to a route (200 shell)');
  assert.ok(/content="noindex/.test(r.html), '/account is noindex');
  assert.ok(!r.cacheable, 'a private page is not CDN-cacheable');

  /* 3. Unknown route: a real 404 + noindex (no 200 soft-404). */
  r = await render('/definitely-not-a-route-xyz');
  assert.strictEqual(r.status, 404, 'an unknown route is a real 404');
  assert.ok(/content="noindex/.test(r.html), 'a 404 is noindex');

  const origP = CatalogRepository.findIndexableProductByIdOrSlug;
  const origS = StoreRepository.findByIdOrSlug;

  /* 4. Product found: 200 + product OG + JSON-LD Product with an offer. */
  CatalogRepository.findIndexableProductByIdOrSlug = async () => ({
    id: 'p1', title: 'Test Phone', description: 'A great phone', priceNumeric: 120000,
    currency: 'XAF', image: '/Assets/x.jpg', brand: 'TestBrand', inStock: true,
    rating: 4.8, reviewsCount: 12, store: { name: 'Test Store' }
  });
  try {
    r = await render('/product/p1');
    assert.strictEqual(r.status, 200, 'a real product is 200');
    assert.ok(r.html.includes('property="og:type" content="product"'), 'product og:type');
    assert.ok(r.html.includes('"@type":"Product"'), 'product JSON-LD');
    assert.ok(r.html.includes('"priceCurrency":"XAF"'), 'JSON-LD offer currency');
    assert.ok(r.html.includes('Test Phone'), 'product title appears');
    assert.ok(r.cacheable, 'a public product page is cacheable');
  } finally { CatalogRepository.findIndexableProductByIdOrSlug = origP; }

  /* 5. Product NOT found: a real 404 (the soft-404 fix, item 9's SEO side). */
  CatalogRepository.findIndexableProductByIdOrSlug = async () => null;
  try {
    r = await render('/product/does-not-exist');
    assert.strictEqual(r.status, 404, 'an unknown product is a real 404, not a 200 soft-404');
    assert.ok(/content="noindex/.test(r.html), 'an unknown product is noindex');
  } finally { CatalogRepository.findIndexableProductByIdOrSlug = origP; }

  /* 6. Product DB error: degrade to a route-level 200, never a false 404. */
  CatalogRepository.findIndexableProductByIdOrSlug = async () => { throw new Error('db down'); };
  try {
    r = await render('/product/p1');
    assert.strictEqual(r.status, 200, 'a DB error degrades to a route-level 200');
  } finally { CatalogRepository.findIndexableProductByIdOrSlug = origP; }

  /* 7. Store found (ACTIVE/PUBLIC): 200 + Store JSON-LD. */
  StoreRepository.findByIdOrSlug = async () => ({
    name: 'Acme Boutique', slug: 'acme', description: 'Trusted seller',
    status: 'ACTIVE', visibility: 'PUBLIC', logo_url: '/Assets/logo.png'
  });
  try {
    r = await render('/store/acme');
    assert.strictEqual(r.status, 200, 'an active store is 200');
    assert.ok(r.html.includes('"@type":"Store"'), 'store JSON-LD');
    assert.ok(r.html.includes('Acme Boutique'), 'store name appears');
  } finally { StoreRepository.findByIdOrSlug = origS; }

  /* 8. Non-active store: a real 404. */
  StoreRepository.findByIdOrSlug = async () => ({ name: 'Draft', slug: 'd', status: 'DRAFT' });
  try {
    r = await render('/store/draft');
    assert.strictEqual(r.status, 404, 'a non-active store is a real 404');
  } finally { StoreRepository.findByIdOrSlug = origS; }

  /* 9. inject() is idempotent: re-rendering an already-injected shell keeps one of each. */
  const base = (await render('/stores')).html;
  const again = PrerenderService.inject(base, '<meta name="description" content="again" data-loumoo-seo="1">', '<div id="loumoo-prerender">\nagain\n</div>');
  assert.strictEqual((again.match(/<!-- loumoo:seo:start -->/g) || []).length, 1, 'exactly one head block after re-inject');
  assert.strictEqual((again.match(/id="loumoo-prerender"/g) || []).length, 1, 'exactly one content block after re-inject');

  console.log('seo_prerender: all assertions passed');
}

module.exports = { run };

if (require.main === module) {
  run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
