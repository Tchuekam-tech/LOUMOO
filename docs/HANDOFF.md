# Handoff log — delivery tracking

Read this and `docs/DELIVERY_API.md` before starting any step. Append a short
entry after finishing one. Newest entry first.

## Working rules (Claude + ChatGPT/Codex)
1. **Separate branch and folder each.** Backend: `feat/delivery-backend`
   (`../LOUMOO APP.worktrees/delivery-backend`). Frontend: `feat/delivery-frontend`
   (`../LOUMOO APP.worktrees/delivery-frontend`). Never edit the other's folder
   and never work directly on `main`.
2. **File ownership.**
   - Backend: `server/modules/delivery/**`, `server/infrastructure/database/migrations/013_*.sql`,
     backend tests, the one-line route mount in `server/index.js`.
   - Frontend: `src/views/**`, `src/styles/**`, `src/services/**`.
   - Generated, never hand-edited: `Commerce App.dc.html`, `*.dc.html`. Rebuild with
     `npm run build:frontend`, only after merging, one side at a time.
   - Shared and risky (`build_redesign.py`, `package.json`, `server/index.js`):
     touch only when the other side has no unmerged work in it, and say so here.
3. **Contract first.** API changes go into `docs/DELIVERY_API.md` before code.
4. **Only the owner merges to `main`**, by pull request, after `npm test` passes.
5. **Small steps, pull `main` before each one.** Commit often.
6. **Secrets never go in chat or in git.** Keys belong in `.env.local`.

## Plan
| Step | Owner | Status |
|---|---|---|
| 0. Branches, contract, handoff file | Claude | done |
| 1. Migration 013 + `delivery` module (domain, repo, service) | Claude | **done** (unit-tested; migration **applied to the production DB 2026-10-03**) |
| 2. Delivery routes, rider endpoints, SSE, route tests | Claude | **done** (mounted at `/api/v1/deliveries`; unit-tested, and now **DB-backed integration tested** — see `tests/integration/delivery_flow.test.js`) |
| 2b. DB-backed integration suite (real guard, real DB, real stream) | Claude | **done** (passes against the live database) |
| 2c. Driver assignment: offer expiry, workload-aware rider list, auto-assign | Claude | **done on `feat/delivery-assignment`** (unit-tested, **not merged**, **no DB-backed test yet**; no schema change) |
| 3. Rider page (GPS posting) | ChatGPT/Codex | can start now against `docs/DELIVERY_API.md` v1 |
| 4. Customer tracking screen (map, timeline, code) | ChatGPT/Codex | |
| 5. Merge both, rebuild frontend, end-to-end check | owner | |

