/**
 * LOUMOO — a visitor goes straight to the app: the SEO fallback is never seen.
 * ---------------------------------------------------------------------------
 * The gateway prerenders a crawlable content block (#loumoo-prerender) into every
 * page. It is for bots and link previews, not for people. It used to be visible
 * from first paint until the app mounted, and the app could not mount until React
 * had been fetched from unpkg.com, so on a slow connection a visitor sat on a bare
 * SEO page, and on a blocked CDN they sat there forever. This drives the real
 * gateway (server/index.js, real CSP) in Chromium and proves:
 *
 *   1. React is loaded from THIS origin, never from the CDN, and the app mounts;
 *   2. before the app mounts the block is in the DOM (a crawler reads it) but
 *      occupies no visible space, and a loading indicator shows instead; once the
 *      app mounts the block is gone from layout and the indicator is gone;
 *   3. without JavaScript the block IS shown (the app cannot run, the page is all
 *      there is) and no spinner spins forever;
 *   4. if the same-origin copy is unavailable the CDN copy is used, and the app mounts;
 *   5. if React cannot be loaded from either place, the visitor gets a retry
 *      screen (in their language), not the SEO text and not a blank page; the
 *      button reloads.
 *
 * Hermetic: no database (the curated catalogue answers), no network — every
 * third-party request is answered or aborted locally.
 *
 * LOUMOO_TEST_SHOTS=<dir> also writes a screenshot of each state there.
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

const REACT = {
  react: fs.readFileSync(path.join(ROOT, 'src/vendor/react.production.min.js')),
  'react-dom': fs.readFileSync(path.join(ROOT, 'src/vendor/react-dom.production.min.js'))
};
const SHOTS = process.env.LOUMOO_TEST_SHOTS;

/** What the visitor can see of the crawler block, and of the loading indicator. */
function snapshot() {
  const el = document.getElementById('loumoo-prerender');
  const spinner = getComputedStyle(document.body, '::before');
  const r = el && getComputedStyle(el).display !== 'none' ? el.getBoundingClientRect() : { width: 0, height: 0 };
  return {
    mounted: !!document.getElementById('dc-root'),
    blockInDom: !!el,
    blockText: el ? el.textContent : '',
    blockWidth: Math.round(r.width),
    blockHeight: Math.round(r.height),
    spinner: spinner.content !== 'none' && spinner.content !== 'normal' && spinner.display !== 'none' && spinner.animationName === 'dc-boot-spin',
    failure: !!document.getElementById('dc-boot-failure'),
    failureText: (document.getElementById('dc-boot-failure') || {}).innerText || ''
  };
}

