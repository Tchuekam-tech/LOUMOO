/**
 * LOUMOO Unit Tests - Rider presence, the rider's side (browser module)
 * ---------------------------------------------------------------------------
 * src/services/riderPresence.js is loaded by the browser, but its logic needs no
 * DOM and runs here in Node with every side effect injected: a fake delivery API
 * that behaves like the server (it never lets a heartbeat raise anyone), fake
 * timers, a manual clock, a fake `document` and a fake geolocation permission.
 *
 * What is pinned:
 *   - the heartbeat timer exists ONLY while the server says online or busy, at
 *     the server's interval (clamped), and is gone after stop();
 *   - never two requests in flight, whatever the timer, the page and the rider do;
 *   - a beat never raises the state; the server saying offline / paused stops it,
 *     and "the app stopped responding" is surfaced;
 *   - a network error keeps the timer and does not flip the state by guess;
 *     401 / 403 stop everything;
 *   - the timer never asks for a position unless the permission is already
 *     granted, so it can never raise a browser prompt;
 *   - no request ever carries a status or a rider id, even through the real
 *     delivery API client;
 *   - a request that never answers (a stalled mobile connection) times out and
 *     does not freeze every beat and tap queued behind it.
 *
 * Then the screens that use it, run for real (riderHub.js and sellerDispatch.js with
 * the real dispatchUi.js helpers, in a vm context over a small fake DOM): the
 * availability card for each state, hints on offers, the refusal toast, the
 * heartbeat outliving the overlay, and the seller's rider picker. The banner comment
 * before the screen tests says what that fake DOM does and does not prove.
 */

require('../setup');
const assert = require('assert');
const { DeliveryApiClient } = require('../../src/services/deliveryApi.js');
const P = require('../../src/services/riderPresence.js');

// Let promise chains run to completion (no timers involved).
const turn = () => new Promise((resolve) => setImmediate(resolve));
async function settle(n = 8) { for (let i = 0; i < n; i += 1) await turn(); }

function deferred() {
  const d = {};
  d.promise = new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject; });
  return d;
}

function httpError(status, code, message) {
  const err = new Error(message || `HTTP ${status}`);
  err.status = status;
  err.code = code || null;
  return err;
}

/** A server answer for tests that settle a held request by hand. */
const res = (status) => ({
  presence: {
    status, available: status === 'online', reason: status === 'online' ? null : status,
    heartbeatIntervalMs: 30000, ttlSeconds: 120, lastSeenAt: '2026-10-05T08:00:00.000Z', location: null
  }
});

const PRESENCE_CALLS = ['riderPresence', 'riderOnline', 'riderOffline', 'riderPause', 'riderResume', 'riderHeartbeat'];

/**
 * A rider's world: a fake server, fake timers, a fake document and a controller
 * wired to them. `w.server.status` is what the SERVER believes; the controller only
 * ever learns it from an answer.
 */
function makeWorld(options = {}) {
  const o = { permission: 'prompt', intervalMs: 30000, withLocate: true, ...options };
  const w = {
    clock: Date.parse('2026-10-05T08:00:00Z'),
    server: { status: 'offline', reason: 'offline', intervalMs: o.intervalMs },
    permission: o.permission,            // what the browser says; 'throw' makes the query fail
    calls: [],
    overrides: {},
    inFlight: 0,
    maxInFlight: 0,
    intervals: new Map(),                // handle -> { fn, ms }
    timeouts: new Map(),                 // handle -> { fn, ms }
    nextHandle: 1,
    listeners: [],                       // visibilitychange handlers currently attached
    docAdds: 0,
    docRemoves: 0,
    visible: true,
    locateCalls: [],
    locateImpl: null,
    changes: []
  };

  const live = () => w.server.status === 'online' || w.server.status === 'busy';

  /** A presence object as the server would send it, for the server's current state. */
  w.snap = (status, extra = {}) => {
    const st = status === undefined ? w.server.status : status;
    return {
      status: st,
      available: st === 'online',
      reason: st === 'online' ? null : st === 'offline' ? (w.server.reason || 'offline') : st,
      lastSeenAt: new Date(w.clock).toISOString(),
      expiresAt: st === 'online' || st === 'busy' ? new Date(w.clock + 120000).toISOString() : null,
      ttlSeconds: 120,
      heartbeatIntervalMs: w.server.intervalMs,
      location: null,
      updatedAt: new Date(w.clock).toISOString(),
      ...extra
    };
  };
  const res = (status, extra) => ({ presence: w.snap(status, extra) });

  function serverDo(name) {
    const s = w.server;
    switch (name) {
      case 'riderPresence': return res();
      case 'riderOnline':
        if (s.status === 'suspended') throw httpError(403, 'PERMISSION_DENIED', 'Your rider account is not active.');
        if (s.status !== 'busy') { s.status = 'online'; s.reason = null; }
        return res();
      case 'riderOffline':
        if (s.status === 'busy') throw httpError(409, 'RIDER_BUSY', 'Finish your current delivery before going offline.');
        s.status = 'offline'; s.reason = 'offline';
        return res();
      case 'riderPause':
        if (s.status === 'busy') throw httpError(409, 'RIDER_BUSY', 'Finish your current delivery before pausing.');
        if (s.status !== 'online') throw httpError(409, 'RIDER_UNAVAILABLE', 'You can only pause while online.');
        s.status = 'paused';
        return res();
      case 'riderResume':
        if (s.status !== 'paused' && s.status !== 'online') throw httpError(409, 'RIDER_UNAVAILABLE', 'You are not paused.');
        s.status = 'online';
        return res();
      case 'riderHeartbeat': // the server never raises anyone on a beat
        return res();
      default: throw new Error('unexpected ' + name);
    }
  }

  function respond(name, args) {
    w.calls.push({ name, args });
    w.inFlight += 1;
    w.maxInFlight = Math.max(w.maxInFlight, w.inFlight);
    const q = w.overrides[name];
    const p = Promise.resolve().then(() => (q && q.length ? q.shift()(args) : serverDo(name, args)));
    const done = () => { w.inFlight -= 1; };
    p.then(done, done);
    return p;
  }
  /** Both sides agree: the server is in this state and the controller has been told. */
  w.adoptAs = (status) => { w.server.status = status; w.server.reason = status === 'offline' ? 'offline' : null; return w.ctl.adopt(w.snap(status)); };
  w.api = {};
  PRESENCE_CALLS.forEach((name) => { w.api[name] = (...args) => respond(name, args); });

  w.hold = (name) => {
    const d = deferred();
    (w.overrides[name] = w.overrides[name] || []).push(() => d.promise);
    return d;
  };
  w.failNext = (name, err) => { (w.overrides[name] = w.overrides[name] || []).push(() => { throw err; }); };
  w.count = (name) => w.calls.filter((c) => c.name === name).length;
  w.names = () => w.calls.map((c) => c.name);

  w.doc = {
    get hidden() { return !w.visible; },
    addEventListener(type, fn) { assert.strictEqual(type, 'visibilitychange'); w.listeners.push(fn); w.docAdds += 1; },
    removeEventListener(type, fn) { assert.strictEqual(type, 'visibilitychange'); w.listeners = w.listeners.filter((f) => f !== fn); w.docRemoves += 1; }
  };
  w.setVisible = async (v) => { w.visible = v; w.listeners.slice().forEach((fn) => fn()); await settle(); };

  w.timers = () => w.intervals.size;
  w.intervalMs = () => Array.from(w.intervals.values()).map((t) => t.ms);
  /** One tick of every running interval timer. */
  w.fire = async () => { Array.from(w.intervals.values()).forEach((t) => t.fn()); await settle(); };
  /** Everything a leak would leave behind. */
  w.leaks = () => ({ intervals: w.intervals.size, timeouts: w.timeouts.size, listeners: w.listeners.length });

  w.ctl = P.createPresenceController({
    api: w.api,
    locate: o.withLocate ? (opts) => {
      w.locateCalls.push(opts);
      return w.locateImpl ? w.locateImpl() : Promise.resolve({ lat: 4.0511, lng: 9.7679, accuracyM: 12 });
    } : undefined,
    permission: () => { if (w.permission === 'throw') throw new Error('permissions API broke'); return w.permission; },
    setIntervalFn: (fn, ms) => { const h = w.nextHandle++; w.intervals.set(h, { fn, ms }); return h; },
    clearIntervalFn: (h) => { w.intervals.delete(h); },
    setTimeoutFn: (fn, ms) => { const h = w.nextHandle++; w.timeouts.set(h, { fn, ms }); return h; },
    clearTimeoutFn: (h) => { w.timeouts.delete(h); },
    now: () => w.clock,
    isVisible: () => w.visible,
    doc: w.doc,
    onChange: (state) => w.changes.push(state)
  });
  return w;
}

const state = (w) => w.ctl.getState();
const sentArg = (call) => call.args[0];

// --------------------------------------------------------------------------- tests

async function testNoTimerWhileOfflineOrPaused() {
  const w = makeWorld();
  w.ctl.start();
  assert.strictEqual(w.timers(), 0, 'nothing is known yet: no timer');
  assert.strictEqual(state(w).status, 'unknown');

  assert.strictEqual(w.ctl.adopt(w.snap('offline')), true);
  assert.strictEqual(state(w).status, 'offline');
  assert.strictEqual(w.timers(), 0, 'offline: no timer');
  assert.strictEqual(w.listeners.length, 0, 'offline: no visibility listener either');

  w.adoptAs('paused');
  assert.strictEqual(state(w).status, 'paused');
  assert.strictEqual(w.timers(), 0, 'paused: no timer');

  w.ctl.adopt(w.snap('suspended'));
  assert.strictEqual(state(w).status, 'suspended');
  assert.strictEqual(w.timers(), 0, 'suspended: no timer');

  await w.fire();
  assert.strictEqual(w.calls.length, 0, 'with no timer there is no traffic at all');
}

async function testTimerStartsOnlineAtTheServersInterval() {
  const w = makeWorld({ intervalMs: 20000 });
  w.ctl.start();
  await w.ctl.goOnline();
  assert.strictEqual(state(w).status, 'online');
  assert.strictEqual(w.timers(), 1, 'online: exactly one timer');
  assert.deepStrictEqual(w.intervalMs(), [20000], 'the interval is the server\'s');
  assert.strictEqual(w.listeners.length, 1, 'online: the page-visible listener is attached');

  // Clamped to 10 s .. 60 s; 30 s when the server says nothing usable.
  const cases = [[5000, 10000], [10000, 10000], [45000, 45000], [120000, 60000], [undefined, 30000], [0, 30000], ['soon', 30000], [-5, 30000]];
  for (const [given, expected] of cases) {
    const x = makeWorld();
    x.ctl.start();
    x.ctl.adopt(x.snap('online', { heartbeatIntervalMs: given }));
    assert.deepStrictEqual(x.intervalMs(), [expected], `server says ${given}: the timer runs every ${expected} ms`);
    x.ctl.stop();
  }
  assert.strictEqual(P.clampHeartbeatInterval(1), 10000);
  assert.strictEqual(P.clampHeartbeatInterval(1e9), 60000);

  // The server changing its mind mid-run re-arms the single timer.
  const y = makeWorld({ intervalMs: 20000 });
  y.server.status = 'online';
  y.ctl.start();
  y.adoptAs('online');
  y.server.intervalMs = 45000;
  await y.fire();
  assert.deepStrictEqual(y.intervalMs(), [45000], 'the new interval replaced the old timer, not added to it');
  assert.strictEqual(y.timers(), 1);

  // Busy needs the heartbeat too (the rider is still here).
  const z = makeWorld();
  z.ctl.start();
  z.adoptAs('busy');
  assert.strictEqual(z.timers(), 1, 'busy keeps the timer running');
  await z.fire();
  assert.strictEqual(z.count('riderHeartbeat'), 1);
}

async function testTimerOnlyArmedByStart() {
  const w = makeWorld();
  w.adoptAs('online');
  assert.strictEqual(state(w).status, 'online', 'the snapshot is taken');
  assert.strictEqual(w.timers(), 0, 'but nothing beats until the controller is started');
  w.ctl.start();
  assert.strictEqual(w.timers(), 1, 'start() arms a timer for a state that is already online');
  w.ctl.stop();
  assert.strictEqual(w.timers(), 0);
}

