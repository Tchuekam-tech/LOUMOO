# LOUMOO — Universal Commerce Platform

A universal digital commerce ecosystem for Cameroon and the wider CEMAC region:
products, services, travel, hospitality, real estate and vehicles in one
marketplace, with a responsive mobile/desktop interface and full dark mode.

---

## Running it

```bash
npm install
cp .env.example .env.local      # then fill in real credentials
npm run db:migrate              # apply migrations 001-006
npm run db:seed                 # sync the taxonomy, create the media bucket
npm run dev                     # http://localhost:8080
```

`.env.example` documents every variable, marks the ones production refuses to
start without, and explains what each is for.

### Other commands

```bash
npm test                    # unit + integration suites
npm run test:security       # direct API bypass suite only
npm run test:journey        # end-to-end seller journey only
npm run build:frontend      # regenerate Commerce App.dc.html from src/views
npm run verify:runtime      # frontend state-machine matrix
npm run routes:check         # hosting config + route docs match the route registry
npm run test:routing        # backend authorization matrix + the real app in Chromium (local, no network)
npm run db:purge-test-data  # reclaim rows the integration suites created
```

---

## Architecture

A modular monolith. Each module owns its domain, its persistence and its HTTP
surface, and depends on the others only through their published use cases.

```
server/
  config/                     typed, validated configuration (one source)
  infrastructure/
    database/                 Supabase clients + SQL migrations
    storage/                  image inspection + media storage
    cache/                    Redis-backed cache, rate limiting, idempotency
    events/                   transactional outbox
  modules/
    identity/                 auth, verification, onboarding, account state
      domain/AccountState.js  ← the account state machine
      infrastructure/         Clerk adapter, profile & onboarding repositories
    store/                    boutiques, membership, verification
    listing/                  taxonomy, validation, media, publication
    catalog/                  public product browsing
src/
  services/
    loumooApi.js              the one browser API client
    clerkSession.js           the one place the browser talks to Clerk
    accountGuard.js           the one client-side routing guard
  views/                      screen templates (Python-generated HTML)
```

### Authentication and authorization

**Clerk is the identity provider.** It proves who someone is and owns email and
phone verification. LOUMOO verifies the session token Clerk issues, mirrors the
verification outcome into its own database, and decides from there what the
user may do.

The server is the only authority. The browser renders a projection of its
decision; deleting the entire client-side guard would not make one additional
action possible.

Read **[docs/architecture/13_ACCOUNT_STATE_AND_LISTING_GATE.md](docs/architecture/13_ACCOUNT_STATE_AND_LISTING_GATE.md)**
before touching authentication, verification, onboarding, seller eligibility or
listing creation. It documents the state machine, the capability model, the
listing gate and the HTTP status contract.

```
UNAUTHENTICATED → CONTACT_VERIFICATION_REQUIRED → ONBOARDING_REQUIRED
   → ONBOARDING_IN_PROGRESS → ACCOUNT_READY
   → SELLER_VERIFICATION_REQUIRED → SELLER_READY
```

The state is computed from a handful of canonical database fields, never stored
as an independent flag, so contradictory combinations cannot be represented.

---

## Design system

Flat, architectural UI: 0px radius, curated typography, high-contrast palettes,
full dark mode. A dedicated desktop layout (≥1024px) with sidebar and topbar,
and a mobile layout below that.

The frontend is generated: edit `src/views/*.py` and the component logic in
`build_redesign.py`, then run `npm run build:frontend`. Do not edit
`Commerce App.dc.html` by hand — it is a build output.

---

## Documentation

| Document | Covers |
|---|---|
| [01_SYSTEM_ARCHITECTURE](docs/architecture/01_SYSTEM_ARCHITECTURE.md) | Overall system shape |
| [02_AUTHENTICATION_AND_IDENTITY](docs/architecture/02_AUTHENTICATION_AND_IDENTITY.md) | Identity model |
| [03_DATABASE_SCHEMA](docs/architecture/03_DATABASE_SCHEMA.md) | Tables and relationships |
| [04_API_SPEC](docs/architecture/04_API_SPEC.md) | Endpoint reference |
| [05_AUTH_AND_SECURITY](docs/architecture/05_AUTH_AND_SECURITY.md) | Security posture |
| [13_ACCOUNT_STATE_AND_LISTING_GATE](docs/architecture/13_ACCOUNT_STATE_AND_LISTING_GATE.md) | **Account state, verification, onboarding, the listing gate** |
| [ROUTING](docs/ROUTING.md) | **Every URL (`/rider`, `/store/:slug`, `/delivery/:id`, `/admin` …), access rules, deep links, hosting rewrites, how to test them** |
