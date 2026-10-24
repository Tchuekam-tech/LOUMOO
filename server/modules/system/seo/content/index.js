'use strict';

/**
 * LOUMOO — the French content pages: lookup, live data, rendering.
 * ---------------------------------------------------------------------------
 *   const Content = require('./content');
 *   Content.pageForPath('/a-propos')            -> the page definition, or null
 *   Content.render('/a-propos', { siteUrl })    -> { html, page } | null
 *
 * Callers: the gateway (server/index.js, on request), the build
 * (scripts/assemble_public.js, one static file per page for the CDN), the sitemap
 * (the list of public paths) and the tests.
 *
 * The live data (category counts, featured products, the house store) comes from the
 * curated catalogue shipped with the app: static data, no database, so the build and a
 * database outage render exactly the same page and the page can never show a product
 * that has no page of its own.
 */

const FrontendRoutes = require('../../../../../src/routing/routes');
const seoModel = require('../../../../../src/seo/seoModel');
const { PAGES } = require('./pages');
const { renderContentPage } = require('./render');

const PARAM_RE = /^[A-Za-z0-9_-]{1,128}$/;
const NON_GOODS = new Set(['hospitality', 'hotels', 'travel', 'services']);

function listPages() {
  return PAGES.slice();
}

function pageForPath(pathname) {
  const p = FrontendRoutes.normalizePath(pathname);
  return PAGES.find((page) => page.path === p) || null;
}

function pageForRoute(routeId) {
  return PAGES.find((page) => page.routeId === routeId) || null;
}

function curatedCards() {
  try { return require('../../../catalog/infrastructure/CatalogRepository')._curatedCards() || []; } catch (_) { return []; }
}

// Which URL is THE page of a curated product (CuratedUrls); inert if that module cannot load.
function curatedUrls() {
  try { return require('../../../catalog/domain/CuratedUrls'); } catch (_) { return { resolve: () => null, canonicalPathFor: () => null }; }
}

/**
 * A catalogue title cut off at an elision ("... des Hauts Plateaux de l", "Huile d"): the
 * dataset has four. It is a crawlable, visible product name on a page about trust, so such a
 * product is not featured here (its own page is unaffected).
 */
function looksTruncated(title) {
  return /(?:^|\s)[a-zà-ÿ]$|['’]$/.test(String(title).trim());
}

/**
 * A deterministic, diverse selection of real product pages: one per category (largest
 * categories first), then a second round, each with an image and a payable price.
 */
function featuredProducts(cards, n) {
  const byCategory = new Map();
  for (const c of cards) {
    if (!c || !c.title || !PARAM_RE.test(String(c.id || '')) || !(c.image || (c.images && c.images[0]))) continue;
    // A repeated product is featured once, as its primary (the canonical page of the family).
    const entry = curatedUrls().resolve(c.id);
    if (entry && !entry.isPrimary) continue;
    if (looksTruncated(c.title)) continue;
    if (!seoModel.payablePrice(c)) continue;
    const key = String(c.category || 'other').toLowerCase();
    // Goods only: a stay, a ticket or a service has no product photo worth featuring, and
    // a promotional banner reused as a product image is a heavy download for a thumbnail.
    if (NON_GOODS.has(key) || /_processed|banner|poster/i.test(String(c.image || (c.images && c.images[0])))) continue;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(c);
  }
  const order = Array.from(byCategory.entries()).sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const out = [];
  for (let round = 0; out.length < n && round < 4; round++) {
    for (const [, list] of order) {
      if (out.length >= n) break;
      const c = list[round];
      if (c) out.push({ title: c.title, path: curatedUrls().canonicalPathFor(c.id) || `/product/${c.id}`, price: seoModel.payablePrice(c), currency: c.currency || 'XAF', image: c.image || c.images[0] });
    }
  }
  return out;
}

function collectData() {
  const cards = curatedCards();
  let categories = [];
  try {
    const dir = require('../CategoryDirectory');
    categories = dir.list()
      .filter((c) => c.productCount > 0)
      .map((c) => ({ id: c.id, name: c.name, path: dir.pathFor(c), count: c.productCount }))
      .sort((a, b) => b.count - a.count);
  } catch (_) { categories = []; }

  let store = null;
  try {
    const { HOUSE_STORE, HOUSE_AGENCY } = require('../../../store/domain/HouseStore');
    const mine = cards.filter((c) => c.storeId === HOUSE_STORE.id);
    if (mine.length) {
      // No city: merchantCity is a per-product field (the store's 972 products carry eleven
      // different values), not an attribute of the store, so it can't be stated as its location.
      store = { name: HOUSE_STORE.name, path: `/store/${HOUSE_STORE.slug}`, count: mine.length, agency: HOUSE_AGENCY.name };
    }
  } catch (_) { store = null; }

  return { categories, store, products: featuredProducts(cards, 8) };
}

/**
 * Render the content page at `pathname`, or null when there is none.
 * @param {string} pathname
 * @param {{siteUrl?:string, data?:object}} [opts]  `data` lets a caller render many pages with one collection
 */
function render(pathname, opts) {
  const page = pageForPath(pathname);
  if (!page) return null;
  const o = opts || {};
  const siteUrl = o.siteUrl || FrontendRoutes.ORIGIN;
  const html = renderContentPage(page, {
    siteUrl,
    data: o.data || collectData(),
    resolved: FrontendRoutes.resolve(page.path),
    pages: PAGES
  });
  return { html, page };
}

module.exports = { listPages, pageForPath, pageForRoute, collectData, featuredProducts, render };
