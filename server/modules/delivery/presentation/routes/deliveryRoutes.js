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
 *     over, the viewer loses access (re-checked on every heartbeat, against the
 *     live account, not the identity captured at connect) or the server shuts down;
 *   - answers 501 STREAM_UNSUPPORTED at once on a serverless runtime (Netlify /
 *     Vercel / Lambda), where a held-open response would just hang until the
 *     platform kills it; the client falls back to polling GET /:id.
 */

const express = require('express');
const { getSharedDeliveryService } = require('../../application/DeliveryService');
const deliveryEvents = require('../../infrastructure/DeliveryEvents');
const { eventForViewer, TERMINAL_STATUSES } = require('../../domain/Delivery');
const schemas = require('../validators/deliverySchemas');
const { requireAuth } = require('../../../identity/presentation/guards/authGuard');
const { ValidationError, RateLimitError } = require('../../../../shared/errors/AppError');
const logger = require('../../../../shared/logging/logger');

const MAX_VALIDATION_ISSUES = 5;

/** True when this process cannot hold a response open (Lambda-style runtimes). */
function isServerlessRuntime(env = process.env) {
  return Boolean(env.AWS_LAMBDA_FUNCTION_NAME || env.NETLIFY || env.VERCEL);
}

/**
 * Fresh look at the viewer's account, by profile id (uncached): returns the
 * identity to authorise with, or null when the account is gone or blocked. The
 * identity captured at connect is NOT reused: a demoted admin, or a user who was
 * suspended or deleted after the stream opened, must stop receiving it.
 */
