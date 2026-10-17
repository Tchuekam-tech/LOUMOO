/**
 * Scoring — turns extracted values into 0–100 scores and weighted totals.
 *
 * A dimension score is, when the catalogue has enough comparable products, the
 * product's PERCENTILE in its type ("battery larger than 80 % of smartphones on
 * LOUMOO"), so a score means the same thing whatever it is compared with. When
 * the type is too thin for percentiles, scores are relative to the compared set
 * and say so (`basis: 'set'`). Nothing is clamped or padded.
 */

const MIN_N_PERCENTILE = 5;
const PRIORITY_NEUTRAL = 3;

/** Midrank percentile of `value` in an ascending-sorted array, 0–100. */
function percentileOf(sorted, value) {
  if (!sorted || !sorted.length) return null;
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return ((below + 0.5 * equal) / sorted.length) * 100;
}

/** Shrinks a rating toward the type's mean when it rests on few reviews. */
function bayesianRating(rating, reviewCount, prior) {
  if (rating === null || rating === undefined) return null;
  if (!prior || reviewCount === null || reviewCount === undefined) return rating;
  const m = prior.weight;
  return (prior.mean * m + rating * reviewCount) / (m + reviewCount);
}

/** The value a dimension is scored on (ratings are adjusted first). */
function scoredValue(dim, cell, typeStats) {
  if (!cell) return null;
  if (dim.type === 'boolean') return cell.value ? 1 : 0;
  if (typeof cell.value !== 'number') return null;
  if (dim.adjust === 'bayesian') {
    return bayesianRating(cell.value, cell.meta && cell.meta.reviewCount, typeStats && typeStats.ratingPrior);
  }
  return cell.value;
}

/**
 * Decides once per comparison how a dimension is scored, so every product in
 * the set is measured the same way.
 *   category  percentile against the product type (needs MIN_N and variety)
 *   set       min–max within the compared products
 *   boolean   yes = 100, no = 0
 */
function scoringBasis(dim, dimStats) {
  if (dim.type === 'boolean') return 'boolean';
  if (dimStats && dimStats.n >= MIN_N_PERCENTILE && !dimStats.uniform) return 'category';
  return 'set';
}

function dimScore(dim, value, basis, dimStats, setRange) {
  if (value === null || value === undefined) return null;
  let s;
  if (basis === 'boolean') {
    s = value ? 100 : 0;
  } else if (basis === 'category') {
    s = percentileOf(dimStats.sorted, value);
  } else {
    const { min, max } = setRange;
    s = max > min ? ((value - min) / (max - min)) * 100 : 50;
  }
  if (dim.direction === 'lower') s = 100 - s;
  return Math.round(s * 10) / 10;
}

/** Buyer priority (0–5, 3 = neutral) → weight multiplier. */
function priorityMultiplier(priorities, facet) {
  if (!priorities || !facet || priorities[facet] === undefined || priorities[facet] === null) return 1;
  const p = Number(priorities[facet]);
  if (!Number.isFinite(p)) return 1;
  return Math.max(0, Math.min(5, p)) / PRIORITY_NEUTRAL;
}

function effectiveWeight(dim, priorities) {
  return (dim.weight || 0) * priorityMultiplier(priorities, dim.facet);
}

/**
 * Quality index of one product inside its type: the weighted mean of its spec
 * dimension percentiles (commerce dimensions excluded — they are not what the
 * money buys). Returns { q, coverage } where coverage is the share of the
 * profile's spec weight that had a value. Used by the price/quality curve.
 */
function qualityIndex(values, profile, typeStats) {
  let sum = 0;
  let wSum = 0;
  let wAll = 0;
  for (const dim of profile) {
    if (dim.section === 'commerce' || dim.direction === 'none' || !dim.weight) continue;
    const dimStats = typeStats && typeStats.dims[dim.key];
    if (!dimStats || dimStats.uniform) continue;
    const basis = scoringBasis(dim, dimStats);
    if (basis === 'set') continue; // no stable meaning outside a comparison
    wAll += dim.weight;
    const v = scoredValue(dim, values[dim.key], typeStats);
    const s = dimScore(dim, v, basis, dimStats, null);
    if (s === null) continue;
    sum += s * dim.weight;
    wSum += dim.weight;
  }
  if (!wSum) return { q: null, coverage: 0 };
  return { q: sum / wSum, coverage: wAll ? wSum / wAll : 0 };
}

module.exports = {
  MIN_N_PERCENTILE,
  percentileOf,
  bayesianRating,
  scoredValue,
  scoringBasis,
  dimScore,
  priorityMultiplier,
  effectiveWeight,
  qualityIndex
};
