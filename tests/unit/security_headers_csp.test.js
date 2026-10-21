/**
 * LOUMOO — security headers: one policy on every host, and a CSP that allows
 * what the app actually loads.
 * ---------------------------------------------------------------------------
 *   1. vercel.json sends the gateway's exact CSP on the statically served home
 *      page, and Permissions-Policy + HSTS on every static response, so a page's
 *      protection does not depend on whether the CDN or the function answered.
 *   2. Every third-party script/stylesheet/data host the delivery map and the
 *      rider hub use (read from the service modules themselves) is allowed by the
 *      directive that governs it. Before this, MapLibre (cdnjs) and every tile and
 *      geocoder host were blocked on each page the gateway serves.
 *   3. The policy keeps its hard lines: no inline script, no framing, no plugins,
 *      no foreign <base>.
 */

require('../setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { DEFAULT_CSP, PERMISSIONS_POLICY, HSTS } = require('../../server/shared/middleware/securityHeaders');

const ROOT = path.resolve(__dirname, '../..');

function directives(csp) {
  const out = {};
  for (const part of csp.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/);
    out[name] = values;
  }
  return out;
}

function allows(list, url) {
  const u = new URL(url);
  return list.some((src) => {
    if (src === 'https:') return u.protocol === 'https:';
    if (!/^https?:\/\//.test(src)) return false;
    const s = new URL(src.replace('*.', 'wildcard.'));
    if (s.protocol !== u.protocol) return false;
    return src.includes('*.') ? u.hostname.endsWith(s.hostname.replace(/^wildcard/, '')) : s.hostname === u.hostname;
  });
}

function constant(file, name) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = src.match(new RegExp(`var ${name}\\s*=\\s*(\\[[^\\]]+\\]|'[^']+')`));
  assert.ok(m, `${file} defines ${name}`);
  return [...m[1].matchAll(/'(https:[^']+)'/g)].map((x) => x[1]);
}

function run() {
  /* 1. vercel.json mirrors the gateway. */
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const header = (source, key) => {
    const rule = (vercel.headers || []).find((h) => h.source === source);
    const h = rule && rule.headers.find((x) => x.key.toLowerCase() === key.toLowerCase());
    return h && h.value;
  };
  assert.strictEqual(header('/', 'Content-Security-Policy'), DEFAULT_CSP, 'the static home page carries the gateway CSP, byte for byte');
  assert.strictEqual(header('/(.*)', 'Permissions-Policy'), PERMISSIONS_POLICY, 'static responses carry the Permissions-Policy');
  assert.strictEqual(header('/(.*)', 'Strict-Transport-Security'), HSTS, 'static responses carry HSTS');
  assert.strictEqual(header('/(.*)', 'X-Content-Type-Options'), 'nosniff');
  assert.strictEqual(header('/(.*)', 'X-Frame-Options'), 'DENY');

  /* 2. The map and rider hub hosts are allowed where they are used. */
  const d = directives(DEFAULT_CSP);
  const scriptHosts = [...constant('src/services/deliveryTrackingScreen.js', 'MAPLIBRE_JS'), ...constant('src/services/riderHub.js', 'MAPLIBRE_JS')];
  const styleHosts = constant('src/services/deliveryTrackingScreen.js', 'MAPLIBRE_CSS');
  const dataHosts = [
    ...constant('src/services/deliveryTrackingScreen.js', 'OPENFREEMAP_STYLE'),
    ...constant('src/services/deliveryTrackingScreen.js', 'DEMO_STYLE'),
    ...constant('src/services/deliveryTrackingScreen.js', 'ESRI_STREET_TILES'),
    ...constant('src/services/riderHub.js', 'ESRI_TILES')
  ].map((u) => u.replace(/\{[^}]*\}/g, '0'));
  const geocoder = fs.readFileSync(path.join(ROOT, 'src/services/deliveryTrackingScreen.js'), 'utf8').match(/'(https:\/\/nominatim[^']+)'/)[1];
  for (const u of scriptHosts) assert.ok(allows(d['script-src'], u), `script-src allows ${u}`);
  for (const u of styleHosts) assert.ok(allows(d['style-src'], u), `style-src allows ${u}`);
  for (const u of [...dataHosts, geocoder]) assert.ok(allows(d['connect-src'], u), `connect-src allows ${u}`);
  assert.ok(d['worker-src'].includes('blob:'), 'MapLibre workers start from blob: URLs');

  /* 3. The hard lines stay. */
  assert.ok(!d['script-src'].includes("'unsafe-inline'"), 'no inline script');
  assert.deepStrictEqual(d['frame-ancestors'], ["'none'"], 'no framing (clickjacking)');
  assert.deepStrictEqual(d['object-src'], ["'none'"], 'no plugins');
  assert.deepStrictEqual(d['base-uri'], ["'self'"], 'no foreign <base>');
  assert.ok(!allows(d['script-src'], 'https://evil.example/x.js'), 'an arbitrary host is not a script source');

  console.log('security_headers_csp: all assertions passed');
}

module.exports = { run };

if (require.main === module) {
  try { run(); process.exit(0); } catch (err) { console.error(err); process.exit(1); }
}
