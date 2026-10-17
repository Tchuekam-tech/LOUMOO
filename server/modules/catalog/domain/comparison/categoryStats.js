/**
 * Category statistics — the market context every comparison is measured against.
 *
 * Built once from the whole catalogue:
 *   1. listings are grouped into product identities (copies count once);
 *   2. each identity gets one representative value per dimension (median of
 *      what its listings state) and any disagreement between copies is kept
 *      as a data-quality conflict;
 *   3. per product type and dimension: sorted distribution, quantiles, and a
 *      `uniform` flag when one value dominates (template text such as every
 *      laptop listing "Jusqu'à 18h" carries no information to rank on);
 *   4. per type, a price/quality curve: ln(price) regressed on the quality
 *      index. A product's distance from that line is what "good value" means.
 */

const { classify } = require('./productTypes');
const { identityKey } = require('./productIdentity');
const { profileFor } = require('./categoryProfiles');
const { extract } = require('./specExtractor');
const { qualityIndex, percentileOf } = require('./scoring');

const UNIFORM_SHARE = 0.8;
const MIN_N_UNIFORM = 3;
const MIN_N_CURVE = 8;
const MIN_R2_CURVE = 0.25;
const MIN_QUALITY_COVERAGE = 0.5;
const RATING_PRIOR_WEIGHT = 20; // reviews' worth of trust in the type's mean
// Dimensions that belong to an offer, not to the product: copies may differ.
const OFFER_LEVEL = new Set(['price', 'rating', 'sellerVerified', 'inStock', 'warrantyMonths']);

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function distribution(values, kind = 'number') {
  const sorted = values.slice().sort((a, b) => a - b);
  const counts = new Map();
  for (const v of sorted) counts.set(v, (counts.get(v) || 0) + 1);
  const modeCount = Math.max(...counts.values());
  const modeShare = modeCount / sorted.length;
  return {
    n: sorted.length,
    sorted,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: median(sorted),
    p10: quantile(sorted, 0.1),
    p90: quantile(sorted, 0.9),
    distinct: counts.size,
    modeShare: Math.round(modeShare * 100) / 100,
    // A dominant NUMBER is template text ("Jusqu'à 18h" on every laptop). A rare
    // yes/no feature is real variation, so a boolean is uniform only when
    // every product agrees.
    uniform: sorted.length >= MIN_N_UNIFORM && (kind === 'boolean' ? counts.size === 1 : modeShare >= UNIFORM_SHARE)
  };
}

/** Ordinary least squares y = a + b·x with R² and residual standard deviation. */
function fitLine(points) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  if (!sxx || !syy) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  const r2 = (sxy * sxy) / (sxx * syy);
  const residuals = points.map(p => p.y - (a + b * p.x));
  const sd = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / Math.max(1, n - 2));
  return { a, b, r2, sd, residuals };
}

// One representative value per identity: median for numbers, majority for
// booleans, first for text. Disagreements are returned separately.
function representative(dim, cells) {
  const present = cells.filter(Boolean);
  if (!present.length) return { cell: null, conflict: null };
  if (dim.type === 'number') {
    const nums = present.map(c => c.value).sort((a, b) => a - b);
    const distinct = [...new Set(nums)];
    const med = median(nums);
    const closest = present.reduce((best, c) => (Math.abs(c.value - med) < Math.abs(best.value - med) ? c : best), present[0]);
    return {
      cell: Object.assign({}, closest, { value: med }),
      conflict: distinct.length > 1 ? distinct : null
    };
  }
  if (dim.type === 'boolean') {
    const yes = present.filter(c => c.value).length;
    const value = yes * 2 >= present.length;
    const cell = present.find(c => c.value === value) || present[0];
    return { cell, conflict: yes && yes < present.length ? [false, true] : null };
  }
  return { cell: present[0], conflict: null };
}

/**
 * The real offers for one product: one per seller, at that seller's lowest
 * payable price. Copies from the same boutique are not extra offers.
 */
function offersOf(listings) {
  const bySeller = new Map();
  for (const l of listings) {
    if (!(l.price > 0)) continue;
    const sellerKey = (l.seller && (l.seller.id || l.seller.name)) || `listing:${l.id}`;
    const prev = bySeller.get(sellerKey);
    if (!prev || l.price < prev.price) {
      bySeller.set(sellerKey, {
        listingId: l.id,
        sellerId: (l.seller && l.seller.id) || null,
        sellerName: (l.seller && l.seller.name) || null,
        city: (l.seller && l.seller.city) || null,
        sellerRating: (l.seller && l.seller.rating) || null,
        verified: Boolean(l.seller && l.seller.verified),
        price: l.price,
        fulfillmentLabel: l.fulfillmentLabel || null,
        inStock: l.inStock
      });
    }
  }
  return [...bySeller.values()].sort((a, b) => a.price - b.price);
}

class CategoryStats {
  constructor() {
    this.types = new Map(); // type → { n, dims, ratingPrior, valueCurve }
    this.identities = new Map(); // key → { type, family, listings: [], values, conflicts, quality }
    this.builtAt = null;
  }

