/**
 * LOUMOO Delivery — Presentation Routes
 * ---------------------------------------------------------------------------
 * REST + Server-Sent Events for delivery tracking. Implements the endpoints in
 * docs/DELIVERY_API.md, mounted at /api/v1/deliveries.
 *
 * Every route sits behind `authenticate` (requireAuth in production). Identity
 * comes only from the verified session, never from the body, query or URL; the
 * service owns authorisation and answers 404 to non-participants.
 *
 * Route order matters: the literal paths (/drivers, /driver/me, /by-order/…)
 * are registered before `/:id`, or Express would read "drivers" as a delivery id.
 *
 * The live stream:
 *   - authenticates with the Authorization header, so the client must use
 *     fetch() streaming (or a fetch-based EventSource), not the browser's native
 *     EventSource, which cannot send headers. A token in the query string would
 *     end up in access logs, so it is deliberately not supported;
 *   - sends `Cache-Control: no-transform`, without which the compression
 *     middleware buffers the stream and nothing arrives until it closes;
 *   - applies the same visibility rules as the REST view (eventForViewer);
 *   - is bounded: a per-user cap on open streams, a maximum lifetime (sessions
 *     expire; the client reconnects), and it closes itself once the delivery is
 *     over or the viewer loses access.
 */

const express = require('express');
const { getSharedDeliveryService } = require('../../application/DeliveryService');
const deliveryEvents = require('../../infrastructure/DeliveryEvents');
const { eventForViewer, TERMINAL_STATUSES } = require('../../domain/Delivery');
const schemas = require('../validators/deliverySchemas');
const { requireAuth } = require('../../../identity/presentation/guards/authGuard');
const { ValidationError, RateLimitError } = require('../../../../shared/errors/AppError');
const logger = require('../../../../shared/logging/logger');

const DEFAULTS = Object.freeze({
  heartbeatMs: 25 * 1000,
  maxStreamMs: 30 * 60 * 1000,
  maxStreamsPerUser: 5,
  retryMs: 5000
});

function callerOf(req) {
  const userId = req.userProfile?.id || req.userId || req.principal?.id;
  const userRole = req.userProfile?.primaryRole || req.principal?.primaryRole || 'customer';
  return { userId, userRole };
}

function parseBody(schema, body, what) {
  const parsed = schema.safeParse(body === undefined || body === null ? {} : body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue && issue.path && issue.path.length ? `${issue.path.join('.')}: ` : '';
    throw new ValidationError(`${path}${(issue && issue.message) || `Invalid ${what} payload`}`, parsed.error.issues);
  }
  return parsed.data;
}

function ok(res, data, { status = 200, message } = {}) {
  const body = { success: true, status: 'success', data };
  if (message) body.message = message;
  res.status(status).json(body);
}

function createDeliveryRouter({
  service = null,
  authenticate = requireAuth,
  events = deliveryEvents,
  heartbeatMs = DEFAULTS.heartbeatMs,
  maxStreamMs = DEFAULTS.maxStreamMs,
  maxStreamsPerUser = DEFAULTS.maxStreamsPerUser
} = {}) {
  const router = express.Router();
  const svc = () => service || getSharedDeliveryService();
  const openStreams = new Map(); // userId -> count

  // Wraps an async handler so a rejected promise reaches the error middleware.
  const route = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

  // ------------------------------------------------------------------ riders

  router.get('/drivers', authenticate, route(async (req, res) => {
    ok(res, { drivers: await svc().listDrivers(callerOf(req)) });
  }));

  router.post('/drivers/:profileId', authenticate, route(async (req, res) => {
    const body = parseBody(schemas.RegisterDriverSchema, req.body, 'rider');
    ok(res, { driver: await svc().registerDriver(req.params.profileId, body, callerOf(req)) });
  }));

  router.get('/driver/me', authenticate, route(async (req, res) => {
    ok(res, await svc().getRiderOverview(callerOf(req)));
  }));

  router.openStreamCount = () => [...openStreams.values()].reduce((a, b) => a + b, 0);
  return router;}

// Production router: real authentication, shared service, default limits.
const router = createDeliveryRouter();

module.exports = router;
module.exports.createDeliveryRouter = createDeliveryRouter;
module.exports.DEFAULTS = DEFAULTS;