async function run() {
  if (!chromium) { console.log('boot_fallback.browser: SKIPPED (playwright not installed)'); return; }
  const gateway = require(path.join(ROOT, 'server/index.js'));
  const app = express();
  for (const dir of ['src', '_ds', 'Assets', 'data']) app.use(`/${dir}`, express.static(path.join(ROOT, dir), { fallthrough: false }));
  app.get('/support.js', (req, res) => res.sendFile(path.join(ROOT, 'support.js')));
  app.use(gateway);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ headless: true, executablePath: process.env.LOUMOO_BROWSER_PATH || undefined, args: ['--no-sandbox'] });
  let checks = 0;

  /**
   * A page whose React sources behave as asked: 'ok' | '404' | 'abort' | 'hold'
   * (held until `gate` resolves, then served). Everything else third-party is aborted.
   */
  async function newPage({ vendor = 'ok', cdn = 'ok', gate = Promise.resolve(), javaScriptEnabled = true, locale = 'en-US' } = {}) {
    const context = await browser.newContext({ javaScriptEnabled, locale });
    const page = await context.newPage();
    page.requests = [];
    page.on('request', (r) => page.requests.push(r.url()));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    for (const name of Object.keys(REACT)) {
      const serve = (mode) => async (r) => {
        if (mode === 'hold') await gate;
        if (mode === 'abort') return r.abort();
        if (mode === '404') return r.fulfill({ status: 404, body: 'not found' });
        return r.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: REACT[name] });
      };
      await page.route(`**/src/vendor/${name}.production.min.js`, serve(vendor));
      await page.route(`https://unpkg.com/${name}@18.3.1/umd/${name}.production.min.js`, serve(cdn));
    }
    return page;
  }
  const mounted = (page) => page.waitForFunction(() => (document.getElementById('dc-root') || { innerText: '' }).innerText.length > 50, null, { timeout: 90000 });
  const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };
  const fromCdn = (page) => page.requests.filter((u) => /unpkg\.com\/react/.test(u));
  const fromVendor = (page) => page.requests.filter((u) => /\/src\/vendor\/react(-dom)?\.production\.min\.js/.test(u));

  try {
    /* 1 + 2. Same-origin React; hidden-but-present before the app mounts; gone after. */
    let release;
    const gate = new Promise((r) => { release = r; });
    let page = await newPage({ vendor: 'hold', cdn: 'hold', gate });
    const resp = await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    assert.ok(/id="loumoo-prerender"/.test(await resp.text()), 'the served HTML still carries the crawler block (bots read it)');
    let s = await page.evaluate(snapshot);
    assert.ok(!s.mounted, 'fixture: the app has not mounted yet (React is held)');
    assert.ok(s.blockInDom && /LOUMOO/.test(s.blockText) && /Acheter, vendre et voyager/.test(s.blockText), 'before mount the crawler content is in the DOM');
    assert.ok(s.blockWidth <= 1 && s.blockHeight <= 1, `but it takes no visible room (${s.blockWidth}x${s.blockHeight})`);
    assert.ok(s.spinner, 'and a loading indicator stands in for the page');
    await shot(page, '1-before-mount');
    release();
    await mounted(page);
    s = await page.evaluate(snapshot);
    assert.ok(s.mounted && s.blockWidth === 0 && s.blockHeight === 0, 'once the app mounts the crawler block takes no room');
    assert.ok(!s.spinner, 'and the loading indicator is gone');
    assert.deepStrictEqual([fromVendor(page).length > 0, fromCdn(page).length], [true, 0], `React came from this origin, never the CDN (${fromCdn(page)})`);
    await shot(page, '2-mounted');
    await page.context().close();
    checks += 1;
    console.log('    ✓ same-origin React; crawler block hidden before mount (still in the DOM), gone after; spinner while loading');

    /* 3. No JavaScript: the page is all there is, so it is shown; nothing spins. */
    page = await newPage({ javaScriptEnabled: false });
    await page.goto(`${base}/`, { waitUntil: 'load', timeout: 60000 });
    s = await page.evaluate(snapshot);
    assert.ok(s.blockWidth > 300 && s.blockHeight > 100, `without JavaScript the content block is shown (${s.blockWidth}x${s.blockHeight})`);
    assert.ok(!s.spinner, 'and no loading indicator spins forever');
    await shot(page, '3-no-javascript');
    await page.context().close();
    checks += 1;
    console.log(`    ✓ no JavaScript: content shown (${s.blockWidth}x${s.blockHeight}), no spinner`);

    /* 4. The same-origin copy is unavailable: the CDN copy is used and the app mounts. */
    page = await newPage({ vendor: '404', cdn: 'ok' });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await mounted(page);
    assert.ok(fromCdn(page).length >= 2, `React and ReactDOM fell back to the CDN (${fromCdn(page)})`);
    s = await page.evaluate(snapshot);
    assert.ok(s.mounted && !s.failure, 'and the app mounted without a failure screen');
    await page.context().close();
    checks += 1;
    console.log('    ✓ same-origin copy missing: the CDN copy is used, the app mounts');

    /* 5. React cannot be loaded anywhere: a retry screen in the visitor's language. */
    for (const [locale, text, label] of [['en-US', /couldn.t load/i, 'Try again'], ['fr-FR', /n.a pas pu se charger/i, 'Réessayer']]) {
      page = await newPage({ vendor: '404', cdn: 'abort', locale });
      await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('#dc-boot-failure button', { timeout: 30000 });
      s = await page.evaluate(snapshot);
      assert.ok(s.failure && text.test(s.failureText), `${locale}: the visitor is told the app could not load ("${s.failureText.replace(/\s+/g, ' ')}")`);
      assert.ok(s.failureText.includes(label), `${locale}: with a "${label}" button`);
      assert.ok(!s.mounted, 'the app is not mounted');
      assert.ok(s.blockWidth <= 1 && s.blockHeight <= 1, 'and the SEO text is still not shown to the visitor');
      assert.ok(!s.spinner, 'and nothing spins forever');
      await shot(page, `5-failure-${locale}`);
      let navigations = 0;
      page.on('request', (r) => { if (r.isNavigationRequest()) navigations += 1; });
      await Promise.all([page.waitForEvent('load'), page.click('#dc-boot-failure button')]);
      assert.ok(navigations >= 1, `${locale}: the button reloads the page`);
      await page.context().close();
    }
    checks += 1;
    console.log('    ✓ React unreachable: retry screen (en + fr), SEO text still hidden, no endless spinner, button reloads');
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
  console.log(`boot_fallback.browser: ${checks} checks passed`);
}

module.exports = { run };

if (require.main === module) {
  run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
}
