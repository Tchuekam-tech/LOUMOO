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
| One URL per product: readable slug, 301 from the legacy id, one canonical per family of repeats | `ProductSlug.js`, `CuratedUrls.js`, `PrerenderService.js` | `product_slug`, `curated_urls`, `seo_canonical_product` |
| A sitemap of real, distinct, public pages (no test stores, placeholder drafts or repeated products) | `SitemapService.js`, `IndexingPolicy.js` | `seo_sitemap_hygiene` |
| Favicon (`/favicon.ico` has 16/32/48 px entries), 1200×630 social card | `Assets/brand/` | §4 |

## One page per product, and a sitemap of real pages

The seed catalogue has 972 products that are 160 different ones (the generators repeated each under a
new id, photo and "(#11)"). Before this, each was a URL (`/product/phone_google_..._unlocke_17`, ids cut
at 45 characters mid-word, with a `_2` … `_26` counter), the sitemap listed all 972, and the live sitemap
also carried 86 throwaway "test-boutique" stores, two `untitled-draft-listing` slugs, a harness listing and
the same MacBook three times: 1,116 URLs for about 210 real pages.

- **Slug** = the title's whole words (≤ 56 characters) + a 4-character hash of the immutable id
  (`google-pixel-8-pro-128gb-unlocked-android-14-8vxz`): deterministic, never cut inside a word, no
  counter (`ProductSlug.js`; `scripts/catalog_slug.py` is the same algorithm for the Python generators,
  which no longer mint `_N` ids). It is stored in the catalogue files; `node scripts/assign_catalog_slugs.js`
  writes it (and `--check` verifies it). The `id` never changes: orders, carts, reviews and stock are filed under it.
- **Family** = same title (counter removed) + brand; **primary** = the member with the shortest id, so it is
  independent of the dataset's order (`CuratedUrls.js`).
- **URLs.** `/product/<legacy id>` → **301** to the primary's slug (it resolves *by id*, so it is an alias);
  `/product/<primary slug>` → 200, canonical = itself; `/product/<another member's slug>` → 200, canonical = the
  primary (a visitor in the app may be on it), never `noindex`. Live listings are unchanged.
- **Sitemap** = static pages + categories + the 160 primaries + real listings + live stores. Left out: a
  placeholder slug (`untitled-draft-listing-*`, `harness-test-listing-*`), a listing of a test or PRIVATE store,
  repeats of one offer (same title, seller name, category and price: the oldest stays), and stores that are not
  ACTIVE/PUBLIC or are the harnesses' (`test-boutique-*`, `loop-test-boutique-*`, `harness-test-*`, "Test
  Boutique …"). `lastmod` only where a real `updated_at` exists (never for the static catalogue).
- **The browser** holds a product under its id (that is what the bag and checkout send) but its address is the
  slug, and an address that already names the product by either key is never rewritten into the other
  (`routes.js` `urlBind`), so the server's head (title, canonical) survives hydration.

After deploy, verify with the commands in `CHANGES.md` "Priority 6".

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
   `loumoo.store` is served by **Vercel**; the Railway image (`Dockerfile`) is a second deployment.
   Its `assets` stage previously could not build (it lacked the server tree `assemble_public.js`
   needs); that is fixed here, but only checked by reproducing the stage in a scratch directory,
   not with `docker build`. Run one real build before relying on Railway.
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

## Decisions for the owner (found in review, deliberately not changed)

These are product or content calls, not SEO bugs, but Google will index what they say.

1. **"LOUMOO Escrow" in 183 product descriptions.** Those catalogue texts (`data/catalog.json`,
   `src/data/catalog_products.js`) say e.g. "10% de réduction garantie par NanoAfrica avec LOUMOO
   Escrow", and the text flows into each product page's meta description and `Product` JSON-LD.
   The new guides say, truthfully for the current flow, that payment is on delivery with no
   escrow. Pick one story; if there is no escrow, remove the sentence at the source and regenerate
   the two derived files (editing only the SEO output would make the head disagree with the page).
2. **`/marketplace/free-day` is a static demo** (one hard-coded flash-sale product, a fixed
   countdown, "84% Claimed", "Only 3 units left") but it is indexable and in the sitemap, with a
   description promising a delivery-free day at participating boutiques. Remove it from the
   sitemap and noindex it, or build the feature.
3. **`/marketplace/visual` (search by photo)** is indexable, but the feature is off unless
   `SEARCH_ENABLED=true` (the screen otherwise says it is not available). Enable it in production or
   noindex the route.
4. **Travel and hotel bookings are holds, not paid bookings.** The server has no payment gateway
   (`confirmPayment` answers 503, a booking stays PENDING). The guides only say "réserver" and never
   promise a ticket, but the shell's `_confirmTravelBooking` shows "Ticket issued" regardless, and
   the footer's generic "paiement à la livraison" does not literally fit a hotel stay or a bus seat.
5. **NanoAfrica must stay provisioned.** The pillar page features its 972 products and links
   `/store/nanoafrica`; without the provisioned store row those links 404 and checkout refuses the
   products (`docs/NANOAFRICA.md`). It was provisioned in production on 2026-10-11.

## Known limits (follow-ups)

- The catalogue itself still repeats products (972 cards for 160 products, each with its own photo and
  "(#N)" title): only the URLs were consolidated, the marketplace still shows every card. Trimming the data is
  a product decision.
- The test stores and listings the harnesses left in the production database still exist and still answer 200
  (they are not `noindex`, and `/stores` can list them); they are only kept out of the sitemap, by name. The
  proper fix is to delete them and add an `is_test` column that the harnesses set (a production migration, not
  made here). `kamer-tech-solutions-*` (three stores with one name) and the other timestamp-suffixed stores look
  like the same residue but are not named like it, so they are still listed.
- Two real-looking listings keep a draft slug (`untitled-draft-listing-k4x5` is a Samsung Galaxy S24 Ultra):
  the slug was minted from the placeholder title and never regenerated. They are excluded from the sitemap per
  the rule above; re-slugging them (with a redirect) would bring them back.

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
node tests/unit/product_slug.test.js           # slugs: unique, idempotent, whole-word (all 972 products)
node tests/unit/curated_urls.test.js           # families, primaries, legacy ids
node tests/unit/seo_canonical_product.test.js  # canonical, 301s, query kept, 404s unchanged
node tests/unit/seo_sitemap_hygiene.test.js    # the sitemap against production-shaped data
node tests/unit/security_headers_isolation.test.js  # COOP / COEP / CORP / HSTS preload
node tests/unit/routing_deploy.test.js         # Vercel/Express behaviour (needs `node scripts/assemble_public.js` first)
```
