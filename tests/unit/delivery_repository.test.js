/**
 * LOUMOO — Delivery repository queries
 * ---------------------------------------------------------------------------
 * The two read queries behind offer expiry and rider workload, driven through a
 * stand-in for the Supabase query builder over plain rows. This proves the
 * filters, ordering, limits and column mapping the repository asks for, and that
 * the in-memory backend answers identically. It does NOT prove PostgREST
 * semantics: the DB-backed integration suite is the check for that.
 */

require('../setup');

const assert = require('assert');
const logger = require('../../server/shared/logging/logger');
const { DeliveryRepository } = require('../../server/modules/delivery/infrastructure/DeliveryRepository');
const { WORKLOAD_STATUSES, OFFER_EXPIRED_NOTE } = require('../../server/modules/delivery/domain/Delivery');

/**
 * Minimal Supabase query-builder stand-in. Mirrors SQL where it matters here:
 * a comparison against NULL is never true, and `select(cols)` returns only those
 * columns, so a query that forgets a column it needs fails loudly.
 */
function stubDb(rows, { error = null, events = [] } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.ok(table === 'deliveries' || table === 'delivery_events', `unexpected table ${table}`);
      const source = table === 'deliveries' ? rows : events;
      const q = { filters: [], columns: '*', order: null, max: null };
      const log = (op, ...args) => { calls.push([op, ...args]); return q; };
      q.select = (cols) => { q.columns = cols || '*'; return log('select', cols); };
      q.eq = (col, val) => { q.filters.push((r) => r[col] === val); return log('eq', col, val); };
      q.in = (col, vals) => { q.filters.push((r) => vals.includes(r[col])); return log('in', col, vals); };
      q.not = (col, op, val) => {
        assert.strictEqual(op, 'is', 'only "not ... is null" is stubbed');
        q.filters.push((r) => r[col] !== null && r[col] !== undefined && val === null);
        return log('not', col, op, val);
      };
      q.lte = (col, val) => {
        q.filters.push((r) => r[col] !== null && r[col] !== undefined && Date.parse(r[col]) <= Date.parse(val));
        return log('lte', col, val);
      };
      q.gte = (col, val) => {
        q.filters.push((r) => r[col] !== null && r[col] !== undefined && Date.parse(r[col]) >= Date.parse(val));
        return log('gte', col, val);
      };
      q.order = (col, opts = {}) => { q.order = { col, ascending: opts.ascending !== false }; return log('order', col, opts); };
      q.limit = (n) => { q.max = n; return log('limit', n); };
      q.then = (resolve) => {
        if (error) return resolve({ data: null, error });
        let out = source.filter((r) => q.filters.every((f) => f(r)));
        if (q.order) {
          const { col, ascending } = q.order;
          out = [...out].sort((a, b) => (Date.parse(a[col]) - Date.parse(b[col])) * (ascending ? 1 : -1));
        }
        if (q.max != null) out = out.slice(0, q.max);
        if (q.columns !== '*') {
          const wanted = q.columns.split(',').map((c) => c.trim());
          out = out.map((r) => Object.fromEntries(wanted.map((c) => [c, r[c]])));
        }
        return resolve({ data: out, error: null });
      };
      return q;
    }
  };
}

const row = (id, status, assignedAt, driverId = 'rider_1') => ({
  id, order_id: `ord_${id}`, buyer_id: 'b', seller_id: 's', driver_id: driverId, status,
  pickup: {}, dropoff: {}, assigned_at: assignedAt, created_at: 't', updated_at: 't'
});

