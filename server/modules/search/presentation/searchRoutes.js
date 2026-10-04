'use strict';
const express = require('express');
const { config } = require('../../../config/env');
const { requireAuth } = require('../../identity/presentation/guards/authGuard');
const RateLimitService = require('../../../infrastructure/cache/RateLimitService');
const { AppError } = require('../../../shared/errors/AppError');
const { SearchService } = require('../application/SearchService');
const { SearchAI, validateImage } = require('../infrastructure/SearchAI');
const { CombiProvider } = require('../infrastructure/CombiProvider');
function createSearchRouter({
  service = new SearchService(),
  ai = new SearchAI(),
  voice = new CombiProvider(),
  authenticate = requireAuth,
  settings = config.search,
  production = config.isProduction,
} = {}) {
  const router = express.Router(),
    route = (fn) => (req, res, next) =>
      Promise.resolve()
        .then(() => fn(req, res))
        .catch(next);
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.get('/capabilities', (req, res) =>
    res.json({
      success: true,
      data: {
        text: settings.enabled,
        assistant: settings.enabled && ai.ready,
        visual: settings.enabled && ai.ready,
        voice: settings.enabled && voice.ready,
      },
    }),
  );
  router.use((req, res, next) =>
    settings.enabled
      ? next()
      : next(
          new AppError(
            'Advanced search is being prepared. Please browse categories.',
            { code: 'SEARCH_NOT_READY', statusCode: 503 },
          ),
        ),
  );
  router.get(
    '/',
    route(async (req, res) => {
      const data = await service.search(req.query);
      res.setHeader(
        'Server-Timing',
        `search;dur=${Number(data.elapsedMs) || 0}`,
      );
      res.json({ success: true, data });
    }),
  );
  router.get(
    '/suggest',
    route(async (req, res) =>
      res.json({
        success: true,
        data: await service.search({ ...req.query, page: 1, limit: 8 }, true),
      }),
    ),
  );
  const paid = (max, seconds, key) =>
    RateLimitService.middleware({
      maxRequests: max,
      windowSeconds: seconds,
      keyPrefix: key,
      requireRedis: production,
      keyGenerator: (req) => String(req.userId || req.principal?.id),
    });
  router.use(
    ['/assistant', '/visual', '/voice/session'],
    authenticate,
    paid(10, 60, 'search:paid'),
    paid(100, 86400, 'search:daily'),
  );
  const assistant = (image) =>
    route(async (req, res) => {
      if (image) validateImage(req.body?.imageData);
      const intent = await ai.intent({
        message: req.body?.message || '',
        context: req.body?.context,
        ...(image ? { imageData: req.body.imageData } : {}),
      });
      const { message, ...filters } = intent;
      const data = intent.q
        ? await service.search({ ...filters, limit: 8 })
        : { items: [], total: 0, hasMore: false };
      res.json({
        success: true,
        data: {
          ...data,
          message,
          context: filters,
          matchType: image ? 'photo_description' : 'catalog',
        },
      });
    });
  router.post('/assistant', assistant(false));
  router.post('/visual', assistant(true));
  router.post(
    '/voice/session',
    paid(3, 60, 'search:voice'),
    route(async (req, res) =>
      res.json({ success: true, data: await voice.session() }),
    ),
  );
  return router;
}
module.exports = { createSearchRouter };
