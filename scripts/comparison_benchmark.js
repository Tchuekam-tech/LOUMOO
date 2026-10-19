#!/usr/bin/env node
/**
 * Comparison engine v2 — benchmark and catalogue-wide sweep.
 *
 *   node scripts/comparison_benchmark.js
 *
 * 1. Times the one-off market statistics build.
 * 2. Runs EVERY pair of distinct products of the same type in the curated
 *    catalogue (plus random 3- and 4-product sets) through the engine and
 *    fails if any comparison throws, yields NaN, or scores outside 0–100.
 * 3. Reports p50 / p95 / p99 / max latency per comparison.
 *
 * Exit code is non-zero on any invariant violation.
 */

const path = require('path');
process.chdir(path.resolve(__dirname, '..'));

const { catalogProducts, products: seed } = require('../server/modules/catalog/dataLoader');
const { fromCurated, fromSeed } = require('../server/modules/catalog/domain/comparison/productAdapter');
const { classify } = require('../server/modules/catalog/domain/comparison/productTypes');
const { identityKey } = require('../server/modules/catalog/domain/comparison/productIdentity');
const { CategoryStats } = require('../server/modules/catalog/domain/comparison/categoryStats');
const { compare } = require('../server/modules/catalog/domain/comparison/ComparisonEngineV2');

const catalog = [
  ...Object.keys(catalogProducts).map(id => fromCurated(id, catalogProducts[id])),
  ...(seed.electronics || []).map(p => fromSeed(p, 'electronics'))
];

let t = process.hrtime.bigint();
const stats = CategoryStats.build(catalog);
const buildMs = Number(process.hrtime.bigint() - t) / 1e6;

// One representative listing per product identity, grouped by type.
const seen = new Set();
const byType = {};
for (const p of catalog) {
  const k = identityKey(p);
  if (seen.has(k)) continue;
  seen.add(k);
  const { type } = classify(p);
  (byType[type] = byType[type] || []).push(p);
}

const sets = [];
for (const list of Object.values(byType)) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) sets.push([list[i], list[j]]);
  }
}
// Deterministic pseudo-random larger sets.
let seedN = 42;
const rnd = () => ((seedN = (seedN * 1103515245 + 12345) % 2147483648) / 2147483648);
const big = Object.values(byType).filter(l => l.length >= 4);
for (let n = 0; n < 200; n++) {
  const list = big[Math.floor(rnd() * big.length)];
  const size = 3 + Math.floor(rnd() * 2);
  const pick = new Set();
  while (pick.size < size) pick.add(list[Math.floor(rnd() * list.length)]);
  sets.push([...pick]);
}

const violations = [];
const times = [];
let ranked = 0;
let withheld = 0;
const priorityProfiles = [{}, { price: 5 }, { performance: 5, battery: 5 }, { value: 5, price: 1 }];

for (const [n, set] of sets.entries()) {
  const priorities = priorityProfiles[n % priorityProfiles.length];
  const locale = n % 2 ? 'fr' : 'en';
  let r;
  t = process.hrtime.bigint();
  try {
    r = compare(set, { stats, priorities, locale });
  } catch (err) {
    violations.push(`threw on [${set.map(p => p.id)}]: ${err.message}`);
    continue;
  }
  times.push(Number(process.hrtime.bigint() - t) / 1e6);

  // JSON.stringify turns NaN into null, so walk the numbers themselves.
  const bad = [];
  (function walk(v, at) {
    if (typeof v === 'number' && !Number.isFinite(v)) bad.push(at);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
  })(r, 'result');
  if (bad.length) violations.push(`non-finite number at ${bad[0]} in [${set.map(p => p.id)}]`);
  for (const [id, s] of Object.entries(r.analysis.scores)) {
    if (s.total !== null && (s.total < 0 || s.total > 100)) violations.push(`score ${s.total} out of range for ${id}`);
  }
  const m = r.recommendation.matchPercentage;
  if (m !== null && (m < 0 || m > 100)) violations.push(`matchPercentage ${m} out of range`);
  if (r.recommendation.recommendedProductId) ranked++;
  if (r.analysis.rankingWithheld) withheld++;
  if (r.recommendation.recommendedProductId && !r.recommendation.topReasons.length && r.verdict.facts.every(f => f.kind !== 'advantage')) {
    violations.push(`winner without any evidence in [${set.map(p => p.id)}]`);
  }
}

times.sort((a, b) => a - b);
const q = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))].toFixed(2);

console.log(`Market statistics build: ${buildMs.toFixed(0)} ms over ${catalog.length} listings (${stats.identities.size} products)`);
console.log(`Comparisons run: ${times.length}  ranked: ${ranked}  withheld (no shared specs, or equivalent): ${withheld}`);
console.log(`Latency per comparison (ms): p50 ${q(0.5)}  p95 ${q(0.95)}  p99 ${q(0.99)}  max ${times[times.length - 1].toFixed(2)}`);
if (violations.length) {
  console.error(`\n${violations.length} invariant violation(s):`);
  violations.slice(0, 20).forEach(v => console.error(`  - ${v}`));
  process.exit(1);
}
console.log('Invariants: OK (no throw, no NaN, scores and match within 0–100, every winner has evidence)');
