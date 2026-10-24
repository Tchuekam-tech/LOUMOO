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
// The single source of truth for the frontend's URLs (also read by the browser router,
// the hosting-config generator and the tests): docs/ROUTING.md.
const FrontendRoutes = require('../src/routing/routes');
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
const seoRoutes = require('./modules/system/routes/seoRoutes');
const PrerenderService = require('./modules/system/seo/PrerenderService');
const ContentPages = require('./modules/system/seo/content');
const identityRoutes = require('./modules/identity/presentation/routes/identityRoutes');
const catalogRoutes = require('./modules/catalog/routes/catalogRoutes');
const storeRoutes = require('./modules/store/presentation/routes/storeRoutes');
const listingRoutes = require('./modules/listing/presentation/routes/listingRoutes');
const uploadRoutes = require('./modules/listing/presentation/routes/uploadRoutes');
const adaptiveRoutes = require('./modules/adaptive/presentation/routes/adaptiveRoutes');
const announcementRoutes = require('./modules/announcement/presentation/routes/announcementRoutes');
const travelRoutes = require('./modules/travel/presentation/routes/travelRoutes');
const orderRoutes = require('./modules/commerce/presentation/routes/orderRoutes');
const recommendationRoutes = require('./modules/recommendation/presentation/routes/recommendationRoutes');
const deliveryRoutes = require('./modules/delivery/presentation/routes/deliveryRoutes');
const messagingRoutes = require('./modules/messaging/presentation/routes/messagingRoutes');
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
const RATE_LIMITS = require('./config/rateLimits');
const commerceLimit = RateLimitService.middleware({ ...RATE_LIMITS.api });
const discoveryLimit = RateLimitService.middleware({ ...RATE_LIMITS.discovery });
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
v1Router.use('/recommendations', recommendationRoutes);
v1Router.use('/deliveries', deliveryRoutes);
v1Router.use('/conversations', messagingRoutes);
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
    // Public, unauthenticated endpoint — deny-by-default projection only.
    systemSettings = await SuperAdminService.getPublicSystemSettings();
  } catch (err) {
    try {
      const SuperAdminRepository = require('../SuperAdmin/backend/repositories/SuperAdminRepository');
      systemSettings = await SuperAdminRepository.getPublicSettings();
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
    // Public, unauthenticated endpoint — deny-by-default projection only.
    const systemSettings = await SuperAdminService.getPublicSystemSettings();
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

// Crawlability endpoints (robots.txt, sitemap.xml, security.txt). Registered
// AFTER the /api surface and BEFORE the SPA shell / static middleware so they
// answer as themselves and are never served the HTML shell with a 200.
app.use(seoRoutes);

const publicRoot = path.resolve(__dirname, '..', 'public');
const publicIndex = path.join(publicRoot, 'index.html');
// The prerender injects a per-route head + content into the shell, so it must
// read the RAW shell — never a build-time-baked public/index.html (which already
// carries the home page's injected tags), or non-home routes would double-inject.
const rawShell = path.resolve(__dirname, '..', 'Commerce App.dc.html');
const appShell = fs.existsSync(rawShell) ? rawShell : publicIndex;

// Dedicated SuperAdmin control center page
const superAdminRoot = path.resolve(__dirname, '..', 'SuperAdmin', 'frontend');
const superAdminIndex = path.join(superAdminRoot, 'index.html');

if (fs.existsSync(superAdminRoot)) {
  app.use('/superadmin', express.static(superAdminRoot, {
    dotfiles: 'deny',
    index: false,
    // '/admin' and '/superadmin' are the canonical addresses (docs/ROUTING.md): serve the
    // page there instead of bouncing to a trailing-slash twin.
    redirect: false,
    fallthrough: true
  }));
  app.use('/admin', express.static(superAdminRoot, {
    dotfiles: 'deny',
    index: false,
    // '/admin' and '/superadmin' are the canonical addresses (docs/ROUTING.md): serve the
    // page there instead of bouncing to a trailing-slash twin.
    redirect: false,
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

// ── Frontend routes (docs/ROUTING.md) ─────────────────────────────────────────
// The app is one document whose screens the browser router picks from the URL, so
// the gateway's job is to hand that document to every URL the registry knows, say
// 404 (with the same document, so the app can draw its not-found screen) for the
// ones it does not, and never let a missing FILE pass for a page.
//
// Cached read of the shell: re-read only when the file changes (a deploy), so a
// 1 MB document is not read from disk on every navigation.
let shellCache = { mtimeMs: 0, body: null };
function readShell() {
  const stat = fs.statSync(appShell);
  if (!shellCache.body || stat.mtimeMs !== shellCache.mtimeMs) {
    shellCache = { mtimeMs: stat.mtimeMs, body: fs.readFileSync(appShell) };
  }
  return shellCache.body;
}

function sendShell(req, res, status) {
  let body;
  try { body = readShell(); } catch (err) {
    return res.status(503).type('text/plain').send('The application is starting. Please retry in a moment.');
  }
  res.status(status);
  res.set('Content-Type', 'text/html; charset=utf-8');
  // The shell names the current build's assets and carries no private data: always
  // revalidate it so a deploy is picked up at once, and never index an error page.
  res.set('Cache-Control', 'no-cache');
  if (status !== 200) res.set('X-Robots-Tag', 'noindex');
  return req.method === 'HEAD' ? res.end() : res.send(body);
}

// Prerender: hand the application shell with a per-route <head> (title,
// description, canonical, robots, OpenGraph, Twitter, JSON-LD) and a small
// crawlable content block written in, and the right HTTP status (404 for an
// unknown product/store, so there is no 200 soft-404). A render failure falls
// back to the raw shell at 200 so a page is never lost to an SEO error.
async function sendPrerendered(req, res) {
  let shell;
  try { shell = readShell(); } catch (err) {
    return res.status(503).type('text/plain').send('The application is starting. Please retry in a moment.');
  }
  let result;
  try {
    result = await PrerenderService.renderPage({
      url: req.originalUrl.split('#')[0],
      shellHtml: shell,
      siteUrl: (config.site && config.site.url) || undefined
    });
  } catch (err) {
    logger.error(`[Prerender] render failed, serving raw shell: ${err && err.message ? err.message : err}`);
    res.status(200).set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'no-cache');
    return req.method === 'HEAD' ? res.end() : res.send(shell);
  }
  // A legacy id URL of a curated product: permanent redirect to the product's canonical slug, query kept.
  // Crawlers and the CDN may keep it for an hour; it only changes if a family's primary ever does.
  if (result.redirect) {
    const q = req.originalUrl.indexOf('?');
    const search = q === -1 ? '' : req.originalUrl.slice(q).split('#')[0];
    res.set('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    return res.redirect(result.redirect.status, result.redirect.to + search);
  }
  res.status(result.status);
  res.set('Content-Type', 'text/html; charset=utf-8');
  // Public, indexable pages may be cached by the CDN (per-URL body, no private
  // data); everything else revalidates on every request.
  res.set('Cache-Control', result.cacheable
    ? 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400'
    : 'no-cache');
  if (!result.descriptor || !result.descriptor.indexable) res.set('X-Robots-Tag', 'noindex');
  return req.method === 'HEAD' ? res.end() : res.send(result.html);
}

// The French guides and the About page are standalone documents, not shell screens: the
// whole page is rendered from the same data and template the build writes into public/pages/
// for the CDN, so the gateway (Railway, local) and Vercel answer identically.
function sendContent(req, res, next) {
  let out = null;
  try {
    out = ContentPages.render(req.path, { siteUrl: (config.site && config.site.url) || undefined });
  } catch (err) {
    logger.error(`[Content] render failed for ${req.path}: ${err && err.message ? err.message : err}`);
    return next(err);
  }
  if (!out) return next();
  res.status(200);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  return req.method === 'HEAD' ? res.end() : res.send(out.html);
}

// Is this a request the application should answer with the application? A browser
// navigation, yes; and so is the DC runtime's own boot re-fetch of the page URL
// (support.js boot()), a plain fetch() that accepts anything: if that were answered
// with a bare 404 the runtime could not recover the template and every lazily-loaded
// screen of an unknown-route page, including the not-found screen, would stay blank.
// Only a request that clearly wants something else (a script, an image, JSON) gets a
// plain 404.
function isDocumentRequest(req) {
  const dest = req.headers['sec-fetch-dest'];
  if (dest && dest !== 'empty') return dest === 'document' || dest === 'iframe';
  return /text\/html|\*\/\*/.test(req.headers.accept || '*/*');
}

// Legacy addresses ('/index.html', '/app', '/Commerce App.dc.html', '/seller/onboarding')
// and wrong casing ('/Rider') answer with a redirect to the canonical URL, query kept.
// This runs BEFORE the static files so '/index.html' and the old shell file redirect
// instead of being served as a second copy of the home page.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const resolved = FrontendRoutes.resolve(req.originalUrl.split('#')[0]);
  if (resolved.type === 'redirect') return res.redirect(308, resolved.to);
  return next();
});

app.get('/', (req, res, next) => sendPrerendered(req, res).catch(next));

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

// 7b. Application routes. After the static files, so a real file always wins, and
// before the error handlers. 200 for a known route; 404 + the app (so it can render
// its not-found screen) for an unknown route or a named area that is not built; a plain
// 404 for anything that is not a page request.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const resolved = FrontendRoutes.resolve(req.originalUrl.split('#')[0]);
  switch (resolved.type) {
    case 'route':
      // 'page' routes are separate documents (the control center) served above.
      if (resolved.route.kind === 'page') return next();
      if (resolved.route.kind === 'content') return sendContent(req, res, next);
      return sendPrerendered(req, res).catch(next);
    case 'unavailable':
    case 'notfound':
      return isDocumentRequest(req)
        ? sendPrerendered(req, res).catch(next)
        : res.status(404).type('text/plain').send('Not found');
    case 'file':
      return res.status(404).type('text/plain').send('Not found');
    default:
      return next();
  }
});

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

  // A deployment whose delivery migration was never applied would otherwise show
  // it only when the first seller or rider opens a screen. Say it at boot, once.
  getSharedDeliveryService().repo.probe()
    .then((p) => {
      if (!p.ready) logger.error(`[Delivery] NOT READY: ${p.reason}. The delivery endpoints that need it answer 503 until it is applied.`);
    })
    .catch(() => { /* a failed check must never stop the server booting */ });

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
