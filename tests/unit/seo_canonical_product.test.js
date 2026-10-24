/**
 * LOUMOO Unit Tests — a product has one canonical URL, and a duplicate cannot compete with it
 * ---------------------------------------------------------------------------
 * The route resolves a product by its ID or its SLUG, so the curated catalogue's legacy id URLs
 * ("/product/phone_google_..._unlocke_17", the shape the sitemap used to list 972 times) are ID
 * lookups: aliases. The rule, applied to the real catalogue and the real gateway:
 *
 *   /product/<legacy id>                        301 -> /product/<the family's primary slug>, query kept
 *   /product/<slug of the primary>              200, index,follow, canonical = itself
 *   /product/<slug of another family member>    200, index,follow, canonical = the primary's slug
 *                                               (still openable: a visitor in the app may be on it;
 *                                               only one competes)
 *   a live listing (not curated)                unchanged: by id or slug, canonical = its slug
 *   unknown product / unregistered route        unchanged: a real 404 + noindex
 *
 * The canonical <link> must be in the HTML the server sends (what a crawler reads before it runs
 * any script), exactly once, inside the prerender block.
 */

require('../setup');
const assert = require('assert');
const http = require('http');

const FrontendRoutes = require('../../src/routing/routes');
const PrerenderService = require('../../server/modules/system/seo/PrerenderService');
const CatalogRepository = require('../../server/modules/catalog/infrastructure/CatalogRepository');
const StoreRepository = require('../../server/modules/store/infrastructure/StoreRepository');
const CuratedUrls = require('../../server/modules/catalog/domain/CuratedUrls');

const SITE = FrontendRoutes.ORIGIN;
const SHELL = '<!doctype html><html lang="en"><head><title>Shell</title></head><body>\n<x-dc></x-dc>\n</body></html>';
const render = (url) => PrerenderService.renderPage({ url, shellHtml: SHELL, siteUrl: SITE });
const attr = (html, re) => ((html.match(re) || [])[1] || '');
const canonicalOf = (html) => attr(html, /<link rel="canonical" href="([^"]+)"/);
const robotsOf = (html) => attr(html, /<meta name="robots" content="([^"]+)"/);

