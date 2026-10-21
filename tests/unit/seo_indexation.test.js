/**
 * LOUMOO — indexation correctness: one canonical host, honest structured data,
 * no soft-404s, and a sitemap that lists only pages the prerender indexes.
 * ---------------------------------------------------------------------------
 * Hermetic (no database: the curated catalogue answers, exactly as during an
 * outage). Proves:
 *   1. ONE canonical origin — the route registry's ORIGIN, the shared SEO model,
 *      the server config and the static robots.txt agree; PUBLIC_SITE_URL is
 *      validated (never a path, never http) so a typo cannot reach every canonical.
 *   2. Product JSON-LD states the price the buyer PAYS (not the curated
 *      compare-at price), never a rating no review backs, and a breadcrumb trail.
 *   3. Untrusted text cannot break out of the JSON-LD <script> or the HTML.
 *   4. Home carries Organization + WebSite; a store is an OnlineStore.
 *   5. No soft-404: an unknown category is a 404; an empty category, an
 *      unverifiable hotel id and a redirect-only route are noindex.
 *   6. One URL per entity: a product opened by id canonicalises to its slug.
 *   7. Listing pages carry crawlable product/category links.
 *   8. Every sitemap URL is on the canonical origin, unique, public, and renders
 *      200 + index,follow through the prerender (the sitemap never lists a URL
 *      the page itself would noindex or 404).
 */

