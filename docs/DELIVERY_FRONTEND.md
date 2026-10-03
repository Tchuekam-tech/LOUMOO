# Delivery Tracking — Frontend (step 4: customer tracking screen)

Built on branch `feat/delivery-frontend-tracking` (forked from `origin/main`).
Implements the customer-facing live tracking experience against the step 1–2
backend contract in [`DELIVERY_API.md`](./DELIVERY_API.md).

## What it is

A self-contained, full-screen tracking overlay:

- a **MapLibre** map with a live rider marker and the destination marker;
- a **status timeline** (Finding a rider → Rider assigned → on the way to pick up
  → Out for delivery → Rider has arrived → Delivered), with failed/cancelled
  handling;
- the **rider card** (name, phone, call + WhatsApp);
- the **ETA / distance** (shown only once the backend computes it, i.e. from
  pickup onward — before that the rider is heading to the store);
- the buyer's **4-digit handover code** (fetched buyer-only; hidden for anyone
  else or outside the `accepted..arrived` window).

Live updates use `fetch`-based SSE with the `Authorization` header (never native
`EventSource`, which cannot send it), and fall back to polling `GET /:id` every
~7s when the stream is unsupported (serverless `501`), refused, or dropped —
exactly as the contract requires.

## Files

| File | Role |
|---|---|
| `src/services/deliveryApi.js` | API client: `getByOrder`, `get`, `getCode`, and `subscribe(id, handlers)` (SSE + poll fallback). Registers `window.deliveryApi`. |
| `src/services/deliveryTrackingScreen.js` | The overlay UI + map + timeline + code + live wiring. Registers `window.LoumooDeliveryTracking`. |
| `src/services/deliveryApi.test.js` | Node test for the DOM-free logic (parsing, envelope, errors, poll fallback). `node src/services/deliveryApi.test.js`. |
| `build_redesign.py` | Two `<script defer>` tags in the head load the two services. (Only build edit needed.) |
| `src/views/order_product_flow_view.py` | A "Track live delivery" button in the order-detail screen. |

