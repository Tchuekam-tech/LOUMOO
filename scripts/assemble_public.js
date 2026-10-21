#!/usr/bin/env node
'use strict';

/**
 * Assemble the static publish directory for Netlify.
 *
 * The frontend shell and its route-level `*Screens.dc.html` chunks reference
 * ./Assets, ./src and ./_ds by relative path, so those files/directories must
 * sit next to the shell at the site root. We also serve the app itself as
 * index.html so it loads at `/` with no redirect hop. Written in Node (not
 * shell) so it runs identically on the Windows dev machine and the Linux build
 * image, with no line-ending pitfalls.
 *
 * The same shell is published three times (index.html, 404.html and the legacy
 * 'Commerce App.dc.html'); the route-level chunks and every asset are resolved against
 * <base href="/"> in the shell, so none of them depends on the URL being served.
 *
 * Two deploy-blocking issues are fixed here at build time so the source tree is
 * left untouched:
 *   1. src/backend is Python server code the static site never loads, and its
 *      config.py hardcodes the Supabase URL — drop it from the published output.
 *   2. Netlify refuses to deploy any filename containing '#' or '?'. Many asset
 *      files are hashtag-named (e.g. "... #luxurywatch.jfif"). We rename those
 *      to use '_' and rewrite the matching asset paths inside the HTML so the
 *      references stay valid (this also repairs a few links that used a literal
 *      '#', which a browser had been treating as a URL fragment).
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'public');

fs.rmSync(out, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
fs.mkdirSync(out, { recursive: true });

const app = path.join(root, 'Commerce App.dc.html');
fs.copyFileSync(app, path.join(out, 'index.html'));
fs.copyFileSync(app, path.join(out, 'Commerce App.dc.html'));
// 404.html is the same application shell. A static host serves it, with a real 404
// status, for every URL that is not a file and not a route in src/routing/routes.js
// (docs/ROUTING.md); the router then draws the not-found screen. Without it an unknown
// URL would have no deliberate answer at all.
fs.copyFileSync(app, path.join(out, '404.html'));

// Secondary Design Component screens are route-level frontend chunks. Keep
// them beside the shell so the browser can fetch them on demand from the same
// CDN origin rather than making the initial document carry every screen.
const routeChunks = [];
for (const file of fs.readdirSync(root)) {
  if (/Screens\.dc\.html$/.test(file)) {
    fs.copyFileSync(path.join(root, file), path.join(out, file));
    routeChunks.push(path.join(out, file));
  }
}

// Copy critical root scripts & static files (support.js is the DC runtime that boots React)
for (const file of ['support.js', 'favicon.ico']) {
  const srcFile = path.join(root, file);
  if (fs.existsSync(srcFile)) {
    fs.copyFileSync(srcFile, path.join(out, file));
  }
}

for (const dir of ['Assets', 'src', '_ds', 'data']) {
  const from = path.join(root, dir);
  if (fs.existsSync(from)) {
    fs.cpSync(from, path.join(out, dir), { recursive: true });
  }
}

// The SuperAdmin control center is its own document (not part of the shell). The gateway
// serves it at /admin and /superadmin; a static host needs the files in the publish
// directory and a rewrite (vercel.json / netlify.toml, generated from the route registry).
const controlCenter = path.join(root, 'SuperAdmin', 'frontend');
if (fs.existsSync(controlCenter)) {
  fs.cpSync(controlCenter, path.join(out, 'superadmin'), { recursive: true });
}

// (1) Drop the Python backend — not used by the static frontend, and it embeds
// the Supabase URL as a default (which would leak into the deploy).
fs.rmSync(path.join(out, 'src', 'backend'), { recursive: true, force: true });

// The design-system directory is part of the browser runtime, but its source
// manifests, adherence configuration and readme are build metadata rather than
// public resources. Keep only asset types the generated page can execute/load.
const PUBLIC_DESIGN_EXTENSIONS = new Set(['.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.woff', '.woff2', '.ttf', '.otf']);
function pruneDesignMetadata(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      pruneDesignMetadata(full);
      continue;
    }
    if (!PUBLIC_DESIGN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      fs.rmSync(full, { force: true });
    }
  }
}
pruneDesignMetadata(path.join(out, '_ds'));

// (2) Sanitize filenames Netlify rejects ('#' and '?'). Rename bottom-up so a
// directory is renamed only after its children have been processed.
const sanitize = name => name.replace(/[#?]/g, '_');
let renamed = 0;

function sanitizeTree(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sanitizeTree(full);
    const clean = sanitize(entry.name);
    if (clean !== entry.name) {
      let target = path.join(dir, clean);
      // Avoid clobbering a distinct existing file on collision.
      if (fs.existsSync(target)) {
        const ext = path.extname(clean);
        target = path.join(dir, path.basename(clean, ext) + '_' + (renamed + 1) + ext);
      }
      fs.renameSync(full, target);
      renamed++;
    }
  }
}
for (const dir of ['Assets', 'src', '_ds']) {
  const p = path.join(out, dir);
  if (fs.existsSync(p)) sanitizeTree(p);
}

// Rewrite asset paths inside text files so references match the renamed files.
// Only substrings that are clearly asset paths (start with Assets/, _ds/ or src/)
// are touched, so CSS colors (#fff) and in-page anchors (href="#") are left alone.
const ASSET_PATH = /(?:Assets|_ds|src)\/[^"'()<>]*/gi;
function rewriteRefs(file) {
  if (!fs.existsSync(file)) return;
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(ASSET_PATH, m =>
    m.replace(/%23/gi, '_').replace(/%3f/gi, '_').replace(/[#?]/g, '_')
  );
  if (after !== before) fs.writeFileSync(file, after);
}
rewriteRefs(path.join(out, 'index.html'));
rewriteRefs(path.join(out, '404.html'));
rewriteRefs(path.join(out, 'Commerce App.dc.html'));
for (const file of routeChunks) rewriteRefs(file);
// CSS under the design-system folder may also reference assets by URL.
(function walkCss(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkCss(full);
    else if (entry.name.endsWith('.css')) rewriteRefs(full);
  }
})(path.join(out, '_ds'));
// The catalogue datasets the shell loads at runtime (src/data/*_bundle.js,
// data/catalog.json) carry hashtag asset URLs too; left unrewritten they point
// at the pre-rename filenames and every such image 404s on the CDN.
for (const dir of [path.join(out, 'src', 'data'), path.join(out, 'data')]) {
  (function walkData(d) {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walkData(full);
      else if (/\.(js|json)$/.test(entry.name)) rewriteRefs(full);
    }
  })(dir);
}

