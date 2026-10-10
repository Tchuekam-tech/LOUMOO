#!/usr/bin/env node
/**
 * LOUMOO — Provision NanoAfrica (the house store) and nanoDelivery (its agency).
 *
 * Operator tool. Creates the store, its owner membership, its public records, the
 * delivery agency organization and its provider record, and makes the named owner
 * able to sell and dispatch, so that every curated product becomes orderable and
 * every order reaches the owner. See docs/NANOAFRICA.md for the full runbook.
 *
 * DRY RUN BY DEFAULT. This prints who the owner email matched and every row it
 * would create or change, and writes nothing. To write, repeat the same command
 * with --apply AND --confirm-owner-id <the id the dry run printed>.
 *
 *   node scripts/provision_nanoafrica.js --owner-email you@example.com --phone +237699000000
 *   node scripts/provision_nanoafrica.js --owner-email you@example.com --phone +237699000000 \
 *        --apply --confirm-owner-id <id printed above>
 *
 * Options
 *   --owner-email <e>        The owner's LOUMOO account, matched by VERIFIED email.
 *   --owner-id <id>          Alternative: the owner's profile id (iam.profiles.id).
 *   --phone <n>              Public WhatsApp/contact number of the store and agency
 *                            (default: the owner's profile phone; required if it has none).
 *   --store-email <e>        Public store email (default: the owner's email).
 *   --rider-email <e>        Register this verified account as a nanoDelivery rider and
 *                            member. Repeat for several riders.
 *   --city <c>               Store city (default Douala).
 *   --street <s>             Pickup street address (default empty: set it in Seller Studio).
 *   --apply                  Write. Requires --confirm-owner-id.
 *   --confirm-owner-id <id>  Must equal the owner id matched by the dry run.
 *   --json                   Print the result as JSON.
 *   --help
 *
 * Safe to run twice: a second run changes nothing. Exit codes: 0 done, 1 refused or
 * failed, 2 bad usage, 3 dry run found problems that block --apply.
 */
'use strict';

const VALUE_FLAGS = {
  '--owner-email': 'ownerEmail',
  '--owner-id': 'ownerId',
  '--phone': 'phone',
  '--store-email': 'storeEmail',
  '--city': 'city',
  '--street': 'street',
  '--confirm-owner-id': 'confirmOwnerId'
};
const REPEAT_FLAGS = { '--rider-email': 'riderEmails' };
const BOOLEAN_FLAGS = { '--apply': 'apply', '--json': 'json', '--help': 'help', '-h': 'help' };

class UsageError extends Error {}

function parseArgs(argv) {
  const out = { riderEmails: [] };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inline = null;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 0) { inline = arg.slice(eq + 1); arg = arg.slice(0, eq); }

    if (BOOLEAN_FLAGS[arg]) {
      if (inline !== null) throw new UsageError(`${arg} does not take a value.`);
      out[BOOLEAN_FLAGS[arg]] = true;
      continue;
    }
    const key = VALUE_FLAGS[arg] || REPEAT_FLAGS[arg];
    if (!key) throw new UsageError(`Unknown option ${arg}. Use --help.`);
    const value = inline !== null ? inline : argv[++i];
    if (value === undefined || (inline === null && String(value).startsWith('--'))) {
      throw new UsageError(`${arg} needs a value.`);
    }
    if (REPEAT_FLAGS[arg]) out[key].push(value); else out[key] = value;
  }
  return out;
}

function usage() {
  return [
    'Usage: node scripts/provision_nanoafrica.js (--owner-email <e> | --owner-id <id>) [--phone <n>] [options]',
    '',
    'Dry run by default. To write add: --apply --confirm-owner-id <id printed by the dry run>',
    'Read the header of this file or docs/NANOAFRICA.md for every option.'
  ].join('\n');
}

const ACTION_LABEL = { create: 'CREATE', update: 'UPDATE', exists: 'exists', conflict: 'CONFLICT' };

