/**
 * LOUMOO — API hardening (Priority 3, items 8-10).
 * ---------------------------------------------------------------------------
 *   8. Pagination is clamped server-side (default 24, max 100, page>=1, offset>=0).
 *   9. GET /api/v1/products/:id is a real 404 for an unknown id (no 200 synthetic
 *      fallback), and 503 when the DB is unavailable — never a fabricated product.
 *  10. GET /api/config exposes only public-safe values; no secret ever leaks.
 *
 * Hermetic: no database is configured, so the product lookup's DB branch is
 * unavailable (503), and the catalogue list falls back to the curated set — both
 * exactly the behaviours we want to pin. The 404/200 product paths are proven by
 * stubbing the repository.
 */

require('../setup');
const assert = require('assert');
const http = require('http');

const { clampPagination } = require('../../server/shared/http/pagination');
const CatalogRepository = require('../../server/modules/catalog/infrastructure/CatalogRepository');

async function run() {
  /* ── 8a. Pure clamp ────────────────────────────────────────────────────── */
  assert.deepStrictEqual(clampPagination({}), { page: 1, limit: 24, offset: 0 }, 'defaults');
  assert.strictEqual(clampPagination({ limit: '999999' }).limit, 100, 'limit capped at 100');
  assert.strictEqual(clampPagination({ limit: '0' }).limit, 24, 'zero limit -> default');
  assert.strictEqual(clampPagination({ limit: '-5' }).limit, 24, 'negative limit -> default');
  assert.strictEqual(clampPagination({ limit: 'abc' }).limit, 24, 'non-numeric limit -> default');
  assert.strictEqual(clampPagination({ page: '0' }).page, 1, 'zero page -> 1');
  assert.strictEqual(clampPagination({ page: '-3' }).page, 1, 'negative page -> 1');
  assert.deepStrictEqual(clampPagination({ page: '3', limit: '10' }), { page: 3, limit: 10, offset: 20 }, 'offset from page');
  assert.strictEqual(clampPagination({ offset: '-5' }).offset, 0, 'negative offset -> 0');
  assert.strictEqual(clampPagination({}, { defaultLimit: 8, maxLimit: 50 }).limit, 8, 'custom default');
  assert.strictEqual(clampPagination({ limit: '999' }, { maxLimit: 50 }).limit, 50, 'custom max');

  /* ── boot the app for the HTTP-level checks ────────────────────────────── */
  const app = require('../../server/index');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const getJson = async (p) => { const r = await fetch(`${base}${p}`); return { status: r.status, body: await r.json().catch(() => null) }; };

  try {
    /* ── 8b. /api/v1/products clamps (curated fallback still echoes page/limit) ── */
    let r = await getJson('/api/v1/products');
    assert.strictEqual(r.status, 200, '/products is 200');
    assert.strictEqual(r.body.data.limit, 24, 'default page size is 24');
    assert.strictEqual(r.body.data.page, 1, 'default page is 1');

    r = await getJson('/api/v1/products?limit=999999');
    assert.strictEqual(r.body.data.limit, 100, '?limit=999999 is clamped to 100 (not the whole catalogue)');

    r = await getJson('/api/v1/products?limit=0');
    assert.strictEqual(r.body.data.limit, 24, '?limit=0 falls back to the default');

    r = await getJson('/api/v1/products?limit=-5');
    assert.strictEqual(r.body.data.limit, 24, '?limit=-5 falls back to the default');

    r = await getJson('/api/v1/products?page=0');
    assert.strictEqual(r.body.data.page, 1, '?page=0 is normalised to 1');

    r = await getJson('/api/v1/products?page=2&limit=10');
    assert.strictEqual(r.body.data.page, 2);
    assert.strictEqual(r.body.data.limit, 10);

    /* ── 9a. Unknown product while a CONFIGURED DB fails → 503, NOT a 200 synthetic ──
       (With no database configured at all the curated catalogue is the whole
       catalogue, so an unknown id is a 404: tests/unit/product_detail_not_found.test.js.) */
    const failingQuery = new Proxy({}, {
      get: (_t, prop) => (prop === 'maybeSingle'
        ? async () => ({ data: null, error: { message: 'connection refused' } })
        : () => failingQuery)
    });
    const hasDbDesc = Object.getOwnPropertyDescriptor(CatalogRepository, 'hasDatabase');
    const dbDesc = Object.getOwnPropertyDescriptor(CatalogRepository, 'db');
    Object.defineProperty(CatalogRepository, 'hasDatabase', { get: () => true, configurable: true });
    Object.defineProperty(CatalogRepository, 'db', { get: () => ({ from: () => failingQuery }), configurable: true });
    try {
      r = await getJson('/api/v1/products/this-id-does-not-exist-anywhere');
      assert.strictEqual(r.status, 503, 'a failing DB makes the product API 503 — never a fabricated 200 or a wrongful 404');
      assert.strictEqual(r.body.error.code, 'PRODUCT_LOOKUP_UNAVAILABLE');

      // A curated product is static data: it is still served through the outage.
      r = await getJson('/api/v1/products/laptop_apple_apple_macbook_pro_14_m3_pro_gris_2');
      assert.strictEqual(r.status, 200, 'a real curated product survives a DB outage');
      assert.strictEqual(r.body.data.id, 'laptop_apple_apple_macbook_pro_14_m3_pro_gris_2');
    } finally {
      Object.defineProperty(CatalogRepository, 'hasDatabase', hasDbDesc);
      Object.defineProperty(CatalogRepository, 'db', dbDesc);
    }

    /* ── 9b. Unknown product (DB reachable, no row) → real 404 ──────────────── */
    const orig = CatalogRepository.findIndexableProductByIdOrSlug;
    CatalogRepository.findIndexableProductByIdOrSlug = async () => null;
    try {
      r = await getJson('/api/v1/products/known-missing-404-id');
      assert.strictEqual(r.status, 404, 'an unknown product is a real 404');
    } finally { CatalogRepository.findIndexableProductByIdOrSlug = orig; }

    /* ── 9c. Real product → 200 ─────────────────────────────────────────────── */
    CatalogRepository.findIndexableProductByIdOrSlug = async () => ({ id: 'ok1', title: 'Real Product', priceNumeric: 1000, currency: 'XAF' });
    try {
      r = await getJson('/api/v1/products/real-product-ok-id');
      assert.strictEqual(r.status, 200, 'a real product is 200');
      assert.strictEqual(r.body.data.title, 'Real Product');
    } finally { CatalogRepository.findIndexableProductByIdOrSlug = orig; }

    /* ── 10. /api/config exposes only public-safe values, never a secret ───── */
    r = await getJson('/api/config');
    assert.strictEqual(r.status, 200, '/api/config is 200');
    for (const k of ['supabase', 'clerk', 'posthog', 'sentry']) {
      assert.ok(Object.prototype.hasOwnProperty.call(r.body, k), `/api/config exposes ${k}`);
    }
    assert.ok(Object.prototype.hasOwnProperty.call(r.body.supabase, 'anonKey'), 'exposes the supabase anon key');
    assert.ok(!('serviceRoleKey' in r.body.supabase), 'never exposes the service role key');
    assert.ok(!('secretKey' in r.body.clerk), 'never exposes the Clerk secret key');
    const blob = JSON.stringify(r.body).toLowerCase();
    for (const forbidden of ['service_role', 'servicerole', 'secretkey', 'secret_key', 'jwtsecret', 'jwt_secret', 'webhooksecret', 'webhook_secret', 'clerk_secret']) {
      assert.ok(!blob.includes(forbidden), `/api/config must not contain "${forbidden}"`);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('api_hardening: all assertions passed');
}

module.exports = { run };

if (require.main === module) {
  run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
