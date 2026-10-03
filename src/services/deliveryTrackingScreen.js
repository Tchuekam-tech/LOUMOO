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
  // Real street tiles by default. A lightweight RASTER basemap (Carto Voyager:
  // keyless, labels baked in, just PNG tiles) is the default because it renders
  // reliably even on slow/constrained connections — important for a delivery app
  // used on mobile data. For vector or an SLA-backed provider, set a style URL
  // (OpenFreeMap / MapTiler / Stadia) via window.LOUMOO_MAP_STYLE. The demo style
  // is the last-resort fallback if a custom style spec fails to load.
  var OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  var DEMO_STYLE = 'https://demotiles.maplibre.org/style.json';
  // Esri World Street Map: keyless, real street tiles, free to use with
  // attribution, and reliable on mobile data (lightweight JPEG). Note the
  // {z}/{y}/{x} order Esri uses. Override with window.LOUMOO_MAP_STYLE for a
  // vector style (OpenFreeMap) or an SLA provider (MapTiler/Stadia).
  var ESRI_STREET_TILES = ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'];
  function rasterStreetStyle() {
    return {
      version: 8,
      sources: { basemap: { type: 'raster', tiles: ESRI_STREET_TILES, tileSize: 256, attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors' } },
      layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }]
    };
  }
  function mapStyle() {
    if (typeof window !== 'undefined' && window.LOUMOO_MAP_STYLE) return window.LOUMOO_MAP_STYLE; // URL or style object
    return rasterStreetStyle();
  }
  // Optional geocoder for a drop-off that has an address but no coordinates.
  var GEOCODER = (typeof window !== 'undefined' && window.LOUMOO_GEOCODER_URL) || 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=';
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

  function q(sel) { return state.root ? state.root.querySelector(sel) : null; }

  // --------------------------------------------------------------- lifecycle
  function open(opts) {
    opts = opts || {};
    var orderId = opts.orderId || opts.order || null;
    var deliveryId = opts.deliveryId || opts.id || null;
    if (!orderId && !deliveryId) { console.warn('[DeliveryTracking] open() needs orderId or deliveryId'); return; }
    if (state.mounted) close();

    injectStyles();
    state.root = buildOverlay(opts.subtitle);
    document.body.appendChild(state.root);
    state.mounted = true;
    try { document.body.style.overflow = 'hidden'; } catch (e) {}

    load(orderId, deliveryId);
  }

  function close() {
    if (state.sub && state.sub.close) { try { state.sub.close(); } catch (e) {} }
    state.sub = null;
    if (state._raf) { try { cancelAnimationFrame(state._raf); } catch (e) {} state._raf = null; }
    if (state.map && state.map.remove) { try { state.map.remove(); } catch (e) {} }
    state.map = null;
    state._ml = null;
    state.driverMarker = null;
    state.destMarker = null;
    state.driverPos = null;
    state._driverHeading = null;
    state.destGeocoded = null;
    state._userMovedMap = false;
    state._styleOk = false;
    if (state.root && state.root.parentNode) state.root.parentNode.removeChild(state.root);
    state.root = null;
    state.mounted = false;
    state.delivery = null;
    state.deliveryId = null;
    try { document.body.style.overflow = ''; } catch (e) {}
  }

  // --------------------------------------------------------------- rendering
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function initials(name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0).toUpperCase(); }).join('') || '?'; }
  function fmtTime(at) { try { return new Date(at).toLocaleString(); } catch (e) { return ''; } }
  function digitsOnly(p) { return String(p || '').replace(/[^\d]/g, ''); }

  function setPill(text, kind) {
    var el = q('[data-dt-pill]'); if (!el) return;
    el.textContent = text;
    el.className = 'dt-pill' + (kind ? ' ' + kind : '');
  }
  function setSubtitle(text) { var el = q('.dt-sub'); if (el) el.textContent = text; }

  function renderError(msg) {
    var el = q('[data-dt-error]'); if (!el) return;
    el.textContent = msg; el.hidden = false;
  }

  function statusKind(status) {
    if (status === 'delivered') return 'ok';
    if (status === 'failed' || status === 'cancelled') return 'bad';
    return '';
  }

  function labelFor(status) {
    if (status === 'failed') return 'Delivery attempt failed';
    if (status === 'cancelled') return 'Delivery cancelled';
    var i = STEP_INDEX[status];
    return i != null ? STEPS[i].label : status;
  }

  function renderTimeline(delivery) {
    var ul = q('[data-dt-timeline]'); if (!ul) return;
    var status = delivery.status;
    var at = {};
    (delivery.timeline || []).forEach(function (e) { if (e.status && !at[e.status]) at[e.status] = e.at; });

    if (status === 'cancelled' || status === 'failed') {
      var reached = STEP_INDEX[status === 'failed' ? 'picked_up' : 'pending_assignment'];
      var rows = STEPS.slice(0, (reached || 0) + 1).map(function (s) {
        return stepRow(s.label, 'done', at[s.key]);
      });
      rows.push(stepRow(labelFor(status), 'bad', at[status]));
      ul.innerHTML = rows.join('');
      return;
    }

    var current = STEP_INDEX[status];
    if (current == null) current = 0;
    ul.innerHTML = STEPS.map(function (s, i) {
      var cls = i < current ? 'done' : (i === current ? 'current' : 'pending');
      return stepRow(s.label, cls, at[s.key]);
    }).join('');
  }

  function stepRow(label, cls, at) {
    return '<li class="dt-step ' + cls + '">' +
      '<span class="dt-dot"></span>' +
      '<div class="dt-step-label">' + esc(label) + '</div>' +
      (at ? '<div class="dt-step-at">' + esc(fmtTime(at)) + '</div>' : '') +
      '</li>';
  }

  function renderEta(delivery) {
    var el = q('[data-dt-eta]'); if (!el) return;
    if (delivery.etaMinutes == null) { el.hidden = true; return; }
    var dist = delivery.distanceKm != null ? ' <span>· ' + esc(delivery.distanceKm) + ' km away</span>' : '';
    el.innerHTML = '<b>' + esc(delivery.etaMinutes) + ' min</b>' + dist;
    el.hidden = false;
  }

  function renderDriver(delivery) {
    var el = q('[data-dt-driver]'); if (!el) return;
    var d = delivery.driver;
    if (!d || !d.name) { el.hidden = true; return; }
    var wa = digitsOnly(d.phone);
    el.innerHTML =
      '<div class="dt-avatar">' + esc(initials(d.name)) + '</div>' +
      '<div class="dt-dn"><b>' + esc(d.name) + '</b><span>Your rider' + (d.phone ? ' · ' + esc(d.phone) : '') + '</span></div>' +
      '<div class="dt-actions">' +
        (d.phone ? '<a href="tel:' + esc(d.phone) + '" aria-label="Call rider"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg></a>' : '') +
        (wa ? '<a class="wa" href="https://wa.me/' + esc(wa) + '" target="_blank" rel="noopener" aria-label="WhatsApp rider"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 1 1-4.1 14.9l-.3-.2-2.8.8.8-2.7-.2-.3A8 8 0 0 1 12 4zm4.6 10.3c-.2-.1-1.4-.7-1.6-.8-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.5 6.5 0 0 1-3.2-2.8c-.1-.2 0-.4.1-.5l.4-.5.2-.4v-.4l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.5a1 1 0 0 0-.7.3c-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.8 2.8 4.4 3.8 1.6.6 2.2.7 3 .6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.3-.2z"/></svg></a>' : '') +
      '</div>';
    el.hidden = false;
  }

  function renderCode(codeData) {
    var el = q('[data-dt-code]'); if (!el) return;
    if (!codeData || !codeData.code) { el.hidden = true; return; }
    var left = codeData.attemptsRemaining != null
      ? esc(codeData.attemptsRemaining) + ' attempt' + (codeData.attemptsRemaining === 1 ? '' : 's') + ' left · keep it private'
      : 'Give this code to your rider to confirm the handover';
    el.innerHTML =
      '<div class="dt-code-label">Handover code</div>' +
      '<div class="dt-code-digits">' + esc(codeData.code) + '</div>' +
      '<div class="dt-code-hint">' + left + '</div>';
    el.hidden = false;
  }
  function hideCode() { var el = q('[data-dt-code]'); if (el) el.hidden = true; }

  function applyDelivery(d) {
    state.delivery = d;
    setSubtitle(d.orderNumber ? 'Order ' + d.orderNumber : (d.orderId ? 'Order ' + d.orderId : ''));
    setPill(labelFor(d.status).toUpperCase(), statusKind(d.status));
    renderTimeline(d);
    renderEta(d);
    renderDriver(d);
    if (typeof updateMap === 'function') updateMap(d);
  }

  // --------------------------------------------------------------- data load
  async function load(orderId, deliveryId) {
    if (!window.deliveryApi) { renderError('Delivery service is not available.'); return; }
    try {
      var res = deliveryId
        ? await window.deliveryApi.get(deliveryId)
        : await window.deliveryApi.getByOrder(orderId);
      var d = res.delivery;
      if (!d) { renderError('No delivery found for this order yet.'); setPill('NO DELIVERY', 'bad'); return; }
      state.deliveryId = d.id;
      if (typeof initMap === 'function') initMap(d);
      applyDelivery(d);
      loadCode(d);
      if (typeof startLive === 'function') startLive(d.id);
    } catch (err) {
      renderError(err && err.status === 404 ? 'No delivery found for this order yet.' : ((err && err.message) || 'Could not load tracking.'));
      setPill('UNAVAILABLE', 'bad');
    }
  }

  async function loadCode(d) {
    if (!window.deliveryApi.getCode) return hideCode();
    if (['accepted', 'picked_up', 'arrived'].indexOf(d.status) === -1) return hideCode();
    try {
      var c = await window.deliveryApi.getCode(d.id);
      renderCode(c);
    } catch (e) {
      hideCode(); // 403 for non-buyers, or not in a code-bearing state
    }
  }

  // --------------------------------------------------------------- map
  function loadMapLibre() {
    return new Promise(function (resolve, reject) {
      if (window.maplibregl) return resolve(window.maplibregl);
      if (!document.getElementById('loumoo-dt-maplibre-css')) {
        var link = document.createElement('link');
        link.id = 'loumoo-dt-maplibre-css'; link.rel = 'stylesheet'; link.href = MAPLIBRE_CSS;
        document.head.appendChild(link);
      }
      var existing = document.getElementById('loumoo-dt-maplibre-js');
      if (existing) {
        existing.addEventListener('load', function () { window.maplibregl ? resolve(window.maplibregl) : reject(new Error('maplibre missing')); });
        existing.addEventListener('error', function () { reject(new Error('maplibre failed')); });
        return;
      }
      var s = document.createElement('script');
      s.id = 'loumoo-dt-maplibre-js'; s.src = MAPLIBRE_JS; s.async = true;
      s.onload = function () { window.maplibregl ? resolve(window.maplibregl) : reject(new Error('maplibre missing')); };
      s.onerror = function () { reject(new Error('maplibre failed to load')); };
      document.head.appendChild(s);
    });
  }

  function riderMarkerEl() {
    var el = document.createElement('div');
    el.style.cssText = 'width:36px;height:36px';
    // A filled disc with a north-pointing arrow; the marker is rotated to the heading.
    el.innerHTML =
      '<svg width="36" height="36" viewBox="0 0 36 36">' +
      '<circle cx="18" cy="18" r="11" fill="#3245ff" stroke="#fff" stroke-width="3"/>' +
      '<path d="M18 10 L23 22 L18 19 L13 22 Z" fill="#fff"/></svg>';
    return el;
  }

  function destMarkerEl() {
    var el = document.createElement('div');
    el.style.cssText = 'width:30px;height:38px';
    el.innerHTML =
      '<svg width="30" height="38" viewBox="0 0 30 38">' +
      '<path d="M15 1C7.8 1 2 6.8 2 14c0 9 13 23 13 23s13-14 13-23C28 6.8 22.2 1 15 1z" fill="#1a9d4b" stroke="#fff" stroke-width="2"/>' +
      '<circle cx="15" cy="14" r="5" fill="#fff"/></svg>';
    return el;
  }

  function destCoords(d) {
    return (d && d.dropoff && d.dropoff.location) || state.destGeocoded || null;
  }

  function initMap(d) {
    var container = q('[data-dt-map]');
    var msg = q('[data-dt-mapmsg]');
    if (!container) return;
    loadMapLibre().then(function (ml) {
      if (!state.mounted || state.map) return;
      state._ml = ml;
      var start = d.lastLocation || destCoords(d) || DOUALA;
      var mapDiv = document.createElement('div');
      mapDiv.style.cssText = 'position:absolute;inset:0';
      container.appendChild(mapDiv);
      state.map = new ml.Map({ container: mapDiv, style: mapStyle(), center: [start.lng, start.lat], zoom: 13, attributionControl: true });
      state.map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      addRecenterControl(ml);

      // Add markers + route when the STYLE SPEC is parsed ('style.load'), NOT when
      // every tile has loaded ('load') — isStyleLoaded() waits for source tiles, so
      // keying off it wrongly reported "not loaded" on slow links and churned styles.
      var chosenStyle = mapStyle();
      function onStyleLoad() {
        state._styleOk = true;
        if (msg) msg.style.display = 'none';
        ensureRoute();
        updateMap(state.delivery || d);
      }
      state.map.on('style.load', onStyleLoad);
      state.map.on('load', function () { if (msg) msg.style.display = 'none'; });
      // Only count genuine user gestures as "took control" of the camera.
      state.map.on('dragstart', function () { state._userMovedMap = true; });
      state.map.on('zoomstart', function (e) { if (e && e.originalEvent) state._userMovedMap = true; });
      state.map.on('error', function () { /* individual tile/glyph errors are non-fatal */ });
      // A URL style can fail to fetch; the default inline raster style cannot. Only
      // arm the demo fallback for a URL style that has not parsed in time.
      if (typeof chosenStyle === 'string' && chosenStyle !== DEMO_STYLE) {
        setTimeout(function () {
          if (state.map && !state._styleOk) { try { state.map.setStyle(DEMO_STYLE); } catch (e) {} }
        }, 15000);
      }

      geocodeDestIfNeeded(d);
    }).catch(function () {
      if (msg) msg.textContent = 'Live map unavailable. The status and ETA below are up to date.';
    });
  }

  function ensureRoute() {
    var map = state.map;
    if (!map || map.getSource('dt-route')) return;
    try {
      map.addSource('dt-route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
      map.addLayer({
        id: 'dt-route', type: 'line', source: 'dt-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#3245ff', 'line-width': 4, 'line-opacity': 0.55, 'line-dasharray': [2, 1.5] }
      });
    } catch (e) { /* style not ready */ }
  }

  function setRoute(a, b) {
    var map = state.map;
    if (!map) return;
    var src = map.getSource && map.getSource('dt-route');
    if (!src) return;
    src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] } });
  }

  function addRecenterControl(ml) {
    function Ctrl() {}
    Ctrl.prototype.onAdd = function () {
      var d = document.createElement('div');
      d.className = 'maplibregl-ctrl maplibregl-ctrl-group';
      var b = document.createElement('button');
      b.type = 'button'; b.title = 'Recenter';
      b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin:5px auto;display:block"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
      b.addEventListener('click', function () { state._userMovedMap = false; fitBoth(true); });
      d.appendChild(b); this._c = d; return d;
    };
    Ctrl.prototype.onRemove = function () { if (this._c && this._c.parentNode) this._c.parentNode.removeChild(this._c); };
    try { state.map.addControl(new Ctrl(), 'top-right'); } catch (e) {}
  }

  function fitBoth(animate) {
    var map = state.map, ml = state._ml, d = state.delivery;
    if (!map || !ml || !d) return;
    var pts = [];
    var dest = destCoords(d);
    if (dest) pts.push([dest.lng, dest.lat]);
    if (d.lastLocation) pts.push([d.lastLocation.lng, d.lastLocation.lat]);
    try {
      if (pts.length === 2) {
        var bounds = new ml.LngLatBounds(pts[0], pts[0]);
        pts.forEach(function (p) { bounds.extend(p); });
        map.fitBounds(bounds, { padding: { top: 56, bottom: 48, left: 40, right: 40 }, maxZoom: 16, duration: animate ? 600 : 0 });
      } else if (pts.length === 1) {
        map.easeTo({ center: pts[0], zoom: 15, duration: animate ? 600 : 0 });
      }
    } catch (e) { /* not ready */ }
  }

  function animateDriver(target, heading) {
    var ml = state._ml;
    if (!state.map || !ml) return;
    if (heading != null && isFinite(heading)) state._driverHeading = heading;
    if (!state.driverMarker) {
      state.driverMarker = new ml.Marker({ element: riderMarkerEl(), rotationAlignment: 'map' }).setLngLat([target.lng, target.lat]).addTo(state.map);
      state.driverPos = { lng: target.lng, lat: target.lat };
      if (state._driverHeading != null) state.driverMarker.setRotation(state._driverHeading);
      return;
    }
    if (state._driverHeading != null) state.driverMarker.setRotation(state._driverHeading);
    var from = state.driverPos || target;
    var dur = 700, start = null;
    if (state._raf) cancelAnimationFrame(state._raf);
    function frame(ts) {
      if (!start) start = ts;
      var t = Math.min(1, (ts - start) / dur);
      var lng = from.lng + (target.lng - from.lng) * t;
      var lat = from.lat + (target.lat - from.lat) * t;
      state.driverMarker.setLngLat([lng, lat]);
      state.driverPos = { lng: lng, lat: lat };
      if (t < 1) state._raf = requestAnimationFrame(frame);
    }
    state._raf = requestAnimationFrame(frame);
  }

  function geocodeDestIfNeeded(d) {
    if (destCoords(d)) return;
    var addr = d && d.dropoff && (d.dropoff.address || d.dropoff.area);
    if (!addr) return;
    try {
      fetch(GEOCODER + encodeURIComponent(addr), { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (arr) {
          if (!arr || !arr.length || !state.mounted) return;
          var lat = parseFloat(arr[0].lat), lng = parseFloat(arr[0].lon);
          if (isFinite(lat) && isFinite(lng)) { state.destGeocoded = { lat: lat, lng: lng }; updateMap(state.delivery || d); }
        })
        .catch(function () {});
    } catch (e) {}
  }

  function updateMap(d) {
    if (!state.map || !state._ml || !d) return;
    var dest = destCoords(d);
    if (dest) {
      if (!state.destMarker) state.destMarker = new state._ml.Marker({ element: destMarkerEl(), anchor: 'bottom' }).setLngLat([dest.lng, dest.lat]).addTo(state.map);
      else state.destMarker.setLngLat([dest.lng, dest.lat]);
    }
    if (d.lastLocation) animateDriver(d.lastLocation, d.lastLocation.heading != null ? d.lastLocation.heading : null);
    if (dest && d.lastLocation) setRoute(d.lastLocation, dest);
    if (!state._userMovedMap) fitBoth(true);
  }

  // --------------------------------------------------------------- live feed
  function startLive(id) {
    if (!window.deliveryApi || !window.deliveryApi.subscribe) return;
    state.sub = window.deliveryApi.subscribe(id, {
      onStatus: function (evt) {
        if (!state.delivery || !evt) return;
        var changed = state.delivery.status !== evt.status;
        state.delivery.status = evt.status;
        if (evt.etaMinutes !== undefined) state.delivery.etaMinutes = evt.etaMinutes;
        if (evt.distanceKm !== undefined) state.delivery.distanceKm = evt.distanceKm;
        setPill(labelFor(evt.status).toUpperCase(), statusKind(evt.status));
        renderTimeline(state.delivery);
        renderEta(state.delivery);
        // On a real transition, re-read the full record so the rider card,
        // drop-off and handover code reflect the new phase.
        if (changed) refreshDelivery();
      },
      onLocation: function (loc) {
        if (!state.delivery || !loc) return;
        state.delivery.lastLocation = loc;
        updateMap(state.delivery);
      },
      onEta: function (evt) {
        if (!state.delivery || !evt) return;
        if (evt.etaMinutes !== undefined) state.delivery.etaMinutes = evt.etaMinutes;
        if (evt.distanceKm !== undefined) state.delivery.distanceKm = evt.distanceKm;
        renderEta(state.delivery);
      },
      onEnd: function (reason) {
        if (reason === 'access_revoked') renderError('You no longer have access to this delivery.');
        refreshDelivery(); // settle on the final state (delivered / cancelled)
      },
      onError: function () { /* transient — the feed reconnects or falls back to polling */ }
    });
  }

  async function refreshDelivery() {
    if (!state.deliveryId || !window.deliveryApi) return;
    try {
      var res = await window.deliveryApi.get(state.deliveryId);
      if (res && res.delivery && state.mounted) {
        applyDelivery(res.delivery);
        loadCode(res.delivery);
      }
    } catch (e) { /* ignore; the live feed keeps trying */ }
  }

  // --------------------------------------------------------------- triggers
  // Any element with [data-track-delivery] opens the overlay when clicked, using
  // its data-order-id / data-delivery-id. This needs no DC event binding, so a
  // screen template can add a plain button without touching the app root:
  //   <button data-track-delivery data-order-id="{{ currentOrder.id }}">Track delivery</button>
  function onDocClick(e) {
    var trigger = e.target && e.target.closest ? e.target.closest('[data-track-delivery]') : null;
    if (!trigger) return;
    e.preventDefault();
    open({
      orderId: trigger.getAttribute('data-order-id') || null,
      deliveryId: trigger.getAttribute('data-delivery-id') || null
    });
  }
  document.addEventListener('click', onDocClick);

  // Close on Escape, for parity with a back gesture.
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.mounted) close(); });

  window.LoumooDeliveryTracking = { open: open, close: close, _state: state };
})();