## Log
- **Step 2c — Driver assignment (Claude, 2026-10-03, branch `feat/delivery-assignment`,
  forked from `feat/delivery-backend` at `9a2bbe6`, NOT merged):** Assigning a rider
  and letting them accept already existed (`POST /:id/assign`, `/accept`, `/decline`,
  steps 1–2). What was missing around it, now built: (1) **offer expiry** — an
  `assigned` offer lapses after 15 min (`DELIVERY_OFFER_TTL_MINUTES`, `0` = never),
  returns to `pending_assignment`, notifies seller and rider, and shows
  `offerExpiresAt` to seller/admin/rider (never the buyer); applied lazily when a
  delivery is read or a rider list is ranked, *and* by a once-a-minute sweeper (on a
  serverless runtime there is no sweeper: the seller is only told when something
  touches the delivery or lists riders, see the contract); accepting a lapsed offer
  is always `409 OFFER_EXPIRED`. (2) **`GET /drivers`** now carries
  `openDeliveries` and sorts responsive, then least-busy, riders first; with
  `?deliveryId=` it adds a `declined` boolean per rider. (3) **`POST /:id/auto-assign`**
  picks the first rider in that order who is not the buyer, has not handed this
  delivery back, and does not already hold the offer; `409 NO_RIDER_AVAILABLE` when
  nobody qualifies. A rider who lets an offer lapse sorts behind responsive riders
  for an hour, so one who never answers does not win every offer.
  **No schema change and no migration**: the deadline is `assigned_at + window`, and
  "who handed it back" is read from `delivery_events`. Contract: `docs/DELIVERY_API.md`
  (new section "Offer expiry", decisions 9–10).
  *Shared files touched:* `server/index.js` only — two `require`s next to the
  delivery router and one block in the background-workers section that starts the
  sweeper (and registers its timer for shutdown). Everything else is inside
  `server/modules/delivery/**`, `docs/`, and new test files. **Merge hot spots**
  with `feat/delivery-backend`: `DeliveryService.js`, `deliveryRoutes.js`,
  `deliverySchemas.js`, `DeliveryRepository.js`, `Delivery.js`, `delivery_routes.test.js`,
  `DELIVERY_API.md`, this file.
  *Tests:* new `delivery_dispatch`, `delivery_repository`, `delivery_sweeper` unit
  suites, plus additions to `delivery_domain` and `delivery_routes`. Mutation
  checks: every deliberate break of the production code I tried was caught.
  **One existing integration assertion was edited without being run:**
  `tests/integration/delivery_flow.test.js` (the `GET /drivers` key set now includes
  `openDeliveries`); it needs the live database.
  *Two independent review rounds* (five lenses in all: authz, contract, concurrency,
  operations/DB semantics, adversarial tests; every finding re-checked by a skeptic)
  found, and this branch fixed, in round 1: a huge/tiny `DELIVERY_OFFER_TTL_MINUTES`
  crashing views or disabling expiry (now bounded: 1 s to 1 week); a late accept
  answering 404 once released (now 409); lapsed offers counting as rider workload and
  a non-responding rider winning every offer (lapsed offers are released before
  ranking, and recent lapses sort last); the untested default/env wiring; weak tests;
  and doc overstatements. Round 2 (after those fixes) found, and this branch fixed: a
  failed lazy release turning reads into 500s (now best effort); a seller or admin
  acting as the rider getting 403 instead of 409 on a late accept; auto-assign
  releasing the very delivery it was assigning (spurious 409); concurrent
  auto-assigns all picking one rider (now serialised per process); a failed ranking
  query in production being read as 'nobody is busy' (now an error); a 5000-row cap
  that exceeded the platform's 1000-row limit; a sweep that hammered a failing
  database (now stops at the first infrastructure error) and a 50-offer release
  cap (now bounded rounds); the offer text rounding the window up; and a lost lapse
  timeline row voiding three decisions (now retried once).
  **Known, accepted:** the lapse query filters `delivery_events` on columns with no
  index (migration 013 only indexes `delivery_id`); the table is small today, and
  adding an index is a migration, so it is deferred to whoever owns the database.
  Auto-assign serialisation is per process, not across instances.
  **Decision for the owner (decision 11):** `openDeliveries` shows every seller each
  rider's total workload across all sellers.
  **Not verified:** (a) the two new queries (`findStaleOffers`, `countOpenByDriver`)
  against the real PostgREST/Postgres — the repository suite uses a query-builder
  stand-in, so a DB-backed section in `tests/integration/delivery_flow.test.js` is
  still owed (deliberately not run while the database was in use elsewhere);
  (b) the sweeper on Railway under real load; (c) `GET /drivers` with a large fleet
  (it reads at most 500 active riders and logs a warning if it hits that).
  **Frontend must know:** `offerExpiresAt` is new on every Delivery; a rider's
  `accept` can now answer `409 OFFER_EXPIRED`; the seller's picker should call
  `GET /drivers?deliveryId=…` and grey out `declined: true` riders; there is still
  no seller-facing "assign a rider" screen or rider job-inbox screen in the plan.
- **Step 2b — DB-backed integration suite (Claude, 2026-10-03):** Migration 013
  is now applied to the production Supabase project, and
  `tests/integration/delivery_flow.test.js` drives the whole flow over real HTTP
  against the real database with the real session guard: schema + RLS, rider
  registration (incl. the FK), creation (incl. the one-open-delivery race),
  reads/IDOR, assign, accept (race), the handover-code audience, GPS pings
  (throttle + implausible-jump), pickup→arrive→delivered with the order status
  following in `iam.orders`, the live SSE stream through compression, the 5-wrong-code
  lock + admin unlock/reconcile, failure→retry with a new rider+code, decline,
  buyer/seller cancel, the order→delivery cancel cascade, and rider suspension +
  admin recovery. It **skips with a notice** when 013 is not applied (so `npm test`
  stays usable on a behind DB; set `LOUMOO_REQUIRE_DELIVERY_DB=1` to force failure).
  **Real bug it caught:** migration 013 created the `BIGSERIAL` tables but never
  granted the sequences to `service_role`, so every insert into `delivery_events`
  / `driver_locations` failed with SQLSTATE 42501 — in production (which throws
  instead of the dev in-memory fallback) that would have broken delivery creation.
  Fixed in 013 with explicit table + sequence GRANTs (idempotent). Built as 40+
  small commits. Runs green; cleanup leaves no rows.
