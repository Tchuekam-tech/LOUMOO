#!/usr/bin/env node
/**
 * `npm run test:routing` - the routing end-to-end suites, one child process each.
 *
 *   tests/routing/backend_authz.e2e.test.js   real server + real Postgres (PGlite) + seeded
 *                                             personas: who may read/act on what, over HTTP
 *   tests/routing/browser/*.browser.test.js   the real app in Chromium (added as they are written)
 *
 * Everything is local and hermetic (tests/e2e/support/localStack.js): no .env, no credentials,
 * no network. A suite that does not exist yet is reported as NOT PRESENT - never as a pass.
 * Exit code is non-zero if any suite that ran failed.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const SUITES = [
  { name: 'backend authorization matrix', file: path.join(HERE, 'backend_authz.e2e.test.js'), required: true }
];
const browserDir = path.join(HERE, 'browser');
if (fs.existsSync(browserDir)) {
  fs.readdirSync(browserDir).filter(f => /\.browser\.test\.js$/.test(f)).sort()
    .forEach(f => SUITES.push({ name: 'browser: ' + f.replace(/\.browser\.test\.js$/, ''), file: path.join(browserDir, f), required: false }));
}

const rows = [];
let failed = 0;
for (const s of SUITES) {
  if (!fs.existsSync(s.file)) {
    rows.push([s.name, s.required ? 'MISSING' : 'NOT PRESENT', '-']);
    if (s.required) failed++;
    continue;
  }
  console.log(`\n=== ${s.name} ===`);
  const t0 = Date.now();
  const res = spawnSync(process.execPath, [s.file], { stdio: 'inherit', env: process.env, timeout: 15 * 60 * 1000 });
  const secs = ((Date.now() - t0) / 1000).toFixed(0) + 's';
  const ok = res.status === 0;
  if (!ok) failed++;
  rows.push([s.name, ok ? 'PASS' : 'FAIL', secs]);
}

console.log('\n' + '-'.repeat(64));
rows.forEach(r => console.log(`${r[1].padEnd(12)} ${r[0].padEnd(40)} ${r[2]}`));
if (!fs.existsSync(browserDir) || !SUITES.some(s => /^browser:/.test(s.name))) {
  console.log('\nNote: no browser suites are present yet; only the backend matrix ran.');
}
console.log('-'.repeat(64));
process.exit(failed ? 1 : 0);
