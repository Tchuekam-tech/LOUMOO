/**
 * LOUMOO Unit Tests - The buyer's delivery tracking screen
 * ---------------------------------------------------------------------------
 * src/services/deliveryTrackingScreen.js is browser-only code, so it runs here
 * against a small fake DOM (tests/unit/support/fakeDom.js) with a hand-driven
 * clock, a stubbed delivery API and a stubbed MapLibre.
 *
 * What a buyer actually saw on production: "Track delivery / Loading... / Loading
 * map..." forever, with three empty white bars. The order had no delivery yet,
 * which is the NORMAL first state (the seller is arranging a rider), the server
 * answered 404, and the screen called waitForSeller(), a function that had been
 * lost from the file, so it threw inside its own error handler and stopped. The
 * map never loaded because nothing ever asked for it.
 *
 *   1. No delivery yet (a 404, or an empty answer) is a waiting screen that checks
 *      again, never an error and never a hang, and downloads no map for nothing.
 *   2. A real failure is said plainly and can be retried in place.
 *   3. Once there is a delivery, the map library starts downloading at once, in
 *      parallel with whatever else is loading; a delivery the order screen has just
 *      read paints immediately and refreshes in the background.
 *   4. A failed library download is retried on the next open (it used to wait for
 *      ever on the dead script tag) and a slow one is explained, then abandoned.
 *   5. `hidden` really hides: the stylesheet no longer shows empty ETA/driver cards.
 *   6. The API client gives up on a read that never answers, and never on a write.
 *   7. The order screen primes and warms the tracker only when it can pay off.
 */
'use strict';

require('../setup');
const assert = require('assert');
const path = require('path');
const { createDocument, createClock } = require('./support/fakeDom');

const MODULE = path.resolve(__dirname, '../../src/services/deliveryTrackingScreen.js');
const CIRCUIT = path.resolve(__dirname, '../../src/services/deliveryCircuit.js');
const settle = () => new Promise((resolve) => setImmediate(resolve));

const DELIVERY = {
  id: 'dlv_1', orderId: 'ord_1', orderNumber: 'KM-1', status: 'accepted', timeline: [],
  dropoff: { location: { lat: 4.05, lng: 9.7 } }, lastLocation: null
};
const notFound = () => Object.assign(new Error('Delivery was not found.'), { status: 404, code: 'NOT_FOUND' });
const failure = (message) => Object.assign(new Error(message), { status: 500, code: 'API_ERROR' });

const GLOBALS = ['window', 'document', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame',
  'deliveryApi', 'maplibregl', 'LoumooDeliveryTracking', 'LoumooCircuit'];

/**
 * A fresh page: the overlay module loaded into a fake document, with `responses`
 * queued per API method (a function returning a promise, used in order).
 */
function boot(responses = {}) {
  const saved = {};
  for (const k of GLOBALS) saved[k] = Object.getOwnPropertyDescriptor(global, k);
  // A rejection nobody handles is a screen that silently stopped: collect them, fail on them.
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  const doc = createDocument();
  const clock = createClock();
  const scripts = [];
  doc.onAppend = (el) => { if (el.tagName === 'SCRIPT') scripts.push(el); };

  const queues = {};
  const calls = { getByOrder: 0, get: 0 };
  const api = {};
  for (const method of ['getByOrder', 'get']) {
    queues[method] = [...(responses[method] || [])];
    api[method] = () => {
      calls[method] += 1;
      const next = queues[method].shift();
      if (!next) return Promise.reject(failure(`unexpected ${method} call #${calls[method]}`));
      return next();
    };
  }

  global.window = global;
  global.document = doc;
  global.setTimeout = clock.setTimeout;
  global.clearTimeout = clock.clearTimeout;
  global.requestAnimationFrame = () => 0;
  global.cancelAnimationFrame = () => {};
  global.deliveryApi = api;
  delete global.maplibregl;
  delete global.LoumooDeliveryTracking;
  delete global.LoumooCircuit;

  delete require.cache[MODULE];
  require(MODULE);

  return {
    doc, clock, api, calls, scripts, unhandled,
    preconnects: () => doc.head.children.filter((c) => c.rel === 'preconnect').map((c) => c.href),
    tracking: global.LoumooDeliveryTracking,
    root: () => global.LoumooDeliveryTracking._state.root,
    sel: (s) => global.LoumooDeliveryTracking._state.root.querySelector(s),
    restore() {
      process.removeListener('unhandledRejection', onUnhandled);
      for (const k of GLOBALS) {
        if (saved[k]) Object.defineProperty(global, k, saved[k]); else delete global[k];
      }
    }
  };
}

