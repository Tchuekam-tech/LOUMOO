/**
 * LOUMOO Unit Tests — Comparison Engine v2.
 *
 * Behaviour on real catalogue products, plus properties that must hold for
 * any input: order of ids never matters, a better spec never lowers a score,
 * output is deterministic, nothing is clamped or invented.
 */

require('../setup');
const assert = require('assert');
const { catalogProducts, products: seed } = require('../../server/modules/catalog/dataLoader');
const { fromCurated, fromSeed, fromStore } = require('../../server/modules/catalog/domain/comparison/productAdapter');
const { CategoryStats } = require('../../server/modules/catalog/domain/comparison/categoryStats');
const { compare, normalizePriorities } = require('../../server/modules/catalog/domain/comparison/ComparisonEngineV2');

const catalog = [
  ...Object.keys(catalogProducts).map(id => fromCurated(id, catalogProducts[id])),
  ...seed.electronics.map(p => fromSeed(p, 'electronics'))
];
const stats = CategoryStats.build(catalog);
const byId = Object.fromEntries(catalog.map(p => [p.id, p]));
const byTitle = (re) => {
  const p = catalog.find(x => re.test(x.title));
  assert.ok(p, `fixture matching ${re} exists`);
  return p;
};

// A canonical product built by hand, for properties the catalogue cannot pin.
function synthetic(id, { price, attrs, title = `Test Phone ${id}` }) {
  return {
    id, slug: id, title, brand: 'Test', category: 'electronics', subcategory: 'smartphones',
    entityType: 'product', source: 'test', price, compareAtPrice: null, currency: 'XAF',
    rating: 4.8, reviewCount: 30, soldCount: 0, inStock: true, stockUnits: null, stockKnown: false,
    seller: { id: 'store_test', name: 'Test Store', city: 'Douala', rating: 4.8, verified: true },
    conditionLabel: null, fulfillmentLabel: null, image: null,
    attributes: Object.entries(attrs).map(([key, val]) => ({ key, val })),
    structured: null, dbAttributes: null, editorial: null
  };
}

function withoutMeta(r) {
  const c = JSON.parse(JSON.stringify(r));
  delete c.meta;
  return c;
}

