/**
 * LOUMOO — GET /api/v1/products/:id answers 404 for an id it does not know
 * ---------------------------------------------------------------------------
 * The product detail lookup used to fuzzy-match a near-miss id onto another
 * curated product and, failing that, invent an 85,000 FCFA "LOUMOO Official
 * Store" product in stock x1000, so the product page could never 404 and the
 * buyer could be shown (and add to the bag) a product nobody sells.
 *
 * Drives the real catalog router over a real HTTP server with the real error
 * handler. No database: the listings lookup fails closed and only the curated
 * catalogue answers, which is the case the fabrication lived in.
 */

require('../setup');

const assert = require('assert');
const http = require('http');
const express = require('express');

const errorHandler = require('../../server/shared/middleware/errorHandler');
const catalogRoutes = require('../../server/modules/catalog/routes/catalogRoutes');

const CURATED = 'laptop_apple_apple_macbook_pro_14_m3_pro_gris_2';

function startServer() {
  const app = express();
  app.use('/api/v1', catalogRoutes);
  app.use(errorHandler);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function getJson(server, path) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}

async function testUnknownIdIs404(server) {
  const { status, body } = await getJson(server, '/api/v1/products/does-not-exist');
  assert.strictEqual(status, 404, 'an unknown id is a 404');
  assert.ok(body && body.success === false, 'with an error body, not a product');
  assert.ok(!body.data, 'and no product data at all');
}

async function testSeedDemoIdIs404(server) {
  // The id the cart used to turn into an 85,000 XAF "Elec Macbook Pro" line.
  const { status } = await getJson(server, '/api/v1/products/elec-macbook-pro');
  assert.strictEqual(status, 404, 'a demo seed id is not a product');
}

async function testNearMissIsNotAnotherProduct(server) {
  for (const id of [CURATED.slice(0, -4), CURATED + '_x', CURATED.replace(/_/g, '-')]) {
    const { status } = await getJson(server, '/api/v1/products/' + encodeURIComponent(id));
    assert.strictEqual(status, 404, `"${id}" does not open another product's page`);
  }
}

async function testExactCuratedIdStillResolves(server) {
  const { status, body } = await getJson(server, '/api/v1/products/' + CURATED);
  assert.strictEqual(status, 200, 'an exact curated id resolves');
  assert.strictEqual(body.data.id, CURATED);
  assert.strictEqual(body.data.priceNumeric, 1395000, 'at its own price');
  assert.ok(/MacBook Pro/i.test(body.data.title), 'and its own title');
}

(async () => {
  const server = await startServer();
  try {
    await testUnknownIdIs404(server);
    await testSeedDemoIdIs404(server);
    await testNearMissIsNotAnotherProduct(server);
    await testExactCuratedIdStillResolves(server);
    console.log('product_detail_not_found: 4 checks passed');
  } finally {
    server.close();
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