/** MapLibre as far as the overlay uses it, recording every map it is asked for. */
function installMapLibre() {
  const maps = [];
  class Map {
    constructor(opts) { this.opts = opts; this.handlers = {}; maps.push(this); }
    on(evt, fn) { (this.handlers[evt] = this.handlers[evt] || []).push(fn); }
    fire(evt) { (this.handlers[evt] || []).forEach((fn) => fn()); }
    addControl() {}
    getSource() { return null; }
    addSource() {}
    addLayer() {}
    remove() { this.removed = true; }
    fitBounds() {}
    easeTo() {}
    setStyle() {}
  }
  class Marker {
    setLngLat() { return this; }
    addTo() { return this; }
    setRotation() { return this; }
  }
  global.maplibregl = { Map, Marker, NavigationControl: class {}, LngLatBounds: class { extend() { return this; } } };
  return maps;
}

async function testNoDeliveryYetIsAWaitingScreen() {
  const env = boot({ getByOrder: [() => Promise.reject(notFound()), () => Promise.resolve({ delivery: DELIVERY })] });
  try {
    env.tracking.open({ orderId: 'ord_1' });
    await settle();

    assert.deepStrictEqual(env.unhandled.map(String), [], 'nothing blew up behind the screen (it used to: waitForSeller was not defined)');
    assert.strictEqual(env.sel('.dt-sub').textContent, 'Waiting for the seller', 'a 404 for an order with no delivery yet says so');
    assert.strictEqual(env.sel('[data-dt-pill]').textContent, 'WAITING');
    assert.strictEqual(env.sel('[data-dt-map]').hidden, true, 'no empty map for a delivery that does not exist yet');
    assert.strictEqual(env.sel('[data-dt-error]').hidden, true, 'and it is not presented as an error');
    assert.deepStrictEqual(env.clock.delays(), [8000], 'it checks again in a few seconds');
    assert.strictEqual(env.scripts.length, 0, 'and downloads no map library for a delivery that does not exist');

    // The seller arranges a rider: the next check finds it and the screen comes alive.
    env.clock.advance(8000);
    await settle();
    assert.strictEqual(env.sel('.dt-sub').textContent, 'Order KM-1');
    assert.strictEqual(env.sel('[data-dt-map]').hidden, false, 'the map appears once there is something to show');
    assert.strictEqual(env.scripts.length, 1, 'and only then is the map library requested');
    assert.strictEqual(env.sel('[data-dt-error]').hidden, true);
  } finally { env.restore(); }

  // An answer with no delivery in it is the same state, not a crash.
  const empty = boot({ getByOrder: [() => Promise.resolve({ delivery: null })] });
  try {
    empty.tracking.open({ orderId: 'ord_1' });
    await settle();
    assert.strictEqual(empty.sel('.dt-sub').textContent, 'Waiting for the seller');
    assert.strictEqual(empty.sel('[data-dt-pill]').textContent, 'WAITING');
  } finally { empty.restore(); }

  // Closing stops the checking: nothing is left running behind a screen that is gone.
  const closed = boot({ getByOrder: [() => Promise.reject(notFound())] });
  try {
    closed.tracking.open({ orderId: 'ord_1' });
    await settle();
    closed.tracking.close();
    assert.deepStrictEqual(closed.clock.delays(), [], 'no timer survives close()');
  } finally { closed.restore(); }
}

async function testARealFailureCanBeRetriedInPlace() {
  const env = boot({ getByOrder: [() => Promise.reject(failure('The server is having a bad day')), () => Promise.resolve({ delivery: DELIVERY })] });
  try {
    env.tracking.open({ orderId: 'ord_1' });
    await settle();
    const error = env.sel('[data-dt-error]');
    assert.strictEqual(error.hidden, false);
    assert.ok(/bad day/.test(error.innerHTML), 'the failure is said plainly');
    assert.strictEqual(env.sel('[data-dt-pill]').textContent, 'UNAVAILABLE');
    const retry = error.querySelector('.dt-retry');
    assert.ok(retry, 'with a way to try again');

    retry.click();
    await settle();
    assert.strictEqual(env.sel('.dt-sub').textContent, 'Order KM-1');
    assert.strictEqual(error.hidden, true, 'the error goes away once it works');
    assert.strictEqual(env.calls.getByOrder, 2);
  } finally { env.restore(); }
}

