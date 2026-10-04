# Delivery — Frontend (step 4: customer tracking · step 5: dispatch screens)

Built on branch `feat/delivery-frontend-tracking` (forked from `origin/main`).
Implements the customer-facing live tracking experience against the step 1–2
backend contract in [`DELIVERY_API.md`](./DELIVERY_API.md).

The seller, rider and admin screens (step 5) are described
[below](#step-5--dispatch-screens-seller-rider-admin).

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

## Why an overlay, not a DC child screen

DC child screens carry no logic of their own — the comment in `build_redesign.py`
(`_write_screen_chunk`) is explicit: "A child DC component intentionally has no
logic of its own. The root owns navigation/state." A live map + stream + code
screen is all logic, so as a DC screen it would push hundreds of lines into the
shared 17.5k-line `build_redesign.py` root — exactly where the rider-page work
also lives, inviting collisions. Implementing it as a framework-agnostic overlay
keeps step 4 isolated, independently testable, and merge-safe.

## How to open it

Any element with `data-track-delivery` opens the overlay (handled by a
document-level delegate — no DC event binding needed):

```html
<button data-track-delivery data-order-id="{{ currentOrder.id }}">Track delivery</button>
<!-- or -->
<button data-track-delivery data-delivery-id="dlv_123">Track delivery</button>
```

Or from JavaScript:

```js
window.LoumooDeliveryTracking.open({ orderId: order.id });
window.LoumooDeliveryTracking.open({ deliveryId: 'dlv_123' });
```

`getByOrder` accepts the order id or the order number. If the order has no home
delivery yet, the overlay shows a friendly notice rather than an error.

## Map tiles

The default is **Esri World Street Map** — real street tiles, **keyless**, free to
use with attribution, and lightweight (JPEG raster) so it renders reliably on
mobile data. No configuration needed.

To use a different basemap, set a style before the app loads (a URL or a MapLibre
style object):

```html
<!-- Vector (OpenFreeMap — free, keyless, self-hostable): -->
<script>window.LOUMOO_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';</script>
<!-- or an SLA-backed provider: -->
<script>window.LOUMOO_MAP_STYLE = 'https://api.maptiler.com/maps/streets/style.json?key=YOUR_KEY';</script>
```

A URL style that fails to load falls back to the MapLibre demo tiles; the inline
Esri default cannot fail that way. MapLibre GL is loaded lazily from a CDN the
first time the overlay opens, so it never weighs on the initial shell.

When the drop-off has an address but no coordinates (the checkout address has
none today), the destination is geocoded — Nominatim by default, overridable via
`window.LOUMOO_GEOCODER_URL` (append-query form).

## API origin

Same-origin by default. In production the frontend (Netlify) and the API
(Railway) are different origins, so set the API origin once before load:

```html
<script>window.LOUMOO_API_ORIGIN = 'https://loumoo-production.up.railway.app';</script>
```

The server must then allow that origin in `CORS_ORIGINS` (the live stream and the
REST calls are both cross-origin).

## Build & merge

- `npm run build:frontend` (`python build_redesign.py`) regenerates the
  `.dc.html` bundles. Per the handoff, rebuild only after merging, one side at a
  time.
- This branch and the rider-page branch both touch `build_redesign.py`, but only
  minimally and in different places (step 4 adds two script tags); expect a
  trivial merge at most.

## Verified

Checked live on 2026-10-03:
- `npm run build:frontend` builds; both service `<script>` tags land in
  `Commerce App.dc.html` and the `data-track-delivery` button survives DC
  compilation (binding intact) in `OrderScreens.dc.html`.
- The overlay renders real Esri street tiles, the directional animated rider, the
  destination pin, the route line, ETA, timeline, rider card and handover code.
- **Full end-to-end:** the real client (`deliveryApi.js`) talking to the real
  backend `/api/v1/deliveries` against the live Supabase database (migration 013
  applied) — a seeded picked-up delivery rendered its real rider position, 5-min
  ETA and handover code on the real map. Cross-origin (CORS) and the node client
  unit test (`deliveryApi.test.js`, 8/8) both pass.

## Known follow-ups

- Optionally promote the overlay into DC navigation (back-stack integration)
  instead of a self-managed overlay.
- Road-snapped routing (a provider/OSRM) instead of the straight geodesic line.
- An SLA-backed tile provider + key for very high volume (Esri/OpenFreeMap cover
  normal use keyless).

---

## Step 5 — dispatch screens: seller, rider, admin

Built on branch `feat/delivery-dispatch-ui` (from `feat/delivery-frontend-tracking`,
with `origin/main` merged in) against the v1.2 contract in
[`DELIVERY_API.md`](./DELIVERY_API.md). Three surfaces, each a full-screen overlay
like the tracking screen, for the same reason: they are all logic.

### Seller: Deliveries

Opened from the **Deliveries** card on the seller dashboard.

- **Board** (`GET /dispatch`), three tabs. *To dispatch* lists "Needs attention"
  (failed attempts), then "Waiting for a rider", oldest first. *In progress* lists
  offers waiting for an answer, each with a countdown ring, then deliveries on the
  way. *Completed* lists delivered orders. Rows read like Mail: the item and its
  age, the status in colour, then the order number and area. The board refreshes
  every 20 s and when the tab comes back, and redraws only when something changed.
- **Order screen**: a status card (what is happening, the offer countdown,
  4-step progress), the rider with call and WhatsApp, the order (item and total,
  customer and area, pickup, age), and the next action. It follows the delivery
  live (`subscribe`).

  | Delivery status | Actions |
  |---|---|
  | none, `cancelled` | Arrange delivery: pickup name and address (remembered on this device), then the rider picker |
  | `pending_assignment` | Choose a rider, Auto-assign, Cancel delivery |
  | `failed` | Choose a rider, Auto-assign (a failed delivery can only be re-assigned) |
  | `assigned` | Change rider, Cancel delivery |
  | `accepted` | Track live, Cancel delivery |
  | `picked_up`, `arrived` | Track live |

- **Rider picker** (`GET /drivers?deliveryId=`): search, an Auto-assign row, then
  the riders with their load (*Free*, *2 active*). Riders who already passed on
  this order are dimmed and marked *Passed*; the current offer is marked
  *Offered*. Picking a rider asks for confirmation, then sends the offer.

### Rider: Your deliveries

Opened from the **Deliver with LOUMOO** card in the account hub.

- **Inbox** (`GET /driver/me`): new offers as cards (countdown ring, pickup,
  drop-off area, approximate distance, Decline and Accept), then jobs in progress
  with their next step. Refreshes every 15 s while it is the screen on top.
- **Job screen**, one per phase:
  - *New offer*: a map with the pickup and only the drop-off **area**, a large
    countdown, Accept and Decline.
  - *Pick up*: confirm pickup, or *Can't do this job* to hand it back.
  - *Deliver*: *I've arrived*.
  - *Hand over*: the customer's 4-digit code. Four boxes take a paste or the SMS
    autofill and submit on the fourth digit. A wrong code shakes them and shows
    the attempts left; too many lock the delivery.
  - A done screen.

  Each place has Navigate (Google Maps), Call and WhatsApp. *Report a problem*
  ends the attempt with a reason; details are required only for "Something else".
- **Live location** is shared only while the job screen of an accepted job is
  open: at most every 6 s unless the rider moved 25 m, and never a fix worse than
  200 m. A chip shows the state: sharing, weak signal, location off, unavailable.
  If the job is taken away (cancelled, reassigned, expired), the screen says so
  and stops.
- **Not a rider yet**: the screen explains that the LOUMOO team adds riders and
  shows the account ID to send them, with a copy button.

### Admin: Riders

Opened from **Livreurs** in the super-admin tab bar. Anyone else sees an
"Administrators only" screen.

- **Roster** (`GET /drivers?status=all`): All, Active and Suspended, and search by
  name or phone. Each rider shows their phone and current load.
- **Edit** (tap a rider): name and phone (Save turns on once something changed),
  Suspend (after a confirmation) or Reactivate, through `POST /drivers/:profileId`.
- **Add** (+): search LOUMOO accounts (the admin user directory) or paste an
  account ID, confirm the name and phone customers will see, then add.

### Files

| File | Role |
|---|---|
| `src/services/dispatchUi.js` | Shared UI kit (`window.LoumooDispatchUI`): navigation stack with large titles, grouped lists, segmented control, search, sheets and confirmations, countdown ring, toasts, loading, empty and error states, formatting, error messages. Injects its CSS on first use. |
| `src/services/sellerDispatch.js` | Seller board, order screen and rider picker (`window.LoumooSellerDispatch`). |
| `src/services/riderHub.js` | Rider inbox, job screens, handover code, problem report and live location (`window.LoumooRiderHub`). |
| `src/services/ridersAdmin.js` | Admin roster, edit and add (`window.LoumooRidersAdmin`). |
| `src/services/deliveryApi.js` | Adds the seller, rider and admin calls: `dispatchBoard`, `create`, `listDrivers`, `assign`, `autoAssign`, `cancel`, `riderOverview`, `accept`, `decline`, `setStatus`, `postLocation`, `complete`, `riderRoster`, `registerDriver`, `searchUsers`, `whoAmI`. |
| `src/views/merchant_view.py`, `src/views/account_hub_view.py`, `src/views/super_admin_view.py` | The three entry points. |
| `build_redesign.py` | Four more `<script defer>` tags after the tracking screen's. |
| `tests/ui/dispatch_harness.html`, `tests/ui/phone_frame.html` | Dev-only harness (below). Not shipped. |

### How to open them

```html
<button data-open-dispatch>Deliveries</button>
<button data-open-dispatch data-order-id="{{ order.id }}">Arrange delivery</button>
<button data-open-rider-hub>Deliver with LOUMOO</button>
<button data-open-riders-admin>Riders</button>
```

```js
window.LoumooSellerDispatch.open();             // the board
window.LoumooSellerDispatch.open({ orderId });  // straight to one order
window.LoumooRiderHub.open();
window.LoumooRidersAdmin.open();
```

These screens sit below the tracking overlay (z-index 3500 against 4000), so
*Track live* opens on top of an order and closes back to it.

### Design

The screens follow iOS conventions: large titles that collapse into a blurred
bar, inset grouped lists, a segmented control, bottom sheets with a grabber
(centred dialogs on wide screens), and every state said in words, not by colour
alone. They read LOUMOO's tokens (`--color-*`, `--font-*`) and its
`[data-theme="dark"]` palette, so they match the rest of the app.

Colour: the bright tones fill bars, rings and tiles; text and small icons use a
darker *ink* shade of each tone, so every coloured label keeps at least 4.5:1
contrast in light and in dark mode. In dark mode the street map is darkened with
a CSS filter.

Accessibility: focus moves to the title of a new screen or sheet, never to a
button, so a stray Enter can't confirm anything. Focus stays inside the top
layer and Escape closes it. Touch targets are at least 44 px, rows have spoken
labels, countdowns are `role="timer"`, and animations stop under
`prefers-reduced-motion`.

### Dev harness

`tests/ui/dispatch_harness.html` loads the real modules against a mock API with
sample Douala data, so every screen can be reviewed with no backend and no
account. From the repo root:

```bash
python -m http.server 5177 --bind 127.0.0.1
```

Then open `http://127.0.0.1:5177/tests/ui/dispatch_harness.html`. The flags are
`?rider=new` (not a rider), `&empty=1`, `&error=1`, `&gps=deny`, `&theme=dark`,
and `&open=<scenario>` to go straight to a screen, such as `seller-order`,
`picker`, `rider-offer`, `rider-code` or `admin-edit` (the file's header lists
all 21). For a phone-sized headless capture, wrap it in `phone_frame.html`:

```bash
chrome --headless=new --hide-scrollbars --window-size=390,844 --force-device-scale-factor=2 --virtual-time-budget=16000 --screenshot=shot.png "http://127.0.0.1:5177/tests/ui/phone_frame.html?q=open%3Drider-offer%26static%3D1"
```

`static=1` turns animations off for captures. Now and then a capture comes back
without the overlay; take it again.

### Verified

On 2026-10-04:
- The delivery unit suites pass: `delivery_board` (the new board and roster
  endpoints), `delivery_routes`, `delivery_service`, `delivery_dispatch`,
  `delivery_domain`, `delivery_repository` and `delivery_sweeper`. So do the
  client checks (`deliveryApi.test.js`, 10/10).
- `npm run build:frontend` builds. The four `<script defer>` tags land in
  `Commerce App.dc.html`, and each entry button survives DC compilation (in
  `MerchantScreens`, `AccountHubScreens` and `SuperAdminScreens`). The rebuilt
  bundles are not committed: per the handoff they are rebuilt after merging.
- Every screen and state was reviewed from headless captures of the harness:
  26 phone states in light and dark mode, and 4 desktop states.
- **Not verified yet:** against the real backend and database (the screens
  have only run against the mock API), and on real phones (location permission
  prompts, `tel:` and WhatsApp links, the on-screen keyboard).

### Known follow-ups

- Riders aren't notified of a new offer: they see it only with the inbox open
  (it refreshes every 15 s), and an unanswered offer lapses. A push or SMS
  channel is the main gap.
- On the web, location is shared only while the job screen is open and the
  phone is awake; there is no background tracking.
- The admin tab bar is French ("Livreurs") while these screens are English;
  the modules have no translation layer yet.
- Decision 11 (riders' workload counted across all sellers) is still open.
