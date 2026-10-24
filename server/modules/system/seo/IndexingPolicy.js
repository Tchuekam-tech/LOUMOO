'use strict';

/**
 * LOUMOO — which database records are worth offering to a search engine.
 * ---------------------------------------------------------------------------
 * The sitemap is a promise: "these are the pages to index". Three kinds of row in the live
 * database broke it (measured on https://www.loumoo.store/sitemap.xml, 2026-10-24: 86 of the
 * 105 store URLs, 3 of the 10 listing URLs and the three-fold MacBook were not real shops or
 * products):
 *
 *   - Throwaway stores and listings. The integration suites and the end-to-end journeys create
 *     real rows ("Test Boutique mto5p3mm9ed258", slug test-boutique-mto5p3mm9ed258; a "loop
 *     test" boutique; a harness listing) and a run that stops early leaves them behind. Nothing
 *     in the schema marks them (there is no is_test column), so they are recognised by the names
 *     the harnesses give them. A flag would be better and is a follow-up: it needs a migration on
 *     the production database and a change to every harness that creates a store.
 *   - Placeholder slugs. A listing is given its slug when the draft is created, from the
 *     placeholder title ("Untitled draft listing" -> untitled-draft-listing-lgp4), and keeps it
 *     after the seller writes a real title, so the URL still says "untitled draft".
 *   - Repeats. The same seller published the same product three times.
 *
 * Pure functions over plain rows (no I/O), so SitemapService stays a thin query and the rules are
 * unit-tested without a database. Excluding a row from the SITEMAP does not hide its page: the
 * page still answers (an owner's own link keeps working) and is not noindex; it is simply not
 * advertised.
 */

// test-boutique-<id>, loop-test-boutique-<id>, harness-test-<anything>
const TEST_STORE_SLUG = /^(?:loop-)?test-boutique(?:-|$)|^harness-test(?:-|$)/;
const TEST_STORE_NAME = /^(?:loop\s+)?test\s+boutique\b|^harness\s+test\b/i;
// untitled-draft-listing-<id>, harness-test-listing-<id>
const PLACEHOLDER_LISTING_SLUG = /^(?:untitled-draft-listing|harness-test-listing)(?:-|$)/;

function text(value) {
  return String(value == null ? '' : value);
}

/**
 * True for a store the test harnesses created. The `is_test` flag (migration 023) is authoritative
 * when the row carries it; the slug/name patterns are the fallback for rows read without the column
 * (before the migration runs) and for a flagged store that was renamed to look ordinary.
 */
function isTestStore(store) {
  if (!store) return false;
  if (store.is_test === true) return true;
  return TEST_STORE_SLUG.test(text(store.slug)) || TEST_STORE_NAME.test(text(store.name).trim());
}

/** True for a listing whose slug is still a draft/harness placeholder. */
function hasPlaceholderSlug(listing) {
  return Boolean(listing) && PLACEHOLDER_LISTING_SLUG.test(text(listing.slug));
}

/** A store that is open to the public: ACTIVE, and not PRIVATE (a missing visibility is public). */
function isPublicStore(store) {
  if (!store) return false;
  return store.status === 'ACTIVE' && (store.visibility == null || store.visibility === 'PUBLIC');
}

/** Lower-case words of a text, for comparing two titles or names. */
function words(value) {
  return text(value).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

/**
 * What makes two listings the same offer: the same title, from a seller with the same name, in the
 * same category, at the same price. The seller's NAME rather than its id: the three MacBooks were
 * published from three different stores that are all called "Kamer Tech Solutions". Two different
 * sellers of one product are different offers and are never merged.
 */
function duplicateKey(listing) {
  const store = (listing && listing.stores) || {};
  return [
    words(listing && listing.title).join(' '),
    words(store.name).join(' '),
    text(listing && listing.category_id).toLowerCase(),
    text(listing && listing.base_price_minor)
  ].join('|');
}

/** Oldest first, then by id: the same listing wins every time, and a later copy never displaces it. */
function compareOldest(a, b) {
  const ta = text(a.created_at);
  const tb = text(b.created_at);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return text(a.id) < text(b.id) ? -1 : text(a.id) > text(b.id) ? 1 : 0;
}

/**
 * One listing per offer: of each group of repeats, the oldest. Rows without a title are never
 * grouped (nothing says they are the same). The input order is kept.
 */
function dropRepeatedListings(listings) {
  const groups = new Map();
  for (const listing of listings) {
    const key = duplicateKey(listing);
    if (!words(listing && listing.title).length) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(listing);
  }
  const keep = new Set();
  for (const group of groups.values()) keep.add(group.slice().sort(compareOldest)[0]);
  return listings.filter((listing) => !words(listing && listing.title).length || keep.has(listing));
}

module.exports = {
  isTestStore,
  isPublicStore,
  hasPlaceholderSlug,
  duplicateKey,
  dropRepeatedListings
};
