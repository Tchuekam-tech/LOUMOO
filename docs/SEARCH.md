# Universal search and LOUMOO Combi

Base: main `2c185e57e66eb68fcd42d7d8aea7745ec3c94a43`.
Implementation branch: `feat/universal-search`. Migration: 014.

## What this changes

Indexed PostgreSQL full-text and trigram discovery covers products, services,
stores, hotels, upcoming transport and public announcements. French/English
synonyms, accent normalization, typo matching, filters, sorting and pagination
use live source records. Publication, visibility, active stores, audience, expiry,
sale/variant prices and inventory are checked before pagination. Unknown stock
and unrated listings are not presented as available or five-star.

Home, category, store, announcement and dedicated search inputs share a controller:
220 ms autocomplete, keyboard navigation, composition support, cancellation,
stale-response guards, bounded suggestion cache, clearable session history,
loading/empty/error states and load-more pagination. The comparison picker uses
public search. Existing comparison presets are a separate legacy feature.

Combi replaces the static chat recommendation and voice placeholder. Its SDK is
bundled and loaded only on conversation start. Both spoken and typed conversation
can use ElevenLabs. The client catalog tool returns live, public search results;
Combi has no order, payment, booking or private-account tools. Sessions close on
navigation, sign-out and page exit, and after five minutes. Photos are described
by an optional vision model and searched as keywords, not image embeddings or
guaranteed exact-model matches.

## Agent already created

The private ElevenLabs agent was created and read back before the workspace pause:

```
ELEVENLABS_AGENT_ID=agent_0101m41ry4pmf0nsrszhnn01hx73
```

Client tool `search_catalog`: `tool_4501m41ry4ftev2bddpw0yg0c05v`.
The verified provider settings require authentication, cap sessions at 300 seconds,
three concurrent and 100 daily conversations, disable bursting and recording,
and request transcript deletion after one day. Text-only overrides are allowed;
prompt overrides are disabled. These initial provider cost limits can be changed
in ElevenLabs. Agent creation does not deploy this code.

No account secret is in the repository. Rotate the originally shared token and
put its replacement in the API host's server environment.

## Activation

1. Back up the database. Measure migration 014 on staging; generated columns and
   GIN index creation can lock large tables. Apply only this migration with
   `node scripts/apply_migration.js 014_universal_search.sql` after 001..013.
2. Deploy with `SEARCH_ENABLED=false` initially. Existing product search remains
   available. Configure `ELEVENLABS_API_KEY`, the agent ID above, and `REDIS_URL`.
   Paid endpoints require authenticated users and a functioning Redis limiter in
   production; Redis errors fail closed for those routes.
3. Optional photo/structured text search: set `OPENAI_API_KEY` and
   `SEARCH_AI_MODEL` to an image-capable Responses API model supporting structured
   outputs. ElevenLabs alone supports spoken and typed Combi conversations.
4. Enable `SEARCH_ENABLED=true`; check `/api/v1/search/capabilities`, then query
   real published inventory through `/api/v1/search` and `/api/v1/search/suggest`.
   Capabilities report configuration, not provider or database health.
5. With a real signed-in account, check mobile Chrome and Safari microphone
   permissions, French/English conversation, interruptions, catalog tool results,
   navigation cleanup and provider quotas. Production-volume latency and those
   real provider/database smoke checks remain deployment gates.

## API

- `GET /api/v1/search`: q, type, city, category, vertical, brand, storeId,
  condition, verified, inStock, minPrice, maxPrice, sort, page, limit.
- `GET /api/v1/search/suggest`: same filters, up to eight suggestions.
- `GET /api/v1/search/capabilities`: text, voice, assistant and visual flags.
- `POST /api/v1/search/voice/session`: ephemeral private-agent URL; never cached.
- `POST /api/v1/search/assistant`: authenticated `{message, context?}`.
- `POST /api/v1/search/visual`: authenticated `{imageData, message?}`; JPEG/PNG/WebP
  data URL, maximum 1 MiB, magic bytes validated. No arbitrary remote image fetch.

Discovery has a separate rate budget from commerce. Paid routes have per-account
minute and daily limits. Responses use no-store. Simultaneous identical database
queries are coalesced, with no stale server result cache. Search text, photos,
signed URLs and provider keys are not logged by this module.
Search query strings are also removed from centralized error-log route fields.

## Verification / rollback

```
npm ci
npm run build:frontend
npm run test:search
npm run verify:runtime
npm run verify:screens
npx playwright install chromium
npm run test:search:ui
```

The search suite uses isolated PGlite PostgreSQL with actual migrations, HTTP
routes and mocked providers. The browser test uses fixture HTTP responses and
local React test dependencies; it does not spend provider credits. It accepts
`LOUMOO_BROWSER_PATH` when using an existing compatible Chromium executable.
Do not run customer-data integration tests against production as smoke tests.

Rollback: set `SEARCH_ENABLED=false` or restore the previous application build.
Migration 014 is additive; keep its columns/indexes during rollback.

## Local verification completed (October 4, 2026)

- Actual relevant migrations applied twice to isolated PostgreSQL; tests passed
  for bilingual/typo queries, visibility/audiences, expiry, prices, inventory,
  category descendants, pagination and anonymous permission denial.
- API/provider/controller tests passed, including anonymous denial, strict paid
  rate limiting on Redis failure, cancellation and late voice-session cleanup.
- Chromium at 390×844 passed real rendered autocomplete/ARIA, filtering, Combi
  authentication and microphone worklet loading under the application CSP.
- Existing runtime matrix: 10 scenarios passed; screen check: all 92 present;
  frontend reliability: 6 checks passed. Frontend payload/media checks passed.
- CI now runs the isolated search suites and browser check in a separate job.

These checks use fixtures and mocked provider responses. Production Supabase
migration, real conversations, Safari and production-volume latency still need
the activation checks above. The connected GitHub accounts report no push
permission, so this branch has not been published or deployed.