async function testBeatReportingOfflineStopsTheTimer() {
  // The server dropped the rider (silent too long): the beat finds out.
  const w = makeWorld();
  w.ctl.start();
  await w.ctl.goOnline();
  assert.strictEqual(w.timers(), 1);
  w.server.status = 'offline';
  w.server.reason = 'expired';
  await w.fire();
  assert.strictEqual(w.count('riderHeartbeat'), 1);
  assert.strictEqual(state(w).status, 'offline', 'the state follows the server');
  assert.strictEqual(state(w).expired, true, 'the "stopped responding" reason is surfaced');
  assert.strictEqual(state(w).reason, 'expired');
  assert.strictEqual(w.timers(), 0, 'the timer stopped');
  assert.strictEqual(w.listeners.length, 0, 'and its listener went with it');
  await w.fire();
  assert.strictEqual(w.count('riderHeartbeat'), 1, 'no more beats once offline');

  // The sweeper may have set them offline first: the server's reason is plain "offline"
  // by the time their app wakes up, but they did not ask for it, so it is still "expired".
  const s = makeWorld();
  s.ctl.start();
  await s.ctl.goOnline();
  s.server.status = 'offline';
  s.server.reason = 'offline';
  await s.fire();
  assert.strictEqual(state(s).status, 'offline');
  assert.strictEqual(state(s).expired, true, 'an offline the rider did not ask for reads as the app having stopped responding');

  // Paused and suspended also stop it, without calling it "expired".
  for (const status of ['paused', 'suspended']) {
    const x = makeWorld();
    x.ctl.start();
    await x.ctl.goOnline();
    x.server.status = status;
    await x.fire();
    assert.strictEqual(state(x).status, status, `server says ${status}`);
    assert.strictEqual(state(x).expired, false);
    assert.strictEqual(x.timers(), 0, `${status}: the timer stopped`);
  }
}

async function testAnExpiredReasonSurvivesRefreshesUntilTheRiderActs() {
  const w = makeWorld();
  w.ctl.start();
  await w.ctl.goOnline();
  w.server.status = 'offline';
  w.server.reason = 'expired';
  await w.fire();
  assert.strictEqual(state(w).expired, true);
  // The 15 s overview refresh comes back as plain "offline" (the row was already put right).
  w.server.reason = 'offline';
  await w.ctl.refresh();
  assert.strictEqual(state(w).expired, true, 'a refresh does not wipe the explanation');
  assert.strictEqual(P.describeAvailability(state(w)).text, 'You went offline because the app stopped responding.');
  // Going online clears it; going offline on purpose does not bring it back.
  await w.ctl.goOnline();
  assert.strictEqual(state(w).expired, false);
  assert.strictEqual(state(w).status, 'online');
  await w.ctl.goOffline();
  await w.ctl.refresh();
  assert.strictEqual(state(w).expired, false, 'an offline the rider chose is not "expired"');
  assert.strictEqual(P.describeAvailability(state(w)).text, 'Go online to receive new delivery offers.');
}

async function testABeatNeverRaisesTheState() {
  // Rider taps "Go offline" while a beat is in flight. The beat's (older) answer says
  // online, but the offline request is sent after it and wins; nothing flips back.
  const w = makeWorld();
  w.ctl.start();
  await w.ctl.goOnline();
  const beat = w.hold('riderHeartbeat');
  await w.fire();
  assert.strictEqual(w.count('riderHeartbeat'), 1);
  const off = w.ctl.goOffline();
  await settle();
  assert.strictEqual(w.count('riderOffline'), 0, 'the offline request waits for the beat in flight');
  beat.resolve(res('online'));
  await off;
  assert.strictEqual(state(w).status, 'offline');
  assert.strictEqual(w.timers(), 0);
  const seen = w.changes.map((c) => c.status);
  assert.strictEqual(seen[seen.length - 1], 'offline');
  assert.ok(seen.lastIndexOf('online') < seen.lastIndexOf('offline'), 'the state never went back to online after offline: ' + seen.join(','));
  assert.deepStrictEqual(w.names().slice(-2), ['riderHeartbeat', 'riderOffline'], 'strict order');
  assert.strictEqual(w.maxInFlight, 1);

  // A rider who is paused is not brought back by a straggling "online" beat answer
  // (the controller refuses to raise the state from a beat).
  const p = makeWorld();
  p.ctl.start();
  await p.ctl.goOnline();
  const late = p.hold('riderHeartbeat');
  await p.fire();
  const pause = p.ctl.pause();
  await settle();
  late.resolve(res('online'));
  await pause;
  assert.strictEqual(state(p).status, 'paused');
  assert.strictEqual(p.timers(), 0);
}

async function testNeverTwoRequestsInFlight() {
  const w = makeWorld();
  w.ctl.start();
  await w.ctl.goOnline();
  const first = w.hold('riderHeartbeat');
  await w.fire();
  await w.fire();
  await w.fire();
  assert.strictEqual(w.count('riderHeartbeat'), 1, 'three ticks while a beat is in flight send one request');
  first.resolve(res('online'));
  await settle();
  await w.fire();
  assert.strictEqual(w.count('riderHeartbeat'), 2, 'the next tick after the answer beats again');

  // Page becoming visible while a beat is in flight does not add a second one.
  const second = w.hold('riderHeartbeat');
  await w.fire();
  assert.strictEqual(w.count('riderHeartbeat'), 3);
  await w.setVisible(false);
  await w.setVisible(true);
  assert.strictEqual(w.count('riderHeartbeat'), 3, 'visible-again while a beat is in flight sends nothing');
  second.resolve(res('online'));
  await settle();

  // Actions queue behind each other and behind a beat: strictly one at a time.
  const slowOnline = w.hold('riderOnline');
  const a = w.ctl.goOnline();
  const b = w.ctl.goOffline();
  const c = w.ctl.goOnline();
  await settle();
  assert.strictEqual(w.count('riderOffline'), 0, 'the second action waits for the first');
  slowOnline.resolve(res('online'));
  await Promise.all([a, b, c]);
  assert.strictEqual(w.maxInFlight, 1, 'at no moment were two requests in flight');
  assert.strictEqual(state(w).status, 'online', 'the last action asked for online');
  assert.deepStrictEqual(w.names().slice(-3), ['riderOnline', 'riderOffline', 'riderOnline']);
}

async function testVisibleAgainBeatsAtOnce() {
  const w = makeWorld();
  w.ctl.start();
  await w.ctl.goOnline();
  assert.strictEqual(w.count('riderHeartbeat'), 0);
  await w.setVisible(false);
  assert.strictEqual(w.count('riderHeartbeat'), 0, 'going to the background beats nothing');
  await w.setVisible(true);
  assert.strictEqual(w.count('riderHeartbeat'), 1, 'coming back beats immediately, without waiting for the timer');
  assert.strictEqual(w.timers(), 1, 'and the timer was not touched');

  // Busy riders do too; offline and paused ones have no listener, so nothing happens.
  const p = makeWorld();
  p.ctl.start();
  await p.ctl.goOnline();
  await p.ctl.pause();
  assert.strictEqual(p.listeners.length, 0);
  await p.setVisible(false);
  await p.setVisible(true);
  assert.strictEqual(p.count('riderHeartbeat'), 0, 'a paused rider is not woken by the page becoming visible');
}

async function testAuthErrorsStopEverything() {
  for (const status of [401, 403]) {
    const w = makeWorld();
    w.ctl.start();
    await w.ctl.goOnline();
    assert.strictEqual(w.timers(), 1);
    w.failNext('riderHeartbeat', httpError(status, status === 401 ? 'UNAUTHENTICATED' : 'PERMISSION_DENIED', 'no'));
    await w.fire();
    assert.strictEqual(state(w).denied && state(w).denied.status, status, `${status} is recorded`);
    assert.strictEqual(state(w).status, 'unknown', 'the controller no longer claims to know the status');
    assert.strictEqual(state(w).known, false);
    assert.deepStrictEqual(w.leaks(), { intervals: 0, timeouts: 0, listeners: 0 }, `${status} stops the timer and the listener`);
    await w.fire();
    assert.strictEqual(w.count('riderHeartbeat'), 1, 'and nothing beats afterwards');

    // The hub reopening (start + a fresh overview) recovers, because the account may have been fixed.
    w.ctl.start();
    w.adoptAs('online');
    assert.strictEqual(state(w).denied, null);
    assert.strictEqual(w.timers(), 1, 'a good snapshot after start() re-arms the heartbeat');
  }

  // The same from a deliberate action: it rejects with the error and stops everything.
  const a = makeWorld();
  a.ctl.start();
  a.failNext('riderOnline', httpError(403, 'PERMISSION_DENIED', 'You are not a registered rider.'));
  await assert.rejects(a.ctl.goOnline(), (err) => err.status === 403 && /not a registered rider/.test(err.message));
  assert.strictEqual(state(a).denied.status, 403);
  assert.strictEqual(a.timers(), 0);
  assert.strictEqual(state(a).pending, null, 'the pending flag is released');

  // And from a refresh.
  const r = makeWorld();
  r.ctl.start();
  r.failNext('riderPresence', httpError(401, 'UNAUTHENTICATED', 'Sign in'));
  await r.ctl.refresh();
  assert.strictEqual(state(r).denied.status, 401);
}

async function testNetworkErrorsKeepTheTimerAndGuessNothing() {
  const failures = [new Error('Failed to fetch'), httpError(500, 'INTERNAL', 'boom'), httpError(502, null, 'bad gateway'), httpError(429, 'RATE_LIMITED', 'slow down')];
  for (const failure of failures) {
    const w = makeWorld();
    w.ctl.start();
    await w.ctl.goOnline();
    w.failNext('riderHeartbeat', failure);
    w.clock += 10 * 60 * 1000; // far past any TTL on the rider's own clock: still no guessing
    await w.fire();
    assert.strictEqual(state(w).status, 'online', `${failure.message}: the state is not flipped by guess`);
    assert.strictEqual(state(w).available, true);
    assert.strictEqual(state(w).trouble, true, 'the trouble is flagged so the screen can say so');
    assert.strictEqual(state(w).denied, null);
    assert.strictEqual(w.timers(), 1, 'the timer keeps running');
    await w.fire();
    assert.strictEqual(w.count('riderHeartbeat'), 2, 'the next tick retries');
    assert.strictEqual(state(w).trouble, false, 'and the answer clears the flag');
    assert.strictEqual(state(w).status, 'online');
  }

  // Busy riders too.
  const b = makeWorld();
  b.ctl.start();
  b.adoptAs('busy');
  b.failNext('riderHeartbeat', new Error('offline'));
  await b.fire();
  assert.strictEqual(state(b).status, 'busy');
  assert.strictEqual(b.timers(), 1);

  // An action that fails to get through changes nothing.
  const a = makeWorld();
  a.ctl.start();
  await a.ctl.goOnline();
  a.failNext('riderPause', new Error('Failed to fetch'));
  await assert.rejects(a.ctl.pause(), /Failed to fetch/);
  assert.strictEqual(state(a).status, 'online', 'a pause that never arrived did not pause anyone');
  assert.strictEqual(a.timers(), 1);
  assert.strictEqual(state(a).pending, null);

  // A 200 with no usable presence is trouble, not a state.
  const u = makeWorld();
  u.ctl.start();
  await u.ctl.goOnline();
  (u.overrides.riderHeartbeat = []).push(() => ({}));
  await u.fire();
  assert.strictEqual(state(u).status, 'online');
  assert.strictEqual(state(u).trouble, true);
  (u.overrides.riderHeartbeat = []).push(() => ({ presence: { status: 'ecstatic' } }));
  await u.fire();
  assert.strictEqual(state(u).status, 'online', 'an unknown status from the server is not adopted');
}

