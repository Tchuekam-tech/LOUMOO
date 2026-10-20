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
the right tags. The block is hidden by CSS the instant the SPA mounts (`#dc-root`),
so humans see the app. The home page `/` — which Vercel serves as a static file
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
