/**
 * LOUMOO — what a RENDERING crawler ends up with: the head after the app mounts.
 * ---------------------------------------------------------------------------
 * Googlebot runs the app. The server prerenders the right head (entity title,
 * JSON-LD, a 404's noindex, a category's own title), but the browser router used
 * to rewrite it on first load with the route-level fallback for every route except
 * product/store — so a soft-404's noindex or a category title the server wrote was
 * gone from the DOM Google indexes. This drives the real gateway (server/index.js,
 * with its real CSP) in Chromium and reads the head once the app has mounted:
 *
 *   1. a curated product keeps its title, canonical, robots and Product JSON-LD;
 *   2. an unknown category keeps the server's noindex;
 *   3. a category keeps its own title; every canonical is on the canonical origin;
 *   4. in-app navigation still updates the head (the router was not disabled);
 *   5. the gateway CSP lets the delivery map load MapLibre (cdnjs) and fetch tiles
 *      and geocoding, and still blocks an arbitrary script host.
 *
 * Hermetic: no database (the curated catalogue answers), no network — React comes
 * from node_modules and every third-party request is answered or aborted locally.
 */
'use strict';

process.env.LOUMOO_NO_DOTENV = '1';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const express = require('express');

const ROOT = path.resolve(__dirname, '../../..');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { chromium = null; }

const ORIGIN = require(path.join(ROOT, 'src/routing/routes')).ORIGIN;
const CURATED_ID = 'phone_tecno_tecno_camon_50_pro_5g_256gb_12gb_';

async function headOf(page) {
  return page.evaluate(() => {
    const q = (s, a) => { const el = document.head.querySelector(s); return el ? el.getAttribute(a) : null; };
    return {
      title: document.title,
      canonical: q('link[rel="canonical"]', 'href'),
      robots: q('meta[name="robots"]', 'content'),
      canonicals: document.head.querySelectorAll('link[rel="canonical"]').length,
      jsonLd: Array.from(document.head.querySelectorAll('script[type="application/ld+json"]')).map((s) => JSON.parse(s.textContent)['@type']),
      mounted: (document.getElementById('dc-root') || { innerText: '' }).innerText.length
    };
  });
}