async function testTheTimerNeverAsksForAPositionWithoutPermission() {
  for (const permission of ['prompt', 'denied', 'unsupported', 'throw', undefined]) {
    const w = makeWorld({ permission });
    w.ctl.start();
    w.adoptAs('online');
    await w.fire();
    await w.fire();
    await w.setVisible(false);
    await w.setVisible(true);
    assert.strictEqual(w.locateCalls.length, 0, `permission ${permission}: the timer never calls locate()`);
    const beats = w.calls.filter((c) => c.name === 'riderHeartbeat');
    assert.ok(beats.length >= 3, 'it still beats');
    beats.forEach((b) => assert.ok(sentArg(b) == null, `permission ${permission}: the heartbeat carries no position`));
    assert.strictEqual(state(w).trouble, false, 'no position is not an error');
  }

  // Granted: it may, and the position rides on the beat.
  const g = makeWorld({ permission: 'granted' });
  g.ctl.start();
  g.adoptAs('online');
  await g.fire();
  assert.strictEqual(g.locateCalls.length, 1, 'granted: the timer asks for a position');
  assert.deepStrictEqual(sentArg(g.calls[0]), { lat: 4.0511, lng: 9.7679, accuracyM: 12 });
  assert.strictEqual(g.timeouts.size, 0, 'and the timeout guard is released');

  // A tap on Go online is a user gesture: a prompt is acceptable (unless the browser already said no).
  for (const [permission, expectedCalls] of [['prompt', 1], ['granted', 1], ['unsupported', 1], ['denied', 0]]) {
    const w = makeWorld({ permission });
    w.ctl.start();
    await w.ctl.goOnline();
    assert.strictEqual(w.locateCalls.length, expectedCalls, `Go online with permission ${permission}`);
    assert.strictEqual(w.calls[0].name, 'riderOnline');
    if (expectedCalls) assert.deepStrictEqual(sentArg(w.calls[0]), { lat: 4.0511, lng: 9.7679, accuracyM: 12 });
    else assert.ok(sentArg(w.calls[0]) == null);
  }
  const r = makeWorld({ permission: 'prompt' });
  r.ctl.start();
  r.adoptAs('paused');
  await r.ctl.resume();
  assert.strictEqual(r.locateCalls.length, 1, 'Resume is a tap too');
  assert.deepStrictEqual(sentArg(r.calls[0]), { lat: 4.0511, lng: 9.7679, accuracyM: 12 });
  // Pause and Go offline have no use for a position.
  const o = makeWorld({ permission: 'granted' });
  o.ctl.start();
  await o.ctl.goOnline();
  const before = o.locateCalls.length;
  await o.ctl.pause();
  await o.ctl.resume();
  await o.ctl.goOffline();
  assert.strictEqual(o.locateCalls.length, before + 1, 'only Resume asked (pause and offline did not)');
  assert.strictEqual(o.calls.find((c) => c.name === 'riderPause').args.length, 0);
  assert.strictEqual(o.calls.find((c) => c.name === 'riderOffline').args.length, 0);

  // No locate() at all (no geolocation on this device): everything still works.
  const n = makeWorld({ withLocate: false, permission: 'granted' });
  n.ctl.start();
  await n.ctl.goOnline();
  await n.fire();
  assert.strictEqual(state(n).status, 'online');
  assert.ok(sentArg(n.calls[1]) == null);
}

async function testALocationFailureMeansNoPositionNeverAnError() {
  // locate() rejects.
  const w = makeWorld({ permission: 'granted' });
  w.locateImpl = () => Promise.reject(new Error('position unavailable'));
  w.ctl.start();
  await w.ctl.goOnline();
  assert.strictEqual(state(w).status, 'online', 'Go online works without a position');
  await w.fire();
  assert.strictEqual(w.count('riderHeartbeat'), 1);
  assert.ok(sentArg(w.calls[w.calls.length - 1]) == null);
  assert.strictEqual(state(w).trouble, false);

  // locate() throws synchronously.
  const t = makeWorld({ permission: 'granted' });
  t.locateImpl = () => { throw new Error('boom'); };
  t.ctl.start();
  t.adoptAs('online');
  await t.fire();
  assert.strictEqual(t.count('riderHeartbeat'), 1);

  // locate() never answers: a short timeout, then the beat goes without a position.
  const h = makeWorld({ permission: 'granted' });
  h.locateImpl = () => new Promise(() => {});
  h.ctl.start();
  h.adoptAs('online');
  await h.fire();
  assert.strictEqual(h.count('riderHeartbeat'), 0, 'the beat is waiting for the position...');
  assert.strictEqual(h.timeouts.size, 1);
  assert.strictEqual(Array.from(h.timeouts.values())[0].ms, P.LOCATE_TIMEOUT_MS, '...but only for a short, fixed time');
  assert.ok(P.LOCATE_TIMEOUT_MS <= 5000, 'short');
  const [handle, timeout] = Array.from(h.timeouts.entries())[0];
  h.timeouts.delete(handle); // a timer that has fired is gone, as a real one is
  timeout.fn();
  await settle();
  assert.strictEqual(h.count('riderHeartbeat'), 1, 'the timeout let the beat go');
  assert.ok(sentArg(h.calls[0]) == null, 'without a position');
  assert.strictEqual(h.timeouts.size, 0, 'and the guard is released');

  // Junk positions never reach the API.
  const junk = [{ lat: NaN, lng: 9 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: '4', lng: '9' }, null, undefined, {}, { lat: Infinity, lng: 1 }];
  for (const bad of junk) {
    const j = makeWorld({ permission: 'granted' });
    j.locateImpl = () => Promise.resolve(bad);
    j.ctl.start();
    j.adoptAs('online');
    await j.fire();
    assert.ok(sentArg(j.calls[0]) == null, 'a bad position is dropped: ' + JSON.stringify(bad));
  }
  // A bad accuracy is dropped but the position kept.
  const k = makeWorld({ permission: 'granted' });
  k.locateImpl = () => Promise.resolve({ lat: 4.05, lng: 9.7, accuracyM: -3 });
  k.ctl.start();
  k.adoptAs('online');
  await k.fire();
  assert.deepStrictEqual(sentArg(k.calls[0]), { lat: 4.05, lng: 9.7 });

  // A rider who taps Go offline while the beat is still waiting for a position:
  // the beat gives way, no heartbeat goes out after the rider asked to leave.
  const g = makeWorld({ permission: 'granted' });
  const slow = deferred();
  g.locateImpl = () => slow.promise;
  g.ctl.start();
  g.adoptAs('online');
  await g.fire();
  const off = g.ctl.goOffline();
  slow.resolve({ lat: 4.05, lng: 9.7 });
  await off;
  assert.strictEqual(g.count('riderHeartbeat'), 0, 'the beat that was waiting for a position was dropped');
  assert.strictEqual(state(g).status, 'offline');
}

async function testStartStopAreIdempotentAndLeakFree() {
  const w = makeWorld();
  w.ctl.start();
  w.ctl.start();
  w.ctl.start();
  w.adoptAs('online');
  w.ctl.start();
  assert.strictEqual(w.timers(), 1, 'start() any number of times leaves one timer');
  assert.strictEqual(w.listeners.length, 1, 'and one listener');
  assert.strictEqual(w.docAdds, 1);

  w.adoptAs('online'); // the same snapshot again must not stack timers either
  assert.strictEqual(w.timers(), 1);

  w.ctl.stop();
  assert.deepStrictEqual(w.leaks(), { intervals: 0, timeouts: 0, listeners: 0 }, 'stop() leaves nothing behind');
  assert.strictEqual(w.docAdds, w.docRemoves, 'every listener added was removed');
  w.ctl.stop();
  w.ctl.stop();
  assert.deepStrictEqual(w.leaks(), { intervals: 0, timeouts: 0, listeners: 0 });
  assert.strictEqual(state(w).status, 'online', 'stopping the heartbeat does not pretend to change the rider\'s status');

  // After stop() nothing re-arms until start().
  w.adoptAs('online');
  assert.strictEqual(w.timers(), 0, 'a stopped controller stays stopped');
  await w.setVisible(false);
  await w.setVisible(true);
  assert.strictEqual(w.calls.length, 0, 'and sends nothing');
  w.ctl.start();
  assert.strictEqual(w.timers(), 1, 'start() after stop() works');
  w.ctl.stop();
  assert.deepStrictEqual(w.leaks(), { intervals: 0, timeouts: 0, listeners: 0 });

  // stop() while a beat is in flight: its answer is taken but arms nothing.
  const f = makeWorld();
  f.ctl.start();
  await f.ctl.goOnline();
  const beat = f.hold('riderHeartbeat');
  await f.fire();
  f.ctl.stop();
  beat.resolve(res('online'));
  await settle();
  assert.deepStrictEqual(f.leaks(), { intervals: 0, timeouts: 0, listeners: 0 });
}

async function testOnChangeFiresOnlyOnRealChanges() {
  const w = makeWorld();
  w.ctl.start();
  assert.strictEqual(w.changes.length, 0, 'nothing to report before the server says anything');
  w.adoptAs('online');
  assert.strictEqual(w.changes.length, 1);
  assert.strictEqual(w.changes[0].status, 'online');
  assert.strictEqual(w.changes[0].known, true);

  // Beats that change nothing but the clock are not changes.
  for (let i = 0; i < 4; i += 1) { w.clock += 30000; await w.fire(); }
  assert.strictEqual(w.count('riderHeartbeat'), 4);
  assert.strictEqual(w.changes.length, 1, 'four identical beats, no onChange');
  w.adoptAs('online');
  w.ctl.adopt(w.snap('online', { lastSeenAt: '2026-10-05T09:00:00.000Z' }));
  assert.strictEqual(w.changes.length, 1, 'the same state adopted again is not a change either');

  // Trouble coming and going is.
  w.failNext('riderHeartbeat', new Error('Failed to fetch'));
  await w.fire();
  assert.strictEqual(w.changes.length, 2);
  assert.strictEqual(w.changes[1].trouble, true);
  w.failNext('riderHeartbeat', new Error('Failed to fetch'));
  await w.fire();
  assert.strictEqual(w.changes.length, 2, 'the second failure in a row adds nothing');
  await w.fire();
  assert.strictEqual(w.changes.length, 3);
  assert.strictEqual(w.changes[2].trouble, false);

  // A different status is, and what the callback gets is a snapshot nobody can corrupt.
  w.server.status = 'paused';
  await w.fire();
  assert.strictEqual(w.changes.length, 4);
  assert.strictEqual(w.changes[3].status, 'paused');
  w.changes[3].status = 'tampered';
  assert.strictEqual(state(w).status, 'paused', 'getState() hands out copies');
  w.ctl.adopt(w.snap('online', { location: { lat: 4.05, lng: 9.7, accuracyM: 8 } }));
  const live1 = state(w);
  assert.deepStrictEqual(live1.location, { lat: 4.05, lng: 9.7, accuracyM: 8 }, 'the position the server reports is kept');
  live1.location.lat = 0;
  assert.strictEqual(state(w).location.lat, 4.05, 'and a caller cannot rewrite it through the copy');
  w.ctl.adopt(w.snap('paused'));

  // subscribe() returns an unsubscribe; a throwing listener does not break the others.
  const seen = [];
  const off = w.ctl.subscribe((s) => seen.push(s.status));
  w.ctl.subscribe(() => { throw new Error('a screen bug'); });
  const keep = [];
  w.ctl.subscribe((s) => keep.push(s.status));
  w.ctl.adopt(w.snap('offline'));
  assert.deepStrictEqual(seen, ['offline']);
  assert.deepStrictEqual(keep, ['offline'], 'a listener that throws does not stop the next one');
  off();
  w.adoptAs('paused');
  assert.deepStrictEqual(seen, ['offline'], 'unsubscribed');
  assert.deepStrictEqual(keep, ['offline', 'paused']);
}

async function testActionsReportWhatTheServerSays() {
  const w = makeWorld();
  w.ctl.start();
  const online = await w.ctl.goOnline();
  assert.strictEqual(online.status, 'online');
  assert.strictEqual(online.available, true);
  assert.strictEqual(online.pending, null);
  assert.strictEqual(w.timers(), 1);

  const paused = await w.ctl.pause();
  assert.strictEqual(paused.status, 'paused');
  assert.strictEqual(paused.available, false);
  assert.strictEqual(w.timers(), 0, 'pausing stops the heartbeat');

  const resumed = await w.ctl.resume();
  assert.strictEqual(resumed.status, 'online');
  assert.strictEqual(w.timers(), 1, 'resuming restarts it');

  const offline = await w.ctl.goOffline();
  assert.strictEqual(offline.status, 'offline');
  assert.strictEqual(offline.expired, false, 'a rider who chose to leave did not "stop responding"');
  assert.strictEqual(w.timers(), 0);
  assert.deepStrictEqual(w.names(), ['riderOnline', 'riderPause', 'riderResume', 'riderOffline']);

  // pending is visible while the request is out, and released after.
  const slow = w.hold('riderOnline');
  const p = w.ctl.goOnline();
  assert.strictEqual(state(w).pending, 'online', 'the screen can show the button as busy');
  slow.resolve(res('online'));
  await p;
  assert.strictEqual(state(w).pending, null);

  // The server refusing a move: the rider is told why (the error is passed through unchanged),
  // and since the screen was wrong the controller fetches the truth.
  w.server.status = 'busy';
  const failure = w.ctl.goOffline();
  await assert.rejects(failure, (err) => err.status === 409 && err.code === 'RIDER_BUSY' && /Finish your current delivery/.test(err.message));
  assert.strictEqual(w.count('riderPresence'), 1, 'after a 409 the controller re-reads the truth');
  assert.strictEqual(state(w).status, 'busy', 'and the screen follows it');
  assert.strictEqual(state(w).pending, null);
  assert.strictEqual(w.timers(), 1, 'a busy rider is still beating');

  // A refused pause with only an "unavailable" reason is passed through too.
  const x = makeWorld();
  x.ctl.start();
  await assert.rejects(x.ctl.pause(), (err) => err.code === 'RIDER_UNAVAILABLE');
  assert.strictEqual(x.timers(), 0);

  // Online -> busy -> online through beats, as accepting and finishing a delivery does.
  const y = makeWorld();
  y.ctl.start();
  await y.ctl.goOnline();
  y.server.status = 'busy';
  await y.fire();
  assert.strictEqual(state(y).status, 'busy');
  assert.strictEqual(y.timers(), 1);
  y.server.status = 'online';
  await y.fire();
  assert.strictEqual(state(y).status, 'online', 'a beat may confirm the end of a delivery');
  assert.strictEqual(state(y).available, true);
}

