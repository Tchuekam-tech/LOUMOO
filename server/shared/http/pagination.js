'use strict';

/**
 * LOUMOO — server-side pagination clamp.
 * ---------------------------------------------------------------------------
 * One place that turns untrusted ?page / ?limit (/?offset) query values into a
 * safe { page, limit, offset }. Negative, zero, non-numeric and absurdly large
 * values can never reach a database `.range()` / `.limit()`: `limit` is clamped
 * to [1, maxLimit] (default 24, hard max 100) and `page` to >= 1.
 *
 * This closes the "?limit=999999 returns the whole table in one response" class
 * of issue uniformly, instead of each endpoint re-deriving the rule (and some
 * forgetting the cap).
 */

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * @param {object} query  req.query (or any {page, limit, offset})
 * @param {object} [opts]
 * @param {number} [opts.defaultLimit=24]
 * @param {number} [opts.maxLimit=100]
 * @returns {{page:number, limit:number, offset:number}}
 */
function clampPagination(query, opts = {}) {
  const defaultLimit = Math.max(1, opts.defaultLimit || DEFAULT_LIMIT);
  const maxLimit = Math.max(1, opts.maxLimit || MAX_LIMIT);
  const q = query || {};

  const rawLimit = toInt(q.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, maxLimit) : defaultLimit;

  const rawPage = toInt(q.page);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

  // An explicit, valid offset wins (some endpoints paginate by offset); otherwise
  // it is derived from page. Never negative.
  const rawOffset = toInt(q.offset);
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : (page - 1) * limit;

  return { page, limit, offset };
}

module.exports = { clampPagination, DEFAULT_LIMIT, MAX_LIMIT };
