/**
 * LOUMOO — search presence: the brand query ("loumoo") and the sitelinks under it.
 * ---------------------------------------------------------------------------
 * Google decides ranking and sitelinks itself and publishes no markup that forces
 * either. What the site controls is what it gives Google to work with, and that is what
 * this suite pins (hermetic: no database, no network):
 *
 *   1. registry <-> content pages agree in BOTH directions (a content route with no copy,
 *      or copy with no route, is an indexable 404 or an orphan);
 *   2. the crawler nav (src/seo/siteNav.json) lists only public, indexable, canonical
 *      routes, and every guide is linked from it (so from every page);
 *   3. every indexable page has a branded, distinct title and a distinct, snippet-sized
 *      description (sitelinks show a page's title and description);
 *   4. the brand entity data: Organization + WebSite (site name), logo and social card
 *      that really exist; sameAs / contactPoint appear ONLY when verified values are set;
 *   5. each guide is a complete French document: lang, one h1, self canonical, valid
 *      JSON-LD that matches the visible FAQ, links that resolve, real product pages only,
 *      and no ranking claim the platform cannot back;
 *   6. the sitemap lists each guide once with the copy's review date.
 */

require('../setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const Routes = require('../../src/routing/routes');
const seoModel = require('../../src/seo/seoModel');
const SITE_NAV = require('../../src/seo/siteNav.json');
const Content = require('../../server/modules/system/seo/content');
const { PAGES } = require('../../server/modules/system/seo/content/pages');
const SitemapService = require('../../server/modules/system/seo/SitemapService');
const CatalogRepository = require('../../server/modules/catalog/infrastructure/CatalogRepository');

const ROOT = path.resolve(__dirname, '../..');
const SITE = Routes.ORIGIN;

const attr = (html, re) => ((html.match(re) || [])[1] || '');
const jsonLdOf = (html) => [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** What a reader sees: no scripts, no styles, no tags, entities decoded, whitespace collapsed. */
const visibleText = (html) => decode(html
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const pngSize = (file) => { const b = fs.readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

async function run() {
  /* ── 1. Registry <-> content pages ────────────────────────────────────── */
  const contentRoutes = Routes.routes.filter((r) => r.kind === 'content');
  assert.ok(contentRoutes.length >= 4, 'the pillar, buyer guide, seller guide and About are content routes');
  contentRoutes.forEach((r) => {
    const page = Content.pageForRoute(r.id);
    assert.ok(page, `content route ${r.id} has copy in content/pages.js`);
    assert.strictEqual(page.path, r.path, `${r.id}: the copy and the route share one path`);
    assert.strictEqual(r.page, `/pages/${page.id}.html`, `${r.id}: the route names the static file the build writes`);
    assert.ok(r.access && r.access.kind === 'public', `${r.id} is public`);
  });
  PAGES.forEach((p) => {
    const r = Routes.byId(p.routeId);
    assert.ok(r && r.kind === 'content', `copy "${p.id}" points at a content route (${p.routeId})`);
  });
  assert.strictEqual(new Set(PAGES.map((p) => p.path)).size, PAGES.length, 'no two guides share a path');
  assert.strictEqual(new Set(PAGES.map((p) => p.id)).size, PAGES.length, 'no two guides share a file name');
  assert.ok(PAGES.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.updated)), 'every guide carries a review date (the sitemap lastmod)');

  /* ── 2. The crawler nav ───────────────────────────────────────────────── */
  const navPaths = [];
  ['primary', 'guides'].forEach((group) => {
    assert.ok(Array.isArray(SITE_NAV[group]) && SITE_NAV[group].length, `siteNav has a "${group}" list`);
    const seen = new Set();
    SITE_NAV[group].forEach((l) => {
      assert.ok(l.label && l.label.trim() === l.label, `${group}: "${l.label}" is a clean label`);
      assert.ok(!seen.has(l.path), `${group}: ${l.path} is listed once`);
      seen.add(l.path);
      const res = Routes.resolve(l.path);
      assert.strictEqual(res.type, 'route', `siteNav ${l.path} resolves to a route`);
      assert.strictEqual(res.route.access.kind, 'public', `siteNav ${l.path} is public`);
      assert.ok(!res.route.guestOnly && (res.route.direct || 'allow') === 'allow', `siteNav ${l.path} opens from a URL`);
      assert.ok(!seoModel.isPrivatePath(l.path), `siteNav ${l.path} is not a private path`);
      assert.strictEqual(Routes.normalizePath(l.path), l.path, `siteNav ${l.path} is already canonical`);
      navPaths.push(l.path);
    });
  });
  assert.ok(navPaths.includes('/'), 'the nav links home');
  PAGES.forEach((p) => assert.ok(navPaths.includes(p.path), `${p.path} is linked from the nav on every page`));

  /* ── 3. Branded, distinct titles and descriptions ─────────────────────── */
  const heads = [];
  Routes.routes.forEach((r) => {
    if (r.path.indexOf(':') !== -1) return;
    if (r.kind === 'content') {
      const p = Content.pageForPath(r.path);
      heads.push({ path: r.path, title: seoModel.formatTitle(p.title), description: p.description });
      return;
    }
    const d = seoModel.describe(Routes.resolve(r.path), { siteUrl: SITE, path: r.path });
    if (d.indexable) heads.push({ path: r.path, title: d.title, description: d.description });
  });
  assert.ok(heads.length >= 15, `the public pages are covered (${heads.length})`);
  const home = heads.find((h) => h.path === '/');
  assert.ok(home.title.startsWith('LOUMOO'), 'the home title leads with the brand name');
  heads.forEach((h) => {
    assert.ok(h.title.includes('LOUMOO'), `${h.path}: the title carries the brand (${h.title})`);
    assert.ok(h.title.length <= 65, `${h.path}: the title fits a result line (${h.title.length}): ${h.title}`);
    assert.ok(h.description.length >= 70 && h.description.length <= 160,
      `${h.path}: a snippet-sized description, 70-160 chars (${h.description.length}): ${h.description}`);
  });
  const dups = (key) => { const m = {}; heads.forEach((h) => { (m[h[key]] = m[h[key]] || []).push(h.path); }); return Object.entries(m).filter(([, v]) => v.length > 1); };
  assert.deepStrictEqual(dups('title'), [], 'no two public pages share a title');
  assert.deepStrictEqual(dups('description'), [], 'no two public pages share a description');

  /* ── 4. Brand entity data ─────────────────────────────────────────────── */
  const org = seoModel.organizationJsonLd(SITE);
  const site = seoModel.websiteJsonLd(SITE);
  assert.strictEqual(org['@type'], 'Organization');
  assert.strictEqual(org.name, 'LOUMOO');
  assert.strictEqual(org.url, `${SITE}/`);
  assert.strictEqual(org['@id'], `${SITE}/#organization`, 'a stable @id other nodes can point at');
  assert.ok(/^https:\/\//.test(org.logo) && fs.existsSync(path.join(ROOT, org.logo.slice(SITE.length))), 'the logo URL is absolute and the file ships');
  const logo = pngSize(path.join(ROOT, org.logo.slice(SITE.length)));
  assert.ok(logo.w >= 112 && logo.h >= 112 && logo.w === logo.h, `the logo is square and at least 112px (${logo.w}x${logo.h}), Google's minimum`);
  assert.strictEqual(site['@type'], 'WebSite');
  assert.strictEqual(site.name, 'LOUMOO', 'the site-name signal');
  assert.deepStrictEqual(site.alternateName, seoModel.ORGANIZATION.alternateNames, 'the alternate names people also type');
  assert.deepStrictEqual(site.publisher, { '@id': org['@id'] }, 'the site is published by the organisation node');
  assert.ok(!('potentialAction' in site), 'no SearchAction: the sitelinks search box is retired and search has no URL template');
  assert.ok(!('sameAs' in org) && !('contactPoint' in org), 'nothing unverified is published: no sameAs, no contactPoint while the values are empty');
  assert.ok(!('address' in org) && !('telephone' in org) && !('aggregateRating' in org), 'no address, phone or rating the repository cannot back');
  const social = path.join(ROOT, seoModel.DEFAULT_IMAGE);
  assert.ok(fs.existsSync(social), 'the default og:image ships');
  const card = pngSize(social);
  assert.deepStrictEqual(card, { w: 1200, h: 630 }, 'the default social card is the 1200x630 Open Graph size');

  // sameAs / contactPoint are emitted exactly when verified values are provided.
  const saved = { sameAs: seoModel.ORGANIZATION.sameAs, contactEmail: seoModel.ORGANIZATION.contactEmail };
  try {
    seoModel.ORGANIZATION.sameAs = ['https://www.facebook.com/loumoo.example', 'https://www.linkedin.com/company/loumoo-example'];
    seoModel.ORGANIZATION.contactEmail = 'support@example.org';
    const filled = seoModel.organizationJsonLd(SITE);
    assert.deepStrictEqual(filled.sameAs, seoModel.ORGANIZATION.sameAs, 'verified profiles are published as sameAs');
    assert.strictEqual(filled.contactPoint.email, 'support@example.org', 'a monitored address becomes the contactPoint');
    assert.strictEqual(filled.contactPoint['@type'], 'ContactPoint');
  } finally {
    seoModel.ORGANIZATION.sameAs = saved.sameAs;
    seoModel.ORGANIZATION.contactEmail = saved.contactEmail;
  }

  /* ── 5. Each guide is a complete French document ──────────────────────── */
  const data = Content.collectData();
  const curatedIds = new Set((CatalogRepository._curatedCards() || []).map((c) => String(c.id)));
  assert.ok(curatedIds.size > 100, 'the curated catalogue is loaded (the product links are checked against it)');
  for (const page of PAGES) {
    const out = Content.render(page.path, { siteUrl: SITE, data });
    assert.ok(out && out.html, `${page.path} renders`);
    const html = out.html;
    const where = page.path;
    assert.ok(/^<!doctype html>/i.test(html.trim()), `${where}: a standalone HTML document`);
    assert.ok(/<html lang="fr">/.test(html), `${where}: declared French`);
    assert.strictEqual((html.match(/<title>/g) || []).length, 1, `${where}: exactly one <title>`);
    assert.strictEqual(attr(html, /<title>([^<]*)<\/title>/), decode(seoModel.formatTitle(page.title)).replace(/&/g, '&'), `${where}: the title comes from the shared model`);
    assert.strictEqual((html.match(/<h1[\s>]/g) || []).length, 1, `${where}: exactly one <h1>`);
    assert.strictEqual(attr(html, /<link rel="canonical" href="([^"]+)"/), `${SITE}${page.path}`, `${where}: its own canonical`);
    assert.strictEqual(attr(html, /<meta name="robots" content="([^"]+)"/), 'index,follow', `${where}: indexable`);
    assert.ok(/property="og:image" content="https:\/\/[^"]+"/.test(html), `${where}: an absolute og:image`);

    const ld = jsonLdOf(html);
    const types = ld.map((x) => x['@type']);
    assert.ok(types.includes(page.schemaType), `${where}: ${page.schemaType} JSON-LD`);
    assert.ok(types.includes('BreadcrumbList'), `${where}: BreadcrumbList JSON-LD`);
    const crumbs = ld.find((x) => x['@type'] === 'BreadcrumbList').itemListElement;
    assert.ok(crumbs.length >= 2 && crumbs[0].item === `${SITE}/`, `${where}: the trail starts at home`);
    assert.strictEqual(crumbs[crumbs.length - 1].item, `${SITE}${page.path}`, `${where}: the trail ends at this page`);
    crumbs.forEach((c, i) => assert.strictEqual(c.position, i + 1, `${where}: breadcrumb positions are 1..n`));

    const text = visibleText(html);
    const faq = ld.find((x) => x['@type'] === 'FAQPage');
    if (faq) {
      assert.ok(faq.mainEntity.length >= 1, `${where}: FAQPage has questions`);
      faq.mainEntity.forEach((q) => {
        assert.ok(text.includes(q.name), `${where}: FAQ question is visible on the page: ${q.name}`);
        assert.ok(text.includes(q.acceptedAnswer.text), `${where}: FAQ answer is visible on the page (structured data must match what a reader sees)`);
      });
    }

    // Every internal link resolves; product links are real curated products only.
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length >= 20, `${where}: crawlable links (${hrefs.length})`);
    hrefs.forEach((href) => {
      if (/^(https?:|mailto:|tel:|#)/i.test(href)) return;
      assert.ok(href.startsWith('/'), `${where}: ${href} is root-relative`);
      assert.ok(!/[?#]/.test(href), `${where}: ${href} carries no query or fragment`);
      const res = Routes.resolve(href);
      if (res.type !== 'route') assert.fail(`${where}: broken internal link ${href}`);
      if (res.route.id === 'product') assert.ok(curatedIds.has(decodeURIComponent(href.slice('/product/'.length))), `${where}: ${href} is a real product`);
      assert.ok(res.route.access.kind === 'public' || href === '/onboarding', `${where}: ${href} is a public destination (sign-up aside)`);
    });
    PAGES.forEach((p) => assert.ok(hrefs.includes(p.path), `${where}: links to ${p.path}`));
    assert.ok(hrefs.includes('/'), `${where}: links home`);

    // No claim the platform cannot back. "meilleur" may only appear to say no ranking exists.
    assert.ok(!/n°\s?1|numéro\s+(?:1|un)\b|\bleader\b|incontournable|garanti à 100/i.test(text), `${where}: no ranking or superlative claim`);
    if (/meilleur/i.test(text)) assert.ok(/classement officiel/i.test(text), `${where}: "meilleur(e)" appears only next to the statement that no official ranking exists`);
    assert.ok(!/\b(?:avis clients?|témoignage|noté\s+\d|\d(?:[.,]\d)?\s*\/\s*5)\b/i.test(text), `${where}: no review or testimonial the repository cannot back`);
    assert.ok(!seoModel.isPrivatePath(page.path), `${where}: not a private path`);
  }

  /* ── 6. The sitemap lists each guide once, with the copy's review date ─ */
  const xml = await SitemapService.buildSitemap({ siteUrl: SITE });
  for (const page of PAGES) {
    const loc = `${SITE}${page.path}`;
    assert.strictEqual(xml.split(`<loc>${loc}</loc>`).length - 1, 1, `${page.path} is in the sitemap exactly once`);
    const entry = xml.slice(xml.indexOf(`<loc>${loc}</loc>`)).split('</url>')[0];
    assert.ok(entry.includes(`<lastmod>${page.updated}T00:00:00.000Z</lastmod>`), `${page.path}: lastmod is the copy's review date (${page.updated})`);
  }
  assert.ok(xml.includes(`<loc>${SITE}/</loc>`), 'the home page is in the sitemap');

  console.log(`seo_search_dominance: all assertions passed (${heads.length} heads, ${PAGES.length} guides)`);
}

module.exports = { run };

if (require.main === module) {
  run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
}
