/**
 * LOUMOO — one money formatter (cleanup brief, Step 6: currency formatting).
 * ---------------------------------------------------------------------------
 * A single XAF/FCFA formatter so the buyer- and crawler-facing price string is defined in ONE place
 * instead of being re-implemented per module. UMD (the seoModel.js pattern): `require()` it in Node
 * (the server modules) and, when the shell is wired to load it, `window.LoumooMoney` in the browser.
 *
 * Canonical convention — the buyer/SEO one, "<space-grouped> FCFA" (e.g. 85 000 FCFA):
 *   formatXaf(amount)            round, space-group, suffix " FCFA"  — returns "0 FCFA" for 0
 *   formatMoney(amount, cur)     same grouping; XAF -> " FCFA", else " <CUR>"; "" for a zero/blank amount
 *
 * The two differ ONLY on zero, matching the two call sites they replace exactly (so nothing re-formats):
 * CatalogRepository.formatXaf showed "0 FCFA"; PrerenderService.formatPrice showed "" for 0.
 *
 * NOT yet migrated (a deliberate convention change, flagged for a follow-up — see the PR): the
 * admin/analytics formatters that render "<N> XAF" via toLocaleString (StoreAnalyticsUseCase,
 * SuperAdminRepository) and the prefix-"XAF N" sites (OrderNotificationBuilder, comparison EN,
 * messaging). The browser shell's inline formatters live in the baked controller (build_redesign.py),
 * not in src/core/component/*.js, so wiring them needs shell surgery and is out of this PR's scope.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.LoumooMoney = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Whole-number amount with a space every three digits: 85000 -> "85 000". */
  function group(amount) {
    return String(Math.round(Number(amount) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /** "85 000 FCFA". Always returns a string, "0 FCFA" for 0 (CatalogRepository.formatXaf semantics). */
  function formatXaf(amount) {
    return group(amount) + ' FCFA';
  }

  /** "85 000 FCFA" for XAF, "85 000 USD" otherwise; "" for a zero/blank amount (PrerenderService.formatPrice semantics). */
  function formatMoney(amount, currency) {
    var n = Math.round(Number(amount) || 0);
    if (!n) return '';
    var grouped = group(n);
    return (currency || 'XAF') === 'XAF' ? grouped + ' FCFA' : grouped + ' ' + currency;
  }

  return { formatXaf: formatXaf, formatMoney: formatMoney, group: group };
});
