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
      limit: limit ? parseInt(limit, 10) : 8
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

    const rawLimit = parseInt(req.query.limit, 10);
    const rawPage = parseInt(req.query.page, 10);
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 100) : 50;
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

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

    const product = await CacheService.remember(cacheKey, 120, async () => {
      return CatalogRepository.findPublicProductByIdOrSlug(id);
    }, 'catalog');

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
