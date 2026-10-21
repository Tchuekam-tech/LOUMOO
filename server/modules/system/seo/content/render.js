'use strict';

/**
 * LOUMOO — renders a content page (./pages.js) to a complete, standalone HTML document.
 * ---------------------------------------------------------------------------
 * Pure: (page definition, live data, site URL) -> string. No I/O, no clock, no
 * environment, so the build (scripts/assemble_public.js), the gateway and the tests all
 * produce the same bytes for the same inputs.
 *
 * The document needs no JavaScript: the whole page is in the first response, the head
 * comes from the SAME model as every other page (src/seo/seoModel.js), styles are inline
 * (one request), and there is no third-party origin. That keeps these pages fast and lets
 * them carry a strict Content-Security-Policy.
 */

const seoModel = require('../../../../../src/seo/seoModel');
const SITE_NAV = require('../../../../../src/seo/siteNav.json');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Inline markup of the copy: **bold** and [label](/path). Everything else is escaped,
 * so copy can never inject markup. A link target must be a root-relative path.
 */
function inline(text) {
  const out = esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((\/[A-Za-z0-9_\-./]*)\)/g, '<a href="$2">$1</a>');
  return out;
}

function formatPrice(amount, currency) {
  const n = Math.round(Number(amount) || 0);
  if (!n) return '';
  const grouped = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (currency || 'XAF') === 'XAF' ? `${grouped} FCFA` : `${grouped} ${currency}`;
}

