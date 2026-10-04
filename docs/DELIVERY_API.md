# Delivery Tracking — API Contract (v1, backend steps 1–2 implemented)

Single source of truth for the backend (`server/modules/delivery/**`) and the
frontend (rider page, customer tracking screen). **Change this file first, then
tell the other side.** Neither side codes against anything not written here.

> Status: **implemented and mounted** at `/api/v1/deliveries` (domain, service,
> routes, SSE), covered by `tests/unit/delivery_*.test.js` (no database needed).
> **Not yet run against a real database or with the real session guard:** migration
> 013 has not been applied anywhere, and the tests stand in for authentication.

Base path: `/api/v1/deliveries` (mounted like `/api/v1/orders`).
Auth: same bearer session as the rest of the API (`requireAuth`).
Envelope: `{ success: true, status: 'success', data: ... }` on success; errors use
the shared error shape `{ success: false, error: { code, message, details, requestId } }`.
The `data` payload per endpoint is in **Response shapes** below.
Money: integer XAF. Time: ISO-8601 UTC strings. Coordinates: `{ lat, lng }`
(WGS84, decimal degrees).

## Relationship to orders

An order already has `fulfillmentStatus`: `processing | in_transit | delivered | cancelled`
and `deliveryMethod`: `HOME_DELIVERY | STORE_PICKUP`. **Those stay unchanged.**
A delivery exists only for `HOME_DELIVERY` orders and drives the order status:

| Delivery status | Meaning | Order `fulfillmentStatus` |
|---|---|---|
| `pending_assignment` | Created, no rider yet | `processing` |
| `assigned` | Rider chosen, not yet accepted | `processing` |
| `accepted` | Rider accepted | `processing` |
| `picked_up` | Rider has the parcel | → `in_transit` |
| `arrived` | Rider at the drop-off | `in_transit` (unchanged) |
| `delivered` | Handed over, code verified | → `delivered` |
| `failed` | Could not deliver (reason required) | `in_transit` (unchanged) |
| `cancelled` | Cancelled before pickup | **unchanged** (`processing`) |

* `cancelled` does **not** cancel the order: the seller may create a new delivery
  for it. The reverse link exists: cancelling the **order** automatically cancels
  its delivery if the rider has not collected the parcel yet.
* The order status follows the delivery on a best-effort basis; if the order write
  fails the rider's request still succeeds and an admin can repair it with
  `POST /:id/reconcile`. The repair walks `processing → in_transit → delivered`.
* A delivered parcel can never get a second delivery.

### Transitions (server enforces; anything else → `409 Conflict`)

```
pending_assignment -> assigned | cancelled
assigned           -> accepted | pending_assignment (rider declines) | cancelled
accepted           -> picked_up | pending_assignment (rider releases the job) | cancelled
picked_up          -> arrived | failed
arrived            -> delivered | failed
failed             -> assigned (retry)
delivered, cancelled: terminal
```

* **Assigning** is allowed from `pending_assignment`, `assigned` (re-assign to a
  different rider) and `failed` (retry). Not from `accepted` or later.
* A retry (`failed -> assigned`) issues a **new handover code** and clears the old
  rider's location trail, but does **not** refill the code-guess budget (below).

### Offer expiry (v1.1)
An `assigned` delivery is an *offer*: the rider has **15 minutes** from the moment
of assignment to accept it. The window is the `DELIVERY_OFFER_TTL_MINUTES`
setting, in minutes:

| Value | Meaning |
|---|---|
| unset, blank, not a number, or negative | the default, 15 minutes (a typo never switches expiry off) |
| `0` | expiry is off: offers never lapse, `offerExpiresAt` is always `null` |
| `0.5` … `10080` | that many minutes (fractions allowed). Below one second is raised to one second; above one week (10080) is clamped to one week |

When an offer lapses with no answer:

* the delivery goes back to `pending_assignment` (timeline note
  `Offer expired: no response from the rider`);
* the seller is notified, and so is the rider (the rider's new-offer notification says
  how long they have, rounded down: “within 15 minutes”, “within 30 seconds”);
* once released, the rider loses access (`404`), exactly as after a decline.

Only `assigned` expires. Once the rider has `accepted` the job never times out.
Re-assigning (to anyone) starts a fresh window.

