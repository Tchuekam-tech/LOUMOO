/**
 * LOUMOO Unit Tests - scripts/provision_nanoafrica.js (arguments, report, exit codes)
 * ---------------------------------------------------------------------------
 * The script is an operator tool that can write to production, so what it prints and
 * how it exits are part of its safety:
 *
 *   1. Arguments parse (space and = forms, repeatable --rider-email) and bad usage exits 2.
 *   2. Without --apply it asks the service for a DRY RUN and says how to confirm.
 *   3. --apply is passed through together with --confirm-owner-id, never defaulted.
 *   4. A refusal exits 1 with the reason; a dry run with blockers exits 3.
 */

require('../setup');
const assert = require('assert');

const { parseArgs, formatReport, main, UsageError } = require('../../scripts/provision_nanoafrica');

const REPORT = {
  mode: 'dry-run',
  owner: { id: 'usr_owner', name: 'Ama Owner', email: 'Na****@Example.com', phone: '+237699111222', primaryRole: 'customer', sellerStatus: 'NONE', onboardingStatus: 'NOT_STARTED' },
  riders: [],
  steps: [
    { table: 'stores', key: 'store_nanoafrica', action: 'create', note: 'NanoAfrica', fields: { phone_number: '+237699111222' } },
    { table: 'store_members', key: 'store_nanoafrica/usr_owner', action: 'exists' }
  ],
  warnings: ['mind the gap'],
  blockers: [],
  applied: false,
  changed: 0
};

function fakeService(result, calls) {
  return { async provision(opts) { calls.push(opts); if (result instanceof Error) throw result; return result; } };
}
const quiet = () => { const out = []; const err = []; return { out, err, deps: { out: (s) => out.push(s), err: (s) => err.push(s), config: { supabase: { url: 'https://abc.supabase.co' } } } }; };

async function run() {
  // 1. parsing
  assert.deepStrictEqual(parseArgs(['--owner-email', 'a@b.c', '--phone=+237600000000', '--rider-email', 'r1@x.y', '--rider-email=r2@x.y', '--apply', '--confirm-owner-id', 'usr_1']), {
    ownerEmail: 'a@b.c', phone: '+237600000000', riderEmails: ['r1@x.y', 'r2@x.y'], apply: true, confirmOwnerId: 'usr_1'
  });
  for (const bad of [['--nope'], ['--owner-email'], ['--owner-email', '--apply'], ['--apply=yes']]) {
    assert.throws(() => parseArgs(bad), UsageError, `usage error for ${bad.join(' ')}`);
  }
  let io = quiet();
  assert.strictEqual(await main(['--nope'], io.deps), 2);
  assert.ok(/Usage:/.test(io.err.join('\n')));
  io = quiet();
  assert.strictEqual(await main(['--help'], io.deps), 0);

  // 2. a dry run is the default
  let calls = [];
  io = quiet();
  assert.strictEqual(await main(['--owner-email', 'a@b.c', '--phone', '+237699111222'], { ...io.deps, service: fakeService(REPORT, calls) }), 0);
  assert.strictEqual(calls[0].apply, false, 'no --apply => dry run');
  assert.strictEqual(calls[0].confirmOwnerId, undefined);
  const text = io.out.join('\n');
  assert.ok(/DRY RUN \(nothing is written\)/.test(text));
  assert.ok(/abc\.supabase\.co/.test(text), 'it names the database it is talking to');
  assert.ok(/usr_owner/.test(text) && /Ama Owner/.test(text), 'it shows who was matched');
  assert.ok(/CREATE\s+stores\s+store_nanoafrica/.test(text) && /exists\s+store_members/.test(text));
  assert.ok(/WARNINGS/.test(text) && /mind the gap/.test(text));
  assert.ok(/--apply --confirm-owner-id usr_owner/.test(text), 'and exactly how to confirm');

  // 3. apply passes the confirmation through
  calls = [];
  io = quiet();
  const applied = { ...REPORT, mode: 'apply', applied: true, changed: 1 };
  assert.strictEqual(await main(['--owner-email', 'a@b.c', '--apply', '--confirm-owner-id', 'usr_owner'], { ...io.deps, service: fakeService(applied, calls) }), 0);
  assert.strictEqual(calls[0].apply, true);
  assert.strictEqual(calls[0].confirmOwnerId, 'usr_owner');
  assert.ok(/Applied 1 change/.test(io.out.join('\n')));

  // 4. refusals and blockers
  io = quiet();
  assert.strictEqual(await main(['--owner-email', 'a@b.c', '--apply'], { ...io.deps, service: fakeService(new Error('Refusing to write: --confirm-owner-id must equal the account matched'), []) }), 1);
  assert.ok(/Refusing to write/.test(io.err.join('\n')));
  assert.ok(/run the same command again/.test(io.err.join('\n')), 'and says it is safe to re-run');

  io = quiet();
  const blocked = { ...REPORT, blockers: ['The store belongs to someone else'] };
  assert.strictEqual(await main(['--owner-email', 'a@b.c'], { ...io.deps, service: fakeService(blocked, []) }), 3);
  const blockedText = io.out.join('\n');
  assert.ok(/BLOCKERS/.test(blockedText) && !/To apply, run/.test(blockedText), 'no confirmation hint while blocked');

  io = quiet();
  await main(['--owner-email', 'a@b.c', '--json'], { ...io.deps, service: fakeService(REPORT, []) });
  assert.strictEqual(JSON.parse(io.out.join('\n')).owner.id, 'usr_owner', '--json prints the result');

  assert.ok(formatReport({ ...REPORT, steps: [{ table: 'stores', key: 'k', action: 'exists' }] }).includes('Everything already exists'));

  console.log('house_store_cli: 4 checks passed');
}

if (require.main === module) {
  run().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
