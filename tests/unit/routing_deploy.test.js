/**
 * Deployment behaviour of the frontend routes - checked against the REAL generated
 * publish directory (public/), the REAL vercel.json and the REAL Express gateway.
 *
 *   1. the hosting config is exactly what the route registry generates (no drift)
 *   2. what Vercel (the live host: loumoo.store answers `Server: Vercel`) would answer for
 *      every route, alias, asset and unknown URL - via a documented-semantics emulator
 *   3. every local asset the shell and its route chunks reference exists in public/ and
 *      resolves from the site root, so a nested URL cannot break it
 *   4. the Express gateway (Railway image / local) says the same thing
 *
 * No browser, no network, no credentials. public/ is built by tests/run_all.js before
 * the suites run (or by `node scripts/assemble_public.js`).
 */
'use strict';

require('../setup');
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const Routes = require('../../src/routing/routes');
const sync = require('../../scripts/sync_route_config');
const { createEmulator } = require('../helpers/vercelEmulator');

const ROOT = path.resolve(__dirname, '../..');
const PUBLIC = path.join(ROOT, 'public');

function sample(route) {
  let p = route.path;
  route.params.forEach(n => { p = p.replace(':' + n, 'sample-1'); });
  return p;
}

function listRefs(html) {
  // Markup only: the controller script is JavaScript whose strings contain HTML fragments.
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, m => m.replace(/>[\s\S]*<\/script>/i, '></script>'));
  const out = [];
  for (const m of markup.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/gi)) out.push(m[1]);
  for (const m of markup.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi)) out.push(m[2]);
  return out;
}
function isLocal(ref) {
  if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return false;   // http:, data:, mailto:, //cdn, #anchor
  if (ref.includes('{{') || ref.includes('${') || ref.includes('"') || ref.includes('<')) return false; // templates
  return true;
}
/** What the browser requests for `ref` on a page whose <base href="/"> is the site root. */
function requestedPath(ref) {
  const u = new URL(ref, 'https://loumoo.test/');   // the same resolution the browser performs
  return u.pathname;
}

