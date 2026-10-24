/**
 * LOUMOO Unit Tests — one canonical page per curated product
 * ---------------------------------------------------------------------------
 * The seed catalogue lists 972 products that are 160 different ones, each repeated under a new
 * id, photo and "(#11)". CuratedUrls says which URL is THE URL of each:
 *
 *   1. On the real catalogue: every id and every slug resolves to the same product; each of the
 *      160 families has exactly one primary; every member's canonical path is its primary's slug.
 *   2. The primary does not depend on the order of the dataset (a rebuild or a re-sort cannot
 *      move a canonical URL), and the generator's counter never makes two products "different".
 *   3. Two products can never share a URL: a colliding slug falls back to the unique id.
 *   4. Nothing a visitor types can resolve to something that is not a product.
 */

require('../setup');
const assert = require('assert');

const CuratedUrls = require('../../server/modules/catalog/domain/CuratedUrls');
const { productSlug } = require('../../server/modules/catalog/domain/ProductSlug');
const { catalogProducts } = require('../../server/modules/catalog/dataLoader');

const product = (title, brand, extra) => Object.assign({ title, brand: brand || 'Acme' }, extra || {});

async function run() {
  console.log('  Testing curated product URL identity...');

  /* ── 1. the real catalogue ──────────────────────────────────────────── */
  const index = CuratedUrls.defaultIndex();
  const ids = Object.keys(catalogProducts);
  assert.strictEqual(index.size, ids.length, 'every product of the dataset is indexed');
  assert.strictEqual(index.families, 160, `972 products are 160 different products (got ${index.families})`);
  assert.strictEqual(index.primaries().length, index.families, 'exactly one primary per family');

  for (const id of ids) {
    const entry = index.resolve(id);
    assert.ok(entry, `${id} resolves`);
    assert.strictEqual(entry.id, id);
    assert.strictEqual(index.resolve(entry.slug), entry, `${id}: its slug resolves to the same product`);
    assert.strictEqual(entry.slug, catalogProducts[id].slug, `${id}: the slug in the dataset is the one the index serves`);
    assert.strictEqual(index.canonicalPath(id), `/product/${entry.primarySlug}`, `${id}: canonical is its primary's slug`);
    assert.strictEqual(index.canonicalPath(entry.slug), index.canonicalPath(id), `${id}: by id or by slug, the same canonical`);
  }
  const primarySlugs = index.primaries().map((p) => p.slug);
  assert.strictEqual(new Set(primarySlugs).size, primarySlugs.length, 'no two primaries share a URL');
  assert.ok(index.entries.every((e) => e.isPrimary === (e.id === e.primaryId)), 'isPrimary means "I am my own primary"');
  console.log(`    ✓ ${index.size} products -> ${index.families} families, one primary each; every id and slug resolves to its primary's canonical`);

  // The phone from the audit: 26 copies, one canonical URL.
  const base = 'phone_google_google_pixel_8_pro_128gb_unlocke';
  const copies = ids.filter((id) => id === base || id.startsWith(base + '_'));
  assert.ok(copies.length >= 20, `the Pixel 8 Pro family is the large one the audit found (${copies.length})`);
  const canon = new Set(copies.map((id) => index.canonicalPath(id)));
  assert.deepStrictEqual([...canon], [`/product/${index.resolve(base).slug}`], 'all of them canonicalise to the original id\'s slug');
  assert.strictEqual(index.resolve(base).isPrimary, true, 'the unsuffixed id is the primary: the URL search engines already know as the original');

  /* ── 2. order-independent, counter-blind ────────────────────────────── */
  const shuffled = {};
  ids.slice().reverse().forEach((id) => { shuffled[id] = catalogProducts[id]; });
  const reversed = CuratedUrls.build(shuffled);
  assert.deepStrictEqual(reversed.primaries().map((p) => p.id).sort(), index.primaries().map((p) => p.id).sort(),
    'the primary of every family is the same whatever order the dataset lists the products in');

  const small = CuratedUrls.build({
    a_1: product('Kettle (#11)'), a: product('Kettle (#1)'), a_22: product('Kettle (Configuration Pro #31)'),
    other: product('Kettle', 'Other Brand'), pan: product('Frying pan 28cm')
  });
  assert.strictEqual(small.families, 3, 'a counter does not make a product different; a brand or a title does');
  assert.strictEqual(small.resolve('a').isPrimary, true, 'shortest id wins');
  assert.strictEqual(small.resolve('a_22').primaryId, 'a');
  assert.strictEqual(small.resolve('a_1').primaryId, 'a');
  assert.strictEqual(small.canonicalPath('a_22'), `/product/${productSlug('Kettle', 'a')}`);
  console.log('    ✓ the primary is chosen by id, never by position; "(#N)" never makes two products different');

  /* ── 3. a URL belongs to one product ────────────────────────────────── */
  const SHARED = 'one-title-aaaa';
  const guard = CuratedUrls.build({
    first: product('One title', 'A', { slug: SHARED }),
    second: product('Another title', 'B', { slug: SHARED }),
    'x-yyyy': product('Third', 'C'),
    third: product('Third product', 'D', { slug: 'x-yyyy' })
  });
  assert.strictEqual(guard.resolve('first').slug, SHARED);
  assert.strictEqual(guard.resolve('second').slug, 'second', 'a slug already taken falls back to the product\'s own (unique) id');
  assert.strictEqual(guard.resolve('third').slug, 'third', 'a slug that is another product\'s id is refused too');
  assert.strictEqual(guard.resolve(SHARED).id, 'first', 'and the contested URL still means exactly one product');
  console.log('    ✓ two products can never be served at one URL');

  /* ── 4. only products resolve ───────────────────────────────────────── */
  for (const key of ['', null, undefined, 42, {}, [], 'nope', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '../etc/passwd', 'phone_google']) {
    assert.strictEqual(index.resolve(key), null, `${JSON.stringify(key)} is not a product`);
    assert.strictEqual(index.canonicalPath(key), null);
  }
  assert.strictEqual(CuratedUrls.build({}).size, 0, 'an empty catalogue is fine');
  assert.strictEqual(CuratedUrls.build(null).size, 0);
  assert.strictEqual(CuratedUrls.build({ untitled: { brand: 'X' } }).size, 0, 'an entry with no title is not a product');
  console.log('    ✓ unknown keys, prototype names and path tricks resolve to nothing');
}

module.exports = { run };