/** '/Assets/...' as published (the same renaming seoModel.assetUrl applies), root-relative. */
function localAsset(p) {
  return String(p == null ? '' : p).replace(/^\.\//, '/').replace(/%23|%3f/gi, '_').replace(/[#?]/g, '_');
}

const CSS = `
:root{--blue:#0025e5;--blue-d:#001bb0;--ink:#111214;--muted:#525763;--bg:#f5f7fa;--card:#fff;--line:#e3e7ee;--soft:#eef1ff;--radius:16px}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 "Plus Jakarta Sans",Inter,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--blue);text-underline-offset:3px}
a:hover{color:var(--blue-d)}
:focus-visible{outline:3px solid #7a8cff;outline-offset:2px;border-radius:4px}
.skip{position:absolute;left:-9999px;top:8px;background:#fff;padding:8px 14px;border-radius:8px;z-index:10}
.skip:focus{left:8px}
.wrap{max-width:1040px;margin:0 auto;padding:0 20px}
.top{background:#fff;border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;gap:20px;flex-wrap:wrap;padding-top:12px;padding-bottom:12px}
.brand{display:inline-flex;align-items:center}
.brand img{display:block;height:34px;width:auto}
.nav{display:flex;gap:4px 18px;flex-wrap:wrap;margin:0;padding:0;list-style:none;flex:1}
.nav a{color:var(--ink);text-decoration:none;font-weight:600;font-size:14.5px;padding:6px 0;border-bottom:2px solid transparent}
.nav a:hover,.nav a[aria-current="page"]{border-bottom-color:var(--blue);color:var(--blue)}
.btn{display:inline-block;padding:12px 22px;border-radius:999px;font-weight:700;text-decoration:none;border:2px solid var(--blue);line-height:1.2}
.btn-p{background:var(--blue);color:#fff}
.btn-p:hover{background:var(--blue-d);border-color:var(--blue-d);color:#fff}
.btn-s{background:transparent;color:var(--blue)}
.btn-s:hover{background:var(--soft);color:var(--blue-d)}
.crumbs{font-size:14px;color:var(--muted);padding:18px 0 0}
.crumbs ol{display:flex;flex-wrap:wrap;gap:4px 8px;margin:0;padding:0;list-style:none}
.crumbs li+li::before{content:"/";margin-right:8px;color:#9aa0ad}
.crumbs a{color:var(--muted)}
.hero{padding:28px 0 12px}
.eyebrow{margin:0 0 8px;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--blue)}
h1{font-size:clamp(28px,5vw,44px);line-height:1.15;margin:0 0 16px;letter-spacing:-.02em}
.lead{font-size:clamp(17px,2.2vw,20px);color:var(--muted);max-width:760px;margin:0 0 22px}
.cta{display:flex;gap:12px;flex-wrap:wrap}
section{margin:44px 0}
h2{font-size:clamp(22px,3vw,30px);line-height:1.25;margin:0 0 12px;letter-spacing:-.01em}
h3{font-size:18px;line-height:1.35;margin:0 0 6px}
p{margin:0 0 14px;max-width:760px}
.intro{color:var(--muted)}
ul.list{padding-left:20px;max-width:760px}
ul.list li{margin:6px 0}
ol.steps{list-style:none;counter-reset:s;margin:16px 0;padding:0;display:grid;gap:12px;max-width:820px}
ol.steps li{counter-increment:s;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px 16px 64px;position:relative}
ol.steps li::before{content:counter(s);position:absolute;left:18px;top:14px;width:32px;height:32px;border-radius:50%;background:var(--blue);color:#fff;font-weight:800;display:grid;place-items:center}
ol.steps strong{display:block;margin-bottom:2px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px}
.card p{margin:0 0 8px;color:var(--muted);font-size:15.5px}
.card a.more{font-weight:700;font-size:15px}
.chips{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0;padding:0;list-style:none}
.chips a{display:inline-block;background:#fff;border:1px solid var(--line);border-radius:999px;padding:8px 16px;text-decoration:none;color:var(--ink);font-weight:600;font-size:15px}
.chips a:hover{border-color:var(--blue);color:var(--blue)}
.chips small{color:var(--muted);font-weight:500}
.products{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));list-style:none;padding:0;margin:18px 0}
.products a{display:block;background:#fff;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;text-decoration:none;color:var(--ink);height:100%}
.products a:hover{border-color:var(--blue)}
.products .ph{aspect-ratio:1/1;background:#f1f3f8}
.products img{width:100%;height:100%;object-fit:cover;display:block}
.products .t{display:block;padding:10px 12px 2px;font-weight:600;font-size:14.5px;line-height:1.35}
.products .p{display:block;padding:0 12px 12px;color:var(--blue);font-weight:800;font-size:15px}
.store{display:flex;gap:16px;align-items:center;background:var(--soft);border:1px solid #d3d9ff;border-radius:var(--radius);padding:18px;margin:16px 0;flex-wrap:wrap}
.store p{margin:0;max-width:none}
.store .grow{flex:1;min-width:220px}
.faq dl{margin:0;display:grid;gap:10px;max-width:820px}
.faq dt{font-weight:800;background:var(--card);border:1px solid var(--line);border-bottom:0;border-radius:var(--radius) var(--radius) 0 0;padding:14px 18px 4px;font-size:17px}
.faq dd{margin:-10px 0 0;background:var(--card);border:1px solid var(--line);border-top:0;border-radius:0 0 var(--radius) var(--radius);padding:0 18px 14px;color:var(--muted)}
.band{background:var(--blue);color:#fff;border-radius:22px;padding:30px 28px;margin:48px 0}
.band h2{color:#fff;margin-bottom:8px}
.band p{color:#e4e9ff}
.band .btn-p{background:#fff;color:var(--blue);border-color:#fff}
.band .btn-s{color:#fff;border-color:#fff}
.band .btn-s:hover{background:rgba(255,255,255,.14);color:#fff}
.related{display:flex;gap:10px;flex-wrap:wrap;padding:0;list-style:none}
footer{background:#fff;border-top:1px solid var(--line);margin-top:56px;padding:32px 0 40px;font-size:15px}
footer .cols{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
footer h2{font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
footer ul{list-style:none;margin:0;padding:0}
footer li{margin:6px 0}
footer a{color:var(--ink);text-decoration:none}
footer a:hover{color:var(--blue);text-decoration:underline}
footer .small{margin-top:24px;color:var(--muted);font-size:13.5px;max-width:none}
@media(max-width:640px){.top .wrap{gap:10px}.nav{gap:2px 14px}.hero{padding-top:18px}ol.steps li{padding-left:58px}}
@media(prefers-reduced-motion:no-preference){a,.btn{transition:background-color .15s,color .15s,border-color .15s}}
`.replace(/\s*\n\s*/g, '\n').trim();

function renderBlock(block, ctx) {
  switch (block.t) {
    case 'p':
      return `<p>${inline(block.text)}</p>`;
    case 'list':
      return `<ul class="list">\n${block.items.map((i) => `<li>${inline(i)}</li>`).join('\n')}\n</ul>`;
    case 'steps':
      return `<ol class="steps">\n${block.items.map((i) => `<li><strong>${esc(i.title)}</strong>${inline(i.text)}</li>`).join('\n')}\n</ol>`;
    case 'cards':
      return `<div class="grid">\n${block.items.map((i) => `<div class="card"><h3>${esc(i.title)}</h3><p>${inline(i.text)}</p>${i.link ? `<a class="more" href="${esc(i.link.path)}">${esc(i.link.label)} →</a>` : ''}</div>`).join('\n')}\n</div>`;
    case 'categories': {
      const cats = ctx.data.categories || [];
      if (!cats.length) return '';
      const total = cats.reduce((n, c) => n + c.count, 0);
      const hundreds = Math.floor(total / 100) * 100;
      const lead = hundreds >= 100 ? `<p>Le catalogue compte plus de ${hundreds} produits répartis en ${cats.length} catégories.</p>\n` : '';
      return `${lead}<ul class="chips">\n${cats.map((c) => `<li><a href="${esc(c.path)}">${esc(c.name)} <small>${c.count} produit${c.count > 1 ? 's' : ''}</small></a></li>`).join('\n')}\n</ul>`;
    }
    case 'products': {
      const items = (ctx.data.products || []).slice(0, block.n || 6);
      if (!items.length) return '';
      return `<ul class="products">\n${items.map((p) => `<li><a href="${esc(p.path)}"><span class="ph"><img src="${esc(localAsset(p.image))}" alt="${esc(p.title)}" width="320" height="320" loading="lazy" decoding="async"></span><span class="t">${esc(p.title)}</span>${p.price ? `<span class="p">${esc(formatPrice(p.price, p.currency))}</span>` : ''}</a></li>`).join('\n')}\n</ul>`;
    }
    case 'store': {
      const s = ctx.data.store;
      if (!s) return '';
      return `<div class="store"><div class="grow"><h3>${esc(s.name)}, la boutique officielle de LOUMOO</h3><p>${esc(s.name)} présente ${s.count > 0 ? `${s.count} produits` : 'un catalogue'}${s.city ? ` et est basée à ${esc(s.city)}` : ''}. Ses commandes sont livrées par l’agence ${esc(s.agency)}.</p></div><a class="btn btn-p" href="${esc(s.path)}">Visiter la boutique</a></div>`;
    }
    default:
      throw new Error(`content block type not supported: ${block.t}`);
  }
}

function renderSection(section, ctx) {
  const intro = section.intro ? `<p class="intro">${inline(section.intro)}</p>\n` : '';
  return `<section>\n<h2>${esc(section.h2)}</h2>\n${intro}${section.blocks.map((b) => renderBlock(b, ctx)).join('\n')}\n</section>`;
}

/** schema.org WebPage / AboutPage (+ FAQPage) nodes that point at the site-wide ids. */
function pageJsonLd(page, siteUrl) {
  const url = seoModel.absUrl(siteUrl, page.path);
  const nodes = [{
    '@context': 'https://schema.org/',
    '@type': page.schemaType || 'WebPage',
    '@id': url + '#webpage',
    url,
    name: page.title,
    description: page.description,
    inLanguage: 'fr',
    dateModified: page.updated,
    isPartOf: { '@id': seoModel.siteId(siteUrl) },
    about: { '@id': seoModel.orgId(siteUrl) }
  }];
  if (page.faq && page.faq.length) {
    nodes.push({
      '@context': 'https://schema.org/',
      '@type': 'FAQPage',
      '@id': url + '#faq',
      mainEntity: page.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
    });
  }
  return nodes;
}

/**
 * @param {object} page    an entry of PAGES
 * @param {{siteUrl:string, data?:object, resolved:object, pages?:object[]}} ctx
 *        `resolved` is FrontendRoutes.resolve(page.path); `pages` lets "related" resolve titles.
 */
function renderContentPage(page, ctx) {
  const siteUrl = seoModel.absUrl(ctx.siteUrl, '/').replace(/\/$/, '');
  const data = ctx.data || {};
  const all = ctx.pages || [];

  const descriptor = seoModel.describe(ctx.resolved, {
    siteUrl,
    path: page.path,
    page: { title: page.title, description: page.description, h1: page.h1 },
    breadcrumbs: [{ name: 'Accueil', path: '/' }, { name: page.shortName || page.h1, path: page.path }],
    extraJsonLd: pageJsonLd(page, siteUrl)
  });
  const head = seoModel.serialize(seoModel.headTags(descriptor));

  const navItem = (l) => `<li><a href="${esc(l.path)}"${l.path === page.path ? ' aria-current="page"' : ''}>${esc(l.label)}</a></li>`;
  const related = (page.related || [])
    .map((id) => all.find((p) => p.routeId === id))
    .filter(Boolean)
    .map((p) => `<li><a class="btn btn-s" href="${esc(p.path)}">${esc(p.shortName || p.h1)}</a></li>`)
    .join('\n');

  const contactEmail = seoModel.ORGANIZATION && seoModel.ORGANIZATION.contactEmail;

  const body = `<a class="skip" href="#contenu">Aller au contenu</a>
<header class="top"><div class="wrap">
<a class="brand" href="/" aria-label="LOUMOO, accueil"><img src="/Assets/brand/loumoo-wordmark-360.png" alt="LOUMOO" width="116" height="34"></a>
<nav aria-label="Navigation principale"><ul class="nav">
${SITE_NAV.primary.map(navItem).join('\n')}
</ul></nav>
</div></header>
<main id="contenu" class="wrap">
<nav class="crumbs" aria-label="Fil d’Ariane"><ol><li><a href="/">Accueil</a></li><li aria-current="page">${esc(page.shortName || page.h1)}</li></ol></nav>
<article>
<header class="hero">
<p class="eyebrow">${esc(page.eyebrow)}</p>
<h1>${esc(page.h1)}</h1>
<p class="lead">${inline(page.lead)}</p>
<div class="cta">${page.ctas.map((c) => `<a class="btn ${c.kind === 'primary' ? 'btn-p' : 'btn-s'}" href="${esc(c.path)}">${esc(c.label)}</a>`).join('')}</div>
</header>
${page.sections.map((s) => renderSection(s, { data })).join('\n')}
${page.faq && page.faq.length ? `<section class="faq">\n<h2>Questions fréquentes</h2>\n<dl>\n${page.faq.map((f) => `<dt>${esc(f.q)}</dt>\n<dd>${esc(f.a)}</dd>`).join('\n')}\n</dl>\n</section>` : ''}
<aside class="band">
<h2>Prêt à commencer ?</h2>
<p>Explorez les produits des boutiques LOUMOO ou ouvrez la vôtre.</p>
<div class="cta"><a class="btn btn-p" href="/marketplace">Explorer les produits</a><a class="btn btn-s" href="/vendre-en-ligne-cameroun">Ouvrir une boutique</a></div>
</aside>
${related ? `<nav aria-label="À lire aussi"><h2>À lire aussi</h2><ul class="related">\n${related}\n</ul></nav>` : ''}
</article>
</main>
<footer><div class="wrap">
<div class="cols">
<div><h2>Découvrir</h2><ul>${SITE_NAV.primary.map((l) => `<li><a href="${esc(l.path)}">${esc(l.label)}</a></li>`).join('')}</ul></div>
<div><h2>Guides</h2><ul>${SITE_NAV.guides.map((l) => `<li><a href="${esc(l.path)}">${esc(l.label)}</a></li>`).join('')}</ul></div>
<div><h2>LOUMOO</h2><p>Marketplace en ligne pour acheter, vendre et voyager au Cameroun.</p>${contactEmail ? `<p><a href="mailto:${esc(contactEmail)}">${esc(contactEmail)}</a></p>` : ''}</div>
</div>
<p class="small">© LOUMOO. Les prix sont indiqués en francs CFA (FCFA) ; le paiement s’effectue à la livraison.</p>
</div></footer>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0025E5">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/Assets/brand/favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/Assets/brand/apple-touch-icon.png">
${head}
<style>${CSS}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

module.exports = { renderContentPage, inline, esc, formatPrice, localAsset, pageJsonLd };
