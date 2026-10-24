'use strict';

/**
 * LOUMOO — on-the-fly prerender (SSR of the document head + a crawlable content
 * block into the single-document SPA shell).
 * ---------------------------------------------------------------------------
 * For every page request the gateway serves, this:
 *   1. resolves the URL against the route registry,
 *   2. hydrates the entity for product/store pages (so the head and content are
 *      about the real item, and an unknown id/slug is a real 404 — not a 200
 *      soft-404),
 *   3. writes the per-route <title> + description + canonical + robots +
 *      OpenGraph + Twitter + JSON-LD into <head> (shared model: src/seo/seoModel.js),
 *   4. injects a small, semantic content block into <body> so a crawler or a
 *      link-preview bot that does not run the SPA still sees real content.
 *
 * The block is hidden by CSS the moment the SPA mounts (#dc-root), so a human
 * sees the real app, not the fallback.
 *
 * Resilience: a database error degrades to a route-level 200 shell (never a
 * false 404); only a reachable-DB "no such row" is a 404. Rendering never throws.
 */

const seoModel = require('../../../../src/seo/seoModel');
const FrontendRoutes = require('../../../../src/routing/routes');
const SITE_NAV = require('../../../../src/seo/siteNav.json');

// Lazy logger: keep module load dependency-free (no config/logger graph) so the
// build script (scripts/assemble_public.js) can require this module's pure
// inject()/contentBlock() helpers cheaply to prerender the home page.
function warn(msg) {
  try { require('../../../shared/logging/logger').warn(msg); } catch (_) { /* no logger in this context */ }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pathnameOf(url) {
  const u = String(url || '/');
  const q = u.indexOf('?');
  let p = q === -1 ? u : u.slice(0, q);
  const h = p.indexOf('#');
  if (h !== -1) p = p.slice(0, h);
  return p || '/';
}

/** Lazy requires so a missing optional module never breaks the gateway boot. */
function catalogRepo() {
  try { return require('../../catalog/infrastructure/CatalogRepository'); } catch (_) { return null; }
}
function storeRepo() {
  try { return require('../../store/infrastructure/StoreRepository'); } catch (_) { return null; }
}

function categoryDirectory() {
  try { return require('./CategoryDirectory'); } catch (_) { return null; }
}

function curatedUrls() {
  try { return require('../../catalog/domain/CuratedUrls'); } catch (_) { return null; }
}

// A product link is only worth emitting when the router will accept it.
const PRODUCT_PARAM_RE = /^[A-Za-z0-9_-]{1,128}$/;
const LISTING_LINKS = 24;
// The curated catalogue repeats each product, so a page's first cards are often the same product
// several times over; read further than LISTING_LINKS and keep the distinct ones.
const LISTING_SCAN = LISTING_LINKS * 4;

/**
 * The URL a product is indexed at. A curated product has ONE canonical page per family of repeats
 * (CuratedUrls), so any member links to, and canonicalises to, the primary's slug. A live listing's
 * is its own slug (or id).
 */
function productPath(p) {
  if (p && p.curated) {
    const urls = curatedUrls();
    const canonical = urls && urls.canonicalPathFor(p.id);
    if (canonical) return canonical;
  }
  const key = String((p && (p.slug || p.id)) || '');
  return PRODUCT_PARAM_RE.test(key) ? `/product/${key}` : null;
}

/** Up to LISTING_LINKS distinct public products for a listing page; [] on any failure. */
async function listingItems(filters) {
  const repo = catalogRepo();
  if (!repo || typeof repo.listPublishedListings !== 'function') return [];
  try {
    const res = await repo.listPublishedListings(Object.assign({ page: 1, limit: LISTING_SCAN }, filters));
    const seen = new Set();
    return ((res && res.items) || [])
      .map((p) => ({ title: p.title, path: productPath(p), price: seoModel.payablePrice(p), currency: p.currency || 'XAF' }))
      .filter((it) => it.title && it.path && !seen.has(it.path) && seen.add(it.path))
      .slice(0, LISTING_LINKS);
  } catch (err) {
    warn(`[Prerender] listing links omitted: ${err && err.message ? err.message : err}`);
    return [];
  }
}

/** Category pages worth linking to (they have products), as {name, path}. */
function categoryLinks() {
  const dir = categoryDirectory();
  if (!dir) return [];
  return dir.list().filter((c) => c.productCount > 0).map((c) => ({ name: c.name, path: dir.pathFor(c) }));
}

/**
 * Resolve what the server knows about the page: the entity (product/store), the
 * HTTP status, the canonical path (one URL per entity: a product or store reached
 * by its id canonicalises to its slug, the URL the sitemap lists), the
 * title/description of a listing page's subject, breadcrumbs, and crawlable links.
 * `indexable: false` marks a page that may render but must not be indexed.
 */
async function hydrate(resolved) {
  const route = resolved.route;
  const params = resolved.params || {};
  if (!route) return { entity: null, status: 404 };

  if (route.id === 'product' && params.id) {
    const repo = catalogRepo();
    if (!repo) return { entity: null, status: 200 };
    try {
      const product = await repo.findIndexableProductByIdOrSlug(params.id);
      if (!product) {
        // Not a live listing or curated product. It may be the OLD slug of a listing that was
        // re-slugged or de-duplicated (iam.listing_redirects) — 301 to the survivor's current slug.
        // Best-effort: a missing table (pre-migration) or a dead target yields null → a normal 404.
        const redirect = typeof repo.findListingRedirect === 'function' ? await repo.findListingRedirect(params.id) : null;
        if (redirect && redirect.targetSlug && redirect.targetSlug !== params.id) {
          return { entity: null, status: 200, redirectTo: `/product/${redirect.targetSlug}` };
        }
        return { entity: null, status: 404 };
      }
      const canonicalPath = productPath(product) || undefined;
      // A curated product reached by its immutable id (the URL the catalogue had before it had slugs,
      // and the one a repeated product used to carry as "_2" ... "_26") is an alias: it resolves BY ID,
      // so it is a permanent redirect to the family's primary slug, not a second page that competes
      // with it. Reached by a slug it is the product's real URL: it answers 200, and a member that is
      // not the primary names the primary as its canonical.
      const redirectTo = product.curated && canonicalPath && params.id === product.id && canonicalPath !== `/product/${params.id}`
        ? canonicalPath : undefined;
      const dir = categoryDirectory();
      const category = dir && dir.find(product.category);
      const breadcrumbs = [{ name: 'Accueil', path: '/' }];
      if (category) breadcrumbs.push({ name: category.name, path: dir.pathFor(category) });
      breadcrumbs.push({ name: product.title, path: canonicalPath || `/product/${params.id}` });
      return { entity: product, status: 200, canonicalPath, breadcrumbs, redirectTo };
    } catch (err) {
      warn(`[Prerender] product hydrate degraded (serving route-level shell): ${err && err.message ? err.message : err}`);
      return { entity: null, status: 200 };
    }
  }

  if (route.id === 'storefront' && params.slug) {
    const repo = storeRepo();
    if (!repo) return { entity: null, status: 200 };
    try {
      const s = await repo.findByIdOrSlug(params.slug);
      const live = s && s.status === 'ACTIVE' && (s.visibility == null || s.visibility === 'PUBLIC');
      if (!live) return { entity: null, status: 404 };
      return {
        entity: {
          name: s.name,
          title: s.name,
          slug: s.slug,
          description: s.description,
          logoUrl: s.logo_url,
          isVerified: s.is_verified,
          rating: s.rating,
          reviewsCount: s.rating_count
        },
        status: 200,
        canonicalPath: s.slug && PRODUCT_PARAM_RE.test(s.slug) ? `/store/${s.slug}` : undefined,
        breadcrumbs: [{ name: 'Accueil', path: '/' }, { name: 'Boutiques', path: '/stores' }, { name: s.name, path: `/store/${s.slug}` }],
        items: s.id ? await listingItems({ storeId: s.id }) : []
      };
    } catch (err) {
      warn(`[Prerender] store hydrate degraded (serving route-level shell): ${err && err.message ? err.message : err}`);
      return { entity: null, status: 200 };
    }
  }

  if (route.id === 'category') {
    const dir = categoryDirectory();
    const category = dir && dir.find(params.category);
    if (!category) return { entity: null, status: dir ? 404 : 200, indexable: dir ? undefined : false };
    const items = await listingItems({ category: category.id });
    return {
      entity: null,
      status: 200,
      canonicalPath: dir.pathFor(category),
      page: {
        title: category.name,
        description: category.description ||
          `Découvrez ${category.name} auprès des boutiques LOUMOO, avec paiement à la livraison au Cameroun.`
      },
      breadcrumbs: [{ name: 'Accueil', path: '/' }, { name: 'Catégories', path: '/marketplace/categories' }, { name: category.name, path: dir.pathFor(category) }],
      items,
      // An empty category is a thin page: reachable, but not one to index.
      indexable: items.length > 0 ? undefined : false
    };
  }

  if (route.id === 'marketplace') {
    return { entity: null, status: 200, items: await listingItems({}), categories: categoryLinks() };
  }
  if (route.id === 'categories') {
    return { entity: null, status: 200, categories: categoryLinks() };
  }
  if (route.id === 'home') {
    return { entity: null, status: 200, categories: categoryLinks(), home: true };
  }

  // Any other parameterised route (a hotel, an announcement…) is not looked up
  // here, so the server cannot tell a real record from a made-up id: render it,
  // but never offer an unverifiable URL to the index.
  if (route.path && route.path.indexOf(':') !== -1) return { entity: null, status: 200, indexable: false };

  return { entity: null, status: 200 };
}

// Delegates to the shared money formatter (src/shared/money.js); identical output, one definition.
function formatPrice(amount, currency) {
  return require('../../../../src/shared/money').formatMoney(amount, currency);
}

/**
 * Semantic, crawler-visible fallback content (hidden once the SPA mounts).
 * Links and images are ABSOLUTE (siteUrl) so a crawler following them lands on
 * the canonical host, and so they are never mistaken for in-page asset refs.
 * `extras.items` (products) and `extras.categories` are the page's own listings,
 * so a crawler that does not run the SPA can still discover them.
 */
function contentBlock(descriptor, resolved, entity, status, siteUrl, extras) {
  const abs = (p) => esc(seoModel.absUrl(siteUrl || seoModel.DEFAULT_SITE_URL, p));
  const asset = (p) => esc(seoModel.assetUrl(siteUrl || seoModel.DEFAULT_SITE_URL, p));
  const screen = resolved.route && resolved.route.screen;
  const x = extras || {};
  const link = (l) => '<a href="' + abs(l.path) + '">' + esc(l.label) + '</a>';
  const parts = ['<h1>' + esc(descriptor.heading || descriptor.title) + '</h1>', '<p>' + esc(descriptor.description) + '</p>'];

  if (entity && screen === 'product') {
    const img = entity.image || entity.coverImage || (entity.images && entity.images[0]);
    if (img) parts.push('<img src="' + asset(img) + '" alt="' + esc(entity.title) + '" width="480" height="480" loading="lazy">');
    // The price the buyer pays (the same one the JSON-LD offer states).
    const price = formatPrice(seoModel.payablePrice(entity), entity.currency);
    if (price) parts.push('<p data-price>' + esc(price) + '</p>');
    if (entity.store && entity.store.name) parts.push('<p>Vendu par ' + esc(entity.store.name) + '</p>');
  } else if (entity && screen === 'business') {
    if (entity.logoUrl) parts.push('<img src="' + asset(entity.logoUrl) + '" alt="' + esc(entity.name) + '" width="128" height="128" loading="lazy">');
  }

  if (x.home && status === 200) {
    parts.push('<h2>Acheter, vendre et voyager avec un seul compte</h2>\n<ul>\n' + [
      '<li>Explorez les <a href="' + abs('/marketplace') + '">produits</a> et les <a href="' + abs('/marketplace/categories') + '">catégories</a> des boutiques LOUMOO, comparez, puis commandez avec paiement à la livraison.</li>',
      '<li>Ouvrez votre boutique en ligne pour publier produits et services et suivre vos commandes : le <a href="' + abs('/vendre-en-ligne-cameroun') + '">guide du vendeur</a> détaille les étapes.</li>',
      '<li>Recherchez un <a href="' + abs('/hotels') + '">hôtel</a> ou consultez les offres de <a href="' + abs('/travel') + '">voyage</a>.</li>'
    ].join('\n') + '\n</ul>');
  }

  if (status === 200 && x.items && x.items.length) {
    parts.push('<h2>Produits</h2>\n<ul>\n' + x.items.map((it) => {
      const price = formatPrice(it.price, it.currency);
      return '<li><a href="' + abs(it.path) + '">' + esc(it.title) + '</a>' + (price ? ' &middot; ' + esc(price) : '') + '</li>';
    }).join('\n') + '\n</ul>');
  }
  if (status === 200 && x.categories && x.categories.length) {
    parts.push('<h2>Catégories</h2>\n<ul>\n' + x.categories.map((c) =>
      '<li><a href="' + abs(c.path) + '">' + esc(c.name) + '</a></li>').join('\n') + '\n</ul>');
  }

  parts.push('<nav aria-label="Navigation principale">' + SITE_NAV.primary.map(link).join(' &middot; ') + '</nav>');
  parts.push('<nav aria-label="Guides">' + SITE_NAV.guides.map(link).join(' &middot; ') + '</nav>');

  // data-path: the URL this head and content were rendered FOR. The browser router
  // keeps the server head on first load only when it is still on this path.
  const pathAttr = x.path ? ' data-path="' + esc(x.path) + '"' : '';
  return '<div id="loumoo-prerender" data-loumoo-prerender' + pathAttr + ' aria-hidden="false">\n' + parts.join('\n') + '\n</div>';
}

/** Write the head block + content block into the shell (first match of each anchor). */
function inject(shellHtml, headHtml, contentHtml) {
  let html = String(shellHtml);
  // Idempotent: strip any previous prerender injection first, so re-rendering a
  // shell that already carries one (a build-time-baked index.html) can never
  // double-inject. (The content block has no nested <div>, so the non-greedy
  // match stops at its own </div>.)
  html = html.replace(/<!-- loumoo:seo:start -->[\s\S]*?<!-- loumoo:seo:end -->\n?/gi, '');
  html = html.replace(/\n?<div id="loumoo-prerender"[\s\S]*?<\/div>/gi, '');
  // Drop the static <title> so there is exactly one, from the head block.
  html = html.replace(/<title>[\s\S]*?<\/title>/i, '');
  const headBlock = '<!-- loumoo:seo:start -->\n' + headHtml + '\n<!-- loumoo:seo:end -->\n';
  if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, headBlock + '</head>');
  else html = headBlock + html;
  if (contentHtml) html = html.replace(/(<body[^>]*>)/i, '$1\n' + contentHtml);
  return html;
}

