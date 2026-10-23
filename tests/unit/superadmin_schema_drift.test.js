/**
 * LOUMOO Unit Tests — the SuperAdmin console queries columns that exist
 * ---------------------------------------------------------------------------
 * Every order, profile and listing query in SuperAdminRepository was written
 * against a schema LOUMOO does not have: `user_id`, `total_amount`, `status`
 * and `escrow_status` on orders; `full_name` and `kyc_status` on profiles;
 * `base_price`, `stock_quantity` and `is_featured` on listings. PostgREST
 * refuses a select naming an unknown column outright, so each query failed and
 * fell through to the seeded demo array. Against the live database the owner's
 * console listed fabricated orders, users and listings, its GMV and
 * escrow-in-flight were computed from two demo rows, and an escrow release or
 * refund answered 200 without touching anything.
 *
 * Nothing in the test suite noticed, because the fallback is exactly what a
 * test without credentials reads. This check closes that gap: it parses the
 * migrations for the real column names and asserts that every column the
 * repository's selects name actually exists.
 */

require('../setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS = path.join(ROOT, 'server/infrastructure/database/migrations');
const REPOSITORY = path.join(ROOT, 'SuperAdmin/backend/repositories/SuperAdminRepository.js');

/**
 * The columns each `iam.<table>` has, read from the migrations: the CREATE
 * TABLE body plus any ADD COLUMN that came later.
 */
function columnsFromMigrations() {
  const sql = fs.readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
    .join('\n');

  const tables = {};

  const create = /CREATE TABLE (?:IF NOT EXISTS )?iam\.(\w+)\s*\(([\s\S]*?)\n\);/g;
  let m;
  while ((m = create.exec(sql)) !== null) {
    const [, table, body] = m;
    const columns = tables[table] || (tables[table] = new Set());
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/--.*$/, '').trim();
      // A column definition opens with the name; table constraints do not.
      const col = /^([a-z_][a-z0-9_]*)\s+[A-Za-z]/.exec(line);
      if (!col) continue;
      if (['primary', 'unique', 'foreign', 'check', 'constraint'].includes(col[1])) continue;
      columns.add(col[1]);
    }
  }

  const added = /ALTER TABLE iam\.(\w+)\s+ADD COLUMN (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)/gi;
  while ((m = added.exec(sql)) !== null) {
    const columns = tables[m[1]] || (tables[m[1]] = new Set());
    columns.add(m[2].toLowerCase());
  }

  return tables;
}

/**
 * The column lists the repository selects, as { table, columns }. Covers both
 * the shared constants and any select written inline.
 */
function selectedColumns(source) {
  const found = [];

  const constants = {
    ORDER_COLUMNS: 'orders',
    ORDER_COLUMNS_KPI: 'orders',
    PROFILE_COLUMNS: 'profiles',
    LISTING_COLUMNS: 'listings'
  };
  for (const [name, table] of Object.entries(constants)) {
    const decl = new RegExp(`const ${name} = '([^']+)'`).exec(source);
    assert.ok(decl, `${name} must stay a single-quoted column list so this check can read it`);
    found.push({ what: name, table, columns: decl[1] });
  }

  // `profiles!inner(a, b, c)` — the embed on the store queries.
  const embed = /profiles!inner\(([^)]+)\)/g;
  let m;
  while ((m = embed.exec(source)) !== null) {
    found.push({ what: 'profiles!inner embed', table: 'profiles', columns: m[1] });
  }

  return found;
}

/** Splits a PostgREST select list, dropping embeds, aliases and json paths. */
function parseColumnList(list) {
  return list
    .replace(/\w+!?\w*\([^)]*\)/g, '')      // embedded resources
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => c.split(':').pop().trim())  // alias:column
    .map((c) => c.split('->')[0].trim())    // metadata->>key
    .filter((c) => c && c !== '*');
}

function testEverySelectedColumnExists() {
  const schema = columnsFromMigrations();
  for (const table of ['orders', 'profiles', 'listings', 'stores']) {
    assert.ok(schema[table] && schema[table].size, `the migrations must define iam.${table}`);
  }

  const source = fs.readFileSync(REPOSITORY, 'utf8');
  const problems = [];

  for (const { what, table, columns } of selectedColumns(source)) {
    for (const column of parseColumnList(columns)) {
      if (!schema[table].has(column)) {
        problems.push(`${what}: iam.${table} has no column "${column}"`);
      }
    }
  }

  assert.deepStrictEqual(problems, [], `SuperAdminRepository selects columns that do not exist:\n  ${problems.join('\n  ')}`);
}

/**
 * The columns the repository WRITES. A write to a missing column is worse than
 * a read: the read falls back to the seed, the write reports an action that
 * never happened.
 */
function testEveryWrittenColumnExists() {
  const schema = columnsFromMigrations();
  const source = fs.readFileSync(REPOSITORY, 'utf8');
  const problems = [];

  // `.from('<table>').update({ a: ..., b: ... })` written inline.
  const inlineUpdate = /\.from\('(\w+)'\)\s*\n?\s*\.update\(\{([^}]*)\}\)/g;
  let m;
  while ((m = inlineUpdate.exec(source)) !== null) {
    const [, table, body] = m;
    if (!schema[table]) continue;
    for (const line of body.split(',')) {
      const key = /^\s*([a-z_][a-z0-9_]*)\s*:/.exec(line);
      if (key && !schema[table].has(key[1])) {
        problems.push(`update on iam.${table}: no column "${key[1]}"`);
      }
    }
  }

  assert.deepStrictEqual(problems, [], `SuperAdminRepository writes columns that do not exist:\n  ${problems.join('\n  ')}`);
}

/** The seeded fallback rows must be shaped like the real ones they stand in for. */
function testSeedRowsMatchTheRealShape() {
  const SuperAdminRepository = require('../../SuperAdmin/backend/repositories/SuperAdminRepository');
  const schema = columnsFromMigrations();

  const cases = [
    ['DEFAULT_ORDERS', 'orders', SuperAdminRepository.DEFAULT_ORDERS],
    ['DEFAULT_USERS', 'profiles', SuperAdminRepository.DEFAULT_USERS]
  ];

  const problems = [];
  for (const [name, table, rows] of cases) {
    assert.ok(Array.isArray(rows) && rows.length, `${name} must be a non-empty array`);
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!schema[table].has(key)) problems.push(`${name}: iam.${table} has no column "${key}"`);
      }
    }
  }

  assert.deepStrictEqual(problems, [], `the seeded fallback rows are a different shape from the real table:\n  ${problems.join('\n  ')}`);
}

function run() {
  const tests = [
    ['every selected column exists', testEverySelectedColumnExists],
    ['every written column exists', testEveryWrittenColumnExists],
    ['the seed rows match the real shape', testSeedRowsMatchTheRealShape]
  ];

  let failures = 0;
  for (const [name, fn] of tests) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failures += 1;
      console.error(`  ✗ ${name}\n    ${err && err.message ? err.message : err}`);
    }
  }

  console.log(`\nSuperAdmin schema drift: ${tests.length - failures}/${tests.length} passed.`);
  if (failures) process.exitCode = 1;
}

run();
