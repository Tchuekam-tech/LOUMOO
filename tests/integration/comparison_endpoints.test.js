/**
 * LOUMOO Integration Tests — Product Comparison REST Endpoints
 */

require('../setup');
const assert = require('assert');
const harness = require('../helpers/harness');

async function run() {
  console.log('  Testing Comparison REST endpoints, candidate discovery & priority query handling...');

  await harness.start();

  // 1. Two-Product Head-to-Head Comparison
  const compRes = await harness.request('GET', '/api/v1/catalog/compare?ids=elec-1,elec-macbook-pro');
  assert.strictEqual(compRes.status, 200);
  assert.strictEqual(compRes.body.success, true);
  const data = compRes.body.data;
  assert.strictEqual(data.productCount, 2);
  assert.ok(data.verdict);
  assert.ok(data.verdict.bestOverall);
  assert.ok(data.recommendation);
  assert.ok(data.quickDifferences.length >= 3);
  assert.ok(data.matrixSections.length >= 4);
  assert.strictEqual(data.engineVersion, '2.0.0');
  assert.deepStrictEqual(data.unresolved, []);
  assert.ok(data.analysis && data.analysis.scores, 'v2 analysis present');

  // 1b. Unknown ids are reported, never silently dropped or invented.
  const partialRes = await harness.request('GET', '/api/v1/catalog/compare?ids=elec-1,elec-macbook-pro,nonexistent_zz');
  assert.strictEqual(partialRes.status, 200);
  assert.strictEqual(partialRes.body.data.productCount, 2);
  assert.deepStrictEqual(partialRes.body.data.unresolved, [{ id: 'nonexistent_zz', reason: 'not_found' }]);

  // 1c. ?lang=fr returns a French verdict.
  const frRes = await harness.request('GET', '/api/v1/catalog/compare?ids=elec-1,elec-macbook-pro&lang=fr');
  assert.strictEqual(frRes.body.data.locale, 'fr');

  // 2. Three-Product Comparison with Personalized Priorities Query String
  const threeCompRes = await harness.request(
    'GET',
    '/api/v1/catalog/compare?ids=elec-1,elec-macbook-pro,elec-thinkpad&priorities=' +
      encodeURIComponent(JSON.stringify({ performance: 5, display: 5, price: 1 }))
  );
  assert.strictEqual(threeCompRes.status, 200);
  assert.strictEqual(threeCompRes.body.data.productCount, 3);
  assert.strictEqual(threeCompRes.body.data.recommendation.recommendedProductId, 'elec-macbook-pro');

  // 3. Alternative route /api/v1/products/compare alias
  const aliasRes = await harness.request('GET', '/api/v1/products/compare?ids=elec-1,elec-thinkpad');
  assert.strictEqual(aliasRes.status, 200);
  assert.strictEqual(aliasRes.body.data.productCount, 2);

  // 4. Missing IDs returns 400 ValidationError
  const missingRes = await harness.request('GET', '/api/v1/catalog/compare');
  assert.strictEqual(missingRes.status, 400);

  // 5. Non-existent IDs returns 404 NotFoundError
  const notFoundRes = await harness.request('GET', '/api/v1/catalog/compare?ids=nonexistent_1,nonexistent_2');
  assert.strictEqual(notFoundRes.status, 404);

  // 6. Compare Candidates Discovery Endpoint
  const candRes = await harness.request('GET', '/api/v1/catalog/compare/candidates?category=Electronics&currentId=elec-1');
  assert.strictEqual(candRes.status, 200);
  assert.strictEqual(candRes.body.success, true);
  assert.ok(Array.isArray(candRes.body.data.items));
  assert(candRes.body.data.items.length >= 2);
  assert(!candRes.body.data.items.some(i => i.id === 'elec-1'), 'Current product excluded from candidates');

  // 7. Compare Candidates Search Query
  const searchCandRes = await harness.request('GET', '/api/v1/catalog/compare/candidates?search=thinkpad');
  assert.strictEqual(searchCandRes.status, 200);
  assert(searchCandRes.body.data.items.some(i => i.id === 'elec-thinkpad'));

  console.log('    ✓ Comparison REST endpoints passed all assertions.');
}

if (require.main === module) {
  run().then(() => harness.stop()).catch(err => {
    console.error('FAILED:', err);
    harness.stop().then(() => process.exit(1));
  });
}

module.exports = { run };
