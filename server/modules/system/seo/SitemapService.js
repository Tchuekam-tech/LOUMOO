'use strict';

/**
 * LOUMOO — Dynamic sitemap data gathering.
 * ---------------------------------------------------------------------------
 * Composes the full /sitemap.xml from these sources:
 *   1. Static public routes, derived from the single route registry
 *      (src/routing/routes.js) so the sitemap can never list a private,
 *      auth-only, redirect-only or not-yet-built page.
 *   2. Published, public product detail pages (iam.listings), by their
 *      canonical slug.
 *   3. The curated storefront catalogue (src/data/catalog_products.js): the
 *      house store's products, which the marketplace sells and whose pages
 *      answer 200 — static data, so listed even when the database is down.
 *   4. Category pages that have products (CategoryDirectory), the same rule the
 *      prerender uses to mark a category page indexable.
 *   5. Active public store pages (iam.stores).
 *
 * Database access is best-effort: if Supabase is unreachable, unconfigured
 * (hermetic tests), or errors, the dynamic sections are simply omitted and the
 * static routes are still served. Generating the sitemap must never 500.
 */

const SeoContent = require('./SeoContent');
const FrontendRoutes = require('../../../../src/routing/routes');
const logger = require('../../../shared/logging/logger');

// Bound the dynamic sections so a large catalogue can never produce a sitemap
// above the 50,000-URL / 50MB spec limit, or a slow unbounded scan. When the
// catalogue outgrows these, the fix is a sitemap index (follow-up), not a
// silent truncation — so we log when we clip.
const MAX_PRODUCTS = 10000;
const MAX_STORES = 5000;

/**
 * Public, indexable, non-parameterised routes from the registry.
 * Excludes: parameterised paths (:id), auth/guest-only screens, redirect-only
 * screens, `page` documents (the admin control center), `unavailable` areas,
 * and anything under a private prefix (belt-and-braces for routes that are
 * mis-marked public, e.g. /account/settings).
 */
function collectStaticRoutes() {
  const routes = (FrontendRoutes && FrontendRoutes.routes) || [];
  const PRIORITY = { '/': 1.0, '/marketplace': 0.9, '/stores': 0.9, '/travel': 0.8, '/hotels': 0.8 };
  const DAILY = new Set(['/', '/marketplace', '/stores', '/announcements']);

  return routes
    .filter((r) => r && r.kind === 'screen')
    .filter((r) => r.access && r.access.kind === 'public')
    .filter((r) => !r.guestOnly)
    .filter((r) => (r.direct || 'allow') === 'allow')
    .filter((r) => typeof r.path === 'string' && r.path.indexOf(':') === -1)
    .filter((r) => !SeoContent.isPrivatePath(r.path))
    .map((r) => ({
      path: r.path,
      changefreq: DAILY.has(r.path) ? 'daily' : 'weekly',
      priority: PRIORITY[r.path] != null ? PRIORITY[r.path] : 0.6
    }));
}

/** Admin Supabase client, or null when it cannot be obtained (never throws). */
function tryDb() {
  try {
    const { SupabaseDatabase } = require('../../../infrastructure/database/SupabaseClient');
    return SupabaseDatabase.getAdmin();
  } catch (_) {
    return null;
  }
}

// The router only accepts [A-Za-z0-9_-]{1,128} as a path parameter: a key outside
// it would be a sitemap URL that 404s.
const PARAM_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Live listings as sitemap entries, plus the set of their category ids (so the
 * category section can list a category that only has database listings).
 * @returns {Promise<{entries: Array, categories: Set<string>}>}
 */
