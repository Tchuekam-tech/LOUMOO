/**
 * LOUMOO Unit Tests — the sitemap lists real, distinct, public pages and nothing else
 * ---------------------------------------------------------------------------
 * The live sitemap (https://www.loumoo.store/sitemap.xml, measured 2026-10-24) had 1,116 URLs:
 * 982 products (972 seed products that are 160 different ones, each under up to 26 ids, plus
 * ten listings), 105 stores (86 of them "test-boutique" rows the test harnesses left behind) and
 * 29 pages. This feeds the sitemap rows shaped like that database and asserts what a crawler
 * should be offered. The four greps of the acceptance check are assertions here:
 *
 *   grep -c "<loc>"                                      about 200, not 1,116
 *   grep -c "test-boutique"                              0
 *   grep -c "untitled-draft-listing|harness-test-listing"  0
 *   grep -c "_2</loc>"                                   0
 *   grep -o "<loc>[^<]*" | sort | uniq -d                nothing
 */

require('../setup');
const assert = require('assert');

const SitemapService = require('../../server/modules/system/seo/SitemapService');
const IndexingPolicy = require('../../server/modules/system/seo/IndexingPolicy');
const CuratedUrls = require('../../server/modules/catalog/domain/CuratedUrls');

const SITE = 'https://www.loumoo.store';

/** A Supabase client that answers every query chain with the rows it was given for the table. */
function fakeDb(tables, failing) {
  return {
    from(table) {
      const chain = {};
      ['select', 'eq', 'is', 'order', 'limit', 'in'].forEach((m) => { chain[m] = () => chain; });
      chain.then = (resolve, reject) => Promise.resolve(failing === table
        ? { data: null, error: { message: 'relation does not exist' } }
        : { data: tables[table] || [], error: null }).then(resolve, reject);
      return chain;
    }
  };
}

const store = (slug, name, extra) => Object.assign({ slug, name, status: 'ACTIVE', visibility: 'PUBLIC', updated_at: '2026-09-02T06:04:47.293Z' }, extra);
const listing = (slug, title, storeRow, extra) => Object.assign({
  id: `lst_${slug}`, slug, title, category_id: 'electronics', base_price_minor: 85000000,
  created_at: '2026-09-01T10:00:00.000Z', updated_at: '2026-09-02T11:10:36.584Z',
  stores: { status: 'ACTIVE', slug: storeRow.slug, name: storeRow.name, visibility: storeRow.visibility || 'PUBLIC' }
}, extra);

/** The production shape: 19 real stores, 86 throwaway ones. */
function liveStores() {
  const real = [
    ['giantech-empire-p2lt', 'Giantech Empire'], ['persisted-electronics-dpch', 'Persisted Electronics'], ['code-genie-auzh', 'Code Genie'],
    ['amina-electronics-douala-bw7r', 'Amina Electronics Douala'], ['uma-fashion-house-wt8q', 'Uma Fashion House'], ['orca-digital-akwa-9ice', 'Orca Digital Akwa'],
    ['kamer-tech-solutions-9biy', 'Kamer Tech Solutions'], ['kamer-tech-solutions-gdl8', 'Kamer Tech Solutions'], ['kamer-tech-solutions-k7mm', 'Kamer Tech Solutions'],
    ['nadia-couture-bastos-hk38', 'Nadia Couture Bastos'], ['paule-beauty-75k5', 'Paule Beauty'], ['alpha-tech-douala-c464', 'Alpha Tech Douala'],
    ['alpha-tech-douala-xlmk', 'Alpha Tech Douala'], ['beauty-plus-sheesh-hrpv', 'Beauty Plus Sheesh'], ['kribi-tech-commerce-mutylycq29fc7c', 'Kribi Tech Commerce'],
    ['kribi-tech-commerce-mu5jpq30e9c314', 'Kribi Tech Commerce'], ['amina-electronics-mtjrcf1n746dc0', 'Amina Electronics'], ['amina-electronics-mtjzmby7ee98a4', 'Amina Electronics'],
    ['nanoafrica', 'NanoAfrica']
  ].map(([slug, name]) => store(slug, name));
  const test = [];
  for (let i = 0; i < 85; i++) test.push(store(`test-boutique-mt${String(i).padStart(2, '0')}cddo4ed829`, `Test Boutique mt${i}`));
  test.push(store('loop-test-boutique-kwfn', 'Loop Test Boutique'));
  return { real, test };
}