require('../setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FrontendRoutes = require('../../src/routing/routes');
const seoModel = require('../../src/seo/seoModel');
const config = require('../../server/config/env');
const SeoContent = require('../../server/modules/system/seo/SeoContent');
const SitemapService = require('../../server/modules/system/seo/SitemapService');
const PrerenderService = require('../../server/modules/system/seo/PrerenderService');
const CatalogRepository = require('../../server/modules/catalog/infrastructure/CatalogRepository');
const StoreRepository = require('../../server/modules/store/infrastructure/StoreRepository');

const ROOT = path.resolve(__dirname, '../..');
const SHELL = '<!doctype html><html lang="en"><head><title>Shell</title></head><body>\n<x-dc></x-dc>\n</body></html>';
const SITE = FrontendRoutes.ORIGIN;
const render = (url) => PrerenderService.renderPage({ url, shellHtml: SHELL, siteUrl: SITE });
const attr = (html, re) => ((html.match(re) || [])[1] || '');
const robotsOf = (html) => attr(html, /<meta name="robots" content="([^"]+)"/);
const canonicalOf = (html) => attr(html, /<link rel="canonical" href="([^"]+)"/);
const jsonLdOf = (html) => [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

// A real curated product whose dataset price (what checkout charges) is BELOW its
// compare-at "salePrice": the case the JSON-LD offer used to get wrong.
const CURATED_ID = 'phone_tecno_tecno_camon_50_pro_5g_256gb_12gb_';

async function run() {
  /* ── 1. One canonical origin ─────────────────────────────────────────── */
  assert.strictEqual(SITE, 'https://www.loumoo.store', 'the canonical origin is the host that answers 200 (the apex 308-redirects to www)');
  assert.strictEqual(seoModel.DEFAULT_SITE_URL, SITE, 'seoModel.DEFAULT_SITE_URL equals the registry ORIGIN');
  assert.strictEqual(config.site.url, SITE, 'server config defaults to the registry ORIGIN');
  // (normalise line endings: a Windows checkout with core.autocrlf rewrites the committed LF to CRLF)
  assert.strictEqual(fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8').replace(/\r\n/g, '\n'), SeoContent.robotsTxt({ siteUrl: SITE }),
    'robots.txt in the repository is exactly what the gateway serves');
  const builtRobots = path.join(ROOT, 'public', 'robots.txt');
  if (fs.existsSync(builtRobots)) {
    assert.ok(fs.readFileSync(builtRobots, 'utf8').includes(`Sitemap: ${SITE}/sitemap.xml`), 'the built robots.txt points at the canonical sitemap');
  }
  assert.strictEqual(config.resolveSiteUrl('https://loumoo.store/'), 'https://loumoo.store', 'a valid override is honoured (trailing slash stripped)');
  for (const bad of ['http://www.loumoo.store', 'https://www.loumoo.store/shop', 'loumoo.store', 'javascript:alert(1)', '']) {
    assert.strictEqual(config.resolveSiteUrl(bad), SITE, `an invalid PUBLIC_SITE_URL (${JSON.stringify(bad)}) falls back to the registry ORIGIN`);
  }

  // The shell is generated (npm run build:frontend). The SEO model script and the
  // rule that hides the crawler content block once the app mounts must come from the
  // GENERATOR, or the next rebuild silently drops them (it did: they had been added
  // to the generated file by hand).
  const generator = fs.readFileSync(path.join(ROOT, 'build_redesign.py'), 'utf8');
  const shell = fs.readFileSync(path.join(ROOT, 'Commerce App.dc.html'), 'utf8');
  for (const line of ['<script defer src="./src/seo/seoModel.js"></script>', 'body:has(#dc-root) #loumoo-prerender { display: none !important; }']) {
    assert.ok(generator.includes(line), `build_redesign.py emits: ${line}`);
    assert.ok(shell.includes(line), `Commerce App.dc.html carries: ${line}`);
  }

  /* ── 2. Product structured data is true to the page ─────────────────── */
  const curated = CatalogRepository._curatedCards().find((c) => c.id === CURATED_ID);
  assert.ok(curated && curated.salePriceNumeric > curated.priceNumeric, 'fixture: a curated product with a higher compare-at price');
  let r = await render(`/product/${CURATED_ID}`);
  assert.strictEqual(r.status, 200, 'a curated product page is 200');
  assert.strictEqual(robotsOf(r.html), 'index,follow');
  let ld = jsonLdOf(r.html);
  const product = ld.find((x) => x['@type'] === 'Product');
  assert.ok(product, 'Product JSON-LD present');
  assert.strictEqual(product.offers.price, String(curated.priceNumeric), 'Offer.price is the PAYABLE price, not the compare-at price');
  assert.notStrictEqual(product.offers.price, String(curated.salePriceNumeric), 'never the "was" price');
  assert.strictEqual(product.offers.priceCurrency, 'XAF');
  assert.ok(!('aggregateRating' in product), 'no aggregateRating from the curated dataset (no review backs it)');
  assert.ok(product.url.startsWith(SITE + '/') && product.offers.url.startsWith(SITE + '/'), 'JSON-LD URLs on the canonical origin');
  assert.ok(!/\/\.\//.test(product.image) && !/[#?]/.test(product.image.replace(/^https?:\/\/[^/]+/, '')), `image URL is the published asset path: ${product.image}`);
  assert.ok(r.html.includes(`<p data-price>${PrerenderService.formatPrice(curated.priceNumeric, 'XAF')}</p>`), 'the visible prerendered price is the payable price');
  const crumbs = ld.find((x) => x['@type'] === 'BreadcrumbList');
  assert.ok(crumbs && crumbs.itemListElement.length === 3, 'BreadcrumbList Home > Category > Product');
  assert.strictEqual(crumbs.itemListElement[1].item, `${SITE}/marketplace/category/electronics`);

  // A LIVE listing: rating from the review system is kept; its sale price is payable.
  const origFind = CatalogRepository.findIndexableProductByIdOrSlug;
  CatalogRepository.findIndexableProductByIdOrSlug = async () => ({
    id: 'lst_123', slug: 'real-phone', title: 'Real Phone', priceNumeric: 100000, salePriceNumeric: 90000,
    currency: 'XAF', rating: 4.5, reviewsCount: 3, category: 'electronics', store: { name: 'Real Store' }
  });
  try {
    r = await render('/product/lst_123');
    ld = jsonLdOf(r.html).find((x) => x['@type'] === 'Product');
    assert.strictEqual(ld.offers.price, '90000', 'a live listing pays its sale price');
    assert.deepStrictEqual(ld.aggregateRating, { '@type': 'AggregateRating', ratingValue: '4.5', reviewCount: '3' }, 'real reviews are kept');
    assert.strictEqual(canonicalOf(r.html), `${SITE}/product/real-phone`, 'a product opened by id canonicalises to its slug (one URL per product)');
    assert.ok(r.html.includes('data-path="/product/lst_123"'), 'the content block records the path it was rendered for');
  } finally { CatalogRepository.findIndexableProductByIdOrSlug = origFind; }

  /* ── 3. Untrusted text cannot escape the JSON-LD script or the HTML ──── */
  CatalogRepository.findIndexableProductByIdOrSlug = async () => ({
    id: 'evil', slug: 'evil', title: '</script><script>alert(1)</script>"><img src=x onerror=alert(2)>',
    description: '</SCRIPT><svg onload=alert(3)>', priceNumeric: 1000, currency: 'XAF', store: { name: '<b>x</b>' }
  });
  try {
    r = await render('/product/evil');
    const scripts = [...r.html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
    assert.ok(scripts.every((m) => /application\/ld\+json/.test(m[0])), 'the only <script> elements are the JSON-LD blocks (no injected script)');
    assert.ok(!/<img src=x/i.test(r.html) && !/<svg onload/i.test(r.html), 'no injected markup anywhere in the page');
    assert.strictEqual(jsonLdOf(r.html).find((x) => x['@type'] === 'Product').name, '</script><script>alert(1)</script>"><img src=x onerror=alert(2)>', 'JSON-LD still carries the exact text');
  } finally { CatalogRepository.findIndexableProductByIdOrSlug = origFind; }

  /* ── 4. Site and store schema ─────────────────────────────────────────── */
  r = await render('/');
  ld = jsonLdOf(r.html);
  assert.deepStrictEqual(ld.map((x) => x['@type']).sort(), ['Organization', 'WebSite'], 'home: Organization + WebSite');
  assert.strictEqual(ld.find((x) => x['@type'] === 'Organization').url, `${SITE}/`);
  const origStore = StoreRepository.findByIdOrSlug;
  StoreRepository.findByIdOrSlug = async () => ({ id: 'store_x', name: 'Acme', slug: 'acme', status: 'ACTIVE', visibility: 'PUBLIC' });
  try {
    r = await render('/store/store_x');
    assert.ok(jsonLdOf(r.html).some((x) => x['@type'] === 'OnlineStore'), 'a boutique is an OnlineStore (no unverified street address)');
    assert.ok(!jsonLdOf(r.html).some((x) => x['@type'] === 'Store'), 'never the LocalBusiness "Store" type');
    assert.strictEqual(canonicalOf(r.html), `${SITE}/store/acme`, 'a store opened by id canonicalises to its slug');
  } finally { StoreRepository.findByIdOrSlug = origStore; }

  /* ── 5. No soft-404 ────────────────────────────────────────────────────── */
  r = await render('/marketplace/category/electronics');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(robotsOf(r.html), 'index,follow', 'a category with products is indexable');
  assert.ok(/<title>Electronics &amp; Technology — LOUMOO<\/title>/.test(r.html), 'a category page has its own title');
  r = await render('/marketplace/category/real-estate');
  assert.strictEqual(canonicalOf(r.html), `${SITE}/marketplace/category/real_estate`, 'a category alias canonicalises to the category id');
  r = await render('/marketplace/category/not-a-category');
  assert.strictEqual(r.status, 404, 'an unknown category is a real 404, not a 200 soft-404');
  assert.ok(/^noindex/.test(robotsOf(r.html)));
  r = await render('/marketplace/category/banks');
  assert.strictEqual(r.status, 200, 'an empty taxonomy category still renders');
  assert.ok(/^noindex/.test(robotsOf(r.html)), 'but an empty (thin) category is noindex');
  for (const p of ['/hotels/made-up-hotel-id', '/announcements/made-up-id']) {
    r = await render(p);
    assert.ok(/^noindex/.test(robotsOf(r.html)), `${p}: an id the server cannot verify is never offered to the index`);
    assert.ok(!r.cacheable, `${p}: and is not CDN-cached as an indexable page`);
  }
  r = await render('/marketplace/filters');
  assert.ok(/^noindex/.test(robotsOf(r.html)), 'a direct:redirect route is noindex');
  r = await render('/marketplace?q=phone&sort=price_asc');
  assert.strictEqual(canonicalOf(r.html), `${SITE}/marketplace`, 'query parameters never create a second canonical URL');

  /* ── 7. Crawlable discovery links ─────────────────────────────────────── */
  r = await render('/marketplace');
  const productLinks = [...r.html.matchAll(/<a href="([^"]+\/product\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(productLinks.length >= 10, `/marketplace links to products (${productLinks.length})`);
  assert.ok(productLinks.every((u) => u.startsWith(`${SITE}/product/`)), 'product links are absolute, on the canonical origin');
  r = await render('/');
  assert.ok(r.html.includes(`<a href="${SITE}/marketplace/category/electronics">`), 'home links to its categories');

  /* ── 8. Sitemap ⊆ indexable 200 pages ─────────────────────────────────── */
  const xml = await SitemapService.buildSitemap({ siteUrl: SITE });
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), 'sitemap header');
  assert.strictEqual((xml.match(/<url>/g) || []).length, (xml.match(/<\/url>/g) || []).length, 'balanced <url> elements');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.strictEqual(new Set(locs).size, locs.length, 'no duplicate <loc>');
  assert.ok(locs.length > 900, `the curated catalogue is listed (${locs.length} URLs)`);
  assert.ok(locs.length <= 50000, 'within the 50,000-URL sitemap limit');
  assert.ok(Buffer.byteLength(xml) < 50 * 1024 * 1024, 'within the 50 MB sitemap limit');
  assert.ok(locs.includes(`${SITE}/product/${CURATED_ID}`), 'curated products are in the sitemap');
  assert.ok(locs.includes(`${SITE}/marketplace/category/electronics`), 'category pages are in the sitemap');
  assert.ok(!locs.includes(`${SITE}/marketplace/category/banks`), 'an empty category is not');
  for (const loc of locs) {
    assert.ok(loc.startsWith(`${SITE}/`), `every <loc> is on the canonical origin: ${loc}`);
    assert.ok(!seoModel.isPrivatePath(loc.slice(SITE.length)), `no private path: ${loc}`);
    assert.ok(!/[?#]/.test(loc), `no query or fragment: ${loc}`);
  }
  const products = locs.filter((l) => l.includes('/product/'));
  const sample = locs.filter((l) => !l.includes('/product/'))
    .concat(products.filter((_, i) => i % Math.ceil(products.length / 40) === 0));
  for (const loc of sample) {
    const page = await render(loc.slice(SITE.length));
    assert.strictEqual(page.status, 200, `sitemap URL renders 200: ${loc}`);
    assert.strictEqual(robotsOf(page.html), 'index,follow', `sitemap URL is indexable: ${loc}`);
    assert.strictEqual(canonicalOf(page.html), loc, `sitemap URL is its own canonical: ${loc}`);
  }

  console.log(`seo_indexation: all assertions passed (${locs.length} sitemap URLs, ${sample.length} rendered)`);
}

module.exports = { run };

if (require.main === module) {
  run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
}
