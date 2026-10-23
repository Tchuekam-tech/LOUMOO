/**
 * LOUMOO — every column a query names exists in the schema
 * ---------------------------------------------------------------------------
 * The admin read models selected profiles.full_name, orders.total_amount,
 * listings.base_price and other columns that are in no migration. PostgREST
 * answered 42703, the error was swallowed into built-in demo rows, and the
 * console showed invented stores and KPIs against a live database for weeks.
 *
 * This walks every Supabase query chain in the server (`.from('t')` …
 * `.select('a, b')`, the filters and `.order()`, and the keys of `.insert()`,
 * `.update()` and `.upsert()` object literals) and checks each column against
 * the schema the REAL migrations build (PGlite, no network). Embedded
 * relations, `*`, computed table names and template-built select lists are
 * outside its reach; a literal column name is not.
 */

require('../setup');

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const { createLocalDb } = require('../e2e/support/localDb');

const ROOT = path.resolve(__dirname, '../..');
const FILTERS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'order', 'not', 'match']);
const WRITES = new Set(['update', 'insert', 'upsert']);

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') out.push(...jsFiles(full)); } else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function splitTopLevel(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** The table (and schema) a call chain queries, or null when it cannot be told statically. */
function chainTable(node, src) {
  let cur = node.callee.object;
  let table = null;
  let schemaName = null;
  while (cur && cur.type === 'CallExpression' && cur.callee.type === 'MemberExpression') {
    const method = cur.callee.property.name;
    const arg = cur.arguments[0];
    if (method === 'from') {
      if (!arg || arg.type !== 'Literal') return null; // computed table name
      table = table || arg.value;
    }
    if (method === 'schema' && arg && arg.type === 'Literal') schemaName = arg.value;
    cur = cur.callee.object;
  }
  if (!table && cur && cur.type === 'Identifier') {
    // A query built up in steps (`query = query.eq(...)`): the nearest earlier
    // `name = <...>.from('t')` names its table.
    const before = src.slice(Math.max(0, node.start - 6000), node.start);
    const re = new RegExp(`\\b${cur.name}\\s*=\\s*[^;]{0,300}?\\.from\\(\\s*['"]([a-z_]+)['"]`, 'g');
    let m;
    let last = null;
    while ((m = re.exec(before))) last = m;
    if (last) {
      table = last[1];
      const sm = /\.schema\(\s*['"]([a-z_]+)['"]/.exec(last[0]);
      if (sm) schemaName = sm[1];
    }
  }
  return table ? { table, schemaName } : null;
}

(async () => {
  const { db } = await createLocalDb();
  const rows = (await db.query(
    "SELECT table_schema, table_name, column_name FROM information_schema.columns WHERE table_schema IN ('iam', 'system', 'public')"
  )).rows;
  const schema = {};
  for (const r of rows) (schema[`${r.table_schema}.${r.table_name}`] = schema[`${r.table_schema}.${r.table_name}`] || new Set()).add(r.column_name);
  const tableColumns = ({ table, schemaName }) => {
    const candidates = schemaName ? [`${schemaName}.${table}`] : [`iam.${table}`, `system.${table}`, `public.${table}`];
    const key = candidates.find((k) => schema[k]);
    return key ? { key, cols: schema[key] } : null;
  };

  const files = [...jsFiles(path.join(ROOT, 'server')), ...jsFiles(path.join(ROOT, 'SuperAdmin/backend'))];
  const problems = [];
  let checked = 0;

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    let ast;
    try {
      ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', locations: true, allowReturnOutsideFunction: true, allowHashBang: true });
    } catch (_) {
      continue;
    }
    const rel = path.relative(ROOT, file);
    (function walk(n) {
      if (!n || typeof n.type !== 'string') return;
      if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed) {
        const method = n.callee.property.name;
        if (FILTERS.has(method) || WRITES.has(method) || method === 'select') {
          const target = chainTable(n, src);
          if (target) {
            const where = `${rel}:${n.loc.start.line}`;
            const t = tableColumns(target);
            if (!t) {
              problems.push(`${where} queries table "${target.table}", which no migration creates`);
            } else {
              const arg = n.arguments[0];
              const check = (col, how) => {
                const name = String(col).split('->')[0].split('::')[0].trim();
                checked++;
                if (name && name !== '*' && !t.cols.has(name)) problems.push(`${where} ${how} names ${t.key}.${name}, which does not exist`);
              };
              if (method === 'select' && arg && arg.type === 'Literal' && typeof arg.value === 'string') {
                for (const item of splitTopLevel(arg.value)) {
                  if (item.includes('(') || item === '*') continue; // embedded relation
                  check(item.includes(':') ? item.split(':')[1] : item, 'select');
                }
              } else if (FILTERS.has(method) && arg && arg.type === 'Literal' && typeof arg.value === 'string' && !arg.value.includes('.')) {
                check(arg.value, `.${method}()`);
              } else if (WRITES.has(method) && arg && arg.type === 'ObjectExpression') {
                for (const p of arg.properties) if (p.type === 'Property' && !p.computed) check(p.key.name || p.key.value, `.${method}()`);
              }
            }
          }
        }
      }
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v);
      }
    })(ast);
  }

  assert.ok(checked > 500, `the walk reached the queries (${checked} column references checked)`);
  assert.deepStrictEqual(problems, [], 'every column a query names exists in the migrated schema');
  console.log(`query_columns_exist: ${checked} column references in ${files.length} files match the migrated schema`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
