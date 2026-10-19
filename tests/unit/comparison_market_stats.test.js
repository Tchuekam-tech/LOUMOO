/**
 * LOUMOO Unit Tests — Comparison v2 market layer: product types, identity,
 * chip index, scoring maths, category statistics and price/quality curves.
 */

require('../setup');
const assert = require('assert');
const { catalogProducts } = require('../../server/modules/catalog/dataLoader');
const { fromCurated } = require('../../server/modules/catalog/domain/comparison/productAdapter');
const { classify } = require('../../server/modules/catalog/domain/comparison/productTypes');
const { identityKey, stripCopyMarker } = require('../../server/modules/catalog/domain/comparison/productIdentity');
const { lookupChip } = require('../../server/modules/catalog/domain/comparison/chipIndex');
const { percentileOf, bayesianRating, priorityMultiplier } = require('../../server/modules/catalog/domain/comparison/scoring');
const { CategoryStats, distribution, fitLine } = require('../../server/modules/catalog/domain/comparison/categoryStats');

async function run() {
  console.log('  Testing comparison market layer (types, identity, stats, curves)...');

  // ── Product types: keyword rules stay inside their department ────────────
  assert.strictEqual(classify({ title: 'Kraasa Bottines Chelsea Homme Micro-Daim', category: 'fashion', subcategory: 'footwear' }).type, 'footwear');
  assert.strictEqual(classify({ title: 'Riz Parfumé Jasmin Sac 25kg', category: 'groceries', subcategory: 'pantry' }).type, 'grocery');
  assert.strictEqual(classify({ title: 'Apple AirPods Max Casque', category: 'electronics', subcategory: 'audio' }).type, 'headphones');
  assert.strictEqual(classify({ title: 'Apple AirPods 4 Écouteurs', category: 'electronics', subcategory: 'audio' }).type, 'earbuds');
  assert.strictEqual(classify({ title: 'JBL Flip 6 Enceinte', category: 'electronics', subcategory: 'audio' }).type, 'speaker');
  assert.strictEqual(classify({ title: 'Anker 737 Power Bank 24000mAh', category: 'electronics', subcategory: 'power_accessories' }).type, 'power_bank');
  assert.strictEqual(classify({ title: 'Orca', entityType: 'store' }).type, 'store');
  assert.strictEqual(classify({ title: 'Mystery', category: 'toys', subcategory: 'blocks' }).type, 'other:blocks');

  // ── Identity: catalogue copies are one product ───────────────────────────
  assert.strictEqual(stripCopyMarker('Google Pixel 8a 128GB Bay Blue (#4)'), 'Google Pixel 8a 128GB Bay Blue');
  assert.strictEqual(stripCopyMarker('MacBook Air M2 (8GB RAM / 256GB SSD) (Configuration Pro #1)'), 'MacBook Air M2 (8GB RAM / 256GB SSD)');
  assert.strictEqual(identityKey({ brand: 'Apple', title: 'iPhone 15 128GB' }), identityKey({ brand: 'Apple', title: 'Apple iPhone 15 128GB (#3)' }));
  const curated = Object.keys(catalogProducts).map(id => fromCurated(id, catalogProducts[id]));
  const identities = new Set(curated.map(identityKey));
  assert(identities.size < curated.length / 3, `copies collapse: ${curated.length} listings → ${identities.size} products`);

  // ── Chip index ───────────────────────────────────────────────────────────
  assert.strictEqual(lookupChip('Google Tensor G5 avec puce de sécurité Titan M2').id, 'tensor-g5', 'Titan M2 is not an Apple M2');
  assert.strictEqual(lookupChip('Puce M3 Pro 11-core CPU').id, 'apple-m3-pro');
  assert.strictEqual(lookupChip('Puce Apple M3 8-core CPU').id, 'apple-m3');
  assert.strictEqual(lookupChip('Exynos 2600 / Snapdragon 8 Gen 4 Ultra').id, 'sd-8-elite');
  assert.strictEqual(lookupChip('Processeur maison inconnu'), null, 'unknown chips stay unknown');
  assert(lookupChip('Snapdragon 8 Gen 3').index > lookupChip('Helio G99').index);

  // ── Scoring maths ────────────────────────────────────────────────────────
  assert.strictEqual(percentileOf([1, 2, 3, 4], 4), 87.5, 'midrank percentile');
  assert.strictEqual(percentileOf([5, 5, 5, 5], 5), 50, 'ties sit in the middle');
  assert.strictEqual(bayesianRating(5, 0, { mean: 4, weight: 20 }), 4, 'no reviews → the type mean');
  assert(Math.abs(bayesianRating(5, 20, { mean: 4, weight: 20 }) - 4.5) < 1e-9, 'equal evidence → halfway');
  assert.strictEqual(priorityMultiplier({ battery: 5 }, 'battery'), 5 / 3);
  assert.strictEqual(priorityMultiplier({}, 'battery'), 1, 'unset priority is neutral');

  // ── Distributions: template numbers vs rare features ─────────────────────
  assert.strictEqual(distribution([18, 18, 18, 18, 9], 'number').uniform, true, '"Jusqu\'à 18h" on most laptops is template');
  assert.strictEqual(distribution([1, 0, 0, 0, 0, 0, 0, 0], 'boolean').uniform, false, 'a rare yes/no feature is signal');
  assert.strictEqual(distribution([1, 1, 1, 1], 'boolean').uniform, true, 'a feature everyone has does not separate');

  // ── Regression ───────────────────────────────────────────────────────────
  const line = fitLine([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }, { x: 3, y: 7 }]);
  assert(Math.abs(line.b - 2) < 1e-9 && Math.abs(line.a - 1) < 1e-9 && Math.abs(line.r2 - 1) < 1e-9, 'exact line recovered');

  // ── Category statistics over the real catalogue ──────────────────────────
  const stats = CategoryStats.build(curated);
  const laptops = stats.typeStats('laptop');
  assert.ok(laptops.valueCurve, 'laptop price rises with quality');
  assert(laptops.valueCurve.b > 0 && laptops.valueCurve.r2 >= 0.25 && laptops.valueCurve.n >= 8);
  assert.strictEqual(laptops.dims.batteryHours.uniform, true, 'the 18h laptop boilerplate is detected');
  for (const [type, ts] of stats.types) {
    if (ts.valueCurve) assert(ts.valueCurve.r2 >= 0.25 && ts.valueCurve.b > 0, `${type} curve meets the trust bar`);
    else assert.ok(ts.valueCurveRejected, `${type} says why it has no curve`);
  }

  // Cheaper than the curve = better value; dearer = worse.
  const q = { q: 60, coverage: 1 };
  const expected = Math.exp(laptops.valueCurve.a + laptops.valueCurve.b * 60);
  const cheap = stats.valueAssessment('laptop', expected * 0.7, q);
  const dear = stats.valueAssessment('laptop', expected * 1.3, q);
  assert(cheap.deviation < 0 && dear.deviation > 0);
  assert(cheap.score > dear.score, 'below-curve price scores as better value');
  assert.strictEqual(stats.valueAssessment('laptop', expected, { q: 60, coverage: 0.2 }), null, 'too little known quality → no claim');

  // Copies that disagree on a spec are recorded, and kept out of market stats.
  const camon = [...stats.identities.values()].find(i => /tecno camon 50 pro/.test(i.key));
  assert.ok(camon.conflicts.batteryMah, 'Camon 50 Pro copies disagree on battery');
  assert.strictEqual(camon.values.batteryMah, null, 'a contradicted spec is not market evidence');
  assert.ok(camon.statedValues.batteryMah, 'but what the listings state is kept');

  // Offers are one per seller at the lowest price.
  assert.strictEqual(camon.offers.length, 1, 'all copies are one NanoAfrica offer');
  assert.strictEqual(camon.offers[0].price, Math.min(...curated.filter(p => identityKey(p) === camon.key).map(p => p.price)));

  console.log('    ✓ Comparison market layer passed.');
}

if (require.main === module) {
  run().catch(err => {
    console.error('FAILED:', err);
    process.exit(1);
  });
}

module.exports = { run };