// The canonical origin, resolved exactly as the server resolves it (PUBLIC_SITE_URL
// when it is a valid https origin, else the route registry's ORIGIN), so the static
// files below can never disagree with the function's canonical tags and sitemap.
const siteUrl = require('../server/config/env').resolveSiteUrl(process.env.PUBLIC_SITE_URL);

// robots.txt is served by the CDN as a static file (no rewrite), so it is generated
// here from the same builder the gateway's /robots.txt uses: one Disallow list, and a
// Sitemap line on the canonical origin.
fs.writeFileSync(path.join(out, 'robots.txt'), require('../server/modules/system/seo/SeoContent').robotsTxt({ siteUrl }));

// Prerender the home page into the published index.html. Vercel serves '/' as a
// static file (filesystem precedence beats rewrites), so '/' cannot reach the
// prerender function the way every other route does (vercel.json rewrites those
// to /api/index.js). Baking the home SEO head + content here gives '/' the same
// real tags and content. Pure (shared model), no DB, no server config/logger.
try {
  const seoModel = require('../src/seo/seoModel');
  const FrontendRoutes = require('../src/routing/routes');
  const { inject, contentBlock } = require('../server/modules/system/seo/PrerenderService');
  const rawShell = fs.readFileSync(app, 'utf8');
  const { categoryLinks } = require('../server/modules/system/seo/PrerenderService');
  const resolved = FrontendRoutes.resolve('/');
  const descriptor = seoModel.describe(resolved, { siteUrl, path: '/' });
  const head = seoModel.serialize(seoModel.headTags(descriptor));
  // The category directory is static data (no DB), so the baked home page links
  // to every category page that has products, like the function-rendered pages do.
  const content = contentBlock(descriptor, resolved, null, 200, siteUrl, { categories: categoryLinks(), path: '/' });
  fs.writeFileSync(path.join(out, 'index.html'), inject(rawShell, head, content));
  console.log('  prerendered home SEO into public/index.html');
} catch (e) {
  console.warn('  [assemble] home prerender skipped:', e && e.message ? e.message : e);
}

function dirSize(p) {
  let bytes = 0;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, entry.name);
    bytes += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return bytes;
}

console.log(`Assembled ${out} (${(dirSize(out) / (1024 * 1024)).toFixed(1)} MB, sanitized ${renamed} filename(s))`);
