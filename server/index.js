/**
 * LOUMOO Universal Commerce Platform — Enterprise API Gateway
 * Modular monolith routing pipeline.
 */

const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

// Sentry v8 only instruments Express when it is initialised before express is
// required; loading it after express silently disabled request tracing.
const { Sentry } = require('./clients/sentry');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const config = require('./config/env');
const { assertProductionConfig, validateProductionConfig } = require('./config/env');
const logger = require('./shared/logging/logger');
const requestContext = require('./shared/middleware/requestContext');
const errorHandler = require('./shared/middleware/errorHandler');
const { securityHeaders } = require('./shared/middleware/securityHeaders');
const RateLimitService = require('./infrastructure/cache/RateLimitService');
const { createSearchRouter } = require('./modules/search/presentation/searchRoutes');
const IdempotencyService = require('./infrastructure/cache/IdempotencyService');
const OutboxService = require('./infrastructure/events/OutboxService');
const { MediaStorageService } = require('./infrastructure/storage/MediaStorageService');

// Domain route modules
const healthRoutes = require('./modules/system/routes/healthRoutes');
const identityRoutes = require('./modules/identity/presentation/routes/identityRoutes');
const catalogRoutes = require('./modules/catalog/routes/catalogRoutes');
const storeRoutes = require('./modules/store/presentation/routes/storeRoutes');
const listingRoutes = require('./modules/listing/presentation/routes/listingRoutes');
const uploadRoutes = require('./modules/listing/presentation/routes/uploadRoutes');
const adaptiveRoutes = require('./modules/adaptive/presentation/routes/adaptiveRoutes');
const announcementRoutes = require('./modules/announcement/presentation/routes/announcementRoutes');
const travelRoutes = require('./modules/travel/presentation/routes/travelRoutes');
const orderRoutes = require('./modules/commerce/presentation/routes/orderRoutes');
const deliveryRoutes = require('./modules/delivery/presentation/routes/deliveryRoutes');
const { getSharedDeliveryService } = require('./modules/delivery/application/DeliveryService');
const { startOfferSweeper } = require('./modules/delivery/infrastructure/OfferSweeper');
const superAdminRoutes = require('../SuperAdmin/backend/routes/superAdminRoutes');
const { maintenanceGuard } = require('../SuperAdmin/backend/middleware/maintenanceGuard');

// Fail fast rather than boot a production server that cannot enforce its own
// security model. In development the same problems are logged as warnings.
const configProblems = config.isProduction
  ? assertProductionConfig()
  : validateProductionConfig();
for (const p of configProblems) {
  const label = p.severity === 'warning' ? 'warning' : 'ERROR';
  logger.warn(`[Config] (${label}) ${p.variable}: ${p.reason}`);
}

const app = express();

// Trust only the ingress policy configured for this deployment. The previous
// hard-coded hop count made a directly reachable process treat attacker-owned
// X-Forwarded-* headers as authoritative. Railway's public service should set
// TRUST_PROXY=1; production defaults to 1 hop, local development defaults to no proxy trust.
app.set('trust proxy', config.proxy.trust);
logger.info(`[Ingress] Express proxy trust policy configured: ${JSON.stringify(config.proxy.trust)}`);
app.disable('x-powered-by');

// 0. Response compression (gzip/brotli). Placed first so every downstream
// response — the ~1MB single-file app shell, JSON API envelopes, JS/CSS — is
// negotiated and compressed. This is the single largest win for users on slow
// or high-latency connections. compression.filter already skips content types
// that are already compressed (JPEG/PNG/WebP/video), so the media-heavy
// /Assets catalogue is served as-is without wasting CPU.
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// 0b. Security headers (before anything can write a response body).
app.use(securityHeaders);

// 1. Request context & tracing
app.use(requestContext);

// 2. CORS. A wildcard origin is usable only for non-production development
// traffic and never combined with credentialed responses. Production requires
// exact origins via assertProductionConfig().
const allowAnyOrigin = config.corsOrigins.includes('*') && !config.isProduction;
const corsOrigin = allowAnyOrigin
  ? '*'
  : (origin, callback) => callback(null, !origin || config.corsOrigins.includes(origin));

app.use(cors({
  origin: corsOrigin,
  credentials: !allowAnyOrigin,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Idempotency-Key'],
  exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After']
}));