async function run() {
  if (!chromium) { console.log('seo_head.browser: SKIPPED (playwright not installed)'); return; }
  const gateway = require(path.join(ROOT, 'server/index.js'));
  // The gateway serves the shell; its assets come from public/ in a deployment. Serve
  // them from the source tree here so the suite needs no build.
  const app = express();
  for (const dir of ['src', '_ds', 'Assets', 'data']) app.use(`/${dir}`, express.static(path.join(ROOT, dir), { fallthrough: false }));
  app.get('/support.js', (req, res) => res.sendFile(path.join(ROOT, 'support.js')));
  app.use(gateway);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ headless: true, executablePath: process.env.LOUMOO_BROWSER_PATH || undefined, args: ['--no-sandbox'] });
  let checks = 0;
  const newPage = async () => {
    const page = await browser.newPage();
    for (const name of ['react', 'react-dom']) {
      await page.route(`https://unpkg.com/${name}@18.3.1/umd/${name}.production.min.js`, (r) => r.fulfill({
        status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' },
        body: fs.readFileSync(path.join(ROOT, `node_modules/${name}/umd/${name}.production.min.js`))
      }));
    }
    // Map assets/data are answered locally (we test the CSP, not the CDN); anything else external is aborted.
    await page.route(/^https:\/\/(cdnjs\.cloudflare\.com|tiles\.openfreemap\.org|nominatim\.openstreetmap\.org|evil\.example)\//, (r) => r.fulfill({
      status: 200, headers: { 'access-control-allow-origin': '*' },
      contentType: /\.js$/.test(r.request().url()) ? 'application/javascript' : 'application/json',
      body: /\.js$/.test(r.request().url()) ? 'window.__mapLoaded = (window.__mapLoaded || 0) + 1;' : '{}'
    }));
    await page.route(/^https:\/\/(?!unpkg\.com\/react|cdnjs\.cloudflare\.com|tiles\.openfreemap\.org|nominatim\.openstreetmap\.org|evil\.example)/, (r) => r.abort());
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
    });
    return page;
  };
  const settle = async (page) => {
    await page.waitForFunction(() => (document.getElementById('dc-root') || { innerText: '' }).innerText.length > 50, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
  };

  try {
    /* 1. A product keeps the server's head after mount. */
    let page = await newPage();
    let resp = await page.goto(`${base}/product/${CURATED_ID}`, { waitUntil: 'load', timeout: 60000 });
    assert.strictEqual(resp.status(), 200);
    assert.ok(resp.headers()['content-security-policy'], 'served with the gateway CSP');
    await settle(page);
    let h = await headOf(page);
    assert.strictEqual(h.canonical, `${ORIGIN}/product/${CURATED_ID}`, 'product canonical kept');
    assert.strictEqual(h.robots, 'index,follow');
    assert.ok(/Tecno Camon 50 Pro/.test(h.title), `product title kept after mount (got "${h.title}")`);
    assert.ok(h.jsonLd.includes('Product') && h.jsonLd.includes('BreadcrumbList'), `Product + BreadcrumbList JSON-LD kept (got ${h.jsonLd})`);
    assert.strictEqual(h.canonicals, 1, 'exactly one canonical');
    checks += 1;
    console.log(`    ✓ product: "${h.title}" ${h.robots} ${h.canonical}`);

    /* 4. In-app navigation still updates the head. */
    await page.evaluate(() => window.LoumooRouter && window.LoumooRouter.navigate('/stores'));
    await page.waitForFunction(() => /\/stores$/.test((document.head.querySelector('link[rel="canonical"]') || {}).href || ''), null, { timeout: 15000 });
    h = await headOf(page);
    assert.strictEqual(h.canonical, `${ORIGIN}/stores`, 'navigation rewrites the canonical, on the server-declared origin');
    assert.ok(!h.jsonLd.includes('Product'), 'and drops the product JSON-LD');
    checks += 1;
    console.log(`    ✓ in-app navigation: ${h.canonical} "${h.title}"`);
    await page.close();

    /* 2. An unknown category keeps the server's noindex. */
    page = await newPage();
    resp = await page.goto(`${base}/marketplace/category/not-a-category`, { waitUntil: 'load', timeout: 60000 });
    assert.strictEqual(resp.status(), 404, 'unknown category is a 404');
    await settle(page);
    h = await headOf(page);
    assert.ok(/^noindex/.test(h.robots || ''), `the 404's noindex survives the mount (got ${h.robots})`);
    checks += 1;
    console.log(`    ✓ unknown category: HTTP 404, robots ${h.robots}`);
    await page.close();

    /* 3. A category keeps its own title. */
    page = await newPage();
    await page.goto(`${base}/marketplace/category/electronics`, { waitUntil: 'load', timeout: 60000 });
    await settle(page);
    h = await headOf(page);
    assert.ok(/^Electronics & Technology/.test(h.title), `category title kept (got "${h.title}")`);
    assert.strictEqual(h.canonical, `${ORIGIN}/marketplace/category/electronics`);
    assert.strictEqual(h.robots, 'index,follow');
    checks += 1;
    console.log(`    ✓ category: "${h.title}" ${h.robots}`);

    /* 5. The CSP lets the map load and still blocks a foreign script host. */
    const csp = await page.evaluate(async () => {
      const load = (src) => new Promise((res) => { const s = document.createElement('script'); s.src = src; s.onload = () => res('loaded'); s.onerror = () => res('blocked'); document.head.appendChild(s); });
      const css = (href) => new Promise((res) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = () => res('loaded'); l.onerror = () => res('blocked'); document.head.appendChild(l); });
      const get = (u) => fetch(u).then(() => 'loaded', () => 'blocked');
      return {
        mapJs: await load('https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.js'),
        mapCss: await css('https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.css'),
        tiles: await get('https://tiles.openfreemap.org/styles/liberty'),
        geocoder: await get('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=Douala'),
        foreign: await load('https://evil.example/x.js'),
        violations: window.__csp.slice()
      };
    });
    assert.deepStrictEqual([csp.mapJs, csp.mapCss, csp.tiles, csp.geocoder], ['loaded', 'loaded', 'loaded', 'loaded'], `map assets allowed by the CSP: ${JSON.stringify(csp)}`);
    assert.strictEqual(csp.foreign, 'blocked', 'an arbitrary script host is still blocked');
    assert.ok(csp.violations.some((v) => /script-src/.test(v) && /evil\.example/.test(v)), 'and reported as a CSP violation');
    assert.ok(!csp.violations.some((v) => /cdnjs|openfreemap|nominatim/.test(v)), `no violation for the map hosts: ${csp.violations}`);
    checks += 1;
    console.log('    ✓ CSP: MapLibre js/css, tiles and geocoder load; evil.example blocked');
    await page.close();
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
  console.log(`seo_head.browser: ${checks} checks passed`);
}

module.exports = { run };

if (require.main === module) {
  run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
}