async function collectProductEntries(db) {
  const categories = new Set();
  if (!db) return { entries: [], categories };
  try {
    const { data, error } = await db
      .from('listings')
      .select('id, slug, category_id, updated_at, stores!inner(status)')
      .eq('status', 'PUBLISHED')
      .eq('visibility', 'PUBLIC')
      .eq('stores.status', 'ACTIVE')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(MAX_PRODUCTS + 1);
    if (error) throw error;
    const rows = data || [];
    if (rows.length > MAX_PRODUCTS) {
      logger.warn(`[Sitemap] product listings clipped at ${MAX_PRODUCTS}; add a sitemap index.`);
    }
    const entries = [];
    for (const r of rows.slice(0, MAX_PRODUCTS)) {
      const key = String(r.slug || r.id || '');
      if (!PARAM_RE.test(key)) continue;
      if (r.category_id) categories.add(String(r.category_id).toLowerCase());
      entries.push({ path: `/product/${key}`, lastmod: r.updated_at || undefined, changefreq: 'weekly', priority: 0.7 });
    }
    return { entries, categories };
  } catch (err) {
    logger.warn(`[Sitemap] product section omitted: ${err && err.message ? err.message : err}`);
    return { entries: [], categories };
  }
}

/** The curated catalogue's product pages (static data; never throws). */
function collectCuratedEntries() {
  let cards = [];
  try {
    cards = require('../../catalog/infrastructure/CatalogRepository')._curatedCards() || [];
  } catch (err) {
    logger.warn(`[Sitemap] curated section omitted: ${err && err.message ? err.message : err}`);
    return [];
  }
  return cards
    .filter((c) => c && c.title && PARAM_RE.test(String(c.id || '')))
    .slice(0, MAX_PRODUCTS)
    // No lastmod: the dataset carries no modification date, and a made-up one
    // is worse than none.
    .map((c) => ({ path: `/product/${c.id}`, changefreq: 'weekly', priority: 0.6 }));
}

/** Category pages with at least one product (curated, or a live listing's category_id). */
function collectCategoryEntries(dbCategories) {
  let dir = null;
  try { dir = require('./CategoryDirectory'); } catch (_) { return []; }
  return dir.list()
    .filter((c) => c.productCount > 0 || (dbCategories && dbCategories.has(c.id)))
    .map((c) => ({ path: dir.pathFor(c), changefreq: 'daily', priority: 0.8 }));
}

async function collectStoreEntries(db) {
  if (!db) return [];
  try {
    const { data, error } = await db
      .from('stores')
      .select('slug, updated_at, status, visibility')
      .eq('status', 'ACTIVE')
      .limit(MAX_STORES + 1);
    if (error) throw error;
    const rows = (data || []).filter((r) => r.slug && PARAM_RE.test(String(r.slug)) && (r.visibility == null || r.visibility === 'PUBLIC'));
    if (rows.length > MAX_STORES) {
      logger.warn(`[Sitemap] stores clipped at ${MAX_STORES}; add a sitemap index.`);
    }
    return rows.slice(0, MAX_STORES).map((r) => ({
      path: `/store/${r.slug}`,
      lastmod: r.updated_at || undefined,
      changefreq: 'weekly',
      priority: 0.7
    }));
  } catch (err) {
    logger.warn(`[Sitemap] store section omitted: ${err && err.message ? err.message : err}`);
    return [];
  }
}

/**
 * Build the complete sitemap XML string for `siteUrl`.
 * @param {object} args
 * @param {string} args.siteUrl absolute origin, e.g. https://loumoo.store
 */
async function buildSitemap({ siteUrl } = {}) {
  const db = tryDb();
  const [products, stores] = await Promise.all([
    collectProductEntries(db),
    collectStoreEntries(db)
  ]);
  // sitemapXml de-duplicates by <loc>, so a live listing that shares a curated id
  // is listed once (with its lastmod, since it comes first).
  const entries = [
    ...collectStaticRoutes(),
    ...collectCategoryEntries(products.categories),
    ...products.entries,
    ...collectCuratedEntries(),
    ...stores
  ];
  return SeoContent.sitemapXml({ siteUrl, entries });
}

module.exports = {
  buildSitemap,
  collectStaticRoutes,
  collectProductEntries,
  collectCuratedEntries,
  collectCategoryEntries,
  MAX_PRODUCTS,
  MAX_STORES
};
