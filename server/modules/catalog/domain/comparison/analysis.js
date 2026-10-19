/**
 * Comparison analysis — the parts of a verdict that are pure arithmetic:
 * comparability, shared basis, per-dimension winners, weighted ranking,
 * Pareto dominance and how sensitive the winner is to the buyer's priorities.
 */

const { scoredValue, scoringBasis, dimScore, effectiveWeight } = require('./scoring');

// Two numbers closer than this (relative) are a tie: 4,900 vs 4,950 mAh is not
// a difference a buyer would feel, and the data is not that precise anyway.
const TIE_TOLERANCE = 0.02;
const CLEAR_MARGIN = 5; // points out of 100

/**
 * How comparable a set is.
 *   full     same product type — every spec dimension applies
 *   partial  same family (earbuds vs headphones) — shared dimensions only
 *   limited  unrelated kinds (a phone and a speaker) — side by side, no ranking:
 *            "the speaker is cheaper" is true and useless as a recommendation
 *   none     products mixed with stores/hotels — side by side only, no ranking
 *   insufficient  fewer than two products resolved
 */
function comparability(entries) {
  const types = [...new Set(entries.map(e => e.type))];
  const families = [...new Set(entries.map(e => e.family))];
  const categories = [...new Set(entries.map(e => e.product.category || 'general'))];
  const entityTypes = [...new Set(entries.map(e => e.product.entityType))];
  let level;
  if (entries.length < 2) level = 'insufficient';
  // Boutiques and stays are never ranked: alone (store vs store) or mixed with
  // products. The engine has no product-grade evidence about a shop.
  else if (entityTypes.length > 1 || !entityTypes.includes('product')) level = 'none';
  else if (types.length === 1) level = 'full';
  else if (families.length === 1) level = 'partial';
  else level = 'limited';
  return { level, types, families, categories, productsOnly: entityTypes.length === 1 && entityTypes[0] === 'product', ranked: level === 'full' || level === 'partial' };
}

/** Dimensions every product's profile has, in the first profile's order. */
function sharedProfile(profiles) {
  const [first, ...rest] = profiles;
  return first.filter(d => rest.every(p => p.some(o => o.key === d.key)));
}

function isTie(a, b) {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale > 0 && Math.abs(a - b) / scale <= TIE_TOLERANCE;
}

/**
 * Winner of one dimension across the set, on raw values.
 * Returns { winnerIds, tie, allEqual } — winnerIds empty when not decidable.
 */
function dimensionWinner(dim, cells) {
  const present = cells.filter(c => c.cell);
  if (dim.direction === 'none' || present.length < 2 || present.length < cells.length) {
    return { winnerIds: [], tie: false, allEqual: false, decidable: false };
  }
  const vals = present.map(c => (dim.type === 'boolean' ? (c.cell.value ? 1 : 0) : c.cell.value));
  if (vals.some(v => typeof v !== 'number')) return { winnerIds: [], tie: false, allEqual: false, decidable: false };
  const best = dim.direction === 'lower' ? Math.min(...vals) : Math.max(...vals);
  const winners = present.filter((c, i) => isTie(vals[i], best)).map(c => c.id);
  const allEqual = winners.length === present.length;
  return { winnerIds: allEqual ? [] : winners, tie: !allEqual && winners.length > 1, allEqual, decidable: true };
}

/**
 * Scores every product on the dimensions that can be ranked fairly:
 * direction set, weight > 0, not a template value in the category, and known
 * for EVERY product (a missing spec must not count for or against anyone).
 *
 * @returns {{ basisDims, partialDims, scores: {id: {total, byDim, byFacet, coverage, confidence}} }}
 */
function scoreSet({ ids, dims, cellsById, typeStats, priorities }) {
  const basisDims = [];
  const partialDims = [];

  for (const dim of dims) {
    if (dim.direction === 'none' || dim.type === 'text' || !dim.weight) continue;
    const dimStats = typeStats && typeStats.dims[dim.key];
    if (dimStats && dimStats.uniform) continue;
    const known = ids.filter(id => cellsById[id][dim.key]);
    if (known.length === ids.length) basisDims.push(dim);
    else if (known.length > 0) partialDims.push({ dim, knownFor: known });
  }

  const scores = {};
  for (const id of ids) scores[id] = { total: null, byDim: {}, byFacet: {}, coverage: 1, confidence: null };
  if (!basisDims.length) return { basisDims, partialDims, scores };

  for (const dim of basisDims) {
    const dimStats = typeStats && typeStats.dims[dim.key];
    const basis = scoringBasis(dim, dimStats);
    const vals = ids.map(id => scoredValue(dim, cellsById[id][dim.key], typeStats));
    const setRange = { min: Math.min(...vals), max: Math.max(...vals) };
    ids.forEach((id, i) => {
      scores[id].byDim[dim.key] = { score: dimScore(dim, vals[i], basis, dimStats, setRange), basis };
    });
  }

  for (const id of ids) {
    let sum = 0;
    let wSum = 0;
    let confSum = 0;
    const facetAcc = {};
    for (const dim of basisDims) {
      const w = effectiveWeight(dim, priorities);
      const s = scores[id].byDim[dim.key].score;
      sum += s * w;
      wSum += w;
      confSum += (cellsById[id][dim.key].confidence || 0) * w;
      const f = dim.facet || 'other';
      facetAcc[f] = facetAcc[f] || { sum: 0, w: 0 };
      facetAcc[f].sum += s * (dim.weight || 0);
      facetAcc[f].w += dim.weight || 0;
    }
    scores[id].total = wSum ? Math.round((sum / wSum) * 10) / 10 : null;
    scores[id].confidence = wSum ? Math.round((confSum / wSum) * 100) / 100 : null;
    for (const [f, acc] of Object.entries(facetAcc)) {
      scores[id].byFacet[f] = acc.w ? Math.round((acc.sum / acc.w) * 10) / 10 : null;
    }
  }
  return { basisDims, partialDims, scores };
}

