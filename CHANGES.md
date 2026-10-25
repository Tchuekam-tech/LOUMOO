# LOUMOO — Security / SEO / Crawlability remediation

Each item lists **what changed** and the **exact command that proves it**. Work
is split one branch per priority area. Acceptance criteria that require a live
host (`curl https://<preview>/…`) are proven locally against (a) a
documented-semantics emulator of Vercel's routing over the **real** `vercel.json`
and `public/` build, and (b) the real Express gateway; the matching `curl`
commands to re-run after deploy are listed under "Deploy checklist".

Verified on 2026-10-20. Auth is **Supabase-issued HS256 JWTs** (`loumoo_token` /
`SUPABASE_JWT_SECRET`); Clerk is a dormant dependency that "no longer
authenticates anyone" (`server/config/env.js`), so Priority 5 targets the
Supabase/OTP flow, not Clerk.

---

## Priority 1 — Crawlability / soft-404  (branch: `fix/p1-crawlability`)

### 1. Stop returning HTTP 200 HTML for everything (soft-404)
**Finding:** the live site returns `200` + the ~982 KB SPA shell for *every* URL
(`/does-not-exist.js`, `/some/unknown/route`, `/product/<fake-id>`, even
`/robots.txt`). **Root cause:** production is a *stale* deploy from before commit
`d45e3da`, which already removed the old `"/(.*)" → "/index.html"` catch-all and
switched to explicit per-route rewrites + a `public/404.html` (the shell served
with a real 404 status). The repo (both `main` and this branch) is already
correct; **it has not been deployed.**

**What changed (this branch):** no catch-all was reintroduced; the generator and
emulator tests were extended to lock the behaviour (below). The one case static
hosting cannot fix — `/product/:id` returns the 200 shell even for a
non-existent id — is addressed by the Priority 2 prerender (returns 404 for
unknown products); it is called out here as a known remaining soft-404.

**Proven by:**
```
node scripts/assemble_public.js
node tests/helpers/run_suite.js tests/unit/routing_deploy.test.js
```
Asserts over the real `vercel.json` + `public/`: no catch-all rewrite; `/nope.js`,
`/some/unknown/route`, missing nested assets → **404** (via `404.html`), never a
200; known routes → 200 shell; `/api/*` → function. Express layer: unknown page
→ 404 shell + `X-Robots-Tag: noindex`; missing file/script → plain-text 404.

### 2. /robots.txt  (real static file, excluded from SPA rewrites)
`robots.txt` (repo root) is published to `public/robots.txt` by
`scripts/assemble_public.js`; the CDN serves it directly (no rewrite). The Express
gateway also serves it (Railway/local). Allows crawling; disallows `/admin`,
`/superadmin`, `/account`, `/sell`, `/rider`, `/checkout`, `/cart`, `/orders`,
`/chat`, `/notifications`, `/onboarding`, `/sign-in`, `/forgot-password`,
`/reset-password`, `/verify`, `/api/`; includes `Sitemap: https://loumoo.store/sitemap.xml`.

**Proven by:** `node tests/helpers/run_suite.js tests/unit/seo_crawlability.test.js`
and the `robots.txt is a static file` assertion in `routing_deploy`.

### 3. /sitemap.xml  (dynamic)
`server/modules/system/seo/SitemapService.js` builds a `urlset` from (a) public,
non-parameterised, non-redirect routes in the route registry and (b) published
`PUBLISHED`/`PUBLIC` listings and `ACTIVE` stores in Supabase. Served
`application/xml` with `Cache-Control: s-maxage=21600, stale-while-revalidate`.
DB access is best-effort — an outage or a no-DB env drops the dynamic sections
and still serves the static routes; it never 500s. Private/auth/parameterised
routes can never be listed (shared private-prefix filter).

**Proven by:** `node tests/helpers/run_suite.js tests/unit/seo_crawlability.test.js`
— valid XML, all `<loc>` absolute `https://`, home/stores/travel present,
`/account`,`/admin`,`/sign-in`,`/checkout`,`/sell` absent.

### 4. /.well-known/security.txt  (RFC 9116, text/plain)
Served by the Express function (Vercel rewrite). `Contact`, `Expires` (ISO-8601,
future), `Preferred-Languages: en, fr`, `Canonical`. Contact is configurable via
`SECURITY_CONTACT_EMAIL` (default `security@loumoo.store`); expiry via
`SECURITY_TXT_EXPIRES` (default ~1 year from boot).
**⚠ Action required:** point `SECURITY_CONTACT_EMAIL` at a monitored inbox (the
brief's `support@venice.ai` was a placeholder; no LOUMOO support address exists
in the codebase).

