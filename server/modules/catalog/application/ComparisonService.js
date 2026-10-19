/**
 * Catalog Comparison Service
 * ---------------------------------------------------------------------------
 * Resolves the ids a buyer put side by side (curated catalogue, seed dataset,
 * curated stores, live marketplace listings), adapts them to the engine's one
 * canonical shape and runs Comparison Engine v2 against market statistics built
 * once over the whole catalogue.
 *
 * Nothing here invents commerce facts: stock is what the listing says (and is
 * marked unknown where the source only has a placeholder), sellers are the
 * real offers, and ids that could not be resolved are returned, not dropped.
 */

const { products: rawProducts, catalogProducts = {} } = require('../dataLoader');
const { compare, MAX_PRODUCTS } = require('../domain/comparison/ComparisonEngineV2');
const { CategoryStats } = require('../domain/comparison/categoryStats');
const { fromCurated, fromSeed, fromDatabase, fromStore } = require('../domain/comparison/productAdapter');
const { classify } = require('../domain/comparison/productTypes');
const { identityKey } = require('../domain/comparison/productIdentity');
const { qualityIndex } = require('../domain/comparison/scoring');
const { profileFor } = require('../domain/comparison/categoryProfiles');
const { extract } = require('../domain/comparison/specExtractor');
const { NotFoundError, ValidationError } = require('../../../shared/errors/AppError');
const CatalogRepository = require('../infrastructure/CatalogRepository');
const logger = require('../../../shared/logging/logger');

const MAX_CANDIDATES = 50;

// Curated verified stores, kept so the compare screen's store-vs-store preset
// still resolves. They are boutiques, not products: the engine shows them side
// by side and never ranks them against products.
const CURATED_STORES = [
  {
    id: 'store_orca_electronics',
    slug: 'orca-electronics',
    title: 'Orca Electronics',
    subCategory: 'Consumer Electronics & Computing',
    price: '1,420+ Products',
    rating: 4.9,
    reviewsCount: 384,
    merchantCity: 'Douala',
    verified: true,
    coverImage: './Assets/telephone&PC/phoneBrands.image/139611657203176408.jfif'
  },
  {
    id: 'store_digital_corner',
    slug: 'digital-corner',
    title: 'Digital Corner',
    subCategory: 'Apple Specialist & Accessories',
    price: '850+ Products',
    rating: 4.8,
    reviewsCount: 256,
    merchantCity: 'Douala',
    verified: true,
    coverImage: './Assets/telephone&PC/phoneBrands.image/139611657203176408.jfif'
  },
  {
    id: 'store_kamertech_direct',
    slug: 'kamertech-direct',
    title: 'KamerTech Direct',
    subCategory: 'Computing, Servers & Components',
    price: '620+ Products',
    rating: 5.0,
    reviewsCount: 194,
    merchantCity: 'Yaoundé',
    verified: true,
    coverImage: './Assets/telephone&PC/ordinateurPortable.image/dell/dell1.jfif'
  },
  {
    id: 'store_akwa_palm',
    slug: 'akwa-palm-hospitality',
    title: 'Akwa Palm Commercial & Living',
    subCategory: 'Hospitality & Commercial Suites',
    price: '48 Suites & Spaces',
    rating: 4.7,
    reviewsCount: 142,
    merchantCity: 'Douala',
    verified: true,
    coverImage: './Assets/telephone&PC/phoneBrands.image/139611657203176408.jfif'
  }
];

// The catalogue is static after boot, so its canonical form, the id/slug index
// and the market statistics are built ONCE, on first use, and shared.
let _catalog = null;

function buildCatalog() {
  const entities = [];
  const seedVerticals = { electronics: 'electronics', hotels: 'hotels', services: 'services', universities: 'education' };
  for (const [key, vertical] of Object.entries(seedVerticals)) {
    for (const p of rawProducts[key] || []) entities.push(fromSeed(p, vertical));
  }
  for (const id of Object.keys(catalogProducts)) {
    const cp = catalogProducts[id];
    if (cp && typeof cp === 'object' && cp.title) entities.push(fromCurated(id, cp));
  }
  for (const s of CURATED_STORES) entities.push(fromStore(s));

  const index = new Map();
  for (const e of entities) {
    if (!index.has(e.id)) index.set(e.id, e);
    if (e.slug && !index.has(e.slug)) index.set(e.slug, e);
  }

  const started = Date.now();
  const stats = CategoryStats.build(entities);
  logger.info(`[Comparison] market statistics built over ${entities.length} entities in ${Date.now() - started}ms`);
  return { entities, index, stats };
}

function getCatalog() {
  if (!_catalog) _catalog = buildCatalog();
  return _catalog;
}

