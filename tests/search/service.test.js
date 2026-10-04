const assert = require('node:assert/strict'),
  express = require('express');
const {
  parseSearch,
} = require('../../server/modules/search/domain/SearchQuery');
const {
  SearchService,
  card,
} = require('../../server/modules/search/application/SearchService');
const {
  SearchAI,
  validateImage,
} = require('../../server/modules/search/infrastructure/SearchAI');
const {
  CombiProvider,
} = require('../../server/modules/search/infrastructure/CombiProvider');
const {
  createSearchRouter,
} = require('../../server/modules/search/presentation/searchRoutes');
const limiter = require('../../server/infrastructure/cache/RateLimitService');
module.exports = async () => {
  for (const x of [
    { q: ['x'] },
    { q: 'x'.repeat(201) },
    { page: 101 },
    { page: 1.5 },
    { verified: 'maybe' },
    { minPrice: 100, maxPrice: 10 },
    { type: 'private' },
    { limit: 500 },
  ])
    assert.throws(() => parseSearch(x));
  assert.equal(card({ price: null }).priceNumeric, null);
  assert.equal(card({ price: 0 }).priceNumeric, 0);
  assert.equal(card({ image_url: 'javascript:alert(1)' }).image, '');
  assert.throws(() => validateImage('https://internal/private'));
  assert.throws(() =>
    validateImage(
      'data:image/png;base64,' + Buffer.from('not a photo').toString('base64'),
    ),
  );
  let calls = 0,
    resolve;
  const service = new SearchService({
    db: () => ({
      rpc: () => ({
        abortSignal: () => {
          calls++;
          return new Promise((r) => {
            resolve = r;
          });
        },
      }),
    }),
  });
  const one = service.search({ q: 'laptop' }),
    two = service.search({ q: 'laptop' });
  assert.equal(calls, 1);
  resolve({ data: { items: [], total: 0, page: 1, limit: 20 } });
  await Promise.all([one, two]);
  assert.equal(service.inflight.size, 0);
  await assert.rejects(
    new SearchService({
      db: () => {
        throw new Error('SECRET');
      },
    }).search({ q: 'pc' }),
    (e) => e.statusCode === 503 && !e.message.includes('SECRET'),
  );
  let payload;
  const ai = new SearchAI({
    settings: { aiKey: 'test-key', aiModel: 'test-model' },
    fetcher: async (url, r) => {
      payload = JSON.parse(r.body);
      return {
        ok: true,
        json: async () => ({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    q: 'ordinateur',
                    type: 'product',
                    city: 'Douala',
                    minPrice: null,
                    maxPrice: 300000,
                    message: 'Voici les résultats.',
                  }),
                },
              ],
            },
          ],
        }),
      };
    },
  });
  assert.equal((await ai.intent({ message: 'Un PC' })).maxPrice, 300000);
  assert.equal(payload.store, false);
  assert.equal(payload.text.format.strict, true);
  const voice = new CombiProvider({
    settings: { apiKey: 'test-private', agentId: 'test-agent' },
    fetcher: async (url, r) => {
      assert.equal(r.headers['xi-api-key'], 'test-private');
      return {
        ok: true,
        json: async () => ({
          signed_url: 'wss://api.elevenlabs.io/session?token=test',
        }),
      };
    },
  });
  assert.deepEqual(Object.keys(await voice.session()).sort(), [
    'name',
    'signedUrl',
  ]);
  await assert.rejects(
    new CombiProvider({
      settings: { apiKey: 'x', agentId: 'x' },
      fetcher: async () => ({
        ok: true,
        json: async () => ({ signed_url: 'wss://evil.example' }),
      }),
    }).session(),
    (e) => e.statusCode === 503,
  );
  const strict = new limiter.RateLimitService();
  strict.redis = null;
  await assert.rejects(
    strict.consume('paid', 10, 60, true),
    (e) => e.statusCode === 503,
  );
  strict.redis = {
    status: 'ready',
    multi() {
      throw new Error('Down');
    },
  };
  await assert.rejects(
    strict.consume('paid', 10, 60, true),
    (e) => e.statusCode === 503,
  );
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  const fake = {
      search: async (raw) => {
        const q = parseSearch(raw);
        return { items: [], total: 0, page: q.page, limit: q.limit };
      },
    },
    auth = (req, res, next) => {
      req.userId = 'search-fixture';
      next();
    };
  app.use(
    '/public',
    createSearchRouter({
      service: fake,
      ai,
      voice,
      settings: { enabled: true },
      production: false,
    }),
  );
  app.use(
    '/member',
    createSearchRouter({
      service: fake,
      ai,
      voice,
      settings: { enabled: true },
      production: false,
      authenticate: auth,
    }),
  );
  app.use(
    '/production',
    createSearchRouter({
      service: fake,
      ai,
      voice,
      settings: { enabled: true },
      production: true,
      authenticate: auth,
    }),
  );
  app.use(
    '/disabled',
    createSearchRouter({
      service: fake,
      ai,
      voice,
      settings: { enabled: false },
      production: false,
    }),
  );
  app.use((e, req, res, next) =>
    res.status(e.statusCode || 500).json({ error: { message: e.message } }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await fetch(base + '/public?q=pc');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    for (const [url, method, status] of [
      ['/public?minPrice=-1', 'GET', 400],
      ['/disabled', 'GET', 503],
      ['/public/assistant', 'POST', 401],
      ['/public/voice/session', 'POST', 401],
      ['/member/voice/session', 'POST', 200],
      ['/production/voice/session', 'POST', 503],
    ])
      assert.equal((await fetch(base + url, { method })).status, status, url);
    assert.equal(
      (
        await fetch(base + '/member/visual', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + '/member/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'PC' }),
        })
      ).status,
      200,
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
  console.log(
    'PASS service: validation, provider contracts, authentication, Redis failure and HTTP routes',
  );
};