/** Weighted total for each product under a given priority map. */
function totalsUnder(basisDims, scoresById, priorities) {
  const out = {};
  for (const [id, s] of Object.entries(scoresById)) {
    let sum = 0;
    let wSum = 0;
    for (const dim of basisDims) {
      const w = effectiveWeight(dim, priorities);
      sum += s.byDim[dim.key].score * w;
      wSum += w;
    }
    out[id] = wSum ? sum / wSum : null;
  }
  return out;
}

function rank(totals) {
  return Object.entries(totals)
    .filter(([, v]) => v !== null)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

/**
 * Pareto dominance on the basis dimensions: A dominates B when A is at least as
 * good on every one and strictly better on at least one (ties use tolerance).
 */
function dominance(basisDims, ids, cellsById) {
  const out = [];
  const better = (dim, a, b) => {
    const va = dim.type === 'boolean' ? (a.value ? 1 : 0) : a.value;
    const vb = dim.type === 'boolean' ? (b.value ? 1 : 0) : b.value;
    if (isTie(va, vb)) return 0;
    const gt = dim.direction === 'lower' ? va < vb : va > vb;
    return gt ? 1 : -1;
  };
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      let strictly = 0;
      let worse = false;
      for (const dim of basisDims) {
        const c = better(dim, cellsById[a][dim.key], cellsById[b][dim.key]);
        if (c < 0) { worse = true; break; }
        if (c > 0) strictly++;
      }
      if (!worse && strictly > 0) out.push({ dominantId: a, dominatedId: b, dimensionsBetter: strictly, dimensionsCompared: basisDims.length });
    }
  }
  return out;
}

// Facets too thin to steer a purchase on their own (every listing is "verified"
// and rated 4.7-5.0): they count in the score, never as "if X matters most".
const MINOR_FACETS = new Set(['reputation', 'trust']);

/**
 * Who would win if the buyer cared about ONE thing only? For every facet on the
 * basis, rank on that facet alone. A winner is "clear" only if it also leads
 * every one of those single-facet rankings — the honest meaning of "whatever
 * you prioritise".
 *   clear    same winner under every emphasis and a ≥ 5-point lead
 *   leaning  the user's winner leads, but another emphasis changes the result
 *            (or the lead is thin)
 *   close    thin lead and the result depends on emphasis
 */
function sensitivity(basisDims, scoresById, userPriorities, userRanking) {
  const facets = [...new Set(basisDims.map(d => d.facet).filter(f => f && !MINOR_FACETS.has(f)))];
  const winnerIf = {};
  for (const facet of facets) {
    const pri = {};
    for (const d of basisDims) pri[d.facet] = d.facet === facet ? 5 : 0;
    const r = rank(totalsUnder(basisDims, scoresById, pri));
    // A tie on that facet names nobody: the alphabetical tie-break in rank()
    // must never read as "if performance matters most, choose X".
    if (r.length && !(r.length > 1 && Math.abs(r[0][1] - r[1][1]) < 0.5)) winnerIf[facet] = r[0][0];
  }
  const top = userRanking[0];
  const second = userRanking[1];
  const margin = top && second ? Math.round((top[1] - second[1]) * 10) / 10 : null;
  const winners = new Set(Object.values(winnerIf));
  const robust = top ? (winners.size === 0 || (winners.size === 1 && winners.has(top[0]))) : false;
  let verdict;
  if (!top || margin === null) verdict = null;
  else if (robust && margin >= CLEAR_MARGIN) verdict = 'clear';
  else if (!robust && margin < CLEAR_MARGIN) verdict = 'close';
  else verdict = 'leaning';
  return { verdict, margin, robust, winnerIf };
}

module.exports = {
  TIE_TOLERANCE,
  comparability,
  sharedProfile,
  isTie,
  dimensionWinner,
  scoreSet,
  totalsUnder,
  rank,
  dominance,
  sensitivity
};
