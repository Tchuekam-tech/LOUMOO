/**
 * LOUMOO Customer Delivery Tracking (step 4)
 * ---------------------------------------------------------------------------
 * A self-contained, full-screen tracking overlay: a live MapLibre map of the
 * rider, a status timeline, the rider's details, the ETA, and the buyer's
 * 4-digit handover code. It is deliberately framework-agnostic (it builds its
 * own DOM and manages its own lifecycle) rather than a DC child screen, because
 * DC child screens carry no logic of their own — all state would otherwise have
 * to live in the 17.5k-line build_redesign.py root. This keeps step 4 isolated,
 * testable on its own, and free of collisions with the rider-page work.
 *
 * Open it from anywhere (e.g. a "Track delivery" button on the order screen):
 *     window.LoumooDeliveryTracking.open({ orderId: currentOrder.id })
 *     window.LoumooDeliveryTracking.open({ deliveryId: 'dlv_...' })
 *
 * Data + live updates come from window.deliveryApi (src/services/deliveryApi.js).
 * MapLibre GL is loaded lazily from a CDN the first time the overlay opens, so
 * it never weighs on the initial app shell. A street-tile style can be supplied
 * via window.LOUMOO_MAP_STYLE (e.g. a MapTiler/Stadia URL with a key); without
 * one it falls back to the keyless MapLibre demo tiles.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var MAPLIBRE_JS = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.js';
  var MAPLIBRE_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.css';
  var DEMO_STYLE = 'https://demotiles.maplibre.org/style.json';
  var DOUALA = { lat: 4.0511, lng: 9.7679 };

  // Customer-facing label + order for each delivery status.
  var STEPS = [
    { key: 'pending_assignment', label: 'Finding a rider' },
    { key: 'assigned', label: 'Rider assigned' },
    { key: 'accepted', label: 'Rider on the way to pick up' },
    { key: 'picked_up', label: 'Out for delivery' },
    { key: 'arrived', label: 'Rider has arrived' },
    { key: 'delivered', label: 'Delivered' }
  ];
  var STEP_INDEX = STEPS.reduce(function (m, s, i) { m[s.key] = i; return m; }, {});