// API responses may contain account, order, travel or other user-scoped data,
// so the default is no-store. A tightly-scoped allowlist of GET endpoints that
// return ONLY public, non-authenticated reference data (taxonomy + static
// travel reference lists) may instead be cached briefly by the browser and CDN
// — a real win for returning/low-bandwidth clients, who otherwise re-download
// these bodies on every page load. Exact-path match only (anchored to end or a
// query string, never a subpath), so no user-scoped :id route can slip in.
const PUBLIC_CACHEABLE = [
  /^\/api\/v1\/categories(?:$|\?)/,
  /^\/api\/v1\/listings\/taxonomy(?:$|\?)/,
  /^\/api\/(?:v1\/)?travel\/destinations(?:$|\?)/,
  /^\/api\/(?:v1\/)?travel\/hotels(?:$|\?)/,
  /^\/api\/(?:v1\/)?travel\/packages(?:$|\?)/,
  /^\/api\/(?:v1\/)?travel\/visa\/destinations(?:$|\?)/,
  /^\/api\/(?:v1\/)?travel\/bus\/operators(?:$|\?)/,
  /^\/api\/(?:v1\/)?travel\/bus\/schedules(?:$|\?)/
];
app.use('/api', (req, res, next) => {
  const cacheablePublic = req.method === 'GET' &&
    PUBLIC_CACHEABLE.some(re => re.test(req.originalUrl || req.path));
  res.setHeader(
    'Cache-Control',
    cacheablePublic ? 'public, max-age=120, stale-while-revalidate=600' : 'no-store'
  );
  next();
});

// Reject methods the API does not implement before parsing a potentially
// expensive body. CORS preflights continue through the CORS middleware above.
const API_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
app.use('/api', (req, res, next) => {
  if (API_METHODS.has(req.method)) return next();
  res.setHeader('Allow', Array.from(API_METHODS).join(', '));
  return res.status(405).json({
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'The requested HTTP method is not supported.',
      details: null,
      requestId: req.requestId || 'req_unknown'
    }
  });
});

// 3. Sliding-window rate limiting — scoped to the API surface and placed
// before body parsing so repeated oversized payloads cannot consume parser
// memory before the abuse gate runs.
//
// This must NOT guard static asset serving: a single page load of the
// media-heavy SPA fires 100+ image/video requests, which would blow a
// per-minute budget instantly and make the server 429 its own HTML shell and
// assets. In production Netlify's CDN serves those static files and only
// routes /api/* to this app, so limiting /api mirrors production exactly while
// keeping local dev (which also serves the frontend here) usable.
const commerceLimit = RateLimitService.middleware({ maxRequests: 120, windowSeconds: 60 });
const discoveryLimit = RateLimitService.middleware({ maxRequests: 180, peerMaxRequests: 3000, windowSeconds: 60, keyPrefix: 'discovery' });
app.use('/api', (req, res, next) => /^\/v1\/search(?:\/|$)/.test(req.path) ? discoveryLimit(req,res,next) : commerceLimit(req,res,next));

/**
 * 4. Body parsing.
 *
 * Two routes MUST NOT be JSON-parsed:
 *   - the Clerk webhook, whose Svix signature covers the exact raw bytes
 *   - binary media upload, which carries an image rather than JSON
 * Parsing them here would consume the stream and leave the route's own raw
 * parser with nothing to read.
 */
const RAW_BODY_PATHS = [
  '/api/v1/webhooks/clerk',
  '/api/v1/uploads/listing-media'
];

function skipRawBodyRoutes(parser) {
  return (req, res, next) => {
    if (RAW_BODY_PATHS.some(p => req.path === p || req.path.startsWith(`${p}/`))) {
      return next();
    }
    return parser(req, res, next);
  };
}

app.use(skipRawBodyRoutes(express.json({ limit: '2mb' })));
app.use(skipRawBodyRoutes(express.urlencoded({
  extended: true,
  limit: '2mb',
  parameterLimit: 100,
  depth: 10
})));

// 5. Idempotency support for mutating requests
app.use(IdempotencyService.middleware());

// 5b. Emergency platform maintenance enforcement
app.use(maintenanceGuard);