async function testAdoptedSnapshotsNeverGoBackInTime() {
  const w = makeWorld();
  w.ctl.start();
  const token = w.ctl.epoch();
  assert.strictEqual(w.ctl.adopt(w.snap('online'), token), true, 'a fresh snapshot is taken');
  assert.strictEqual(w.timers(), 1);

  // An overview requested BEFORE the rider tapped Go offline, delivered after: dropped.
  const stale = w.ctl.epoch();
  await w.ctl.goOffline();
  assert.strictEqual(w.ctl.adopt(w.snap('online'), stale), false, 'an older snapshot is refused');
  assert.strictEqual(state(w).status, 'offline');
  assert.strictEqual(w.timers(), 0);

  // A snapshot arriving while an action is in flight: dropped (the action's answer is newer).
  const slow = w.hold('riderOnline');
  const pending = w.ctl.goOnline();
  assert.strictEqual(w.ctl.adopt(w.snap('offline')), false);
  slow.resolve(res('online'));
  await pending;
  assert.strictEqual(state(w).status, 'online');

  // Without a token (a snapshot taken right now) it is accepted when nothing is in flight.
  assert.strictEqual(w.adoptAs('paused'), true);
  assert.strictEqual(state(w).status, 'paused');
  // Nonsense is never adopted.
  assert.strictEqual(w.ctl.adopt(null), false);
  assert.strictEqual(w.ctl.adopt({ status: 'ecstatic' }), false);
  assert.strictEqual(w.ctl.adopt({}), false);
  assert.strictEqual(state(w).status, 'paused');
}

async function testRefreshAsksTheServer() {
  const w = makeWorld();
  w.ctl.start();
  w.server.status = 'online';
  const s = await w.ctl.refresh();
  assert.strictEqual(w.names()[0], 'riderPresence');
  assert.strictEqual(s.status, 'online');
  assert.strictEqual(s.known, true);
  assert.strictEqual(w.timers(), 1, 'a refresh that finds the rider online arms the heartbeat');

  const f = makeWorld();
  f.ctl.start();
  f.failNext('riderPresence', new Error('Failed to fetch'));
  const after = await f.ctl.refresh();
  assert.strictEqual(after.known, false, 'a refresh that fails tells us nothing');
  assert.strictEqual(after.status, 'unknown');
  assert.strictEqual(after.trouble, true);
  assert.strictEqual(P.describeAvailability(after), null, 'so the hub shows no card on a guess');
}

async function testWhatTheCardShows() {
  const known = (status, extra = {}) => ({ known: true, status, expired: false, trouble: false, ...extra });
  const acts = (card) => card.actions.map((a) => a.act + ':' + a.label);

  assert.strictEqual(P.describeAvailability(null), null);
  assert.strictEqual(P.describeAvailability({ known: false, status: 'unknown' }), null, 'before the server answers, no card');

  const off = P.describeAvailability(known('offline'));
  assert.deepStrictEqual(acts(off), ['online:Go online']);
  assert.strictEqual(off.label, 'Offline');
  assert.strictEqual(off.actions[0].kind, 'filled');

  const online = P.describeAvailability(known('online'));
  assert.deepStrictEqual(acts(online), ['pause:Pause', 'offline:Go offline']);
  assert.strictEqual(online.tone, 'ok');

  const paused = P.describeAvailability(known('paused'));
  assert.deepStrictEqual(acts(paused), ['resume:Resume', 'offline:Go offline']);

  const busy = P.describeAvailability(known('busy'));
  assert.deepStrictEqual(busy.actions, [], 'on a delivery: no buttons');
  assert.ok(/locked/i.test(busy.text) && /delivery/i.test(busy.text), 'and it says why: ' + busy.text);

  const expired = P.describeAvailability(known('offline', { expired: true }));
  assert.deepStrictEqual(acts(expired), ['online:Go online']);
  assert.strictEqual(expired.text, 'You went offline because the app stopped responding.');
  assert.strictEqual(expired.tone, 'warn');

  const suspended = P.describeAvailability(known('suspended'));
  assert.deepStrictEqual(suspended.actions, [], 'a suspended rider is offered no way back');

  assert.ok(/Connection problem/.test(P.describeAvailability(known('online', { trouble: true })).note), 'trouble is said on an online card');
  assert.strictEqual(P.describeAvailability(known('online')).note, null);
  assert.strictEqual(P.describeAvailability(known('paused', { trouble: true })).note, null, 'a paused rider is not beating, so no connection note');

  // The hint on an offer the rider cannot accept now.
  assert.ok(/Go online/.test(P.offerHint(known('offline'))));
  assert.ok(/Resume/.test(P.offerHint(known('paused'))));
  assert.strictEqual(P.offerHint(known('online')), null);
  assert.strictEqual(P.offerHint(known('busy')), null, 'a busy rider gets the server\'s own refusal');
  assert.strictEqual(P.offerHint({ known: false, status: 'unknown' }), null, 'no hint on a guess');
  assert.strictEqual(P.offerHint(null), null);
}

/**
 * The same controller through the REAL delivery API client over a stubbed fetch:
 * whatever happens, no request names a status or a rider, and the heartbeat is
 * never the delivery GPS endpoint.
 */
async function testNoRequestEverCarriesAStatusOrARider() {
  const requests = [];
  let status = 'offline';
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    requests.push({ url: String(url), method: opts.method || 'GET', body });
    const path = String(url).split('/driver/presence')[1] || '';
    if (path === '/online' || path === '/resume') status = 'online';
    if (path === '/offline') status = 'offline';
    if (path === '/pause') status = 'paused';
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { presence: { status, available: status === 'online', reason: null, heartbeatIntervalMs: 30000, ttlSeconds: 120 } } })
    };
  };
  try {
    const api = new DeliveryApiClient('http://localhost/api/v1/deliveries');
    const w = makeWorld({ permission: 'granted' });
    const ctl = P.createPresenceController({
      api,
      locate: () => Promise.resolve({ lat: 4.05, lng: 9.7, accuracyM: 9 }),
      permission: () => 'granted',
      setIntervalFn: (fn, ms) => { const h = w.nextHandle++; w.intervals.set(h, { fn, ms }); return h; },
      clearIntervalFn: (h) => { w.intervals.delete(h); },
      setTimeoutFn: (fn, ms) => { const h = w.nextHandle++; w.timeouts.set(h, { fn, ms }); return h; },
      clearTimeoutFn: (h) => { w.timeouts.delete(h); },
      doc: w.doc,
      isVisible: () => true
    });
    ctl.start();
    await ctl.refresh();
    await ctl.goOnline();
    await w.fire();
    await w.fire();
    await ctl.pause();
    await ctl.resume();
    await w.fire();
    await ctl.goOffline();
    ctl.stop();

    const paths = requests.map((r) => r.method + ' ' + r.url.replace('http://localhost/api/v1/deliveries', ''));
    assert.deepStrictEqual(paths, [
      'GET /driver/presence',
      'POST /driver/presence/online',
      'POST /driver/presence/heartbeat',
      'POST /driver/presence/heartbeat',
      'POST /driver/presence/pause',
      'POST /driver/presence/resume',
      'POST /driver/presence/heartbeat',
      'POST /driver/presence/offline'
    ], 'the whole flow, in order, over the real client');
    for (const r of requests) {
      assert.ok(/\/api\/v1\/deliveries\/driver\/presence(\/(online|offline|pause|resume|heartbeat))?$/.test(r.url), 'only presence endpoints: ' + r.url);
      assert.ok(!/location/.test(r.url), 'never the delivery GPS endpoint');
      const keys = Object.keys(r.body || {});
      keys.forEach((k) => assert.ok(['lat', 'lng', 'accuracyM'].includes(k), `${r.url} sent an unexpected field "${k}"`));
      ['status', 'online', 'available', 'riderId', 'driverId', 'profileId', 'userId'].forEach((k) => assert.ok(!keys.includes(k), `${r.url} must not send ${k}`));
    }
    const heartbeat = requests.find((r) => r.url.endsWith('/heartbeat'));
    assert.deepStrictEqual(heartbeat.body, { lat: 4.05, lng: 9.7, accuracyM: 9 }, 'a granted position rides on the beat');
    assert.deepStrictEqual(requests.find((r) => r.url.endsWith('/offline')).body, {}, 'offline carries no body');
    assert.deepStrictEqual(requests.find((r) => r.url.endsWith('/pause')).body, {}, 'pause carries no body');
    assert.deepStrictEqual(w.leaks().intervals + w.leaks().timeouts, 0);
  } finally {
    global.fetch = realFetch;
  }
}

/** A request that never answers must not freeze every beat and tap queued behind it. */
async function testAHungRequestDoesNotBlockTheQueue() {
  assert.strictEqual(P.REQUEST_TIMEOUT_MS, 20000);
  const requestTimers = (w) => Array.from(w.timeouts.values()).filter((t) => t.ms === P.REQUEST_TIMEOUT_MS);

  // A beat that never answers: after the timeout the next one goes out; the state is not guessed.
  const w = makeWorld();
  w.ctl.start();
  await w.ctl.goOnline();
  const hung = w.hold('riderHeartbeat');
  await w.fire();
  assert.strictEqual(w.count('riderHeartbeat'), 1);
  assert.strictEqual(requestTimers(w).length, 1, 'the request is on a timer');
  await w.fire();
  assert.strictEqual(w.count('riderHeartbeat'), 1, 'until the timeout, the next tick sends nothing (never two in flight)');
  const [handle, timer] = Array.from(w.timeouts.entries())[0];
  w.timeouts.delete(handle);
  timer.fn();
  await settle();
  assert.strictEqual(state(w).trouble, true, 'a request that never answered is trouble');
  assert.strictEqual(state(w).status, 'online', 'and the state is NOT flipped by guess');
  assert.strictEqual(w.timers(), 1, 'the heartbeat keeps running');
  await w.fire();
  assert.strictEqual(w.count('riderHeartbeat'), 2, 'the next tick beats again');
  assert.strictEqual(state(w).trouble, false);
  // The abandoned beat answering late is dropped, never applied: here it claims "paused".
  hung.resolve(res('paused'));
  await settle();
  assert.strictEqual(state(w).status, 'online', 'a late answer to an abandoned request is ignored');
  assert.strictEqual(w.timeouts.size, 0, 'no timer is left behind');

  // A tap queued behind a hung beat runs once that beat times out, and goes through.
  const t = makeWorld();
  t.ctl.start();
  await t.ctl.goOnline();
  t.hold('riderHeartbeat');
  await t.fire();
  const off = t.ctl.goOffline();
  await settle();
  assert.strictEqual(t.count('riderOffline'), 0, 'the tap waits its turn');
  const [h2, timer2] = Array.from(t.timeouts.entries())[0];
  t.timeouts.delete(h2);
  timer2.fn();
  await off;
  assert.strictEqual(t.count('riderOffline'), 1, 'and runs as soon as the hung request is given up on');
  assert.strictEqual(state(t).status, 'offline');
  assert.strictEqual(t.timers(), 0);

  // A tap that never answers rejects with an error that has no status (a network problem), releases
  // the button, and changes nothing.
  const a = makeWorld();
  a.ctl.start();
  await a.ctl.goOnline();
  a.hold('riderPause');
  const pause = a.ctl.pause();
  assert.strictEqual(state(a).pending, 'pause');
  await settle();
  const [h3, timer3] = Array.from(a.timeouts.entries())[0];
  a.timeouts.delete(h3);
  timer3.fn();
  await assert.rejects(pause, (err) => err.code === 'TIMEOUT' && err.status === undefined);
  assert.strictEqual(state(a).pending, null, 'the button is released');
  assert.strictEqual(state(a).status, 'online', 'a pause that never arrived paused nobody');
  assert.strictEqual(a.timers(), 1);

  // A 200 that says nothing usable is an error WITH a status, so a screen words it as a server problem
  // rather than as "you're offline".
  const u = makeWorld();
  u.ctl.start();
  (u.overrides.riderOnline = []).push(() => ({}));
  await assert.rejects(u.ctl.goOnline(), (err) => err.status === 502 && /did not say where you stand/.test(err.message));
}

