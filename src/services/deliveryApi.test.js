/**
 * Node test for src/services/deliveryApi.js — the parts that have no DOM:
 * SSE frame parsing, the {success,data} envelope unwrap, typed error mapping,
 * and the stream→poll fallback. Browser-only bits (MapLibre, the overlay DOM)
 * are out of scope here. Run: node src/services/deliveryApi.test.js
 */
'use strict';
const assert = require('assert');
const { DeliveryApiClient, deliveryApi } = require('./deliveryApi.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (label) => { passed += 1; console.log('  ✓ ' + label); };

async function run() {
  console.log('DELIVERY FRONTEND API CLIENT TEST');

  // -- _parseSseFrame -------------------------------------------------------
  const c = new DeliveryApiClient();
  assert.deepStrictEqual(
    c._parseSseFrame('event: status\ndata: {"status":"picked_up","etaMinutes":9}'),
    { type: 'status', data: { status: 'picked_up', etaMinutes: 9 } });
  ok('parses an event+data frame');
  assert.deepStrictEqual(c._parseSseFrame('event: end\ndata: {"reason":"complete"}'),
    { type: 'end', data: { reason: 'complete' } });
  ok('parses the end frame');
  assert.strictEqual(c._parseSseFrame(': keep-alive'), null, 'a comment-only frame is ignored');
  ok('ignores a keep-alive comment frame');
  assert.deepStrictEqual(c._parseSseFrame('retry: 5000'), null, 'a retry-only frame yields no event');
  ok('ignores a retry-only frame');

  // -- envelope unwrap + methods -------------------------------------------
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({ success: true, status: 'success', data: { delivery: { id: 'dlv_1', status: 'assigned' } } }) };
  };
  let res = await deliveryApi.getByOrder('ord_42');
  assert.deepStrictEqual(res, { delivery: { id: 'dlv_1', status: 'assigned' } }, 'unwraps envelope.data');
  assert.ok(calls[0].url.endsWith('/api/v1/deliveries/by-order/ord_42'), 'calls the by-order path');
  ok('getByOrder unwraps the data envelope and hits the right path');

  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { code: '4821', digits: 4, attemptsRemaining: 5 } }) });
  assert.deepStrictEqual(await deliveryApi.getCode('dlv_1'), { code: '4821', digits: 4, attemptsRemaining: 5 });
  ok('getCode returns the code payload');

  // -- typed error mapping --------------------------------------------------
  global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: { code: 'PERMISSION_DENIED', message: 'Only the buyer may read the code.' } }) });
  try {
    await deliveryApi.getCode('dlv_1');
    assert.fail('should have thrown on 403');
  } catch (err) {
    assert.strictEqual(err.status, 403);
    assert.strictEqual(err.code, 'PERMISSION_DENIED');
    assert.ok(/Only the buyer/.test(err.message));
  }
  ok('maps an error response to a typed Error (status + code + message)');

  // -- subscribe: 501 stream -> polling fallback ---------------------------
  let polls = 0;
  global.fetch = async (url) => {
    if (String(url).endsWith('/stream')) return { ok: false, status: 501, json: async () => ({ error: { code: 'STREAM_UNSUPPORTED' } }) };
    polls += 1;
    return { ok: true, status: 200, json: async () => ({ success: true, data: { delivery: { id: 'dlv_1', status: 'delivered', updatedAt: '2026-10-03T10:00:00Z', etaMinutes: 0, distanceKm: 0, lastLocation: null } } }) };
  };
  const events = { status: [], ended: null };
  const handle = deliveryApi.subscribe('dlv_1', {
    onStatus: (e) => events.status.push(e.status),
    onEnd: (reason) => { events.ended = reason; }
  });
  await sleep(150); // let the stream probe 501 then the first poll run
  handle.close();
  assert.ok(polls >= 1, 'the 501 stream fell back to polling GET /:id');
  assert.ok(events.status.includes('delivered'), 'polling reported the delivered status');
  assert.strictEqual(events.ended, 'complete', 'a terminal status ended the subscription');
  ok('subscribe falls back to polling on a 501 stream and ends on a terminal status');

