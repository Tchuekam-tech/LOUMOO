/**
 * LOUMOO compare screen — view model for Comparison Engine v2.
 *
 *   LoumooCompareView.build(result, { filter, loading, error }) → view model
 *
 * Turns the /catalog/compare response into exactly what the compare screen
 * renders: hero cards, the verdict, reasons, measured bars, the spec table and
 * real offers. It formats; it never decides. Every claim on screen comes from
 * the engine's response, so nothing here can invent a price, a stock level or a
 * winner. Lives outside the shell (which is at its size budget) and is pure, so
 * tests/unit/compare_view.test.js exercises it in Node.
 */
(function (root) {
  'use strict';

  var DOTS = ['a', 'b', 'c', 'd'];
  var DECISIVENESS = {
    clear: 'Clear winner',
    leaning: 'Leans one way',
    close: 'Close call'
  };
  // Buyer priorities the screen offers, in display order, when the compared
  // products actually have data for them (engine facets).
  var PRIORITY_CHIPS = [
    ['performance', 'Performance'],
    ['price', 'Lowest price'],
    ['value', 'Value for money'],
    ['battery', 'Battery'],
    ['display', 'Display'],
    ['camera', 'Camera'],
    ['audio', 'Sound'],
    ['capacity', 'Capacity'],
    ['portability', 'Portability'],
    ['warranty', 'Warranty']
  ];
  var TYPE_LABEL = {
    smartphone: 'Smartphone', laptop: 'Laptop', tablet: 'Tablet', headphones: 'Headphones',
    earbuds: 'Earbuds', speaker: 'Speaker', microphone: 'Microphone', power_bank: 'Power bank',
    charger: 'Charger', smartwatch: 'Smartwatch', watch: 'Watch', footwear: 'Shoes',
    clothing: 'Clothing', bag: 'Bag', jewelry: 'Jewellery', kitchen_appliance: 'Kitchen appliance',
    cookware: 'Cookware', tableware: 'Tableware', perfume: 'Perfume', skincare: 'Skincare',
    store: 'Boutique', hotel: 'Stay', service: 'Service'
  };

  function typeLabel(t) {
    if (!t) return '';
    return TYPE_LABEL[t] || String(t).replace(/^other:/, '').replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function plural(t) {
    var l = typeLabel(t).toLowerCase();
    return /s$/.test(l) ? l : l + 's';
  }

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return '';
    return 'XAF ' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function shortMoney(n) {
    if (!isFinite(n)) return '';
    if (n >= 1e6) return (Math.round(n / 1e4) / 100) + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(Math.round(n));
  }

  function idle(extra) {
    return Object.assign({
      ready: false, loading: false, error: '', notice: '', hasResult: false,
      heroCards: [], specHead: [], specGroups: [], bars: [], reasons: [], bestFor: [],
      priorityChips: [], dataNotes: [], buyRows: [], hasBuyRows: false,
      hasRecommendation: false, recommendTitle: '', matchText: '', decisiveText: '', summary: '',
      topReasons: '', bestValueText: '', marketNote: '', unresolvedText: '',
      stickyText: '', stickyLabel: '', stickyProductId: null, title: ''
    }, extra || {});
  }

  /**
   * @param {object|null} result  /catalog/compare `data`
   * @param {{ filter?: 'all'|'diff'|'winners', loading?: boolean, error?: string }} [opts]
   */
  function build(result, opts) {
    opts = opts || {};
    if (opts.loading && !result) return idle({ loading: true });
    if (opts.error) return idle({ error: String(opts.error) });
    if (!result || !Array.isArray(result.products) || !result.products.length) return idle({ loading: !!opts.loading });

    var products = result.products;
    var ids = products.map(function (p) { return p.id; });
    var dot = {};
    ids.forEach(function (id, i) { dot[id] = DOTS[i] || 'd'; });
    var short = {};
    products.forEach(function (p) { short[p.id] = p.shortTitle || p.title; });

    var rec = result.recommendation || {};
    var verdict = result.verdict || {};
    var analysis = result.analysis || {};
    var winnerId = rec.recommendedProductId || null;
    var bestValueId = verdict.bestValue && verdict.bestValue.productId || null;
    var warnings = (verdict.warnings || []).filter(Boolean);
    var filter = opts.filter || 'all';

    // ── Hero cards ─────────────────────────────────────────────────────────
    var heroCards = products.map(function (p) {
      var tags = [];
      if (p.id === winnerId) tags.push({ text: 'Recommended', cls: 'is-pick' });
      if (p.id === bestValueId && verdict.bestValue.basis !== 'lowest-price') tags.push({ text: 'Best value', cls: 'is-value' });
      var availability = p.inStock === false ? 'Out of stock'
        : p.stockKnown && p.stockUnits ? p.stockUnits + ' in stock'
          : p.inStock ? 'Available' : '';
      var rating = p.rating ? '★ ' + p.rating + (p.reviewsCount ? ' · ' + p.reviewsCount + ' reviews' : '') : 'No reviews yet';
      return {
        id: p.id,
        dot: 'cmp-dot-' + dot[p.id],
        title: short[p.id],
        fullTitle: p.title,
        image: p.image || '',
        hasImage: !!p.image,
        kind: typeLabel(p.productType),
        price: p.priceNumeric ? money(p.priceNumeric) : (p.price || ''),
        wasPrice: p.compareAtPrice ? money(p.compareAtPrice) : '',
        rating: rating,
        seller: [p.merchant, p.merchantCity].filter(Boolean).join(' · '),
        availability: availability,
        score: p.score !== null && p.score !== undefined && winnerId ? 'Fit ' + Math.round(p.score) + '/100' : '',
        tags: tags,
        hasTags: tags.length > 0
      };
    });

    // ── Verdict ────────────────────────────────────────────────────────────
    var hasRecommendation = !!winnerId;
    var notice = hasRecommendation ? '' : (warnings[0] || '');
    var bestValueText = '';
    if (verdict.bestValue && verdict.bestValue.productId) {
      var bv = verdict.bestValue;
      var why = bv.basis === 'market-curve'
        ? (bv.deviation <= -0.1 ? 'priced ' + Math.round(-bv.deviation * 100) + '% below what comparable ' + plural(products[0].productType) + ' cost here'
          : bv.deviation >= 0.1 ? 'the best of the set, though priced above the market' : 'priced in line with the market')
        : bv.basis === 'spec-score-per-price' ? 'most specification per franc in this set'
          : 'lowest price in this set';
      bestValueText = short[bv.productId] + ' — ' + why;
    }

    var bestFor = (verdict.bestFor || []).map(function (b) {
      return { label: b.label, title: short[b.productId] || '', dot: 'cmp-dot-' + dot[b.productId] };
    });

    // Pros per product (and cons, shown muted). Two to four columns.
    var reasons = (verdict.tradeoffs || []).map(function (t) {
      return {
        id: t.productId,
        dot: 'cmp-dot-' + dot[t.productId],
        head: 'Why ' + short[t.productId],
        pros: (t.pros || []).slice(0, 4),
        cons: (t.cons || []).slice(0, 3),
        hasPros: (t.pros || []).length > 0,
        hasCons: (t.cons || []).length > 0
      };
    }).filter(function (r) { return r.hasPros || r.hasCons; });

    // ── Measured bars: numeric dimensions the ranking actually used ────────
    var rows = [];
    (result.matrixSections || []).forEach(function (s) { (s.rows || []).forEach(function (r) { rows.push(r); }); });
    var bars = rows.filter(function (r) {
      return r.scored && r.format === 'number' && r.direction !== 'none' &&
        ids.every(function (id) { return typeof (r.raw || {})[id] === 'number' && r.raw[id] > 0; });
    }).slice(0, 6).map(function (r) {
      var vals = ids.map(function (id) { return r.raw[id]; });
      var max = Math.max.apply(null, vals);
      var min = Math.min.apply(null, vals);
      var same = max === min;
      return {
        key: r.key,
        label: r.label,
        hint: same ? 'same' : r.approximate ? 'approximate benchmark' : r.direction === 'lower' ? 'lower is better' : 'higher is better',
        lines: ids.map(function (id) {
          var v = r.raw[id];
          var pct = r.direction === 'lower' ? (min / v) * 100 : (v / max) * 100;
          var win = (r.winnerProductIds || []).indexOf(id) >= 0;
          return {
            fill: 'cmp-bar-fill cmp-' + dot[id] + (win ? ' is-win' : ''),
            num: 'cmp-bar-num' + (win ? ' is-win' : ''),
            width: 'width:' + Math.max(6, Math.round(pct)) + '%',
            text: r.key === 'price' ? shortMoney(v) : (r.values[id] || String(v))
          };
        })
      };
    });

    // ── Spec table ─────────────────────────────────────────────────────────
    var specGroups = (result.matrixSections || []).map(function (s) {
      var groupRows = (s.rows || []).filter(function (r) {
        if (filter === 'diff') return r.isDifferent;
        if (filter === 'winners') return (r.winnerProductIds || []).length > 0;
        return true;
      }).map(function (r) {
        return {
          label: r.label + (r.approximate ? ' (approx.)' : ''),
          note: r.uniformInCategory ? 'Same on most listings — not used to rank' : '',
          cells: ids.map(function (id) {
            var win = r.isDifferent && (r.winnerProductIds || []).indexOf(id) >= 0;
            var p = r.percentiles && r.percentiles[id];
            var chip = p === undefined || p === null ? '' : p >= 85 ? 'Top ' + Math.max(1, Math.round(100 - p)) + '%' : p <= 15 ? 'Bottom ' + Math.max(1, Math.round(p)) + '%' : '';
            return { text: r.values[id] || '—', cls: 'cmp-spec-v' + (win ? ' is-win' : '') + (r.values[id] ? '' : ' is-unknown'), chip: chip, hasChip: !!chip };
          })
        };
      });
      return { title: s.title, rows: groupRows, hasRows: groupRows.length > 0 };
    }).filter(function (g) { return g.hasRows; });

    var specHead = products.map(function (p) { return { title: short[p.id], dot: 'cmp-dot-' + dot[p.id] }; });

    // ── Priorities the buyer can steer with (only facets with data) ────────
    var facets = {};
    ids.forEach(function (id) {
      var s = analysis.scores && analysis.scores[id];
      if (s && s.byFacet) Object.keys(s.byFacet).forEach(function (f) { facets[f] = true; });
    });
    var priorityChips = hasRecommendation
      ? PRIORITY_CHIPS.filter(function (c) { return facets[c[0]]; }).map(function (c) { return { key: c[0], label: c[1] }; })
      : [];

    // ── Real offers ────────────────────────────────────────────────────────
    var buyRows = [];
    products.forEach(function (p) {
      if (p.entityType !== 'product') return;
      (p.sellers || []).forEach(function (s) {
        buyRows.push({
          key: p.id + '|' + s.id,
          productId: p.id,
          seller: s.merchant || 'Seller',
          forTitle: short[p.id],
          dot: 'cmp-dot-' + dot[p.id],
          meta: [s.city, s.rating ? '★ ' + s.rating : '', s.verified ? 'Verified' : '', s.delivery || ''].filter(Boolean).join(' · '),
          price: s.priceNumeric ? money(s.priceNumeric) : (s.price || ''),
          canBuy: s.inStock !== false && !!s.priceNumeric
        });
      });
    });

    // ── Notes and context ──────────────────────────────────────────────────
    var dataNotes = warnings.filter(function (w) { return w !== notice; });
    var market = analysis.market;
    var marketNote = market && market.valueCurve
      ? 'Value for money is measured against ' + market.valueCurve.n + ' ' + plural(market.productType) + ' on LOUMOO.'
      : market && market.productsInType
        ? 'Specs are ranked against ' + market.productsInType + ' ' + plural(market.productType) + ' on LOUMOO; there are too few comparable prices to judge market value.'
        : '';
    var unresolved = result.unresolved || [];
    var unresolvedText = unresolved.length
      ? (unresolved.length === 1 ? '1 item could not be found and was left out.' : unresolved.length + ' items could not be found and were left out.')
      : '';

    var winner = winnerId ? products.filter(function (p) { return p.id === winnerId; })[0] : null;
    var match = rec.matchPercentage;

    return idle({
      ready: true,
      loading: !!opts.loading,
      hasResult: true,
      title: products.map(function (p) { return short[p.id]; }).join(' vs '),
      heroCards: heroCards,
      notice: notice,
      hasRecommendation: hasRecommendation,
      recommendTitle: winner ? short[winnerId] : '',
      matchText: hasRecommendation && match !== null && match !== undefined ? match + '/100 fit for your priorities' : '',
      decisiveText: DECISIVENESS[rec.decisiveness] || '',
      summary: verdict.summary || '',
      topReasons: (rec.topReasons || []).slice(0, 2).join(' · '),
      bestValueText: bestValueText,
      bestFor: bestFor,
      reasons: reasons,
      bars: bars,
      specHead: specHead,
      specGroups: specGroups,
      priorityChips: priorityChips,
      dataNotes: dataNotes,
      marketNote: marketNote,
      unresolvedText: unresolvedText,
      buyRows: buyRows,
      hasBuyRows: buyRows.length > 0,
      stickyText: winner ? 'Recommended · ' + short[winnerId] + (winner.priceNumeric ? ' · ' + money(winner.priceNumeric) : '') : products.length + ' compared',
      stickyLabel: winner && winner.entityType === 'product' && winner.inStock !== false ? 'Add to bag' : 'Add another',
      stickyProductId: winner && winner.entityType === 'product' && winner.inStock !== false ? winnerId : null
    });
  }

  var api = { build: build, typeLabel: typeLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LoumooCompareView = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