**Proven by:** `node tests/helpers/run_suite.js tests/unit/seo_crawlability.test.js`.

### Deploy checklist (re-run after deploying this branch)
```
curl -sI https://<preview>/does-not-exist.js        # => HTTP 404
curl -sI https://<preview>/some/unknown/route        # => HTTP 404
curl -sI https://<preview>/product/<real-id>         # => HTTP 200
curl -s  https://<preview>/robots.txt                # => text/plain, Sitemap line
curl -s  https://<preview>/sitemap.xml | head        # => application/xml urlset
curl -s  https://<preview>/.well-known/security.txt  # => text/plain, Contact mailto:
```

### Deliberately NOT changed
- **No catch-all reintroduced; no new SPA-serving model in P1.** The live soft-404
  is fixed by **deploying** the current repo, not by a code change.
- **`netlify.toml` / `netlify/`** left untouched — Netlify is no longer used
  (loumoo.store is Vercel); touching it is out of scope.
- **Apex→`www` redirect:** `https://loumoo.store` 308-redirects to
  `https://www.loumoo.store`. The sitemap/canonical base uses the apex (matching
  the route registry `ORIGIN` and the brief) and is overridable via
  `PUBLIC_SITE_URL`. Decide at the infra level whether to stop redirecting the
  apex or flip `PUBLIC_SITE_URL` to `www` so crawlers are not bounced.
- **Pre-existing:** `npm run routes:check` / `tests/unit/routing_docs.test.js`
  report `docs/ROUTING.md` is out of date. This drift exists on `main` and is
  unrelated to these changes (none of its inputs were touched); left as-is. Run
  `node scripts/sync_route_docs.js` to clear it if desired.

---

## Priority 2 — Per-page SEO / indexability  (branch: `fix/p2-seo-prerender`, stacked on P1)

A single shared model, `src/seo/seoModel.js` (UMD, used by both the browser and
the server), is the one source for every page's head. Both sides apply it:

### 5. Per-route document head (title/description/canonical/OG/Twitter + JSON-LD)
The server writes the full head into the initial HTML
(`server/modules/system/seo/PrerenderService.js` → `seoModel`), and the SPA keeps
it in sync on in-app navigation (`src/services/appRouter.js` `applyHead()`).
Product pages carry JSON-LD `Product` (offer, brand, rating); store pages carry
`Store`. The server-written tags and the client-written tags share the
`data-loumoo-seo` marker so client navigation never leaves duplicates, and the
client does not overwrite a freshly prerendered entity page on first load.

**Proven by:** `node tests/helpers/run_suite.js tests/unit/seo_prerender.test.js`
— a public page has an indexable head + content; a product page has `og:type=product`
+ JSON-LD `Product` with an XAF offer; a store page has JSON-LD `Store`.

### 6. Pre-render crawlable pages (real content + tags in the initial HTML)
Every application route is served by the Express function, which injects the head
**and** a small semantic content block (`#loumoo-prerender`) into the shell so a
crawler or link-preview bot that does not run the SPA still sees real content and
the right tags. The block is for bots, never for people: it is visually hidden from the
very first paint (still in the DOM, so crawlers and screen readers keep it), removed
outright once the SPA mounts (`#dc-root`), and shown only by a `<noscript>` rule when
scripts cannot run. React, which the app needs before it can mount, is served from
`src/vendor/` (SRI-pinned, with unpkg as the fallback) so a slow or blocked CDN cannot
strand the visitor; if React cannot be loaded at all, `support.js` shows a retry screen
(`tests/unit/boot_react_vendor.test.js`, `tests/routing/browser/boot_fallback.browser.test.js`).
The home page `/` — which Vercel serves as a static file
(filesystem precedence beats rewrites) — is prerendered at **build time** by
`scripts/assemble_public.js`. `vercel.json` rewrites application routes to the
function and bundles the shell into it (`includeFiles`).

**Proven by:**
```
node scripts/assemble_public.js
node tests/helpers/run_suite.js tests/unit/routing_deploy.test.js     # Vercel-routing emulator + Express
node tests/helpers/run_suite.js tests/unit/seo_prerender.test.js      # head + content + status
```
The routing emulator (over the real `vercel.json` + `public/`) shows every
application route resolving to the function and the home page prerendered into
the static `index.html`; the Express layer serves the prerendered head + content
with the right status and cache headers.

