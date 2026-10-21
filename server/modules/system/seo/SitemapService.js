'use strict';

/**
 * LOUMOO — Dynamic sitemap data gathering.
 * ---------------------------------------------------------------------------
 * Composes the full /sitemap.xml from three sources:
 *   1. Static public routes, derived from the single route registry
 *      (src/routing/routes.js) so the sitemap can never list a private,
 *      auth-only, redirect-only or not-yet-built page.
 *   2. Published, public product detail pages (iam.listings).
 *   3. Active public store pages (iam.stores).
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

async function collectProductEntries(db) {
  if (!db) return [];
  try {
    const { data, error } = await db
      .from('listings')
      .select('id, slug, updated_at, stores!inner(status)')
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
    return rows.slice(0, MAX_PRODUCTS).map((r) => ({
      path: `/product/${encodeURIComponent(r.slug || r.id)}`,
      lastmod: r.updated_at || undefined,
      changefreq: 'weekly',
      priority: 0.7
    }));
  } catch (err) {
    logger.warn(`[Sitemap] product section omitted: ${err && err.message ? err.message : err}`);
    return [];
  }
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
    const rows = (data || []).filter((r) => r.slug && (r.visibility == null || r.visibility === 'PUBLIC'));
    if (rows.length > MAX_STORES) {
      logger.warn(`[Sitemap] stores clipped at ${MAX_STORES}; add a sitemap index.`);
    }
    return rows.slice(0, MAX_STORES).map((r) => ({
      path: `/store/${encodeURIComponent(r.slug)}`,
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
  const entries = [...collectStaticRoutes(), ...products, ...stores];
  return SeoContent.sitemapXml({ siteUrl, entries });
}

module.exports = { buildSitemap, collectStaticRoutes, MAX_PRODUCTS, MAX_STORES };