Expiry is applied in two ways:
1. a background sweeper, once a minute, on long-lived runtimes (Railway). The seller
   is told within about a minute of the deadline;
2. **lazily**, when something touches the stale delivery or ranks the riders: `GET /:id`
   and the other participant-scoped reads and actions, `GET /by-order/:orderId`,
   `GET /driver/me`, the live stream's snapshot and access checks, `POST /:id/accept`,
   and `GET /drivers` / `POST /:id/auto-assign` (which release every lapsed offer
   before ranking riders, so a dead offer never counts as a rider's work).

Serverless runtimes (Netlify, Vercel) cannot run the sweeper and rely on the lazy
path alone. **There the seller is told only when something touches the delivery or
lists riders**: an offer nobody reads or ranks around stays `assigned`, and the
seller hears nothing, until then. Lapsed offers are never *honoured* in the
meantime (accept is refused, ranking ignores them), but they are not announced
either. Run the API on a long-lived process if prompt notification matters.

**Late accept.** `POST /:id/accept` on a lapsed offer answers `409 OFFER_EXPIRED`
and releases it, whether the sweeper (or a read) already released it or not: a rider
whose own latest hand-back of the delivery was a lapse gets the 409, not a 404, and
so does a seller or admin delivering the parcel themselves (otherwise a bare `403`).
A rider who *declined* or *released* it, or was never offered it, gets `404` (`403`
for a seller/admin who was not offered it). The 409 after a release depends on the
timeline row the lapse writes: that write is retried once, but if it is lost anyway,
or is still in flight during the few milliseconds after a concurrent release, the
answer is the plain `404`/`403`. Until a lapsed offer is released, `POST /:id/status`
and `/location` on it answer `409` (an illegal transition), not `404`. If releasing
fails (the database is unhealthy), reads still succeed and show the offer as it is,
with a deadline in the past; accept still refuses it.

Clients should show the countdown from `offerExpiresAt` (see the Delivery object)
but never decide expiry themselves: the server's clock is the only one that counts.

## Response shapes (`data`)
| Endpoint | HTTP | `data` |
|---|---|---|
| `POST /` | **201** | `{ delivery }` |
| `GET /:id`, `GET /by-order/:orderId` | 200 | `{ delivery }` |
| `POST /:id/assign`, `/auto-assign`, `/cancel`, `/accept`, `/status`, `/complete`, `/resolve` | 200 | `{ delivery }` |
| `POST /:id/decline` | 200 | `{ delivery: { id, status } }` (the rider loses access afterwards) |
| `POST /:id/location` | 200 | `{ accepted: true, location, etaMinutes, distanceKm }` or `{ accepted: false, reason }` |
| `GET /:id/code` | 200 | `{ code, digits, attemptsRemaining }` |
| `GET /drivers` | 200 | `{ drivers: [{ id, name, phone, openDeliveries, declined? }] }` |
| `GET /drivers?status=all\|suspended` (admin) | 200 | `{ drivers: [{ id, name, phone, status, openDeliveries }] }` |
| `GET /dispatch` | 200 | `{ items: [{ order, delivery }] }` (see the endpoint row; each `delivery` comes with `timeline: []`) |
| `POST /drivers/:profileId` | 200 | `{ driver: { id, name, phone, status } }` |
| `GET /drivers?status=all\|suspended` | **Admin only (v1.2).** The full rider roster for managing riders: every rider (`all`) or only the suspended ones, each with its `status` and `openDeliveries`, active riders first, then by name. A seller passing `status` gets `403`. Without `status` the endpoint behaves exactly as for sellers (active riders, ranked). |
| `GET /driver/me` | 200 | `{ driver: { id, name, phone }, deliveries: [delivery] }` |
| `POST /:id/reconcile` | 200 | `{ reconciled: true, deliveryStatus }` |

Request bodies are **strict**: any key not listed in this document is a `400`
(this is what stops a client sending `buyerId`, `status`, `driverId` on create…).
Actions with no body (`accept`, `decline`, `auto-assign`, `reconcile`) ignore one.

## Objects

### Delivery
```json
{
  "id": "dlv_...",
  "orderId": "...",
  "orderNumber": "KM-...",
  "status": "picked_up",
  "viewerRole": "buyer",
  "driver": { "id": "...", "name": "…", "phone": "…" },
  "pickup":  { "label": "Store name", "address": "…", "contactPhone": "…", "location": { "lat": 4.05, "lng": 9.70 } },
  "dropoff": { "label": "Customer", "address": "…", "area": "Bonanjo, Douala", "contactPhone": "…", "notes": "…", "location": { "lat": 4.06, "lng": 9.74 } },
  "etaMinutes": 12,
  "distanceKm": 3.4,
  "lastLocation": { "lat": 4.055, "lng": 9.72, "at": "2026-10-03T10:00:00Z", "speedKmh": 24, "heading": 90 },
  "failureReason": null,
  "offerExpiresAt": null,
  "timeline": [ { "status": "assigned", "at": "…", "note": null } ],
  "createdAt": "…",
  "updatedAt": "…"
}
```
`viewerRole` is `buyer | seller | admin | driver`: the view you were given.
Fields that are unknown are `null`. **Never present, for anyone:** the handover
nonce, the attempt counter, the code itself.

### What each viewer sees
| Field | buyer | seller / admin | rider (assigned) |
|---|---|---|---|
| `driver` | only once `accepted` or later | always | yes |
| `lastLocation`, `etaMinutes`, `distanceKm` | only while `picked_up` / `arrived` | always | yes |
| `failureReason`, timeline `note`s | hidden (`null`) | yes | yes |
| `offerExpiresAt` | always `null` | while `assigned`, unless expiry is off (`null`) | while `assigned`, unless expiry is off (`null`) |
| `dropoff` | full | full | **before accepting:** only `{ area, location }` with `location` rounded to ~1 km; **after:** full |

A rider who has not accepted must not be shown the customer's name, address,
phone, notes or exact point; the UI must render a job card from `area` + rounded
`location` + `pickup` only.

### ETA and distance
v0 method: straight-line distance × 1.3 (road factor) at an assumed 20 km/h.
They are `null` unless the drop-off has coordinates. **The checkout address has no
coordinates today**, so coordinates must be supplied by the seller when creating
the delivery (`dropoffLocation`, below), or by a future address-picker. The
frontend must handle `etaMinutes: null` and `lastLocation` without a destination.

## Endpoints

### Customer / seller / admin
| Method & path | Who | Purpose |
|---|---|---|
| `GET /by-order/:orderId` | buyer, seller, admin | Delivery for an order (`:orderId` may be the id or the order number). Returns the open delivery, else the latest finished one. `404` if none or not yours. |
| `GET /:id` | buyer, seller, admin, assigned rider | Delivery detail. |
| `GET /:id/stream` | same | **Server-Sent Events** (below). |
| `POST /` | seller of the order, admin | Create the delivery. Body: `{ orderId, pickup?: { label?, address?, location? }, dropoffLocation?: { lat, lng }, dropoffAddress? }`. Order must be `HOME_DELIVERY`, `processing`, not refunded, and have no open or delivered delivery. |
| `POST /:id/assign` `{ driverId }` | seller, admin | Assign or re-assign a rider (see Transitions). The rider cannot be the order's buyer. |
| `POST /:id/auto-assign` | seller, admin | Let the server pick the rider, using the same order as `GET /drivers` (responsive riders first, then fewest `openDeliveries`, then name, then id) among riders who are active, are not the order's buyer, have not declined, released or let an offer lapse on **this** delivery, and (when re-offering an `assigned` delivery) are not the rider already holding the offer. Ties break deterministically. Allowed from the same statuses as `/assign`. No body (one is ignored). `409 NO_RIDER_AVAILABLE` when nobody qualifies. Releases any lapsed offers first. Rank-and-assign runs one call at a time per API process, so a burst of calls (a bulk “assign all”) spreads over the riders instead of piling onto one; this is best effort across several API instances, which do not share that queue. Responds like `/assign`. A seller-role account that is the delivery's buyer or assigned rider gets `403`, a non-participant `404`. |
| `POST /:id/cancel` `{ reason? }` | seller, admin; buyer only while `pending_assignment` | Cancel before pickup. |
| `GET /:id/code` | order **buyer only** | `{ code, digits: 4, attemptsRemaining }`. Only from `accepted` to `arrived`. Seller, admin and rider get `403`. |
| `GET /drivers` | seller, admin | Active riders to pick from: `[{ id, name, phone, openDeliveries, declined? }]`. **Order:** riders who did *not* let an offer lapse in the last hour first, then fewest `openDeliveries`, then name, then id; so a rider who never answers drops behind the responsive ones for an hour (a decline does not count: that rider is answering). `openDeliveries` is always the true count of the rider's `assigned`, `accepted`, `picked_up` and `arrived` deliveries, across **all** sellers (see decision 11). At most 500 active riders are considered (a warning is logged if reached). Lapsed offers are released first (up to 200 per call), so they do not count. The workload and lapse counts read at most 1000 rows each (the platform’s response limit; a warning is logged if reached). In production, if the workload or lapse query fails, this endpoint and `auto-assign` answer `500` rather than ranking on an empty answer. With `?deliveryId=…` every rider also carries `declined`, a boolean that is `true` when they declined, released, or let an offer lapse on **that** delivery, so the picker can grey them out; it is absent (not `false`) without `deliveryId`. Read from the delivery's timeline, which is written best-effort: a lost row means a rider may be listed as not declined. `?deliveryId` answers `400` if empty, repeated or over 128 characters, `404` if no such delivery **or you are not a participant**, and `403` if you are a participant without the seller/admin role (for example a seller-role account that is that delivery's buyer or assigned rider). Any of those fails the **whole** list, so never interpolate an unset id (`?deliveryId=undefined` is a `404`). |
| `GET /dispatch?view=active\|completed&limit=` | seller, admin | **The seller’s dispatch board (v1.2).** The caller’s home-delivery orders that need or have a delivery (an admin sees every seller’s), newest first, each as `{ order: { id, orderNumber, placedAt, fulfillmentStatus, paymentStatus, totalXaf, itemCount, title, buyerName, area }, delivery }`, where `delivery` is the seller view of its open delivery (else the latest finished one), or `null` when none was created yet. `view=active` (default) lists orders that are `processing` or `in_transit`; `view=completed` lists `delivered` ones. `limit` 1–100 (default 50). Lapsed offers are released first, so no `assigned` row is a dead offer. Cancelled orders and store-pickup orders are never listed. The board does not load each delivery's history: every `delivery` carries an **empty** `timeline` (`[]`); open `GET /:id` for it. `403` for customers and riders. |

### Rider
| Method & path | Purpose |
|---|---|
| `GET /driver/me` | `{ driver, deliveries: [...] }`: profile + open deliveries. `403` if not a registered, active rider. |
| `POST /:id/accept` | `assigned → accepted`. |
| `POST /:id/decline` | `assigned` or `accepted → pending_assignment`. Returns `{ id, status }` (the rider loses access afterwards). |
| `POST /:id/status` `{ status, note? }` | `picked_up`, `arrived` or `failed` (`failed` needs `note`, ≤500 chars). Refused with `423` if the delivery is locked. |
| `POST /:id/location` `{ lat, lng, speedKmh?, heading?, accuracyM? }` | Post a GPS point. See below. |
| `POST /:id/complete` `{ code }` | Verify the 4-digit handover code and mark `delivered`. |

Only the **assigned, active** rider may call these (`403` for other participants,
`404` for strangers). A suspended rider is refused everywhere.

### Admin
| Method & path | Purpose |
|---|---|
| `POST /drivers/:profileId` `{ name, phone, status?: 'active' \| 'suspended' }` | Register, update or suspend a rider. **An omitted `status` leaves an existing rider's status unchanged** (a new rider starts `active`), so editing a name never reactivates someone who was suspended; reactivating needs an explicit `"active"`. Suspending returns their un-started deliveries (`assigned`/`accepted`) to `pending_assignment`; ones already collected need `resolve`. |
| `GET /drivers?status=all\|suspended` | **Admin only (v1.2).** The full rider roster for managing riders: every rider (`all`) or only the suspended ones, each with its `status` and `openDeliveries`, active riders first, then by name. A seller passing `status` gets `403`. Without `status` the endpoint behaves exactly as for sellers (active riders, ranked). |
| `POST /:id/resolve` `{ action: 'unlock' \| 'fail', note? }` | `unlock`: a delivery locked by wrong codes gets a new code and a fresh budget. `fail`: mark a `picked_up`/`arrived` delivery failed (note required) so another rider can be assigned. |
| `POST /:id/reconcile` | Re-apply the order status implied by the delivery. Idempotent. |

### Location pings (`POST /:id/location`)
Allowed while `accepted`, `picked_up` or `arrived`.
* `400` if `lat`/`lng` are missing or out of range, `heading` is not in `[0,360)`,
  `speedKmh` < 0, or `accuracyM` > 200 (wait for a better fix).
* `200 { accepted: true, location, etaMinutes, distanceKm }` when stored.
* `200 { accepted: false, reason }` when ignored: `throttled` (< 3 s since the last
  accepted point), `implausible_jump` (> 200 km/h implied within 60 s: GPS glitch),
  or `busy` (another write won the race; the next ping will carry fresh state).
  The client should just keep sending every 5–10 s; none of these is an error.

### Handover code and the guess budget
The buyer reads a 4-digit code to the rider in person. `POST /:id/complete`:
* `400` for a malformed code (does **not** use a guess).
* `400` "Incorrect handover code" with `attemptsRemaining` in the message for a
  wrong code.
* After **5 wrong codes per delivery, over its whole life** (a retry does not
  refill it) → `423 DELIVERY_LOCKED`; even the right code is then refused and the
  rider cannot report `failed` either. An admin must `resolve` it.

## Live stream (`GET /:id/stream`, Server-Sent Events)

**The browser's native `EventSource` cannot be used.** It cannot send an
`Authorization` header, and putting the session token in the URL would leak it into
access logs, so query-string tokens are deliberately **not** supported. Use
`fetch()` with a streaming body reader (or a fetch-based client such as
`@microsoft/fetch-event-source`) and send `Authorization: Bearer …` as for every
other call. Parse the standard SSE framing (`event:` / `data:` lines, blank line
between events, `:` comment lines).

```
retry: 5000

event: status
data: {"status":"picked_up","at":"…","etaMinutes":9,"distanceKm":2.8}

event: location
data: {"lat":4.055,"lng":9.72,"at":"…","speedKmh":24,"heading":90}

event: eta
data: {"etaMinutes":9,"distanceKm":2.8}

: keep-alive

event: end
data: {"reason":"complete"}
```

* On connect the server sends the **current** `status` and, if any, the last
  `location` (so a late joiner is up to date), then live events.
* `: keep-alive` comment every 25 s. `retry: 5000` is the reconnect delay hint.
* The same **visibility table as the REST view** applies: a buyer's stream carries
  no `location`/`eta` events, and `etaMinutes`/`distanceKm` are `null`, until the
  delivery is `picked_up`.
* The stream ends itself with `event: end` and then closes. `reason`:
  `complete` (delivery delivered or cancelled), `access_revoked` (you are no longer
  a participant, e.g. a rider who was replaced, **or your account was suspended,
  deleted or demoted**: access is re-checked against the live account on every
  status change and every heartbeat, about every 25 s), `timeout` (maximum lifetime
  30 minutes: just reconnect), `server_restart` (the server is shutting down:
  reconnect after a moment).
* **Limit:** 5 open streams per user; a 6th attempt gets `429 RATE_LIMITED`. Close
  streams you no longer show.
* Errors before the stream starts are normal JSON (`401`, `404`, `429`), so check
  the response status before reading the body as a stream.
* **Works only where the API is a long-lived process** (Railway). On a serverless
  runtime (Netlify, Vercel, Lambda) the endpoint answers immediately with
  `501 { error: { code: "STREAM_UNSUPPORTED" } }` instead of hanging, and the
  frontend must **poll `GET /:id` every 5–10 s** from then on. Do the same when
  the stream fails to open or closes with no `end` event (network drop). Treat the
  stream as an optimisation, not a requirement.
* Delivery events are fanned out inside one server process (see
  `DeliveryEvents.js`); revisit if the API is ever scaled horizontally.

## Errors
`400` validation (`details` is at most 5 `{ field, message }` entries) · `401` unauthenticated · `403` wrong role / not the assigned or
an inactive rider · `404` not found **or not a participant** (including a rider who
was replaced or declined) · `409` illegal transition / already exists / changed by
someone else · `409 OFFER_EXPIRED` accepting an offer whose window lapsed ·
`409 NO_RIDER_AVAILABLE` auto-assign found no eligible rider · `423` handover locked ·
`429` too many open streams (or the global rate limit, see decision 7) · `501` live
streaming unsupported on this deployment.

## Decisions taken (change here first if you disagree)
1. **Who assigns riders?** The order's seller or an admin.
2. **Who are riders?** Profiles an admin registers in `iam.delivery_drivers`
   (migration 013). There is no rider role on profiles.
3. **Payment is not checked** beyond "not refunded": cash-on-delivery orders are
   allowed. Revisit when the payment gateway lands.
4. **Rider page** posts GPS only while it is open and on screen. Background
   tracking needs a native wrapper and is out of scope.
5. **Account deletion** scrubs a rider's name/phone and releases their un-started
   deliveries (hook in `DeleteAccountUseCase`). Deleted *buyers/sellers* with open
   deliveries are **not** handled yet.
6. **GPS history** (`driver_locations`) grows with every stored ping; run
   `SELECT iam.prune_driver_locations(30);` periodically.
7. **Rate limiting is shared, and delivery adds load to it. This needs a decision.**
   Reading `RateLimitService` and `server/index.js`: `/api` is limited to 120
   requests/min per client IP **and** 120/min per *immediate peer* (the ingress
   proxy), checked first. Behind a single ingress (Railway) that second bucket is
   effectively **one 120/min budget for every user of the whole API**. Delivery adds
   6–12 calls/min per active rider (pings) and, if the stream is unavailable, 6–12
   per polling buyer. A handful of simultaneous deliveries can exhaust the shared
   budget and make *unrelated* endpoints answer `429`. This was not measured in
   production. Options: raise `peerMaxRequests` for `/api`, exempt delivery pings
   from the peer bucket, or add a per-user limiter. **Not changed here** because it
   alters platform-wide abuse protection. Until then the client must treat a `429`
   on a ping as "skip this one" (the next carries fresh state).
8. **The order is read fresh from the database** for every delivery decision
   (`OrderRepository.findOrderByIdFresh`): the ordinary read serves a per-instance
   cache that is never refreshed.
9. **An unanswered offer lapses after 15 minutes** (`DELIVERY_OFFER_TTL_MINUTES`,
   `0` = never). Without a deadline a rider who ignores the notification would hold
   the order in `assigned` forever and the buyer would wait on nobody. Only `assigned`
   expires, never `accepted`. Needs no schema change: the deadline is
   `assigned_at + window`, and `assigned_at` already exists. 15 minutes is a starting
   point to tune with real riders, not a measured value.
10. **Auto-assign picks the least-busy rider, not the nearest.** A rider's position is
    only recorded while they are on a delivery (`driver_locations` is keyed by
    delivery), so there is no honest "nearest rider" until riders can report
    availability and position without a job. Least-busy is what we can compute
    truthfully today. Revisit with a presence table.
    **A rider who lets an offer lapse sorts behind every responsive rider for the
    next hour.** Without this, a rider who never answers (offline, or suspended in
    their LOUMOO account: nothing yet syncs an account suspension to the rider
    record, only account *deletion* has a hook) returns to zero load after each
    lapse and would be offered the first slot of every new delivery. The penalty
    fades on its own; a decline does not trigger it; a seller can still pick the
    rider by hand. The penalty is read from the same timeline row as `declined`
    (written best-effort, retried once), so a lost row means it is not applied. The proper fix is to suspend the rider record when their
    account is suspended; this does not replace it.
11. **Rider workload is shared across sellers, on purpose.** Riders are a pool an
    admin registers, not per-seller staff, so `openDeliveries` counts a rider's
    work for every seller, and any seller can read it. The trade-off: a seller can
    watch when a named rider takes or finishes other sellers' jobs, and estimate a
    competitor's live volume if riders mostly serve one shop. Judged acceptable
    while the pool is small and shared; if riders become per-seller, or that
    visibility is unwanted, show only a coarse free/busy flag, or only the caller's
    own count, and keep the global count for ranking. **Needs the owner's
    confirmation.**