### 7. robots meta: index,follow on public, noindex on private
`seoModel` marks a route `noindex,follow` when it is not a public route, is
guest-only, is under a private prefix (`/account`, `/checkout`, `/cart`,
`/orders`, `/rider`, `/sell`, `/admin`, …) or is a 404 — and `index,follow`
otherwise. Written into the initial HTML by the prerender and kept in sync by the
client. `sendPrerendered` also sets the `X-Robots-Tag: noindex` header on every
non-indexable response.

**Proven by:** `tests/unit/seo_prerender.test.js` (`/account` and a 404 are
noindex; `/stores` and a product are `index,follow`) and `routing_deploy`
(unknown routes carry `X-Robots-Tag: noindex`).

### ⚠ Must be verified on a Vercel preview (not deployed per your instruction)
The prerender runs and is fully tested in the Express layer (Railway + the
function) and via the routing emulator. The **Vercel-specific** wiring cannot be
confirmed without a preview deploy:
```
curl -s  https://<preview>/stores | grep -E 'og:title|rel="canonical"|loumoo-prerender'   # prerendered
curl -sI https://<preview>/product/<real-id>     # 200
curl -sI https://<preview>/product/<fake-id>     # 404 (no soft-404)
curl -s  https://<preview>/           | grep og:title                                      # home baked
```
If a shell route 503s on the preview, the function could not read the shell —
widen `functions."api/index.js".includeFiles` in `vercel.json` (the glob
`Commerce*App.dc.html` matches the spaced filename).

### Deliberately NOT changed
- **Static pages `/terms`, `/privacy`, `/community-guidelines`** (brief item 6):
  no such routes exist in the registry; not invented. If wanted, add them to
  `src/routing/routes.js` and they inherit the prerender automatically.
- **Per-entity OG on client-side navigation:** the client sets route-level tags
  when navigating in-app; entity-level OG/JSON-LD for product/store is written by
  the server prerender (what bots and link previews read). In-app navigation does
  not re-hydrate the head from the loaded entity (follow-up if wanted).

---

## Priority 3 — API hardening  (branch: `fix/p3-api-hardening`, stacked on P2)

### 8. Cap pagination server-side (default 24, max 100; validate page/limit)
New shared helper `server/shared/http/pagination.js` `clampPagination()` turns
untrusted `?page`/`?limit`/`?offset` into a safe `{page, limit, offset}`: `limit`
∈ [1, 100] (default 24), `page` ≥ 1, `offset` ≥ 0. Applied to `GET /api/v1/products`
(and compare-candidates, default 8/max 50) and `GET /api/v1/orders` (which passed
a raw `parseInt` into an uncapped `.range()` — fixed, plus a defensive cap in
`OrderRepository.findOrdersByBuyer`). Already-capped endpoints (`/stores/discovery`
max 50, seller orders max 100, `/search` fixed at 8) were left as-is.

**Proven by:** `node tests/helpers/run_suite.js tests/unit/api_hardening.test.js`
— the pure clamp; and over the running app `GET /api/v1/products?limit=999999` →
`data.limit === 100`, `?limit=0`/`?limit=-5` → 24, `?page=0` → 1.

### 9. Real 404 from GET /api/v1/products/:id (no 200 synthetic fallback)
The route used `findPublicProductByIdOrSlug`, which **fabricates** a placeholder
product ("LOUMOO Available Listing", a made-up 85 000 price) for any unknown id —
so every id returned 200. It now uses the strict `findIndexableProductByIdOrSlug`:
a real DB listing or a REAL curated product, else a **404**; a DB error is a
**503** (`PRODUCT_LOOKUP_UNAVAILABLE`) rather than a fabricated 200 or a wrongful
404. **Fallback kept intentionally** only in `ComparisonService` (comparing a
possibly-curated id by design).

**Proven by:** `tests/unit/api_hardening.test.js` — with a failing DB the endpoint
is 503 (never a fabricated 200); a stubbed "no row" is a 404; a real product is 200.
With NO database configured (dev/demo only — production refuses to boot without
one) the curated catalogue is the whole answer: curated id 200, unknown id 404
(`tests/unit/product_detail_not_found.test.js`).
Also covered on the SEO side by `tests/unit/seo_prerender.test.js` (unknown
product prerenders a real 404).

