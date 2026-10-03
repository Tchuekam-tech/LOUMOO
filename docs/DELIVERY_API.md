# Delivery Tracking — API Contract (v0, draft)

Single source of truth for the backend (`server/modules/delivery/**`) and the
frontend (rider page, customer tracking screen). **Change this file first, then
tell the other side.** Neither side codes against anything not written here.

Base path: `/api/v1/deliveries` (mounted like `/api/v1/orders`).
Auth: same bearer session as the rest of the API (`requireAuth`).
Envelope: `{ success: true, status: 'success', data: ... }` on success; errors
use the existing `AppError` JSON shape.
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
| `picked_up` | Rider has the parcel | `in_transit` |
| `arrived` | Rider at the drop-off | `in_transit` |
| `delivered` | Handed over, code verified | `delivered` |
| `failed` | Could not deliver (reason required) | `in_transit` (unchanged) |
| `cancelled` | Cancelled before pickup | `cancelled` |

Allowed transitions (server enforces; anything else → `409 Conflict`):

```
pending_assignment -> assigned | cancelled
assigned           -> accepted | pending_assignment (rider declines) | cancelled
accepted           -> picked_up | cancelled
picked_up          -> arrived | failed
arrived            -> delivered | failed
failed             -> assigned (retry)
delivered, cancelled: terminal
```

## Objects

### Delivery
```json
{
  "id": "dlv_...",
  "orderId": "...",
  "orderNumber": "LM-...",
  "status": "picked_up",
  "driver": { "id": "...", "name": "…", "phone": "…" },
  "pickup":  { "label": "Store name", "address": "…", "location": { "lat": 4.05, "lng": 9.70 } },
  "dropoff": { "label": "Customer",   "address": "…", "location": { "lat": 4.06, "lng": 9.74 } },
  "etaMinutes": 12,
  "distanceKm": 3.4,
  "lastLocation": { "lat": 4.055, "lng": 9.72, "at": "2026-10-03T10:00:00Z", "speedKmh": 24, "heading": 90 },
  "timeline": [
    { "status": "assigned", "at": "…", "note": null }
  ],
  "createdAt": "…",
  "updatedAt": "…"
}
```
`driver`, `lastLocation`, `etaMinutes` and `distanceKm` are `null` until known.
**Customers never receive** the driver's exact phone number before `accepted`,
nor the delivery code (see below).

## Endpoints

### Customer / seller
| Method & path | Who | Purpose |
|---|---|---|
| `GET /by-order/:orderId` | order buyer, order seller, admin | Delivery for an order (`404` for non-owners — anti-enumeration, like orders). |
| `GET /:id` | same | Delivery detail. |
| `GET /:id/stream` | same | **Server-Sent Events**: emits `status` and `location` events (below). |
| `POST /` body `{ orderId }` | seller of the order, admin | Create the delivery for a `HOME_DELIVERY` order. |
| `POST /:id/assign` body `{ driverId }` | seller, admin | Assign a rider. |
| `POST /:id/cancel` body `{ reason }` | seller, admin (buyer only while `pending_assignment`) | Cancel before pickup. |
| `GET /:id/code` | order buyer only | The 4-digit handover code the buyer reads to the rider. |

### Rider
| Method & path | Purpose |
|---|---|
| `GET /driver/me` | Rider profile + active deliveries. |
| `POST /:id/accept` | Accept an assignment. |
| `POST /:id/decline` | Decline (returns to `pending_assignment`). |
| `POST /:id/status` body `{ status, note? }` | Move to `picked_up`, `arrived` or `failed` (`failed` needs `note`). |
| `POST /:id/location` body `{ lat, lng, speedKmh?, heading?, accuracyM? }` | Post a GPS point. Throttled: ignore if < 3 s since the last accepted point; reject `accuracyM > 200`. |
| `POST /:id/complete` body `{ code }` | Verify the handover code and mark `delivered`. Max 5 wrong attempts, then `423 Locked` and an admin must resolve. |

Only the **assigned** rider can call rider endpoints for a delivery (`403` otherwise).

## SSE events (`GET /:id/stream`)
```
event: status
data: {"status":"picked_up","at":"…"}

event: location
data: {"lat":4.055,"lng":9.72,"at":"…","speedKmh":24,"heading":90}

event: eta
data: {"etaMinutes":9,"distanceKm":2.8}
```
A `: keep-alive` comment is sent every 25 s. The client reconnects with
`EventSource` defaults; on connect the server first sends the current `status`
and last `location`.

## Errors
`400` validation · `401` unauthenticated · `403` wrong role/not the assigned rider
· `404` not found or not yours · `409` illegal transition · `423` too many wrong codes.

## Open decisions (owner to confirm)
1. **Who assigns riders?** Assumed: the order's seller or an admin. A rider
   self-claim pool is a later option.
2. **Who are riders?** There is no rider role today. Assumed: a `delivery.drivers`
   table keyed by profile id, created by an admin.
3. **ETA**: v0 uses straight-line distance ÷ an assumed speed. Road routing later.
4. **Rider page** is a web page posting GPS only while it is open and on screen.
   Background tracking needs a native wrapper and is out of scope for v0.