// ====================================================================================
// The rider hub and the rider picker, run FOR REAL (src/services/riderHub.js,
// riderPresence.js, sellerDispatch.js and the real dispatchUi.js helpers) in a vm
// context against a small fake DOM, so what is pinned here is what the rider sees:
// the availability card for each state, the buttons that apply, the hints on offers,
// the toast for a refusal, and that closing the overlay leaves the heartbeat alone.
// The fake DOM is deliberately dumb: it answers querySelector only for what the
// template really contains (so a template that loses a hook fails), and it keeps
// no layout, so how the card LOOKS is checked in a browser, not here.
// ====================================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const readService = (name) => fs.readFileSync(path.join(__dirname, '../../src/services', name), 'utf8');

/** The first tag of an HTML string that carries `sel` (a tag, .class or [attr] selector), or null. */
function findTag(html, sel) {
  let m;
  if ((m = /^(\w+)?\.([\w-]+)$/.exec(sel))) {
    const found = new RegExp('<(' + (m[1] || '\\w+') + ')(\\s[^>]*?class="[^"]*\\b' + m[2] + '\\b[^"]*"[^>]*)>').exec(html);
    return found ? { tag: found[1], attrs: found[2] } : null;
  }
  if ((m = /^\[([\w-]+)\]$/.exec(sel))) {
    const found = new RegExp('<(\\w+)(\\s[^>]*?\\b' + m[1] + '(?=[\\s=>/])[^>]*)>').exec(html);
    return found ? { tag: found[1], attrs: found[2] } : null;
  }
  if ((m = /^(\w+)$/.exec(sel))) {
    const found = new RegExp('<(' + m[1] + ')(\\s[^>]*)?>').exec(html);
    return found ? { tag: found[1], attrs: found[2] || '' } : null;
  }
  throw new Error('the test DOM does not support the selector ' + sel);
}

class FakeEl {
  constructor(doc, tag, html) {
    this.doc = doc;
    this.tag = tag || 'div';
    this.html = html || '';
    this.children = [];
    this.attrs = {};
    this.classes = new Set();
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.handlers = {};
    this.stubs = {};
    this.parentNode = null;
    const first = /^<\w+((?:\s[^>]*)?)>/.exec(this.html);
    if (first) {
      first[1].replace(/([\w-]+)(?:="([^"]*)")?/g, (all, name, value) => { this.attrs[name] = value === undefined ? '' : value; return all; });
      (this.attrs.class || '').split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
      if ('hidden' in this.attrs) this.hidden = true;
    }
  }
  get classList() {
    const set = this.classes;
    return { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) };
  }
  get innerHTML() { return this.html; }
  set innerHTML(value) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this.stubs = {}; this.html = String(value); }
  appendChild(child) { if (child) { child.parentNode = this; this.children.push(child); } return child; }
  insertAdjacentHTML(where, html) { this.html += html; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  removeAttribute(name) { delete this.attrs[name]; }
  addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); }
  removeEventListener(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter((f) => f !== fn); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; }
  contains(node) { return node === this || this.children.some((c) => c.contains(node)); }
  focus() { this.doc.activeElement = this; }
  /** What a finger or a mouse does: a disabled button, or one the stylesheet blocks (is-busy), gets nothing. */
  click() { if (this.disabled || this.classes.has('is-busy')) return; this.keyboardClick(); }
  /** What Enter / Space does: only `disabled` stops it (pointer-events:none does not apply). */
  keyboardClick() { if (this.disabled) return; (this.handlers.click || []).slice().forEach((fn) => fn({ target: this })); }
  querySelector(sel) {
    if (this.stubs[sel]) return this.stubs[sel];
    const hit = findTag(this.html, sel);
    if (!hit) return null;
    // Part of the tree from here on, as the real element is: what the code appends to it can be found by walking.
    const stub = new FakeEl(this.doc, hit.tag, '<' + hit.tag + hit.attrs + '>');
    this.stubs[sel] = stub;
    this.appendChild(stub);
    return stub;
  }
}

function walk(el, fn) { fn(el); el.children.forEach((c) => walk(c, fn)); }
const buttonsIn = (el) => { const out = []; walk(el, (n) => { if (n.tag === 'button') out.push(n); }); return out; };