  /**
   * @param {object[]} products canonical ComparableProducts (whole catalogue)
   */
  static build(products) {
    const stats = new CategoryStats();
    const groups = new Map();

    for (const p of products) {
      if (!p || p.entityType !== 'product') continue;
      const { type, family } = classify(p);
      const key = identityKey(p);
      let g = groups.get(key);
      if (!g) {
        g = { key, type, family, listings: [], cells: [] };
        groups.set(key, g);
      }
      g.listings.push(p);
      g.cells.push(extract(p, profileFor(type)));
    }

    // Representative values and copy conflicts per identity.
    const byType = new Map();
    for (const g of groups.values()) {
      const profile = profileFor(g.type);
      const values = {};
      const conflicts = {};
      for (const dim of profile) {
        const { cell, conflict } = representative(dim, g.cells.map(c => c[dim.key]));
        values[dim.key] = cell;
        if (conflict) conflicts[dim.key] = conflict;
      }
      // Market statistics only use SPECS the copies agree on: when listings of
      // one product state different batteries, neither figure is evidence.
      // Price and rating legitimately vary between offers; their median stands.
      const agreed = {};
      for (const k of Object.keys(values)) agreed[k] = conflicts[k] && !OFFER_LEVEL.has(k) ? null : values[k];
      const identity = { key: g.key, type: g.type, family: g.family, listingIds: g.listings.map(l => l.id), offers: offersOf(g.listings), values: agreed, statedValues: values, conflicts, quality: null };
      stats.identities.set(g.key, identity);
      if (!byType.has(g.type)) byType.set(g.type, []);
      byType.get(g.type).push(identity);
    }

    for (const [type, identities] of byType) {
      const profile = profileFor(type);
      const dims = {};
      const ratings = identities.map(i => i.values.rating && i.values.rating.value).filter(v => typeof v === 'number');
      const ratingPrior = ratings.length
        ? { mean: ratings.reduce((s, v) => s + v, 0) / ratings.length, weight: RATING_PRIOR_WEIGHT }
        : null;

      for (const dim of profile) {
        if (dim.type === 'text' || dim.direction === 'none') continue;
        const vals = identities
          .map(i => i.values[dim.key])
          .filter(Boolean)
          .map(c => (dim.type === 'boolean' ? (c.value ? 1 : 0) : c.value))
          .filter(v => typeof v === 'number' && Number.isFinite(v));
        if (vals.length) dims[dim.key] = distribution(vals, dim.type);
      }

      const typeStats = { type, n: identities.length, dims, ratingPrior, valueCurve: null };
      stats.types.set(type, typeStats);

      // Quality index per identity, then the price/quality curve.
      const points = [];
      for (const identity of identities) {
        identity.quality = qualityIndex(identity.values, profile, typeStats);
        const price = identity.values.price && identity.values.price.value;
        if (identity.quality.q !== null && identity.quality.coverage >= MIN_QUALITY_COVERAGE && price > 0) {
          points.push({ x: identity.quality.q, y: Math.log(price), key: identity.key });
        }
      }
      if (points.length >= MIN_N_CURVE) {
        const fit = fitLine(points);
        if (fit && fit.b > 0 && fit.r2 >= MIN_R2_CURVE) {
          typeStats.valueCurve = {
            a: fit.a,
            b: fit.b,
            r2: Math.round(fit.r2 * 100) / 100,
            sd: fit.sd,
            n: points.length,
            // Sorted residuals: a product's residual percentile is its value rank.
            residuals: fit.residuals.slice().sort((x, y) => x - y)
          };
        } else {
          typeStats.valueCurve = null;
          typeStats.valueCurveRejected = fit
            ? { reason: fit.b <= 0 ? 'price-does-not-rise-with-quality' : 'weak-fit', r2: Math.round(fit.r2 * 100) / 100, n: points.length }
            : { reason: 'no-variance', n: points.length };
        }
      } else {
        typeStats.valueCurveRejected = { reason: 'too-few-products', n: points.length };
      }
    }

    stats.builtAt = new Date().toISOString();
    return stats;
  }

  typeStats(type) {
    return this.types.get(type) || null;
  }

  identity(key) {
    return this.identities.get(key) || null;
  }

  /**
   * Where a price sits against what the type's curve expects for that quality.
   * Returns null when there is no trustworthy curve or quality is too unknown.
   *   expectedPrice  what products of this quality usually cost here
   *   deviation      price / expected − 1  (−0.18 = 18 % below expectation)
   *   score          0–100, share of the type that is WORSE value
   */
  valueAssessment(type, price, quality) {
    const ts = this.typeStats(type);
    const curve = ts && ts.valueCurve;
    if (!curve || !(price > 0) || !quality || quality.q === null || quality.coverage < MIN_QUALITY_COVERAGE) return null;
    const expectedLog = curve.a + curve.b * quality.q;
    const residual = Math.log(price) - expectedLog;
    const expectedPrice = Math.exp(expectedLog);
    // Lower residual = cheaper than expected = better value.
    const worseShare = 100 - percentileOf(curve.residuals, residual);
    return {
      expectedPrice: Math.round(expectedPrice / 100) * 100,
      deviation: Math.round((price / expectedPrice - 1) * 1000) / 1000,
      score: Math.round(worseShare * 10) / 10,
      // How far outside normal scatter, in standard deviations.
      zScore: curve.sd ? Math.round((residual / curve.sd) * 100) / 100 : null,
      fit: { r2: curve.r2, n: curve.n }
    };
  }
}

module.exports = { CategoryStats, distribution, fitLine, UNIFORM_SHARE, MIN_N_CURVE };