async function testTheMapStartsEarlyAndTheFirstPaintIsInstant() {
  // A delivery the order screen has just read is painted at once; the map library
  // starts downloading in the same breath, before any request has been answered.
  const primed = boot({ get: [() => Promise.resolve({ delivery: DELIVERY })] });
  try {
    primed.tracking.prime(DELIVERY);
    primed.tracking.open({ orderId: 'ord_1' });
    assert.strictEqual(primed.scripts.length, 1, 'the map library is requested synchronously on open');
    assert.deepStrictEqual(primed.preconnects(), ['https://cdnjs.cloudflare.com', 'https://server.arcgisonline.com'],
      'and the connections to the library host and the tile host are opened before the first byte is needed');
    await settle();
    assert.strictEqual(primed.sel('.dt-sub').textContent, 'Order KM-1', 'the screen is filled in without waiting for the network');
    assert.strictEqual(primed.calls.getByOrder, 0, 'no second round trip for the first paint');
    assert.strictEqual(primed.calls.get, 1, 'a background refresh follows');
    assert.strictEqual(primed.scripts.length, 1, 'and the library is not requested twice');
  } finally { primed.restore(); }

  // A primed delivery is a head start, not a source of truth: a minute later it is not used.
  const stale = boot({ getByOrder: [() => Promise.resolve({ delivery: DELIVERY })] });
  const realNow = Date.now;
  try {
    stale.tracking.prime(DELIVERY);
    Date.now = () => realNow() + 61000;
    stale.tracking.open({ orderId: 'ord_1' });
    await settle();
    assert.strictEqual(stale.calls.getByOrder, 1, 'a stale delivery is read again');
  } finally { Date.now = realNow; stale.restore(); }

  // Without a primed delivery the library still starts the moment the data says there is a map to show.
  const cold = boot({ getByOrder: [() => Promise.resolve({ delivery: DELIVERY })] });
  try {
    cold.tracking.open({ orderId: 'ord_1' });
    assert.strictEqual(cold.scripts.length, 0, 'nothing is downloaded before there is a delivery');
    assert.deepStrictEqual(cold.preconnects(), ['https://cdnjs.cloudflare.com', 'https://server.arcgisonline.com'],
      'but the connections are already being opened while the delivery is fetched');
    await settle();
    assert.strictEqual(cold.scripts.length, 1);
    const maps = installMapLibre();
    cold.scripts[0].onload();
    await settle();
    assert.strictEqual(maps.length, 1, 'the map is built as soon as the library arrives');
    assert.strictEqual(maps[0].opts.style.sources.basemap.type, 'raster');
    maps[0].fire('style.load');
    assert.strictEqual(cold.sel('[data-dt-mapmsg]').style.display, 'none', 'the loading message goes away');
    assert.deepStrictEqual(cold.clock.delays().filter((ms) => ms === 8000 || ms === 20000), [], 'and so do the slow-map timers');
  } finally { cold.restore(); }
}

async function testAFailedDownloadIsRetriedAndASlowOneExplained() {
  const env = boot({ getByOrder: [() => Promise.resolve({ delivery: DELIVERY }), () => Promise.resolve({ delivery: DELIVERY })] });
  try {
    env.tracking.open({ orderId: 'ord_1' });
    await settle();
    assert.strictEqual(env.scripts.length, 1);
    env.scripts[0].onerror();
    await settle();
    assert.ok(/Live map unavailable/.test(env.sel('[data-dt-mapmsg]').textContent), 'a failed download is explained');
    assert.ok(/status and ETA below/i.test(env.sel('[data-dt-mapmsg]').textContent), 'and the rest of the screen is said to be fine');
    assert.strictEqual(env.doc.head.children.includes(env.scripts[0]), false, 'the dead script tag is removed');

    env.tracking.close();
    env.tracking.open({ orderId: 'ord_1' });
    await settle();
    assert.strictEqual(env.scripts.length, 2, 'the next open downloads again instead of waiting on a tag that already failed');
    const maps = installMapLibre();
    env.scripts[1].onload();
    await settle();
    assert.strictEqual(maps.length, 1, 'and the map appears');
  } finally { env.restore(); }

  // A download that never finishes is explained at 8 s and 20 s, and given up on at 30 s.
  const slow = boot({ getByOrder: [() => Promise.resolve({ delivery: DELIVERY })] });
  try {
    slow.tracking.open({ orderId: 'ord_1' });
    await settle();
    const msg = slow.sel('[data-dt-mapmsg]');
    assert.ok(/Loading map/.test(msg.textContent) || msg.textContent === '', 'it starts as the usual loading text');
    slow.clock.advance(8000);
    assert.strictEqual(msg.textContent, 'Still loading the map…');
    slow.clock.advance(12000);
    assert.ok(/slow on this connection/.test(msg.textContent) && /status and ETA below/i.test(msg.textContent));
    slow.clock.advance(10000);
    await settle();
    assert.ok(/Live map unavailable/.test(msg.textContent), 'after 30 s it stops waiting');
    assert.strictEqual(slow.doc.head.children.includes(slow.scripts[0]), false);
  } finally { slow.restore(); }
}

