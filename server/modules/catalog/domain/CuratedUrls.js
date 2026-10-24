/**
 * LOUMOO Catalog Domain — the URL identity of the curated catalogue
 * ---------------------------------------------------------------------------
 * The seed catalogue holds 972 products but only about 160 different ones: the generators
 * repeated each product under a new id, a new photo and a "(#11)" in its title. This is the
 * one place that says, for any key a visitor may arrive with, which product it is and which URL
 * is THE URL of that product:
 *
 *   id    the immutable key (orders, carts, reviews and stock are filed under it). It was the
 *         URL until the slug existed; those URLs are legacy and the server redirects them.
 *   slug  the public key, ProductSlug.productSlug(title, id).
 *   family  the products that are the same product: the same title and brand once the
 *         generator's counter is removed. Their pages are near-identical, so ONE of them is
 *         the canonical page of all of them.
 *   primary  the member whose page that is: the one with the shortest id, then the first
 *         alphabetically. It does not depend on the order of the dataset, so a rebuild or a
 *         re-sort cannot move it. (With the legacy ids that is the unsuffixed one, the URL the
 *         search engines already know as the original.)
 *
 * What the server does with it (PrerenderService, SitemapService):
 *   /product/<legacy id>            301 to /product/<primary slug>
 *   /product/<slug of the primary>  200, canonical is itself
 *   /product/<slug of another>      200, canonical is the primary's: both stay openable (a visitor
 *                                   in the app may be looking at that one), only one competes
 *   sitemap                         the primaries, and nothing else
 *
 * Pure data in, data out: no database, nothing to fail. A slug is never allowed to collide: a
 * product whose slug is already taken (it cannot happen for the seed catalogue, which the tests
 * prove) falls back to its own id, which is unique by construction.
 */
'use strict';

const { productSlug, isProductSlug, toWords, stripCounterMarker } = require('./ProductSlug');

const PRODUCT_PATH = '/product/';

function warn(message) {
  try { require('../../../shared/logging/logger').warn(message); } catch (_) { /* no logger in this context */ }
}

function normalised(text) {
  return toWords(stripCounterMarker(text)).join(' ');
}

/** What makes two curated products "the same product": the title without its counter, and the brand. */
function familyKey(product) {
  return `${normalised(product && product.title)}|${normalised(product && product.brand)}`;
}

/** Shortest id first, then alphabetical: independent of the order the dataset lists them in. */
function comparePrimary(a, b) {
  return a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Index a catalogue (the `{ id: product }` map of src/data/catalog_products.js).
 * @returns {{ size:number, entries:object[], families:number,
 *             resolve:(key:string)=>object|null, canonicalPath:(key:string)=>string|null, primaries:()=>object[] }}
 *   an entry is { id, slug, family, primaryId, primarySlug, isPrimary }
 */
function build(catalog) {
  const entries = [];
  const byId = new Map();
  const bySlug = new Map();
  const families = new Map();

  const ids = Object.keys(catalog || {}).filter((id) => {
    const product = catalog[id];
    return product && typeof product === 'object' && product.title;
  });
  ids.forEach((id) => byId.set(id, null));

  for (const id of ids) {
    const product = catalog[id];
    let slug = isProductSlug(product.slug) ? product.slug : productSlug(product.title, id);
    if (bySlug.has(slug) || (byId.has(slug) && slug !== id)) {
      warn(`[CuratedUrls] "${id}" would share /product/${slug} with another product; it keeps its id as its slug.`);
      slug = id;
    }
    const entry = { id, slug, family: familyKey(product), primaryId: id, primarySlug: slug, isPrimary: true };
    entries.push(entry);
    byId.set(id, entry);
    bySlug.set(slug, entry);
    if (!families.has(entry.family)) families.set(entry.family, []);
    families.get(entry.family).push(entry);
  }

  for (const members of families.values()) {
    const primary = members.slice().sort(comparePrimary)[0];
    for (const entry of members) {
      entry.primaryId = primary.id;
      entry.primarySlug = primary.slug;
      entry.isPrimary = entry === primary;
    }
  }

  /** The entry for an id (checked first: it is the immutable key) or a slug; null for anything else. */
  function resolve(key) {
    const k = typeof key === 'string' ? key : '';
    return byId.get(k) || bySlug.get(k) || null;
  }

  function canonicalPath(key) {
    const entry = resolve(key);
    return entry ? `${PRODUCT_PATH}${entry.primarySlug}` : null;
  }

  return Object.freeze({
    size: entries.length,
    entries,
    families: families.size,
    resolve,
    canonicalPath,
    primaries: () => entries.filter((entry) => entry.isPrimary)
  });
}

// The index of the dataset the server loaded, built once and rebuilt only if that object is replaced.
let cached = { source: null, index: null };

function defaultIndex() {
  let source = {};
  try { source = require('../dataLoader').catalogProducts || {}; } catch (_) { source = {}; }
  if (cached.source !== source) cached = { source, index: build(source) };
  return cached.index;
}

/** The entry for an id or slug of the loaded catalogue, or null. */
function resolve(key) {
  return defaultIndex().resolve(key);
}

/** '/product/<primary slug>' for any id or slug of the loaded catalogue, or null. */
function canonicalPathFor(key) {
  return defaultIndex().canonicalPath(key);
}

module.exports = { build, defaultIndex, resolve, canonicalPathFor, familyKey, PRODUCT_PATH };
