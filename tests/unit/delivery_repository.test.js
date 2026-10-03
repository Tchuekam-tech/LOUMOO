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
const { WORKLOAD_STATUSES } = require('../../server/modules/delivery/domain/Delivery');

/**
 * Minimal Supabase query-builder stand-in. Mirrors SQL where it matters here:
 * a comparison against NULL is never true, and `select(cols)` returns only those
 * columns, so a query that forgets a column it needs fails loudly.
 */
function stubDb(rows, { error = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.strictEqual(table, 'deliveries', 'these queries only touch deliveries');
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
      q.order = (col, opts = {}) => { q.order = { col, ascending: opts.ascending !== false }; return log('order', col, opts); };
      q.limit = (n) => { q.max = n; return log('limit', n); };
      q.then = (resolve) => {
        if (error) return resolve({ data: null, error });
        let out = rows.filter((r) => q.filters.every((f) => f(r)));
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
    const many = Array.from({ length: 5000 }, (_, i) => row(`m${i}`, 'assigned', 't', 'rider_9'));
    const warnings = [];
    const originalWarn = logger.warn;
    logger.warn = (m) => warnings.push(String(m));
    try {
      const capped = await new DeliveryRepository({ db: stubDb(many) }).countOpenByDriver();
      assert.strictEqual(capped.get('rider_9'), 5000);
      assert.ok(warnings.some((w) => /cap/.test(w)), 'hitting the row cap is logged');
      warnings.length = 0;
      await repo.countOpenByDriver();
      assert.strictEqual(warnings.length, 0, 'a normal count logs nothing');
    } finally {
      logger.warn = originalWarn;
    }
  }

  console.log('    ✓ Delivery repository: stale-offer and workload queries hold, memory and database paths agree.');
}

module.exports = { run };
