const assert = require('node:assert/strict'),
  Search = require('../../src/services/searchExperience');
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const tick = () => new Promise((r) => setImmediate(r));
module.exports = async () => {
  const requests = [],
    selected = [],
    caps = { text: true, voice: true, assistant: false, visual: false };
  const api = {
    searchCapabilities: async () => caps,
    search: async (params, signal) => {
      const d = deferred();
      requests.push({ ...d, params, signal });
      return d.promise;
    },
    suggestSearch: async () => ({
      suggestions: [
        {
          id: 'hotel',
          label: 'Hotel Soleil',
          type: 'hotel',
          item: { id: 'hotel', entityType: 'hotel' },
        },
      ],
    }),
  };
  const c = new Search({ api, openItem: (i) => selected.push(i) });
  await c.capabilities();
  c.input('older');
  const old = c.search();
  await tick();
  c.input('newer');
  const newer = c.search();
  await tick();
  assert.equal(requests[0].signal.aborted, true);
  requests[1].resolve({ items: [{ id: 'new' }], total: 1, hasMore: false });
  await newer;
  requests[0].resolve({ items: [{ id: 'old' }], total: 1, hasMore: false });
  await old;
  assert.equal(c.d.items[0].id, 'new');
  c.input('hotel');
  await c.suggest();
  c.key({ key: 'ArrowDown', preventDefault() {} });
  c.key({ key: 'Enter', preventDefault() {} });
  assert.equal(selected[0].entityType, 'hotel');
  assert.equal(c.d.recent.length, 1);
  c.clearRecent();
  assert.equal(c.d.recent.length, 0);
  c.input('hotel');
  await c.suggest();
  c.view().searchCompositionStart();
  c.input('h');
  assert.equal(c.d.open, false);
  c.view().searchCompositionEnd({ target: { value: 'hotel' } });
  clearTimeout(c.timer);
  const stale = c.search();
  await tick();
  const last = requests.at(-1);
  c.filter('city', 'Douala');
  last.resolve({ items: [{ id: 'wrong-city' }] });
  await stale;
  assert.equal(c.d.items, null);
  c.destroy();
  const start = deferred();
  let ended = 0,
    options;
  const v = new Search({
    api: {
      ...api,
      startCombiSession: async () => ({
        signedUrl: 'wss://api.elevenlabs.io/test',
      }),
    },
    loadConversation: async () => ({
      Conversation: {
        startSession: async (opts) => {
          options = opts;
          return start.promise;
        },
      },
    }),
  });
  const opening = v.startVoice(true);
  await tick();
  assert.equal(options.textOnly, true);
  await v.stopVoice();
  start.resolve({
    endSession: async () => {
      ended++;
    },
  });
  await opening;
  assert.equal(ended, 1);
  v.destroy();
  let sent;
  const t = new Search({
    api: {
      ...api,
      startCombiSession: async () => ({
        signedUrl: 'wss://api.elevenlabs.io/test',
      }),
    },
    loadConversation: async () => ({
      Conversation: {
        startSession: async () => ({
          sendUserMessage: (x) => {
            sent = x;
          },
          endSession: async () => {},
        }),
      },
    }),
  });
  t.d.input = 'Find a PC';
  await t.ask();
  assert.equal(sent, 'Find a PC');
  t.enter('home');
  assert.equal(t.conversation, null);
  t.destroy();
  let fallbackCalls = 0;
  const fallback = new Search({
    api: {
      searchCapabilities: async () => ({ text: false }),
      searchProducts: async () => {
        fallbackCalls++;
        return { items: [], total: 0 };
      },
    },
  });
  await fallback.search();
  assert.equal(fallbackCalls, 1);
  fallback.destroy();
  console.log(
    'PASS controller: cancellation, stale responses, keyboard, IME, filters, history and session cleanup',
  );
};
