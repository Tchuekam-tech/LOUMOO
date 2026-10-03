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

