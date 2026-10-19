/**
 * Source adapters — every source the comparison screen can hold, mapped to ONE
 * canonical shape the engine reads. Adapters copy facts and never fill gaps:
 * a missing rating stays null, a placeholder stock count is reported as unknown,
 * a store's product count is not a price.
 *
 * ComparableProduct {
 *   id, slug, title, brand, category, subcategory, entityType, source,
 *   price (XAF, payable), compareAtPrice, currency,
 *   rating, reviewCount, soldCount,
 *   inStock, stockUnits, stockKnown,
 *   seller { id, name, city, rating, verified },
 *   conditionLabel, fulfillmentLabel, image,
 *   attributes [{ key, val }]   free-text specs
 *   structured {}              nested numeric specs (seed dataset)
 *   dbAttributes {}            slug → typed value (listing_attribute_values)
 *   editorial { pros, cons, bestFor } | null
 * }
 */

const { payablePriceXaf, priceToNumber } = require('../CuratedCatalog');

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// A rating backed by zero reviews is not a rating.
function ratingOrNull(rating, reviewCount) {
  const r = num(rating);
  if (r === null || r <= 0) return null;
  if (reviewCount !== null && reviewCount !== undefined && Number(reviewCount) === 0) return null;
  return Math.min(5, r);
}

function editorialOf(p) {
  const v = p && p.verdictHighlights;
  if (!v) return null;
  return {
    pros: Array.isArray(v.pros) ? v.pros.slice() : [],
    cons: Array.isArray(v.cons) ? v.cons.slice() : [],
    bestFor: v.bestFor || null
  };
}

/** Curated storefront catalogue entry (data/catalog.json). */
function fromCurated(id, cp) {
  const reviewCount = num(cp.reviewCount);
  const price = payablePriceXaf(cp) || null;
  const listPrice = priceToNumber(cp.price);
  const salePrice = priceToNumber(cp.salePrice);
  const compareAt = Math.max(listPrice, salePrice);
  return {
    id: cp.id || id,
    slug: cp.id || id,
    title: cp.title,
    brand: cp.brand || null,
    category: cp.category || null,
    subcategory: cp.subcategory || null,
    entityType: 'product',
    source: 'curated',
    price,
    compareAtPrice: price && compareAt > price ? compareAt : null,
    currency: 'XAF',
    rating: ratingOrNull(cp.rating, reviewCount),
    reviewCount,
    soldCount: num(cp.soldCount),
    inStock: cp.inStock !== false,
    // The curated dataset writes 1000 for every product: a placeholder, not a count.
    stockUnits: null,
    stockKnown: false,
    seller: {
      id: cp.storeId || null,
      name: cp.storeName || null,
      city: cp.storeCity || null,
      rating: num(cp.storeRating),
      verified: Boolean(cp.storeVerified)
    },
    conditionLabel: cp.conditionLabel || null,
    fulfillmentLabel: cp.fulfillmentLabel || null,
    image: cp.coverImage || (Array.isArray(cp.images) && cp.images[0]) || null,
    attributes: Array.isArray(cp.attributes) ? cp.attributes.filter(a => a && a.key && a.val) : [],
    structured: null,
    dbAttributes: null,
    editorial: null
  };
}

/** Seed dataset entry (src/data/products.js). */
function fromSeed(p, vertical) {
  const reviewCount = num(p.reviewsCount);
  const original = priceToNumber(p.originalPrice);
  const price = num(p.priceNumeric);
  const entityType = vertical === 'hotels' ? 'hotel'
    : vertical === 'services' ? 'service'
      : vertical === 'education' ? 'education'
        : 'product';
  return {
    id: p.id,
    slug: p.slug || p.id,
    title: p.title,
    brand: p.brand || null,
    category: (p.category || vertical || '').toString().toLowerCase() || null,
    subcategory: p.subCategory || p.subcategory || null,
    entityType,
    source: 'seed',
    price,
    compareAtPrice: price && original > price ? original : null,
    currency: p.currency || 'XAF',
    rating: ratingOrNull(p.rating, reviewCount),
    reviewCount,
    soldCount: num(p.soldCount),
    inStock: p.inStock !== false,
    stockUnits: null,
    stockKnown: false,
    seller: {
      id: null,
      name: p.merchant || null,
      city: p.merchantCity || null,
      rating: null,
      verified: Boolean(p.verified)
    },
    conditionLabel: null,
    fulfillmentLabel: null,
    image: p.image || p.coverImage || null,
    attributes: [],
    structured: p.specs && typeof p.specs === 'object' ? p.specs : null,
    dbAttributes: null,
    editorial: editorialOf(p),
    sellers: Array.isArray(p.sellers) ? p.sellers : null
  };
}

/** Live marketplace listing (CatalogRepository.findPublicProductByIdOrSlug). */
function fromDatabase(d) {
  const reviewCount = num(d.reviewsCount);
  const price = num(d.priceNumeric);
  const sale = num(d.salePriceNumeric);
  const payable = price && sale ? Math.min(price, sale) : (price || sale || null);
  const store = d.store || null;
  return {
    id: d.id,
    slug: d.slug || d.id,
    title: d.title,
    brand: d.brand || null,
    category: d.category || null,
    subcategory: d.subcategory || d.subCategory || null,
    entityType: 'product',
    source: 'database',
    price: payable,
    compareAtPrice: payable && price && price > payable ? price : null,
    currency: d.currency || 'XAF',
    rating: ratingOrNull(d.rating, reviewCount),
    reviewCount,
    soldCount: num(d.soldCount),
    inStock: d.inStock !== false,
    // The repository card hard-codes 1000; the listing has no inventory count.
    stockUnits: null,
    stockKnown: false,
    seller: {
      id: (store && store.id) || d.storeId || null,
      name: (store && store.name) || d.merchant || null,
      city: (store && store.city) || d.merchantCity || null,
      rating: store && store.ratingCount ? num(store.rating) : null,
      verified: store ? Boolean(store.isVerified) : Boolean(d.verified)
    },
    conditionLabel: d.condition || null,
    fulfillmentLabel: null,
    image: d.image || d.coverImage || null,
    attributes: [],
    structured: null,
    dbAttributes: d.attributes && typeof d.attributes === 'object' && !Array.isArray(d.attributes) ? d.attributes : null,
    editorial: null
  };
}

/** Curated store card (a boutique, not a product). Its "price" is a product count. */
function fromStore(s) {
  return {
    id: s.id,
    slug: s.slug || s.id,
    title: s.title,
    brand: null,
    category: 'stores',
    subcategory: s.subCategory || null,
    entityType: 'store',
    source: 'store',
    price: null,
    compareAtPrice: null,
    currency: 'XAF',
    rating: ratingOrNull(s.rating, s.reviewsCount),
    reviewCount: num(s.reviewsCount),
    soldCount: null,
    inStock: null,
    stockUnits: null,
    stockKnown: false,
    seller: { id: s.id, name: s.title, city: s.merchantCity || null, rating: num(s.rating), verified: Boolean(s.verified) },
    conditionLabel: null,
    fulfillmentLabel: null,
    image: s.coverImage || null,
    attributes: [],
    structured: null,
    dbAttributes: null,
    editorial: null,
    displayPrice: s.price || null
  };
}

module.exports = { fromCurated, fromSeed, fromDatabase, fromStore };