// 6. Versioned API routes
const v1Router = express.Router();
v1Router.use('/search', createSearchRouter());
v1Router.use('/', healthRoutes);
v1Router.use('/', identityRoutes);
v1Router.use('/', catalogRoutes);
v1Router.use('/', adaptiveRoutes);
v1Router.use('/stores', storeRoutes);
v1Router.use('/listings', listingRoutes);
v1Router.use('/uploads', uploadRoutes);
v1Router.use('/announcements', announcementRoutes);
v1Router.use('/travel', travelRoutes);
v1Router.use('/orders', orderRoutes);
v1Router.use('/deliveries', deliveryRoutes);
v1Router.use('/admin', superAdminRoutes);

app.use('/api/v1', v1Router);
// Direct REST path mount for Travel & Orders API
app.use('/api/travel', travelRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', superAdminRoutes);

// Root health fallbacks for cloud load balancers
app.use('/', healthRoutes);

/**
 * Public client bootstrap.
 *
 * Contains ONLY values that are safe in a browser: publishable/anon keys and
 * public DSNs. Server secrets (service role key, Clerk secret key, webhook
 * secret) are never included — a public key is designed to be seen; a secret
 * key grants full administrative access.
 */
app.get('/api/config', async (req, res) => {
  let systemSettings = null;
  try {
    const SuperAdminService = require('../SuperAdmin/backend/services/SuperAdminService');
    systemSettings = await SuperAdminService.getSystemSettings();
  } catch (err) {
    try {
      const SuperAdminRepository = require('../SuperAdmin/backend/repositories/SuperAdminRepository');
      systemSettings = await SuperAdminRepository.getAllSettings();
    } catch (_) {}
  }

  res.json({
    supabase: {
      url: config.supabase.url,
      anonKey: config.supabase.anonKey,
      publishableKey: config.supabase.publishableKey
    },
    clerk: {
      publishableKey: config.clerk.publishableKey,
      appId: config.clerk.appId
    },
    posthog: {
      apiKey: config.posthog.apiKey,
      host: config.posthog.host
    },
    sentry: {
      dsn: config.sentry.dsn
    },
    verification: {
      emailProvider: config.verification.emailProvider,
      phoneProvider: config.verification.phoneProvider,
      phoneEnabled: config.verification.phoneEnabled
    },
    systemSettings
  });
});

/**
 * Public Cached System Configuration
 * /api/v1/config & /api/config/system
 */
app.get(['/api/v1/config', '/api/config/system'], async (req, res, next) => {
  try {
    const SuperAdminService = require('../SuperAdmin/backend/services/SuperAdminService');
    const systemSettings = await SuperAdminService.getSystemSettings();
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json({
      success: true,
      data: { systemSettings }
    });
  } catch (err) {
    next(err);
  }
});

// Unknown API routes must never fall through to static assets or an HTML SPA
// shell. Keep this before the public-resource middleware.
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `No route matches ${req.method} ${req.originalUrl}`,
      details: null,
      requestId: req.requestId || 'req_unknown'
    }
  });
});

const publicRoot = path.resolve(__dirname, '..', 'public');
const publicIndex = path.join(publicRoot, 'index.html');
const appShell = fs.existsSync(publicIndex)
  ? publicIndex
  : path.resolve(__dirname, '..', 'Commerce App.dc.html');

// Dedicated SuperAdmin control center page
const superAdminRoot = path.resolve(__dirname, '..', 'SuperAdmin', 'frontend');
const superAdminIndex = path.join(superAdminRoot, 'index.html');

if (fs.existsSync(superAdminRoot)) {
  app.use('/superadmin', express.static(superAdminRoot, {
    dotfiles: 'deny',
    index: false,
    fallthrough: true
  }));
  app.use('/admin', express.static(superAdminRoot, {
    dotfiles: 'deny',
    index: false,
    fallthrough: true
  }));
  app.use('/css', express.static(path.join(superAdminRoot, 'css'), {
    dotfiles: 'deny',
    index: false,
    fallthrough: true
  }));
  app.use('/js', express.static(path.join(superAdminRoot, 'js'), {
    dotfiles: 'deny',
    index: false,
    fallthrough: true
  }));
}

app.get(['/superadmin', '/superadmin/', '/admin', '/admin/'], (req, res) => {
  res.sendFile(superAdminIndex);
});

app.get(['/', '/index.html', '/app'], (req, res) => {
  res.sendFile(appShell);
});

