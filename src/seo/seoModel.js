/**
 * LOUMOO — shared SEO model (UMD: browser + Node).
 * ---------------------------------------------------------------------------
 * THE single source of truth for per-route document head: <title>, description,
 * canonical, robots, OpenGraph, Twitter card, and JSON-LD. Both sides use it:
 *
 *   - the browser router  src/services/appRouter.js  (updates the head on SPA navigation)
 *   - the server prerender server/modules/system/seo/PrerenderService.js
 *                                                     (writes the head into the initial HTML)
 *
 * It takes a resolved route (from src/routing/routes.js `resolve()`), the request
 * path, and an optional hydrated entity (a product or store), and returns a
 * descriptor. `headTags()` turns the descriptor into tag descriptors;
 * `serialize()` renders them to HTML (server) and `applyTags()` applies them to
 * the DOM (browser). No dependency on routes.js: the caller passes the resolution in.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.LoumooSeo = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var DEFAULT_SITE_URL = 'https://loumoo.store';
  var SITE_NAME = 'LOUMOO';
  // An asset the shell already ships, so og:image never 404s even without a
  // dedicated social card. Overridable per entity (product/store image).
  var DEFAULT_IMAGE = '/Assets/brand/icon-192.png';
  var DEFAULT_DESCRIPTION =
    'LOUMOO is Cameroon’s universal commerce marketplace: shop verified boutiques, ' +
    'compare products, book travel and hotels, and get fast, secure delivery across ' +
    'Douala, Yaoundé and beyond.';

  // Private / non-indexable prefixes. Canonical source; server SeoContent re-exports this.
  var PRIVATE_PREFIXES = [
    '/admin', '/superadmin', '/account', '/sell', '/rider', '/checkout', '/cart',
    '/orders', '/chat', '/notifications', '/onboarding', '/sign-in',
    '/forgot-password', '/reset-password', '/verify', '/api'
  ];

  // Route-level descriptions keyed by the registry screen name — the fallback
  // when there is no hydrated entity (static/listing pages).
  var SCREEN_DESCRIPTIONS = {
    home: DEFAULT_DESCRIPTION,
    search: 'Discover products and services from verified LOUMOO boutiques across Cameroon — search, filter and compare.',
    category: 'Browse products by category from verified LOUMOO boutiques, with secure delivery across Cameroon.',
    visual: 'Search LOUMOO by photo — find products that match an image.',
    bestpicks: 'The best picks on LOUMOO, chosen from verified boutiques.',
    freeday: 'LOUMOO free delivery day — shop verified boutiques with delivery on us.',
    vs: 'Compare products side by side on LOUMOO — specs, prices and value at a glance.',
    product: 'Buy on LOUMOO with secure, fast delivery across Cameroon.',
    store: 'Verified boutiques on LOUMOO — discover trusted sellers across Cameroon.',
    business: 'Shop this verified LOUMOO boutique — real products, secure delivery.',
    brand: 'Official brands on LOUMOO.',
    announce: 'The latest announcements and campaigns from LOUMOO boutiques.',
    travel: 'Book flights, buses, travel packages and visa assistance on LOUMOO.',
    travelBus: 'Book intercity bus travel across Cameroon on LOUMOO.',
    travelPackages: 'Curated travel packages, booked on LOUMOO.',
    travelVisa: 'Visa assistance and guidance, on LOUMOO.',
    hotelSearch: 'Find and book hotels across Cameroon on LOUMOO.'
  };

  function clip(s, n) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (s.length <= n) return s;
    return s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
  }
  function stripTrailingSlash(u) { return String(u == null ? '' : u).replace(/\/+$/, ''); }
  function absUrl(siteUrl, pathOrUrl) {
    var base = stripTrailingSlash(siteUrl || DEFAULT_SITE_URL);
    var p = String(pathOrUrl == null ? '/' : pathOrUrl);
    if (/^https?:\/\//i.test(p)) return p;
    if (p.charAt(0) !== '/') p = '/' + p;
    return base + p;
  }
  function isPrivatePath(path) {
    var p = String(path || '');
    var q = p.indexOf('?'); if (q !== -1) p = p.slice(0, q);
    for (var i = 0; i < PRIVATE_PREFIXES.length; i++) {
      var pre = PRIVATE_PREFIXES[i];
      if (p === pre || p.indexOf(pre + '/') === 0) return true;
    }
    return false;
  }
  function canonicalPath(path) {
    var p = String(path == null ? '/' : path);
    var q = p.indexOf('?'); if (q !== -1) p = p.slice(0, q);
    var h = p.indexOf('#'); if (h !== -1) p = p.slice(0, h);
    return p || '/';
  }
  function formatTitle(t) {
    t = String(t == null ? '' : t).trim();
    if (!t || t === SITE_NAME) return 'LOUMOO — Universal Commerce Marketplace';
    return t.indexOf('LOUMOO') === -1 ? t + ' — ' + SITE_NAME : t;
  }

  function productJsonLd(e, url, siteUrl) {
    var ld = { '@context': 'https://schema.org/', '@type': 'Product', name: e.title || 'Product', url: url };
    var desc = e.description || e.shortDescription;
    if (desc) ld.description = clip(desc, 300);
    if (e.brand) ld.brand = { '@type': 'Brand', name: e.brand };
    var img = e.image || e.coverImage || (e.images && e.images[0]);
    if (img) ld.image = absUrl(siteUrl, img);
    if (e.sku || e.id) ld.sku = String(e.sku || e.id);
    var price = e.salePriceNumeric || e.priceNumeric;
    if (price) {
      ld.offers = {
        '@type': 'Offer',
        price: String(price),
        priceCurrency: e.currency || 'XAF',
        availability: (e.inStock === false) ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
        url: url
      };
    }
    if (e.rating && e.reviewsCount) {
      ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: String(e.rating), reviewCount: String(e.reviewsCount) };
    }
    return ld;
  }
  function storeJsonLd(e, url, siteUrl) {
    var ld = { '@context': 'https://schema.org/', '@type': 'Store', name: e.name || e.title || 'Store', url: url };
    var img = e.logoUrl || e.image;
    if (img) ld.image = absUrl(siteUrl, img);
    if (e.description) ld.description = clip(e.description, 300);
    return ld;
  }

  /**
   * @param {{type:string, route?:object, params?:object}} resolved  result of Routes.resolve(path)
   * @param {{siteUrl?:string, path?:string, entity?:object}} opts
   * @returns descriptor consumed by headTags()
   */
  function describe(resolved, opts) {
    opts = opts || {};
    var siteUrl = stripTrailingSlash(opts.siteUrl || DEFAULT_SITE_URL);
    var path = opts.path || '/';
    var route = resolved && resolved.route;
    var screen = route && route.screen;
    var isFound = !!(resolved && resolved.type === 'route');
    var indexable = isFound && route && route.access && route.access.kind === 'public' &&
      !route.guestOnly && !isPrivatePath(path);

    var entity = opts.entity || null;
    var title, description, image, type = 'website', jsonLd = null;
    var canonical = absUrl(siteUrl, canonicalPath(path));

    if (entity && screen === 'product') {
      title = entity.title;
      description = entity.shortDescription || entity.description || SCREEN_DESCRIPTIONS.product;
      image = entity.image || entity.coverImage || (entity.images && entity.images[0]) || DEFAULT_IMAGE;
      type = 'product';
      jsonLd = productJsonLd(entity, canonical, siteUrl);
    } else if (entity && screen === 'business') {
      title = entity.name || entity.title;
      description = entity.description || SCREEN_DESCRIPTIONS.business;
      image = entity.logoUrl || entity.image || DEFAULT_IMAGE;
      jsonLd = storeJsonLd(entity, canonical, siteUrl);
    } else {
      title = (route && route.title) || opts.titleOverride || SITE_NAME;
      description = (screen && SCREEN_DESCRIPTIONS[screen]) || DEFAULT_DESCRIPTION;
      image = DEFAULT_IMAGE;
    }

    return {
      title: formatTitle(title),
      description: clip(description, 160),
      canonical: canonical,
      robots: indexable ? 'index,follow' : 'noindex,follow',
      type: type,
      image: absUrl(siteUrl, image),
      siteName: SITE_NAME,
      jsonLd: jsonLd,
      indexable: indexable
    };
  }

  /** Descriptor -> ordered list of tag descriptors. */
  function headTags(d) {
    var tags = [
      { t: 'title', text: d.title },
      { t: 'meta', attrs: { name: 'description', content: d.description } },
      { t: 'link', attrs: { rel: 'canonical', href: d.canonical } },
      { t: 'meta', attrs: { name: 'robots', content: d.robots } },
      { t: 'meta', attrs: { property: 'og:type', content: d.type } },
      { t: 'meta', attrs: { property: 'og:site_name', content: d.siteName } },
      { t: 'meta', attrs: { property: 'og:title', content: d.title } },
      { t: 'meta', attrs: { property: 'og:description', content: d.description } },
      { t: 'meta', attrs: { property: 'og:url', content: d.canonical } },
      { t: 'meta', attrs: { property: 'og:image', content: d.image } },
      { t: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
      { t: 'meta', attrs: { name: 'twitter:title', content: d.title } },
      { t: 'meta', attrs: { name: 'twitter:description', content: d.description } },
      { t: 'meta', attrs: { name: 'twitter:image', content: d.image } }
    ];
    if (d.jsonLd) tags.push({ t: 'script', attrs: { type: 'application/ld+json' }, json: d.jsonLd });
    return tags;
  }

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escText(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // JSON-LD inside <script>: escape '<' so a value can never close the tag early.
  function jsonLdSafe(obj) { return JSON.stringify(obj).replace(/</g, '\\u003c'); }

  /**
   * Server: tag descriptors -> HTML string (one tag per line). Every managed
   * tag carries data-loumoo-seo="1" — the SAME marker applyTags() uses — so when
   * the SPA later navigates on the client, applyTags() cleanly removes the
   * server-written tags before writing fresh ones (no duplicate robots/canonical/og).
   */
  function serialize(tags) {
    return tags.map(function (x) {
      if (x.t === 'title') return '<title>' + escText(x.text) + '</title>';
      if (x.t === 'script') return '<script type="application/ld+json" data-loumoo-seo="1">' + jsonLdSafe(x.json) + '<\/script>';
      var attrs = Object.keys(x.attrs).map(function (k) { return k + '="' + escAttr(x.attrs[k]) + '"'; }).join(' ');
      return '<' + x.t + ' ' + attrs + ' data-loumoo-seo="1">';
    }).join('\n');
  }

  /** Browser: apply tag descriptors to the live document head (idempotent). */
  function applyTags(doc, tags) {
    if (!doc || !doc.head) return;
    var prev = doc.head.querySelectorAll('[data-loumoo-seo]');
    for (var i = 0; i < prev.length; i++) { if (prev[i].parentNode) prev[i].parentNode.removeChild(prev[i]); }
    for (var j = 0; j < tags.length; j++) {
      var x = tags[j];
      if (x.t === 'title') { doc.title = x.text; continue; }
      var el = doc.createElement(x.t);
      el.setAttribute('data-loumoo-seo', '1');
      if (x.t === 'script') { el.type = 'application/ld+json'; el.textContent = JSON.stringify(x.json); }
      else { for (var k in x.attrs) { if (Object.prototype.hasOwnProperty.call(x.attrs, k)) el.setAttribute(k, x.attrs[k]); } }
      doc.head.appendChild(el);
    }
  }

  /** Convenience: resolve-descriptor-apply in one call (browser). */
  function applyHead(doc, resolved, opts) {
    applyTags(doc, headTags(describe(resolved, opts)));
  }

  return {
    describe: describe,
    headTags: headTags,
    serialize: serialize,
    applyTags: applyTags,
    applyHead: applyHead,
    isPrivatePath: isPrivatePath,
    canonicalPath: canonicalPath,
    formatTitle: formatTitle,
    absUrl: absUrl,
    clip: clip,
    PRIVATE_PREFIXES: PRIVATE_PREFIXES,
    SCREEN_DESCRIPTIONS: SCREEN_DESCRIPTIONS,
    SITE_NAME: SITE_NAME,
    DEFAULT_SITE_URL: DEFAULT_SITE_URL,
    DEFAULT_IMAGE: DEFAULT_IMAGE,
    DEFAULT_DESCRIPTION: DEFAULT_DESCRIPTION
  };
});
