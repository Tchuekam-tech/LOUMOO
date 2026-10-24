/**
 * LOUMOO Unit Tests — product slugs are deterministic, unique and never cut mid-word
 * ---------------------------------------------------------------------------
 * The seed catalogue used to be filed under ids cut at 45 characters ("..._128gb_unlocke",
 * "..._256gb_tit", "..._512gb_j") with a counter ("_2" ... "_26") appended whenever two cuts
 * met, so one phone had 27 URLs and every rebuild in a different order minted new ones.
 *
 *   1. ProductSlug: whole words only, a stable 4-character suffix of the immutable id, no
 *      counter, the same answer every time.
 *   2. THE WHOLE SEED CATALOGUE, generated twice: zero duplicates, zero mid-word cuts, zero
 *      counters, identical both times.
 *   3. The slug stored in the catalogue files is the slug the algorithm gives today (the
 *      browser resolves /product/<slug> from the bundle, so it must not drift).
 *   4. The Python generators' port agrees on every product (skipped, loudly, where there is
 *      no Python interpreter: CI is Node only).
 */

require('../setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const Slug = require('../../server/modules/catalog/domain/ProductSlug');
const { catalogProducts } = require('../../server/modules/catalog/dataLoader');

const ROOT = path.resolve(__dirname, '../..');

/** The words of a title, derived here on purpose (not through ProductSlug) so the test is an independent witness. */
function titleWords(title) {
  return String(title)
    .replace(/\s*\([^()]*#\d+\)\s*$/, '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .replace(/['’]/g, '')
    .split(/\s+/)
    .map((w) => (w.match(/[a-z0-9]+/g) || []).join('-'))
    .filter(Boolean);
}

function pythonInterpreter() {
  for (const cmd of ['python', 'python3']) {
    const probe = spawnSync(cmd, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0 && /^3/.test(String(probe.stdout).trim())) return cmd;
  }
  return null;
}

async function run() {
  console.log('  Testing product slugs...');

  /* ── 1. the algorithm ───────────────────────────────────────────────── */
  assert.deepStrictEqual(Slug.toWords("Poêle à Frire d'Aluminium Slip-On 13.6\" & 256GB/512GB (Œuvre #7)"),
    ['poele', 'a', 'frire', 'daluminium', 'slip-on', '13-6', '256gb-512gb', 'oeuvre', '7'],
    'accents fold, apostrophes vanish, a hyphenated or dotted term is ONE word, a bare symbol is dropped');
  assert.strictEqual(Slug.stripCounterMarker('Kraasa Bottines (#11)'), 'Kraasa Bottines');
  assert.strictEqual(Slug.stripCounterMarker('MacBook Air (8GB RAM) (Configuration Pro #31)'), 'MacBook Air (8GB RAM)', 'only the trailing counter goes');
  assert.strictEqual(Slug.stripCounterMarker('Pixel 8 Pro (128GB)'), 'Pixel 8 Pro (128GB)', 'a parenthesis without a counter is part of the title');

  assert.strictEqual(Slug.truncateOnWordBoundary(['alpha', 'beta', 'gamma'], 10), 'alpha-beta', 'cuts between words');
  assert.strictEqual(Slug.truncateOnWordBoundary(['alpha', 'beta', 'gamma'], 11), 'alpha-beta', '"alpha-beta-gamma" would be 16');
  assert.strictEqual(Slug.truncateOnWordBoundary(['alpha', 'beta', 'gamma'], 16), 'alpha-beta-gamma');
  assert.strictEqual(Slug.truncateOnWordBoundary(['extraordinarily', 'long'], 5), 'extraordinarily', 'a first word longer than the limit is kept whole, never cut');

  const suffix = Slug.stableSuffix('phone_google_google_pixel_8_pro_128gb_unlocke');
  assert.ok(/^[0-9a-f]{6}$/.test(suffix), `the suffix is six lowercase hex characters, got ${suffix}`);
  assert.strictEqual(Slug.stableSuffix('phone_google_google_pixel_8_pro_128gb_unlocke'), suffix, 'same id, same suffix');
  assert.notStrictEqual(Slug.stableSuffix('phone_google_google_pixel_8_pro_128gb_unlocke_2'), suffix, 'the next id gets a different one');
  assert.throws(() => Slug.stableSuffix(''), /immutable id/, 'no id, no slug');
  assert.throws(() => Slug.productSlug('A title', null), /immutable id/);

  // Pinned: a change of algorithm would move every URL, so it must be a deliberate edit of these lines.
  assert.strictEqual(Slug.productSlug('Google Pixel 8 Pro 128GB Unlocked Android 14', 'phone_google_google_pixel_8_pro_128gb_unlocke'),
    'google-pixel-8-pro-128gb-unlocked-android-14-d8f82a');
  assert.strictEqual(Slug.productSlug('Kraasa Bottines Chelsea Homme Micro-Daim Élastique Slip-On - Pointures 39-44 (#1)', 'shoe_kraasa_kraasa_bottines_chelsea_homme_mic'),
    'kraasa-bottines-chelsea-homme-micro-daim-elastique-slip-on-cf6fd4');

  assert.strictEqual(Slug.productSlug('MacBook Air (#11)', 'a'), Slug.productSlug('MacBook Air', 'a'), 'the generator counter is not part of the slug');
  assert.notStrictEqual(Slug.productSlug('MacBook Air', 'a'), Slug.productSlug('MacBook Air', 'b'), 'two products with one title differ by their id');
  assert.ok(/^product-[0-9a-f]{6}$/.test(Slug.productSlug('', 'x')) && /^product-[0-9a-f]{6}$/.test(Slug.productSlug('!!!', 'x')), 'a title with no words still gets a valid slug');
  assert.ok(Slug.isProductSlug('google-pixel-8-pro-128gb-unlocked-android-14-d8f82a'), 'the 6-hex shape validates');
  assert.ok(Slug.isProductSlug('iphone-screen-replacement-same-day-90-day-guarantee-6y0z'), 'the hand-published 4-base36 shape validates too');
  assert.ok(!Slug.isProductSlug('phone_google_google_pixel_8_pro_128gb_unlocke_2'), 'a legacy underscore id is not a slug');
  console.log('    ✓ ProductSlug: whole words, a stable 6-hex suffix of the immutable id, no counter');

  /* ── 2. the whole seed catalogue, twice ─────────────────────────────── */
  const ids = Object.keys(catalogProducts);
  assert.ok(ids.length >= 900, `the seed catalogue is loaded (${ids.length} products)`);
  const generate = () => ids.map((id) => Slug.productSlug(catalogProducts[id].title, id));
  const first = generate();
  const second = generate();
  assert.deepStrictEqual(second, first, 'generating twice gives the same slug for every product (idempotent)');

  const owners = new Map();
  const duplicates = [];
  first.forEach((slug, i) => { if (owners.has(slug)) duplicates.push(`${owners.get(slug)} and ${ids[i]} -> ${slug}`); else owners.set(slug, ids[i]); });
  assert.deepStrictEqual(duplicates, [], `zero duplicate slugs across ${ids.length} products`);

  const midWord = [];
  first.forEach((slug, i) => {
    assert.ok(Slug.isProductSlug(slug), `${ids[i]}: "${slug}" is a well-formed slug`);
    const base = slug.slice(0, -(Slug.SUFFIX_LENGTH + 1));
    const words = titleWords(catalogProducts[ids[i]].title);
    const whole = words.length ? words.map((_, k) => words.slice(0, k + 1).join('-')) : ['product'];
    if (!whole.includes(base)) midWord.push(`${ids[i]}: "${base}" is not a run of whole words of "${catalogProducts[ids[i]].title}"`);
    const firstWordAloneIsTooLong = words.length > 0 && words[0].length > Slug.MAX_BASE_LENGTH;
    if (base.length > Slug.MAX_BASE_LENGTH && !firstWordAloneIsTooLong) midWord.push(`${ids[i]}: "${base}" is longer than ${Slug.MAX_BASE_LENGTH}`);
  });
  assert.deepStrictEqual(midWord, [], 'zero slugs cut inside a word');

  const counters = first.filter((slug) => slug.includes('_'));
  assert.deepStrictEqual(counters, [], 'no underscore counter ("_2" ... "_26") anywhere: the 4-character suffix is a hash of the id');
  const legacy = ids.filter((id, i) => id === first[i]);
  assert.deepStrictEqual(legacy, [], 'no slug is the same string as the id it replaces');
  console.log(`    ✓ the ${ids.length} seed products, generated twice: identical, 0 duplicates, 0 mid-word cuts, 0 counters`);

  /* ── 3. the files carry what the algorithm gives ────────────────────── */
  const stored = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog.json'), 'utf8'));
  const stale = ids.filter((id, i) => catalogProducts[id].slug !== first[i] || (stored[id] || {}).slug !== first[i]);
  assert.deepStrictEqual(stale.slice(0, 5), [], `${stale.length} product(s) carry a slug that is not the one ProductSlug gives: run node scripts/assign_catalog_slugs.js`);
  assert.deepStrictEqual(Object.keys(stored), ids, 'the ids themselves are untouched: orders, carts and reviews are filed under them');
  console.log('    ✓ every product in src/data/catalog_products.js and data/catalog.json carries its slug; no id changed');

  /* ── 4. the Python generators agree ─────────────────────────────────── */
  const python = pythonInterpreter();
  if (!python) {
    console.log('    ⚠ SKIPPED the Python parity check: no Python 3 interpreter on this machine (it runs wherever one exists)');
  } else {
    const result = spawnSync(python, ['scripts/catalog_slug.py', '--check', 'data/catalog.json'], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, `scripts/catalog_slug.py disagrees with ProductSlug.js:\n${result.stdout}${result.stderr}`);
    console.log(`    ✓ scripts/catalog_slug.py (${python}) gives the same slug for all ${ids.length} products`);
  }
}

module.exports = { run };