// 7. Static frontend assets. Only the generated public directory is exposed;
// never mount the repository root, which contains manifests, source, tests,
// configuration and server-side code. Netlify creates this directory during
// its build; the Railway API image may omit it and still serves its explicit
// app-shell route above.
if (fs.existsSync(publicRoot)) {
  app.use(express.static(publicRoot, {
    dotfiles: 'deny',
    index: false,
    redirect: false,
    fallthrough: true,
    maxAge: config.isProduction ? '1d' : 0
  }));
}

// 8. Sentry error handler
if (Sentry && Sentry.setupExpressErrorHandler) {
  Sentry.setupExpressErrorHandler(app);
}

// 9. Centralized error handler
app.use(errorHandler);

if (require.main === module) {
  const server = app.listen(config.port, () => {
    logger.info(`LOUMOO Enterprise Gateway running at http://localhost:${config.port}`);
    logger.info(`   - Health:        http://localhost:${config.port}/api/v1/health`);
    logger.info(`   - Account state: http://localhost:${config.port}/api/v1/me/state`);
    logger.info(`   - Listings:      http://localhost:${config.port}/api/v1/listings/taxonomy`);
    logger.info(`   - Frontend:      http://localhost:${config.port}/`);
  });

  // ── Background workers (only when the process owns the listen socket) ──────
  // The transactional outbox must deliver, and orphaned staging media must be
  // swept. Both run on unref'd timers so they never keep the process alive.
  const workers = [];

  const outboxTimer = setInterval(async () => {
    try {
      const { processed } = await OutboxService.processPendingBatch(50);
      if (processed > 0) logger.debug(`[OutboxWorker] dispatched ${processed} event(s)`);
    } catch (err) {
      logger.error(`[OutboxWorker] tick failed: ${err.message}`);
    }
  }, 15_000);
  outboxTimer.unref();
  workers.push(outboxTimer);

  const sweepTimer = setInterval(async () => {
    try {
      const res = await MediaStorageService.sweepOrphans({ limit: 200 });
      const swept = res.swept || res.removed || 0;
      if (swept > 0) logger.info(`[MediaSweep] swept ${swept} orphaned staging object(s)`);
    } catch (err) {
      logger.error(`[MediaSweep] sweep failed: ${err.message}`);
    }
  }, 60 * 60 * 1000); // hourly
  sweepTimer.unref();
  workers.push(sweepTimer);

  // Rider offers nobody answered go back to the seller (docs/DELIVERY_API.md,
  // "Offer expiry"). Here, where the process owns the listen socket; a serverless
  // deployment never reaches this block and relies on the release-on-read instead.
  // Starts no timer at all when DELIVERY_OFFER_TTL_MINUTES is 0.
  const offerSweeper = startOfferSweeper({ service: getSharedDeliveryService() });
  if (offerSweeper.timer) workers.push(offerSweeper.timer);

  // Graceful shutdown — Railway / Kubernetes / Docker send SIGTERM before
  // killing the process. Drained in-flight requests, stopped workers, closed
  // Redis and exited cleanly so no event is half-written.
  let shuttingDown = false;
  async function shutdown(signal, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[Shutdown] Received ${signal} — draining connections (max 10s).`);
    // Open delivery streams never finish on their own: end them so clients
    // reconnect, and so server.close() is not held open until the drain timeout.
    try { deliveryRoutes.closeAllStreams('server_restart'); } catch (_) { /* best effort */ }
    const timer = setTimeout(() => {
      logger.error('[Shutdown] Drain timeout exceeded — forcing exit.');
      process.exit(1);
    }, 10_000);
    timer.unref();
    server.close(async () => {
      logger.info('[Shutdown] HTTP server closed.');
      for (const t of workers) clearInterval(t);
      try {
        const RedisConnection = require('./infrastructure/cache/RedisConnection');
        const redis = RedisConnection.getInstance();
        if (redis && redis.status === 'ready') await redis.quit();
      } catch (_) { /* Redis optional at shutdown */ }
      logger.info('[Shutdown] Complete. Bye.');
      process.exit(exitCode);
    });
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.warn(`[Process] Unhandled Rejection: ${reason && reason.message || reason}`);
  });
  process.on('uncaughtException', (err) => {
    logger.error(`[Process] Uncaught Exception: ${err && err.stack || err}`);
    // Node's state is undefined after an uncaught exception (and a failed
    // listen() lands here too); drain and exit non-zero so the platform restarts.
    shutdown('uncaughtException', 1);
  });
}

module.exports = app;
