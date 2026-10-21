# LOUMOO — search presence (brand query + sitelinks)

What the site gives Google, what it cannot force, and what has to happen outside the code.

## What cannot be promised

- **No code guarantees rank #1 or sitelinks.** Google picks both algorithmically and
  publishes no markup that forces either. Sitelinks (the indented links with a title and a
  description under a brand result) appear only when Google judges the site large and clear
  enough and the query navigational.
- **A brand query ("loumoo") is winnable; a generic one is not.** "loumoo" is a rare word,
  and a web search run on 2026-10-21 (US results only, so not conclusive for google.cm /
  google.fr) found no established site using it, only near-matches such as the town of Loum.
  Once the site is indexed and verified, leading that query is realistic. "meilleur plateforme ecommerce" is a worldwide commercial query held by
  Shopify, Wix, WooCommerce and similar; no on-page change makes LOUMOO #1 there. The
  attainable target is the Cameroon-qualified query ("plateforme e-commerce au Cameroun",
  "marketplace Cameroun"), which the pillar page `/marketplace-cameroun` is written for.
- The pages never claim a ranking ("meilleur", "n°1", "leader"): the FAQ says plainly that no
  official ranking exists. `tests/unit/seo_search_dominance.test.js` enforces that.

## What the code provides (all pinned by tests)

| Signal | Where | Pinned by |
|---|---|---|
| Branded, distinct `<title>` and a 70–160 char description on every public page | `src/seo/seoModel.js` (`ROUTE_TITLES`, `SCREEN_DESCRIPTIONS`) | `seo_search_dominance` §3 |
| Site name (`WebSite` name + alternate names) and `Organization` with stable `@id`, real square logo | `seoModel.js` | §4 |
| Four standalone French pages: pillar, buyer guide, seller guide, About (`kind: 'content'` routes) | `server/modules/system/seo/content/` | §1, §5, `routing_deploy` |
| Crawlable links to all of them from every page | `src/seo/siteNav.json` | §2 |
| Real 404 for unknown URLs (no soft-404), self-canonical, no private path indexed | `PrerenderService`, `vercel.json` | `seo_prerender`, `seo_indexation`, `routing_deploy` |
| `sitemap.xml` with the guides (`lastmod` = the copy's review date) | `SitemapService.js` | §6 |
| Favicon (`/favicon.ico` has 16/32/48 px entries), 1200×630 social card | `Assets/brand/` | §4 |

## Not published on purpose (needs a real value from the owner)

- `ORGANIZATION.sameAs` (`seoModel.js`): the official profile URLs. Empty ⇒ nothing emitted.
  Fill it with profiles that exist and that LOUMOO controls (Facebook, Instagram, LinkedIn,
  TikTok, WhatsApp Business…), all named exactly "LOUMOO".
- `ORGANIZATION.contactEmail`: a monitored support address. Empty ⇒ no `contactPoint`.
  A "Nous contacter" page (a common sitelink) should be added together with it; do not publish
  a phone number or address that is not real.
- No `SearchAction`: the sitelinks search box is retired, and marketplace search has no URL template.

## Launch checklist (the part code cannot do)

1. **Deploy.** The branch that carries this work also carries the "unknown URLs reach the
   gateway (real 404)" fix. Until it is deployed, every unknown URL on the live site answers
   `200` with the home page and a canonical pointing at `/`. Verify after deploy:
   ```bash
   curl -s https://www.loumoo.store/ | grep -o '<title>[^<]*</title>'          # LOUMOO — Marketplace en ligne au Cameroun
   curl -s -o /dev/null -w "%{http_code}\n" https://www.loumoo.store/zzz-nope   # 404
   curl -s -o /dev/null -w "%{http_code}\n" https://www.loumoo.store/a-propos   # 200, and a French <title>
   curl -s https://www.loumoo.store/sitemap.xml | grep -c marketplace-cameroun  # 1
   ```
2. **Verify ownership in Google Search Console** as a *Domain* property (DNS TXT record: covers
   `www` and the apex, and both protocols).
3. **Submit** `https://www.loumoo.store/sitemap.xml` (Sitemaps report).
4. **Request indexing** (URL Inspection → Request indexing) for `/`, `/marketplace-cameroun`,
   `/acheter-en-ligne-cameroun`, `/vendre-en-ligne-cameroun`, `/a-propos`, `/marketplace`, `/stores`.
5. **Create and link the official profiles**, then put them in `ORGANIZATION.sameAs`.
6. **Earn mentions and links** from sites other than your own (Cameroonian directories, local
   press, partner stores, social profiles that link to `https://www.loumoo.store`). Google
   decides a brand result largely from what the rest of the web says about the name.
7. **Watch** Search Console → Performance, filter query contains `loumoo`. Expect days to weeks
   after indexing, not hours; sitelinks usually come later than the first brand result.

## Known limits (follow-ups)

- The visible app has no `<a href>` links: navigation uses click handlers, so the only anchors
  a rendering crawler finds on the home page are in the hidden `#loumoo-prerender` block
  (the four guides, by contrast, have a visible nav and footer). The router already
  intercepts real same-origin anchor clicks (`appRouter.js` `onClick`), so rendering the
  shell's primary navigation as anchors is a safe next step, but it is a change to the
  generated shell (`build_redesign.py`) and is not made here.
- Prerendered shell pages are `<html lang="en">` while their head and crawler content are French.
  Left alone: the visible app chrome is English and the multilingual work is separate.
- The home page requests `/{{ videoModalUrl }}` on load (a template placeholder in the shell's
  video modal) and gets a 404. Unrelated to SEO, visible in the network panel.

## Tests

```bash
node tests/unit/seo_search_dominance.test.js   # brand-search surface
node tests/unit/seo_indexation.test.js         # canonical, indexation, sitemap
node tests/unit/seo_prerender.test.js          # prerender head + real 404s
node tests/unit/routing_deploy.test.js         # Vercel/Express behaviour (needs `node scripts/assemble_public.js` first)
```