/**
 * @param {{url:string, shellHtml:string|Buffer, siteUrl:string}} args
 * @returns {Promise<{html:string, status:number, cacheable:boolean, descriptor:object, redirect?:{status:number,to:string}}>}
 *   `redirect` is set (status 301, html '') when the URL is a legacy alias of another page.
 */
async function renderPage({ url, shellHtml, siteUrl }) {
  const pathname = pathnameOf(url);
  let resolved;
  try { resolved = FrontendRoutes.resolve(pathname); } catch (_) { resolved = { type: 'notfound' }; }

  let status = 200;
  let h = { entity: null };
  if (resolved.type !== 'route') {
    status = 404; // notfound / unavailable / file — all non-200 page states
  } else {
    h = await hydrate(resolved);
    status = h.status;
  }
  // A permanent redirect has no document: the gateway answers with the Location (server/index.js).
  if (h.redirectTo) {
    return { redirect: { status: 301, to: h.redirectTo }, status: 301, html: '', cacheable: true, descriptor: { indexable: false } };
  }
  const entity = h.entity || null;

  const descriptor = seoModel.describe(resolved, {
    siteUrl,
    path: h.canonicalPath || pathname,
    entity,
    page: h.page,
    breadcrumbs: h.breadcrumbs
  });
  if (status !== 200 || h.indexable === false) {
    descriptor.robots = 'noindex,follow';
    descriptor.indexable = false;
  }

  if (status === 404) {
    // An error page says so in the search result and the tab, whatever route it came from.
    descriptor.title = seoModel.formatTitle('Page introuvable');
    descriptor.heading = 'Page introuvable';
    descriptor.description = 'Cette page n’existe pas ou n’est plus disponible. Retrouvez les produits, boutiques et services de LOUMOO.';
  }

  const headHtml = seoModel.serialize(seoModel.headTags(descriptor));
  const contentHtml = contentBlock(descriptor, resolved, entity, status, siteUrl, { items: h.items, categories: h.categories, path: pathname, home: h.home });
  const html = inject(String(shellHtml), headHtml, contentHtml);

  return { html, status, cacheable: status === 200 && descriptor.indexable, descriptor };
}

module.exports = { renderPage, inject, contentBlock, pathnameOf, categoryLinks, formatPrice };
