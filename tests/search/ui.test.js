const assert = require('node:assert/strict'),
  express = require('express'),
  path = require('node:path'),
  { chromium } = require('playwright');
(async () => {
  const app = express();
  app.use(
    require('../../server/shared/middleware/securityHeaders').securityHeaders,
  );
  app.use(express.static(path.join(__dirname, '../..')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.LOUMOO_BROWSER_PATH || undefined,
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const name of ['react', 'react-dom'])
      await page.route(
        `https://unpkg.com/${name}@18.3.1/umd/${name}.production.min.js`,
        (r) =>
          r.fulfill({
            path: path.join(
              __dirname,
              `../../node_modules/${name}/umd/${name}.production.min.js`,
            ),
            contentType: 'application/javascript',
            headers: { 'Access-Control-Allow-Origin': '*' },
          }),
      );
    const item = {
      id: 'fixture-product',
      entityType: 'product',
      title: 'Dell Latitude fixture',
      price: 'XAF 300 000',
      priceNumeric: 300000,
      storeName: 'Fixture Store',
      merchantCity: 'Douala',
      inStock: null,
      rating: null,
    };
    await page.route('**/api/**', async (r) => {
      const p = new URL(r.request().url()).pathname;
      let data = {},
        status = 200;
      if (p.endsWith('/search/capabilities'))
        data = { text: true, voice: true, assistant: false, visual: false };
      else if (p.endsWith('/search/suggest'))
        data = {
          items: [item],
          suggestions: [
            { id: item.id, label: item.title, type: 'product', item },
          ],
          total: 1,
        };
      else if (p.endsWith('/search'))
        data = { items: [item], total: 1, page: 1, limit: 20, hasMore: false };
      else if (p.endsWith('/search/voice/session')) status = 401;
      else if (p.endsWith('/products')) data = { items: [], total: 0 };
      else if (p.endsWith('/me/state')) data = { authenticated: false };
      else if (p.endsWith('/auth/config')) data = { provider: 'none' };
      await r.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({
          success: status === 200,
          data,
          ...(status === 401
            ? { error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }
            : {}),
        }),
      });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/Commerce%20App.dc.html`,
      { waitUntil: 'domcontentloaded' },
    );
    const input = page.locator('.lsb-search-input');
    await input.waitFor({ state: 'visible', timeout: 30000 });
    await input.fill('latitude');
    await page
      .getByRole('option', { name: /Dell Latitude fixture/ })
      .waitFor({ state: 'visible' });
    await input.press('ArrowDown');
    assert.equal(
      await input.getAttribute('aria-activedescendant'),
      'search-option-0',
    );
    await input.press('Escape');
    await input.press('Enter');
    await page.locator('.search-card').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.search-card').count(), 1);
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.getByRole('button', { name: 'Limbe', exact: true }).click();
    assert.equal(
      await page.getByLabel('City', { exact: true }).inputValue(),
      'Limbe',
    );
    await page
      .getByRole('button', { name: 'Show results', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Voice search', exact: true })
      .click();
    await page
      .getByRole('heading', { name: 'LOUMOO Combi' })
      .waitFor({ state: 'visible' });
    await page
      .getByRole('button', { name: 'Start voice conversation' })
      .click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Sign in' })
      .waitFor({ state: 'visible' });
    assert.equal(
      await page
        .locator('.search-panel')
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    const worklet = await page.evaluate(async () => {
      const context = new AudioContext();
      const url = URL.createObjectURL(
        new Blob(
          [
            'class TestProcessor extends AudioWorkletProcessor { process() { return true; } } registerProcessor("test-processor",TestProcessor);',
          ],
          { type: 'application/javascript' },
        ),
      );
      try {
        await context.audioWorklet.addModule(url);
        return true;
      } catch (e) {
        return e.message;
      } finally {
        URL.revokeObjectURL(url);
        await context.close();
      }
    });
    assert.equal(
      worklet,
      true,
      'voice audio worklets must be permitted by the production CSP',
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS browser UI: mobile suggestions, keyboard ARIA, results, filters, Combi auth and audio worklet CSP',
    );
  } finally {
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
})().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
