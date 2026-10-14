#!/usr/bin/env node
'use strict';

/**
 * Keep the route map in docs/ROUTING.md identical to the registry (src/routing/routes.js).
 *
 *   node scripts/sync_route_docs.js          rewrite the generated block
 *   node scripts/sync_route_docs.js --check  exit 1 if the block is out of date
 *
 * Only the text between the BEGIN/END markers is generated; everything else in the
 * document is prose written by hand.
 */

const fs = require('fs');
const path = require('path');
const Routes = require('../src/routing/routes');

const DOC = path.resolve(__dirname, '..', 'docs', 'ROUTING.md');
const BEGIN = '<!-- BEGIN GENERATED ROUTE MAP (scripts/sync_route_docs.js - do not edit by hand) -->';
const END = '<!-- END GENERATED ROUTE MAP -->';

function accessText(a) {
  if (a.kind === 'public') return 'public';
  if (a.kind === 'capability') return `signed in + \`${a.capability}\``;
  if (a.kind === 'seller') return 'seller (sign in, create a boutique, activate it)';
  if (a.kind === 'role') return 'role: ' + a.roles.map(r => `\`${r}\``).join(' or ');
  return a.kind;
}

function opens(r) {
  switch (r.kind) {
    case 'screen': return `screen \`${r.screen}\`` + (r.enter ? `, loader \`${r.enter}\`` : '');
    case 'overlay': return `overlay \`${r.overlay}\``;
    case 'page': return `separate document \`${r.page}\``;
    case 'unavailable': return '**not built** (honest "not available yet" state, HTTP 404)';
    default: return r.kind;
  }
}

function entryText(r) {
  if (r.kind === 'unavailable') return 'n/a';
  if (r.direct === 'redirect') return `redirects to \`${Routes.byId(r.fallback).path}\``;
  return 'opens directly';
}

function paramText(r) {
  if (!r.params.length) return '-';
  return r.params.map(p => {
    const bound = r.bind && r.bind[p];
    return `\`:${p}\`` + (bound ? ` -> \`${bound}\`` : (r.overlayArgs && r.overlayArgs.param === p ? ` -> \`${r.overlayArgs.as}\`` : ''));
  }).join(', ');
}

function aliasesFor(r) {
  const out = Routes.aliases.filter(a => {
    const t = Routes.resolve(a.to.replace(/:([A-Za-z]+)/g, 'x'));
    return t.type === 'route' && t.route.id === r.id;
  }).map(a => `\`${a.from}\``);
  return out.length ? out.join(', ') : '-';
}

function generate() {
  const lines = [BEGIN, ''];
  lines.push('| Canonical path | Opens | Access | Parameters | Legacy aliases | Cold load / refresh |');
  lines.push('|---|---|---|---|---|---|');
  Routes.routes.forEach(r => {
    lines.push(`| \`${r.path}\` | ${opens(r)} | ${accessText(r.access)} | ${paramText(r)} | ${aliasesFor(r)} | ${entryText(r)} |`);
  });
  lines.push('', '**Aliases that redirect (HTTP 308, query string kept):**', '');
  Routes.aliases.forEach(a => lines.push(`- \`${a.from}\` -> \`${a.to}\``));
  lines.push('', '**Shell screens deliberately without a URL:**', '');
  Object.keys(Routes.unroutedScreens).forEach(k => lines.push(`- \`${k}\` - ${Routes.unroutedScreens[k]}`));
  lines.push('', END);
  return lines.join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const now = fs.readFileSync(DOC, 'utf8');
  const re = new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!re.test(now)) {
    console.error('docs/ROUTING.md has no generated route map markers.');
    process.exit(2);
  }
  const next = now.replace(re, () => generate());
  if (check) {
    if (next !== now) { console.error('docs/ROUTING.md route map is out of date. Run: node scripts/sync_route_docs.js'); process.exit(1); }
    console.log('docs/ROUTING.md route map is in sync with src/routing/routes.js.');
    return;
  }
  if (next !== now) fs.writeFileSync(DOC, next);
  console.log(next !== now ? 'Updated docs/ROUTING.md route map.' : 'Already up to date.');
}

if (require.main === module) main();
module.exports = { generate, BEGIN, END, DOC };
