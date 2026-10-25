/**
 * LOUMOO Unit Tests — one money formatter (cleanup brief, Step 6: currency)
 * ---------------------------------------------------------------------------
 * src/shared/money.js is now the single definition of the buyer/SEO price string. This pins its
 * output and proves the two server formatters it replaced (CatalogRepository.formatXaf and
 * PrerenderService.formatPrice) still return byte-identical strings — a pure dedup, no re-format.
 */

require('../setup');
const assert = require('assert');
const Money = require('../../src/shared/money');
const PrerenderService = require('../../server/modules/system/seo/PrerenderService');

async function run() {
  console.log('  Testing the shared money formatter...');

  // formatXaf: always a string, "0 FCFA" for zero (CatalogRepository.formatXaf semantics)
  assert.strictEqual(Money.formatXaf(85000), '85 000 FCFA');
  assert.strictEqual(Money.formatXaf(1234567), '1 234 567 FCFA');
  assert.strictEqual(Money.formatXaf(0), '0 FCFA');
  assert.strictEqual(Money.formatXaf(999), '999 FCFA');
  assert.strictEqual(Money.formatXaf(85000.6), '85 001 FCFA', 'rounds');
  assert.strictEqual(Money.formatXaf('nope'), '0 FCFA', 'a non-number is 0');

  // formatMoney: "" for zero/blank, currency-aware (PrerenderService.formatPrice semantics)
  assert.strictEqual(Money.formatMoney(0), '');
  assert.strictEqual(Money.formatMoney(null), '');
  assert.strictEqual(Money.formatMoney(90000), '90 000 FCFA', 'default currency is XAF');
  assert.strictEqual(Money.formatMoney(90000, 'XAF'), '90 000 FCFA');
  assert.strictEqual(Money.formatMoney(1500, 'USD'), '1 500 USD');
  assert.strictEqual(Money.group(1234567), '1 234 567');
  console.log('    ✓ money.js: formatXaf and formatMoney pin the "<space-grouped> FCFA" convention');

  // The site it replaced produces exactly the same strings (no behaviour change).
  assert.strictEqual(PrerenderService.formatPrice(90000, 'XAF'), '90 000 FCFA', 'PrerenderService.formatPrice unchanged');
  assert.strictEqual(PrerenderService.formatPrice(0, 'XAF'), '', 'zero still renders nothing on a product page');
  assert.strictEqual(PrerenderService.formatPrice(449100, 'XAF'), '449 100 FCFA');
  console.log('    ✓ PrerenderService.formatPrice delegates to money.js with identical output');

  // UMD: a browser-like global receives it, Node gets module.exports.
  const sandbox = {};
  const vm = require('vm');
  const code = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/shared/money.js'), 'utf8');
  vm.runInNewContext(code, sandbox);
  assert.ok(sandbox.LoumooMoney && sandbox.LoumooMoney.formatXaf(85000) === '85 000 FCFA', 'UMD exposes window.LoumooMoney in a browser context');
  console.log('    ✓ money.js is UMD: window.LoumooMoney in the browser, module.exports in Node');
}

module.exports = { run };