async function run() {
  console.log('  Testing the sitemap against production-shaped data...');

  /* ── the data of the audit ──────────────────────────────────────────── */
  const { real, test } = liveStores();
  assert.strictEqual(real.length, 19);
  assert.strictEqual(test.length, 86);
  const kamer = (n) => real.find((s) => s.slug === `kamer-tech-solutions-${n}`);
  const amina = real.find((s) => s.slug === 'amina-electronics-douala-bw7r');
  const orca = real.find((s) => s.slug === 'orca-digital-akwa-9ice');
  const codeGenie = real.find((s) => s.slug === 'code-genie-auzh');
  const testStore = test[0];
  const MACBOOK = 'MacBook Air M3 Space Gray 16GB';
  const listings = [
    listing('untitled-draft-listing-lgp4', 'Item s25', codeGenie),
    listing('macbook-air-m3-mtr01q56', MACBOOK, kamer('k7mm'), { created_at: '2026-09-07T08:49:23.000Z', updated_at: '2026-09-07T08:49:23.591Z' }),
    listing('macbook-air-m3-mtqzzqms', MACBOOK, kamer('gdl8'), { created_at: '2026-09-07T08:47:51.000Z', updated_at: '2026-09-07T08:47:51.336Z' }),
    listing('macbook-air-m3-mtqzxb2r', MACBOOK, kamer('9biy'), { created_at: '2026-09-07T08:45:57.000Z', updated_at: '2026-09-07T08:45:57.444Z' }),
    listing('harness-test-listing-mto5p4c246315f', 'Sony WH-1000XM5 Wireless Headphones (Black)', testStore),
    listing('untitled-draft-listing-k4x5', 'Samsung Galaxy S24 Ultra 512GB Titanium Black', amina),
    listing('iphone-screen-replacement-same-day-90-day-guarantee-6y0z', 'iPhone screen replacement — same day, 90-day guarantee', amina, { base_price_minor: 2500000, category_id: 'services' }),
    listing('iphone-14-pro-256gb-deep-purple-sealed-12-month-warranty-se9u', 'iPhone 14 Pro 256GB Space Grey — sealed, 12-month warranty', amina, { base_price_minor: 69900000 }),
    listing('apple-iphone-15-pro-max-natural-titanium-256gb-cegz', 'Apple iPhone 15 Pro Max Natural Titanium 256GB', orca, { base_price_minor: 89000000 }),
    listing('apple-iphone-15-pro-max-natural-titanium-256gb-8gb-ram-5gm6', 'Apple iPhone 15 Pro Max (Natural Titanium) — 256GB / 8GB RAM', test[1], { base_price_minor: 89000000 })
  ];
  const db = fakeDb({ listings, stores: real.concat(test) });

  /* ── the sitemap ────────────────────────────────────────────────────── */
  const xml = await SitemapService.buildSitemap({ siteUrl: SITE, db });
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const count = (re) => locs.filter((l) => re.test(l)).length;

  assert.ok(locs.length >= 150 && locs.length <= 260, `about 200 URLs, not 1,116 (got ${locs.length})`);
  assert.strictEqual(count(/test-boutique/), 0, 'no test-boutique-* / loop-test-boutique-* store');
  assert.strictEqual(count(/untitled-draft-listing|harness-test-listing/), 0, 'no placeholder or harness listing');
  assert.strictEqual(count(/_2$/), 0, 'no "_2" counter URL');
  assert.strictEqual(count(/_\d+$/), 0, 'no counter URL at all');
  assert.strictEqual(count(/\/product\/[^/]*_/), 0, 'no product URL in the legacy underscore shape');
  assert.deepStrictEqual(locs.filter((l, i) => locs.indexOf(l) !== i), [], 'no duplicate <loc>');
  assert.ok(locs.every((l) => l.startsWith(`${SITE}/`)), 'every URL is on the canonical host');
  console.log(`    ✓ ${locs.length} URLs (was 1,116): 0 test-boutique, 0 placeholder/harness listings, 0 counter URLs, 0 duplicates`);

  // stores: the 19 real ones, and none of the 86 throwaway ones
  const storeLocs = locs.filter((l) => l.includes('/store/')).map((l) => l.split('/store/')[1]);
  assert.deepStrictEqual(storeLocs.slice().sort(), real.map((s) => s.slug).sort(), 'exactly the live real stores');
  assert.strictEqual(test.length - storeLocs.filter((s) => /^(loop-)?test-boutique/.test(s)).length, 86, 'all 86 test stores are gone');

  // curated products: the primaries, once each
  const productLocs = locs.filter((l) => l.includes('/product/')).map((l) => l.split('/product/')[1]);
  const curated = CuratedUrls.defaultIndex().primaries().map((p) => p.slug).sort();
  assert.deepStrictEqual(productLocs.filter((s) => curated.includes(s)).sort(), curated, 'every one of the 160 curated products, once, by its primary slug');
  const pixel = productLocs.filter((s) => /^google-pixel-8-pro-128gb-unlocked-android-14-/.test(s));
  assert.strictEqual(pixel.length, 1, `the Pixel 8 Pro that had 27 URLs has one (${pixel.length})`);

  // database listings: the real ones, the MacBook once (the oldest), nothing from a test store
  const dbListings = productLocs.filter((s) => !curated.includes(s)).sort();
  assert.deepStrictEqual(dbListings, [
    'apple-iphone-15-pro-max-natural-titanium-256gb-cegz',
    'iphone-14-pro-256gb-deep-purple-sealed-12-month-warranty-se9u',
    'iphone-screen-replacement-same-day-90-day-guarantee-6y0z',
    'macbook-air-m3-mtqzxb2r'
  ], 'real listings only; the three MacBooks are one, and it is the oldest');
  console.log('    ✓ 19 real stores, 160 curated products (one per product), 4 real listings (the MacBook once)');

  // honest lastmod / changefreq / priority
  const blocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  const field = (block, tag) => (block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1];
  const byLoc = (suffix) => blocks.find((b) => field(b, 'loc').endsWith(suffix));
  assert.strictEqual(field(byLoc('/product/macbook-air-m3-mtqzxb2r'), 'lastmod'), '2026-09-07T08:45:57.444Z', 'a listing\'s lastmod is its own updated_at');
  assert.strictEqual(field(byLoc('/store/giantech-empire-p2lt'), 'lastmod'), '2026-09-02T06:04:47.293Z', 'a store\'s lastmod is its own updated_at');
  const curatedBlocks = blocks.filter((b) => curated.some((s) => field(b, 'loc').endsWith(`/product/${s}`)));
  assert.ok(curatedBlocks.every((b) => !/<lastmod>/.test(b)), 'a curated product has no real modification date, so no lastmod (a made-up one is worse)');
  assert.ok(curatedBlocks.every((b) => field(b, 'changefreq') === 'monthly' && field(b, 'priority') === '0.6'), 'static catalogue data: monthly, 0.6');
  assert.strictEqual(field(byLoc('/marketplace'), 'priority'), '0.9');
  assert.ok(blocks.every((b) => !/<lastmod>/.test(b) || !Number.isNaN(Date.parse(field(b, 'lastmod')))), 'every lastmod parses');
  console.log('    ✓ lastmod is only ever a real updated_at; priorities and change frequencies are stated per kind');

  /* ── what makes a store or listing "live" ───────────────────────────── */
  const hidden = fakeDb({
    stores: [store('open-shop-aaaa', 'Open Shop'), store('private-shop-bbbb', 'Private Shop', { visibility: 'PRIVATE' }), store('closed-shop-cccc', 'Closed Shop', { status: 'SUSPENDED' })],
    listings: [
      listing('open-item-aaaa', 'Open item', store('open-shop-aaaa', 'Open Shop')),
      listing('private-item-bbbb', 'Private item', store('private-shop-bbbb', 'Private Shop', { visibility: 'PRIVATE' }))
    ]
  });
  const hiddenLocs = [...(await SitemapService.buildSitemap({ siteUrl: SITE, db: hidden })).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(hiddenLocs.includes(`${SITE}/store/open-shop-aaaa`) && hiddenLocs.includes(`${SITE}/product/open-item-aaaa`), 'a live store and its listing are listed');
  assert.ok(!hiddenLocs.some((l) => /private-shop|private-item|closed-shop/.test(l)), 'a PRIVATE or non-ACTIVE store, and a PRIVATE store\'s listing, are not');
  console.log('    ✓ only ACTIVE, non-PRIVATE stores (and their listings) are offered');

  // a failing table drops its own section, never the sitemap
  const noStores = await SitemapService.buildSitemap({ siteUrl: SITE, db: fakeDb({ listings, stores: real }, 'stores') });
  assert.ok(noStores.includes('/product/macbook-air-m3-mtqzxb2r') && !noStores.includes('/store/'), 'a broken stores query omits the stores and keeps everything else');
  const noDb = await SitemapService.buildSitemap({ siteUrl: SITE, db: null });
  assert.ok(noDb.includes('<urlset') && noDb.includes('/marketplace') && noDb.includes('/product/'), 'without a database the pages and the curated products are still served');
  console.log('    ✓ a database failure omits that section only');

  /* ── IndexingPolicy ─────────────────────────────────────────────────── */
  ['test-boutique-mtilcddo4ed829', 'loop-test-boutique-kwfn', 'harness-test-store-1'].forEach((slug) => assert.ok(IndexingPolicy.isTestStore({ slug }), `${slug} is a test store`));
  assert.ok(IndexingPolicy.isTestStore({ slug: 'renamed-aaaa', name: 'Test Boutique mto5p3mm9ed258' }), 'recognised by name too');
  ['nanoafrica', 'testimonial-shop-aaaa', 'contest-boutique-aaaa', 'my-test-boutique-aaaa'].forEach((slug) => assert.ok(!IndexingPolicy.isTestStore({ slug, name: 'Real' }), `${slug} is a real store`));
  assert.ok(!IndexingPolicy.isTestStore(null) && !IndexingPolicy.isTestStore({}));
  assert.ok(IndexingPolicy.hasPlaceholderSlug({ slug: 'untitled-draft-listing-lgp4' }) && IndexingPolicy.hasPlaceholderSlug({ slug: 'harness-test-listing-mto5p4c246315f' }));
  assert.ok(!IndexingPolicy.hasPlaceholderSlug({ slug: 'untitled-item-aaaa' }) && !IndexingPolicy.hasPlaceholderSlug({ slug: 'macbook-air-m3-mtqzxb2r' }));

  const a = listing('a-1', 'Same Thing', kamer('9biy'), { id: 'a', created_at: '2026-01-02T00:00:00Z' });
  const b = listing('a-2', 'same  thing!', kamer('gdl8'), { id: 'b', created_at: '2026-01-01T00:00:00Z' });
  const otherSeller = listing('a-3', 'Same Thing', amina, { id: 'c', created_at: '2026-01-03T00:00:00Z' });
  const otherPrice = listing('a-4', 'Same Thing', kamer('k7mm'), { id: 'd', base_price_minor: 1 });
  const untitled = [listing('u-1', '', amina, { id: 'u1' }), listing('u-2', '', amina, { id: 'u2' })];
  const kept = IndexingPolicy.dropRepeatedListings([a, b, otherSeller, otherPrice, ...untitled]);
  assert.deepStrictEqual(kept.map((l) => l.id), ['b', 'c', 'd', 'u1', 'u2'],
    'one per offer (the oldest, case/punctuation-insensitive); a different seller or price is a different offer; untitled rows are never merged; input order kept');
  console.log('    ✓ IndexingPolicy: test stores, placeholder slugs and repeated offers are told apart from real ones');
}

module.exports = { run };