- **Step 2 (Claude):** Added `server/modules/delivery/presentation/**` (strict zod
  schemas, `createDeliveryRouter`, 17 routes) and mounted it in `server/index.js`
  (one require + one `v1Router.use`; shared file). `tests/unit/delivery_routes.test.js`
  drives the router over real HTTP with the real error handler and compression
  middleware. **Frontend must know:** (1) the stream needs `Authorization`, so use
  `fetch` streaming, **not** native `EventSource`; (2) on Netlify the stream cannot
  stay open, so poll `GET /:id` every 5-10 s as the fallback; (3) response shapes are
  tabulated in `docs/DELIVERY_API.md` ("Response shapes"); (4) a location ping can
  return `200 {accepted:false, reason}`, which is not an error.
  A second independent review (22 agents, 13 confirmed findings) drove further
  fixes: stream timers leaked when a terminal event raced the snapshot; a GET that
  carried a body hung; stream access was only checked at connect (now re-checked
  against the live account every heartbeat); re-saving a rider without `status`
  reactivated a suspended one; the delivery guards read orders through a never-
  refreshed cache (new `OrderRepository.findOrderByIdFresh`); the stream answers
  `501 STREAM_UNSUPPORTED` on serverless runtimes; open streams are closed on
  shutdown; validation errors are bounded. Mutation checks confirmed the new tests
  fail when each fix is removed.
  *More shared files touched:* `server/index.js` (the mount, plus one line in
  `shutdown()` that closes open streams) and
  `server/modules/commerce/infrastructure/OrderRepository.js` (new
  `findOrderByIdFresh`; `updateFulfillmentStatusAtomic` now compares against the
  database, not a cached copy).
  **Needs a decision (not changed):** the global rate limiter is effectively one
  120/min budget for the whole API behind a single proxy; see decision 7 in
  `docs/DELIVERY_API.md`. **Not verified:** the real session guard + a real
  database (migration 013 unapplied), the stream through a real proxy, and
  behaviour under many concurrent riders.
- **Step 1 (Claude):** Built `013_delivery_tracking.sql` and `server/modules/delivery/**`
  (domain, state machine, derived handover code, repository with in-memory fallback,
  service). Roughly 340 assertions in `tests/unit/delivery_domain.test.js` and
  `tests/unit/delivery_service.test.js` pass. An independent 4-lens adversarial
  review found 18 real issues; all were fixed or documented (e.g. the 5-guess limit could be
  farmed via failed -> re-assign; suspended riders kept working; the 423 lock
  would have surfaced as a 500). **Contract updated to v1: re-read
  `docs/DELIVERY_API.md`.** Notable changes for the frontend: `cancelled` no longer
  cancels the order; riders see only `{area, rounded location}` before accepting;
  `accepted` can be released via `/decline`; new admin endpoints
  (`/drivers/:id`, `/:id/resolve`, `/:id/reconcile`); location pings can answer
  `{accepted:false, reason}`; `GET /drivers` for sellers.
  *Shared files touched (not delivery-owned):*
  `server/modules/commerce/application/OrderLifecycleService.js` (cancelling an order
  now cancels its un-collected delivery) and
  `server/modules/identity/application/DeleteAccountUseCase.js` (scrubs the rider
  record). Both are lazy, best-effort calls. **Untested against a database:** the
  existing account-deletion suites need live Supabase credentials and were not run.
  **Not done:** HTTP routes + SSE (step 2); migration 013 has not been applied.
- **Step 0 (Claude):** Created both branches, wrote the API contract draft and
  this file. Nothing implemented yet. Open decisions are at the bottom of
  `docs/DELIVERY_API.md` — the owner needs to confirm them before step 1.
