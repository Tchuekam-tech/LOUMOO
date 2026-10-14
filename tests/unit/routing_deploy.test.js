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
  const netlifyText = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  assert.strictEqual(sync.buildVercel(JSON.parse(vercelText)), vercelText, 'vercel.json is out of date: run node scripts/sync_route_config.js');
  assert.strictEqual(sync.buildNetlify(netlifyText), netlifyText, 'netlify.toml is out of date: run node scripts/sync_route_config.js');
  console.log('    ✓ routing_deploy: vercel.json and netlify.toml are exactly what the route registry generates');

  const vercel = JSON.parse(vercelText);
  assert.strictEqual(vercel.trailingSlash, false);
  assert.strictEqual(vercel.rewrites[0].source, '/api/(.*)', 'API routes are matched first');
  assert.strictEqual(vercel.rewrites[0].destination, '/api/index.js');
  vercel.rewrites.forEach(r => {
    assert.ok(!/\(\?!/.test(r.source), `rewrite ${r.source} must not be a negative-lookahead catch-all`);
    assert.ok(r.source !== '/(.*)' && r.source !== '/:path*', 'no catch-all rewrite: it served HTML for missing assets');
  });
  assert.ok(!/\[\[redirects\]\][^\[]*from\s*=\s*"\/\*"/.test(netlifyText), 'netlify.toml has no /* catch-all');
  ['index.html', '404.html', 'superadmin/index.html', 'support.js'].forEach(f =>
    assert.ok(fs.existsSync(path.join(PUBLIC, f)), `public/${f} must be published`));
  assert.strictEqual(
    fs.readFileSync(path.join(PUBLIC, '404.html'), 'utf8'), fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'),
    '404.html must be the application shell (so the router can draw the not-found screen with a real 404)');
  console.log('    ✓ routing_deploy: no catch-all rewrite; API first; 404.html is the app shell; control center published');

  /* ----------------------------------------------------------- 2. Vercel behaviour */
  const host = createEmulator({ config: vercel, outputDir: PUBLIC });
  const expectShell = (u) => {
    const r = host.get(u);
    assert.strictEqual(r.status, 200, `${u}: expected the app shell, got ${r.status} via ${r.via}`);
    assert.strictEqual(path.basename(r.file), 'index.html', `${u}: ${r.file}`);
    assert.strictEqual(path.dirname(r.file), PUBLIC, `${u} must serve the shell, not the control center`);
  };

  let shellRoutes = 0;
  Routes.routes.forEach(r => {
    const u = sample(r);
    if (r.kind === 'screen' || r.kind === 'overlay') {
      if (r.path === '/') { expectShell('/'); return; }
      expectShell(u); shellRoutes++;
    } else if (r.kind === 'page') {
      const res = host.get(u);
      assert.strictEqual(res.status, 200, `${u} (control center) -> ${res.status}`);
      assert.ok(res.file.endsWith(path.join('superadmin', 'index.html')), `${u} -> ${res.file}`);
    } else if (r.kind === 'unavailable') {
      const res = host.get(u);
      assert.strictEqual(res.status, 404, `${u} is documented as not built and must say so with 404`);
      assert.strictEqual(res.via, '404.html');
    }
  });
  console.log(`    ✓ routing_deploy: Vercel serves the app shell with 200 for all ${shellRoutes + 1} application routes, the control center for /admin and /superadmin, and 404 for unbuilt areas`);

  // Unknown routes: a deliberate 404 that still boots the app.
  ['/nope', '/a/b/c/d', '/store', '/store/a/b', '/orders/1/2/3', '/rider/extra', '/Rider', '/store/a.b', '/orders/%2e%2e'].forEach(u => {
    const r = host.get(u);
    assert.strictEqual(r.status, 404, `${u} must be a 404`);
    assert.strictEqual(r.via, '404.html', `${u} must get the app shell as its 404 page`);
  });
  console.log('    ✓ routing_deploy: unknown routes get 404.html (the app, with a real 404) - never a 200');

  // THE production defect: a missing file under a nested route used to come back as HTML with a 200.
  ['/rider/src/services/riderHub.js', '/store/acme/src/services/loumooApi.js', '/delivery/x/Assets/brand/favicon-32.png', '/nope.js', '/src/services/does-not-exist.js', '/Assets/does-not-exist.png', '/_ds/missing.css'].forEach(u => {
    const r = host.get(u);
    assert.notStrictEqual(r.status, 200, `${u}: a missing asset must not be answered with 200 (${r.via})`);
    assert.strictEqual(r.status, 404, `${u} -> ${r.status}`);
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
    assert.strictEqual(r.headers['cache-control'], 'no-cache');
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
