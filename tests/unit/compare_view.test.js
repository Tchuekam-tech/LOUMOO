/**
 * LOUMOO Unit Tests — compare screen view model (src/services/compareView.js).
 * Built from real engine answers: the view formats, it never invents.
 */

require('../setup');
const assert = require('assert');
const V = require('../../src/services/compareView.js');
const ComparisonService = require('../../server/modules/catalog/application/ComparisonService');

const answer = async (ids, priorities = {}) => JSON.parse(JSON.stringify(await ComparisonService.getComparison(ids, priorities)));

async function run() {
  console.log('  Testing compare view model...');

  // ── Idle, loading and error states carry nothing to render ───────────────
  assert.strictEqual(V.build(null).ready, false);
  assert.strictEqual(V.build(null, { loading: true }).loading, true);
  const err = V.build(null, { error: 'Network down' });
  assert.strictEqual(err.error, 'Network down');
  assert.deepStrictEqual(err.heroCards, []);
  assert.strictEqual(V.build({ products: [] }).ready, false);

  // ── A ranked laptop comparison ──────────────────────────────────────────
  const AIR = 'laptop_apple_apple_macbook_air_m2_13_6_pouces';
  const PRO = 'laptop_apple_apple_macbook_pro_14_m3_pro_gris';
  const laptops = V.build(await answer([AIR, PRO], { performance: 5 }));
  assert.strictEqual(laptops.ready, true);
  assert.strictEqual(laptops.cols, 'cmp-n-2');
  assert.strictEqual(laptops.hasRecommendation, true);
  assert.ok(/^\d+\/100 fit for your priorities$/.test(laptops.matchText));
  assert.ok(['Clear winner', 'Leans one way', 'Close call'].includes(laptops.decisiveText));
  assert.strictEqual(laptops.heroCards.filter(c => c.tags.some(t => t.text === 'Recommended')).length, 1, 'exactly one pick');
  assert(laptops.heroCards.every(c => /^XAF [\d,]+$/.test(c.price)), 'real prices');
  assert(laptops.bestFor.every(b => / — /.test(b.text) && !/^Best for/.test(b.text)), 'best-for reads "Facet — product" once');
  assert(laptops.bars.length >= 2 && laptops.bars.every(b => b.lines.length === 2), 'bars for each product');
  const widths = laptops.bars.flatMap(b => b.lines.map(l => Number(/width:(\d+)%/.exec(l.width)[1])));
  assert(widths.every(w => w >= 6 && w <= 100), 'bar widths stay within 6–100%');
  assert(laptops.priorityChips.length > 0 && laptops.priorityChips.every(c => c.key && c.label));
  const pickId = laptops.heroCards.find(c => c.tags.some(t => t.text === 'Recommended')).id;
  assert(laptops.stickyProductId.startsWith(pickId), 'sticky adds a listing of the recommended product');
  const pickRows = laptops.buyRows.filter(r => r.productId.startsWith(pickId));
  assert.strictEqual(laptops.stickyProductId, pickRows[0].productId, 'and it is the cheapest offer shown');

  // Demo seed items cannot be ordered: no Add buttons and no sticky add.
  const seeds = V.build(await answer(['elec-1', 'elec-macbook-pro'], { performance: 5 }));
  assert(seeds.buyRows.every(r => r.canBuy === false));
  assert.strictEqual(seeds.stickyProductId, null);
  assert.ok(laptops.marketNote, 'states what the market comparison is based on');

  // Percentile chips appear on specs only, never on price or rating rows.
  const commerce = laptops.specGroups.find(g => /price/i.test(g.title));
  assert(commerce.rows.every(r => r.cells.every(c => !c.hasChip)), 'no chips in the commerce section');

  // Differences filter hides identical rows; winners filter keeps decided rows.
  const raw = await answer(['elec-1', 'elec-macbook-pro']);
  const count = (vm) => vm.specGroups.reduce((n, g) => n + g.rows.length, 0);
  assert(count(V.build(raw, { filter: 'diff' })) < count(V.build(raw, { filter: 'all' })));
  assert(count(V.build(raw, { filter: 'winners' })) <= count(V.build(raw, { filter: 'diff' })));

  // ── Three products get a three-column layout and their own dot colours ──
  const three = V.build(await answer(['elec-1', 'elec-macbook-pro', 'elec-thinkpad']));
  assert.strictEqual(three.cols, 'cmp-n-3');
  assert.deepStrictEqual(three.specHead.map(h => h.dot), ['cmp-dot-a', 'cmp-dot-b', 'cmp-dot-c']);

  // ── Withheld: equivalent listings and boutiques ─────────────────────────
  const twins = V.build(await answer(['macbook_m2', 'elec-1']));
  assert.strictEqual(twins.hasRecommendation, false);
  assert.ok(/equivalent/.test(twins.notice), 'says they are equivalent');
  assert.strictEqual(twins.stickyProductId, null);
  assert.strictEqual(twins.priorityChips.length, 0);

  const shops = V.build(await answer(['store_orca_electronics', 'store_kamertech_direct']));
  assert.ok(/side by side/.test(shops.notice));
  assert.deepStrictEqual(shops.bars, [], 'a lone rating is not a chart');
  assert.deepStrictEqual(shops.heroCards.map(c => c.seller), ['Douala', 'Yaoundé'], 'a shop is not its own seller');
  assert.strictEqual(shops.hasBuyRows, false, 'nothing to buy from a shop card');

  // ── Unknown ids are reported ────────────────────────────────────────────
  const partial = V.build(await answer(['elec-1', 'elec-macbook-pro', 'does-not-exist']));
  assert.strictEqual(partial.unresolvedText, '1 item could not be found and was left out.');

  // ── The view never fabricates numbers the answer does not hold ──────────
  const json = JSON.stringify(laptops);
  assert(!/1 000\+|1,000\+|94%/.test(json), 'no placeholder stock or fixed match percentage');

  console.log('    ✓ Compare view model passed.');
}

if (require.main === module) {
  run().catch(err => {
    console.error('FAILED:', err);
    process.exit(1);
  });
}

module.exports = { run };
