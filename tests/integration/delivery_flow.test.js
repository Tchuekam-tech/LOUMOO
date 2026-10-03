/**
 * LOUMOO Integration Tests — Delivery tracking against the real database
 * ---------------------------------------------------------------------------
 * Drives the real Express app (real session guard, real error handler, real
 * rate limiter) over HTTP against the real Supabase database, with migration
 * 013 applied. The unit suites (delivery_domain / _service / _routes) prove the
 * logic with in-memory stand-ins; this one proves the parts they cannot:
 *
 *   - the SQL itself: constraints, the one-open-delivery-per-order index,
 *     compare-and-swap updates, foreign keys and the service-role-only RLS;
 *   - the real authentication guard and role lookup (admin, seller, buyer, rider);
 *   - the order status actually moving in iam.orders as the delivery progresses;
 *   - the live stream through the full middleware stack.
 *
 * When migration 013 has not been applied the suite prints a SKIPPED notice and
 * passes, so `npm test` stays usable on a database that is behind. Set
 * LOUMOO_REQUIRE_DELIVERY_DB=1 to make that a failure instead (CI).
 */

require('../setup');
const assert = require('assert');
const harness = require('../helpers/harness');

const { db } = harness;

// PostgREST answers PGRST205 for a table that is not in its schema cache; a
// plain Postgres error 42P01 means the same thing from a direct connection.
const MISSING_TABLE_CODES = ['PGRST205', '42P01'];

async function migrationIsApplied() {
  const { error } = await db().from('deliveries').select('id').limit(1);
  if (!error) return true;
  if (MISSING_TABLE_CODES.includes(error.code)) return false;
  throw new Error(`delivery_flow: could not probe iam.deliveries: ${error.code || ''} ${error.message}`);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The app's global limiter allows 120 requests a minute per peer, and every
// request from this process comes from the same peer (docs/DELIVERY_API.md,
// decision 7). This suite makes well over that in total, so it paces itself:
// never more than REQUEST_BUDGET requests in any rolling minute.
const REQUEST_BUDGET = 90;
const WINDOW_MS = 60 * 1000;
const sentAt = [];

async function pace() {
  for (;;) {
    const now = Date.now();
    while (sentAt.length && now - sentAt[0] >= WINDOW_MS) sentAt.shift();
    if (sentAt.length < REQUEST_BUDGET) {
      sentAt.push(now);
      return;
    }
    await sleep(WINDOW_MS - (now - sentAt[0]) + 25);
  }
}

/**
 * One paced HTTP call. A 429 that carries Retry-After comes from the global
 * limiter, so it is waited out and retried; a 429 without it (the per-user
 * stream cap) is a real answer and is returned as is.
 */
async function call(method, path, user, body) {
  for (let attempt = 0; ; attempt += 1) {
    await pace();
    const res = await harness.request(method, path, { token: user ? user.token : null, body });
    const retryAfter = Number(res.headers['retry-after']);
    if (res.status === 429 && retryAfter > 0 && attempt < 3) {
      await sleep(Math.min(retryAfter, 65) * 1000);
      continue;
    }
    return res;
  }
}

const api = (method, path, user, body) => call(method, `/api/v1/deliveries${path}`, user, body);
async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  DELIVERY TRACKING — DATABASE-BACKED INTEGRATION TEST');
  console.log('═══════════════════════════════════════════════════════════\n');

  if (!(await migrationIsApplied())) {
    const message = 'Migration 013_delivery_tracking.sql is not applied to this database.';
    if (process.env.LOUMOO_REQUIRE_DELIVERY_DB === '1') throw new Error(message);
    console.log(`  SKIPPED: ${message}`);
    console.log('  Apply it, then re-run: node tests/integration/delivery_flow.test.js\n');
    return;
  }

  await harness.start();

  try {
    // @@SECTIONS@@
  } finally {
    await harness.cleanup();
  }
}

if (require.main === module) {
  run()
    .then(() => {
      // The app keeps timers alive (rate limiter, caches), so a standalone run
      // would hang after the last assertion. Give stdout a moment to flush.
      setTimeout(() => process.exit(0), 250).unref();
    })
    .catch(err => {
      console.error('Test Failed:', err);
      process.exit(1);
    });
}

module.exports = { run };
