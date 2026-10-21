'use strict';

/**
 * LOUMOO — the public category directory (which /marketplace/category/:category
 * pages exist, and what each is called).
 * ---------------------------------------------------------------------------
 * The category screen accepts any slug, so without a directory every
 * /marketplace/category/<anything> answered 200 index,follow: an unbounded set of
 * soft-404 pages. This module is the one answer, shared by the prerender (200 with
 * the category's own title, or a real 404) and the sitemap (which categories to
 * list). Sources, both static and shipped with the app (no database):
 *
 *   1. the taxonomy dataset (src/data/categories.js): id, name, description;
 *   2. the curated catalogue's own product categories (a category with products
 *      is a page buyers reach even when the taxonomy does not describe it).
 *
 * The canonical slug is the taxonomy `id` (what the shell's category screen keys
 * on, e.g. `real_estate`); its URL-style alias (`real-estate`) resolves to it.
 * Never throws: a missing dataset yields an empty directory.
 */

const SLUG_RE = /^[a-z0-9_-]{1,64}$/;

let cache = null;

function titleCase(slug) {
  return String(slug).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function build() {
  const byId = new Map();
  const aliases = new Map();

  let taxonomy = [];
  let curatedCards = [];
  try { taxonomy = require('../../catalog/dataLoader').categories || []; } catch (_) { taxonomy = []; }
  try { curatedCards = require('../../catalog/infrastructure/CatalogRepository')._curatedCards() || []; } catch (_) { curatedCards = []; }

  for (const c of taxonomy) {
    const id = c && String(c.id || '').toLowerCase();
    if (!id || id === 'all' || !SLUG_RE.test(id)) continue;
    byId.set(id, { id, name: c.name || titleCase(id), description: c.description || '', productCount: 0 });
    const slug = String(c.slug || '').toLowerCase();
    if (slug && slug !== id && SLUG_RE.test(slug)) aliases.set(slug, id);
  }

  for (const card of curatedCards) {
    const id = card && String(card.category || '').toLowerCase();
    if (!id || id === 'all' || id === 'general' || !SLUG_RE.test(id)) continue;
    const key = aliases.get(id) || id;
    if (!byId.has(key)) {
      byId.set(key, { id: key, name: card.categoryLabel || titleCase(key), description: '', productCount: 0 });
    }
    byId.get(key).productCount += 1;
  }

  return { byId, aliases };
}

function directory() {
  if (!cache) cache = build();
  return cache;
}

/** The category for `slug` (its id or URL alias), or null when it is not a page. */
function find(slug) {
  const s = String(slug == null ? '' : slug).toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  const { byId, aliases } = directory();
  return byId.get(s) || byId.get(aliases.get(s)) || null;
}

/** Every known category, taxonomy order first. */
function list() {
  return Array.from(directory().byId.values());
}

/** The canonical path of a category page. */
function pathFor(category) {
  return `/marketplace/category/${encodeURIComponent(category.id)}`;
}

/** Test seam: forget the cached directory. */
function _reset() { cache = null; }

module.exports = { find, list, pathFor, _reset };