/** Objects made inside the vm context have another realm's prototypes: compare them as plain data. */
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** The part of the world every screen test shares: a fake document, fake timers, the vm sandbox. */
function makeScreenWorld(options = {}) {
  const w = {
    permission: options.permission || 'prompt',
    intervals: new Map(), timeouts: new Map(), nextHandle: 1,
    toasts: [], empties: [], navs: [], geoCalls: 0, docListeners: {}, renderErrors: []
  };
  w.mk = (tag, html) => new FakeEl(w.doc, tag, html);
  w.doc = {
    hidden: false,
    activeElement: null,
    createElement: (tag) => w.mk(tag),
    getElementById: () => null,
    addEventListener: (type, fn) => { (w.docListeners[type] = w.docListeners[type] || []).push(fn); },
    removeEventListener: (type, fn) => { w.docListeners[type] = (w.docListeners[type] || []).filter((f) => f !== fn); }
  };
  w.visListeners = () => (w.docListeners.visibilitychange || []).length;
  w.intervalsMs = () => Array.from(w.intervals.values()).map((t) => t.ms).sort((a, b) => a - b);
  w.fire = async (ms) => {
    Array.from(w.intervals.values()).filter((t) => ms === undefined || t.ms === ms).forEach((t) => t.fn());
    await settle(14);
  };
  w.setVisible = async (visible) => { w.doc.hidden = !visible; (w.docListeners.visibilitychange || []).slice().forEach((fn) => fn()); await settle(14); };
  w.leaks = () => ({ intervals: w.intervals.size, timeouts: w.timeouts.size, visibility: w.visListeners() });

  const page = (nav) => ({
    alive: true, content: w.mk('div'), footer: w.mk('div'), nav,
    setRight() {}, setTitle(title, subtitle) { this.title = title; this.subtitle = subtitle; }
  });
  const makeNav = () => {
    const nav = { depth: 0, records: [] };
    nav.push = (view) => {
      const p = page(nav);
      const rec = { view, page: p, cleanup: null };
      nav.records.push(rec);
      nav.depth = nav.records.length;
      // As the real stack does: a screen that fails to draw is replaced by an error state, it does not break the caller.
      try { rec.cleanup = view.render(p) || null; } catch (err) { w.renderErrors.push(err); p.content.appendChild(fakes.errorState('Something went wrong showing this screen.')); }
      return p;
    };
    nav.pop = () => {
      const rec = nav.records.pop();
      if (rec) { rec.page.alive = false; if (typeof rec.cleanup === 'function') rec.cleanup(); }
      nav.depth = nav.records.length;
    };
    nav.close = () => { while (nav.records.length) nav.pop(); };
    w.navs.push(nav);
    return nav;
  };

  const tagOf = (html) => (/^<(\w+)/.exec(String(html).trim()) || [])[1] || 'div';
  const fakes = {
    h: (html) => w.mk(tagOf(html), String(html).trim()),
    button: (o) => {
      const b = w.mk('button');
      b.label = o.label;
      b.kind = o.kind || 'filled';
      if (o.onClick) b.addEventListener('click', (e) => o.onClick(e, b));
      return b;
    },
    busy: (btn, fn) => {
      if (!btn || btn.classes.has('is-busy')) return Promise.resolve();
      btn.classes.add('is-busy');
      return Promise.resolve().then(fn).finally(() => btn.classes.delete('is-busy'));
    },
    toast: (message, opts) => { w.toasts.push({ message, tone: (opts && opts.tone) || 'success' }); },
    skeletonList: () => { const el = w.mk('div'); el.skeleton = true; return el; },
    emptyState: (o) => { const el = w.mk('div'); el.opts = o; w.empties.push(o); return el; },
    errorState: (message, retry) => { const el = w.mk('div'); el.error = message; el.retry = retry; return el; },
    section: (title, o) => { const el = w.mk('section'); el.title = title; el.count = o && o.count; el.group = w.mk('div'); el.appendChild(el.group); return el; },
    searchField: () => w.mk('div'),
    segmented: () => { const el = w.mk('div'); el.setCount = () => {}; return el; },
    countdown: () => ({ el: w.mk('span'), stop() {} }),
    confirm: () => Promise.resolve(true),
    openStack: () => makeNav()
  };

  /** Load the real scripts into one browser-like context. `api` is window.deliveryApi. */
  w.boot = (api, { presence = true, seller = false } = {}) => {
    const sandbox = {
      console: { log() {}, info() {}, warn() {}, error() {} },
      navigator: {
        permissions: { query: async () => ({ state: w.permission }) },
        geolocation: { getCurrentPosition(ok) { w.geoCalls += 1; ok({ coords: { latitude: 4.05, longitude: 9.7, accuracy: 12.4 } }); } }
      },
      setInterval: (fn, ms) => { const h = w.nextHandle++; w.intervals.set(h, { fn, ms }); return h; },
      clearInterval: (h) => { w.intervals.delete(h); },
      setTimeout: (fn, ms) => { const h = w.nextHandle++; w.timeouts.set(h, { fn, ms }); return h; },
      clearTimeout: (h) => { w.timeouts.delete(h); },
      document: w.doc
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(readService('dispatchUi.js'), sandbox, { filename: 'dispatchUi.js' });
    // The real helpers (errorMessage, badge, esc, km, icon, ...) with only the DOM builders faked.
    sandbox.LoumooDispatchUI = Object.assign({}, sandbox.LoumooDispatchUI, fakes);
    sandbox.deliveryApi = api;
    if (presence) vm.runInContext(readService('riderPresence.js'), sandbox, { filename: 'riderPresence.js' });
    vm.runInContext(readService('riderHub.js'), sandbox, { filename: 'riderHub.js' });
    if (seller) vm.runInContext(readService('sellerDispatch.js'), sandbox, { filename: 'sellerDispatch.js' });
    w.sb = sandbox;
    return sandbox;
  };
  return w;
}

const PRESENCE_CALL_NAMES = ['riderPresence', 'riderOnline', 'riderOffline', 'riderPause', 'riderResume', 'riderHeartbeat'];
const SELF_REFUSAL = {
  offline: 'You are offline. Go online to take deliveries.',
  expired: 'You went offline because the app stopped responding. Go online to take deliveries.',
  paused: 'You are on a break. Resume to take deliveries.',
  busy: 'Finish your current delivery before taking another.'
};
const offerJob = (id = 'dlv_1') => ({
  id, status: 'assigned', orderNumber: 'LM-48222',
  pickup: { label: 'Orca Electronics Akwa', location: { lat: 4.0487, lng: 9.6966 } },
  dropoff: { area: 'Bonanjo, Douala', location: { lat: 4.05, lng: 9.69 } },
  offerExpiresAt: '2026-10-05T08:10:00.000Z'
});

/**
 * A rider's phone: the hub running against a fake server that behaves like the real one
 * (an accept is refused unless the rider is online; a heartbeat never raises anyone).
 */
function makeHubWorld(options = {}) {
  const o = { status: 'offline', reason: 'offline', jobs: [], overview: 'presence', ...options };
  const w = makeScreenWorld(o);
  w.server = { status: o.status, reason: o.reason, jobs: o.jobs, notRider: false, overview: o.overview, beats: [] };
  w.calls = [];
  w.overrides = {};
  w.count = (name) => w.calls.filter((c) => c.name === name).length;
  /** What the client sent (first argument) with each call to `name`. */
  w.argsOf = (name) => w.calls.filter((c) => c.name === name).map((c) => plain(c.args[0]));

  w.snap = (status) => {
    const s = status === undefined ? w.server.status : status;
    return {
      status: s, available: s === 'online',
      reason: s === 'online' ? null : s === 'offline' ? w.server.reason : s,
      lastSeenAt: '2026-10-05T08:00:00.000Z', expiresAt: s === 'online' ? '2026-10-05T08:02:00.000Z' : null,
      ttlSeconds: 120, heartbeatIntervalMs: 30000, location: null, updatedAt: '2026-10-05T08:00:00.000Z'
    };
  };
  w.overview = () => {
    const out = { driver: { id: 'rider_1', name: 'Alain Mbarga', phone: '+237677123456' }, deliveries: JSON.parse(JSON.stringify(w.server.jobs)) };
    if (w.server.overview === 'presence') out.presence = w.snap();
    else if (w.server.overview === 'null') out.presence = null;
    return out;
  };
  const refuse = (status, code, message) => { const err = new Error(message); err.status = status; err.code = code; return err; };
  const serverDo = (name, args) => {
    const s = w.server;
    switch (name) {
      case 'riderOverview':
        if (s.notRider) throw refuse(403, 'PERMISSION_DENIED', 'You are not a registered rider.');
        return w.overview();
      case 'riderPresence': return { presence: w.snap() };
      case 'riderOnline':
        if (s.status !== 'busy') { s.status = 'online'; s.reason = null; }
        return { presence: w.snap() };
      case 'riderOffline':
        if (s.status === 'busy') throw refuse(409, 'RIDER_BUSY', 'Finish or release your current delivery before going offline.');
        s.status = 'offline'; s.reason = 'offline';
        return { presence: w.snap() };
      case 'riderPause':
        if (s.status === 'busy') throw refuse(409, 'RIDER_BUSY', 'Finish or release your current delivery before pausing.');
        if (s.status !== 'online') throw refuse(409, 'RIDER_UNAVAILABLE', 'You can only pause while online.');
        s.status = 'paused';
        return { presence: w.snap() };
      case 'riderResume':
        if (s.status !== 'paused' && s.status !== 'online') throw refuse(409, 'RIDER_UNAVAILABLE', 'You are not paused.');
        s.status = 'online';
        return { presence: w.snap() };
      case 'riderHeartbeat': s.beats.push(args[0] || null); return { presence: w.snap() };
      case 'accept': {
        const job = s.jobs.find((j) => j.id === args[0]);
        if (!job) throw refuse(404, 'NOT_FOUND', 'Delivery not found');
        if (s.status !== 'online') {
          const why = s.status === 'offline' && s.reason === 'expired' ? 'expired' : s.status;
          throw refuse(409, s.status === 'busy' ? 'RIDER_BUSY' : 'RIDER_UNAVAILABLE', SELF_REFUSAL[why]);
        }
        job.status = 'accepted'; job.offerExpiresAt = null; s.status = 'busy';
        return { delivery: JSON.parse(JSON.stringify(job)) };
      }
      case 'decline': return { delivery: { id: args[0], status: 'pending_assignment' } };
      case 'whoAmI': return 'usr_test';
      default: throw new Error('unexpected ' + name);
    }
  };
  const respond = (name, args) => {
    w.calls.push({ name, args });
    const q = w.overrides[name];
    return Promise.resolve().then(() => (q && q.length ? q.shift()(args) : serverDo(name, args)));
  };
  const api = {};
  ['riderOverview', 'accept', 'decline', 'whoAmI', ...(o.noPresenceClient ? [] : PRESENCE_CALL_NAMES)].forEach((name) => { api[name] = (...args) => respond(name, args); });
  w.api = api;
  w.hold = (name) => { const d = deferred(); (w.overrides[name] = w.overrides[name] || []).push(() => d.promise); return d; };

  w.boot(api, { presence: !o.noPresenceScript });

  w.open = async () => {
    const before = w.renderErrors.length;
    const nav = w.sb.LoumooRiderHub.open();
    await settle(14);
    assert.deepStrictEqual(w.renderErrors.slice(before).map((e) => e.message), [], 'the inbox drew without an error');
    return nav;
  };
  w.inbox = () => w.navs[w.navs.length - 1].records[0].page;
  w.host = (pg) => (pg || w.inbox()).content.children[0];
  w.body = (pg) => (pg || w.inbox()).content.children[1];
  /** What the availability card shows right now, read off the DOM. */
  w.card = (pg) => {
    const el = w.host(pg).children[0];
    if (!el) return null;
    const badge = /class="ldx-badge ldx-tone-([\w-]+)"><span class="ldx-badge-dot"><\/span>([^<]*)<\/span>/.exec(el.html);
    const note = el.querySelector('[data-note]');
    return {
      el,
      title: el.querySelector('.ldx-row-title').textContent,
      text: el.querySelector('[data-text]').textContent,
      note: note.textContent,
      noteHidden: note.hidden,
      badge: badge ? { tone: badge[1], label: badge[2] } : null,
      buttons: buttonsIn(el).map((b) => ({ el: b, label: b.label, kind: b.kind, disabled: b.disabled, busy: b.classes.has('is-busy'), ariaBusy: b.attrs['aria-busy'] === 'true', ariaDisabled: b.attrs['aria-disabled'] === 'true' })),
      labels: buttonsIn(el).map((b) => b.label)
    };
  };
  w.button = (label) => { const b = w.card().buttons.find((x) => x.label === label); assert.ok(b, `a "${label}" button is on the card (card shows: ${w.card().labels.join(', ') || 'no buttons'})`); return b.el; };
  /** The hint under each offer card: { text, hidden }. */
  w.offerCards = () => { const out = []; walk(w.body(), (n) => { if (n.classes.has('ldx-card') && n.html.includes('data-hint')) out.push(n); }); return out; };
  w.hints = () => w.offerCards().map((card) => { const h = card.querySelector('[data-hint]'); return { text: h.textContent, hidden: h.hidden }; });
  return w;
}

async function testTheCardShowsEachStateAndOnlyItsButtons() {
  const expectations = [
    { name: 'offline', server: { status: 'offline', reason: 'offline' }, badge: { tone: 'muted', label: 'Offline' }, title: 'You’re offline', text: 'Go online to receive new delivery offers.', buttons: [['Go online', 'filled']] },
    { name: 'expired', server: { status: 'offline', reason: 'expired' }, badge: { tone: 'warn', label: 'Offline' }, title: 'You’re offline', text: 'You went offline because the app stopped responding.', buttons: [['Go online', 'filled']] },
    { name: 'online', server: { status: 'online', reason: null }, badge: { tone: 'ok', label: 'Online' }, title: 'You’re online', text: 'New delivery offers will be sent to you.', buttons: [['Pause', 'gray'], ['Go offline', 'gray']] },
    { name: 'paused', server: { status: 'paused', reason: null }, badge: { tone: 'warn', label: 'Paused' }, title: 'You’re on a break', text: 'You won’t get new offers until you resume.', buttons: [['Resume', 'filled'], ['Go offline', 'gray']] },
    { name: 'busy', server: { status: 'busy', reason: null }, badge: { tone: 'accent', label: 'On a delivery' }, title: 'You’re on a delivery', text: 'Availability is locked while you’re on a delivery.', buttons: [] }
  ];
  for (const x of expectations) {
    const w = makeHubWorld(x.server);
    await w.open();
    const card = w.card();
    assert.ok(card, `${x.name}: a card is shown`);
    assert.strictEqual(card.title, x.title, `${x.name}: title`);
    assert.strictEqual(card.text, x.text, `${x.name}: text`);
    assert.deepStrictEqual(card.badge, x.badge, `${x.name}: badge`);
    assert.deepStrictEqual(card.buttons.map((b) => [b.label, b.kind]), x.buttons, `${x.name}: ONLY the buttons that apply`);
    card.buttons.forEach((b) => assert.ok(!b.disabled && !b.busy, `${x.name}: ${b.label} is ready to be tapped`));
    assert.strictEqual(card.noteHidden, true, `${x.name}: no connection note`);
    assert.ok(/role="group" aria-label="Your availability"/.test(card.el.html), `${x.name}: the card is a labelled group for a screen reader`);
    assert.strictEqual(w.host().attrs['aria-live'], 'polite', `${x.name}: a change of availability is announced`);
    // The card is the first thing on the screen, above the jobs; and it is one card, not one per refresh.
    assert.strictEqual(w.inbox().content.children.length, 2, `${x.name}: the card host, then the job list`);
    assert.strictEqual(w.host().children.length, 1, `${x.name}: exactly one card`);
    await w.fire(15000);
    assert.strictEqual(w.host().children.length, 1, `${x.name}: a refresh does not stack a second card`);
    w.navs[0].close();
    assert.deepStrictEqual(w.leaks().timeouts, 0);
  }

  // A connection problem is said on the card of a rider who is beating (online or busy), and goes away.
  const w = makeHubWorld({ status: 'online', reason: null });
  await w.open();
  w.overrides.riderHeartbeat = [() => { throw new Error('Failed to fetch'); }];
  await w.fire(30000);
  let card = w.card();
  assert.strictEqual(card.noteHidden, false, 'a failed beat is said on the card');
  assert.strictEqual(card.note, 'Connection problem. Trying again…');
  assert.strictEqual(card.badge.label, 'Online', 'and the status is NOT guessed from a failed request');
  await w.fire(30000);
  assert.strictEqual(w.card().noteHidden, true, 'the next beat that gets through clears it');
}

async function testNoCardWhereAvailabilityIsNotKnown() {
  // An older server (no presence in the overview): the hub is exactly what it was.
  for (const overview of ['absent', 'null']) {
    const w = makeHubWorld({ status: 'online', reason: null, overview, jobs: [offerJob()] });
    await w.open();
    assert.strictEqual(w.host().children.length, 0, `overview presence ${overview}: no card`);
    assert.strictEqual(w.offerCards().length, 1, `overview presence ${overview}: the offer is still shown`);
    assert.deepStrictEqual(w.hints(), [{ text: '', hidden: true }], `overview presence ${overview}: and no hint on it`);
    assert.deepStrictEqual(w.intervalsMs(), [15000], `overview presence ${overview}: nothing beats on a guess`);
    assert.strictEqual(w.count('riderPresence'), 0);
  }

  // An older delivery API client / a script that did not load: no controller, no card, no error.
  for (const variant of [{ noPresenceClient: true }, { noPresenceScript: true }]) {
    const w = makeHubWorld({ status: 'online', reason: null, jobs: [offerJob()], ...variant });
    await w.open();
    assert.strictEqual(w.host().children.length, 0, `${Object.keys(variant)[0]}: no card`);
    assert.strictEqual(w.offerCards().length, 1, 'the hub works as before');
    assert.deepStrictEqual(w.intervalsMs(), [15000]);
    assert.strictEqual(w.count('riderHeartbeat'), 0);
  }

  // Not a rider (403): the "Deliver with LOUMOO" screen, no card, nothing beats, nothing about presence is asked.
  const w = makeHubWorld({ status: 'offline' });
  w.server.notRider = true;
  await w.open();
  assert.strictEqual(w.host().children.length, 0);
  assert.strictEqual(w.empties[w.empties.length - 1].title, 'Deliver with LOUMOO');
  PRESENCE_CALL_NAMES.forEach((name) => assert.strictEqual(w.count(name), 0, `a non-rider never calls ${name}`));
}

async function testTheOverviewIsTheOnlyReadOnTheRefresh() {
  const w = makeHubWorld({ status: 'online', reason: null });
  await w.open();
  assert.strictEqual(w.count('riderOverview'), 1);
  await w.fire(15000);
  await w.fire(15000);
  await w.fire(15000);
  assert.strictEqual(w.count('riderOverview'), 4, 'one overview per refresh');
  assert.strictEqual(w.count('riderPresence'), 0, 'and NO extra request for availability: the overview carries it');
  assert.strictEqual(w.count('riderHeartbeat'), 0, 'the heartbeat has its own clock');
  await w.fire(30000);
  assert.strictEqual(w.count('riderHeartbeat'), 1);
  assert.strictEqual(w.count('riderPresence'), 0);
  // Coming back to the page refreshes the jobs (and, with them, the card) once; the heartbeat beats at once too.
  await w.setVisible(false);
  await w.setVisible(true);
  assert.strictEqual(w.count('riderOverview'), 5);
  assert.strictEqual(w.count('riderHeartbeat'), 2);
  assert.strictEqual(w.count('riderPresence'), 0);
}

async function testTappingTheButtonsRunsTheActionAndShowsItInFlight() {
  const w = makeHubWorld({ status: 'offline' });
  await w.open();
  assert.deepStrictEqual(w.card().labels, ['Go online']);

  // Go online, held in flight: the tapped button shows its spinner, a second tap does nothing.
  const slow = w.hold('riderOnline');
  w.button('Go online').click();
  await settle(14);
  let card = w.card();
  assert.deepStrictEqual(card.buttons.map((b) => [b.label, b.busy, b.ariaBusy, b.ariaDisabled]), [['Go online', true, true, true]], 'the button shows it is working');
  const tapped = card.buttons[0].el;
  tapped.click();                 // a finger: the stylesheet blocks it (is-busy)
  tapped.keyboardClick();         // Enter / Space still reaches the handler: it must do nothing
  await settle(14);
  assert.strictEqual(w.count('riderOnline'), 1, 'one request, however many taps');
  w.server.status = 'online'; w.server.reason = null;
  slow.resolve({ presence: w.snap() });
  await settle(14);
  card = w.card();
  assert.deepStrictEqual(card.labels, ['Pause', 'Go offline'], 'the card follows the server answer');
  assert.ok(card.buttons.every((b) => !b.busy && !b.disabled), 'and every button is released');
  // Go online is a tap: it carries the rider's position (the hub is open); no status, no id.
  assert.deepStrictEqual(w.argsOf('riderOnline')[0], { lat: 4.05, lng: 9.7, accuracyM: 12 });
  assert.strictEqual(w.count('riderOverview'), 2, 'after an action the jobs are re-read once (offers may have changed)');
  assert.deepStrictEqual(w.intervalsMs(), [15000, 30000], 'online: the heartbeat is running');

  // While Pause is in flight the other button is disabled (the tapped one is the spinner).
  const slowPause = w.hold('riderPause');
  w.button('Pause').click();
  await settle(14);
  card = w.card();
  assert.deepStrictEqual(card.buttons.map((b) => [b.label, b.busy, b.disabled]), [['Pause', true, false], ['Go offline', false, true]]);
  w.button('Go offline').click();
  await settle(14);
  assert.strictEqual(w.count('riderOffline'), 0, 'a disabled button sends nothing');
  w.server.status = 'paused';
  slowPause.resolve({ presence: w.snap() });
  await settle(14);
  assert.deepStrictEqual(w.card().labels, ['Resume', 'Go offline']);
  assert.deepStrictEqual(w.intervalsMs(), [15000], 'paused: the heartbeat stopped');

  // Resume (a tap: it carries a position), then Go offline.
  w.button('Resume').click();
  await settle(14);
  assert.deepStrictEqual(w.card().labels, ['Pause', 'Go offline']);
  assert.deepStrictEqual(w.argsOf('riderResume')[0], { lat: 4.05, lng: 9.7, accuracyM: 12 });
  w.button('Go offline').click();
  await settle(14);
  assert.deepStrictEqual(w.card().labels, ['Go online']);
  assert.strictEqual(w.card().text, 'Go online to receive new delivery offers.', 'a rider who chose to leave did not "stop responding"');
  assert.deepStrictEqual(w.intervalsMs(), [15000]);
  assert.deepStrictEqual(w.toasts, [], 'no error was shown on the way');
  assert.deepStrictEqual(w.calls.filter((c) => PRESENCE_CALL_NAMES.includes(c.name)).map((c) => c.name), ['riderOnline', 'riderPause', 'riderResume', 'riderOffline']);
}

async function testARefusalReachesTheToastAndTheCardTellsTheTruth() {
  // The rider's screen says online; meanwhile they accepted a job elsewhere and are busy.
  const w = makeHubWorld({ status: 'online', reason: null });
  await w.open();
  w.server.status = 'busy';
  w.button('Go offline').click();
  await settle(14);
  assert.deepStrictEqual(w.toasts, [{ message: 'Finish or release your current delivery before going offline.', tone: 'error' }], 'the server\'s own words, in the existing toast');
  assert.strictEqual(w.count('riderPresence'), 1, 'the controller re-read the truth after the refusal');
  const card = w.card();
  assert.strictEqual(card.badge.label, 'On a delivery');
  assert.deepStrictEqual(card.buttons, [], 'and the card no longer offers what is not allowed');
  assert.deepStrictEqual(w.intervalsMs(), [15000, 30000], 'a busy rider is still beating');

  // A network failure on a tap: the toast says so, the card is unchanged and usable again.
  const n = makeHubWorld({ status: 'online', reason: null });
  await n.open();
  n.overrides.riderPause = [() => { throw new Error('Failed to fetch'); }];
  n.button('Pause').click();
  await settle(14);
  assert.strictEqual(n.toasts.length, 1);
  assert.strictEqual(n.toasts[0].tone, 'error');
  assert.ok(/offline|connection/i.test(n.toasts[0].message), 'a request that did not get through is worded as a connection problem: ' + n.toasts[0].message);
  assert.deepStrictEqual(n.card().labels, ['Pause', 'Go offline'], 'the rider is still shown as online: nothing was guessed');
  assert.ok(n.card().buttons.every((b) => !b.busy && !b.disabled));
}

async function testAnOfferTellsARiderWhoCannotAcceptWhatToDo() {
  for (const [status, reason, hint] of [
    ['offline', 'offline', 'You’re offline. Go online to accept this offer.'],
    ['paused', null, 'You’re on a break. Resume to accept this offer.'],
    ['online', null, ''],
    ['busy', null, '']
  ]) {
    const w = makeHubWorld({ status, reason, jobs: [offerJob()] });
    await w.open();
    assert.strictEqual(w.offerCards().length, 1);
    assert.deepStrictEqual(w.hints(), [{ text: hint, hidden: hint === '' }], `${status}: hint on the offer`);
  }

  // Tapping Accept anyway: the server's 409 words reach the toast (the existing path), and the screen re-reads.
  const w = makeHubWorld({ status: 'offline', reason: 'offline', jobs: [offerJob()] });
  await w.open();
  const accept = buttonsIn(w.offerCards()[0]).find((b) => b.label === 'Accept');
  accept.click();
  await settle(14);
  assert.deepStrictEqual(w.toasts, [{ message: 'You are offline. Go online to take deliveries.', tone: 'error' }]);

  // Going online clears the hint WITHOUT rebuilding the offer card under the rider's thumb.
  const before = w.offerCards()[0];
  w.button('Go online').click();
  await settle(14);
  assert.strictEqual(w.card().badge.label, 'Online');
  assert.deepStrictEqual(w.hints(), [{ text: '', hidden: true }], 'the hint is gone');
  assert.strictEqual(w.offerCards()[0], before, 'the very same offer card: only its hint changed');
  // And a rider who is online can accept: the card says they are now on a delivery.
  buttonsIn(w.offerCards()[0]).find((b) => b.label === 'Accept').click();
  await settle(14);
  assert.strictEqual(w.card().badge.label, 'On a delivery', 'accepting moves the card to busy (the overview that follows says so)');
  assert.deepStrictEqual(w.card().buttons, []);
}

async function testClosingTheHubKeepsTheRiderOnlineAndTheScreenQuiet() {
  const w = makeHubWorld({ status: 'online', reason: null, permission: 'granted' });
  const first = await w.open();
  assert.strictEqual(w.card().badge.label, 'Online');
  assert.deepStrictEqual(w.intervalsMs(), [15000, 30000]);
  assert.strictEqual(w.visListeners(), 2, 'the hub and the heartbeat each wait for the page to come back');
  const page = w.inbox();

  await w.fire(30000);
  assert.deepStrictEqual(plain(w.server.beats), [{ lat: 4.05, lng: 9.7, accuracyM: 12 }], 'hub open + permission granted: the beat carries a position');

  first.close();
  assert.deepStrictEqual(w.intervalsMs(), [30000], 'closing the hub removes ITS refresh only: the rider stays online');
  assert.strictEqual(w.visListeners(), 1);
  const geo = w.geoCalls;
  await w.fire(30000);
  assert.strictEqual(w.server.beats.length, 2, 'the heartbeat goes on');
  assert.strictEqual(w.server.beats[1], null, 'but with the screen closed no position is shared (no background tracking)');
  assert.strictEqual(w.geoCalls, geo, 'and the position was not even asked for');

  // The closed screen is not drawn on any more.
  w.server.status = 'paused';
  await w.fire(30000);
  assert.strictEqual(w.card(page).badge.label, 'Online', 'a screen that was closed is left alone');
  assert.deepStrictEqual(w.intervalsMs(), [], 'the server said paused: the heartbeat stopped by itself');

  // Opening it again (twice) shows the truth, never two controllers, never two timers.
  const second = await w.open();
  assert.strictEqual(w.card().badge.label, 'Paused');
  assert.deepStrictEqual(w.intervalsMs(), [15000]);
  w.button('Resume').click();
  await settle(14);
  assert.deepStrictEqual(w.intervalsMs(), [15000, 30000]);
  const third = await w.open();
  assert.strictEqual(w.card().badge.label, 'Online');
  assert.deepStrictEqual(w.intervalsMs(), [15000, 15000, 30000], 'two hub screens, still ONE heartbeat timer');
  const beats = w.count('riderHeartbeat');
  await w.fire(30000);
  assert.strictEqual(w.count('riderHeartbeat'), beats + 1, 'one beat per tick, from one controller');
  second.close();
  third.close();
  assert.deepStrictEqual(w.intervalsMs(), [30000]);

  // The server drops the rider (silent too long): the next beat stops everything and leaves nothing behind.
  w.server.status = 'offline'; w.server.reason = 'expired';
  await w.fire(30000);
  assert.deepStrictEqual(w.leaks(), { intervals: 0, timeouts: 0, visibility: 0 }, 'nothing is left running');

  // And the card says why when the rider comes back.
  await w.open();
  assert.strictEqual(w.card().text, 'You went offline because the app stopped responding.');
  assert.deepStrictEqual(w.card().labels, ['Go online']);
}

async function testASlowOverviewCannotReviveWhatTheRiderJustSwitchedOff() {
  const w = makeHubWorld({ status: 'online', reason: null });
  await w.open();
  // The 15 s refresh asks; its answer is slow and was taken while the rider was still online.
  const slow = w.hold('riderOverview');
  const stale = w.overview();
  await w.fire(15000);
  assert.strictEqual(w.count('riderOverview'), 2);
  // Meanwhile the rider taps Go offline and the server does it.
  w.button('Go offline').click();
  await settle(14);
  assert.deepStrictEqual(w.card().labels, ['Go online']);
  assert.deepStrictEqual(w.intervalsMs(), [15000]);
  // The slow answer finally lands: it says "online". It is older than what the screen knows.
  slow.resolve(stale);
  await settle(14);
  assert.strictEqual(w.card().badge.label, 'Offline', 'the stale overview did not bring the card back to online');
  assert.deepStrictEqual(w.card().labels, ['Go online']);
  assert.deepStrictEqual(w.intervalsMs(), [15000], 'and did not restart the heartbeat');

  // The same for a tap that is still in flight when the stale answer lands.
  const x = makeHubWorld({ status: 'online', reason: null });
  await x.open();
  const late = x.hold('riderOverview');
  const old = x.overview();
  await x.fire(15000);
  const off = x.hold('riderOffline');
  x.button('Go offline').click();
  await settle(14);
  late.resolve(old);
  await settle(14);
  x.server.status = 'offline'; x.server.reason = 'offline';
  off.resolve({ presence: x.snap() });
  await settle(14);
  assert.strictEqual(x.card().badge.label, 'Offline');
}

async function testFocusStaysWithAKeyboardUserWhenTheCardRedraws() {
  const w = makeHubWorld({ status: 'offline' });
  await w.open();
  const goOnline = w.button('Go online');
  goOnline.focus();
  assert.strictEqual(w.doc.activeElement, goOnline);
  const slow = w.hold('riderOnline');
  goOnline.click();
  await settle(14);
  let card = w.card();
  assert.strictEqual(w.doc.activeElement, card.el, 'redrawn while the request is out: focus is parked on the card, not lost');
  assert.strictEqual(card.el.attrs.tabindex, '-1');
  w.server.status = 'online'; w.server.reason = null;
  slow.resolve({ presence: w.snap() });
  await settle(14);
  card = w.card();
  assert.strictEqual(w.doc.activeElement, card.el, 'and still on the card once the buttons changed');
  assert.deepStrictEqual(card.labels, ['Pause', 'Go offline']);
  assert.ok(!card.buttons.some((b) => w.doc.activeElement === b.el), 'no button was focused on the rider\'s behalf');

  // A rider who was not using the keyboard on the card is not given focus.
  w.doc.activeElement = null;
  w.button('Pause').click();
  await settle(14);
  assert.strictEqual(w.doc.activeElement, null, 'a redraw takes focus from nobody');
}

async function testAHubOpenedAfterAccountChangeNeverShowsThePreviousRidersState() {
  // A rider is online with the hub closed; on the same phone someone else signs in and opens the hub.
  const w = makeHubWorld({ status: 'online', reason: null });
  const first = await w.open();
  first.close();
  assert.deepStrictEqual(w.intervalsMs(), [30000]);
  w.server.notRider = true;         // the next account is not a rider
  const hold = w.hold('riderOverview');
  const second = await w.open();    // the overview is still on its way
  assert.strictEqual(w.host().children.length, 0, 'nothing is drawn from what the controller remembers, before the answer to this visit');
  // Something the controller reports in the meantime (a failed beat is a change) must not draw it either.
  w.overrides.riderHeartbeat = [() => { throw new Error('Failed to fetch'); }];
  await w.fire(30000);
  assert.strictEqual(w.host().children.length, 0, 'not even when the controller reports a change before the overview arrives');
  hold.reject(Object.assign(new Error('You are not a registered rider.'), { status: 403, code: 'PERMISSION_DENIED' }));
  await settle(14);
  assert.strictEqual(w.host().children.length, 0);
  assert.deepStrictEqual(w.intervalsMs(), [15000], 'and the heartbeat is stopped for an account that is not an active rider');

  // The account is made an active rider while this very screen is open: the next refresh brings the card back
  // and starts the heartbeat again.
  w.server.notRider = false;
  w.server.status = 'online';
  await w.fire(15000);
  assert.strictEqual(w.card().badge.label, 'Online', 'the card is back on the same screen');
  assert.deepStrictEqual(w.intervalsMs(), [15000, 30000], 'and so is the heartbeat');
  second.close();
}

// ---- the seller's rider picker: the empty state says WHY it is empty ----
async function pickerWorld(listDriversResult, orderExtra = {}) {
  const w = makeScreenWorld();
  w.listCalls = [];
  w.listResult = listDriversResult;
  const order = Object.assign({ id: 'ord_1', orderNumber: 'LM-1', title: 'Phone', itemCount: 1, totalXaf: 100000, buyerName: 'Awa', area: 'Akwa', placedAt: '2026-10-05T07:00:00.000Z' }, orderExtra);
  const delivery = { id: 'dlv_1', orderId: 'ord_1', status: 'pending_assignment', viewerRole: 'seller', driver: null, pickup: { label: 'Shop', address: 'Akwa' }, dropoff: { area: 'Akwa' } };
  w.api = {
    dispatchBoard: async () => ({ items: [{ order, delivery }] }),
    listDrivers: async (opts) => { w.listCalls.push(opts); return typeof w.listResult === 'function' ? w.listResult() : w.listResult; },
    get: async () => ({ delivery }),
    subscribe: () => ({ close() {} })
  };
  w.boot(w.api, { seller: true });
  const nav = w.sb.LoumooSellerDispatch.open({ orderId: 'ord_1' });
  await settle(14);
  const orderPage = nav.records[nav.records.length - 1].page;
  buttonsIn(orderPage.footer).find((b) => b.label === 'Choose a rider').click();
  await settle(14);
  w.picker = () => nav.records[nav.records.length - 1].page;
  w.pickerView = () => nav.records[nav.records.length - 1].view;
  w.list = () => w.picker().content.children[2];
  return w;
}

async function testThePickerSubtitleNamesTheCustomersPick() {
  // The picker object had two `subtitle` keys and the later, unconditional one
  // won, so the seller was never told their customer's chosen rider comes first.
  const free = await pickerWorld({ drivers: [], summary: { registered: 1, available: 0 } });
  assert.ok(!/customer/.test(free.pickerView().subtitle), 'no pick, no mention of one: ' + free.pickerView().subtitle);
  const picked = await pickerWorld({ drivers: [], summary: { registered: 1, available: 0 } }, { preferredDriverId: 'rider_1' });
  const subtitle = picked.pickerView().subtitle;
  assert.ok(/^Online riders only\./.test(subtitle), 'still says it lists online riders only: ' + subtitle);
  assert.ok(/customer’s pick comes first/.test(subtitle), 'and that the customer\'s pick comes first: ' + subtitle);
}

async function testThePickerSaysWhyNoRiderIsListed() {
  // Riders exist, none is online: say so, and that they appear when they go online.
  let w = await pickerWorld({ drivers: [], summary: { registered: 3, available: 0 } });
  assert.deepStrictEqual(plain(w.listCalls), [{ deliveryId: 'dlv_1' }]);
  let empty = w.empties[w.empties.length - 1];
  assert.strictEqual(empty.title, 'No rider is online right now');
  assert.ok(/appear here as soon as they go online/.test(empty.body), empty.body);
  assert.strictEqual(empty.actionLabel, 'Check again');
  assert.strictEqual(w.pickerView().title, 'Choose a rider');
  assert.ok(/^Online riders only\./.test(w.pickerView().subtitle), 'the picker says it lists online riders only: ' + w.pickerView().subtitle);

  // "Check again" asks again, and the list shows the rider who has come online since.
  w.listResult = { drivers: [{ id: 'rider_1', name: 'Alain Mbarga', phone: '+237677123456', openDeliveries: 0 }], summary: { registered: 3, available: 1 } };
  empty.onAction();
  await settle(14);
  assert.strictEqual(w.listCalls.length, 2, 'it asked again');
  assert.strictEqual(w.empties.length, 1, 'and there is no empty state any more');
  const rows = [];
  walk(w.list(), (n) => { if (n.tag === 'button' && n.html.includes('ldx-row')) rows.push(n); });
  assert.strictEqual(rows.length, 1, 'the rider who came online is listed');
  assert.strictEqual(rows[0].querySelector('.ldx-row-title').textContent, 'Alain Mbarga');

  // Nobody registered at all: the old wording.
  for (const result of [{ drivers: [], summary: { registered: 0, available: 0 } }, { drivers: [] }, []]) {
    w = await pickerWorld(result);
    empty = w.empties[w.empties.length - 1];
    assert.strictEqual(empty.title, 'No riders yet', JSON.stringify(result));
    assert.ok(/Riders are added by the LOUMOO team/.test(empty.body));
    assert.strictEqual(empty.actionLabel, undefined, 'no "Check again" when nobody is registered');
  }

  // The old response shape (a bare list, or { drivers } with no summary) still lists riders.
  const rider = { id: 'rider_2', name: 'Bruno Nkoulou', phone: '+237699451102', openDeliveries: 1 };
  for (const result of [[rider], { drivers: [rider] }, { drivers: [rider], summary: { registered: 1, available: 1 } }]) {
    w = await pickerWorld(result);
    assert.strictEqual(w.empties.length, 0, 'riders listed: no empty state');
    const rows2 = [];
    walk(w.list(), (n) => { if (n.tag === 'button' && n.html.includes('ldx-row')) rows2.push(n); });
    assert.strictEqual(rows2.length, 1);
    assert.strictEqual(rows2[0].querySelector('.ldx-row-title').textContent, 'Bruno Nkoulou');
  }
}

async function testNoGlobalsLeak(before, fetchBefore) {
  assert.strictEqual(typeof P.createPresenceController, 'function');
  assert.throws(() => P.createPresenceController({}), /needs an api/);
  // The screen tests ran the real scripts in their own vm contexts: none of them touched this process, and
  // the one global the controller test replaces (fetch) is back.
  const added = Object.getOwnPropertyNames(global).filter((name) => !before.has(name));
  assert.deepStrictEqual(added, [], 'this suite left no global behind: ' + added.join(', '));
  assert.strictEqual(global.fetch, fetchBefore, 'fetch is restored');
}

/**
 * What ships. Vercel (scripts/assemble_public.js) and Railway (the Dockerfile) both publish
 * the COMMITTED `Commerce App.dc.html`: neither runs build_redesign.py. So the script tag has to
 * be in the committed shell, not only in the Python source, or the controller never loads in
 * production, no rider can ever go online and nothing can be offered to anyone. This pins both
 * places, and that the controller loads BEFORE the hub that uses it.
 */
function testTheControllerShipsInTheShellBeforeTheHub() {
  const root = path.resolve(__dirname, '../..');
  const tag = (name) => `<script defer src="./src/services/${name}.js"></script>`;
  for (const [label, file] of [['the build source', 'build_redesign.py'], ['the committed shell', 'Commerce App.dc.html']]) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const presence = text.indexOf(tag('riderPresence'));
    const hub = text.indexOf(tag('riderHub'));
    assert.ok(presence !== -1, `${label} loads riderPresence.js (the controller)`);
    assert.strictEqual(text.split(tag('riderPresence')).length - 1, 1, `${label} loads it exactly once`);
    assert.ok(hub !== -1 && presence < hub, `${label} loads the controller before the rider hub that uses it`);
  }
}