class ComparisonService {
  /**
   * Head-to-head comparison of 2–4 ids.
   * @param {string[]} productIds
   * @param {object} [userPriorities] facet → 0..5
   * @param {{ locale?: string }} [options]
   */
  static async getComparison(productIds, userPriorities = {}, options = {}) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
      throw new ValidationError('Product IDs are required for comparison.', [
        { field: 'ids', message: 'Provide 2 to 4 product IDs.' }
      ]);
    }

    // Cap before resolving: every unresolved id may cost a database round trip,
    // so an uncapped ?ids= would be an unbounded query fan-out. Reject rather
    // than truncate, so a caller never gets a comparison it did not ask for.
    const requestedIds = [...new Set(productIds.map(id => String(id).trim()).filter(Boolean))];
    if (productIds.length > MAX_PRODUCTS || requestedIds.length > MAX_PRODUCTS) {
      throw new ValidationError('Comparison is limited to a maximum of 4 products.', [
        { field: 'ids', message: 'Provide 2 to 4 product IDs.' }
      ]);
    }

    const { index, stats } = getCatalog();
    const resolved = [];
    const unresolved = [];

    for (const id of requestedIds) {
      const local = index.get(id);
      if (local) {
        resolved.push(local);
        continue;
      }
      try {
        const dbProduct = await CatalogRepository.findPublicProductByIdOrSlug(id);
        // The repository falls back to curated cards for product pages — by
        // fuzzy id, and to a synthesised placeholder for an unknown id — so a
        // page never 404s. A comparison must never rank a made-up product:
        // only a real marketplace listing counts here (curated products were
        // already matched by exact id above).
        if (dbProduct && !dbProduct.curated) resolved.push(fromDatabase(dbProduct));
        else unresolved.push({ id, reason: 'not_found' });
      } catch (err) {
        logger.warn(`[Comparison] lookup failed for ${id}: ${err.message}`);
        unresolved.push({ id, reason: 'lookup_failed' });
      }
    }

    if (resolved.length === 0) {
      throw new NotFoundError('Products', requestedIds.join(', '));
    }

    const result = compare(resolved, { priorities: userPriorities, locale: options.locale, stats });
    result.requestedIds = requestedIds;
    result.unresolved = unresolved;
    return result;
  }

  /**
   * Products (or stores/stays) a buyer can add to the comparison. Copies of the
   * same product are listed once, and when a current product is given, the
   * same product type comes first: those are the comparisons that can be ranked.
   */
  static async getCompareCandidates({ category, currentProductId, search, type, limit = 16 } = {}) {
    const { entities, index, stats } = getCatalog();
    const current = currentProductId ? index.get(currentProductId) : null;
    const currentType = current ? classify(current).type : null;
    const currentKey = current ? identityKey(current) : null;

    let candidates = entities.filter(p => p.id !== currentProductId && p.slug !== currentProductId);

    if (type && type !== 'all') {
      if (type === 'stores') candidates = candidates.filter(p => p.entityType === 'store');
      else if (type === 'hotels') candidates = candidates.filter(p => p.entityType === 'hotel');
      else if (type === 'products') candidates = candidates.filter(p => p.entityType === 'product');
    }

    if (category && category !== 'all') {
      const c = String(category).toLowerCase();
      candidates = candidates.filter(p =>
        String(p.category || '').toLowerCase() === c ||
        String(p.subcategory || '').toLowerCase().includes(c) ||
        classify(p).type === c
      );
    }

    if (search && String(search).trim()) {
      const q = String(search).trim().toLowerCase();
      candidates = candidates.filter(p =>
        String(p.title || '').toLowerCase().includes(q) ||
        String(p.brand || '').toLowerCase().includes(q) ||
        String((p.seller && p.seller.name) || '').toLowerCase().includes(q) ||
        String(p.subcategory || '').toLowerCase().includes(q)
      );
    }

    // One entry per product identity (not per copy), never the current product.
    const seen = new Set(currentKey ? [currentKey] : []);
    const unique = [];
    for (const p of candidates) {
      const key = p.entityType === 'product' ? identityKey(p) : `entity:${p.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(p);
    }

    if (currentType) {
      const rank = (p) => (classify(p).type === currentType ? 0 : 1);
      unique.sort((a, b) => rank(a) - rank(b));
    }

    const max = Math.max(1, Math.min(MAX_CANDIDATES, Number(limit) || 16));
    const sliced = unique.slice(0, max);

    return {
      total: unique.length,
      items: sliced.map(p => {
        const { type: productType } = classify(p);
        let valueScore = null;
        if (p.entityType === 'product') {
          const ts = stats.typeStats(productType);
          if (ts) {
            const q = qualityIndex(extract(p, profileFor(productType)), profileFor(productType), ts);
            const v = stats.valueAssessment(productType, p.price, q);
            valueScore = v ? v.score : null;
          }
        }
        return {
          id: p.id,
          title: p.title,
          brand: p.brand,
          category: p.category,
          subCategory: p.subcategory,
          productType,
          price: p.price > 0 ? p.price : (p.displayPrice || null),
          priceNumeric: p.price,
          rating: p.rating,
          reviewsCount: p.reviewCount,
          merchant: p.seller && p.seller.name,
          merchantCity: p.seller && p.seller.city,
          verified: Boolean(p.seller && p.seller.verified),
          image: p.image,
          type: p.entityType,
          sameTypeAsCurrent: currentType ? productType === currentType : null,
          inStock: p.inStock,
          stockUnits: p.stockKnown ? p.stockUnits : null,
          valueScore
        };
      })
    };
  }

  /** Test seam: drop the cached catalogue and statistics. */
  static _resetCache() {
    _catalog = null;
  }
}

module.exports = ComparisonService;