async function run() {
  console.log('  Testing Comparison Engine v2 (behaviour + properties)...');

  // ── 1. Real laptops: priorities move the recommendation ──────────────────
  const air = byId['elec-1'];
  const pro = byId['elec-macbook-pro'];
  const thinkpad = byId['elec-thinkpad'];
  const perfFirst = compare([air, pro, thinkpad], { stats, priorities: { performance: 5, display: 5, price: 1 } });
  assert.strictEqual(perfFirst.compatibility.level, 'full');
  assert.strictEqual(perfFirst.recommendation.recommendedProductId, 'elec-macbook-pro', 'performance-first picks the M3 Pro');
  const priceFirst = compare([air, pro], { stats, priorities: { price: 5, performance: 0, display: 0 } });
  assert.strictEqual(priceFirst.recommendation.recommendedProductId, 'elec-1', 'price-first picks the cheaper Air');

  // matchPercentage is the winner's real total, never padded into a range.
  const winner = perfFirst.recommendation.recommendedProductId;
  assert.strictEqual(perfFirst.recommendation.matchPercentage, Math.round(perfFirst.analysis.scores[winner].total));
  assert(perfFirst.recommendation.topReasons.length > 0, 'winner has evidence-backed reasons');
  assert(perfFirst.matrixSections.length >= 4);
  assert(perfFirst.quickDifferences.length >= 3);

  // Per-dimension winners on raw values.
  const ramRow = perfFirst.matrixSections.flatMap(s => s.rows).find(r => r.key === 'ramGb');
  assert.strictEqual(ramRow.winnerProductId, 'elec-macbook-pro', '18 GB beats 16 GB and 8 GB');
  const weightRow = perfFirst.matrixSections.flatMap(s => s.rows).find(r => r.key === 'weightKg');
  assert.strictEqual(weightRow.winnerProductId, 'elec-thinkpad', 'lighter wins weight');

  // ── 2. Market value from the laptop price/quality curve ──────────────────
  const xps = byTitle(/^Dell XPS 15 9530/);
  const airCurated = byTitle(/^Apple MacBook Air M2 13\.6 pouces/);
  const market = compare([airCurated, xps], { stats });
  assert.ok(market.analysis.market.valueCurve, 'laptops have a trusted value curve');
  assert.ok(market.analysis.marketValue[xps.id], 'market value computed');
  assert.ok(market.verdict.facts.some(f => f.kind === 'marketValue'), 'market value stated as a fact');
  assert.strictEqual(market.verdict.bestValue.basis, 'market-curve');

  // ── 3. Ranking rules ─────────────────────────────────────────────────────
  const phone = byTitle(/^Google Pixel 8a/);
  const speaker = byTitle(/^JBL Flip 6 Enceinte Bluetooth Portable Étanche/);
  const unrelated = compare([phone, speaker], { stats });
  assert.strictEqual(unrelated.compatibility.level, 'limited', 'phone vs speaker is not comparable');
  assert.strictEqual(unrelated.recommendation.recommendedProductId, null, 'no winner across unrelated kinds');
  assert.strictEqual(unrelated.recommendation.matchPercentage, null);

  const lone = compare([phone], { stats, locale: 'fr' });
  assert.strictEqual(lone.compatibility.level, 'insufficient');
  assert.ok(lone.verdict.warnings[0].includes('Ajoutez'), 'single product asks for another, in French');

  const spaceBuds = byTitle(/^Oraimo SpaceBuds/);
  const airpods = byTitle(/^Apple AirPods 4 Écouteurs/);
  const thin = compare([spaceBuds, airpods], { stats });
  assert.strictEqual(thin.analysis.rankingWithheld, 'no-shared-specs', 'price alone never makes a recommendation');
  assert.strictEqual(thin.recommendation.recommendedProductId, null);

  // Same laptop listed twice (seed + curated), same price: equivalent, no pick.
  const twin = compare([byId['macbook_m2'], byId['elec-1']], { stats });
  assert.strictEqual(twin.analysis.rankingWithheld, 'equivalent', 'no winner from rating noise');
  assert.strictEqual(twin.recommendation.recommendedProductId, null);

  // ── 4. Properties ────────────────────────────────────────────────────────
  // 4a. Order of ids never changes the outcome.
  const a = compare([air, pro, thinkpad], { stats, priorities: { battery: 5 } });
  const b = compare([thinkpad, air, pro], { stats, priorities: { battery: 5 } });
  assert.strictEqual(a.recommendation.recommendedProductId, b.recommendation.recommendedProductId, 'permutation invariant winner');
  for (const id of ['elec-1', 'elec-macbook-pro', 'elec-thinkpad']) {
    assert.strictEqual(a.analysis.scores[id].total, b.analysis.scores[id].total, `permutation invariant score for ${id}`);
  }

  // 4b. Deterministic.
  assert.deepStrictEqual(withoutMeta(compare([air, pro], { stats })), withoutMeta(compare([air, pro], { stats })));

  // 4c. Monotonic: more RAM, more battery or a lower price never lowers a total.
  const base = { 'Spécifications': 'Snapdragon 8 Gen 2 · 8GB RAM · 256GB', 'Batterie': '4500 mAh' };
  const rival = synthetic('rival', { price: 300000, attrs: { 'Spécifications': 'Snapdragon 8 Gen 3 · 12GB RAM · 256GB', 'Batterie': '5000 mAh' } });
  const p0 = synthetic('p', { price: 300000, attrs: base });
  const s0 = compare([p0, rival], { stats }).analysis.scores.p.total;
  const variants = [
    synthetic('p', { price: 300000, attrs: Object.assign({}, base, { 'Spécifications': 'Snapdragon 8 Gen 2 · 16GB RAM · 256GB' }) }),
    synthetic('p', { price: 300000, attrs: Object.assign({}, base, { 'Batterie': '5500 mAh' }) }),
    synthetic('p', { price: 250000, attrs: base })
  ];
  for (const v of variants) {
    const s1 = compare([v, rival], { stats }).analysis.scores.p.total;
    assert(s1 >= s0, `improving a spec never lowers the score (${s0} → ${s1})`);
  }

  // 4d. Dominance: better on every spec AND cheaper is said, and is a clear win.
  const strong = synthetic('strong', { price: 250000, attrs: { 'Spécifications': 'Snapdragon 8 Gen 3 · 12GB RAM · 512GB', 'Batterie': '5500 mAh' } });
  const weak = synthetic('weak', { price: 300000, attrs: { 'Spécifications': 'Helio G99 · 8GB RAM · 128GB', 'Batterie': '4500 mAh' } });
  const dom = compare([weak, strong], { stats });
  assert.strictEqual(dom.recommendation.recommendedProductId, 'strong');
  assert.ok(dom.analysis.dominance.some(d => d.dominantId === 'strong' && d.dominatedId === 'weak'));
  assert.strictEqual(dom.recommendation.decisiveness, 'clear');
  assert.ok(dom.verdict.facts.some(f => f.kind === 'dominance'));

  // 4e. Unknown stays unknown: a spec known for one product only is never scored.
  const noRam = synthetic('noram', { price: 280000, attrs: { 'Spécifications': 'Snapdragon 8 Gen 3 · 256GB', 'Batterie': '5000 mAh' } });
  const partial = compare([noRam, rival], { stats });
  assert(!partial.analysis.basis.dimensions.includes('ramGb'), 'RAM missing for one product is not scored');
  assert.ok(partial.analysis.basis.partial.some(p => p.key === 'ramGb'), 'and is reported as partial');

  // 4f. A tie under one priority names nobody (no alphabetical "winner").
  const twinA = synthetic('aaa', { price: 300000, attrs: { 'Spécifications': 'Snapdragon 8 Gen 3 · 12GB RAM · 256GB', 'Batterie': '5000 mAh' } });
  const twinB = synthetic('zzz', { price: 250000, attrs: { 'Spécifications': 'Snapdragon 8 Gen 3 · 12GB RAM · 128GB', 'Batterie': '4500 mAh' } });
  const tied = compare([twinA, twinB], { stats });
  assert.ok(tied.analysis.sensitivity, 'sensitivity computed');
  assert.strictEqual(tied.analysis.sensitivity.winnerIf.performance, undefined, 'same chip and RAM: no performance winner');
  assert(!/performance/.test(tied.verdict.summary || ''), 'summary never cites a tied priority');

  // 4g. Boutiques are shown side by side, never ranked.
  const shops = compare([
    fromStore({ id: 'store_a', title: 'Shop A', rating: 4.9, reviewsCount: 300, merchantCity: 'Douala', verified: true }),
    fromStore({ id: 'store_b', title: 'Shop B', rating: 4.5, reviewsCount: 40, merchantCity: 'Yaoundé', verified: true })
  ], { stats });
  assert.strictEqual(shops.compatibility.level, 'none');
  assert.strictEqual(shops.recommendation.recommendedProductId, null);
  assert.ok(/side by side/.test(shops.verdict.warnings[0]), 'shops get the side-by-side notice');

  // ── 5. Nothing invented ──────────────────────────────────────────────────
  const json = JSON.stringify(perfFirst);
  assert(!/whatsapp/i.test(json), 'no contact numbers in a comparison');
  assert(perfFirst.products.every(p => p.stockUnits === null && p.stockKnown === false), 'placeholder stock is reported unknown');
  assert(perfFirst.products.every(p => p.sellers.length >= 1), 'every product has its real offer');

  // ── 6. Priorities and locale ─────────────────────────────────────────────
  const pri = normalizePriorities({ performance: 9, delivery: 5, price: -2, bogus: 3, perf: 4 });
  assert.strictEqual(pri.priorities.performance, 4, 'alias perf → performance, clamped to 0..5');
  assert.strictEqual(pri.priorities.price, 0);
  assert.deepStrictEqual(pri.ignored.sort(), ['bogus', 'delivery']);

  const fr = compare([air, pro], { stats, locale: 'fr' });
  assert.strictEqual(fr.locale, 'fr');
  assert.ok(fr.verdict.facts.some(f => /contre/.test(f.text)), 'French verdict text');
  assert.ok(/FCFA/.test(fr.products[0].price), 'French money format');

  console.log('    ✓ Comparison Engine v2 passed.');
}

if (require.main === module) {
  run().catch(err => {
    console.error('FAILED:', err);
    process.exit(1);
  });
}

module.exports = { run };