function request(server, method, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: headers || {} }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  assert.ok(fs.existsSync(path.join(PUBLIC, 'index.html')), 'public/ is missing: run node scripts/assemble_public.js');

  /* -------------------------------------------- 1. config is generated, not hand-edited */
  const vercelText = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
  assert.strictEqual(sync.buildVercel(JSON.parse(vercelText)), vercelText, 'vercel.json is out of date: run node scripts/sync_route_config.js');
  console.log('    ✓ routing_deploy: vercel.json is exactly what the route registry generates');

  const vercel = JSON.parse(vercelText);
  assert.strictEqual(vercel.trailingSlash, false);
  assert.strictEqual(vercel.rewrites[0].source, '/api/(.*)', 'API routes are matched first');
  assert.strictEqual(vercel.rewrites[0].destination, '/api/index.js');
  assert.strictEqual(vercel.framework, null, 'framework: null - a dashboard Framework Preset must not inject its own SPA fallback');
  vercel.rewrites.forEach((r, i) => {
    assert.ok(!/\(\?!/.test(r.source), `rewrite ${r.source} must not be a negative-lookahead catch-all`);
    // The only catch-all is the LAST rewrite and it goes to the gateway function, never to
    // a static HTML file: a catch-all to index.html served HTML (200) for missing assets and
    // for every unknown URL (observed live 2026-10-21).
    if (r.source === '/(.*)' || r.source === '/:path*') {
      assert.strictEqual(i, vercel.rewrites.length - 1, 'the catch-all must be the last rewrite');
      assert.strictEqual(r.destination, '/api/index.js', 'the catch-all must reach the gateway, not a static document');
    }
  });
  assert.strictEqual(vercel.rewrites[vercel.rewrites.length - 1].source, '/(.*)', 'unknown URLs must reach the gateway (which answers 404 + noindex)');
  ['index.html', '404.html', 'superadmin/index.html', 'support.js'].forEach(f =>
    assert.ok(fs.existsSync(path.join(PUBLIC, f)), `public/${f} must be published`));
  // Both are the application shell (so the router can boot and draw the right
  // screen). index.html additionally carries the build-time home prerender;
  // 404.html stays the raw shell and is served with a real 404 status.
  const shell404 = fs.readFileSync(path.join(PUBLIC, '404.html'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  assert.ok(shell404.includes('<x-dc>') && shell404.includes('<base href="/">'),
    '404.html must be the application shell (so the router can draw the not-found screen with a real 404)');
  assert.ok(indexHtml.includes('<x-dc>') && indexHtml.includes('<base href="/">'),
    'index.html must be the application shell');
  console.log('    ✓ routing_deploy: one final catch-all to the gateway (never to a static page); API first; 404.html + index.html are the app shell; control center published');

  /* ----------------------------------------------------------- 2. Vercel behaviour */
  const host = createEmulator({ config: vercel, outputDir: PUBLIC });
  const expectShell = (u) => {
    const r = host.get(u);
    assert.strictEqual(r.status, 200, `${u}: expected the app shell, got ${r.status} via ${r.via}`);
    assert.strictEqual(path.basename(r.file), 'index.html', `${u}: ${r.file}`);
    assert.strictEqual(path.dirname(r.file), PUBLIC, `${u} must serve the shell, not the control center`);
  };

  let shellRoutes = 0;
  let contentPages = 0;
  Routes.routes.forEach(r => {
    const u = sample(r);
    if (r.kind === 'screen' || r.kind === 'overlay') {
      // The home page is served as a static file (prerendered at build time);
      // every other application route is rewritten to the prerender function.
      if (r.path === '/') { expectShell('/'); return; }
      const res = host.get(u);
      assert.strictEqual(res.status, 200, `${u} -> ${res.status} via ${res.via}`);
      assert.strictEqual(res.via, 'function', `${u} must be prerendered by the function (got ${res.via})`);
      assert.strictEqual(res.destination, '/api/index.js', `${u} -> ${res.destination}`);
      shellRoutes++;
    } else if (r.kind === 'page') {
      const res = host.get(u);
      assert.strictEqual(res.status, 200, `${u} (control center) -> ${res.status}`);
      assert.ok(res.file.endsWith(path.join('superadmin', 'index.html')), `${u} -> ${res.file}`);
    } else if (r.kind === 'content') {
      // A guide is a static file the build writes: no function invocation, one CDN hop.
      const res = host.get(u);
      assert.strictEqual(res.status, 200, `${u} (guide) -> ${res.status} via ${res.via}`);
      assert.strictEqual(res.via, 'rewrite', `${u} must be a rewrite to its static file (got ${res.via})`);
      assert.strictEqual(res.destination, r.page, `${u} -> ${res.destination}`);
      assert.strictEqual(res.file, path.join(PUBLIC, r.page.slice(1)), `${u} -> ${res.file}`);
      const guide = fs.readFileSync(res.file, 'utf8');
      assert.ok(/<html lang="fr">/.test(guide) && (guide.match(/<h1[\s>]/g) || []).length === 1, `${u}: the built file is a complete French document`);
      assert.ok(guide.includes(`<link rel="canonical" href="https://www.loumoo.store${r.path}"`), `${u}: the built file is its own canonical`);
      // The CDN (not Express) sends the CSP for a static file: one generated rule must cover this path.
      const rule = (vercel.headers || []).find(h => new RegExp('^/\\(([a-z0-9|-]+)\\)$').test(h.source) && h.source.slice(2, -1).split('|').includes(r.path.slice(1)));
      assert.ok(rule, `${u}: a headers rule must cover this static guide`);
      assert.deepStrictEqual(rule.headers, (vercel.headers.find(h => h.source === '/') || {}).headers, `${u}: same security headers as the home page`);
      contentPages++;
    } else if (r.kind === 'unavailable') {
      const res = host.get(u);
      // An unbuilt area has no rewrite of its own: it falls to the final catch-all, so the
      // gateway answers it (404 + noindex; tests below, "Express").
      assert.strictEqual(res.via, 'function', `${u} must reach the gateway, which answers 404`);
      assert.strictEqual(res.destination, '/api/index.js');
    }
  });
  assert.ok(contentPages >= 4, `the French guides are checked (${contentPages})`);
  console.log(`    ✓ routing_deploy: Vercel prerenders ${shellRoutes} application routes through the function, serves the home page + control center + ${contentPages} guides statically, and 404s unbuilt areas`);

  // The home page is a static file, but prerendered at build time (assemble_public.js)
  // so '/' — which filesystem precedence keeps off the function — still has real SEO.
  const homeHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  assert.ok(/<link rel="canonical" href="https:\/\/[^"]+\/"[^>]*>/.test(homeHtml), 'home must carry a canonical link');
  assert.ok(/<meta property="og:title"/.test(homeHtml), 'home must carry OpenGraph tags');
  assert.ok(/<meta name="robots" content="index,follow"/.test(homeHtml), 'home must be indexable');
  assert.ok(/id="loumoo-prerender"/.test(homeHtml), 'home must carry a prerendered content block');
  // The baked page is what Vercel serves at '/'. It must carry the same home section the gateway
  // renders on request (assemble_public.js passes home: true), or the two hosts answer differently.
  const bakedBlock = (homeHtml.match(/<div id="loumoo-prerender"[\s\S]*?<\/div>/) || [''])[0];
  const baseUrl = (homeHtml.match(/<link rel="canonical" href="(https:\/\/[^"]+)\/"/) || [])[1];
  assert.ok(/Acheter, vendre et voyager avec un seul compte/.test(bakedBlock), 'the baked home carries the intro section, not only the nav');
  ['/vendre-en-ligne-cameroun', '/marketplace', '/hotels', '/travel'].forEach(p => {
    assert.ok(bakedBlock.includes(`href="${baseUrl}${p}"`), `the baked home links to ${p}`);
  });
  assert.ok((homeHtml.match(/<title>/g) || []).length === 1, 'home must have exactly one <title>');
  console.log('    ✓ routing_deploy: the home page is prerendered (canonical/OG/robots/content) into the static index.html');

  // Unknown routes: never a static 200. They reach the gateway, which answers a real 404
  // (+ noindex) that still boots the app (the Express tests below pin the status and body).
  ['/nope', '/a/b/c/d', '/store', '/store/a/b', '/orders/1/2/3', '/rider/extra', '/Rider', '/store/a.b', '/orders/%2e%2e', '/about'].forEach(u => {
    const r = host.get(u);
    assert.strictEqual(r.via, 'function', `${u} must reach the gateway, not a static page (${r.via})`);
    assert.strictEqual(r.destination, '/api/index.js');
    assert.ok(!r.file, `${u} must not be answered with a static file (soft 404)`);
  });
  console.log('    ✓ routing_deploy: unknown routes reach the gateway (404 + noindex) - never the static home page with a 200');

  // THE production defect: a missing file under a nested route used to come back as HTML with a 200.
  ['/rider/src/services/riderHub.js', '/store/acme/src/services/loumooApi.js', '/delivery/x/Assets/brand/favicon-32.png', '/nope.js', '/src/services/does-not-exist.js', '/Assets/does-not-exist.png', '/_ds/missing.css'].forEach(u => {
    const r = host.get(u);
    // A missing file is handed to the gateway, which answers a plain-text 404 for anything
    // that is not a document request (tests below); the host must never serve HTML for it.
    assert.strictEqual(r.via, 'function', `${u}: a missing asset must reach the gateway (${r.via})`);
    assert.ok(!r.file, `${u}: a missing asset must not be answered with a static page`);
  });
  ['/src/services/riderHub.js', '/src/routing/routes.js', '/src/services/appRouter.js', '/support.js', '/favicon.ico', '/Assets/brand/favicon-32.png', '/ChatProfileScreens.dc.html', '/superadmin/js/superAdminGate.js', '/superadmin/css/super_admin.css'].forEach(u => {
    const r = host.get(u);
    assert.strictEqual(r.status, 200, `${u} -> ${r.status} (${r.via})`);
    assert.strictEqual(r.via, 'static', `${u} must be served as the asset it is`);
  });
  console.log('    ✓ routing_deploy: missing assets (even under nested routes) are 404; real assets are served as files');

  const api = host.get('/api/v1/health');
  assert.strictEqual(api.via, 'function');
  assert.strictEqual(host.get('/api/v1/orders/123?x=1').via, 'function');
  console.log('    ✓ routing_deploy: /api/* still reaches the serverless function');

  // Crawlability endpoints (Priority 1, items 2-4): robots.txt is a REAL static
  // file (never the SPA shell); sitemap.xml and security.txt reach the function
  // so they are generated dynamically rather than falling through to the shell.
  const robots = host.get('/robots.txt');
  assert.strictEqual(robots.status, 200, '/robots.txt must be served');
  assert.strictEqual(robots.via, 'static', '/robots.txt must be a real static file, not the SPA shell');
  assert.strictEqual(path.basename(robots.file), 'robots.txt', `/robots.txt -> ${robots.file}`);
  assert.strictEqual(host.get('/sitemap.xml').via, 'function', '/sitemap.xml must reach the function (dynamic)');
  assert.strictEqual(host.get('/.well-known/security.txt').via, 'function', 'security.txt must reach the function');
  console.log('    ✓ routing_deploy: robots.txt is a static file; sitemap.xml and security.txt reach the function (not the shell)');

  // Redirects: legacy aliases keep the query; trailing slash is canonicalised.
  const redir = (u, to) => {
    const r = host.get(u);
    assert.strictEqual(r.status, 308, `${u} -> ${r.status} (${r.via})`);
    assert.strictEqual(r.location, to, `${u} -> ${r.location}`);
  };
  redir('/index.html', '/');
  redir('/app?utm=a', '/?utm=a');
  redir('/Commerce%20App.dc.html', '/');
  redir('/seller/onboarding?x=1', '/sell/onboarding?x=1');
  redir('/seller/create-store', '/sell/create-store');
  redir('/login', '/sign-in');
  redir('/listing/lst_9?x=1', '/product/lst_9?x=1');
  redir('/announce/spring-sale', '/announcements/spring-sale');
  redir('/rider/', '/rider');
  redir('/superadmin/', '/superadmin');
  redir('/orders/42/', '/orders/42');
  console.log('    ✓ routing_deploy: legacy aliases redirect permanently with the query kept; trailing slashes are canonicalised');

  // The apex host reaches the canonical host in ONE hop (a single 308, path and query kept); the
  // canonical host and preview URLs are never touched by the rule, so www gets no extra hop.
  // (This is the project's half. The plain-http request is upgraded to https by Vercel itself before
  // any of this config runs, and the Domains redirect is a dashboard setting: docs/ROUTING.md.)
  assert.deepStrictEqual(vercel.redirects[0], {
    source: '/(.*)',
    has: [{ type: 'host', value: 'loumoo.store' }],
    destination: `${Routes.ORIGIN}/$1`,
    permanent: true
  }, 'the first redirect sends the apex host to the canonical host');
  const atApex = (u) => host.get(u, { host: 'loumoo.store' });
  [['/', `${Routes.ORIGIN}/`], ['/marketplace', `${Routes.ORIGIN}/marketplace`], ['/marketplace?x=1&utm_source=a', `${Routes.ORIGIN}/marketplace?x=1&utm_source=a`],
    ['/product/google-pixel-8-pro-128gb-unlocked-android-14-d8f82a', `${Routes.ORIGIN}/product/google-pixel-8-pro-128gb-unlocked-android-14-d8f82a`],
    ['/marketplace/category/fashion?page=2', `${Routes.ORIGIN}/marketplace/category/fashion?page=2`], ['/sitemap.xml', `${Routes.ORIGIN}/sitemap.xml`],
    ['/does-not-exist', `${Routes.ORIGIN}/does-not-exist`]].forEach(([from, to]) => {
    const r = atApex(from);
    assert.strictEqual(r.status, 308, `apex ${from} -> ${r.status}`);
    assert.strictEqual(r.location, to, `apex ${from} goes straight to ${to}`);
    // and that ONE hop is the last: what it points at is answered, not redirected again
    const next = host.get(to.slice(Routes.ORIGIN.length), { host: new URL(Routes.ORIGIN).hostname });
    assert.notStrictEqual(next.via, 'redirect', `${to} must not redirect again (that would be a second hop)`);
  });
  ['www.loumoo.store', 'loumoo-git-feature-abc123.vercel.app', 'loumoo-production.up.railway.app', 'xloumoo.store', 'loumoo.store.evil.example'].forEach(h => {
    const r = host.get('/marketplace?x=1', { host: h });
    assert.notStrictEqual(r.via, 'redirect', `${h} is not the apex: no hop`);
    assert.strictEqual(r.status, 200, `${h}: served, not redirected`);
  });
  assert.strictEqual(host.get('/login', { host: 'www.loumoo.store' }).location, '/sign-in', 'the legacy aliases still apply on the canonical host');
  console.log('    ✓ routing_deploy: the apex host is sent to https://www.loumoo.store in one 308, path and query kept; www and preview hosts get no hop');

  /* ---------------------------------------------------- 3. assets resolve from the root */
  const documents = ['index.html', '404.html'].concat(fs.readdirSync(PUBLIC).filter(f => /Screens\.dc\.html$/.test(f)));
  const shell = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const baseAt = shell.indexOf('<base href="/">');
  assert.ok(baseAt > -1, 'the shell must declare <base href="/">');
  const firstRelative = shell.search(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*"\.\//i);
  assert.ok(baseAt < firstRelative, '<base> must come before the first relative reference');
  assert.strictEqual((shell.match(/<base\b/g) || []).length, 1, 'exactly one <base>');
  assert.ok(!/pushState|history\.replaceState\(\s*null/.test(shell.split('<x-dc>')[0]), 'sanity');

  // The scan must be seeing the references: an audit that finds nothing proves nothing.
  const shellRefs = listRefs(shell);
  assert.ok(shellRefs.length > 50, `the scan found only ${shellRefs.length} references in the shell`);
  assert.ok(shellRefs.filter(isLocal).length > 20, `only ${shellRefs.filter(isLocal).length} of ${shellRefs.length} shell references were treated as local: ${JSON.stringify(shellRefs.slice(0, 5))}`);

  const missing = [];
  let checked = 0;
  documents.forEach(doc => {
    const html = fs.readFileSync(path.join(PUBLIC, doc), 'utf8');
    new Set(listRefs(html).filter(isLocal)).forEach(ref => {
      const p = requestedPath(ref);
      checked++;
      const r = host.get(p);
      if (r.status !== 200 || r.via !== 'static') missing.push(`${doc}: ${ref} -> ${r.status} ${r.via}`);
    });
  });
  assert.deepStrictEqual(missing.slice(0, 15), [], `assets the shell and its route chunks reference that the host cannot serve (${missing.length}):\n${missing.slice(0, 15).join('\n')}`);
  console.log(`    ✓ routing_deploy: all ${checked} local asset references in the shell and ${documents.length - 2} route chunks resolve from the site root to real files`);

  // Scripts the shell loads, in order, are the ones that exist, and routes.js precedes appRouter.js.
  const scripts = Array.from(shell.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)).map(m => m[1]);
  assert.ok(scripts.indexOf('./src/routing/routes.js') > -1 && scripts.indexOf('./src/routing/routes.js') < scripts.indexOf('./src/services/appRouter.js'));
  assert.ok(scripts.indexOf('./src/services/appRouter.js') < scripts.indexOf('./src/services/riderHub.js'), 'the router loads before the modules that delegate to it');
  console.log('    ✓ routing_deploy: routes.js -> appRouter.js load before the service modules that delegate to them');

  /* --------------------------------------------------- 4. the Express gateway */
  const app = require('../../server/index');
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const doc = { 'sec-fetch-dest': 'document', accept: 'text/html' };
    const g = async (u, h, m) => request(server, m || 'GET', u, h || doc);

    let r = await g('/');
    assert.strictEqual(r.status, 200); assert.ok(/text\/html/.test(r.headers['content-type'])); assert.ok(r.body.includes('<base href="/">'));
    // Home is prerendered: real head + content block, and CDN-cacheable (public, indexable).
    assert.ok(/s-maxage=\d+/.test(r.headers['cache-control'] || ''), `home should be CDN-cacheable, got ${r.headers['cache-control']}`);
    assert.ok(r.body.includes('rel="canonical"') && r.body.includes('og:title'), 'home must carry prerendered SEO tags');
    assert.ok(r.body.includes('id="loumoo-prerender"'), 'home must carry the prerendered content block');
    for (const u of ['/rider', '/store/acme-1f3a', '/delivery/dlv_1', '/orders/42/tracking', '/marketplace/category/fashion?x=1', '/sell/deliveries/o1']) {
      r = await g(u);
      assert.strictEqual(r.status, 200, `${u} -> ${r.status}`);
      assert.ok(r.body.includes('<x-dc>'), `${u} must be the app shell`);
    }
    r = await g('/rider', doc, 'HEAD');
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body, '');
    for (const u of ['/nope', '/a/b/c', '/markethub', '/agency']) {
      r = await g(u);
      assert.strictEqual(r.status, 404, u);
      assert.ok(r.body.includes('<x-dc>'), `${u}: a 404 page request still gets the app, to draw the not-found screen`);
      assert.strictEqual(r.headers['x-robots-tag'], 'noindex', `${u} must not be indexed`);
    }
    // the DC runtime's own boot re-fetch of the page URL (fetch(), Accept */*) must also get the shell
    r = await g('/nope', { 'sec-fetch-dest': 'empty', accept: '*/*' });
    assert.strictEqual(r.status, 404); assert.ok(r.body.includes('<x-dc>'), 'the runtime needs the template back to render the not-found screen');
    // but a script, an image or a JSON call does not get HTML
    r = await g('/nope', { 'sec-fetch-dest': 'script', accept: '*/*' });
    assert.strictEqual(r.status, 404); assert.ok(/text\/plain/.test(r.headers['content-type'])); assert.ok(!r.body.includes('<x-dc>'));
    r = await g('/nope', { accept: 'application/json' });
    assert.strictEqual(r.status, 404); assert.ok(!r.body.includes('<x-dc>'));
    for (const u of ['/rider/src/services/riderHub.js', '/store/x/Assets/nope.png', '/nope.js', '/src/services/does-not-exist.js']) {
      r = await g(u, { accept: '*/*' });
      assert.strictEqual(r.status, 404, u); assert.ok(/text\/plain/.test(r.headers['content-type']), `${u}: ${r.headers['content-type']}`);
    }
    r = await g('/src/services/riderHub.js', { accept: '*/*' });
    assert.strictEqual(r.status, 200); assert.ok(/javascript/.test(r.headers['content-type']));
    console.log('    ✓ routing_deploy: Express - shell for routes (200), shell+noindex for unknown (404), plain 404 for files, the runtime refetch gets the shell');

    for (const [from, to] of [['/index.html', '/'], ['/app?utm=a', '/?utm=a'], ['/Rider?x=1', '/rider?x=1'], ['/Commerce%20App.dc.html', '/'], ['/seller/onboarding', '/sell/onboarding'], ['/listing/lst_9?x=1', '/product/lst_9?x=1'], ['/announce/spring-sale', '/announcements/spring-sale']]) {
      r = await g(from);
      assert.strictEqual(r.status, 308, from); assert.strictEqual(r.headers.location, to, from);
    }
    console.log('    ✓ routing_deploy: Express - legacy aliases and wrong casing redirect (308) with the query kept');

    r = await g('/api/v1/definitely-not-a-route', { accept: 'application/json' });
    assert.strictEqual(r.status, 404); assert.ok(/json/.test(r.headers['content-type'])); assert.strictEqual(JSON.parse(r.body).error.code, 'ROUTE_NOT_FOUND');
    r = await g('/api/v1/health', { accept: 'application/json' });
    assert.strictEqual(r.status, 200);
    console.log('    ✓ routing_deploy: Express - /api keeps answering JSON (unknown API route is a JSON 404, never the shell)');

    for (const u of ['/admin', '/superadmin']) {
      r = await g(u);
      assert.strictEqual(r.status, 200, u); assert.ok(r.body.includes('Enterprise Control'), `${u} must serve the control center`);
      assert.ok(!r.body.includes('<base'), 'the control center must not rewrite #links to another URL');
      assert.ok(r.body.includes('/superadmin/js/superAdminGate.js'));
    }
    r = await g('/admin/riders');
    assert.strictEqual(r.status, 200); assert.ok(r.body.includes('<x-dc>'), '/admin/riders is an application overlay route');
    r = await g('/superadmin/js/superAdminGate.js', { accept: '*/*' });
    assert.strictEqual(r.status, 200);
    console.log('    ✓ routing_deploy: Express - /admin and /superadmin serve the control center (gate script included); /admin/riders is the app');
  } finally {
    await new Promise(r => server.close(r));
  }
}

module.exports = { run };

if (require.main === module) {
  run().then(() => { console.log('routing_deploy: OK'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
