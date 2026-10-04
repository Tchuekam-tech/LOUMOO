/**
 * LOUMOO Rider Hub
 * ---------------------------------------------------------------------------
 * The rider's side of a delivery, one job at a time:
 *   - an inbox of new offers (each with a live countdown, Accept / Decline) and
 *     jobs in progress;
 *   - a job screen that walks the rider through it: head to pickup, confirm
 *     pickup, deliver, arrive, then take the customer's 4-digit handover code;
 *     with a map, turn-by-turn hand-off to Google Maps, call / WhatsApp, and
 *     "report a problem" or "release this job";
 *   - live location sharing while a job is open on screen (the contract's rule:
 *     no background tracking), with the state shown plainly.
 * Accounts that are not riders get a clear "how to become one" screen with their
 * account ID to give the LOUMOO team.
 *
 * Backed by window.deliveryApi (docs/DELIVERY_API.md v1.2), drawn with
 * window.LoumooDispatchUI.
 *
 *   <button data-open-rider-hub>Deliver with LOUMOO</button>
 *   window.LoumooRiderHub.open()
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var REFRESH_MS = 15000;
  var GPS_MIN_INTERVAL_MS = 6000;   // the server throttles at 3 s; stay well clear
  var GPS_MIN_MOVE_M = 25;          // ...unless the rider actually moved
  var GPS_MAX_ACCURACY_M = 200;     // the server refuses worse fixes
  var ACTIVE = ['accepted', 'picked_up', 'arrived'];

  var MAPLIBRE_JS = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.js';
  var MAPLIBRE_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.css';
  var ESRI_TILES = ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'];

  function UI() { return window.LoumooDispatchUI; }
  function API() { return window.deliveryApi; }
  function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || name; }

  // ------------------------------------------------------------------ entry
  function open() {
    var ui = UI(), api = API();
    if (!ui || !api) { console.warn('[RiderHub] the UI kit or the delivery API is missing'); return null; }
    var nav = ui.openStack({ label: 'Rider deliveries' });
    nav.push(inboxView(nav));
    return nav;
  }

  // ------------------------------------------------------------------ inbox
  function inboxView(nav) {
    return {
      title: 'Your deliveries',
      render: function (page) {
        var ui = UI(), api = API();
        var data = null, rings = [], sig = null, painted = false;
        page.setRight([{ icon: 'refresh', label: 'Refresh', onClick: function () { load(true); } }]);
        var body = document.createElement('div');
        page.content.appendChild(body);
        body.appendChild(ui.skeletonList(3));

        function stopRings() { rings.forEach(function (r) { r.stop(); }); rings = []; }

        function load(manual) {
          return api.riderOverview().then(function (res) {
            if (!page.alive) return;
            data = res;
            page.setTitle('Your deliveries', 'Hi ' + firstName(res.driver && res.driver.name) + ' — here’s your work.');
            // Redraw only when the jobs changed: a background refresh must not
            // rebuild the cards under the rider's thumb (countdowns tick on their own).
            var next = JSON.stringify(res.deliveries || []);
            if (next !== sig) { sig = next; draw(); }
            if (manual) ui.toast('Up to date', { tone: 'info', duration: 1400 });
          }).catch(function (err) {
            if (!page.alive) return;
            if (err && err.status === 403) return notRider();
            if (!data) { body.innerHTML = ''; body.appendChild(ui.errorState(ui.errorMessage(err), function () { body.innerHTML = ''; body.appendChild(ui.skeletonList(3)); load(); })); }
            else if (manual) ui.toast(ui.errorMessage(err), { tone: 'error' });
          });
        }

        function notRider() {
          stopRings();
          page.setRight([]);
          body.innerHTML = '';
          var empty = ui.emptyState({ icon: 'scooter', title: 'Deliver with LOUMOO', body: 'Riders are added by the LOUMOO team. Share your account ID with them to get started.' });
          var idBox = ui.h('<div style="margin-top:20px;display:flex;flex-direction:column;align-items:center;gap:10px"><span class="ldx-chip" style="font-family:var(--font-mono,ui-monospace,monospace);max-width:100%;overflow:hidden;text-overflow:ellipsis">Loading your ID…</span></div>');
          empty.appendChild(idBox);
          body.appendChild(empty);
          api.whoAmI().then(function (id) {
            var chip = idBox.querySelector('.ldx-chip');
            if (!id) { chip.textContent = 'Sign in to see your account ID'; return; }
            chip.textContent = id;
            var copy = ui.button({ label: 'Copy account ID', icon: 'copy', kind: 'tinted', size: 'small' });
            copy.addEventListener('click', function () {
              var done = function () { ui.toast('Account ID copied'); };
              try { navigator.clipboard.writeText(id).then(done, function () { ui.toast(id, { tone: 'info', duration: 6000 }); }); }
              catch (e) { ui.toast(id, { tone: 'info', duration: 6000 }); }
            });
            idBox.appendChild(copy);
          });
        }

        function draw() {
          stopRings();
          body.innerHTML = '';
          var jobs = (data && data.deliveries) || [];
          var offers = jobs.filter(function (d) { return d.status === 'assigned'; });
          var active = jobs.filter(function (d) { return ACTIVE.indexOf(d.status) !== -1; });
          if (!offers.length && !active.length) {
            body.appendChild(ui.emptyState({ icon: 'inbox', title: 'No deliveries right now', body: 'New offers appear here as soon as a seller sends one. Keep this screen open to see them arrive.' }));
            return;
          }
          if (offers.length) {
            var sec = ui.h('<section class="ldx-section"><div class="ldx-section-head"><h2>New offers</h2><span class="ldx-count"></span></div></section>');
            sec.querySelector('.ldx-count').textContent = String(offers.length);
            offers.forEach(function (d) { sec.appendChild(offerCard(d)); });
            body.appendChild(sec);
          }
          if (active.length) {
            var s2 = ui.section('In progress', { count: active.length });
            active.forEach(function (d) { s2.group.appendChild(activeRow(d)); });
            body.appendChild(s2);
          }
          painted = true;
        }

        function offerCard(d) {
          var dist = ui.km(d.pickup && d.pickup.location, d.dropoff && d.dropoff.location);
          var card = ui.h(
            '<div class="ldx-card' + (painted ? '' : ' ldx-fade-in') + '" style="padding:16px">' +
              '<button class="ldx-row no-sep" style="padding:0;min-height:0;gap:14px;align-items:flex-start;background:transparent">' +
                '<span class="ldx-ring-slot"></span>' +
                '<span class="ldx-row-main">' +
                  '<div class="ldx-row-title" data-pickup></div>' +
                  '<div class="ldx-row-sub is-wrap" data-route></div>' +
                  '<div class="ldx-meta" data-meta></div>' +
                '</span>' +
              '</button>' +
              '<div class="ldx-btn-row" style="margin-top:16px"></div>' +
            '</div>'
          );
          card.querySelector('[data-pickup]').textContent = 'Pick up at ' + ((d.pickup && d.pickup.label) || 'the shop');
          card.querySelector('[data-route]').textContent = 'Deliver to ' + ((d.dropoff && d.dropoff.area) || 'the customer’s area');
          var meta = [];
          if (dist != null) meta.push('<span>' + ui.icon('navigate', 15) + '≈ ' + (dist < 1 ? Math.round(dist * 1000) + ' m' : dist.toFixed(1) + ' km') + '</span>');
          if (d.orderNumber) meta.push('<span>' + ui.icon('package', 15) + ui.esc(d.orderNumber) + '</span>');
          card.querySelector('[data-meta]').innerHTML = meta.join('');
          if (d.offerExpiresAt) {
            var ring = ui.countdown(d.offerExpiresAt, { onExpire: function () { card.style.opacity = '.5'; setTimeout(function () { load(); }, 900); } });
            rings.push(ring);
            card.querySelector('.ldx-ring-slot').appendChild(ring.el);
          } else {
            card.querySelector('.ldx-ring-slot').innerHTML = '<span class="ldx-tile ldx-tone-accent">' + ui.icon('package', 22) + '</span>';
          }
          card.querySelector('button.ldx-row').addEventListener('click', function () { nav.push(jobView(nav, d)); });
          var btns = card.querySelector('.ldx-btn-row');
          var decline = ui.button({ label: 'Decline', kind: 'gray', size: 'medium' });
          var accept = ui.button({ label: 'Accept', size: 'medium' });
          decline.addEventListener('click', function () { declineOffer(d, decline).then(function (ok) { if (ok) load(); }); });
          accept.addEventListener('click', function () {
            ui.busy(accept, function () {
              return acceptOffer(d).then(function (accepted) { if (accepted) nav.push(jobView(nav, accepted)); load(); });
            });
          });
          btns.appendChild(decline);
          btns.appendChild(accept);
          return card;
        }

        function activeRow(d) {
          var step = d.status === 'accepted' ? 'Pick up at ' + ((d.pickup && d.pickup.label) || 'the shop') : 'Deliver to ' + ((d.dropoff && (d.dropoff.label || d.dropoff.area)) || 'the customer');
          var el = ui.h('<button class="ldx-row" style="--ldx-inset:68px"><span class="ldx-tile ldx-tone-accent">' + ui.icon(d.status === 'accepted' ? 'store' : 'scooter', 22) + '</span><span class="ldx-row-main"><div class="ldx-row-title"></div><div class="ldx-row-status ldx-tone-accent"></div><div class="ldx-row-meta"></div></span><span class="ldx-row-end">' + ui.icon('forward', 18) + '</span></button>');
          el.querySelector('.ldx-row-title').textContent = step;
          el.querySelector('.ldx-row-status').textContent = d.status === 'accepted' ? 'Next: confirm pickup' : d.status === 'picked_up' ? 'Next: mark your arrival' : 'Next: take the handover code';
          el.querySelector('.ldx-row-meta').textContent = [(d.dropoff && d.dropoff.address) || (d.dropoff && d.dropoff.area), d.orderNumber].filter(Boolean).join(' · ');
          el.addEventListener('click', function () { nav.push(jobView(nav, d)); });
          return el;
        }

        var interval = setInterval(function () { if (page.alive && !document.hidden && nav.depth === 1) load(false); }, REFRESH_MS);
        function onVisible() { if (!document.hidden && page.alive) load(false); }
        document.addEventListener('visibilitychange', onVisible);
        page.reload = function () { load(false); };
        load(false);
        return function cleanup() { clearInterval(interval); stopRings(); document.removeEventListener('visibilitychange', onVisible); };
      },
      onResume: function (page) { if (page.reload) page.reload(); }
    };
  }

  function acceptOffer(d) {
    var ui = UI();
    return API().accept(d.id).then(function (res) {
      ui.toast('Accepted — head to ' + ((res.delivery && res.delivery.pickup && res.delivery.pickup.label) || 'the pickup'));
      return res.delivery;
    }).catch(function (err) {
      ui.toast(ui.errorMessage(err), { tone: 'error' });
      return null;
    });
  }

  function declineOffer(d, btn) {
    var ui = UI();
    return ui.confirm({
      title: d.status === 'accepted' ? 'Release this job?' : 'Decline this offer?',
      message: d.status === 'accepted'
        ? 'It goes back to the seller to offer someone else. Only do this if you can’t collect it.'
        : 'The seller will offer it to another rider.',
      confirmLabel: d.status === 'accepted' ? 'Release job' : 'Decline',
      destructive: true
    }).then(function (yes) {
      if (!yes) return false;
      return ui.busy(btn, function () {
        return API().decline(d.id).then(function () {
          ui.toast(d.status === 'accepted' ? 'Job released' : 'Offer declined');
          return true;
        }).catch(function (err) { ui.toast(ui.errorMessage(err), { tone: 'error' }); return false; });
      }).then(function (v) { return v === true; });
    });
  }

  // -------------------------------------------------------------------- map
  function loadMapLibre() {
    return new Promise(function (resolve, reject) {
      if (window.maplibregl) return resolve(window.maplibregl);
      if (!document.getElementById('loumoo-dt-maplibre-css')) {
        var link = document.createElement('link');
        link.id = 'loumoo-dt-maplibre-css'; link.rel = 'stylesheet'; link.href = MAPLIBRE_CSS;
        document.head.appendChild(link);
      }
      var existing = document.getElementById('loumoo-dt-maplibre-js'); // shared with the tracking overlay
      var onLoad = function () { window.maplibregl ? resolve(window.maplibregl) : reject(new Error('maplibre missing')); };
      if (existing) { existing.addEventListener('load', onLoad); existing.addEventListener('error', function () { reject(new Error('maplibre failed')); }); return; }
      var s = document.createElement('script');
      s.id = 'loumoo-dt-maplibre-js'; s.src = MAPLIBRE_JS; s.async = true;
      s.onload = onLoad;
      s.onerror = function () { reject(new Error('maplibre failed to load')); };
      document.head.appendChild(s);
    });
  }
  function mapStyle() {
    if (window.LOUMOO_MAP_STYLE) return window.LOUMOO_MAP_STYLE;
    return { version: 8, sources: { basemap: { type: 'raster', tiles: ESRI_TILES, tileSize: 256, attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors' } }, layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }] };
  }
  function markerEl(kind) {
    var el = document.createElement('div');
    if (kind === 'rider') {
      el.style.cssText = 'width:22px;height:22px;border-radius:50%;background:#007aff;border:3px solid #fff;box-shadow:0 0 0 6px rgba(0,122,255,.22),0 2px 6px rgba(0,0,0,.3)';
    } else if (kind === 'area') {
      el.style.cssText = 'width:96px;height:96px;border-radius:50%;background:rgba(0,122,255,.14);border:2px dashed rgba(0,122,255,.55)';
      el.title = 'Approximate area';
    } else {
      var color = kind === 'pickup' ? '#111214' : '#007aff';
      var glyph = kind === 'pickup'
        ? '<path d="M4 9l1.5-5h13L20 9"/><path d="M5 13.5V20h14v-6.5"/><path d="M4 9h16v2a3 3 0 0 1-8 0 3 3 0 0 1-8 0z"/>'
        : '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>';
      el.innerHTML = '<svg width="38" height="46" viewBox="0 0 38 46"><path d="M19 1C9.6 1 2 8.6 2 18c0 11.6 17 27 17 27s17-15.4 17-27C36 8.6 28.4 1 19 1z" fill="' + color + '" stroke="#fff" stroke-width="2"/><g transform="translate(9 8)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + glyph + '</g></svg>';
      el.style.cssText = 'width:38px;height:46px';
    }
    return el;
  }

  /** A small map card for a job. Returns { el, setRider(loc), update(delivery), destroy() }. */
  function jobMap(delivery) {
    var ui = UI();
    var el = ui.h('<div class="ldx-card" style="padding:0;overflow:hidden;position:relative;height:210px;background:var(--ldx-fill)"><div data-map style="position:absolute;inset:0"></div><div data-msg style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:500 14px/1.3 var(--ldx-font);color:var(--ldx-text-3)">Loading map…</div></div>');
    var map = null, ml = null, markers = {}, alive = true, current = delivery, riderLoc = null;
    function pts(d) {
      var out = [];
      if (d.pickup && d.pickup.location) out.push({ kind: 'pickup', loc: d.pickup.location });
      if (d.dropoff && d.dropoff.location) out.push({ kind: d.status === 'assigned' ? 'area' : 'dropoff', loc: d.dropoff.location });
      return out;
    }
    function place() {
      if (!map || !ml) return;
      var want = pts(current);
      ['pickup', 'dropoff', 'area'].forEach(function (k) {
        var p = want.find(function (x) { return x.kind === k; });
        if (!p && markers[k]) { markers[k].remove(); delete markers[k]; }
        if (p) {
          if (!markers[k]) markers[k] = new ml.Marker({ element: markerEl(k), anchor: k === 'area' ? 'center' : 'bottom' }).setLngLat([p.loc.lng, p.loc.lat]).addTo(map);
          else markers[k].setLngLat([p.loc.lng, p.loc.lat]);
        }
      });
      if (riderLoc) {
        if (!markers.rider) markers.rider = new ml.Marker({ element: markerEl('rider') }).setLngLat([riderLoc.lng, riderLoc.lat]).addTo(map);
        else markers.rider.setLngLat([riderLoc.lng, riderLoc.lat]);
      }
      var all = want.map(function (p) { return [p.loc.lng, p.loc.lat]; });
      if (riderLoc) all.push([riderLoc.lng, riderLoc.lat]);
      try {
        if (all.length > 1) {
          var b = new ml.LngLatBounds(all[0], all[0]);
          all.forEach(function (p) { b.extend(p); });
          map.fitBounds(b, { padding: 48, maxZoom: 15, duration: ui.reduceMotion() ? 0 : 500 });
        } else if (all.length === 1) map.easeTo({ center: all[0], zoom: 14, duration: 0 });
      } catch (e) { /* not ready */ }
    }
    var hasAny = pts(delivery).length > 0;
    if (!hasAny) {
      el.querySelector('[data-msg]').textContent = 'No map position for this job yet';
    }
    loadMapLibre().then(function (lib) {
      if (!alive) return;
      ml = lib;
      var first = pts(current)[0];
      var center = first ? [first.loc.lng, first.loc.lat] : [9.7679, 4.0511]; // Douala
      map = new ml.Map({ container: el.querySelector('[data-map]'), style: mapStyle(), center: center, zoom: 13, attributionControl: { compact: true }, interactive: true, cooperativeGestures: true });
      map.on('style.load', function () { var m = el.querySelector('[data-msg]'); if (m) m.style.display = 'none'; place(); });
      // The compact attribution opens expanded; fold it into its (i) button so it
      // doesn't cover a third of a small map (it stays one tap away). MapLibre
      // builds it when the tile source reports its credits, often long before
      // the tiles finish, so fold it then, once, rather than on 'load'.
      var folded = false;
      var fold = function () {
        if (folded) return;
        var a = el.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact');
        if (!a) return;
        a.classList.remove('maplibregl-compact-show');
        a.removeAttribute('open');
        folded = true;
      };
      map.on('styledata', fold);
      map.on('sourcedata', fold);
      map.on('load', fold);
    }).catch(function () {
      var m = el.querySelector('[data-msg]');
      if (m) m.textContent = 'Map unavailable — use “Navigate” below';
    });
    return {
      el: el,
      setRider: function (loc) { riderLoc = loc; place(); },
      update: function (d) { current = d; place(); },
      destroy: function () { alive = false; try { if (map) map.remove(); } catch (e) { /* ignore */ } map = null; }
    };
  }

  // -------------------------------------------------------------- GPS sharer
  /**
   * Shares the rider's position for one delivery while the job screen is open.
   * Calls onState('starting'|'live'|'denied'|'unavailable'|'stopped') and
   * onFix({lat,lng}) for the map.
   */
  function gpsSharer(deliveryId, onState, onFix, onGone) {
    var api = API();
    var watchId = null, lastSent = 0, lastLoc = null, inFlight = false, stopped = false;
    if (!navigator.geolocation) { onState('unavailable'); return { stop: function () {} }; }
    onState('starting');
    function meters(a, b) { var k = UI().km(a, b); return k == null ? Infinity : k * 1000; }
    watchId = navigator.geolocation.watchPosition(function (pos) {
      if (stopped) return;
      var c = pos.coords;
      var loc = { lat: c.latitude, lng: c.longitude };
      onFix(loc);
      if (c.accuracy != null && c.accuracy > GPS_MAX_ACCURACY_M) { onState('weak'); return; }
      var now = Date.now();
      if (inFlight) return;
      if (now - lastSent < GPS_MIN_INTERVAL_MS && meters(lastLoc, loc) < GPS_MIN_MOVE_M) return;
      inFlight = true;
      api.postLocation(deliveryId, {
        lat: loc.lat, lng: loc.lng,
        speedKmh: c.speed != null && isFinite(c.speed) ? c.speed * 3.6 : null,
        heading: c.heading != null && isFinite(c.heading) ? c.heading : null,
        accuracyM: c.accuracy != null ? Math.round(c.accuracy) : null
      }).then(function () {
        lastSent = Date.now(); lastLoc = loc;
        onState('live');
      }).catch(function (err) {
        if (err && (err.status === 404 || err.status === 403)) { stop(); onGone(); return; }
        // 409 (state changed), 429 (busy limiter), network: skip this point, the next one carries fresh state.
      }).finally(function () { inFlight = false; });
    }, function (err) {
      onState(err && err.code === 1 ? 'denied' : 'unavailable');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    function stop() {
      stopped = true;
      if (watchId != null) { try { navigator.geolocation.clearWatch(watchId); } catch (e) { /* ignore */ } watchId = null; }
      onState('stopped');
    }
    return { stop: stop };
  }

  // ---------------------------------------------------------------- job view
  var PHASE = {
    assigned: { title: 'New offer', step: 0 },
    accepted: { title: 'Pick up', step: 1 },
    picked_up: { title: 'Deliver', step: 2 },
    arrived: { title: 'Hand over', step: 3 },
    delivered: { title: 'Delivered', step: 4 }
  };

  function jobView(nav, initial) {
    var phase = PHASE[initial.status] || PHASE.accepted;
    return {
      title: phase.title,
      subtitle: initial.orderNumber ? 'Order ' + initial.orderNumber : null,
      render: function (page) {
        var ui = UI(), api = API();
        var d = initial, map = null, gps = null, ring = null, sub = null, gpsState = 'stopped', gone = false;

        function stopAll() {
          if (ring) { ring.stop(); ring = null; }
          if (gps) { gps.stop(); gps = null; }
          if (sub) { try { sub.close(); } catch (e) { /* ignore */ } sub = null; }
        }
        function ensureGps() {
          if (gone || ACTIVE.indexOf(d.status) === -1) { if (gps) { gps.stop(); gps = null; } return; }
          if (gps) return;
          gps = gpsSharer(d.id, function (s) { gpsState = s; drawGpsChip(); }, function (loc) { if (map) map.setRider(loc); }, function () { removed(); });
        }
        function ensureLive() {
          if (sub || !api.subscribe || gone) return;
          sub = api.subscribe(d.id, {
            onStatus: function (evt) { if (evt && evt.status !== d.status) refresh(); },
            onEnd: function (reason) { if (reason === 'access_revoked') removed(); else refresh(); }
          });
        }
        function refresh() {
          return api.get(d.id).then(function (res) {
            if (!page.alive || !res || !res.delivery) return;
            var changed = res.delivery.status !== d.status;
            d = res.delivery;
            if (changed) draw(); else if (map) map.update(d);
          }).catch(function (err) { if (err && (err.status === 404 || err.status === 403)) removed(); });
        }
        function removed() {
          if (gone) return;
          gone = true;
          stopAll();
          if (map) { map.destroy(); map = null; }
          page.setTitle('Not yours anymore');
          page.content.innerHTML = '';
          page.footer.innerHTML = '';
          page.content.appendChild(ui.emptyState({ icon: 'alert', tone: 'muted', title: 'This job is no longer yours', body: 'The seller cancelled it, offered it to someone else, or the offer ran out of time.', actionLabel: 'Back to deliveries', actionKind: 'filled', onAction: function () { nav.pop(); } }));
        }

        var gpsChipHost = null;
        function drawGpsChip() {
          if (!gpsChipHost) return;
          var map2 = {
            starting: ['ldx-chip', 'location', 'Finding your location…'],
            live: ['ldx-chip is-live', null, 'Sharing live location'],
            weak: ['ldx-chip is-warn', 'location', 'Weak GPS signal — move into the open'],
            denied: ['ldx-chip is-warn', 'location', 'Location is off — the customer can’t follow you'],
            unavailable: ['ldx-chip is-warn', 'location', 'Location unavailable on this device'],
            stopped: null
          };
          var v = map2[gpsState];
          gpsChipHost.innerHTML = '';
          if (!v) return;
          gpsChipHost.innerHTML = '<span class="' + v[0] + '">' + (v[1] ? ui.icon(v[1], 15) : '<span class="ldx-pulse"></span>') + ui.esc(v[2]) + '</span>';
        }

        function draw() {
          if (ring) { ring.stop(); ring = null; }
          page.content.innerHTML = '';
          page.footer.innerHTML = '';
          var ph = PHASE[d.status];
          if (!ph) return removed();
          page.setTitle(ph.title, d.orderNumber ? 'Order ' + d.orderNumber : null);

          if (d.status === 'delivered') return drawDone();

          // progress through the job (from acceptance on)
          if (ph.step > 0) {
            var steps = '<div class="ldx-steps" style="margin:0 4px 16px" aria-hidden="true">';
            for (var i = 1; i <= 3; i++) steps += '<span class="ldx-step' + (i <= ph.step ? ' is-done' : '') + '"></span>';
            steps += '</div>';
            page.content.insertAdjacentHTML('beforeend', steps);
          }

          // map
          if (!map) map = jobMap(d); else map.update(d);
          page.content.appendChild(map.el);

          // live location state
          gpsChipHost = ui.h('<div style="display:flex;justify-content:center;margin:-4px 0 16px"></div>');
          page.content.appendChild(gpsChipHost);
          drawGpsChip();

          if (d.status === 'assigned') drawOffer();
          else drawWork();
          ensureGps();
          ensureLive();
        }

        function place(kind, label, address, phone, notes, loc) {
          var sec = ui.section(kind === 'pickup' ? 'Pick up' : 'Deliver to');
          var head = ui.h('<div class="ldx-row is-static" style="--ldx-inset:68px;align-items:flex-start"><span class="ldx-tile ' + (kind === 'pickup' ? '' : 'ldx-tone-accent') + '">' + ui.icon(kind === 'pickup' ? 'store' : 'home', 20) + '</span><span class="ldx-row-main"><div class="ldx-row-title"></div><div class="ldx-row-sub is-wrap"></div></span></div>');
          head.querySelector('.ldx-row-title').textContent = label;
          var subEl = head.querySelector('.ldx-row-sub');
          if (address) subEl.textContent = address; else subEl.remove();
          sec.group.appendChild(head);
          if (notes) {
            var n = ui.h('<div class="ldx-row is-static" style="--ldx-inset:68px"><span class="ldx-tile">' + ui.icon('flag', 18) + '</span><span class="ldx-row-main"><div class="ldx-row-sub is-wrap" style="margin:0;color:var(--ldx-text)"></div></span></div>');
            n.querySelector('.ldx-row-sub').textContent = notes;
            sec.group.appendChild(n);
          }
          var actions = ui.h('<div class="ldx-row is-static" style="gap:10px;justify-content:flex-start"></div>');
          var nav2 = ui.mapsHref(loc, address);
          if (nav2) actions.appendChild(ui.h('<a class="ldx-btn is-tinted is-small" href="' + ui.esc(nav2) + '" target="_blank" rel="noopener">' + ui.icon('navigate', 16) + '<span>Navigate</span></a>'));
          if (phone) actions.appendChild(ui.h('<a class="ldx-btn is-tinted is-small" href="' + ui.esc(ui.telHref(phone)) + '">' + ui.icon('phone', 16) + '<span>Call</span></a>'));
          var wa = kind === 'dropoff' ? ui.waHref(phone) : null;
          if (wa) actions.appendChild(ui.h('<a class="ldx-btn is-wa is-small" href="' + ui.esc(wa) + '" target="_blank" rel="noopener">' + ui.icon('chat', 16) + '<span>WhatsApp</span></a>'));
          if (actions.children.length) sec.group.appendChild(actions);
          return sec;
        }

        function drawOffer() {
          var card = ui.h('<div class="ldx-card is-hero" style="display:flex;align-items:center;gap:18px"><div class="ldx-slot"></div><div style="flex:1;min-width:0"><h2 class="ldx-title2">Accept this job?</h2><p class="ldx-body">You’ll see the customer’s exact address and phone once you accept.</p></div></div>');
          if (d.offerExpiresAt) {
            ring = ui.countdown(d.offerExpiresAt, { size: 'large', onExpire: function () { setTimeout(refresh, 900); } });
            card.querySelector('.ldx-slot').appendChild(ring.el);
          } else card.querySelector('.ldx-slot').remove();
          page.content.appendChild(card);
          page.content.appendChild(place('pickup', (d.pickup && d.pickup.label) || 'Pickup', d.pickup && d.pickup.address, null, null, d.pickup && d.pickup.location));
          var area = ui.section('Deliver to');
          var a = ui.h('<div class="ldx-row is-static" style="--ldx-inset:68px"><span class="ldx-tile ldx-tone-accent">' + ui.icon('pin', 20) + '</span><span class="ldx-row-main"><div class="ldx-row-title"></div><div class="ldx-row-sub">Approximate area until you accept</div></span></div>');
          a.querySelector('.ldx-row-title').textContent = (d.dropoff && d.dropoff.area) || 'The customer’s area';
          area.group.appendChild(a);
          page.content.appendChild(area);

          var row = ui.h('<div class="ldx-btn-row"></div>');
          var decline = ui.button({ label: 'Decline', kind: 'gray' });
          var accept = ui.button({ label: 'Accept job' });
          decline.addEventListener('click', function () { declineOffer(d, decline).then(function (ok) { if (ok) nav.pop(); }); });
          accept.addEventListener('click', function () {
            ui.busy(accept, function () {
              return acceptOffer(d).then(function (acc) { if (acc) { d = acc; draw(); } else refresh(); });
            });
          });
          row.appendChild(decline);
          row.appendChild(accept);
          page.footer.appendChild(row);
        }

        function drawWork() {
          var pickup = place('pickup', (d.pickup && d.pickup.label) || 'Pickup', d.pickup && d.pickup.address, d.pickup && d.pickup.contactPhone, null, d.pickup && d.pickup.location);
          var drop = place('dropoff', (d.dropoff && d.dropoff.label) || 'Customer', (d.dropoff && (d.dropoff.address || d.dropoff.area)) || null, d.dropoff && d.dropoff.contactPhone, d.dropoff && d.dropoff.notes, d.dropoff && d.dropoff.location);
          if (d.status === 'accepted') { page.content.appendChild(pickup); page.content.appendChild(drop); }
          else { page.content.appendChild(drop); page.content.appendChild(pickup); }

          var f = page.footer;
          if (d.status === 'accepted') {
            var go = ui.button({ label: 'I’ve picked it up', icon: 'package', block: true });
            go.addEventListener('click', function () {
              ui.confirm({ title: 'Confirm pickup?', message: 'Only confirm once the parcel is in your hands. The customer is told it’s on the way.', confirmLabel: 'Yes, I have it' }).then(function (yes) {
                if (yes) ui.busy(go, function () { return setStatus('picked_up'); });
              });
            });
            f.appendChild(go);
            var rel = ui.button({ label: 'Can’t do this job', kind: 'plain', block: true });
            rel.style.color = 'var(--ldx-bad)';
            rel.addEventListener('click', function () { declineOffer(d, rel).then(function (ok) { if (ok) nav.pop(); }); });
            f.appendChild(rel);
          } else if (d.status === 'picked_up') {
            var arr = ui.button({ label: 'I’ve arrived', icon: 'pin', block: true });
            arr.addEventListener('click', function () { ui.busy(arr, function () { return setStatus('arrived'); }); });
            f.appendChild(arr);
            f.appendChild(problemButton());
          } else if (d.status === 'arrived') {
            var code = ui.button({ label: 'Enter handover code', icon: 'lock', block: true });
            code.addEventListener('click', function () { codeSheet(); });
            f.appendChild(code);
            f.appendChild(problemButton());
          }
        }

        function setStatus(status, note) {
          return api.setStatus(d.id, status, note).then(function (res) {
            d = res.delivery || d;
            ui.toast(status === 'picked_up' ? 'Pickup confirmed — the customer is on alert' : status === 'arrived' ? 'The customer knows you’re here' : 'Reported to the seller');
            draw();
          }).catch(function (err) {
            ui.toast(ui.errorMessage(err), { tone: 'error' });
            refresh();
          });
        }

        function problemButton() {
          var b = ui.button({ label: 'Report a problem', kind: 'plain', block: true });
          b.addEventListener('click', problemSheet);
          return b;
        }

        function problemSheet() {
          var reasons = ['Customer can’t be reached', 'Wrong or incomplete address', 'Customer refused the parcel', 'Parcel damaged', 'Something else'];
          var form = ui.h('<div><div class="ldx-group" role="radiogroup" aria-label="What went wrong"></div><div class="ldx-group" style="margin-top:14px"><label class="ldx-field"><span>Details for the seller</span><textarea rows="3" maxlength="500" placeholder="Anything that helps the next attempt"></textarea></label></div><div class="ldx-error-text" hidden></div><div class="ldx-sheet-actions" style="padding:16px 0 4px"></div></div>');
          var picked = null;
          var group = form.querySelector('[role=radiogroup]');
          reasons.forEach(function (r) {
            var row = ui.h('<button type="button" class="ldx-row" role="radio" aria-checked="false" style="min-height:52px"><span class="ldx-row-main"><div class="ldx-row-title" style="font-weight:500"></div></span><span class="ldx-row-end" style="color:var(--ldx-accent)"></span></button>');
            row.querySelector('.ldx-row-title').textContent = r;
            row.addEventListener('click', function () {
              picked = r;
              group.querySelectorAll('[role=radio]').forEach(function (x) { x.setAttribute('aria-checked', 'false'); x.querySelector('.ldx-row-end').innerHTML = ''; });
              row.setAttribute('aria-checked', 'true');
              row.querySelector('.ldx-row-end').innerHTML = ui.icon('check', 20);
              // Details are only required when no listed reason fits.
              var ta = form.querySelector('textarea');
              ta.placeholder = r === 'Something else' ? 'What happened? (required)' : 'Anything that helps the next attempt';
              ta.required = r === 'Something else';
            });
            group.appendChild(row);
          });
          var send = ui.button({ label: 'Report and end attempt', kind: 'destructive', block: true });
          form.querySelector('.ldx-sheet-actions').appendChild(send);
          var s = ui.sheet({ title: 'What went wrong?', body: form });
          var err = form.querySelector('.ldx-error-text');
          send.addEventListener('click', function () {
            var details = form.querySelector('textarea').value.trim();
            if (!picked) { err.textContent = 'Choose what went wrong.'; err.hidden = false; return; }
            if (!details && picked === 'Something else') { err.textContent = 'Tell the seller what happened.'; err.hidden = false; return; }
            var note = (picked + (details ? ': ' + details : '')).slice(0, 500);
            ui.busy(send, function () {
              return api.setStatus(d.id, 'failed', note).then(function () {
                s.close(true);
                ui.toast('Reported. The seller will arrange another attempt.');
                removed();
              }).catch(function (e) { err.textContent = ui.errorMessage(e); err.hidden = false; });
            });
          });
        }

        function codeSheet() {
          var form = ui.h(
            '<div>' +
              '<p class="ldx-sheet-msg" style="text-align:center;margin-top:4px">Ask the customer for the 4-digit code on their delivery screen.</p>' +
              '<div class="ldx-code" style="display:flex;justify-content:center;gap:12px;margin:8px 0 6px"></div>' +
              '<div class="ldx-error-text" style="text-align:center" hidden></div>' +
              '<div class="ldx-sheet-actions" style="padding:18px 0 4px"></div>' +
            '</div>'
          );
          var boxes = [];
          var row = form.querySelector('.ldx-code');
          for (var i = 0; i < 4; i++) {
            var inp = ui.h('<input inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="' + (i === 0 ? 'one-time-code' : 'off') + '" aria-label="Digit ' + (i + 1) + '" style="width:58px;height:68px;border:0;border-radius:14px;background:var(--ldx-surface);box-shadow:inset 0 0 0 1.5px var(--ldx-sep);text-align:center;font:700 30px/1 var(--ldx-font-h);color:var(--ldx-text);font-variant-numeric:tabular-nums;outline:none;caret-color:var(--ldx-accent)">');
            boxes.push(inp);
            row.appendChild(inp);
          }
          var confirmBtn = ui.button({ label: 'Complete delivery', kind: 'ok', block: true });
          confirmBtn.disabled = true;
          form.querySelector('.ldx-sheet-actions').appendChild(confirmBtn);
          var err = form.querySelector('.ldx-error-text');
          function value() { return boxes.map(function (b) { return b.value; }).join(''); }
          function sync() {
            boxes.forEach(function (b) { b.style.boxShadow = 'inset 0 0 0 ' + (b === document.activeElement ? '2px var(--ldx-accent)' : '1.5px var(--ldx-sep)'); });
            confirmBtn.disabled = value().length !== 4;
          }
          boxes.forEach(function (b, idx) {
            b.addEventListener('focus', function () { b.select(); sync(); });
            b.addEventListener('blur', sync);
            b.addEventListener('input', function () {
              var v = b.value.replace(/\D/g, '');
              if (v.length > 1) { // pasted or autofilled: spread across the boxes
                v.slice(0, 4 - idx).split('').forEach(function (ch, k) { boxes[idx + k].value = ch; });
                boxes[Math.min(3, idx + v.length - 1)].focus();
              } else {
                b.value = v;
                if (v && idx < 3) boxes[idx + 1].focus();
              }
              err.hidden = true;
              sync();
              if (value().length === 4) submit();
            });
            b.addEventListener('keydown', function (e) {
              if (e.key === 'Backspace' && !b.value && idx > 0) { boxes[idx - 1].focus(); boxes[idx - 1].value = ''; sync(); e.preventDefault(); }
              if (e.key === 'ArrowLeft' && idx > 0) boxes[idx - 1].focus();
              if (e.key === 'ArrowRight' && idx < 3) boxes[idx + 1].focus();
              if (e.key === 'Enter' && value().length === 4) submit();
            });
          });
          var s = ui.sheet({ title: 'Handover code', body: form, autofocus: 'input' });
          var submitting = false;
          function submit() {
            if (submitting || value().length !== 4) return;
            submitting = true;
            ui.busy(confirmBtn, function () {
              return api.complete(d.id, value()).then(function (res) {
                d = res.delivery || Object.assign({}, d, { status: 'delivered' });
                s.close(true);
                ui.haptic(30);
                draw();
              }).catch(function (e) {
                var msg = e && e.code === 'DELIVERY_LOCKED' ? ui.errorMessage(e) : (e && e.message) || ui.errorMessage(e);
                err.textContent = msg;
                err.hidden = false;
                row.classList.remove('ldx-shake'); void row.offsetWidth; row.classList.add('ldx-shake');
                ui.haptic(30);
                if (e && e.code === 'DELIVERY_LOCKED') { boxes.forEach(function (b) { b.disabled = true; }); confirmBtn.disabled = true; }
                else { boxes.forEach(function (b) { b.value = ''; }); boxes[0].focus(); sync(); }
              });
            }).finally(function () { submitting = false; });
          }
          confirmBtn.addEventListener('click', submit);
        }

        function drawDone() {
          stopAll();
          if (map) { map.destroy(); map = null; }
          var done = ui.h(
            '<div class="ldx-empty ldx-fade-in" style="padding-top:72px">' +
              '<div class="ldx-empty-ico" style="background:var(--ldx-ok-soft);color:var(--ldx-ok);width:96px;height:96px;border-radius:50%">' + ui.icon('check', 48) + '</div>' +
              '<h3>Delivered</h3><p>The handover code was verified' + (d.updatedAt ? ' at ' + ui.esc(ui.clockTime(d.updatedAt)) : '') + '. Nice work.</p>' +
            '</div>'
          );
          page.content.appendChild(done);
          page.footer.appendChild(ui.button({ label: 'Back to deliveries', block: true, onClick: function () { nav.pop(); } }));
        }

        draw();
        page.reload = refresh;
        return function cleanup() { stopAll(); if (map) map.destroy(); };
      }
    };
  }

  // --------------------------------------------------------------- triggers
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-open-rider-hub]') : null;
    if (!t) return;
    e.preventDefault();
    open();
  });

  window.LoumooRiderHub = { open: open };
})();
