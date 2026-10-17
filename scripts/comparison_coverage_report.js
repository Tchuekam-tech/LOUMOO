#!/usr/bin/env node
/**
 * Comparison engine — spec coverage report over the curated catalogue.
 *
 *   node scripts/comparison_coverage_report.js            summary per type
 *   node scripts/comparison_coverage_report.js --json     machine-readable
 *   node scripts/comparison_coverage_report.js --type=smartphone --missing
 *                                                          list products missing a dimension
 *
 * For every product type: how many distinct products (copies grouped), and for
 * each dimension the share of products where a value was found, plus the
 * average confidence. This is the number that says whether a comparison in that
 * type can be trusted.
 */

const path = require('path');
process.chdir(path.resolve(__dirname, '..'));

const { catalogProducts, products: seed } = require('../server/modules/catalog/dataLoader');
const { fromCurated, fromSeed } = require('../server/modules/catalog/domain/comparison/productAdapter');
const { classify } = require('../server/modules/catalog/domain/comparison/productTypes');
const { identityKey } = require('../server/modules/catalog/domain/comparison/productIdentity');
const { profileFor } = require('../server/modules/catalog/domain/comparison/categoryProfiles');
const { extract } = require('../server/modules/catalog/domain/comparison/specExtractor');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const onlyType = (args.find(a => a.startsWith('--type=')) || '').slice(7) || null;
const showMissing = args.includes('--missing');

const all = [
  ...Object.keys(catalogProducts).map(id => fromCurated(id, catalogProducts[id])),
  ...(seed.electronics || []).map(p => fromSeed(p, 'electronics'))
];

const seen = new Set();
const unique = [];
for (const p of all) {
  const key = identityKey(p);
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(p);
}

const byType = {};
for (const p of unique) {
  const { type } = classify(p);
  (byType[type] = byType[type] || []).push(p);
}

const report = {};
for (const [type, list] of Object.entries(byType)) {
  if (onlyType && type !== onlyType) continue;
  const profile = profileFor(type);
  const dims = {};
  for (const d of profile) dims[d.key] = { found: 0, confidence: 0, missing: [] };
  for (const p of list) {
    const values = extract(p, profile);
    for (const d of profile) {
      const v = values[d.key];
      if (v) {
        dims[d.key].found++;
        dims[d.key].confidence += v.confidence;
      } else {
        dims[d.key].missing.push(p.title);
      }
    }
  }
  report[type] = {
    products: list.length,
    dimensions: Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, {
      coverage: +(v.found / list.length).toFixed(2),
      avgConfidence: v.found ? +(v.confidence / v.found).toFixed(2) : null,
      missing: showMissing ? v.missing : undefined
    }]))
  };
}

if (asJson) {
  console.log(JSON.stringify({ listings: all.length, distinctProducts: unique.length, types: report }, null, 2));
} else {
  console.log(`Listings: ${all.length}   distinct products: ${unique.length}\n`);
  for (const [type, r] of Object.entries(report).sort((a, b) => b[1].products - a[1].products)) {
    console.log(`${type} (${r.products})`);
    for (const [k, v] of Object.entries(r.dimensions)) {
      const bar = '█'.repeat(Math.round(v.coverage * 10)).padEnd(10, '·');
      console.log(`  ${k.padEnd(18)} ${bar} ${String(Math.round(v.coverage * 100)).padStart(3)}%  conf ${v.avgConfidence ?? '—'}`);
      if (showMissing && v.missing && v.missing.length) v.missing.forEach(t => console.log(`      missing: ${t}`));
    }
  }
}
