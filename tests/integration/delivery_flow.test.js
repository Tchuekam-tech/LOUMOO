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
