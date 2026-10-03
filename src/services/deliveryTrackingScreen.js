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

  var state = {
    mounted: false,
    root: null,
    sub: null,        // live subscription handle
    map: null,
    driverMarker: null,
    destMarker: null,
    delivery: null,
    deliveryId: null
  };

  // --------------------------------------------------------------- styling
  function injectStyles() {
    if (document.getElementById('loumoo-dt-styles')) return;
    var css = [
      '#loumoo-dt{position:fixed;inset:0;z-index:4000;background:var(--color-bg,#fff);color:var(--color-text,#111);display:flex;flex-direction:column;font-family:var(--font-body,system-ui,sans-serif);overflow:hidden}',
      '#loumoo-dt .dt-head{display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--color-surface,#fff);border-bottom:1px solid var(--color-divider,#e5e5e5);flex-shrink:0}',
      '#loumoo-dt .dt-iconbtn{border:1px solid var(--color-divider,#e5e5e5);background:var(--color-surface,#fff);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text,#111);cursor:pointer;flex-shrink:0}',
      '#loumoo-dt .dt-title{flex:1;min-width:0}',
      '#loumoo-dt .dt-title h4{margin:0;font:700 16px/1.2 var(--font-heading,inherit)}',
      '#loumoo-dt .dt-title .dt-sub{font:400 11px/1.2 var(--font-body,inherit);color:var(--color-text-secondary,#666);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#loumoo-dt .dt-pill{min-height:22px;padding:3px 10px;border-radius:999px;font:700 10px/1.4 var(--font-body,inherit);letter-spacing:.3px;text-transform:uppercase;background:var(--color-accent-100,#eef);color:var(--color-accent,#3245ff);white-space:nowrap}',
      '#loumoo-dt .dt-pill.ok{background:var(--color-success-100,#e6f7ec);color:var(--color-success,#1a9d4b)}',
      '#loumoo-dt .dt-pill.bad{background:var(--color-danger-100,#fde8e8);color:var(--color-danger,#d32f2f)}',
      '#loumoo-dt .dt-map{position:relative;width:100%;height:42%;min-height:220px;background:var(--color-surface-2,#eef1f5);flex-shrink:0}',
      '#loumoo-dt .dt-map .dt-map-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;color:var(--color-text-secondary,#666);font-size:13px}',
      '#loumoo-dt .dt-body{flex:1;overflow-y:auto;padding:16px;max-width:680px;width:100%;margin:0 auto;display:flex;flex-direction:column;gap:14px}',
      '#loumoo-dt .dt-card{background:var(--color-surface,#fff);border:1px solid var(--color-divider,#e5e5e5);border-radius:var(--radius-md,14px);padding:14px 16px;box-shadow:var(--shadow-sm,0 1px 2px rgba(0,0,0,.05))}',
      '#loumoo-dt .dt-eta{display:flex;align-items:baseline;gap:8px}',
      '#loumoo-dt .dt-eta b{font:800 22px/1 var(--font-heading,inherit);color:var(--color-accent,#3245ff)}',
      '#loumoo-dt .dt-eta span{font:400 12px/1.3 var(--font-body,inherit);color:var(--color-text-secondary,#666)}',
      // timeline
      '#loumoo-dt .dt-timeline{list-style:none;margin:0;padding:4px 0 0}',
      '#loumoo-dt .dt-step{position:relative;padding:0 0 18px 28px}',
      '#loumoo-dt .dt-step:last-child{padding-bottom:0}',
      '#loumoo-dt .dt-step::before{content:"";position:absolute;left:7px;top:16px;bottom:-2px;width:2px;background:var(--color-divider,#e5e5e5)}',
      '#loumoo-dt .dt-step:last-child::before{display:none}',
      '#loumoo-dt .dt-dot{position:absolute;left:0;top:2px;width:16px;height:16px;border-radius:50%;border:2px solid var(--color-divider,#ccc);background:var(--color-surface,#fff)}',
      '#loumoo-dt .dt-step.done .dt-dot{background:var(--color-success,#1a9d4b);border-color:var(--color-success,#1a9d4b)}',
      '#loumoo-dt .dt-step.current .dt-dot{background:var(--color-accent,#3245ff);border-color:var(--color-accent,#3245ff);box-shadow:0 0 0 4px var(--color-accent-100,#eef)}',
      '#loumoo-dt .dt-step .dt-step-label{font:600 13.5px/1.3 var(--font-body,inherit)}',
      '#loumoo-dt .dt-step.pending .dt-step-label{color:var(--color-text-secondary,#999)}',
      '#loumoo-dt .dt-step .dt-step-at{font:400 11px/1.3 var(--font-body,inherit);color:var(--color-text-secondary,#999);margin-top:1px}',
      // driver
      '#loumoo-dt .dt-driver{display:flex;align-items:center;gap:12px}',
      '#loumoo-dt .dt-avatar{width:44px;height:44px;border-radius:50%;background:var(--color-accent-100,#eef);color:var(--color-accent,#3245ff);display:flex;align-items:center;justify-content:center;font:800 16px/1 var(--font-heading,inherit);flex-shrink:0}',
      '#loumoo-dt .dt-driver .dt-dn{flex:1;min-width:0}',
      '#loumoo-dt .dt-driver .dt-dn b{font:700 14px/1.2 var(--font-body,inherit)}',
      '#loumoo-dt .dt-driver .dt-dn span{display:block;font:400 12px/1.3 var(--font-body,inherit);color:var(--color-text-secondary,#666)}',
      '#loumoo-dt .dt-actions{display:flex;gap:8px}',
      '#loumoo-dt .dt-actions a{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;text-decoration:none;border:1px solid var(--color-divider,#e5e5e5);color:var(--color-text,#111)}',
      '#loumoo-dt .dt-actions a.wa{background:#25D366;border-color:#25D366;color:#fff}',
      // handover code
      '#loumoo-dt .dt-code{text-align:center}',
      '#loumoo-dt .dt-code .dt-code-label{font:600 12px/1.3 var(--font-body,inherit);color:var(--color-text-secondary,#666)}',
      '#loumoo-dt .dt-code .dt-code-digits{font:800 34px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:10px;margin:8px 0 4px;color:var(--color-text,#111)}',
      '#loumoo-dt .dt-code .dt-code-hint{font:400 11px/1.3 var(--font-body,inherit);color:var(--color-text-secondary,#999)}',
      '#loumoo-dt .dt-note{font:400 12px/1.4 var(--font-body,inherit);color:var(--color-text-secondary,#666)}',
      '#loumoo-dt .dt-error{color:var(--color-danger,#d32f2f);font-size:13px}',
      '@media (min-width:720px){#loumoo-dt .dt-map{height:46%}}'
    ].join('\n');
    var el = document.createElement('style');
    el.id = 'loumoo-dt-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  // --------------------------------------------------------------- overlay shell
  function h(tag, attrs, html) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (html != null) el.innerHTML = html;
    return el;
  }

  function buildOverlay(subtitle) {
    var root = h('div', { id: 'loumoo-dt', role: 'dialog', 'aria-label': 'Delivery tracking' });
    root.innerHTML =
      '<div class="dt-head">' +
        '<button class="dt-iconbtn" data-dt-close aria-label="Close tracking">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>' +
        '</button>' +
        '<div class="dt-title"><h4>Track delivery</h4><div class="dt-sub">' + (subtitle || 'Loading…') + '</div></div>' +
        '<span class="dt-pill" data-dt-pill>…</span>' +
      '</div>' +
      '<div class="dt-map" data-dt-map><div class="dt-map-fallback" data-dt-mapmsg>Loading map…</div></div>' +
      '<div class="dt-body">' +
        '<div class="dt-card dt-eta" data-dt-eta hidden></div>' +
        '<div class="dt-card dt-code" data-dt-code hidden></div>' +
        '<div class="dt-card dt-driver" data-dt-driver hidden></div>' +
        '<div class="dt-card"><ul class="dt-timeline" data-dt-timeline></ul></div>' +
        '<div class="dt-error" data-dt-error hidden></div>' +
        '<div class="dt-note">Live location updates while your parcel is on the way. If the live feed is unavailable this screen refreshes every few seconds.</div>' +
      '</div>';
    root.querySelector('[data-dt-close]').addEventListener('click', close);
    return root;
  }

