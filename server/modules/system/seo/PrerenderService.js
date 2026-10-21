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

async function hydrate(resolved) {
  const route = resolved.route;
  const params = resolved.params || {};
  if (!route) return { entity: null, status: 404 };

  if (route.id === 'product' && params.id) {
    const repo = catalogRepo();
    if (!repo) return { entity: null, status: 200 };
    try {
      const product = await repo.findIndexableProductByIdOrSlug(params.id);
      return product ? { entity: product, status: 200 } : { entity: null, status: 404 };
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
        status: 200
      };
    } catch (err) {
      warn(`[Prerender] store hydrate degraded (serving route-level shell): ${err && err.message ? err.message : err}`);
      return { entity: null, status: 200 };
    }
  }

  return { entity: null, status: 200 };
}

/**
 * Semantic, crawler-visible fallback content (hidden once the SPA mounts).
 * Links and images are ABSOLUTE (siteUrl) so a crawler following them lands on
 * the canonical host, and so they are never mistaken for in-page asset refs.
 */
function contentBlock(descriptor, resolved, entity, status, siteUrl) {
  const abs = (p) => esc(seoModel.absUrl(siteUrl || seoModel.DEFAULT_SITE_URL, p));
  const screen = resolved.route && resolved.route.screen;
  const parts = ['<h1>' + esc(descriptor.title) + '</h1>', '<p>' + esc(descriptor.description) + '</p>'];

  if (entity && screen === 'product') {
    const img = entity.image || entity.coverImage || (entity.images && entity.images[0]);
    if (img) parts.push('<img src="' + abs(img) + '" alt="' + esc(entity.title) + '" width="480" height="480" loading="lazy">');
    const price = entity.salePrice || entity.price;
    if (price) parts.push('<p data-price>' + esc(price) + '</p>');
    if (entity.store && entity.store.name) parts.push('<p>Sold by ' + esc(entity.store.name) + '</p>');
  } else if (entity && screen === 'business') {
    if (entity.logoUrl) parts.push('<img src="' + abs(entity.logoUrl) + '" alt="' + esc(entity.name) + '" width="128" height="128" loading="lazy">');
  }

  if (status === 404) parts.push('<p>This page could not be found. Explore LOUMOO instead.</p>');
  parts.push('<nav><a href="' + abs('/') + '">LOUMOO</a> &middot; <a href="' + abs('/stores') + '">Stores</a> &middot; <a href="' + abs('/travel') + '">Travel</a> &middot; <a href="' + abs('/hotels') + '">Hotels</a></nav>');

  return '<div id="loumoo-prerender" data-loumoo-prerender aria-hidden="false">\n' + parts.join('\n') + '\n</div>';
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
 * @returns {Promise<{html:string, status:number, cacheable:boolean, descriptor:object}>}
 */
async function renderPage({ url, shellHtml, siteUrl }) {
  const pathname = pathnameOf(url);
  let resolved;
  try { resolved = FrontendRoutes.resolve(pathname); } catch (_) { resolved = { type: 'notfound' }; }

  let status = 200;
  let entity = null;
  if (resolved.type !== 'route') {
    status = 404; // notfound / unavailable / file — all non-200 page states
  } else {
    const h = await hydrate(resolved);
    entity = h.entity;
    status = h.status;
  }

  const descriptor = seoModel.describe(resolved, { siteUrl, path: pathname, entity });
  if (status !== 200) descriptor.robots = 'noindex,follow';

  const headHtml = seoModel.serialize(seoModel.headTags(descriptor));
  const contentHtml = contentBlock(descriptor, resolved, entity, status, siteUrl);
  const html = inject(String(shellHtml), headHtml, contentHtml);

  return { html, status, cacheable: status === 200 && descriptor.indexable, descriptor };
}

module.exports = { renderPage, inject, contentBlock, pathnameOf };
