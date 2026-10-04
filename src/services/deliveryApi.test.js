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

  // -- dispatch / rider / admin methods (v1.2): exact method, path and body -----
  const sent = [];
  global.fetch = async (url, opts = {}) => {
    sent.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
    return { ok: true, status: 200, json: async () => ({ success: true, data: { ok: true, users: [{ id: 'u1', full_name: 'Alain Mbarga', phone_number: '237600000001', email: 'a@x.cm', primary_role: 'customer', city: 'Douala' }] } }) };
  };
  const last = () => sent[sent.length - 1];
  const expect = async (label, call, method, pathEnd, body) => {
    await call();
    const s = last();
    assert.strictEqual(s.method, method, `${label}: method`);
    assert.ok(s.url.endsWith(pathEnd), `${label}: ${s.url} ends with ${pathEnd}`);
    assert.deepStrictEqual(s.body, body, `${label}: body`);
  };
  await expect('dispatchBoard', () => deliveryApi.dispatchBoard(), 'GET', '/api/v1/deliveries/dispatch?view=active', undefined);
  await expect('dispatchBoard completed', () => deliveryApi.dispatchBoard({ view: 'completed', limit: 20 }), 'GET', '/dispatch?view=completed&limit=20', undefined);
  await expect('create', () => deliveryApi.create('ord_1', { pickup: { label: 'Shop' } }), 'POST', '/api/v1/deliveries/', { orderId: 'ord_1', pickup: { label: 'Shop' } });
  await expect('listDrivers', () => deliveryApi.listDrivers(), 'GET', '/api/v1/deliveries/drivers', undefined);
  await expect('listDrivers for a delivery', () => deliveryApi.listDrivers({ deliveryId: 'dlv_1' }), 'GET', '/drivers?deliveryId=dlv_1', undefined);
  await expect('assign', () => deliveryApi.assign('dlv_1', 'rider_1'), 'POST', '/dlv_1/assign', { driverId: 'rider_1' });
  await expect('autoAssign', () => deliveryApi.autoAssign('dlv_1'), 'POST', '/dlv_1/auto-assign', {});
  await expect('cancel', () => deliveryApi.cancel('dlv_1', 'Out of stock'), 'POST', '/dlv_1/cancel', { reason: 'Out of stock' });
  await expect('cancel without reason', () => deliveryApi.cancel('dlv_1'), 'POST', '/dlv_1/cancel', {});
  await expect('riderOverview', () => deliveryApi.riderOverview(), 'GET', '/api/v1/deliveries/driver/me', undefined);
  await expect('accept', () => deliveryApi.accept('dlv_1'), 'POST', '/dlv_1/accept', {});
  await expect('decline', () => deliveryApi.decline('dlv_1'), 'POST', '/dlv_1/decline', {});
  await expect('setStatus', () => deliveryApi.setStatus('dlv_1', 'picked_up'), 'POST', '/dlv_1/status', { status: 'picked_up' });
  await expect('setStatus failed', () => deliveryApi.setStatus('dlv_1', 'failed', 'Customer absent'), 'POST', '/dlv_1/status', { status: 'failed', note: 'Customer absent' });
  await expect('postLocation', () => deliveryApi.postLocation('dlv_1', { lat: 4.05, lng: 9.7, speedKmh: -3, heading: 370, accuracyM: 12 }), 'POST', '/dlv_1/location',
    { lat: 4.05, lng: 9.7, speedKmh: 0, heading: 10, accuracyM: 12 });
  await expect('postLocation minimal', () => deliveryApi.postLocation('dlv_1', { lat: 4.05, lng: 9.7, speedKmh: null, heading: NaN }), 'POST', '/dlv_1/location', { lat: 4.05, lng: 9.7 });
  await expect('complete', () => deliveryApi.complete('dlv_1', 482), 'POST', '/dlv_1/complete', { code: '482' });
  await expect('riderRoster', () => deliveryApi.riderRoster(), 'GET', '/drivers?status=all', undefined);
  await expect('registerDriver', () => deliveryApi.registerDriver('u1', { name: 'Alain', phone: '+237600000001' }), 'POST', '/drivers/u1', { name: 'Alain', phone: '+237600000001' });
  await expect('suspend', () => deliveryApi.registerDriver('u1', { name: 'Alain', phone: '+237600000001', status: 'suspended' }), 'POST', '/drivers/u1', { name: 'Alain', phone: '+237600000001', status: 'suspended' });
  ok('every dispatch, rider and admin call sends the documented method, path and body');

  const users = await deliveryApi.searchUsers('alain');
  assert.ok(last().url.endsWith('/api/v1/admin/users?search=alain&limit=20'), 'searchUsers hits the admin directory, not the delivery API: ' + last().url);
  assert.deepStrictEqual(users, [{ id: 'u1', name: 'Alain Mbarga', email: 'a@x.cm', phone: '237600000001', role: 'customer', city: 'Douala' }]);
  ok('searchUsers calls the admin directory and normalises the rows');

  console.log('\nALL ' + passed + ' DELIVERY FRONTEND CLIENT CHECKS PASSED');
}

run().then(() => process.exit(0)).catch((err) => { console.error('TEST FAILED:', err); process.exit(1); });
