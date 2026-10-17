/**
 * LOUMOO Messaging — HTTP routes, mounted at /api/v1/conversations
 * ---------------------------------------------------------------------------
 *   GET  /                    the caller's inbox            ?role=buying|selling
 *   GET  /unread              unread totals for the badge
 *   POST /                    open a conversation           {listingId|storeId|orderId, body?, clientId?}
 *   GET  /:id                 the thread                    ?after=<seq> | ?before=<seq>, &limit
 *   POST /:id/messages        send                          {body, clientId?}
 *   POST /:id/read            mark the thread read
 *
 * Every route sits behind `authenticate` (requireAuth in production). The caller
 * is `req.userId`; nothing in a body, query or path can name a buyer or seller.
 * Updates reach an open thread by polling `?after=<seq>`, which works on every
 * host this app runs on, serverless included.
 */
'use strict';

const express = require('express');
const { requireAuth } = require('../../../identity/presentation/guards/authGuard');
const RateLimitService = require('../../../../infrastructure/cache/RateLimitService');
const RATE_LIMITS = require('../../../../config/rateLimits');

function pick(source, keys) {
  const out = {};
  for (const key of keys) if (source && source[key] !== undefined) out[key] = source[key];
  return out;
}

function createMessagingRouter({
  service = null,
  authenticate = requireAuth,
  sendLimiter = null
} = {}) {
  const router = express.Router();
  const svc = () => service || require('../../application/MessagingService').getSharedMessagingService();
  const limitSends = sendLimiter || RateLimitService.middleware({
    ...RATE_LIMITS.messagingSend,
    keyGenerator: (req) => `user:${req.userId}`
  });
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  // Private, per-user data: never cached by a browser or a CDN.
  router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

  router.get('/', authenticate, wrap(async (req, res) => {
    const conversations = await svc().listInbox(req.userId, { role: req.query.role, limit: req.query.limit });
    res.json({ status: 'success', data: { conversations } });
  }));

  router.get('/unread', authenticate, wrap(async (req, res) => {
    const unread = await svc().unreadCount(req.userId);
    res.json({ status: 'success', data: unread });
  }));

  router.post('/', authenticate, limitSends, wrap(async (req, res) => {
    const input = pick(req.body || {}, ['listingId', 'storeId', 'orderId', 'body', 'clientId']);
    const thread = await svc().startConversation(req.userId, input);
    res.status(thread.created ? 201 : 200).json({ status: 'success', data: thread });
  }));

  router.get('/:id', authenticate, wrap(async (req, res) => {
    const thread = await svc().getThread(req.userId, req.params.id, pick(req.query, ['after', 'before', 'limit']));
    res.json({ status: 'success', data: thread });
  }));

  router.post('/:id/messages', authenticate, limitSends, wrap(async (req, res) => {
    const result = await svc().sendMessage(req.userId, req.params.id, pick(req.body || {}, ['body', 'clientId']));
    res.status(201).json({ status: 'success', data: result });
  }));

  router.post('/:id/read', authenticate, wrap(async (req, res) => {
    const result = await svc().markRead(req.userId, req.params.id);
    res.json({ status: 'success', data: result });
  }));

  return router;
}

const router = createMessagingRouter();

module.exports = router;
module.exports.createMessagingRouter = createMessagingRouter;
