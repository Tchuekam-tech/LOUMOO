/**
 * LOUMOO — cross-origin isolation headers and HSTS preload, on every host
 * ---------------------------------------------------------------------------
 *   Cross-Origin-Opener-Policy    same-origin
 *   Cross-Origin-Embedder-Policy  credentialless      (NOT require-corp: see below)
 *   Cross-Origin-Resource-Policy  same-origin
 *   Strict-Transport-Security     max-age=31536000; includeSubDomains; preload
 *
 * 1. vercel.json (what the CDN sends for static files and for the function's responses) carries
 *    exactly the gateway's constants, every pre-existing header is still there unchanged, and
 *    the generator reproduces the file.
 * 2. The Express gateway (Railway, local, and the function behind Vercel) sends them on every
 *    kind of response: a page, a 404, a redirect, a static file, the sitemap, the API.
 * 3. The CSP is not touched: its hard lines are still there.
 *
 * WHY credentialless AND NOT require-corp (the brief asked for require-corp unless it breaks things)
 * Chrome, run against a page served with each policy on 2026-10-24, loading the kinds of
 * cross-origin resource the app loads:
 *
 *                                                           none   credentialless   require-corp
 *   <script> unpkg / cdnjs (React, MapLibre)                 ok        ok              ok
 *   fetch() with CORS: map style + raster tiles              ok        ok              ok
 *   <img> from a host that sends CORP: cross-origin          ok        ok              ok
 *   <img> from a host that sends NO CORP header (httpbin,
 *     placehold.co: valid PNGs, standing for any image URL
 *     the CSP's `img-src https:` allows)                     ok        ok              BLOCKED
 *   <img> on the Supabase Storage host (where sellers'
 *     photos live; its responses carry no CORP header)       ok        ok*             BLOCKED
 *   crossOriginIsolated                                      false     true            true
 *
 *   BLOCKED = net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
 *   * the probe URL answers 400 JSON, so it cannot decode as an image in any mode; the point is
 *     that the response is NOT blocked by the policy under credentialless.
 *
 * So require-corp would blank every seller photo and every externally hosted image on a
 * marketplace, to gain cross-origin isolation the app does not use. credentialless gives the same
 * isolation and loads them (it fetches cross-origin no-cors resources without cookies). Safari does
 * not implement it and ignores the header: nothing breaks there, the page is just not isolated.
 * No third-party iframe is used (no Clerk or Turnstile at runtime, only CSP entries), Vercel Web
 * Analytics is same-origin (/_vercel/insights/script.js, which Vercel itself sends with
 * CORP: cross-origin), and window.open is only called with noopener for external links, so COOP
 * same-origin has nothing to sever.
 */

require('../setup');
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const { DEFAULT_CSP, HSTS, CROSS_ORIGIN_HEADERS } = require('../../server/shared/middleware/securityHeaders');
const sync = require('../../scripts/sync_route_config');

const ROOT = path.resolve(__dirname, '../..');

