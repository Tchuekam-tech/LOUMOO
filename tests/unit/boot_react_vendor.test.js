/**
 * LOUMOO — the app must not wait on a third-party CDN to start.
 * ---------------------------------------------------------------------------
 * The shell (support.js, the DC runtime) needs React and ReactDOM before it can
 * mount. They used to come ONLY from unpkg.com, so a slow or blocked CDN left the
 * visitor on the server-prerendered SEO fallback (or a blank page) for as long as
 * unpkg took, forever if it failed. They are now served from this origin
 * (src/vendor/), with the CDN as the fallback. This proves, with no browser:
 *
 *   1. the vendored files are byte-identical to the files support.js pins by SRI
 *      (a different React build can never be shipped under the old pin, and a bump
 *      of the CDN pin cannot silently leave the local copy behind);
 *   2. the generator (build_redesign.py) and the generated shell
 *      (Commerce App.dc.html) both preload them, with the same integrity, so the
 *      next rebuild keeps the preload;
 *   3. the CSS that keeps the crawler block away from people comes from the
 *      generator too: hidden from first paint, revealed only by <noscript>.
 *
 * The real-browser behaviour (nothing visible before the app mounts, the CDN
 * fallback, the retry screen) is tests/routing/browser/boot_fallback.browser.test.js.
 */

require('../setup');
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const sri = (f) => 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(path.join(ROOT, f))).digest('base64');

const BUNDLES = [
  { file: 'src/vendor/react.production.min.js', pin: 'REACT_SRI', url: 'REACT_URL', name: 'react' },
  { file: 'src/vendor/react-dom.production.min.js', pin: 'REACT_DOM_SRI', url: 'REACT_DOM_URL', name: 'react-dom' }
];

async function run() {
  const support = read('support.js');
  const generator = read('build_redesign.py');
  const shell = read('Commerce App.dc.html');
  const constant = (name) => (support.match(new RegExp(`var ${name} = "([^"]+)"`)) || [])[1];

  for (const b of BUNDLES) {
    assert.ok(fs.existsSync(path.join(ROOT, b.file)), `${b.file} is vendored`);
    assert.strictEqual(sri(b.file), constant(b.pin), `${b.file} is byte-identical to the file support.js pins (${b.pin})`);
    assert.ok(/@18\.3\.1\//.test(constant(b.url)), `${b.url} still names the version the vendored copy is`);
    assert.ok(support.includes(`"${b.file}"`), `support.js loads ${b.file} first`);

    const preload = `<link rel="preload" as="script" href="./${b.file}" integrity="${constant(b.pin)}" crossorigin="anonymous">`;
    assert.ok(generator.includes(preload), `build_redesign.py emits the preload for ${b.name}`);
    assert.ok(shell.includes(preload), `Commerce App.dc.html carries the preload for ${b.name}`);
    // The preload must come before support.js so the fetch starts first, not behind the
    // other scripts (HTTP/1.1 allows six connections per host).
    for (const [label, text] of [['generator', generator], ['shell', shell]]) {
      assert.ok(text.indexOf(preload) < text.indexOf('<script src="./support.js"></script>'), `${label}: ${b.name} is preloaded before support.js`);
    }
  }

  // The crawler block: hidden from first paint, shown only without JavaScript.
  for (const [label, text] of [['generator', generator], ['shell', shell]]) {
    assert.ok(text.includes('#loumoo-prerender { position: absolute; width: 1px; height: 1px;'), `${label}: the fallback is visually hidden from first paint`);
    assert.ok(text.includes('body:has(#dc-root) #loumoo-prerender { display: none !important; }'), `${label}: and removed once the app mounts`);
    assert.ok(/<noscript><style>[^<]*#loumoo-prerender \{ position: static !important;/.test(text), `${label}: <noscript> shows it when scripts cannot run`);
    assert.ok(text.includes('body:not(:has(#dc-root))::before'), `${label}: a loading indicator stands in until the app mounts`);
  }

  // A failed start must end in something a person can act on, not a dead screen.
  assert.ok(/\.catch\(\(err\) => \{[^}]*showBootFailure\(\);/.test(support), 'support.js shows the retry screen when React cannot be loaded');

  console.log('boot_react_vendor: all assertions passed');
}

module.exports = { run };

if (require.main === module) {
  run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
}
