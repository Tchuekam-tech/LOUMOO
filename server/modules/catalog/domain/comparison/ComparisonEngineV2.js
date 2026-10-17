/**
 * LOUMOO Comparison Engine v2.
 *
 *   compare(products, { priorities, locale, stats }) → comparison
 *
 * `products` are canonical ComparableProducts (productAdapter.js). `stats` is a
 * CategoryStats built over the catalogue; without it the engine still works,
 * scoring relative to the compared set only and making no market claims.
 *
 * Pipeline: classify → extract specs → comparability → scoring basis →
 * weighted scores → market value → ranking, dominance, sensitivity →
 * unit costs → evidence-backed verdict → response (with the v1 fields the
 * current compare screen reads: recommendation.recommendedTitle,
 * matchPercentage, topReasons).
 */

const { classify } = require('./productTypes');
const { identityKey } = require('./productIdentity');
const { profileFor, SECTIONS, FACETS } = require('./categoryProfiles');
const { extract } = require('./specExtractor');
const { qualityIndex, scoringBasis } = require('./scoring');
const A = require('./analysis');
const { unitCosts } = require('./unitCosts');
const { buildVerdict, shortTitle } = require('./verdict');
const F = require('./format');
const { CHIP_INDEX_VERSION } = require('./chipIndex');

const ENGINE_VERSION = '2.0.0';
const MAX_PRODUCTS = 4;

// Legacy priority keys the compare screen sends → facets. `delivery` has no
// structured data behind it yet, so it is reported as ignored, not faked.
const PRIORITY_ALIASES = { perf: 'performance', portability: 'portability', ports: 'connectivity', sound: 'audio' };

const VALUE_DIM = {
  key: 'valueForMoney',
  label: { en: 'Value vs market', fr: 'Prix vs marché' },
  unit: null,
  type: 'number',
  direction: 'higher',
  weight: 2,
  facet: 'value',
  section: 'commerce'
};

function normalizePriorities(raw) {
  const priorities = {};
  const ignored = [];
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      const facet = PRIORITY_ALIASES[k] || k;
      const n = Number(v);
      if (!FACETS.includes(facet) || !Number.isFinite(n)) {
        ignored.push(k);
        continue;
      }
      priorities[facet] = Math.max(0, Math.min(5, n));
    }
  }
  return { priorities, ignored };
}

function matrixFor({ dims, ids, cellsById, winnersByDim, basisKeys, uniformKeys, scores, locale }) {
  const sections = [];
  const quickDifferences = [];
  const order = Object.keys(SECTIONS);
  const bySection = {};
  for (const dim of dims) (bySection[dim.section] = bySection[dim.section] || []).push(dim);

  for (const sectionId of order) {
    const sectionDims = bySection[sectionId];
    if (!sectionDims) continue;
    const rows = [];
    for (const dim of sectionDims) {
      const cells = ids.map(id => cellsById[id][dim.key]);
      if (cells.every(c => !c)) continue;
      const values = {};
      const raw = {};
      const sources = {};
      const percentiles = {};
      ids.forEach((id, i) => {
        values[id] = F.value(dim, cells[i], locale);
        raw[id] = cells[i] ? cells[i].value : null;
        sources[id] = cells[i] ? { source: cells[i].source, confidence: cells[i].confidence } : null;
        const s = scores[id] && scores[id].byDim[dim.key];
        if (s && s.basis === 'category') percentiles[id] = s.score;
      });
      const w = winnersByDim[dim.key] || { winnerIds: [], tie: false };
      const isDifferent = new Set(ids.map(id => JSON.stringify(raw[id]))).size > 1;
      const row = {
        key: dim.key,
        label: dim.label[locale],
        unit: dim.unit,
        format: dim.type,
        direction: dim.direction,
        isDifferent,
        winnerProductId: w.winnerIds.length === 1 ? w.winnerIds[0] : null,
        winnerProductIds: w.winnerIds,
        isTie: Boolean(w.tie),
        scored: basisKeys.has(dim.key),
        uniformInCategory: uniformKeys.has(dim.key),
        approximate: Boolean(dim.approximate),
        values,
        raw,
        sources,
        percentiles: Object.keys(percentiles).length ? percentiles : null
      };
      rows.push(row);
      if (isDifferent) {
        quickDifferences.push({
          sectionId,
          sectionTitle: SECTIONS[sectionId][locale],
          key: dim.key,
          label: row.label,
          winnerProductId: row.winnerProductId,
          isTie: row.isTie,
          values
        });
      }
    }
    if (rows.length) sections.push({ id: sectionId, title: SECTIONS[sectionId][locale], rows });
  }
  return { matrixSections: sections, quickDifferences };
}

