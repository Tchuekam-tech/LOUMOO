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

    // load() and map init are added in the next commits.
    if (typeof load === 'function') load(orderId, deliveryId);
  }

  function close() {
    if (state.sub && state.sub.close) { try { state.sub.close(); } catch (e) {} }
    state.sub = null;
    if (state.map && state.map.remove) { try { state.map.remove(); } catch (e) {} }
    state.map = null;
    state.driverMarker = null;
    state.destMarker = null;
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

  function markerEl(color) {
    var el = document.createElement('div');
    el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:' + color + ';border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)';
    return el;
  }

  function initMap(d) {
    var container = q('[data-dt-map]');
    var msg = q('[data-dt-mapmsg]');
    if (!container) return;
    loadMapLibre().then(function (ml) {
      if (!state.mounted || state.map) return;
      var dest = d.dropoff && d.dropoff.location;
      var center = d.lastLocation || dest || DOUALA;
      var mapDiv = document.createElement('div');
      mapDiv.style.cssText = 'position:absolute;inset:0';
      container.appendChild(mapDiv);
      state._ml = ml;
      state.map = new ml.Map({
        container: mapDiv,
        style: window.LOUMOO_MAP_STYLE || DEMO_STYLE,
        center: [center.lng, center.lat],
        zoom: 12
      });
      state.map.on('load', function () {
        if (msg) msg.style.display = 'none';
        updateMap(state.delivery || d);
      });
      state.map.on('error', function () { /* tile errors are non-fatal */ });
    }).catch(function () {
      if (msg) msg.textContent = 'Live map unavailable. The status and ETA below are up to date.';
    });
  }

  function updateMap(d) {
    if (!state.map || !state._ml || !d) return;
    var ml = state._ml;
    var pts = [];
    var dest = d.dropoff && d.dropoff.location;
    if (dest) {
      if (!state.destMarker) state.destMarker = new ml.Marker({ element: markerEl('#1a9d4b') }).setLngLat([dest.lng, dest.lat]).addTo(state.map);
      pts.push([dest.lng, dest.lat]);
    }
    if (d.lastLocation) {
      if (!state.driverMarker) state.driverMarker = new ml.Marker({ element: markerEl('#3245ff') }).setLngLat([d.lastLocation.lng, d.lastLocation.lat]).addTo(state.map);
      else state.driverMarker.setLngLat([d.lastLocation.lng, d.lastLocation.lat]);
      pts.push([d.lastLocation.lng, d.lastLocation.lat]);
    }
    try {
      if (pts.length === 2) {
        var b = new ml.LngLatBounds(pts[0], pts[0]);
        pts.forEach(function (p) { b.extend(p); });
        state.map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 500 });
      } else if (pts.length === 1) {
        state.map.easeTo({ center: pts[0], zoom: 14, duration: 500 });
      }
    } catch (e) { /* map not ready yet */ }
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

