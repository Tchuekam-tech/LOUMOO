/**
 * LOUMOO — Row Level Security covers every API-exposed table (on real Postgres).
 * ---------------------------------------------------------------------------
 * The `iam` schema is exposed through PostgREST (the server's Supabase client
 * uses it as its default schema), and Supabase grants the API roles privileges on
 * it, so a table there without RLS is readable and writable by anyone holding the
 * public anon key that /api/config hands every browser.
 *
 * Applies the REAL migrations to PGlite with the Supabase baseline
 * (tests/e2e/support/localDb.js) and proves:
 *   1. every table in iam and system has RLS enabled (a new table without it
 *      fails here, before it reaches a deployment);
 *   2. iam.roles, the one table that lacked it (migration 022), refuses anon and
 *      authenticated reads AND writes, and its seeded rows are intact;
 *   3. the service role still reads it (the server path is unchanged).
 * PGlite is a devDependency; without it the suite skips.
 */

require('../setup');
const assert = require('assert');

const { createLocalDb, loadPglite } = require('../e2e/support/localDb');

async function asRole(db, role, sql) {
  await db.exec('BEGIN');
  try {
    await db.exec(`SET LOCAL ROLE ${role}`);
    const res = await db.query(sql);
    await db.exec('ROLLBACK');
    return { ok: true, rows: res.rows, affected: res.affectedRows };
  } catch (err) {
    try { await db.exec('ROLLBACK'); } catch (_) { /* already aborted */ }
    return { ok: false, error: String(err.message || err) };
  }
}

async function run() {
  if (!loadPglite()) {
    console.log('rls_coverage: SKIPPED (@electric-sql/pglite not installed)');
    return;
  }
  const { db, migrations } = await createLocalDb();
  assert.ok(migrations.includes('022_roles_row_level_security.sql'), 'migration 022 is applied by the local stack');

  /* 1. RLS on every table in the exposed schemas. */
  const res = await db.query(`
    SELECT n.nspname AS schema, c.relname AS table, c.relrowsecurity AS rls
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND n.nspname IN ('iam', 'system')
     ORDER BY 1, 2`);
  assert.ok(res.rows.length >= 70, `expected the full schema, found ${res.rows.length} tables`);
  const missing = res.rows.filter((r) => !r.rls).map((r) => `${r.schema}.${r.table}`);
  assert.deepStrictEqual(missing, [], `tables without row level security: ${missing.join(', ')}`);

  /* 2. iam.roles: no read, no write for the API roles. */
  for (const role of ['anon', 'authenticated']) {
    const read = await asRole(db, role, 'SELECT id FROM iam.roles');
    assert.ok(!read.ok || read.rows.length === 0, `${role} must not read iam.roles (got ${JSON.stringify(read.rows)})`);
    const ins = await asRole(db, role, `INSERT INTO iam.roles (id, description, permissions) VALUES ('pwned', 'x', '["*"]')`);
    assert.ok(!ins.ok, `${role} must not insert into iam.roles`);
    const upd = await asRole(db, role, `UPDATE iam.roles SET permissions = '["*"]' WHERE id = 'customer'`);
    assert.ok(!upd.ok || upd.affected === 0, `${role} must not update iam.roles`);
    const del = await asRole(db, role, `DELETE FROM iam.roles WHERE id = 'customer'`);
    assert.ok(!del.ok || del.affected === 0, `${role} must not delete from iam.roles`);
  }

  /* 3. The service role (the server) still reads the seeded catalogue. */
  const svc = await asRole(db, 'service_role', 'SELECT id FROM iam.roles ORDER BY id');
  assert.ok(svc.ok, `service_role reads iam.roles: ${svc.error || ''}`);
  assert.deepStrictEqual(svc.rows.map((r) => r.id), ['admin', 'customer', 'moderator', 'seller', 'seller_staff', 'super_admin'], 'seeded roles intact');

  await db.close();
  console.log(`rls_coverage: ${res.rows.length} tables in iam/system all have RLS; iam.roles closed to anon/authenticated`);
}

module.exports = { run };

if (require.main === module) {
  run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
}