/**
 * @param {object[]} products canonical ComparableProducts (1–4)
 * @param {{ priorities?: object, locale?: string, stats?: import('./categoryStats').CategoryStats }} options
 */
function compare(products, options = {}) {
  const locale = F.normLocale(options.locale);
  const stats = options.stats || null;
  const { priorities, ignored: prioritiesIgnored } = normalizePriorities(options.priorities);
  const list = (products || []).slice(0, MAX_PRODUCTS);

  const entries = list.map(p => Object.assign({ product: p, id: p.id, key: identityKey(p) }, classify(p)));
  const ids = entries.map(e => e.id);
  const titles = Object.fromEntries(entries.map(e => [e.id, shortTitle(e.product.title)]));

  const comparability = A.comparability(entries);
  const sameType = comparability.types.length === 1 && comparability.level === 'full';
  const type = sameType ? comparability.types[0] : null;
  const typeStats = sameType && stats ? stats.typeStats(type) : null;
  const dims = sameType ? profileFor(type) : A.sharedProfile(entries.map(e => profileFor(e.type)));

  // Each product's own listing values (what this seller states).
  const cellsById = {};
  for (const e of entries) {
    const own = extract(e.product, profileFor(e.type));
    cellsById[e.id] = Object.fromEntries(dims.map(d => [d.key, own[d.key] || null]));
  }

  const uniformDims = typeStats ? dims.filter(d => typeStats.dims[d.key] && typeStats.dims[d.key].uniform) : [];
  const uniformKeys = new Set(uniformDims.map(d => d.key));

  let basisDims = [];
  let partialDims = [];
  let scores = Object.fromEntries(ids.map(id => [id, { total: null, byDim: {}, byFacet: {}, coverage: 0, confidence: null }]));
  let ranking = [];
  let dominance = [];
  let sensitivity = null;
  const valueById = {};
  let specScoreById = null;
  let rankingWithheld = null;

  if (comparability.ranked) {
    ({ basisDims, partialDims, scores } = A.scoreSet({ ids, dims, cellsById, typeStats, priorities }));
    // Price and ratings alone do not make a recommendation: "the cheaper one
    // wins" is not analysis. Without one shared verified spec, nobody is ranked.
    if (!basisDims.some(d => d.section !== 'commerce')) rankingWithheld = 'no-shared-specs';

    // Market value joins the score only when every product has one.
    if (sameType && stats) {
      for (const e of entries) {
        const q = qualityIndex(cellsById[e.id], dims, typeStats);
        const price = cellsById[e.id].price && cellsById[e.id].price.value;
        const v = stats.valueAssessment(type, price, q);
        if (v) valueById[e.id] = Object.assign({ qualityIndex: Math.round(q.q * 10) / 10 }, v);
      }
    }
    const scoringDims = basisDims.slice();
    if (basisDims.length && ids.every(id => valueById[id])) {
      scoringDims.push(VALUE_DIM);
      for (const id of ids) {
        scores[id].byDim.valueForMoney = { score: valueById[id].score, basis: 'category' };
        scores[id].byFacet.value = valueById[id].score;
      }
    }
    const totals = A.totalsUnder(scoringDims, scores, priorities);
    for (const id of ids) scores[id].total = !rankingWithheld && totals[id] !== null ? Math.round(totals[id] * 10) / 10 : null;
    if (!rankingWithheld) {
      ranking = A.rank(totals);
      dominance = A.dominance(basisDims, ids, cellsById);
      sensitivity = ranking.length > 1 ? A.sensitivity(scoringDims, scores, priorities, ranking) : null;
    }

    const specDims = basisDims.filter(d => d.section !== 'commerce');
    if (specDims.length) {
      const neutral = A.totalsUnder(specDims, scores, {});
      specScoreById = Object.fromEntries(ids.map(id => [id, neutral[id]]));
    }
    basisDims = scoringDims;
  }

  const winnersByDim = {};
  for (const dim of dims) {
    winnersByDim[dim.key] = A.dimensionWinner(dim, ids.map(id => ({ id, cell: cellsById[id][dim.key] })));
  }

  const units = sameType ? unitCosts(type, ids, cellsById) : [];
  const conflictsById = {};
  const offersById = {};
  for (const e of entries) {
    const identity = stats ? stats.identity(e.key) : null;
    conflictsById[e.id] = identity ? identity.conflicts : {};
    offersById[e.id] = identity ? identity.offers : null;
  }

  const duplicates = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[i].key === entries[j].key) duplicates.push([entries[i].id, entries[j].id]);
    }
  }

  const realBasis = basisDims.filter(d => d.key !== VALUE_DIM.key);
  const verdict = buildVerdict({
    ids,
    titles,
    type,
    dims,
    comparability,
    basisDims: realBasis,
    rankingWithheld,
    partialDims,
    uniformDims,
    cellsById,
    scores,
    ranking,
    dominance,
    sensitivity,
    winnersByDim,
    valueById,
    specScoreById,
    unitCosts: units,
    conflictsById
  }, locale);

  const basisKeys = new Set(basisDims.map(d => d.key));
  const { matrixSections, quickDifferences } = matrixFor({ dims, ids, cellsById, winnersByDim, basisKeys, uniformKeys, scores, locale });

  const winnerId = ranking.length ? ranking[0][0] : null;
  const productSummaries = entries.map(e => {
    const p = e.product;
    const offers = offersById[e.id] || (p.price > 0 ? [{ listingId: p.id, sellerId: p.seller && p.seller.id, sellerName: p.seller && p.seller.name, city: p.seller && p.seller.city, sellerRating: p.seller && p.seller.rating, verified: Boolean(p.seller && p.seller.verified), price: p.price, fulfillmentLabel: p.fulfillmentLabel, inStock: p.inStock }] : []);
    return {
      id: p.id,
      title: p.title,
      shortTitle: titles[e.id],
      brand: p.brand,
      category: p.category,
      subCategory: p.subcategory,
      productType: e.type,
      entityType: p.entityType,
      price: p.price > 0 ? F.money(p.price, locale) : (p.displayPrice || null),
      priceNumeric: p.price,
      compareAtPrice: p.compareAtPrice,
      currency: p.currency,
      rating: p.rating,
      reviewsCount: p.reviewCount,
      soldCount: p.soldCount,
      merchant: p.seller && p.seller.name,
      merchantCity: p.seller && p.seller.city,
      verified: Boolean(p.seller && p.seller.verified),
      inStock: p.inStock,
      stockUnits: p.stockKnown ? p.stockUnits : null,
      stockKnown: Boolean(p.stockKnown),
      image: p.image,
      conditionLabel: p.conditionLabel,
      fulfillmentLabel: p.fulfillmentLabel,
      score: scores[e.id].total,
      valueScore: valueById[e.id] ? valueById[e.id].score : null,
      // Offers: one per seller at their lowest price. Contact details are not
      // part of a comparison; the product page owns them.
      sellers: offers.map(o => ({
        id: o.listingId,
        merchant: o.sellerName,
        city: o.city,
        priceNumeric: o.price,
        price: F.money(o.price, locale),
        rating: o.sellerRating,
        verified: o.verified,
        delivery: o.fulfillmentLabel,
        inStock: o.inStock
      })),
      editorial: p.editorial || null
    };
  });

  const rankings = ranking.map(([id, total]) => ({
    productId: id,
    title: titles[id],
    price: productSummaries.find(s => s.id === id).price,
    score: Math.round(total * 10) / 10,
    reasons: verdict.facts.filter(f => f.productId === id && f.kind === 'advantage').slice(0, 3).map(f => f.text)
  }));

  const firstNotice = verdict.warnings.find(Boolean) || null;
  const marketContext = typeStats
    ? {
      productType: type,
      productsInType: typeStats.n,
      valueCurve: typeStats.valueCurve ? { r2: typeStats.valueCurve.r2, n: typeStats.valueCurve.n } : null,
      valueCurveUnavailable: typeStats.valueCurve ? null : (typeStats.valueCurveRejected || null)
    }
    : null;

  return {
    success: true,
    engineVersion: ENGINE_VERSION,
    locale,
    compatibility: {
      compatible: comparability.ranked,
      level: comparability.level,
      isSingleCategory: comparability.categories.length === 1,
      categories: comparability.categories,
      productTypes: comparability.types,
      warning: comparability.level === 'full' ? null : firstNotice
    },
    productCount: entries.length,
    products: productSummaries,
    verdict: {
      summary: verdict.summary,
      bestOverall: verdict.bestOverall
        ? Object.assign({}, verdict.bestOverall, {
          price: productSummaries.find(s => s.id === verdict.bestOverall.productId).price,
          pros: (verdict.tradeoffs.find(t => t.productId === verdict.bestOverall.productId) || { pros: [] }).pros
        })
        : null,
      bestValue: verdict.bestValue
        ? Object.assign({}, verdict.bestValue, { price: productSummaries.find(s => s.id === verdict.bestValue.productId).price })
        : null,
      bestFor: verdict.bestFor,
      tradeoffs: verdict.tradeoffs,
      facts: verdict.facts,
      warnings: verdict.warnings
    },
    recommendation: {
      recommendedProductId: winnerId,
      recommendedTitle: winnerId ? titles[winnerId] : null,
      // How well the winner fits the stated priorities, 0–100, unpadded.
      matchPercentage: winnerId && scores[winnerId].total !== null ? Math.round(scores[winnerId].total) : null,
      confidence: winnerId ? scores[winnerId].confidence : null,
      decisiveness: sensitivity ? sensitivity.verdict : null,
      topReasons: verdict.topReasons,
      rankings,
      prioritiesUsed: priorities,
      prioritiesIgnored
    },
    analysis: {
      comparability,
      rankingWithheld,
      basis: {
        dimensions: basisDims.map(d => d.key),
        partial: partialDims.map(p => ({ key: p.dim.key, knownFor: p.knownFor })),
        uniformInCategory: uniformDims.map(d => d.key),
        scoring: Object.fromEntries(basisDims.filter(d => d.key !== VALUE_DIM.key).map(d => [d.key, scoringBasis(d, typeStats && typeStats.dims[d.key])]))
      },
      scores,
      dominance,
      sensitivity,
      marketValue: valueById,
      unitCosts: units,
      market: marketContext,
      dataQuality: { conflicts: conflictsById, duplicates }
    },
    quickDifferences,
    matrixSections,
    meta: {
      chipIndexVersion: CHIP_INDEX_VERSION,
      statsBuiltAt: stats ? stats.builtAt : null
    }
  };
}

module.exports = { compare, normalizePriorities, ENGINE_VERSION, MAX_PRODUCTS };
