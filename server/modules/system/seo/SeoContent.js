'use strict';

/**
 * LOUMOO — SEO / crawlability content builders (pure, side-effect free).
 * ---------------------------------------------------------------------------
 * These functions turn configuration + data into the exact bytes served at
 * /robots.txt, /sitemap.xml and /.well-known/security.txt. They touch no
 * database, no clock beyond what the caller passes in, and no environment, so
 * they are trivially unit-testable (tests/unit/seo_crawlability.test.js).
 *
 * The HTTP wiring lives in server/modules/system/routes/seoRoutes.js and the
 * dynamic sitemap data gathering in ./SitemapService.js.
 */

// Private / non-indexable URL prefixes. A single source of truth shared by the
// robots.txt Disallow block AND the sitemap's static-route filter, so the two
// can never disagree about what is public. Ordered roughly by how damaging a
// crawl would be (account/admin first).
const PRIVATE_PREFIXES = Object.freeze([
  '/admin',
  '/superadmin',
  '/account',
  '/sell',
  '/rider',
  '/checkout',
  '/cart',
  '/orders',
  '/chat',
  '/notifications',
  '/onboarding',
  '/sign-in',
  '/forgot-password',
  '/reset-password',
  '/verify',
  '/api'
]);

/** True when `p` sits under a private prefix (exact segment match, not substring). */
function isPrivatePath(p) {
  const path = String(p || '');
  return PRIVATE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Strip a trailing slash so `${siteUrl}${path}` never doubles it. */
function normalizeSiteUrl(siteUrl) {
  return String(siteUrl || '').replace(/\/+$/, '');
}

/** Minimal XML text escape for element content and attribute-free <loc> bodies. */
function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * robots.txt — allow crawling of everything public, disallow the private areas,
 * and point crawlers at the sitemap. `?limit=` style query strings are not
 * disallowed here: the discovery pages are meant to be crawled.
 */
function robotsTxt({ siteUrl } = {}) {
  const base = normalizeSiteUrl(siteUrl);
  const lines = [
    'User-agent: *',
    'Allow: /',
    ...PRIVATE_PREFIXES.map((prefix) => `Disallow: ${prefix === '/api' ? '/api/' : prefix}`),
    '',
    `Sitemap: ${base}/sitemap.xml`,
    ''
  ];
  return lines.join('\n');
}

/**
 * RFC 9116 security.txt. `expires` MUST be an ISO-8601 timestamp in the future
 * (the caller computes it); `contact` is a monitored address or URL.
 */
function securityTxt({ siteUrl, contact, expires, languages = 'en, fr', policyUrl = null } = {}) {
  const base = normalizeSiteUrl(siteUrl);
  const contactLine = /^(https?:|mailto:|tel:)/i.test(String(contact || ''))
    ? contact
    : `mailto:${contact}`;
  const lines = [
    '# LOUMOO security contact — see https://www.rfc-editor.org/rfc/rfc9116',
    `Contact: ${contactLine}`,
    `Expires: ${expires}`,
    `Preferred-Languages: ${languages}`,
    `Canonical: ${base}/.well-known/security.txt`
  ];
  if (policyUrl) lines.push(`Policy: ${policyUrl}`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Serialize sitemap entries to a urlset document.
 * @param {object} args
 * @param {string} args.siteUrl                absolute origin (no trailing slash)
 * @param {Array<{path?:string, loc?:string, lastmod?:string, changefreq?:string, priority?:number}>} args.entries
 */
function sitemapXml({ siteUrl, entries = [] } = {}) {
  const base = normalizeSiteUrl(siteUrl);
  const seen = new Set();
  const body = [];

  for (const entry of entries) {
    if (!entry) continue;
    const loc = entry.loc || `${base}${entry.path || '/'}`;
    if (seen.has(loc)) continue;
    seen.add(loc);

    const parts = [`    <loc>${escapeXml(loc)}</loc>`];
    if (entry.lastmod) {
      // Accept Date, ISO string, or a bare YYYY-MM-DD; emit W3C datetime.
      const d = entry.lastmod instanceof Date ? entry.lastmod : new Date(entry.lastmod);
      if (!Number.isNaN(d.getTime())) parts.push(`    <lastmod>${d.toISOString()}</lastmod>`);
    }
    if (entry.changefreq) parts.push(`    <changefreq>${escapeXml(entry.changefreq)}</changefreq>`);
    if (entry.priority != null) parts.push(`    <priority>${Number(entry.priority).toFixed(1)}</priority>`);
    body.push(`  <url>\n${parts.join('\n')}\n  </url>`);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    body.join('\n'),
    '</urlset>',
    ''
  ].join('\n');
}

module.exports = {
  PRIVATE_PREFIXES,
  isPrivatePath,
  normalizeSiteUrl,
  escapeXml,
  robotsTxt,
  securityTxt,
  sitemapXml
};