function formatReport(result, ctx = {}) {
  const lines = [];
  const dry = result.mode === 'dry-run';
  lines.push(dry ? 'NanoAfrica provisioning: DRY RUN (nothing is written)' : 'NanoAfrica provisioning: APPLY');
  if (ctx.target) lines.push(`Database: ${ctx.target}`);
  lines.push('');
  lines.push('Owner matched');
  lines.push(`  id        ${result.owner.id}`);
  lines.push(`  name      ${result.owner.name}`);
  lines.push(`  email     ${result.owner.email}  (verified)`);
  lines.push(`  phone     ${result.owner.phone || '(none on the profile)'}`);
  lines.push(`  account   role ${result.owner.primaryRole}, seller status ${result.owner.sellerStatus}, onboarding ${result.owner.onboardingStatus}`);
  if (result.riders.length) {
    lines.push('');
    lines.push('Riders matched');
    for (const r of result.riders) lines.push(`  ${r.id}  ${r.name}  ${r.email}  ${r.phone || '(no phone)'}`);
  }
  lines.push('');
  lines.push(dry ? 'Would do' : 'Plan');
  const tableWidth = Math.max(...result.steps.map((s) => s.table.length), 5);
  for (const s of result.steps) {
    lines.push(`  ${(ACTION_LABEL[s.action] || s.action).padEnd(8)} ${s.table.padEnd(tableWidth)}  ${s.key}${s.note ? `  - ${s.note}` : ''}`);
    if (s.fields && (s.action === 'update' || s.action === 'create')) {
      for (const [k, v] of Object.entries(s.fields)) lines.push(`             ${k} = ${JSON.stringify(v)}`);
    }
  }
  if (result.warnings.length) {
    lines.push('');
    lines.push('WARNINGS');
    for (const w of result.warnings) lines.push(`  ! ${w}`);
  }
  if (result.blockers.length) {
    lines.push('');
    lines.push('BLOCKERS (--apply will refuse until these are fixed)');
    for (const b of result.blockers) lines.push(`  x ${b}`);
  }
  lines.push('');
  if (dry) {
    const writes = result.steps.filter((s) => s.action === 'create' || s.action === 'update').length;
    lines.push(writes ? `${writes} change(s) pending. Nothing was written.` : 'Everything already exists. Nothing to do.');
    if (writes && !result.blockers.length) {
      lines.push(`To apply, run the same command with:  --apply --confirm-owner-id ${result.owner.id}`);
    }
  } else {
    lines.push(`Applied ${result.changed} change(s).`);
    lines.push('Next: sign in as the owner, open Seller Studio and the dispatch board, and place a test order (see docs/NANOAFRICA.md).');
  }
  return lines.join('\n');
}

function targetOf(config) {
  try { return new URL(config.supabase.url).host; } catch (_) { return config && config.supabase && config.supabase.url ? '(unparseable url)' : '(not configured)'; }
}

/**
 * @param {string[]} argv
 * @param {object} [deps] { service, config, out, err } injectable for tests
 * @returns {Promise<number>} the exit code
 */
async function main(argv, deps = {}) {
  const out = deps.out || ((s) => console.log(s));
  const err = deps.err || ((s) => console.error(s));
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`${e.message}\n\n${usage()}`);
    return 2;
  }
  if (args.help) { out(usage()); return 0; }

  const config = deps.config || require('../server/config/env');
  const service = deps.service || require('../server/modules/store/application/HouseStoreService').getSharedHouseStore();

  let result;
  try {
    result = await service.provision({
      ownerEmail: args.ownerEmail,
      ownerId: args.ownerId,
      phone: args.phone,
      storeEmail: args.storeEmail,
      riderEmails: args.riderEmails,
      city: args.city,
      street: args.street,
      apply: args.apply === true,
      confirmOwnerId: args.confirmOwnerId
    });
  } catch (e) {
    err(`Provisioning stopped: ${e.message}`);
    if (e.details && Array.isArray(e.details.blockers)) for (const b of e.details.blockers) err(`  x ${b}`);
    if (args.apply) err('Nothing further was attempted. Every step is idempotent: fix the cause and run the same command again.');
    return 1;
  }

  out(args.json ? JSON.stringify(result, null, 2) : formatReport(result, { target: targetOf(config) }));
  if (result.mode === 'dry-run' && result.blockers.length) return 3;
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => { console.error(e); process.exit(1); }
  );
}

module.exports = { parseArgs, formatReport, main, UsageError };
