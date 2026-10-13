# LOUMOO — Production Deployment Runbook

> **Frontend URLs and hosting rewrites** (which host is live, what `vercel.json` rewrites, the 404 behaviour,
> `<base href="/">`, how to add a route and the post-deploy checklist) are in [ROUTING.md](ROUTING.md).
> Note that `loumoo.store` is currently served by **Vercel** (static `public/` + the `api/index.js` function);
> the Railway container described below is a complete second deployment of the same app.

This document is the single source of truth for taking LOUMOO from this repo
to a live production deployment on **Railway** (Node container). Everything
else in the repo is already configured:

| Artifact | Status |
|---|---|
| `Dockerfile` | ✅ multi-stage, non-root, HEALTHCHECK |
| `railway.json` | ✅ DOCKERFILE builder, healthcheck path |
| `.github/workflows/ci.yml` | ✅ tests + prod-config smoke job on every push/PR |
| `.github/workflows/deploy.yml` | ✅ Railway push on main (needs 2 secrets) |
| `.dockerignore` | ✅ secrets excluded |
| `docker-compose.yml` | ✅ local dev convenience |

---

## 1. Railway authentication (ONE TIME, needs a browser)

The Railway CLI on this machine is **not** authenticated. Choose ONE:

### Option A — login on this machine (30 seconds)
```bash
railway login        # opens browser → click "Authorize"
```

### Option B — project token (no browser)
1. Open https://railway.com → your project (`cd1a2200-106c-4633-9a22-887b9ac206b`)
2. **Settings → Tokens → Generate Token** (or use `railway token create`)
3. Paste the token:
```bash
railway login --token <TOKEN>
```

> Note: `cd1a2200-106c-4633-9a22-887b9ac206b` is the **project ID** — it is
> not an API token. `railway whoami` will reject it.

## 2. Deploy

```bash
railway link cd1a2200-106c-4633-9a22-887b9ac206b   # requires login first
railway up --detach
```

The Dockerfile builds and Railway's health check probes
`/api/v1/health` (configured in `railway.json`).

## 3. Environment variables (set on Railway)

**Required at boot (server refuses to start without them in production):**

```
NODE_ENV=production
CLERK_SECRET_KEY=sk_test_...         # replace with LIVE key when ready
CLERK_PUBLISHABLE_KEY=pk_test_...
SUPABASE_URL=https://vhojbhvaasjvolcfkobz.supabase.co
SUPABASE_ANON_KEY=eyJ...             # public client key used by auth flows
SUPABASE_SERVICE_ROLE_KEY=eyJ...      (service_role)
SUPABASE_JWT_SECRET=<strong-secret>    # session verification/signing secret
CORS_ORIGINS=https://<your-domain>,https://admin.<your-domain>
```

Set `TRUST_PROXY=1` on Railway for its single public ingress hop. This is
warned at boot when omitted (the safe fallback ignores forwarded headers), but
the exact deployment topology must be configured before serving production
traffic.

**Warning-only (boots without, degrades one capability):**

```
CLERK_WEBHOOK_SECRET=whsec_...        # already configured in .env.local;
                                      # set on Railway too, or webhook = 503
```

**Required for protected API availability (the process still boots for liveness):**

```
REDIS_URL=redis[s]://...               # shared cache + rate limiting + idempotency
```

**Optional integrations:**

```
AISSTREAM_API_KEY=...                  # listing AI (needs AISSTREAM_BASE_URL too)
ELEVENLABS_API_KEY=...                 # voice
RESEND_API_KEY=re_...                  # transactional email
SENTRY_DSN=https://...@...ingest.sentry.io/...
POSTHOG_API_KEY=phc_...                # project key, NOT phx_ (personal)
```

The API rate limiter fails closed in production when Redis is unavailable; it
does not silently fall back to process-local state. Keep the Railway service
behind its public ingress and do not expose the container port directly. If the
proxy topology changes, update `TRUST_PROXY` to the exact trusted policy before
deploying.

**NEVER set** `LOUMOO_TEST_AUTH_SECRET` in production — it is a boot
blocker by design (`assertProductionConfig`).

Source of truth for every variable: `server/config/env.js` ↔ `.env.example`.

## 4. GitHub Actions (optional but recommended)

1. Repo → **Settings → Secrets and variables → Actions**:
   - `RAILWAY_TOKEN` — from Railway **Settings → Tokens** (or `railway token create`)
   - `RAILWAY_SERVICE_ID` — from the Railway service (this project)
2. Push to `main` → `deploy.yml` runs `railwayapp/actions-push@v1`.
   `ci.yml` runs the full 35-suite test matrix on every push/PR first.

## 5. Post-deploy verification

```bash
curl -fsS https://<your-domain>/api/v1/health     # {"status":"ok",...}
curl -fsS https://<your-domain>/api/v1/readyz     # database+redis connected
curl -fsS https://<your-domain>/api/v1/listings/taxonomy
curl -fsS https://<your-domain>/api/config        # public keys only
```

Webhook: Clerk Dashboard → Configure → Webhooks → endpoint
`ep_3Ifh8pathEvAk4WB6mYgJt3DMhF` → URL must be
`https://<your-domain>/api/v1/webhooks/clerk`. Forged/unauthenticated
webhooks answer `401 Invalid Clerk webhook signature` (verified live).

## 6. Known live-verification summary (2026-08-31)

- Supabase `iam`/`system` schemas exposed; all 6 migrations applied; taxonomy
  seeded (15 categories / 38 attributes); `listing-media` bucket private.
- Redis: ping + cache round-trip OK.
- Clerk: secret-key API OK; webhook verification active (401 on forged).
- PostHog: key in `.env.local` is `phx_` (personal) — capture disabled by
  design. Replace with `phc_` project key when product analytics are needed.
- Sentry DSN: initialized at boot, verified parsing.
- ElevenLabs: 200, PAYG 10k-chars plan.
- AISStream: WS subscribe OK (maritime streaming).
- Test suite: 35/35 green; runtime matrix 10/10; prod boot verified.