async function run() {
  console.log('  Testing the rider presence client (heartbeat, actions, card)...');
  testTheControllerShipsInTheShellBeforeTheHub();
  console.log('    ✓ The committed shell (what Vercel and Railway publish) and the build source both load the controller, once, before the rider hub.');
  const globalsBefore = new Set(Object.getOwnPropertyNames(global));
  const fetchBefore = global.fetch;
  await testNoTimerWhileOfflineOrPaused();
  await testTimerStartsOnlineAtTheServersInterval();
  await testTimerOnlyArmedByStart();
  await testBeatReportingOfflineStopsTheTimer();
  await testAnExpiredReasonSurvivesRefreshesUntilTheRiderActs();
  await testABeatNeverRaisesTheState();
  await testNeverTwoRequestsInFlight();
  await testVisibleAgainBeatsAtOnce();
  await testAuthErrorsStopEverything();
  await testNetworkErrorsKeepTheTimerAndGuessNothing();
  await testTheTimerNeverAsksForAPositionWithoutPermission();
  await testALocationFailureMeansNoPositionNeverAnError();
  await testStartStopAreIdempotentAndLeakFree();
  await testOnChangeFiresOnlyOnRealChanges();
  await testActionsReportWhatTheServerSays();
  await testAdoptedSnapshotsNeverGoBackInTime();
  await testRefreshAsksTheServer();
  await testWhatTheCardShows();
  await testNoRequestEverCarriesAStatusOrARider();
  await testAHungRequestDoesNotBlockTheQueue();
  console.log('    ✓ The heartbeat runs only while the server says online or busy, never overlaps (and a request that never answers cannot freeze it), never raises, never prompts for a position, and no request names a status or a rider.');
  await testTheCardShowsEachStateAndOnlyItsButtons();
  await testNoCardWhereAvailabilityIsNotKnown();
  await testTheOverviewIsTheOnlyReadOnTheRefresh();
  await testTappingTheButtonsRunsTheActionAndShowsItInFlight();
  await testARefusalReachesTheToastAndTheCardTellsTheTruth();
  await testAnOfferTellsARiderWhoCannotAcceptWhatToDo();
  await testClosingTheHubKeepsTheRiderOnlineAndTheScreenQuiet();
  await testASlowOverviewCannotReviveWhatTheRiderJustSwitchedOff();
  await testFocusStaysWithAKeyboardUserWhenTheCardRedraws();
  await testAHubOpenedAfterAccountChangeNeverShowsThePreviousRidersState();
  console.log('    ✓ The rider hub (the real script, a fake DOM): one availability card per state with only the buttons that apply, hints on offers, the server\'s refusal in the toast, a closed overlay leaves the heartbeat alone and shares no position, a stale overview cannot revive the card.');
  await testThePickerSaysWhyNoRiderIsListed();
  await testThePickerSubtitleNamesTheCustomersPick();
  console.log('    ✓ The seller\'s rider picker says "no rider is online right now" when riders exist but none is online, keeps the old wording when nobody is registered, and says when the customer\'s pick comes first.');
  await testNoGlobalsLeak(globalsBefore, fetchBefore);
}

module.exports = { run };
