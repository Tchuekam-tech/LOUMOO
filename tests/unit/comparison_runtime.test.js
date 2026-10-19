/**
 * LOUMOO Unit Tests — Compare screens runtime (built shell) on Comparison Engine v2.
 *
 * Drives the shipped controller with the real view model and an API backed by
 * the real engine: what the buyer sees comes from the engine's answer, never
 * from built-in sample data, and nothing is shown when the engine is missing.
 */

require('../setup');
const assert = require('assert');
const fs = require('fs');
const { loadCompareRuntime, engineBackedApi } = require('../helpers/compareRuntime');

// Values from the vm sandbox live in another realm; compare plain copies.
const plain = (x) => JSON.parse(JSON.stringify(x));
const AIR = 'laptop_apple_apple_macbook_air_m2_13_6_pouces';
const PRO = 'laptop_apple_apple_macbook_pro_14_m3_pro_gris';
const AIR_T = 'Apple MacBook Air M2 13.6 pouces Minuit';
const PRO_T = 'Apple MacBook Pro 14 M3 Pro Gris Sidéral';

async function run() {
  console.log('  Testing compare screens runtime on engine v2...');

  // ── 1. The shell carries no sample verdicts or invented stock ────────────
  const shell = fs.readFileSync('Commerce App.dc.html', 'utf8');
  for (const fake of ['matchPercentage: 94', 'Guaranteed stock (1 000+', 'elec-lenovo-x1', "'cat-prod-1'", "addToCart('macbook_m2')", 'vsSlot1Active']) {
    assert(!shell.includes(fake), `shell no longer contains ${fake}`);
  }
  assert(shell.includes('./src/services/compareView.js'), 'shell loads the compare view model');
  assert(shell.includes('./src/styles/compare.css'), 'shell loads the compare stylesheet');

  // ── 2. Without the API there is an honest error, not a made-up pick ──────
  {
    const rt = loadCompareRuntime({ withView: true });
    rt.comp.componentDidMount();
    let v = rt.vals();
    assert.deepStrictEqual(plain(rt.comp.state.vsCompareIds), [AIR, PRO], 'default tray: real catalogue laptops');
    assert.strictEqual(v.vsFilterAll, true);
    assert.strictEqual(v.vsCanCompare, true);
    assert.deepStrictEqual(plain(v.vsTrayCards.map(c => c.title)), [AIR_T, PRO_T]);
    assert(v.vsTrayCards.every(c => c.price === ''), 'no price is shown before the engine answers');
    rt.comp.runCompare();
    v = rt.vals();
    assert.strictEqual(rt.comp.state.vsResult, null, 'no fallback recommendation');
    assert.ok(v.vsView.error, 'the screen says the comparison is unavailable');
  }

  // ── 3. With the engine: the verdict, cards and offers come from its answer ─
  const api = engineBackedApi();
  const rt = loadCompareRuntime({ withView: true, api });
  rt.comp.componentDidMount();
  rt.comp._enterCompare();
  await rt.settle();
  let v = rt.vals();
  assert.strictEqual(api.calls.length, 1, 'one engine call on entering the screen');
  assert.strictEqual(api.calls[0].priorities.performance, 5, 'default priority is performance');
  assert(Object.entries(api.calls[0].priorities).every(([k, w]) => k === 'performance' || w === 1), 'every other facet steps back to 1');
  assert.strictEqual(api.calls[0].lang, 'en', 'verdict language follows the page');
  assert.strictEqual(v.vsView.hasRecommendation, true);
  assert.strictEqual(v.vsView.recommendTitle, PRO_T, 'performance-first picks the M3 Pro');
  assert.ok(/\d+\/100 fit/.test(v.vsView.matchText), 'fit is the engine score, not a fixed percentage');
  assert.strictEqual(v.vsView.heroCards.length, 2);
  assert(v.vsView.heroCards.every(c => /^XAF /.test(c.price)), 'real prices on hero cards');
  assert(v.vsView.buyRows.length >= 2, 'real offers listed');
  assert(v.vsView.buyRows.every(r => r.canBuy && (r.productId.startsWith(AIR) || r.productId.startsWith(PRO))), 'each Add button adds a listing of its own product');
  assert(v.vsView.buyRows.some(r => r.productId === v.vsView.stickyProductId), 'sticky bar adds the offer shown under Where to buy');
  assert(v.vsView.stickyProductId.startsWith(PRO), 'sticky bar adds the recommended product');
  assert(v.vsTrayCards.every(c => /^XAF /.test(c.price)), 'tray cards pick up real prices once answered');
  assert.strictEqual(v.vsCompareTitle, AIR_T + ' vs ' + PRO_T);

  // Entering again with the same tray does not ask twice.
  rt.comp._enterCompare();
  await rt.settle();
  assert.strictEqual(api.calls.length, 1, 'an answered tray is not re-requested');

  // ── 4. Priorities are limited to facets with data and re-rank ────────────
  const keys = v.vsView.priorityChips.map(c => c.key);
  assert(keys.includes('price') && keys.includes('performance'), 'price and performance offered for laptops');
  assert(!keys.includes('camera'), 'no camera priority for laptops without camera data');
  v.setVsPriority('price');
  await rt.settle();
  v = rt.vals();
  assert.strictEqual(api.calls[api.calls.length - 1].priorities.price, 5);
  assert.strictEqual(api.calls[api.calls.length - 1].priorities.performance, 1);
  assert.strictEqual(v.vsView.recommendTitle, AIR_T, 'price-first picks the cheaper Air');
  assert.ok(v.vsView.priorityChips.find(c => c.key === 'price').cls.includes('is-active'));

  // ── 5. Filters ──────────────────────────────────────────────────────────
  const allRows = v.vsView.specGroups.reduce((n, g) => n + g.rows.length, 0);
  v.setVsFilterDiff();
  v = rt.vals();
  assert.strictEqual(rt.comp.state.vsFilterMode, 'diff');
  const diffRows = v.vsView.specGroups.reduce((n, g) => n + g.rows.length, 0);
  assert(diffRows < allRows, 'differences hide identical rows');
  v.setVsFilterAll();

  // ── 6. Only the latest answer may write ─────────────────────────────────
  let releaseFirst;
  api.gates.push(new Promise(r => { releaseFirst = r; }));
  rt.comp.loadVsPreset('stays');      // slow answer
  rt.comp.loadVsPreset('ultrabooks'); // fast answer
  await rt.settle();
  releaseFirst();
  await rt.settle();
  v = rt.vals();
  assert.deepStrictEqual(plain(rt.comp.state.vsResult.requestedIds), [AIR, PRO], 'a stale answer never overwrites a newer tray');

  // ── 7. Withheld recommendations say why ─────────────────────────────────
  rt.comp.loadVsPreset('stores');
  await rt.settle();
  v = rt.vals();
  assert.strictEqual(v.vsView.hasRecommendation, false);
  assert.ok(/side by side/.test(v.vsView.notice), 'boutiques are shown side by side');
  assert.strictEqual(v.vsView.stickyProductId, null, 'nothing to add to the bag');
  assert.strictEqual(v.vsView.priorityChips.length, 0, 'no priorities without a ranking');

  console.log('    ✓ Compare screens runtime passed.');
}

module.exports = { run };

if (require.main === module) {
  run().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
