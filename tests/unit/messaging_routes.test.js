/**
 * LOUMOO — In-app messaging HTTP routes (/api/v1/conversations)
 * ---------------------------------------------------------------------------
 * The real router and the real error handler over a real HTTP server, on the
 * in-memory repository. Authentication is a header-driven stand-in; a structural
 * check pins that the PRODUCTION router puts requireAuth in front of every route.
 */

require('../setup');
const assert = require('assert');
const http = require('http');
const express = require('express');

const errorHandler = require('../../server/shared/middleware/errorHandler');
const { AuthenticationError } = require('../../server/shared/errors/AppError');
const { requireAuth } = require('../../server/modules/identity/presentation/guards/authGuard');
const productionRouter = require('../../server/modules/messaging/presentation/routes/messagingRoutes');
const { createMessagingRouter } = productionRouter;
const { MessagingService } = require('../../server/modules/messaging/application/MessagingService');
const { InMemoryMessagingRepository } = require('../../server/modules/messaging/infrastructure/MessagingRepository');

function fakeAuth(req, res, next) {
  const id = req.headers['x-test-user'];
  if (!id) return next(new AuthenticationError('Authentication required.'));
  req.userId = id;
  req.principal = { id };
  return next();
}

function structuralChecks() {
  const routes = productionRouter.stack.filter((layer) => layer.route);
  assert.ok(routes.length >= 6, 'every endpoint is registered');
  for (const layer of routes) {
    const first = layer.route.stack[0].handle;
    assert.strictEqual(first, requireAuth, `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path} starts with requireAuth`);
  }
}

async function main() {
  structuralChecks();

  const repo = new InMemoryMessagingRepository({
    stores: [{ id: 'store_1', ownerId: 'seller_1', name: 'Orca Electronics', phone: '+237690000001' }],
    profiles: [{ id: 'buyer_1', firstName: 'Amina', lastName: 'Kamga' }]
  });
  const service = new MessagingService({
    repository: repo,
    orderRepository: { findListingById: async () => null, findOrderById: async () => null },
    notifier: { create: async () => null }
  });
  let sends = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/v1/conversations', createMessagingRouter({
    service,
    authenticate: fakeAuth,
    sendLimiter: (req, res, next) => { sends += 1; next(); }
  }));
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/conversations`;

  const call = async (method, path, user, body) => {
    const headers = { 'content-type': 'application/json' };
    if (user) headers['x-test-user'] = user;
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json, headers: res.headers };
  };

  try {
    assert.strictEqual((await call('GET', '/', null)).status, 401, 'no session, no inbox');
    assert.strictEqual((await call('POST', '/', null, { storeId: 'store_1', body: 'hi' })).status, 401);

    const opened = await call('POST', '/', 'buyer_1', { storeId: 'store_1', body: 'Hello!', sellerId: 'buyer_2', buyerId: 'x' });
    assert.strictEqual(opened.status, 201, 'a new conversation is 201');
    assert.strictEqual(opened.headers.get('cache-control'), 'private, no-store', 'private data is never cached');
    const id = opened.body.data.conversation.id;
    assert.strictEqual(opened.body.data.messages[0].body, 'Hello!');
    assert.strictEqual((await repo.findConversation(id)).sellerId, 'seller_1', 'body fields cannot pick the seller');
    assert.strictEqual((await call('POST', '/', 'buyer_1', { storeId: 'store_1' })).status, 200, 'reopening is 200');

    const inbox = await call('GET', '/?role=buying', 'buyer_1');
    assert.strictEqual(inbox.status, 200);
    assert.strictEqual(inbox.body.data.conversations[0].title, 'Orca Electronics');
    const sellerInbox = await call('GET', '/', 'seller_1');
    assert.strictEqual(sellerInbox.body.data.conversations[0].title, 'Amina K.');
    assert.deepStrictEqual((await call('GET', '/unread', 'seller_1')).body.data, { messages: 1, conversations: 1 });

    assert.strictEqual((await call('GET', `/${id}`, 'stranger')).status, 404, 'strangers get a 404');
    assert.strictEqual((await call('POST', `/${id}/messages`, 'stranger', { body: 'hi' })).status, 404);
    assert.strictEqual((await call('POST', `/${id}/read`, 'stranger')).status, 404);

    const reply = await call('POST', `/${id}/messages`, 'seller_1', { body: '  Yes, available.  ', clientId: 'c_reply_00001' });
    assert.strictEqual(reply.status, 201);
    assert.strictEqual(reply.body.data.message.body, 'Yes, available.');
    assert.strictEqual((await call('POST', `/${id}/messages`, 'seller_1', { body: '   ' })).status, 400, 'an empty message is a 400');
    assert.strictEqual((await call('POST', `/${id}/messages`, 'seller_1', { body: 'x'.repeat(2001) })).status, 400);

    const thread = await call('GET', `/${id}`, 'buyer_1');
    assert.deepStrictEqual(thread.body.data.messages.map((m) => [m.body, m.mine]), [['Hello!', true], ['Yes, available.', false]]);
    const after = await call('GET', `/${id}?after=${thread.body.data.messages[0].seq}`, 'buyer_1');
    assert.deepStrictEqual(after.body.data.messages.map((m) => m.body), ['Yes, available.']);
    assert.strictEqual((await call('GET', `/${id}?after=abc`, 'buyer_1')).status, 400);

    const read = await call('POST', `/${id}/read`, 'buyer_1');
    assert.strictEqual(read.status, 200);
    assert.strictEqual(read.body.data.conversation.unread, 0);
    assert.strictEqual(sends, 6, 'opening and sending are rate-limited; reading is not');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function run() {
  console.log('  Testing in-app messaging routes...');
  await main();
  console.log('    ✓ Messaging routes: auth on every route, status codes, privacy, cursor, no-store.');
}

module.exports = { run };

if (require.main === module) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
