/**
 * LOUMOO Catalog Domain — The curated storefront catalogue, looked up exactly
 * ---------------------------------------------------------------------------
 * src/data/catalog_products.js is a static dataset shipped with the app. Every
 * item in it now belongs to the house store (see store/domain/HouseStore.js), so
 * the order path needs two answers about it and nothing else:
 *
 *   1. "Is this id a product of the dataset?"  An EXACT key, own property only.
 *      Never a slug, never a partial id, never a fuzzy match. The catalogue
 *      browsing code (CatalogRepository._curatedDetail) also matches exactly now,
 *      but it accepts a slug and answers with a presentation card, so the order
 *      path still does not go through it.
 *   2. "What does the buyer pay?"  In the dataset `price` is what the buyer pays
 *      and `salePrice` is the compare-at (was) price, but the data has been
 *      edited by hand more than once, so the rule is the one the storefront
 *      itself applies (_payablePriceLabel in build_redesign.py): when both are
 *      present the LOWER one is payable. A product with no positive price at all
 *      has no payable price and is not orderable.
 */
'use strict';

/** "XAF 187.200", "1 035 000 FCFA", 187200 -> 187200. Digits only, like the catalogue cards. */
function priceToNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : 0;
  const digits = String(value == null ? '' : value).replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function defaultCatalog() {
  try {
    return require('../dataLoader').catalogProducts || {};
  } catch (_) {
    return {};
  }
}

/**
 * The dataset entry whose KEY is exactly `id`, or null. `hasOwnProperty` keeps
 * ids such as "constructor" or "__proto__" from resolving to something that is
 * not a product.
 * @param {string} id
 * @param {object} [catalog] Injectable for tests; defaults to the loaded dataset.
 */
function findCuratedProduct(id, catalog) {
  if (typeof id !== 'string' || !id) return null;
  const source = catalog || defaultCatalog();
  if (!source || typeof source !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(source, id)) return null;
  const product = source[id];
  if (!product || typeof product !== 'object' || !product.title) return null;
  return product;
}

/** The price in whole XAF the buyer pays for a dataset product, or 0 when it has none. */
function payablePriceXaf(product) {
  if (!product) return 0;
  const price = priceToNumber(product.price);
  const compareAt = priceToNumber(product.salePrice);
  if (price > 0 && compareAt > 0) return Math.min(price, compareAt);
  return price > 0 ? price : compareAt;
}

module.exports = { findCuratedProduct, payablePriceXaf, priceToNumber };
