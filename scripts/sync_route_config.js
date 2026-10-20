#!/usr/bin/env node
'use strict';

/**
 * Generate the hosting configuration for the frontend routes from the one registry
 * (src/routing/routes.js), so the host, the gateway and the router can never disagree
 * about which URLs exist.
 *
 *   node scripts/sync_route_config.js          rewrite vercel.json
 *   node scripts/sync_route_config.js --check  fail (exit 1) if it is out of date
 *
 * What is generated:
 *   vercel.json   "redirects" (legacy paths), "rewrites" (the API function, the control
 *                 center, and one entry per application route), "trailingSlash"
 *
 * What is deliberately NOT generated: a catch-all. A URL that is neither a file nor a
 * registered route has no rewrite, so the host answers it with 404.html (the same
 * application shell, with a real 404 status, which draws the not-found screen). The old
 * catch-all rewrote every unknown path - including a missing script or image - to the
 * HTML shell with a 200, which hid asset errors (docs/ROUTING.md).
 *
 * Live hosts: Vercel (loumoo.store answers with `Server: Vercel`) and Railway, whose
 * Express server reads the registry directly (server/index.js). Netlify is no longer
 * used, so netlify.toml is not generated (it was removed when it drifted).
 */

const fs = require('fs');
const path = require('path');
const Routes = require('../src/routing/routes');

const ROOT = path.resolve(__dirname, '..');
const VERCEL = path.join(ROOT, 'vercel.json');

const PARAM = '[A-Za-z0-9_-]+';

/** '/store/:slug' -> Vercel path-to-regexp '/store/:slug([A-Za-z0-9_-]+)'. */
function vercelSource(p) {
  return p.replace(/:([A-Za-z]+)/g, (_, name) => `:${name}(${PARAM})`);
}

/** Routes the host must hand the application shell. 'unavailable' areas are left out on purpose (404). */
function shellRoutes() {
  return Routes.routes.filter(r => (r.kind === 'screen' || r.kind === 'overlay') && r.path !== '/');
}
function pageRoutes() {
  return Routes.routes.filter(r => r.kind === 'page');
}

function encodeSpace(p) { return p.replace(/ /g, '%20'); }

/** Legacy paths. The shell file with a space in its name is listed both ways: hosts differ on which form they match. */
function aliasList() {
  const out = [];
  Routes.aliases.forEach(a => {
    out.push({ from: a.from, to: a.to });
    if (a.from.indexOf(' ') !== -1) out.push({ from: encodeSpace(a.from), to: a.to });
  });
  return out;
}

function buildVercel(existing) {
  const redirects = aliasList().map(a => ({ source: vercelSource(a.from), destination: a.to, permanent: true }));

  const rewrites = [{ source: '/api/(.*)', destination: '/api/index.js' }];
  // Dynamic crawlability endpoints are served by the Express function, not the
  // static CDN and never the SPA shell: the sitemap is generated from live
  // listings/stores and security.txt from config. robots.txt is intentionally
  // NOT here — it is a real static file published to public/ by assemble_public.js.
  rewrites.push({ source: '/sitemap.xml', destination: '/api/index.js' });
  rewrites.push({ source: '/.well-known/security.txt', destination: '/api/index.js' });
  pageRoutes().forEach(r => rewrites.push({ source: r.path, destination: r.page }));
  shellRoutes().forEach(r => rewrites.push({ source: vercelSource(r.path), destination: '/index.html' }));

  const out = Object.assign({}, existing);
  out.trailingSlash = false;
  out.redirects = redirects;
  out.rewrites = rewrites;
  // Keep a stable, readable key order.
  const order = ['$schema', 'version', 'buildCommand', 'outputDirectory', 'functions', 'trailingSlash', 'redirects', 'rewrites', 'headers'];
  const sorted = {};
  order.forEach(k => { if (k in out) sorted[k] = out[k]; });
  Object.keys(out).forEach(k => { if (!(k in sorted)) sorted[k] = out[k]; });
  return JSON.stringify(sorted, null, 2) + '\n';
}

function main() {
  const check = process.argv.includes('--check');
  const vercelNow = fs.readFileSync(VERCEL, 'utf8');
  const vercelNext = buildVercel(JSON.parse(vercelNow));

  const drift = [];
  if (vercelNow !== vercelNext) drift.push('vercel.json');

  if (check) {
    if (drift.length) {
      console.error(`Route config is out of date: ${drift.join(', ')}. Run: node scripts/sync_route_config.js`);
      process.exit(1);
    }
    console.log('Route config is in sync with src/routing/routes.js (vercel.json).');
    return;
  }
  if (vercelNow !== vercelNext) fs.writeFileSync(VERCEL, vercelNext);
  console.log(drift.length ? `Updated ${drift.join(', ')}.` : 'Already up to date.');
}

if (require.main === module) main();

module.exports = { buildVercel, vercelSource, shellRoutes, pageRoutes, aliasList };