async function liveIdentity(who) {
  const ProfileRepository = require('../../../identity/infrastructure/ProfileRepository');
  const row = await ProfileRepository.findById(who.userId);
  if (!row) return null;
  const blocked = row.account_status === 'anonymized' || row.account_status === 'suspended'
    || row.status === 'deleted' || row.status === 'suspended' || row.deleted_at;
  if (blocked) return null;
  return { userId: who.userId, userRole: row.primary_role || 'customer' };
}

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
    // Bounded, flat details: raw zod issues would echo every unrecognised key a
    // client sent (unbounded) in a shape no other endpoint uses.
    const details = parsed.error.issues.slice(0, MAX_VALIDATION_ISSUES).map((i) => ({
      field: (i.path || []).join('.') || null,
      message: String(i.message || 'Invalid value').slice(0, 200)
    }));
    throw new ValidationError(`${path}${(issue && String(issue.message).slice(0, 200)) || `Invalid ${what} payload`}`, details);
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
  maxStreamsPerUser = DEFAULTS.maxStreamsPerUser,
  revalidate = liveIdentity,
  streamSupported = !isServerlessRuntime()
} = {}) {
  const router = express.Router();
  const svc = () => service || getSharedDeliveryService();
  const openStreams = new Map(); // userId -> count
  const liveStreams = new Set(); // end(reason) callbacks, for graceful shutdown

  // Wraps an async handler so a rejected promise reaches the error middleware.
  const route = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

  // ------------------------------------------------------------------ riders

  router.get('/drivers', authenticate, route(async (req, res) => {
    const { deliveryId, status } = parseBody(schemas.ListDriversQuerySchema, req.query, 'query');
    // ?status= is the admin roster (every rider, suspended ones included); without
    // it this is the ranked list of active riders a seller picks from.
    const drivers = status
      ? await svc().listRiderRoster(callerOf(req), { status })
      : await svc().listDrivers(callerOf(req), { deliveryId });
    ok(res, { drivers });
  }));

  // The seller's dispatch board (literal path: registered before /:id).
  router.get('/dispatch', authenticate, route(async (req, res) => {
    const { view, limit } = parseBody(schemas.DispatchBoardQuerySchema, req.query, 'query');
    ok(res, await svc().getDispatchBoard(callerOf(req), { view, limit }));
  }));

  router.post('/drivers/:profileId', authenticate, route(async (req, res) => {
    const body = parseBody(schemas.RegisterDriverSchema, req.body, 'rider');
    ok(res, { driver: await svc().registerDriver(req.params.profileId, body, callerOf(req)) });
  }));

  router.get('/driver/me', authenticate, route(async (req, res) => {
    ok(res, await svc().getRiderOverview(callerOf(req)));
  }));

  // -------------------------------------------------------- create / look-ups

  router.get('/by-order/:orderId', authenticate, route(async (req, res) => {
    ok(res, { delivery: await svc().getDeliveryByOrder(req.params.orderId, callerOf(req)) });
  }));

  router.post('/', authenticate, route(async (req, res) => {
    const { orderId, ...input } = parseBody(schemas.CreateDeliverySchema, req.body, 'delivery');
    const delivery = await svc().createDelivery(orderId, callerOf(req), input);
    ok(res, { delivery }, { status: 201 });
  }));

  // ------------------------------------------------------------- live stream

  router.get('/:id/stream', authenticate, route(async (req, res) => {
    if (!streamSupported) {
      // Not an error to log: it is the correct answer on this deployment. The
      // client switches to polling GET /:id (see docs/DELIVERY_API.md).
      res.status(501).json({
        success: false,
        error: {
          code: 'STREAM_UNSUPPORTED',
          message: 'Live streaming is not available on this deployment. Poll GET /deliveries/:id every 5-10 seconds instead.',
          details: null,
          requestId: req.requestId || 'req_unknown'
        }
      });
      return;
    }
    const who = callerOf(req);
    const userKey = String(who.userId || '');
    const openNow = openStreams.get(userKey) || 0;
    if (openNow >= maxStreamsPerUser) {
      throw new RateLimitError('Too many open delivery streams. Close one and try again.', 10);
    }

    // Reserve the slot immediately (before any await) so a burst of connects
    // cannot all pass the cap check; cleanup() releases it exactly once.
    openStreams.set(userKey, openNow + 1);

    const deliveryId = req.params.id;
    const buffer = [];
    let ready = false;
    let closed = false;
    let role = null;
    let heartbeat = null;
    let lifetime = null;
    let unsubscribe = () => {};

    // Subscribe BEFORE reading the snapshot, and hold events until the snapshot
    // is written, so a change landing between the read and the subscription is
    // delivered (after the snapshot) rather than lost.
    unsubscribe = events.subscribe(deliveryId, (event) => {
      if (closed) return;
      if (!ready) { buffer.push(event); return; }
      handleEvent(event);
    });

    let snapshot;
    try {
      snapshot = await svc().getDelivery(deliveryId, who); // 404 for non-participants
    } catch (err) {
      cleanup();
      throw err;
    }
    // Check the RESPONSE/socket, not req.destroyed: a request whose body was
    // read (express.json() reads even a GET that carries one) is `destroyed`
    // while its connection is perfectly alive.
    if (res.destroyed || res.writableEnded || !res.socket || res.socket.destroyed) { cleanup(); return; }
    role = snapshot.viewerRole;

    function write(chunk) {
      if (closed) return;
      try {
        res.write(chunk);
        if (typeof res.flush === 'function') res.flush();
      } catch (err) {
        cleanup();
      }
    }
    function send(type, data) {
      write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    }
    function cleanup() {
      if (closed) return;
      closed = true;
      liveStreams.delete(end);
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      if (lifetime) clearTimeout(lifetime);
      const left = (openStreams.get(userKey) || 1) - 1;
      if (left <= 0) openStreams.delete(userKey); else openStreams.set(userKey, left);
    }
    function end(reason) {
      if (closed) return;
      send('end', { reason });
      cleanup();
      try { res.end(); } catch (err) { /* already gone */ }
    }
    function handleEvent(event) {
      const wire = eventForViewer(event, role);
      if (wire) send(event.type, wire);
      if (event.type !== 'status') return;
      if (TERMINAL_STATUSES.includes(event.status)) { end('complete'); return; }
      recheckAccess();
    }
    // Access can change while a stream is open: a rider is replaced or declines
    // (delivery side), or an account is suspended, deleted or demoted (account
    // side). Re-check on every status change and on every heartbeat, against the
    // live account. A failed check is logged and retried next tick (fail open: a
    // transient database error must not drop every viewer).
    function recheckAccess() {
      if (closed) return;
      Promise.resolve(revalidate(who))
        .then((fresh) => (fresh ? svc().getViewerRole(deliveryId, fresh) : null))
        .then((current) => { if (!current) end('access_revoked'); })
        .catch((err) => logger.warn(`[DeliveryStream] Access re-check failed for ${deliveryId}: ${err.message}`));
    }

    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform: stops the compression middleware from buffering the stream.
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    // `res` 'close' is the documented signal that the response ended or the
    // client went away. (A request's own 'close' changed meaning in Node 16 and
    // can fire once the request body has been read, so it is not relied on.)
    res.on('close', cleanup);
    res.on('error', cleanup);

    write(`retry: ${DEFAULTS.retryMs}\n\n`);
    send('status', {
      status: snapshot.status,
      at: snapshot.updatedAt,
      etaMinutes: snapshot.etaMinutes,
      distanceKm: snapshot.distanceKm
    });
    if (snapshot.lastLocation) {
      const loc = snapshot.lastLocation;
      send('location', {
        lat: loc.lat, lng: loc.lng, at: loc.at, speedKmh: loc.speedKmh ?? null, heading: loc.heading ?? null
      });
    }
    if (TERMINAL_STATUSES.includes(snapshot.status)) { end('complete'); return; }

    liveStreams.add(end);
    ready = true;
    for (const event of buffer.splice(0)) handleEvent(event);
    // A buffered terminal event may just have ended the stream: do not start
    // timers on a stream that is already closed (nothing would ever clear them).
    if (closed) return;

    heartbeat = setInterval(() => { write(': keep-alive\n\n'); recheckAccess(); }, heartbeatMs);
    lifetime = setTimeout(() => end('timeout'), maxStreamMs);
    if (heartbeat.unref) heartbeat.unref();
    if (lifetime.unref) lifetime.unref();
  }));

  // ---------------------------------------------------- per-delivery reads

  router.get('/:id/code', authenticate, route(async (req, res) => {
    ok(res, await svc().getHandoverCode(req.params.id, callerOf(req)));
  }));

  router.get('/:id', authenticate, route(async (req, res) => {
    ok(res, { delivery: await svc().getDelivery(req.params.id, callerOf(req)) });
  }));

  // ------------------------------------------------------------ seller / admin

  router.post('/:id/assign', authenticate, route(async (req, res) => {
    const { driverId } = parseBody(schemas.AssignDriverSchema, req.body, 'assignment');
    ok(res, { delivery: await svc().assignDriver(req.params.id, driverId, callerOf(req)) });
  }));

  // No body: the server chooses the rider. A body, if sent, is ignored (as for accept/decline).
  router.post('/:id/auto-assign', authenticate, route(async (req, res) => {
    ok(res, { delivery: await svc().autoAssignDriver(req.params.id, callerOf(req)) });
  }));

  router.post('/:id/cancel', authenticate, route(async (req, res) => {
    const { reason } = parseBody(schemas.CancelDeliverySchema, req.body, 'cancellation');
    ok(res, { delivery: await svc().cancelDelivery(req.params.id, reason, callerOf(req)) }, { message: 'Delivery cancelled.' });
  }));

  router.post('/:id/resolve', authenticate, route(async (req, res) => {
    const body = parseBody(schemas.ResolveDeliverySchema, req.body, 'resolution');
    ok(res, { delivery: await svc().resolveDelivery(req.params.id, body, callerOf(req)) });
  }));

  router.post('/:id/reconcile', authenticate, route(async (req, res) => {
    ok(res, await svc().reconcileOrder(req.params.id, callerOf(req)));
  }));

  // -------------------------------------------------------------------- rider

  router.post('/:id/accept', authenticate, route(async (req, res) => {
    ok(res, { delivery: await svc().acceptDelivery(req.params.id, callerOf(req)) });
  }));

  router.post('/:id/decline', authenticate, route(async (req, res) => {
    ok(res, { delivery: await svc().declineDelivery(req.params.id, callerOf(req)) });
  }));

  router.post('/:id/status', authenticate, route(async (req, res) => {
    const { status, note } = parseBody(schemas.RiderStatusSchema, req.body, 'status');
    ok(res, { delivery: await svc().updateStatus(req.params.id, status, note, callerOf(req)) });
  }));

  router.post('/:id/location', authenticate, route(async (req, res) => {
    const body = parseBody(schemas.LocationPingSchema, req.body, 'location');
    ok(res, await svc().recordLocation(req.params.id, body, callerOf(req)));
  }));

  router.post('/:id/complete', authenticate, route(async (req, res) => {
    const { code } = parseBody(schemas.CompleteDeliverySchema, req.body, 'completion');
    ok(res, { delivery: await svc().completeDelivery(req.params.id, code, callerOf(req)) }, { message: 'Delivery completed.' });
  }));

  router.openStreamCount = () => [...openStreams.values()].reduce((a, b) => a + b, 0);
  // Graceful shutdown: tell every open stream why it is closing so clients
  // reconnect (to the next instance) instead of waiting out a dead socket, and
  // so server.close() is not held open until the drain timeout.
  router.closeAllStreams = (reason = 'server_restart') => {
    for (const end of [...liveStreams]) end(reason);
  };
  return router;
}

// Production router: real authentication, shared service, default limits.
const router = createDeliveryRouter();

module.exports = router;
module.exports.createDeliveryRouter = createDeliveryRouter;
module.exports.isServerlessRuntime = isServerlessRuntime;
module.exports.DEFAULTS = DEFAULTS;