async function run() {
  console.log('  Testing Delivery repository queries...');

  // ----------------------------------------------------------- findStaleOffers
  {
    const rows = [
      row('a', 'assigned', '2026-10-03T09:00:00.000Z'),
      row('b', 'assigned', '2026-10-03T09:50:00.000Z'),
      row('c', 'accepted', '2026-10-03T08:00:00.000Z'),
      row('d', 'assigned', null),
      row('e', 'assigned', '2026-10-03T08:30:00.000Z'),
      row('f', 'pending_assignment', '2026-10-03T07:00:00.000Z', null)
    ];
    const db = stubDb(rows);
    const repo = new DeliveryRepository({ db });
    const cutoff = '2026-10-03T09:30:00.000Z';

    const stale = await repo.findStaleOffers(cutoff);
    assert.deepStrictEqual(stale.map((d) => d.id), ['e', 'a'], 'only assigned offers at or before the cutoff, oldest first');
    assert.strictEqual(stale[0].assignedAt, '2026-10-03T08:30:00.000Z', 'rows are mapped to camelCase records');
    assert.strictEqual(stale[0].orderId, 'ord_e');
    assert.ok(db.calls.some(([op, col, val]) => op === 'eq' && col === 'status' && val === 'assigned'),
      'it filters on status = assigned, so an accepted job can never be returned');
    assert.ok(db.calls.some(([op, col]) => op === 'lte' && col === 'assigned_at'), 'it compares assigned_at with the cutoff');

    assert.deepStrictEqual((await repo.findStaleOffers(cutoff, { limit: 1 })).map((d) => d.id), ['e'], 'the limit is applied after the ordering');
    assert.deepStrictEqual((await repo.findStaleOffers('2026-10-03T08:00:00.000Z')).map((d) => d.id), [], 'nothing is stale before the oldest offer');
    assert.deepStrictEqual((await repo.findStaleOffers('2026-10-03T08:30:00.000Z')).map((d) => d.id), ['e'], 'the cutoff itself is inclusive');

    const callsBefore = db.calls.length;
    assert.deepStrictEqual(await repo.findStaleOffers('not a date'), [], 'an unparseable cutoff matches nothing');
    assert.deepStrictEqual(await repo.findStaleOffers(undefined), []);
    assert.strictEqual(db.calls.length, callsBefore, 'and does not even query');

    // The in-memory backend must answer the same question the same way.
    const memory = new DeliveryRepository({ db: null });
    for (const r of rows) {
      await memory.insertDelivery({
        id: r.id, orderId: r.order_id, buyerId: 'b', sellerId: 's', driverId: r.driver_id, status: r.status,
        pickup: {}, dropoff: {}, assignedAt: r.assigned_at, createdAt: 't', updatedAt: 't'
      });
    }
    assert.deepStrictEqual((await memory.findStaleOffers(cutoff)).map((d) => d.id), ['e', 'a'], 'memory matches the database path');
    assert.deepStrictEqual((await memory.findStaleOffers(cutoff, { limit: 1 })).map((d) => d.id), ['e']);
    assert.deepStrictEqual((await memory.findStaleOffers('2026-10-03T08:30:00.000Z')).map((d) => d.id), ['e']);
    assert.deepStrictEqual(await memory.findStaleOffers('garbage'), []);

    // A failing query degrades to memory outside production (and never throws here).
    const broken = new DeliveryRepository({ db: stubDb(rows, { error: { code: 'XX000', message: 'boom' } }) });
    const originalError = logger.error;
    const originalWarnQuiet = logger.warn;
    logger.error = () => {};
    logger.warn = () => {};
    try {
      assert.deepStrictEqual(await broken.findStaleOffers(cutoff), [], 'a database failure falls back to the (empty) memory store in test');
    } finally {
      logger.error = originalError;
      logger.warn = originalWarnQuiet;
    }
  }

  // ----------------------------------------------------------- countOpenByDriver
  {
    const rows = [
      row('1', 'assigned', 't', 'rider_1'),
      row('2', 'accepted', 't', 'rider_1'),
      row('3', 'picked_up', 't', 'rider_2'),
      row('4', 'arrived', 't', 'rider_2'),
      row('5', 'failed', 't', 'rider_2'),
      row('6', 'delivered', 't', 'rider_1'),
      row('7', 'cancelled', 't', 'rider_3'),
      row('8', 'pending_assignment', null, null)
    ];
    const db = stubDb(rows);
    const repo = new DeliveryRepository({ db });
    const expected = [['rider_1', 2], ['rider_2', 2]];

    const counts = await repo.countOpenByDriver();
    assert.deepStrictEqual([...counts.entries()].sort(), expected,
      'assigned/accepted/picked_up/arrived count; failed, delivered, cancelled and unassigned do not');
    assert.strictEqual(counts.get('rider_3'), undefined, 'a rider with nothing open is absent, not 0');
    const inCall = db.calls.find(([op, col]) => op === 'in' && col === 'status');
    assert.ok(inCall, 'it filters by status');
    assert.deepStrictEqual([...inCall[2]].sort(), [...WORKLOAD_STATUSES].sort(), 'with exactly the workload statuses');
    assert.ok(db.calls.some(([op, col]) => op === 'select' && col === 'driver_id'), 'it reads only driver_id, not whole rows');

    const memory = new DeliveryRepository({ db: null });
    for (const r of rows) {
      await memory.insertDelivery({
        id: r.id, orderId: r.order_id, buyerId: 'b', sellerId: 's', driverId: r.driver_id, status: r.status,
        pickup: {}, dropoff: {}, createdAt: 't', updatedAt: 't'
      });
    }
    assert.deepStrictEqual([...(await memory.countOpenByDriver()).entries()].sort(), expected, 'memory matches the database path');

    // The row cap is loud, not silent.
    const many = Array.from({ length: 1000 }, (_, i) => row(`m${i}`, 'assigned', 't', 'rider_9'));
    const warnings = [];
    const originalWarn = logger.warn;
    logger.warn = (m) => warnings.push(String(m));
    try {
      const capped = await new DeliveryRepository({ db: stubDb(many) }).countOpenByDriver();
      assert.strictEqual(capped.get('rider_9'), 1000, 'the cap is the platform row limit, so reaching it is detectable');
      assert.ok(warnings.some((w) => /cap/.test(w)), 'hitting the row cap is logged');
      warnings.length = 0;
      await repo.countOpenByDriver();
      assert.strictEqual(warnings.length, 0, 'a normal count logs nothing');
    } finally {
      logger.warn = originalWarn;
    }
  }

  // ----------------------------------------------------------- countRecentLapses
  {
    const NOTE = OFFER_EXPIRED_NOTE;
    const evt = (actorId, at, { status = 'pending_assignment', prev = 'assigned', note = NOTE } = {}) => ({
      delivery_id: 'dlv_x', status, previous_status: prev, actor_id: actorId, note, created_at: at
    });
    const events = [
      evt('rider_1', '2026-10-03T09:30:00.000Z'),
      evt('rider_1', '2026-10-03T09:45:00.000Z'),
      evt('rider_2', '2026-10-03T09:50:00.000Z'),
      evt('rider_3', '2026-10-03T08:00:00.000Z'),                                  // too old
      evt('rider_4', '2026-10-03T09:40:00.000Z', { note: 'Rider declined' }),       // a decline is an answer, not a lapse
      evt('rider_5', '2026-10-03T09:40:00.000Z', { prev: 'accepted', note: 'Rider released the delivery' }),
      evt('rider_6', '2026-10-03T09:40:00.000Z', { status: 'assigned', prev: 'pending_assignment', note: NOTE }),
      evt(null, '2026-10-03T09:40:00.000Z')                                        // no actor: nobody to blame
    ];
    const since = '2026-10-03T09:00:00.000Z';
    const db = stubDb([], { events });
    const repo = new DeliveryRepository({ db });

    const lapses = await repo.countRecentLapses(since);
    assert.deepStrictEqual([...lapses.entries()].sort(), [['rider_1', 2], ['rider_2', 1]],
      'only offers that lapsed since the cutoff, per rider; declines, releases and old lapses do not count');
    assert.ok(db.calls.some(([op, col, val]) => op === 'eq' && col === 'note' && val === NOTE), 'it matches the lapse note exactly');
    assert.ok(db.calls.some(([op, col, val]) => op === 'eq' && col === 'previous_status' && val === 'assigned'));
    assert.ok(db.calls.some(([op, col]) => op === 'gte' && col === 'created_at'), 'and bounds the time');
    assert.ok(db.calls.some(([op, col]) => op === 'select' && col === 'actor_id'), 'reading only the actor');
    assert.strictEqual((await repo.countRecentLapses('2026-10-03T09:46:00.000Z')).get('rider_1'), undefined, 'a later cutoff drops earlier lapses');
    assert.strictEqual((await repo.countRecentLapses('garbage')).size, 0, 'an unparseable cutoff matches nothing');

    // The in-memory backend answers the same.
    const memory = new DeliveryRepository({ db: null });
    for (const e of events) {
      await memory.insertEvent({ deliveryId: e.delivery_id, status: e.status, previousStatus: e.previous_status, actorId: e.actor_id, note: e.note, at: e.created_at });
    }
    assert.deepStrictEqual([...(await memory.countRecentLapses(since)).entries()].sort(), [['rider_1', 2], ['rider_2', 1]], 'memory matches the database path');
    assert.strictEqual((await memory.countRecentLapses('garbage')).size, 0);

    // Reaching the row cap is logged, for this query too.
    const manyLapses = Array.from({ length: 1000 }, () => evt('rider_9', '2026-10-03T09:30:00.000Z'));
    const warnings = [];
    const originalWarn = logger.warn;
    logger.warn = (m) => warnings.push(String(m));
    try {
      const capped = await new DeliveryRepository({ db: stubDb([], { events: manyLapses }) }).countRecentLapses(since);
      assert.strictEqual(capped.get('rider_9'), 1000);
      assert.ok(warnings.some((w) => /Recent-lapse count hit its 1000-row cap/.test(w)), 'the lapse count says when it was cut short');
      warnings.length = 0;
      await repo.countRecentLapses(since);
      assert.strictEqual(warnings.length, 0, 'a normal lapse count logs nothing');
    } finally {
      logger.warn = originalWarn;
    }
  }

  // ------------------- production: a failed ranking input is an error, not "nobody is busy"
  {
    const config = require('../../server/config/env');
    const failing = { error: { code: '57014', message: 'statement timeout' } };
    const throwing = { from() { throw new Error('connection reset'); } };
    const originals = { prod: config.isProduction, error: logger.error, warn: logger.warn };
    logger.error = () => {};
    logger.warn = () => {};
    try {
      // Outside production the development fallback applies, as for every other read.
      config.isProduction = false;
      assert.strictEqual((await new DeliveryRepository({ db: stubDb([], failing) }).countOpenByDriver()).size, 0, 'dev: falls back to memory');
      assert.strictEqual((await new DeliveryRepository({ db: stubDb([], failing) }).countRecentLapses('2026-10-03T09:00:00.000Z')).size, 0);

      config.isProduction = true;
      for (const [label, make] of [['an error response', () => stubDb([], failing)], ['a thrown error', () => throwing]]) {
        const repo = new DeliveryRepository({ db: make() });
        for (const [name, call] of [
          ['countOpenByDriver', () => repo.countOpenByDriver()],
          ['countRecentLapses', () => repo.countRecentLapses('2026-10-03T09:00:00.000Z')]
        ]) {
          let caught = null;
          try { await call(); } catch (e) { caught = e; }
          assert.ok(caught, `production + ${label}: ${name} throws instead of answering "nobody"`);
          assert.strictEqual(caught.code, 'INFRASTRUCTURE_ERROR', `${name} (${label}) is an InfrastructureError`);
          assert.strictEqual(caught.statusCode, 500);
        }
      }
      // Housekeeping reads keep the platform's read fallback: an unreleased offer is retried later.
      assert.deepStrictEqual(await new DeliveryRepository({ db: stubDb([], failing) }).findStaleOffers('2026-10-03T09:00:00.000Z'), [],
        'findStaleOffers still degrades to nothing (the next sweep retries)');
      // And a healthy query in production is unaffected.
      const healthy = await new DeliveryRepository({ db: stubDb([row('1', 'assigned', 't', 'rider_1')]) }).countOpenByDriver();
      assert.strictEqual(healthy.get('rider_1'), 1);
    } finally {
      config.isProduction = originals.prod;
      logger.error = originals.error;
      logger.warn = originals.warn;
    }
  }

  console.log('    ✓ Delivery repository: stale-offer, workload and lapse queries hold, memory and database paths agree.');
}

module.exports = { run };
