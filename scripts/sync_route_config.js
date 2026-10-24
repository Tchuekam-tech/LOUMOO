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
 *   vercel.json   "redirects" (the apex host -> the canonical host, then legacy paths),
 *                 "rewrites" (the API function, the crawlability endpoints, the control
 *                 center, and one entry per application route pointing at the prerender
 *                 function), "trailingSlash", and in "headers" the HSTS value and the
 *                 cross-origin isolation headers of the sitewide rule (the rest of
 *                 "headers" is kept as it is in the file)
 *
 * The LAST rewrite is a catch-all to the SAME function (never to index.html). A URL that
 * is neither a file nor a registered route reaches the gateway, which answers a document
 * request with the application shell at a real 404 + noindex (so the router draws the
 * not-found screen) and anything else (a script, an image) with a plain 404. The old
 * catch-all rewrote every unknown path - including a missing script or image - to the
 * static HTML shell with a 200, which hid asset errors (docs/ROUTING.md).
 *
 * Why it must be explicit: with only a static 404.html as the fallback, production
 * (observed 2026-10-21, www.loumoo.store) still answered `/does-not-exist`,
 * `/Assets/nope.png` and `/about` with the home page at 200 - a soft 404 for every
 * unknown URL - because the Vercel project applies an SPA fallback the repository does
 * not control. `framework: null` stops a dashboard Framework Preset from injecting one,
 * and the final rewrite makes the answer deterministic whatever the dashboard says.
 *
 * Live hosts: Vercel (loumoo.store answers with `Server: Vercel`) and Railway, whose
 * Express server reads the registry directly (server/index.js). Netlify is no longer
 * used, so netlify.toml is not generated (it was removed when it drifted).
 */

const fs = require('fs');
const path = require('path');
const Routes = require('../src/routing/routes');
const { HSTS, CROSS_ORIGIN_HEADERS } = require('../server/shared/middleware/securityHeaders');

const ROOT = path.resolve(__dirname, '..');
const VERCEL = path.join(ROOT, 'vercel.json');

const PARAM = '[A-Za-z0-9_-]+';

// The host that answers 200 (src/routing/routes.js ORIGIN) and its apex. A request for the apex that
// reaches this project is sent to the canonical host in ONE hop, path and query kept. The rule is a
// condition on the host: a request for www (or a preview URL) never matches it, so the canonical host
// never gets an extra hop.
const CANONICAL_ORIGIN = Routes.ORIGIN;
const APEX_HOST = new URL(CANONICAL_ORIGIN).hostname.replace(/^www\./, '');

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
/** Public French documents: the build writes each to public<page>, the CDN serves it at the route's path. */
function contentRoutes() {
  return Routes.routes.filter(r => r.kind === 'content');
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

/**
 * The sitewide header rule ('/(.*)') keeps every header it already has. Only two things come from
 * the gateway's own constants (server/shared/middleware/securityHeaders.js), so the CDN and the
 * function can never disagree about them (tests/unit/security_headers_csp.test.js): the HSTS value
 * (which gained `preload`) and the cross-origin isolation headers (appended once).
 */
function withSitewideSecurity(headers) {
  return headers.map(rule => {
    if (rule.source !== '/(.*)') return rule;
    const list = rule.headers.map(h => Object.assign({}, h));
    const hsts = list.find(h => h.key === 'Strict-Transport-Security');
    if (hsts) hsts.value = HSTS; else list.push({ key: 'Strict-Transport-Security', value: HSTS });
    Object.keys(CROSS_ORIGIN_HEADERS).forEach(key => {
      const have = list.find(h => h.key === key);
      if (have) have.value = CROSS_ORIGIN_HEADERS[key]; else list.push({ key, value: CROSS_ORIGIN_HEADERS[key] });
    });
    return Object.assign({}, rule, { headers: list });
  });
}

function buildVercel(existing) {
  // First, so the apex is sent to the canonical host before any other rule can answer it.
  const apexRedirect = { source: '/(.*)', has: [{ type: 'host', value: APEX_HOST }], destination: `${CANONICAL_ORIGIN}/$1`, permanent: true };
  const redirects = [apexRedirect].concat(aliasList().map(a => ({ source: vercelSource(a.from), destination: a.to, permanent: true })));

  const rewrites = [{ source: '/api/(.*)', destination: '/api/index.js' }];
  // Dynamic crawlability endpoints are served by the Express function, not the
  // static CDN and never the SPA shell: the sitemap is generated from live
  // listings/stores and security.txt from config. robots.txt is intentionally
  // NOT here — it is a real static file published to public/ by assemble_public.js.
  rewrites.push({ source: '/sitemap.xml', destination: '/api/index.js' });
  rewrites.push({ source: '/.well-known/security.txt', destination: '/api/index.js' });
  pageRoutes().forEach(r => rewrites.push({ source: r.path, destination: r.page }));
  // Content pages are static files built into public/pages/ (scripts/assemble_public.js):
  // no function invocation, CDN-cached, and the whole document is in the first response.
  contentRoutes().forEach(r => rewrites.push({ source: r.path, destination: r.page }));
  // Application routes are served by the Express function so it can prerender a
  // per-route <head> (title/description/canonical/robots/OG/Twitter/JSON-LD) and
  // a crawlable content block, and answer a real 404 for an unknown product/store.
  // The home page '/' is NOT rewritten: Vercel serves public/index.html, which
  // scripts/assemble_public.js prerenders at build time.
  shellRoutes().forEach(r => rewrites.push({ source: vercelSource(r.path), destination: '/api/index.js' }));
  // Everything else that is not a file: the gateway decides (404 + noindex), never the CDN.
  rewrites.push({ source: '/(.*)', destination: '/api/index.js' });

  const out = Object.assign({}, existing);
  // The content documents are static files, so the CDN (not the gateway's securityHeaders
  // middleware) must send their Content-Security-Policy: the very rule '/' carries, one entry
  // for all of them. Regenerated here so a new content route can never be served without it.
  const content = contentRoutes().map(r => r.path.slice(1)).sort();
  const base = (existing.headers || []).filter(h => !/^\/\(([a-z0-9|-]+)\)$/.test(h.source));
  const homeRule = base.find(h => h.source === '/');
  out.headers = withSitewideSecurity(homeRule && content.length
    ? base.concat([{ source: '/(' + content.join('|') + ')', headers: homeRule.headers }])
    : base);
  // "Other": no Framework Preset (and so no preset-injected SPA fallback) whatever the dashboard says.
  out.framework = null;
  out.trailingSlash = false;
  out.redirects = redirects;
  out.rewrites = rewrites;
  // Keep a stable, readable key order.
  const order = ['$schema', 'version', 'framework', 'buildCommand', 'outputDirectory', 'functions', 'trailingSlash', 'redirects', 'rewrites', 'headers'];
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

module.exports = { buildVercel, vercelSource, shellRoutes, pageRoutes, contentRoutes, aliasList };
