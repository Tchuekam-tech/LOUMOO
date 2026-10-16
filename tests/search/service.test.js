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
  let payload, lastUrl, lastHeaders;
  // Anthropic Messages API returns the parse as a forced `search_intent` tool
  // call; a leading text block is realistic and must be ignored.
  const aiReply = (input) => ({
    ok: true,
    json: async () => ({
      content: [
        { type: 'text', text: '' },
        { type: 'tool_use', name: 'search_intent', input },
      ],
    }),
  });
  const ai = new SearchAI({
    settings: { aiKey: 'test-key', aiModel: 'test-model' },
    fetcher: async (url, r) => {
      lastUrl = url;
      lastHeaders = r.headers;
      payload = JSON.parse(r.body);
      return aiReply({
        q: 'ordinateur',
        type: 'product',
        city: 'Douala',
        minPrice: null,
        maxPrice: 300000,
        message: 'Voici les résultats.',
      });
    },
  });
  const intent = await ai.intent({ message: 'Un PC' });
  assert.equal(intent.maxPrice, 300000);
  assert.equal(intent.q, 'ordinateur');
  assert.equal(lastUrl, 'https://api.anthropic.com/v1/messages');
  assert.equal(lastHeaders['x-api-key'], 'test-key');
  assert.equal(lastHeaders['anthropic-version'], '2023-06-01');
  assert.equal(payload.model, 'test-model');
  assert.equal(payload.thinking.type, 'disabled');
  assert.equal(payload.tools[0].name, 'search_intent');
  assert.equal(payload.tool_choice.name, 'search_intent');
  // A response with no usable tool call fails closed as 503, never crashes.
  await assert.rejects(
    new SearchAI({
      settings: { aiKey: 'k', aiModel: 'm' },
      fetcher: async () => ({ ok: true, json: async () => ({ content: [] }) }),
    }).intent({ message: 'x' }),
    (e) => e.statusCode === 503,
  );
  // Visual search attaches the photo as a base64 image block to the same tool.
  let visualPayload;
  const png =
    'data:image/png;base64,' +
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString(
      'base64',
    );
  await new SearchAI({
    settings: { aiKey: 'k', aiModel: 'm' },
    fetcher: async (url, r) => {
      visualPayload = JSON.parse(r.body);
      return aiReply({
        q: 'sac',
        type: 'all',
        city: '',
        minPrice: null,
        maxPrice: null,
        message: 'Objet identifié.',
      });
    },
  }).intent({ message: 'Trouve ceci', imageData: png });
  assert.equal(visualPayload.messages[0].content[1].type, 'image');
  assert.equal(
    visualPayload.messages[0].content[1].source.media_type,
    'image/png',
  );
  // Provider fallback chain: Anthropic → Gemini → Groq, auto-failover.
  const geminiReply = (obj) => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }],
    }),
  });
  const groqReply = (obj) => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(obj) } }],
    }),
  });
  // Anthropic down → Gemini answers; Gemini is sent a JSON responseSchema.
  let geminiBody;
  const chainUrls = [];
  const gemini = await new SearchAI({
    settings: {
      aiKey: 'a',
      aiModel: 'm',
      geminiKey: 'g',
      geminiModel: 'gm',
      providerOrder: ['anthropic', 'gemini', 'groq'],
    },
    fetcher: async (url, r) => {
      chainUrls.push(url);
      if (url.includes('anthropic'))
        return { ok: false, status: 500, json: async () => ({}) };
      geminiBody = JSON.parse(r.body);
      return geminiReply({
        q: 'telephone',
        type: 'product',
        city: '',
        minPrice: null,
        maxPrice: null,
        message: 'Gemini.',
      });
    },
  }).intent({ message: 'un phone' });
  assert.equal(gemini.q, 'telephone');
  assert.ok(chainUrls[0].includes('anthropic'), 'anthropic is tried first');
  assert.ok(
    chainUrls[1].includes('generativelanguage'),
    'gemini is tried next',
  );
  assert.equal(geminiBody.generationConfig.responseMimeType, 'application/json');
  // Anthropic + Gemini down → Groq answers (OpenAI-compatible json_object).
  let groqBody;
  const groq = await new SearchAI({
    settings: {
      aiKey: 'a',
      aiModel: 'm',
      geminiKey: 'g',
      geminiModel: 'gm',
      groqKey: 'q',
      groqModel: 'qm',
      providerOrder: ['anthropic', 'gemini', 'groq'],
    },
    fetcher: async (url, r) => {
      if (url.includes('groq')) {
        groqBody = JSON.parse(r.body);
        return groqReply({
          q: 'sac',
          type: 'all',
          city: '',
          minPrice: null,
          maxPrice: null,
          message: 'Groq.',
        });
      }
      return { ok: false, status: 503, json: async () => ({}) };
    },
  }).intent({ message: 'un sac' });
  assert.equal(groq.q, 'sac');
  assert.equal(groqBody.response_format.type, 'json_object');
  // Photo search skips the text-only Groq: image + only Groq ready → 503.
  await assert.rejects(
    new SearchAI({
      settings: { groqKey: 'q', groqModel: 'qm', providerOrder: ['groq'] },
      fetcher: async () => {
        throw new Error('groq must be skipped for images');
      },
    }).intent({ message: 'ceci', imageData: png }),
    (e) => e.statusCode === 503,
  );
  // "Always active": ready is true with any single provider key, false with none.
  assert.equal(
    new SearchAI({ settings: { groqKey: 'q', groqModel: 'qm' } }).ready,
    true,
  );
  assert.equal(new SearchAI({ settings: {} }).ready, false);
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
