# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# LOUMOO Universal Commerce — production image (multi-stage)
#
# Stage 1 (deps)   : production dependencies only (no devDependencies).
# Stage 2 (assets) : runs scripts/assemble_public.js to build the static
#                    frontend (public/): the app shell as index.html, the
#                    route-level *Screens chunks, and the Assets / src / _ds /
#                    data directories the shell loads by absolute path.
# Stage 3 (runtime): slim node:22-alpine carrying node_modules, the server, the
#                    SuperAdmin module, src/ (server reads src/data at runtime),
#                    and the assembled public/ frontend.
#
# Self-contained: this one image serves BOTH the API and the full frontend, so
# a single Railway service is the whole app. gzip/brotli compression and static
# cache headers are configured in server/index.js.
# ─────────────────────────────────────────────────────────────────────────────

# ---------- Stage 1: dependency install ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- Stage 2: assemble static frontend (public/) ----------
FROM node:22-alpine AS assets
WORKDIR /app
COPY scripts/assemble_public.js ./scripts/assemble_public.js
COPY ["Commerce App.dc.html", "./"]
COPY ["support.js", "./support.js"]
COPY favicon.ico ./favicon.ico
# Route-level frontend chunks (SearchScreens.dc.html, TravelScreens.dc.html, …).
COPY *Screens.dc.html ./
COPY Assets ./Assets
COPY src ./src
COPY _ds ./_ds
COPY data ./data
# assemble_public.js also renders the home page and the French guides with the SAME server
# code the gateway runs (server/config/env, SeoContent, PrerenderService, seo/content and
# the catalogue they read). Without the server tree and the production dependencies in this
# stage it aborts at its first require ("Cannot find module '../server/config/env'").
COPY package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY server ./server
RUN node scripts/assemble_public.js

# ---------- Stage 3: runtime ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Run as a non-root user (defense in depth; nothing writes to disk at runtime).
RUN addgroup -S loumoo && adduser -S loumoo -G loumoo

# Layers ordered for cache efficiency: dependencies first, then app code.
COPY --from=deps --chown=loumoo:loumoo /app/node_modules ./node_modules
COPY --chown=loumoo:loumoo server ./server
COPY --chown=loumoo:loumoo src ./src
# SuperAdmin is required by server/index.js (admin routes + maintenance guard)
# and its control-center frontend is served from SuperAdmin/frontend.
COPY --chown=loumoo:loumoo SuperAdmin ./SuperAdmin
# The assembled static frontend (app shell + Assets + src + _ds + data).
COPY --from=assets --chown=loumoo:loumoo /app/public ./public
RUN chown loumoo:loumoo /app

USER loumoo

# Node's default port for this stack (see server/config/env.js: PORT default 8080).
# Railway proxies to this port. NODE_ENV = production and the security-critical
# variables are supplied by Railway-level env vars — the app fails fast at boot
# in production if they are missing (server/config/env.js -> assertProductionConfig).
EXPOSE 8080

# curl is not guaranteed in alpine; probe with node. This is the same path
# Railway uses as healthcheckPath (/api/v1/health) and it answers 200 without
# requiring Redis/Supabase (liveness, not readiness — see /api/v1/readyz).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "require('http').get('http://127.0.0.1:8080/api/v1/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]

CMD ["node", "server/index.js"]
