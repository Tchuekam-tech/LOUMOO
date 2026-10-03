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
| 1. Migration 013 + `delivery` module (domain, repo, service) | Claude | next |
| 2. Delivery routes, rider endpoints, SSE, tests | Claude | |
| 3. Rider page (GPS posting) | ChatGPT/Codex | blocked on step 2 contract only (can start against the doc) |
| 4. Customer tracking screen (map, timeline, code) | ChatGPT/Codex | |
| 5. Merge both, rebuild frontend, end-to-end check | owner | |

## Log
- **Step 0 (Claude):** Created both branches, wrote the API contract draft and
  this file. Nothing implemented yet. Open decisions are at the bottom of
  `docs/DELIVERY_API.md` — the owner needs to confirm them before step 1.
