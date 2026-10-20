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
