# tests/routing — hermetic routing fixture + backend authorization matrix

Everything here runs against the **local stack only** (`tests/e2e/support/localStack.js`):
PGlite Postgres with the repo's migrations, the PostgREST/Auth/Storage stand-ins, and the
real `server/index.js` as a child process on loopback. No `.env` file is read, no credential is
used, no external host is called, and `startFixture()` refuses to run if `LOUMOO_RUN_INTEGRATION`
is set.

## Run

```
node tests/routing/backend_authz.e2e.test.js
```

About 40-110 s: 20-70 s to boot the stack and provision the personas (it depends on how busy the
machine is), then ~20 s of requests. Exit code 0 only if every check passed. It prints
`    ✓ name` per check and `    ! KNOWN_GAP: ...` for defects that are logged but never fail the run.
`LOUMOO_TEST_VERBOSE=1` also prints the server's silent-fallback log lines.

The file exports `{ run }`, so a runner can `require` it as it does the other `tests/e2e/*.test.js`.

## What `startFixture()` provisions

Every account is made through the application's own routes (sign-up, the emailed code read from
the development-mode `devOtp`, onboarding, store creation + activation, uploads, listings, orders,
deliveries, rider registration, presence). Passwords are generated per run with `crypto.randomBytes`.

| persona | what it is | `GET /me/state` |
|---|---|---|
| `customer` | ready buyer; owns `ids.orderId` (HOME_DELIVERY) | `ACCOUNT_READY`, role `customer` |
| `stranger` | a second ready buyer; owns `ids.strangerOrderId` | `ACCOUNT_READY` |
| `seller` | store `ids.storeSlug` (active, public) with one published listing (85 000 XAF, stock 25) | `SELLER_READY`, role `seller` |
| `rider` | registered, active rider; **online**; holds the delivery as an *assigned offer* | `ACCOUNT_READY`, role `customer` |
| `admin` | `primary_role = admin` | `ACCOUNT_READY`, role `admin` |
| `superadmin` | `primary_role = super_admin` | `ACCOUNT_READY`, role `super_admin` |
| `onboarding` | verified, onboarding not started | `ONBOARDING_REQUIRED`, destination `/onboarding` |
| `unverified` | holds a session, **email not verified** | `CONTACT_VERIFICATION_REQUIRED`, destination `/verify` |
| `suspended` | was ready, then suspended | `GET /me/state` -> **403** `PERMISSION_DENIED` |
| `pending` | signed up, code **not** entered: no session exists (`token: null`); `devOtp` is the code (valid 15 min) | n/a |

The only direct writes to the local database are the ones no public route can perform, each in a
named function in `support/fixture.js`: `promoteAdminLocal`, `promoteSuperAdminLocal`,
`suspendAccountLocal`, and `unverifyEmailLocal` (see its comment: no route yields a *signed-in*
account with an unverified email, and the Auth stand-in has no `generateLink`, which the
password-reset route would need).

Besides the personas the fixture has an order for the customer, one for the stranger, and a delivery
for the customer's order, created by the seller and assigned to the rider (`status: assigned`).
The stack is started with `DELIVERY_OFFER_TTL_MINUTES=0` and `RIDER_PRESENCE_TTL_SECONDS=3600`, so
that offer never lapses and the rider stays online while a test is looking at it.

## API

```js
const { startFixture } = require('../routing/support/fixture');   // from tests/<dir>/
const fx = await startFixture({ log: console.log, logFile: 'server.log', env: { ... } });
```

returns

```
{ baseUrl, stack, runId, startupMs,
  personas: { <name>: { email, password, userId, profileId, token, state, primaryRole, ... } },
  ids: { storeSlug, storeId, storeName, listingId, listingTitle, listingPriceXaf,
         orderId, orderNumber, strangerOrderId, strangerOrderNumber, deliveryId,
         riderProfileId, sellerProfileId },
  api(method, path, { token, body, headers, raw, client })  -> { status, body, headers },
  signIn(name)               -> fresh token from POST /api/v1/auth/login,
  localStorageFor(name)      -> { loumoo_token },
  clientHeaders(label)       -> { 'x-forwarded-for': ... }   // for a browser context, see "Rate limit",
  probeStream(path, { token, ms }) -> { status, contentType, text }   // opens an SSE stream, aborts after ms,
  throwaway(label)           -> a disposable verified buyer { token, profileId, ... },
  throwawaySeller(label)     -> a disposable seller: store created (phone not given), call .activate(),
  describe(), async stop() }
```

