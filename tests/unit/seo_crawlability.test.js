/**
 * LOUMOO — Crawlability endpoints (robots.txt, sitemap.xml, security.txt).
 * ---------------------------------------------------------------------------
 * Priority 1, items 2–4. Two layers:
 *   1. Pure content builders (deterministic, no I/O).
 *   2. A hermetic route smoke test: boots the real Express app and hits the
 *      three endpoints. No database is configured in the test env, so the
 *      sitemap degrades to its static (route-registry) section — which is
 *      exactly the behaviour we want proven for an outage.
 */

require('../setup');
const assert = require('assert');
const http = require('http');

const SeoContent = require('../../server/modules/system/seo/SeoContent');
const SitemapService = require('../../server/modules/system/seo/SitemapService');

const SITE = 'https://loumoo.store';

function assertAbsoluteHttpsLocs(xml) {
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(locs.length > 0, 'sitemap must contain at least one <loc>');
  for (const loc of locs) {
    assert.ok(/^https:\/\//.test(loc), `every <loc> must be an absolute https URL, got: ${loc}`);
  }
  return locs;
}

async function run() {
  /* ── 1. robots.txt ─────────────────────────────────────────────────────── */
  const robots = SeoContent.robotsTxt({ siteUrl: SITE });
  assert.ok(/^User-agent: \*/m.test(robots), 'robots has a wildcard user-agent');
  assert.ok(/^Allow: \/$/m.test(robots), 'robots allows crawling');
  for (const dir of ['/admin', '/account', '/checkout', '/rider', '/api/']) {
    assert.ok(robots.includes(`Disallow: ${dir}`), `robots disallows ${dir}`);
  }
  assert.ok(robots.includes(`Sitemap: ${SITE}/sitemap.xml`), 'robots points at the sitemap');

  /* ── 2. security.txt (RFC 9116) ────────────────────────────────────────── */
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const sec = SeoContent.securityTxt({ siteUrl: SITE, contact: 'security@loumoo.store', expires });
  assert.ok(/^Contact: mailto:security@loumoo\.store$/m.test(sec), 'security.txt has a mailto contact');
  assert.ok(/^Expires: /m.test(sec), 'security.txt has an Expires');
  assert.ok(new Date(sec.match(/^Expires: (.+)$/m)[1]).getTime() > Date.now(), 'Expires is in the future');
  assert.ok(/^Preferred-Languages: /m.test(sec), 'security.txt declares languages');
  assert.ok(sec.includes(`Canonical: ${SITE}/.well-known/security.txt`), 'security.txt is self-canonical');

  /* ── 3. sitemap: static routes only (no DB) ────────────────────────────── */
  const staticRoutes = SitemapService.collectStaticRoutes().map(r => r.path);
  assert.ok(staticRoutes.includes('/'), 'sitemap includes the home page');
  assert.ok(staticRoutes.includes('/stores'), 'sitemap includes /stores');
  assert.ok(staticRoutes.includes('/travel'), 'sitemap includes /travel');
  // No private, auth, or parameterised route may ever be listed.
  for (const bad of ['/account', '/admin', '/sign-in', '/checkout', '/sell', '/account/settings']) {
    assert.ok(!staticRoutes.includes(bad), `sitemap must not list private route ${bad}`);
  }
  for (const p of staticRoutes) {
    assert.ok(p.indexOf(':') === -1, `sitemap static route must not be parameterised: ${p}`);
  }

  const xml = await SitemapService.buildSitemap({ siteUrl: SITE });
  assert.ok(xml.startsWith('<?xml'), 'sitemap is an XML document');
  assert.ok(xml.includes('<urlset'), 'sitemap has a urlset root');
  assert.ok(xml.includes(`<loc>${SITE}/</loc>`), 'sitemap lists the absolute home URL');
  assertAbsoluteHttpsLocs(xml);

  /* ── 4. Live route smoke test (boots the real app) ─────────────────────── */
  const app = require('../../server/index');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const robotsRes = await fetch(`${base}/robots.txt`);
    assert.strictEqual(robotsRes.status, 200, '/robots.txt returns 200');
    assert.ok(/text\/plain/.test(robotsRes.headers.get('content-type') || ''), '/robots.txt is text/plain');
    assert.ok((await robotsRes.text()).includes('Sitemap:'), '/robots.txt body has a Sitemap line');

    const mapRes = await fetch(`${base}/sitemap.xml`);
    assert.strictEqual(mapRes.status, 200, '/sitemap.xml returns 200');
    assert.ok(/application\/xml/.test(mapRes.headers.get('content-type') || ''), '/sitemap.xml is application/xml');
    const mapBody = await mapRes.text();
    assert.ok(mapBody.startsWith('<?xml') && mapBody.includes('<urlset'), '/sitemap.xml is valid XML');
    assertAbsoluteHttpsLocs(mapBody);

    const secRes = await fetch(`${base}/.well-known/security.txt`);
    assert.strictEqual(secRes.status, 200, '/.well-known/security.txt returns 200');
    assert.ok(/text\/plain/.test(secRes.headers.get('content-type') || ''), 'security.txt is text/plain');
    assert.ok((await secRes.text()).includes('Contact: mailto:'), 'security.txt has a contact');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('seo_crawlability: all assertions passed');
}

module.exports = { run };

if (require.main === module) {
  run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}