### 10. /api/config exposes only public-safe values
Verified, not trimmed — the endpoint already returns only browser-safe values:
`supabase.{url,anonKey,publishableKey}`, `clerk.{publishableKey,appId}`,
`posthog.{apiKey,host}`, `sentry.dsn`, verification provider flags, and
`systemSettings`. `systemSettings` comes from `SuperAdminRepository.getPublicSettings`,
which is **deny-by-default**: an allowlist of keys (`PUBLIC_SETTING_KEYS`), a
per-key sub-field allowlist, and `is_secret` rows skipped — so the public-settings
leak flagged in a prior audit is already closed. No secret (service-role key,
Clerk secret, `SUPABASE_JWT_SECRET`, webhook secret) is present.

**Proven by:** `tests/unit/api_hardening.test.js` — `/api/config` exposes the
public keys and the serialized body contains none of `service_role`, `secretKey`,
`jwtSecret`, `webhookSecret`.

### Deliberately NOT changed
- **`findPublicProductByIdOrSlug`** (the fabricating lookup) is kept for
  `ComparisonService` only; the public product API no longer uses it.
- **Other list endpoints** already capped (`/stores/discovery`, seller orders,
  `/search`) were not rewritten onto the shared helper — they are safe and
  changing them adds risk for no security gain. New list endpoints should use
  `clampPagination`.
- **/api/config shape** unchanged — every field is browser-required and public.

---

## Priority 4 — Indexation + security remediation  (branch: `claude/pensive-goodall-zv1636`)

Verified on 2026-10-21 against the repository and local stacks only: the live site
(`loumoo.store`, `www.loumoo.store`) was **not reachable** from the engineering
environment (network policy), so nothing below is a statement about production.

### 11. One canonical origin: `https://www.loumoo.store`
**Finding:** every canonical, `og:url`, JSON-LD URL, sitemap `<loc>` and the robots
`Sitemap:` line used `https://loumoo.store`, which (documented in this file and
`docs/ROUTING.md`, observed 2026-10-20) 308-redirects to `www`. A canonical that
redirects and a sitemap of redirecting URLs are both reported by Search Console as
"Page with redirect" / "Alternate page with proper canonical" and are not indexed.
The origin was also hard-coded in three places, and the browser router ignored
`PUBLIC_SITE_URL`, so an override would have been undone by the first SPA navigation.

**What changed:** `src/routing/routes.js` `ORIGIN` is the single source
(`https://www.loumoo.store`); `server/config/env.js` defaults to it and validates
`PUBLIC_SITE_URL` (absolute https origin only, else ignored with a boot warning);
`scripts/assemble_public.js` resolves it the same way and now **generates**
`public/robots.txt` from `SeoContent.robotsTxt` (the file Vercel actually serves);
the browser router follows the canonical origin the server wrote into the page.

### 12. The rendered DOM kept losing the prerendered head  (pre-existing, P2)
**Finding:** `navigate()` hands the first load to `applyRoute` as `'replace'`, so P2's
"do not overwrite entity tags on first load" check (`mode === 'initial'`) never ran:
after the app mounted, every product page's title became "Product — LOUMOO" and its
Product JSON-LD was removed — which is what Googlebot (a rendering crawler) indexes.
**What changed:** a one-shot flag keeps the server head on the first route applied
when the prerender rendered it for that exact path (`data-path` on the content block).
Generalised to every route, so a 404's `noindex` and a category's title also survive.

### 13. Structured data true to the page
- `Offer.price` used `salePriceNumeric`, which for the 972 curated products is the
  compare-at "was" price (e.g. 208 000 instead of the 187 200 checkout charges). Now
  the payable price (`seoModel.payablePrice`, the lower positive of the two — the rule
  checkout applies). The prerendered visible price was wrong the same way; fixed.
- `aggregateRating` was emitted for every curated product from static dataset values
  no review backs. Now only for live listings with `rating_count >= 1`.