* `userId` is the auth (Supabase) user id; `profileId` is `iam.profiles.id`, which is what orders,
  deliveries and `GET /me/state` -> `user.id` use.
* `signIn()` cannot work for `pending` (no session), `suspended` (login refuses it, 401) and
  `unverified` (login would *mark the email verified*, destroying the state, so its original token is
  returned instead).
* `stack.sql()` is a read/write handle on the local database; use it to *read* (the
  authorization test only reads). `stack.dbErrors()` / `stack.silentFallbacks()` / `stack.errors()` as in `localStack.js`.
* Always `await fx.stop()` (it kills the server child process and closes PGlite); end the script with `process.exit`.

## For the browser tests (written later)

```js
const { startFixture } = require('../routing/support/fixture');
const fx = await startFixture();                      // ~20-70 s: start it once per file, not once per test
await context.setExtraHTTPHeaders(fx.clientHeaders('customer-tab'));   // REQUIRED, see "Rate limit" below
await context.addInitScript((t) => { try { localStorage.setItem('loumoo_token', t); } catch (e) {} },
                            fx.personas.customer.token);
await page.goto(fx.baseUrl + '/');                    // the server also serves the generated public/ app shell
```

The SPA reads exactly one key, `localStorage['loumoo_token']` (`src/services/clerkSession.js` `init()`), and
moves it into `sessionStorage['loumoo_token']` (`src/services/loumooApi.js` `setAuthToken`), so seeding it before
the page scripts run is all it takes; `loumoo_auth_user` / `loumoo_onboarding_draft` are only *cleared* on sign-out.
The value is the bare session JWT (no `Bearer`, no JSON). Tokens live 30 days, so they outlive any test run.
(Checked by hand against a running fixture: after seeding `localStorage.loumoo_token` and reloading, `localStorage` no longer
holds it, `sessionStorage.loumoo_token` does, `LoumooAPI.getAuthToken()` returns it and the page's `GET /api/v1/me/state` is 200.)
To test the sign-in form instead, type `fx.personas.x.email` / `.password` (not possible for `suspended`, `unverified`, `pending`).

Things a browser test needs to know:

* **Rate limit (give every browser context an `X-Forwarded-For`).** The API allows 120 requests a minute per
  client address and the server runs with `TRUST_PROXY=1` (as on Railway). A request WITHOUT `X-Forwarded-For` is
  counted in the single `peer:127.0.0.1` bucket, which all of the fixture's own (forwarded) traffic also feeds, so a
  page opened within a minute of `startFixture()` gets `429` on `/api/config`, `/me/state`, ... (seen when this was
  tried by hand). `fx.clientHeaders(label)` returns the header; use a different label per context. A request WITH it
  has its own 120/min bucket, and the SPA's page load alone makes a few dozen API calls.
* **public/ must exist.** The SPA is served from `public/` (`node scripts/assemble_public.js`); the API tests do not need it.
* **State is per fixture.** Tests that change data (accept the delivery, cancel the order...) should do so on their own
  `startFixture()` or on a `throwaway()` account; the authorization test accepts the delivery near its end.
* The rider can accept the offered delivery with `fx.api('POST', '/api/v1/deliveries/' + fx.ids.deliveryId + '/accept', { token: fx.personas.rider.token })`;
  after that the buyer can read the handover code (`GET /deliveries/:id/code`).

## KNOWN_GAPs the matrix records (logged, not failing)

See the end of the test output; they are server behaviours found while building this, not fixed here:
an `admin` can promote any account to `super_admin` (role route and mass-assignment); `canPurchase` is not enforced by
`POST /orders` (unverified and onboarding accounts can order); the admin API serves built-in demo rows instead of the
database (its queries select columns that are in no migration), which also makes admin store suspension/KYC unusable;
a store created without a phone publishes the owner's account phone on `GET /stores/:id/profile`; a deleted account can sign
back in and is silently reactivated. One more is a harness limitation, labelled as such (storefront reviews/recommendations
embeds the stand-in cannot resolve).