function get(server, method, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: Object.assign({ 'sec-fetch-dest': 'document', accept: 'text/html', 'x-forwarded-proto': 'https' }, headers || {}) }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log('  Testing the cross-origin isolation headers and HSTS preload...');

  /* ── 1. vercel.json ─────────────────────────────────────────────────── */
  assert.deepStrictEqual(CROSS_ORIGIN_HEADERS, {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Cross-Origin-Resource-Policy': 'same-origin'
  }, 'COEP is credentialless, not require-corp: require-corp blocks every image whose host sends no CORP header (Supabase Storage, arbitrary https images); see this file\'s header');
  assert.strictEqual(HSTS, 'max-age=31536000; includeSubDomains; preload');

  const text = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
  const vercel = JSON.parse(text);
  assert.strictEqual(sync.buildVercel(vercel), text.replace(/\r\n/g, '\n'), 'the generator reproduces vercel.json');
  const sitewide = vercel.headers.find((h) => h.source === '/(.*)');
  const value = (key) => (sitewide.headers.find((h) => h.key === key) || {}).value;
  assert.strictEqual(value('Strict-Transport-Security'), HSTS);
  for (const key of Object.keys(CROSS_ORIGIN_HEADERS)) assert.strictEqual(value(key), CROSS_ORIGIN_HEADERS[key], `vercel.json sends ${key}`);

  // Every header that was there is still there, unchanged, in the same order; the new ones come after.
  assert.deepStrictEqual(sitewide.headers.map((h) => h.key), [
    'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Strict-Transport-Security',
    'Cross-Origin-Opener-Policy', 'Cross-Origin-Embedder-Policy', 'Cross-Origin-Resource-Policy'
  ], 'existing headers keep their order; the isolation headers are appended');
  assert.strictEqual(value('X-Content-Type-Options'), 'nosniff');
  assert.strictEqual(value('X-Frame-Options'), 'DENY');
  assert.strictEqual(value('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.strictEqual(value('Permissions-Policy'), 'microphone=(self), camera=(self)');
  // The other rules are exactly what they were: the static assets' cache rule, the 404 noindex, the CSP rules.
  assert.deepStrictEqual(vercel.headers.map((h) => h.source), ['/Assets/(.*)', '/(.*)', '/', '/404.html', '/(a-propos|acheter-en-ligne-cameroun|marketplace-cameroun|vendre-en-ligne-cameroun)']);
  assert.deepStrictEqual(vercel.headers.find((h) => h.source === '/404.html').headers, [{ key: 'X-Robots-Tag', value: 'noindex' }]);
  assert.deepStrictEqual(vercel.headers.find((h) => h.source === '/').headers, [{ key: 'Content-Security-Policy', value: DEFAULT_CSP }]);
  console.log('    ✓ vercel.json: HSTS has preload, the three isolation headers are appended, nothing else moved');

  /* ── 3. the CSP keeps its hard lines (and is the one on both hosts) ─── */
  for (const line of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
    assert.ok(DEFAULT_CSP.includes(line), `the CSP still says ${line}`);
  }
  assert.ok(DEFAULT_CSP.startsWith("default-src 'self'; script-src 'self' blob: 'unsafe-eval'"), 'and starts as it did');
  console.log('    ✓ the CSP is untouched: object-src, base-uri, form-action and frame-ancestors are still there');

  /* ── 2. the gateway ─────────────────────────────────────────────────── */
  const app = require('../../server/index');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const cases = [
      ['a page', 'GET', '/marketplace'],
      ['the home page', 'GET', '/'],
      ['an unknown route (404)', 'GET', '/this-route-does-not-exist'],
      ['a missing file (plain 404)', 'GET', '/rider/src/services/riderHub.js', { accept: '*/*', 'sec-fetch-dest': 'script' }],
      ['a legacy product URL (301)', 'GET', '/product/phone_google_google_pixel_8_pro_128gb_unlocke_17'],
      ['a legacy alias (308)', 'GET', '/login'],
      ['a static file', 'GET', '/src/routing/routes.js', { accept: '*/*', 'sec-fetch-dest': 'script' }],
      ['the sitemap', 'GET', '/sitemap.xml', { accept: '*/*' }],
      ['the API', 'GET', '/api/v1/health', { accept: 'application/json' }]
    ];
    for (const [what, method, url, headers] of cases) {
      const res = await get(server, method, url, headers);
      for (const key of Object.keys(CROSS_ORIGIN_HEADERS)) assert.strictEqual(res.headers[key.toLowerCase()], CROSS_ORIGIN_HEADERS[key], `${what}: ${key}`);
      assert.strictEqual(res.headers['strict-transport-security'], HSTS, `${what}: HSTS over https carries preload`);
      assert.strictEqual(res.headers['content-security-policy'], DEFAULT_CSP, `${what}: the CSP is the same one`);
      assert.strictEqual(res.headers['x-frame-options'], 'DENY', `${what}: X-Frame-Options is still sent`);
    }
    // HSTS is a promise about https only: plain http does not get it.
    const plain = await get(server, 'GET', '/marketplace', { 'x-forwarded-proto': 'http' });
    assert.ok(!plain.headers['strict-transport-security'], 'no HSTS on a plain-http response');
    assert.strictEqual(plain.headers['cross-origin-opener-policy'], 'same-origin', 'but the isolation headers are not conditional');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(`    ✓ the gateway sends all four on ${9} kinds of response (page, 404, file 404, 301, 308, static, sitemap, API); HSTS only over https`);
}

module.exports = { run };
