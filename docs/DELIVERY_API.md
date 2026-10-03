# Delivery Tracking — API Contract (v1, backend step 1 implemented)

Single source of truth for the backend (`server/modules/delivery/**`) and the
frontend (rider page, customer tracking screen). **Change this file first, then
tell the other side.** Neither side codes against anything not written here.

> Status: the domain, repository and service behind every rule below are built
> and unit-tested (`tests/unit/delivery_*.test.js`). The HTTP routes and the SSE
> stream are **step 2** and are not mounted yet; their shapes are fixed here.

Base path: `/api/v1/deliveries` (mounted like `/api/v1/orders`).
Auth: same bearer session as the rest of the API (`requireAuth`).
Envelope: `{ success: true, status: 'success', data: ... }` on success; errors use
the existing `AppError` JSON shape `{ error: { code, message, details, statusCode } }`.
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
| `POST /:id/cancel` `{ reason? }` | seller, admin; buyer only while `pending_assignment` | Cancel before pickup. |
| `GET /:id/code` | order **buyer only** | `{ code, digits: 4, attemptsRemaining }`. Only from `accepted` to `arrived`. Seller, admin and rider get `403`. |
| `GET /drivers` | seller, admin | Active riders `[{ id, name, phone }]` to pick from. |

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
| `POST /drivers/:profileId` `{ name, phone, status?: 'active' \| 'suspended' }` | Register, update or suspend a rider. Suspending returns their un-started deliveries (`assigned`/`accepted`) to `pending_assignment`; ones already collected need `resolve`. |
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

## SSE events (`GET /:id/stream`)
```
event: status
data: {"status":"picked_up","at":"…","etaMinutes":9,"distanceKm":2.8}

event: location
data: {"lat":4.055,"lng":9.72,"at":"…","speedKmh":24,"heading":90}

event: eta
data: {"etaMinutes":9,"distanceKm":2.8}
```
A `: keep-alive` comment is sent every 25 s. On connect the server first sends the
current `status` and last `location`. The server applies the **same visibility
table as the REST view**: a buyer's stream carries no `location`/`eta` events
until the delivery is `picked_up`. One server process only (in-process fan-out);
revisit if the API is scaled horizontally.

## Errors
`400` validation · `401` unauthenticated · `403` wrong role / not the assigned or
an inactive rider · `404` not found **or not a participant** (including a rider who
was replaced or declined) · `409` illegal transition / already exists / changed by
someone else · `423` handover locked.

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
