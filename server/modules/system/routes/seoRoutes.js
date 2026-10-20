'use strict';

/**
 * LOUMOO — SEO / crawlability HTTP endpoints.
 * ---------------------------------------------------------------------------
 *   GET /robots.txt                   crawl policy + sitemap pointer
 *   GET /sitemap.xml                  dynamic, from published listings + stores
 *   GET /.well-known/security.txt     RFC 9116 security contact
 *
 * Mounted at the app root in server/index.js BEFORE the SPA shell / static
 * middleware, so these answer as themselves and are never shadowed by the
 * HTML shell. On Vercel, /sitemap.xml and /.well-known/security.txt are routed
 * to this function via vercel.json rewrites; /robots.txt is served as a real
 * static file from public/ (scripts/assemble_public.js copies it).
 */

const express = require('express');
const router = express.Router();

const config = require('../../../config/env');
const logger = require('../../../shared/logging/logger');
const SeoContent = require('../seo/SeoContent');
const SitemapService = require('../seo/SitemapService');

const site = () => (config.site || {});

router.get('/robots.txt', (req, res) => {
  res
    .status(200)
    .type('text/plain; charset=utf-8')
    .set('Cache-Control', 'public, max-age=3600')
    .set('X-Robots-Tag', 'noindex')
    .send(SeoContent.robotsTxt({ siteUrl: site().url }));
});

router.get('/sitemap.xml', async (req, res) => {
  try {
    const xml = await SitemapService.buildSitemap({ siteUrl: site().url });
    res
      .status(200)
      .type('application/xml; charset=utf-8')
      // Revalidate every ~6h at the CDN; serve stale for a day while refreshing.
      .set('Cache-Control', 'public, max-age=0, s-maxage=21600, stale-while-revalidate=86400')
      .send(xml);
  } catch (err) {
    // buildSitemap is already best-effort, but never let the route 500: a broken
    // sitemap endpoint is itself a crawl error. Emit a minimal valid document.
    logger.error(`[Sitemap] generation failed, serving minimal sitemap: ${err && err.message ? err.message : err}`);
    res
      .status(200)
      .type('application/xml; charset=utf-8')
      .set('Cache-Control', 'public, max-age=0, s-maxage=300')
      .send(SeoContent.sitemapXml({ siteUrl: site().url, entries: [{ path: '/', priority: 1.0, changefreq: 'daily' }] }));
  }
});

router.get('/.well-known/security.txt', (req, res) => {
  res
    .status(200)
    .type('text/plain; charset=utf-8')
    .set('Cache-Control', 'public, max-age=86400')
    .set('X-Robots-Tag', 'noindex')
    .send(SeoContent.securityTxt({
      siteUrl: site().url,
      contact: site().securityContact,
      expires: site().securityExpires
    }));
});

module.exports = router;