async function testHiddenReallyHides() {
  const env = boot({ getByOrder: [() => Promise.reject(notFound())] });
  try {
    env.tracking.open({ orderId: 'ord_1' });
    await settle();
    const style = env.doc.head.children.find((c) => c.tagName === 'STYLE');
    assert.ok(style, 'the overlay injects its stylesheet');
    // .dt-eta and .dt-driver set display:flex, which beats the browser's [hidden] rule, so a
    // card with nothing in it stayed on screen as an empty white bar.
    assert.ok(/#loumoo-dt \[hidden\]\s*\{\s*display:\s*none\s*!important/.test(style.textContent), 'an element marked hidden is hidden, whatever display it sets');
  } finally { env.restore(); }
}

async function testTheApiClientGivesUpOnAReadThatNeverAnswers() {
  const { DeliveryApiClient } = require('../../src/services/deliveryApi.js');
  const realFetch = global.fetch;
  const seen = [];
  try {
    const client = new DeliveryApiClient('http://api.test/api/v1/deliveries');
    client.readTimeoutMs = 40;
    global.fetch = (url, opts) => {
      seen.push(opts);
      return new Promise((resolve, reject) => {
        if (opts && opts.signal) opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    };
    await assert.rejects(client.getByOrder('ord_1'), (e) => e.code === 'TIMEOUT' && e.status === 0 && /longer than usual/.test(e.message), 'a read that never answers fails with a plain, typed timeout');

    // A write is never given a deadline: an aborted write may still have happened.
    global.fetch = (url, opts) => { seen.push(opts); return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { done: true } }) }); };
    const result = await client._request('/ord_1/cancel', { method: 'POST', body: '{}' });
    assert.deepStrictEqual(result, { done: true });
    assert.strictEqual(seen[seen.length - 1].signal, undefined, 'a POST carries no abort signal');

    // A read that answers in time is untouched.
    const quick = await client._request('/ord_1');
    assert.deepStrictEqual(quick, { done: true });
  } finally {
    if (realFetch === undefined) delete global.fetch; else global.fetch = realFetch;
  }
}

async function testTheOrderScreenPrimesAndWarmsOnlyWhenItCanPayOff() {
  const saved = Object.getOwnPropertyDescriptor(global, 'LoumooDeliveryTracking');
  const savedWindow = Object.getOwnPropertyDescriptor(global, 'window');
  try {
    delete require.cache[CIRCUIT];
    const circuit = require(CIRCUIT);
    const speculate = (circuit && circuit.speculateTracking) || (global.LoumooCircuit && global.LoumooCircuit.speculateTracking);
    assert.strictEqual(typeof speculate, 'function', 'deliveryCircuit exposes the speculation step');

    const log = [];
    global.LoumooDeliveryTracking = { prime: (d) => log.push(['prime', d.id]), warm: (speculative) => log.push(['warm', speculative]) };
    for (const status of ['assigned', 'accepted', 'picked_up', 'arrived']) {
      log.length = 0;
      speculate({ id: 'd', status });
      assert.deepStrictEqual(log, [['prime', 'd'], ['warm', true]], `${status}: a rider is on it, so the map is worth warming`);
    }
    for (const status of ['pending_assignment', 'delivered', 'failed', 'cancelled']) {
      log.length = 0;
      speculate({ id: 'd', status });
      assert.deepStrictEqual(log, [['prime', 'd']], `${status}: no live map to wait for, so nothing is downloaded`);
    }
    log.length = 0;
    speculate(null);
    assert.deepStrictEqual(log, [], 'no delivery, nothing to do');

    delete global.LoumooDeliveryTracking;
    assert.doesNotThrow(() => speculate({ id: 'd', status: 'accepted' }), 'the tracker not being loaded is not an error');
    global.LoumooDeliveryTracking = { prime() { throw new Error('boom'); }, warm() { throw new Error('boom'); } };
    assert.doesNotThrow(() => speculate({ id: 'd', status: 'accepted' }), 'and a failure in it never breaks the order screen');
  } finally {
    if (saved) Object.defineProperty(global, 'LoumooDeliveryTracking', saved); else delete global.LoumooDeliveryTracking;
    if (savedWindow) Object.defineProperty(global, 'window', savedWindow); else delete global.window;
    delete global.LoumooCircuit;
  }
}

async function run() {
  console.log('  Testing the buyer\'s delivery tracking screen...');
  await testNoDeliveryYetIsAWaitingScreen();
  await testARealFailureCanBeRetriedInPlace();
  await testTheMapStartsEarlyAndTheFirstPaintIsInstant();
  await testAFailedDownloadIsRetriedAndASlowOneExplained();
  await testHiddenReallyHides();
  await testTheApiClientGivesUpOnAReadThatNeverAnswers();
  await testTheOrderScreenPrimesAndWarmsOnlyWhenItCanPayOff();
  console.log('    ✓ Tracking screen: waits for the seller, retries, loads the map early, explains a slow one, hides what is hidden.');
}

module.exports = { run };
