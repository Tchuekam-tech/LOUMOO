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
| 1. Migration 013 + `delivery` module (domain, repo, service) | Claude | **done** (unit-tested; migration NOT applied to any database yet) |
| 2. Delivery routes, rider endpoints, SSE, route tests | Claude | **done** (mounted at `/api/v1/deliveries`; tested with a stand-in for auth, no database) |
| 3. Rider page (GPS posting) | ChatGPT/Codex | can start now against `docs/DELIVERY_API.md` v1 |
| 4. Customer tracking screen (map, timeline, code) | ChatGPT/Codex | |
| 5. Merge both, rebuild frontend, end-to-end check | owner | |

## Log
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
