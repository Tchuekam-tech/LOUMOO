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
| 2. Delivery routes, rider endpoints, SSE, route tests | Claude | next |
| 3. Rider page (GPS posting) | ChatGPT/Codex | can start now against `docs/DELIVERY_API.md` v1 |
| 4. Customer tracking screen (map, timeline, code) | ChatGPT/Codex | |
| 5. Merge both, rebuild frontend, end-to-end check | owner | |

## Log
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