function get(server, method, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: headers || { 'sec-fetch-dest': 'document', accept: 'text/html' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log('  Testing the canonical URL of a product...');

  const index = CuratedUrls.defaultIndex();
  const PRIMARY_ID = 'phone_google_google_pixel_8_pro_128gb_unlocke';
  const REPEAT_ID = 'phone_google_google_pixel_8_pro_128gb_unlocke_17';
  const primary = index.resolve(PRIMARY_ID);
  const repeat = index.resolve(REPEAT_ID);
  assert.ok(primary && repeat && primary.isPrimary && !repeat.isPrimary && repeat.primaryId === PRIMARY_ID, 'fixture: the audit\'s phone, one primary and its repeat');
  const primaryPath = `/product/${primary.slug}`;
  const repeatPath = `/product/${repeat.slug}`;
  assert.notStrictEqual(primaryPath, repeatPath);

  /* ── the primary's page ─────────────────────────────────────────────── */
  let r = await render(primaryPath);
  assert.strictEqual(r.status, 200);
  assert.ok(!r.redirect, 'the primary\'s slug is a page, not a redirect');
  assert.strictEqual(robotsOf(r.html), 'index,follow', 'no noindex on a live product page');
  assert.strictEqual(canonicalOf(r.html), `${SITE}${primaryPath}`, 'canonical is itself, on the canonical host');
  assert.strictEqual((r.html.match(/<link rel="canonical"/g) || []).length, 1, 'exactly one canonical tag');
  assert.ok(r.html.indexOf('<!-- loumoo:seo:start -->') < r.html.indexOf('<link rel="canonical"') && r.html.indexOf('<link rel="canonical"') < r.html.indexOf('<!-- loumoo:seo:end -->') && r.html.indexOf('<!-- loumoo:seo:end -->') < r.html.indexOf('</head>'),
    'the canonical is in the <head> block the SERVER wrote, before any script runs');
  assert.ok(r.html.includes(`<meta property="og:url" content="${SITE}${primaryPath}"`), 'og:url agrees with the canonical');
  assert.ok(r.html.includes(`data-path="${primaryPath}"`), 'the crawlable content block records the path it was rendered for');
  assert.ok(/<h1>[^<]*Pixel 8 Pro[^<]*<\/h1>/.test(r.html), 'and carries the product itself');
  const ld = [...r.html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])).find((x) => x['@type'] === 'Product');
  assert.strictEqual(ld.url, `${SITE}${primaryPath}`, 'the Product structured data names the canonical URL');
  console.log(`    ✓ ${primaryPath}: 200, index,follow, canonical = itself, one tag, in the server-rendered <head>`);

  /* ── another member of the family ───────────────────────────────────── */
  r = await render(repeatPath);
  assert.strictEqual(r.status, 200, 'a repeat\'s slug still opens (a visitor in the app may be on it)');
  assert.strictEqual(robotsOf(r.html), 'index,follow', 'a canonical, not a noindex: the two must not contradict each other');
  assert.strictEqual(canonicalOf(r.html), `${SITE}${primaryPath}`, 'but it names the PRIMARY as its canonical, so it cannot compete');
  assert.ok(r.html.includes(`data-path="${repeatPath}"`), 'the block records the path it was rendered for (the router keeps the server head only on that path)');
  console.log('    ✓ a repeat\'s slug: 200, and its canonical is the primary');

  /* ── the legacy id URLs ─────────────────────────────────────────────── */
  for (const id of [PRIMARY_ID, REPEAT_ID, 'phone_google_google_pixel_8_pro_128gb_unlocke_2', 'shoe_kraasa_kraasa_bottines_chelsea_homme_mic_19']) {
    r = await render(`/product/${id}`);
    const want = CuratedUrls.canonicalPathFor(id);
    assert.deepStrictEqual(r.redirect, { status: 301, to: want }, `${id} -> 301 ${want}`);
    assert.strictEqual(r.html, '', 'a redirect has no document');
  }
  assert.strictEqual((await render(`/product/${REPEAT_ID}?utm_source=x`)).redirect.to, primaryPath, 'the renderer redirects by path; the gateway re-attaches the query (below)');
  console.log('    ✓ every legacy id URL is a 301 to its family\'s primary slug');

  /* ── 404s are unchanged ─────────────────────────────────────────────── */
  r = await render('/product/does-not-exist');
  assert.strictEqual(r.status, 404);
  assert.strictEqual(robotsOf(r.html), 'noindex,follow', 'an unknown product is a real 404 and noindex');
  assert.ok(!r.redirect);
  r = await render('/product/phone_google_google_pixel_8_pro_128gb_unlocke_999');
  assert.strictEqual(r.status, 404, 'an id that merely LOOKS like a repeat is not a product');
  console.log('    ✓ an unknown product, even one shaped like a legacy id, is still a 404 + noindex');

  /* ── a live listing keeps working as it did ─────────────────────────── */
  const origFind = CatalogRepository.findIndexableProductByIdOrSlug;
  CatalogRepository.findIndexableProductByIdOrSlug = async () => ({
    id: 'lst_123', slug: 'real-phone-ab12', title: 'Real Phone', priceNumeric: 100000, currency: 'XAF', category: 'electronics', store: { name: 'Real Store' }
  });
  try {
    r = await render('/product/lst_123');
    assert.strictEqual(r.status, 200);
    assert.ok(!r.redirect, 'a live listing opened by id is NOT redirected: only the curated aliases are');
    assert.strictEqual(canonicalOf(r.html), `${SITE}/product/real-phone-ab12`, 'its canonical is its slug');
    r = await render('/product/real-phone-ab12');
    assert.strictEqual(canonicalOf(r.html), `${SITE}/product/real-phone-ab12`);
  } finally { CatalogRepository.findIndexableProductByIdOrSlug = origFind; }
  console.log('    ✓ a live listing is untouched: by id or slug, canonical = its slug');

  /* ── a store page ───────────────────────────────────────────────────── */
  const origStore = StoreRepository.findByIdOrSlug;
  StoreRepository.findByIdOrSlug = async () => ({ id: 'sto_1', slug: 'acme-1f3a', name: 'Acme', status: 'ACTIVE', visibility: 'PUBLIC', description: 'Shop', is_verified: false });
  try {
    for (const key of ['acme-1f3a', 'sto_1']) {
      r = await render(`/store/${key}`);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(robotsOf(r.html), 'index,follow', 'no noindex on a live store page');
      assert.strictEqual(canonicalOf(r.html), `${SITE}/store/acme-1f3a`, `a store reached by ${key} has its slug as canonical`);
      assert.strictEqual((r.html.match(/<link rel="canonical"/g) || []).length, 1);
    }
  } finally { StoreRepository.findByIdOrSlug = origStore; }
  console.log('    ✓ a store page: canonical is its slug, by id or slug, one tag, index,follow');

  /* ── the crawlable block links only canonical, distinct product URLs ── */
  r = await render('/marketplace');
  const links = [...r.html.matchAll(/<li><a href="([^"]+\/product\/[^"]+)">/g)].map((m) => m[1]);
  assert.ok(links.length >= 10, `the marketplace block links to products (${links.length})`);
  assert.strictEqual(new Set(links).size, links.length, 'each product once: the first cards of the catalogue are repeats of a few products');
  assert.ok(links.every((u) => u.startsWith(`${SITE}/product/`) && !u.includes('_')), 'all by slug on the canonical host, none by legacy id');
  assert.ok(links.every((u) => index.resolve(u.slice(`${SITE}/product/`.length)).isPrimary), 'and each is the primary of its family');
  console.log(`    ✓ /marketplace's crawlable block: ${links.length} distinct product links, all canonical slugs`);

  /* ── the gateway: status, Location, query, headers ──────────────────── */
  const app = require('../../server/index');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    let res = await get(server, 'GET', `/product/${REPEAT_ID}?utm_source=mail&x=1`);
    assert.strictEqual(res.status, 301, 'the gateway answers 301');
    assert.strictEqual(res.headers.location, `${primaryPath}?utm_source=mail&x=1`, 'to the primary slug, query string kept');
    assert.ok(/s-maxage=3600/.test(res.headers['cache-control'] || ''), `cacheable at the CDN (${res.headers['cache-control']})`);
    assert.ok(!res.headers['x-robots-tag'], 'a redirect is not marked noindex');

    res = await get(server, 'HEAD', `/product/${PRIMARY_ID}`);
    assert.strictEqual(res.status, 301);
    assert.strictEqual(res.headers.location, primaryPath);

    res = await get(server, 'GET', primaryPath);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes(`<link rel="canonical" href="${SITE}${primaryPath}"`), 'the HTTP response body carries the canonical');
    assert.ok(!res.headers['x-robots-tag'], 'no X-Robots-Tag on a live product page');
    assert.ok(/s-maxage=\d+/.test(res.headers['cache-control'] || ''), 'public product pages stay CDN-cacheable');

    res = await get(server, 'GET', repeatPath);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes(`<link rel="canonical" href="${SITE}${primaryPath}"`));

    // PR #37 still holds
    res = await get(server, 'GET', '/product/nope-aaaa');
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.headers['x-robots-tag'], 'noindex');
    res = await get(server, 'GET', '/this-route-does-not-exist');
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.headers['x-robots-tag'], 'noindex');
    res = await get(server, 'GET', '/rider/src/services/riderHub.js', { accept: '*/*' });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body, 'Not found', 'a missing file is a plain-text 404');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('    ✓ gateway: 301 + Location (query kept) for a legacy id, 200 + canonical for a slug; 404 + noindex and plain-text file 404s unchanged');
}

module.exports = { run };