- Store pages: `Store` (a LocalBusiness that promises an address) → `OnlineStore`.
- Added `Organization` + `WebSite` (home), `BreadcrumbList` (product, category, store),
  `Offer.seller`. Image URLs use the published asset path (`./` stripped, `#`/`?`
  renamed as the build renames them — 11 curated images 404'd otherwise).

### 14. No soft-404s, one URL per entity, crawlable listings
- `/marketplace/category/<anything>` answered 200 `index,follow`. Now a category
  directory (`server/modules/system/seo/CategoryDirectory.js`: taxonomy + curated
  categories, no DB) decides: unknown → **404 noindex**; known → its own title and
  description; empty → 200 `noindex`. Alias `real-estate` canonicalises to `real_estate`.
- `/hotels/:id`, `/announcements/:id` (not looked up server-side) → `noindex`.
- `direct: 'redirect'` routes (`/marketplace/filters`, `/travel/results` …) → `noindex`.
- A product or store opened by id canonicalises to its slug (the sitemap URL).
- `/`, `/marketplace`, `/marketplace/categories`, category and store pages now carry
  crawlable product/category links in the prerendered content.

### 15. Sitemap lists what the marketplace sells
Added the curated catalogue (972 product pages that answer 200 and are sold through
the house store) and the category pages that have products. Hermetic: 997 URLs.
Every URL is on the canonical origin, unique, public, and (sampled, 64 renders)
answers 200 `index,follow` with itself as canonical.

### 16. Product lookup during a DB outage  (pre-existing red test on `main`)
`product_detail_not_found` (PR #43) and `api_hardening` (PR #46) contradicted each
other, leaving `main` red. Resolved by meaning: **no DB configured** → the curated
catalogue is the catalogue (unknown id 404); **configured DB failing** → an exact
curated product is still served (static data), anything else is a 503.

### 17. Security
- **CSP blocked the delivery map and rider hub** (MapLibre from cdnjs; tiles, glyphs
  and geocoding from 4 hosts) on every page the gateway serves — after P2 that is
  every app route on Vercel. Added those hosts, nothing broader. `vercel.json` now
  sends the same CSP on the statically served home page and Permissions-Policy +
  HSTS on static responses.
- **`iam.roles` had no RLS** in the API-exposed `iam` schema. Reproduced on the local
  Supabase-equivalent stack: `anon` could SELECT, UPDATE and INSERT it. Migration
  `022_roles_row_level_security.sql` (additive, re-runnable) closes it.
- **A deleted account could sign back in**: `ProfileRepository.getOrCreateForClerkUser`
  un-deleted the profile before the login route's "deleted account" check. It no
  longer reopens an owner-deleted (anonymized) profile.
- **`canPurchase` was not enforced server-side**: unverified / mid-onboarding accounts
  could `POST /api/v1/orders`. Now `requireCapability('canPurchase')` (403 + resolveAt).
- **A store created without a phone published the owner's account phone**
  (`Store.toPublicJSON`). Only a phone typed for the store is published now.

### 18. `npm run build:frontend` silently removed the P2 SEO wiring  (pre-existing)
P2 added the `seoModel.js` script tag and the CSS that hides the crawler content block
to the GENERATED `Commerce App.dc.html` by hand; `build_redesign.py` did not emit them,
so the documented rebuild (also a CI step) dropped both — no head sync on navigation,
and the crawler block shown to humans above the app. The generator now emits them; a
rebuild reproduces the committed shell byte for byte (pinned in `seo_indexation`).

### Proven by
```
node tests/helpers/run_suite.js tests/unit/seo_indexation.test.js       # 1-8 above, sitemap ⊆ indexable
node tests/helpers/run_suite.js tests/unit/security_headers_csp.test.js # CSP / vercel.json parity
node tests/helpers/run_suite.js tests/unit/rls_coverage.test.js         # PGlite: RLS on all 74 tables
node tests/routing/browser/seo_head.browser.test.js                     # Chromium: head after mount + CSP
node tests/routing/backend_authz.e2e.test.js                            # persona matrix; gaps now closed
npm test
```

### Deploy checklist (after deploying; nothing was deployed from here)
```
curl -sI https://loumoo.store/          # confirm: 308 -> https://www.loumoo.store/  (else set PUBLIC_SITE_URL)
curl -sI https://www.loumoo.store/      # 200, carries Content-Security-Policy
curl -s  https://www.loumoo.store/robots.txt | tail -1           # Sitemap: https://www.loumoo.store/sitemap.xml
curl -s  https://www.loumoo.store/sitemap.xml | grep -c '<loc>'  # ~1000+
curl -s  https://www.loumoo.store/product/phone_tecno_tecno_camon_50_pro_5g_256gb_12gb_ | grep -E 'rel="canonical"|"price"'
curl -sI https://www.loumoo.store/marketplace/category/not-a-category   # 404
```
Apply migration 022 (`node scripts/apply_migration.js 022_roles_row_level_security.sql`)
with the project's credentials; then in Search Console submit
`https://www.loumoo.store/sitemap.xml` on a `www` (or Domain) property.

---

## Bug sweep  (branch: `claude/laughing-babbage-xdmzlk`)

Found by running every suite, turning the routing matrix's KNOWN_GAPs into
assertions, a correctness-only lint of the server and the compiled app, a
schema check of every query column, and reading the modules the matrix does
not cover. Each fix has a test that fails without it. S1–S4 were also fixed independently on
`main` (Priority 4); the merge keeps `main`'s versions of those and adds what it
lacked (password reset and OTP refusals, `recordLogin`, Supabase Auth deletion).

| # | Defect | Fix | Proven by |
|---|---|---|---|
| S1 | `GET /products/:id` was 503 for every id with no DB configured (P3 vs no-fabricated-products tests contradicted each other) | no DB → curated catalogue; failing DB → 503 | `product_detail_not_found`, `api_hardening` |
| S2 | A deleted account signed back in and was silently reactivated | no un-delete in `getOrCreateForClerkUser`/`recordLogin`; one refusal rule on password, OTP and reset; deletion removes the Supabase Auth user | `deleted_account_stays_deleted`, routing matrix |
| S3 | `POST /orders` ignored `canPurchase` (unverified / mid-onboarding accounts could order) | `requireCapability('canPurchase')`; checkout shows the 403's next step | routing matrix, `delivery_circuit` |
| S4 | A store created without a phone published the owner's personal phone | only the business phone typed is stored | routing matrix |
| S5 | Admin API served built-in demo rows against a live DB (columns in no migration); store moderation failed on real stores; listing moderation wrote invalid statuses; admin edits waited 5 min on the identity cache | schema-faithful queries + boundary translation, errors throw, cache invalidation, real listing statuses | routing matrix, `super_admin_phase3`, `query_columns_exist` |
| S6 | Any signed-in user could edit/publish/delete someone else's personal (store-less) announcement | `_assertCanManage`: author, or the store's team | `announcement_manage_authz` |
| S7 | An organization ADMIN could promote themselves to OWNER | only the owner grants OWNER; member status validated | `org_owner_escalation` |
| S8 | A mutual block read as "not blocked" (two rows vs `maybeSingle()`); same flaw let duplicate unverified reviews through | `limit(1)` | `mutual_block` |
| S9 | Product page: duplicate bindings showed every seller product as verified, MacBook photos for products without images, no specs for API products, demo store/price fallbacks | one `_productDetailView` reading both product shapes, no invented values | `product_page_view` |
| S10 | Sign-out button skipped emptying the bag (shared devices); "use a different email" kept the old session | one `signOut()`; session cleared | `product_page_view` |
| S11 | Toast OK button bound to an undefined handler; feeds said "end of listings" under every page | `clearToast`, `catalogHasMore` exposed | `template_bindings_resolve` |
| S12 | `npm run build:frontend` dropped the SEO head sync and prerender styles (hand-edited into the build output) | moved into `build_redesign.py` | `build_head_in_sync` |
| S13 | Unknown store shown as "✓ Verified"; every seller's own card said "Verified Merchant"; seller picker never said the customer's pick comes first | real verification only; merged duplicate subtitle | `product_page_view`, `rider_presence_client` |
| S14 | Orders checked stock but never held it: a listing with 1 unit could be sold to every buyer; cancel/deliver never moved stock; every listing was advertised "in stock ×1000" | reserve on placement (all lines or none, 409 when short), release on cancel, consume on delivery, compare-and-swap; cards show on_hand − reserved | `order_inventory_hold`, routing matrix (reserved 2, was 0) |
| S15 | Admin escrow wrote order status directly: refunds left the rider en route, stock held, buyer uninformed; releases could "deliver" an undelivered order | release only after delivery; refund cancels through `OrderLifecycleService` first; settled is final; CAS updates | `super_admin_phase3`, routing matrix |
| S16 | Unrated listings and stores shown as 5.0 stars ("★ 5" on search) | a rating needs at least one review | `product_page_view` |
| S17 | An empty or failed announcement feed was filled with invented "product drops" (fake stores, prices, buy buttons) | feed shows only published broadcasts; empty/error states | `announce_feed_and_store_edit_loading` |
