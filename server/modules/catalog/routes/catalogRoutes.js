/**
 * Catalog Module — API Routes
 * ---------------------------------------------------------------------------
 * The public commerce discovery gateway for LOUMOO.
 * Discovers real, published seller listings from PostgreSQL `iam.listings`,
 * hydrates cover images and store metadata, and provides the Comparison Engine.
 */

const express = require('express');
const router = express.Router();
const CacheService = require('../../../infrastructure/cache/CacheService');
const AnalyticsService = require('../../../infrastructure/analytics/AnalyticsService');
const { NotFoundError, ValidationError } = require('../../../shared/errors/AppError');
const CatalogRepository = require('../infrastructure/CatalogRepository');
const ComparisonService = require('../application/ComparisonService');
const ListingTaxonomyUseCase = require('../../listing/application/ListingTaxonomyUseCase');
const { clampPagination } = require('../../../shared/http/pagination');

// GET /api/v1/catalog/compare OR /api/v1/products/compare
const handleCompare = async (req, res, next) => {
  try {
    let ids = req.query.ids;
    if (typeof ids === 'string') {
      ids = ids.split(',').map(s => s.trim()).filter(Boolean);
    } else if (Array.isArray(req.query.id)) {
      ids = req.query.id;
    }

    if (!ids || ids.length === 0) {
      throw new ValidationError('Product IDs are required for comparison.', [
        { field: 'ids', message: 'Provide 2 to 4 comma-separated product IDs in ?ids=id1,id2.' }
      ]);
    }

    let priorities = {};
    if (req.query.priorities) {
      if (typeof req.query.priorities === 'string') {
        try {
          priorities = JSON.parse(req.query.priorities);
        } catch {
          req.query.priorities.split(',').forEach(p => {
            priorities[p.trim()] = 5;
          });
        }
      } else if (typeof req.query.priorities === 'object') {
        priorities = req.query.priorities;
      }
    }

    // Verdict language: ?lang=fr|en, else the browser's Accept-Language.
    const locale = req.query.lang || req.query.locale || String(req.headers['accept-language'] || '').slice(0, 2);
    const comparison = await ComparisonService.getComparison(ids, priorities, { locale });

    AnalyticsService.track(req.userId || 'anonymous', 'products_compared', {
      productIds: ids,
      recommended: comparison.recommendation?.recommendedProductId
    });

    res.json({ success: true, data: comparison });
  } catch (err) {
    next(err);
  }
};

router.get('/catalog/compare', handleCompare);
router.get('/products/compare', handleCompare);

// GET /api/v1/catalog/compare/candidates OR /api/v1/products/compare/candidates
const handleCompareCandidates = async (req, res, next) => {
  try {
    const { category, currentId, search, limit, type } = req.query;
    const candidates = await ComparisonService.getCompareCandidates({
      category,
      currentProductId: currentId,
      search,
      type,
      limit: clampPagination({ limit }, { defaultLimit: 8, maxLimit: 50 }).limit
    });

    res.json({ success: true, data: candidates });
  } catch (err) {
    next(err);
  }
};

router.get('/catalog/compare/candidates', handleCompareCandidates);
router.get('/products/compare/candidates', handleCompareCandidates);

// GET /api/v1/products
router.get('/products', async (req, res, next) => {
  try {
    const { category, search, q, vertical, storeId, brand, sortBy, city } = req.query;
    const searchQuery = search || q || '';
    // Verified-store refinement: any explicit truthy value opts in.
    const verified = ['1', 'true', 'yes'].includes(String(req.query.verified || '').toLowerCase());

    // Clamp pagination server-side: default 24, hard max 100, page >= 1. A
    // caller cannot pull the whole catalogue with ?limit=999999 or wedge the
    // query with a negative/zero limit.
    const { page, limit } = clampPagination(req.query, { defaultLimit: 24, maxLimit: 100 });

    const cacheKey = `catalog:list:${category || 'all'}:${vertical || 'all'}:${searchQuery}:${storeId || 'all'}:${brand || 'all'}:${city || 'all'}:${verified ? 'v' : 'all'}:${sortBy || 'recent'}:${page}:${limit}`;

    const data = await CacheService.remember(cacheKey, 60, async () => {
      return CatalogRepository.listPublishedListings({
        category,
        vertical,
        search: searchQuery,
        storeId,
        brand,
        city,
        verified,
        page,
        limit,
        sortBy
      });
    }, 'catalog');

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/products/:id
router.get('/products/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const cacheKey = `catalog:detail:${id}`;

    // Strict, exact-id lookup: a real published product (DB listing or a REAL
    // curated product) or null — it NEVER fabricates a synthetic placeholder, so
    // an unknown id is an honest 404 instead of a 200 with a made-up product.
    // A database error throws; we answer 503 rather than fabricate or 404 a
    // product that may well exist. (The synthetic fallback remains ONLY in
    // ComparisonService, where comparing a possibly-curated id is intentional.)
    let product;
    try {
      product = await CacheService.remember(cacheKey, 120, async () => {
        return CatalogRepository.findIndexableProductByIdOrSlug(id);
      }, 'catalog');
    } catch (dbErr) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'PRODUCT_LOOKUP_UNAVAILABLE',
          message: 'Product lookup is temporarily unavailable. Please retry in a moment.',
          details: null,
          requestId: req.requestId || 'req_unknown'
        }
      });
    }

    if (!product) {
      throw new NotFoundError('Product', id);
    }

    AnalyticsService.track(req.userId || 'anonymous', 'product_viewed', {
      productId: id,
      title: product.title,
      category: product.category,
      price: product.priceNumeric
    });

    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/categories
router.get('/categories', async (req, res, next) => {
  try {
    const data = await CacheService.remember('catalog:categories:all', 300, async () => {
      const taxonomy = await ListingTaxonomyUseCase.getTaxonomyTree();
      return taxonomy.categories || [];
    }, 'catalog');

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
