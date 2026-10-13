/**
 * LOUMOO Seller Dispatch
 * ---------------------------------------------------------------------------
 * The seller's side of home delivery: a dispatch board of every home-delivery
 * order (To dispatch / In progress / Completed), an order screen that shows
 * where its delivery stands and what to do next, and a rider picker with each
 * rider's workload, who already passed on this order, and auto-assign.
 *
 * Backed by window.deliveryApi (src/services/deliveryApi.js, contract
 * docs/DELIVERY_API.md v1.2) and drawn with window.LoumooDispatchUI.
 *
 * Open it from anywhere:
 *   <button data-open-dispatch>Deliveries</button>
 *   <button data-open-dispatch data-order-id="{{ order.id }}">Arrange delivery</button>
 *   window.LoumooSellerDispatch.open()             // the board
 *   window.LoumooSellerDispatch.open({ orderId })  // straight to one order
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var REFRESH_MS = 20000;
  var PICKUP_KEY = 'loumoo.dispatch.pickup';

  function UI() { return window.LoumooDispatchUI; }
  function API() { return window.deliveryApi; }

  // Which tab an order belongs on.
  function bucketOf(item) {
    var d = item.delivery;
    if (!d || d.status === 'pending_assignment' || d.status === 'cancelled' || d.status === 'failed') return 'todo';
    if (d.status === 'delivered') return 'done';
    return 'live';
  }
  function orderTitle(order) { return order.orderNumber ? 'Order ' + order.orderNumber : 'Order'; }
  /** One short line for a board row, in the seller's terms. */
  function rowStatus(status, d) {
    var who = d && d.driver ? firstName(d.driver.name) : null;
    switch (status) {
      case 'assigned': return who ? 'Waiting for ' + who + ' to accept' : 'Waiting for the rider';
      case 'accepted': return who ? who + ' is heading to you' : 'Rider heading to you';
      case 'picked_up': return 'Out for delivery' + (who ? ' with ' + who : '');
      case 'arrived': return (who || 'The rider') + ' is at the door';
      case 'delivered': return 'Delivered' + (d && d.updatedAt ? ' at ' + UI().clockTime(d.updatedAt) : '') + (who ? ' by ' + who : '');
      case 'failed': return 'Attempt failed' + (who ? ' · ' + who : '');
      default: return 'Needs a rider';
    }
  }
  function riderName(d) { return (d && d.driver && d.driver.name) || 'the rider'; }
  function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || name; }

  // ------------------------------------------------------------------ entry
  function open(opts) {
    // Compatibility entry point: with URL routing active this navigates to the
    // canonical address (the route then calls mount()); without it, it opens directly.
    var R = window.LoumooRouter;
    if (R && R.isActive()) return R.openOverlay('sellerDispatch', opts || {});
    return mount(opts);
  }

  /** Opens the board (and one order if asked). Called by the router; use open() everywhere else. */
  function mount(opts) {
    var ui = UI(), api = API();
    if (!ui || !api) { console.warn('[SellerDispatch] the UI kit or the delivery API is missing'); return null; }
    var o = opts || {};
    var nav = ui.openStack({ label: 'Deliveries', onClose: o.onClose });
    var board = boardView(nav);
    nav.push(board);
    if (o.orderId) openOrderById(nav, o.orderId);
    return nav;
  }

  /** Jumps to one order: finds it on the board (it has the order summary). */
  function openOrderById(nav, orderId) {
    var api = API();
    api.dispatchBoard({ view: 'active', limit: 100 }).then(function (res) {
      var item = (res.items || []).find(function (i) { return i.order.id === orderId || i.order.orderNumber === orderId; });
      if (item) nav.push(orderView(nav, item));
      else UI().toast('This order has no home delivery to arrange.', { tone: 'info' });
    }).catch(function (err) { UI().toast(UI().errorMessage(err), { tone: 'error' }); });
  }

  // ------------------------------------------------------------------ board
  function boardView(nav) {
    return {
      title: 'Deliveries',
      subtitle: 'You are the seller · assign riders and follow every home delivery.',
      render: function (page) {
        var ui = UI(), api = API();
        var state = { tab: 'todo', active: null, completed: null, error: null, completedError: null };
        var timers = [];

        page.setRight([{ icon: 'refresh', label: 'Refresh', onClick: function () { load(true); } }]);
        var seg = ui.segmented([
          { label: 'To dispatch', value: 'todo' },
          { label: 'In progress', value: 'live' },
          { label: 'Completed', value: 'done' }
        ], 'todo', function (v) {
          state.tab = v;
          if (v === 'done' && !state.completed) loadCompleted();
          draw();
        });
        page.content.appendChild(seg);
        var body = document.createElement('div');
        page.content.appendChild(body);
        body.appendChild(ui.skeletonList(4));

        function stopTimers() { timers.forEach(function (t) { t.stop(); }); timers = []; }

        function load(manual) {
          return api.dispatchBoard({ view: 'active', limit: 100 }).then(function (res) {
            if (!page.alive) return;
            var sig = JSON.stringify(res.items || []);
            var changed = sig !== state.sig;
            state.sig = sig;
            state.active = res.items || [];
            state.error = null;
            if (manual) ui.toast('Up to date', { tone: 'info', duration: 1400 });
            // Redraw only when something changed: a background refresh must not
            // rebuild the list under the seller's finger or steal keyboard focus.
            if (changed) draw();
          }).catch(function (err) {
            if (!page.alive) return;
            state.error = err;
            if (!state.active) draw();
            else if (manual) ui.toast(ui.errorMessage(err), { tone: 'error' });
          });
        }
        function loadCompleted() {
          return api.dispatchBoard({ view: 'completed', limit: 50 }).then(function (res) {
            if (!page.alive) return;
            state.completed = res.items || [];
            state.completedError = null;
            draw();
          }).catch(function (err) {
            if (!page.alive) return;
            state.completedError = err;
            draw();
          });
        }

        function draw() {
          stopTimers();
          body.innerHTML = '';
          var todo = [], live = [];
          (state.active || []).forEach(function (i) { (bucketOf(i) === 'live' ? live : todo).push(i); });
          seg.setCount('todo', state.active ? todo.length : null);
          seg.setCount('live', state.active ? live.length : null);

          if (state.tab === 'done') return drawCompleted();
          if (state.error && !state.active) { body.appendChild(ui.errorState(ui.errorMessage(state.error), function () { body.innerHTML = ''; body.appendChild(ui.skeletonList(4)); load(); })); return; }
          if (!state.active) { body.appendChild(ui.skeletonList(4)); return; }

          if (state.tab === 'todo') {
            if (!todo.length) {
              body.appendChild(ui.emptyState({ icon: 'checkCircle', title: 'You’re all caught up', body: 'Home-delivery orders appear here when they need a rider.' }));
              return;
            }
            var failed = todo.filter(function (i) { return i.delivery && i.delivery.status === 'failed'; });
            var waiting = todo.filter(function (i) { return !(i.delivery && i.delivery.status === 'failed'); })
              .sort(function (a, b) { return Date.parse(a.order.placedAt) - Date.parse(b.order.placedAt); }); // oldest first
            if (failed.length) body.appendChild(list('Needs attention', failed, 'A delivery attempt failed. Offer it to another rider.'));
            body.appendChild(list('Waiting for a rider', waiting, waiting.length ? 'Oldest orders first.' : null));
          } else {
            if (!live.length) {
              body.appendChild(ui.emptyState({ icon: 'scooter', title: 'Nothing on the road', body: 'Deliveries you assign show up here until they’re handed over.' }));
              return;
            }
            var offered = live.filter(function (i) { return i.delivery.status === 'assigned'; });
            var moving = live.filter(function (i) { return i.delivery.status !== 'assigned'; });
            if (offered.length) body.appendChild(list('Waiting for the rider to accept', offered));
            if (moving.length) body.appendChild(list('On the way', moving));
          }
        }

        function drawCompleted() {
          if (state.completedError && !state.completed) { body.appendChild(ui.errorState(ui.errorMessage(state.completedError), function () { state.completedError = null; body.innerHTML = ''; body.appendChild(ui.skeletonList(3)); loadCompleted(); })); return; }
          if (!state.completed) { body.appendChild(ui.skeletonList(3)); return; }
          if (!state.completed.length) { body.appendChild(ui.emptyState({ icon: 'package', title: 'No completed deliveries yet', body: 'Delivered orders are kept here for your records.' })); return; }
          body.appendChild(list('Delivered', state.completed));
        }

        function list(title, items, foot) {
          var sec = ui.section(title, { count: items.length, foot: foot || null });
          items.forEach(function (item) { sec.group.appendChild(row(item)); });
          return sec;
        }

        // Mail-style row: what was ordered with its age on the right, where its
        // delivery stands (in colour), then the order number and area.
        function row(item) {
          var o = item.order, d = item.delivery;
          var status = d ? d.status : 'none';
          if (status === 'cancelled') status = 'none';
          var info = ui.statusInfo(status);
          var ico = status === 'delivered' ? 'checkCircle' : (status === 'failed' ? 'alert' : (['accepted', 'picked_up', 'arrived'].indexOf(status) !== -1 ? 'scooter' : 'package'));
          var when = ui.relTime(status === 'delivered' && d ? d.updatedAt : o.placedAt);
          var meta = [o.orderNumber, o.area].filter(Boolean).join(' · ');
          var el = ui.h(
            '<button class="ldx-row" style="--ldx-inset:68px;align-items:center">' +
              '<span class="ldx-tile ldx-tone-' + info.tone + '">' + ui.icon(ico, 22) + '</span>' +
              '<span class="ldx-row-main"><div class="ldx-row-head"><div class="ldx-row-title"></div><span class="ldx-row-time"></span></div><div class="ldx-row-status ldx-tone-' + info.tone + '"></div><div class="ldx-row-meta"></div></span>' +
              '<span class="ldx-row-end"></span>' +
            '</button>'
          );
          el.querySelector('.ldx-row-title').textContent = o.title || orderTitle(o);
          el.querySelector('.ldx-row-time').textContent = when;
          el.querySelector('.ldx-row-status').textContent = rowStatus(status, d);
          el.querySelector('.ldx-row-meta').textContent = meta;
          var end = el.querySelector('.ldx-row-end');
          if (status === 'assigned' && d.offerExpiresAt) {
            var ring = ui.countdown(d.offerExpiresAt, { onExpire: function () { load(); } });
            timers.push(ring);
            end.appendChild(ring.el);
          }
          end.insertAdjacentHTML('beforeend', ui.icon('forward', 18));
          el.setAttribute('aria-label', [o.title || orderTitle(o), rowStatus(status, d), meta, when].filter(Boolean).join(', '));
          el.addEventListener('click', function () { nav.push(orderView(nav, item)); });
          return el;
        }

        var interval = setInterval(function () { if (page.alive && !document.hidden) load(false); }, REFRESH_MS);
        function onVisible() { if (!document.hidden && page.alive) load(false); }
        document.addEventListener('visibilitychange', onVisible);
        page.reload = function () { load(false); if (state.completed) loadCompleted(); };
        load(false);
        return function cleanup() {
          clearInterval(interval);
          stopTimers();
          document.removeEventListener('visibilitychange', onVisible);
        };
      },
      onResume: function (page) { if (page.reload) page.reload(); }
    };
  }

  // ------------------------------------------------------------ order screen
  var HERO = {
    none: function () { return { title: 'Needs a rider', body: 'Arrange the delivery and offer it to a rider. Riders who are free come first.' }; },
    pending_assignment: function () { return { title: 'Needs a rider', body: 'Offer this delivery to a rider, or let LOUMOO pick the most available one.' }; },
    assigned: function (d) { return { title: 'Waiting for ' + firstName(riderName(d)), body: firstName(riderName(d)) + ' has been asked to accept. If they don’t answer in time, it comes back to you.' }; },
    accepted: function (d) { return { title: firstName(riderName(d)) + ' is on the way to you', body: 'Have the parcel ready. The rider confirms pickup in the app.' }; },
    picked_up: function () { return { title: 'Out for delivery', body: 'The parcel is with the rider. The customer can follow it live.' }; },
    arrived: function (d) { return { title: firstName(riderName(d)) + ' is at the door', body: 'The customer gives the rider a 4-digit code to complete the handover.' }; },
    delivered: function (d) { return { title: 'Delivered', body: 'Handed over' + (d && d.updatedAt ? ' at ' + UI().clockTime(d.updatedAt) : '') + '. The code was verified.' }; },
    failed: function (d) { return { title: 'Delivery attempt failed', body: (d && d.failureReason ? '“' + d.failureReason + '”. ' : '') + 'Offer it to another rider to try again.' }; },
    cancelled: function () { return { title: 'Delivery cancelled', body: 'You can arrange a new delivery for this order.' }; }
  };
  function orderView(nav, item) {
    var order = item.order;
    return {
      title: orderTitle(order),
      subtitle: [order.title, order.itemCount > 1 ? order.itemCount + ' items' : null].filter(Boolean).join(' · ') || null,
      render: function (page) {
        var ui = UI(), api = API();
        var delivery = item.delivery;
        var ring = null, sub = null;

        function stopLive() { if (sub) { try { sub.close(); } catch (e) { /* ignore */ } sub = null; } }
        function startLive() {
          stopLive();
          if (!delivery || !api.subscribe || ['delivered', 'cancelled'].indexOf(delivery.status) !== -1) return;
          sub = api.subscribe(delivery.id, {
            onStatus: function (evt) { if (evt && delivery && evt.status !== delivery.status) refresh(); },
            onEnd: function () { refresh(); }
          });
        }
        function refresh() {
          if (!delivery) return Promise.resolve();
          return api.get(delivery.id).then(function (res) {
            if (!page.alive || !res || !res.delivery) return;
            var changed = !delivery || res.delivery.status !== delivery.status;
            delivery = res.delivery;
            item.delivery = delivery;
            draw();
            if (changed) startLive();
          }).catch(function () { /* the feed keeps trying */ });
        }

        // The provider the buyer preferred at checkout, resolved by the board:
        // { id, name, status } when the rider still exists, else null. The seller
        // confirms — this only defaults the choice to the customer's.
        function buyerPick() {
          if (!order || !order.preferredDriverId) return null;
          return order.preferredDriver || { id: order.preferredDriverId, name: 'the chosen rider', status: 'gone' };
        }
        // One tap offers the buyer's preferred rider, the same assign call the
        // picker makes. Toast + rethrow on error so the busy button settles.
        function offerPreferred(pick) {
          return api.assign(delivery.id, pick.id).then(function (res) {
            ui.toast('Offer sent to ' + firstName(pick.name));
            delivery = res.delivery || delivery;
            item.delivery = delivery;
            return delivery;
          }).catch(function (err) { ui.toast(ui.errorMessage(err), { tone: 'error' }); refresh(); throw err; });
        }

        function draw() {
          if (ring) { ring.stop(); ring = null; }
          page.content.innerHTML = '';
          page.footer.innerHTML = '';
          var status = delivery ? delivery.status : 'none';
          var hero = (HERO[status] || HERO.none)(delivery);

          // Status hero. The title already says where things stand, so there's no
          // status pill; the eyebrow carries the status colour instead.
          var tone = ui.statusInfo(status === 'pending_assignment' ? 'none' : status).tone;
          var card = ui.h('<div class="ldx-card is-hero ldx-fade-in"><div style="display:flex;gap:16px;align-items:flex-start"><div style="flex:1;min-width:0"><p class="ldx-eyebrow ldx-tone-' + tone + '">Delivery</p><h2 class="ldx-title2"></h2><p class="ldx-body"></p></div><div class="ldx-hero-side"></div></div></div>');
          card.querySelector('h2').textContent = hero.title;
          card.querySelector('.ldx-body').textContent = hero.body;
          if (status === 'assigned' && delivery.offerExpiresAt) {
            ring = ui.countdown(delivery.offerExpiresAt, { onExpire: function () { setTimeout(refresh, 800); } });
            card.querySelector('.ldx-hero-side').appendChild(ring.el);
          } else {
            card.querySelector('.ldx-hero-side').remove();
          }
          page.content.appendChild(card);

          // Where the order is across all four parties and what part you play in
          // it (a seller, or an administrator looking in). The hero above already
          // says what to do, so the strip leaves its own banner out.
          var strip = window.LoumooCircuit
            ? window.LoumooCircuit.stripCard(delivery, (delivery && delivery.viewerRole) || 'seller', { banner: false })
            : null;
          if (strip) page.content.appendChild(strip);

          // Rider
          if (delivery && delivery.driver && ['assigned', 'accepted', 'picked_up', 'arrived', 'delivered'].indexOf(status) !== -1) {
            var rs = ui.section('Rider');
            var r = delivery.driver;
            var wa = ui.waHref(r.phone);
            var rr = ui.h('<div class="ldx-row is-static" style="--ldx-inset:68px">' + ui.avatar(r.name, 40) +
              '<span class="ldx-row-main"><div class="ldx-row-title"></div><div class="ldx-row-sub"></div></span>' +
              '<span class="ldx-row-end" style="gap:10px">' +
                (r.phone ? '<a class="ldx-iconbtn is-call" href="' + ui.esc(ui.telHref(r.phone)) + '" aria-label="Call ' + ui.esc(r.name) + '">' + ui.icon('phone', 19) + '</a>' : '') +
                (wa ? '<a class="ldx-iconbtn is-wa" href="' + ui.esc(wa) + '" target="_blank" rel="noopener" aria-label="WhatsApp ' + ui.esc(r.name) + '">' + ui.icon('chat', 19) + '</a>' : '') +
              '</span></div>');
            rr.querySelector('.ldx-row-title').textContent = r.name;
            rr.querySelector('.ldx-row-sub').textContent = r.phone || '';
            rs.group.appendChild(rr);
            page.content.appendChild(rs);
          }

          // Order
          var os = ui.section('Order');
          var rows = [];
          if (order.title) rows.push(['package', order.title + (order.itemCount > 1 ? ' × ' + order.itemCount : ''), order.totalXaf != null ? ui.money(order.totalXaf) : null]);
          if (order.buyerName || order.area) rows.push(['home', order.buyerName || 'Customer', order.area || null]);
          if (['none', 'pending_assignment', 'failed', 'assigned'].indexOf(status) !== -1 && order.preferredDriverId) {
            var bp = order.preferredDriver;
            rows.push(['user', bp ? bp.name : 'Chosen rider', 'Your customer’s pick' + (bp && bp.status === 'active' ? '' : ' · not available now')]);
          }
          if (delivery && delivery.pickup && (delivery.pickup.label || delivery.pickup.address)) rows.push(['store', delivery.pickup.label || 'Pickup', delivery.pickup.address || null]);
          rows.push(['clock', 'Placed ' + ui.relTime(order.placedAt), null]);
          rows.forEach(function (x) {
            var el = ui.h('<div class="ldx-row is-static" style="--ldx-inset:68px"><span class="ldx-tile">' + ui.icon(x[0], 20) + '</span><span class="ldx-row-main"><div class="ldx-row-title"></div><div class="ldx-row-sub"></div></span></div>');
            el.querySelector('.ldx-row-title').textContent = x[1];
            var s = el.querySelector('.ldx-row-sub');
            if (x[2]) s.textContent = x[2]; else s.remove();
            os.group.appendChild(el);
          });
          page.content.appendChild(os);

          drawActions(status);
        }

        function drawActions(status) {
          var f = page.footer;
          if (status === 'none' || status === 'cancelled') {
            f.appendChild(ui.button({ label: 'Arrange delivery', icon: 'scooter', block: true, onClick: function () { arrange(); } }));
          } else if (status === 'pending_assignment' || status === 'failed') {
            var pick = buyerPick();
            if (pick && pick.status === 'active') {
              // The customer chose this rider at checkout: one tap confirms it.
              var offerBtn = ui.button({ label: 'Offer to ' + firstName(pick.name), block: true });
              offerBtn.addEventListener('click', function () { ui.busy(offerBtn, function () { return offerPreferred(pick).then(refresh); }); });
              f.appendChild(offerBtn);
              f.appendChild(ui.h('<div class="ldx-hint" style="text-align:center">' + ui.esc(firstName(pick.name)) + ' is the rider your customer chose at checkout.</div>'));
              var row2b = ui.h('<div class="ldx-btn-row"></div>');
              row2b.appendChild(ui.button({ label: 'Choose another', kind: 'tinted', size: 'medium', onClick: function () { nav.push(pickerView(nav, delivery, order)); } }));
              var auto2 = ui.button({ label: 'Auto-assign', icon: 'sparkle', kind: 'gray', size: 'medium' });
              auto2.addEventListener('click', function () { ui.busy(auto2, function () { return autoAssign(delivery).then(refresh); }); });
              row2b.appendChild(auto2);
              f.appendChild(row2b);
              if (status === 'pending_assignment') f.appendChild(cancelButton());
            } else {
              if (pick) f.appendChild(ui.h('<div class="ldx-hint" style="text-align:center">Your customer chose ' + ui.esc(firstName(pick.name)) + ', who isn’t available now. Choose another rider.</div>'));
              f.appendChild(ui.button({ label: 'Choose a rider', block: true, onClick: function () { nav.push(pickerView(nav, delivery, order)); } }));
              var row2 = ui.h('<div class="ldx-btn-row"></div>');
              var auto = ui.button({ label: 'Auto-assign', icon: 'sparkle', kind: 'tinted', size: 'medium' });
              auto.addEventListener('click', function () { ui.busy(auto, function () { return autoAssign(delivery).then(refresh); }); });
              row2.appendChild(auto);
              if (status === 'pending_assignment') row2.appendChild(cancelButton());
              f.appendChild(row2);
            }
          } else if (status === 'assigned') {
            var row3 = ui.h('<div class="ldx-btn-row"></div>');
            row3.appendChild(ui.button({ label: 'Change rider', kind: 'gray', size: 'medium', onClick: function () { nav.push(pickerView(nav, delivery, order)); } }));
            row3.appendChild(cancelButton());
            f.appendChild(row3);
          } else if (['accepted', 'picked_up', 'arrived'].indexOf(status) !== -1) {
            if (window.LoumooDeliveryTracking) f.appendChild(ui.button({ label: 'Track live', icon: 'pin', block: true, onClick: function () { window.LoumooDeliveryTracking.open({ deliveryId: delivery.id }); } }));
            if (status === 'accepted') f.appendChild(cancelButton(true));
          }
          maybeOfferDelegation(status);
        }

        // When the delivery is held by an AGENCY provider (item C), offer to hand
        // it to one of the agency's riders. Whether the assigned provider is an
        // agency is not on the board row, so it is looked up once per rider and
        // remembered; a redraw then shows the button without fetching again.
        function appendDelegateButton() {
          var b = ui.button({ label: 'Delegate to a rider', icon: 'users', kind: 'tinted', size: 'medium', block: true });
          b.addEventListener('click', function () { nav.push(agencyRiderPickerView(nav, delivery)); });
          page.footer.appendChild(b);
        }
        function maybeOfferDelegation(status) {
          if (!delivery || !delivery.driver || ['assigned', 'accepted'].indexOf(status) === -1) return;
          var driverId = delivery.driver.id;
          if (item._agencyCheckedFor === driverId) { if (item._driverIsAgency) appendDelegateButton(); return; }
          api.getProvider(driverId).then(function (res) {
            if (!page.alive) return;
            item._agencyCheckedFor = driverId;
            item._driverIsAgency = Boolean(res && res.provider && res.provider.isAgency);
            if (item._driverIsAgency && delivery && delivery.driver && delivery.driver.id === driverId) draw();
          }).catch(function () { item._agencyCheckedFor = driverId; item._driverIsAgency = false; });
        }

        function cancelButton(block) {
          var b = ui.button({ label: 'Cancel delivery', kind: 'destructive', size: block ? null : 'medium', block: !!block });
          b.addEventListener('click', function () {
            ui.confirm({
              title: 'Cancel this delivery?',
              message: delivery && delivery.driver && delivery.status !== 'pending_assignment'
                ? firstName(delivery.driver.name) + ' will be told it’s off. You can arrange a new delivery for this order.'
                : 'You can arrange a new delivery for this order later.',
              confirmLabel: 'Cancel delivery', cancelLabel: 'Keep it', destructive: true
            }).then(function (yes) {
              if (!yes) return;
              ui.busy(b, function () {
                return api.cancel(delivery.id).then(function (res) {
                  delivery = res.delivery || delivery;
                  item.delivery = delivery;
                  ui.toast('Delivery cancelled');
                  draw();
                }).catch(function (err) { ui.toast(ui.errorMessage(err), { tone: 'error' }); refresh(); });
              });
            });
          });
          return b;
        }

        function arrange() {
          var saved = {};
          try { saved = JSON.parse(localStorage.getItem(PICKUP_KEY) || '{}') || {}; } catch (e) { saved = {}; }
          var form = ui.h(
            '<div>' +
              '<div class="ldx-group">' +
                '<label class="ldx-field"><span>Pickup name</span><input name="label" maxlength="120" autocomplete="organization" placeholder="Your shop name"></label>' +
                '<label class="ldx-field"><span>Pickup address</span><textarea name="address" rows="2" maxlength="300" autocomplete="street-address" placeholder="Street, landmark, neighbourhood"></textarea></label>' +
              '</div>' +
              '<div class="ldx-hint">The rider sees this to find you. It’s remembered for your next delivery.</div>' +
              '<div class="ldx-error-text" hidden></div>' +
              '<div class="ldx-sheet-actions" style="padding:16px 0 4px"></div>' +
            '</div>'
          );
          form.querySelector('[name=label]').value = saved.label || '';
          form.querySelector('[name=address]').value = saved.address || '';
          var go = ui.button({ label: 'Continue', block: true });
          form.querySelector('.ldx-sheet-actions').appendChild(go);
          var s = ui.sheet({ title: 'Arrange delivery', body: form, autofocus: 'empty' });
          var errEl = form.querySelector('.ldx-error-text');
          go.addEventListener('click', function () {
            var label = form.querySelector('[name=label]').value.trim();
            var address = form.querySelector('[name=address]').value.trim();
            errEl.hidden = true;
            ui.busy(go, function () {
              var pickup = {};
              if (label) pickup.label = label;
              if (address) pickup.address = address;
              return api.create(order.id, { pickup: Object.keys(pickup).length ? pickup : undefined }).then(function (res) {
                try { localStorage.setItem(PICKUP_KEY, JSON.stringify({ label: label, address: address })); } catch (e) { /* private mode */ }
                delivery = res.delivery;
                item.delivery = delivery;
                s.close(true);
                draw();
                startLive();
                nav.push(pickerView(nav, delivery, order));
              }).catch(function (err) {
                errEl.textContent = ui.errorMessage(err);
                errEl.hidden = false;
                form.classList.remove('ldx-shake'); void form.offsetWidth; form.classList.add('ldx-shake');
              });
            });
          });
        }

        draw();
        startLive();
        page.reload = refresh;
        return function cleanup() { stopLive(); if (ring) ring.stop(); };
      },
      onResume: function (page) { if (page.reload) page.reload(); }
    };
  }

  function autoAssign(delivery) {
    var ui = UI();
    return API().autoAssign(delivery.id).then(function (res) {
      var d = res.delivery;
      ui.toast('Offered to ' + (d && d.driver ? d.driver.name : 'a rider'));
      return d;
    }).catch(function (err) {
      ui.toast(ui.errorMessage(err), { tone: 'error' });
      throw err;
    });
  }

  // ------------------------------------------------------------- rider picker
  function pickerView(nav, delivery, order) {
    var hasPick = !!(order && order.preferredDriverId);
    return {
      title: 'Choose a rider',
      subtitle: hasPick ? 'Your customer’s pick comes first. Riders who passed are marked.' : 'Free riders come first. Riders who passed on this order are marked.',
      subtitle: 'Online riders only. Free riders come first. Riders who passed on this order are marked.',
      render: function (page) {
        var ui = UI(), api = API();
        var riders = null, summary = null, query = '';
        var search = ui.searchField({ placeholder: 'Search riders', onInput: function (q) { query = q.toLowerCase(); draw(); } });
        page.content.appendChild(search);
        var autoSec = ui.section(null);
        var autoRow = ui.h(
          '<button class="ldx-row" style="--ldx-inset:68px">' +
            '<span class="ldx-tile ldx-tone-accent">' + ui.icon('sparkle', 22) + '</span>' +
            '<span class="ldx-row-main"><div class="ldx-row-title">Auto-assign</div><div class="ldx-row-sub is-wrap">Offer it to the most available rider who hasn’t passed on it.</div></span>' +
            '<span class="ldx-row-end">' + ui.icon('forward', 18) + '</span>' +
          '</button>'
        );
        autoRow.addEventListener('click', function () {
          if (autoRow.getAttribute('aria-busy') === 'true') return;
          autoRow.setAttribute('aria-busy', 'true');
          autoRow.style.opacity = '.6';
          autoAssign(delivery).then(function () { nav.pop(); }).catch(function () { /* toast shown */ }).finally(function () {
            autoRow.removeAttribute('aria-busy'); autoRow.style.opacity = '';
          });
        });
        autoSec.group.appendChild(autoRow);
        page.content.appendChild(autoSec);
        var listWrap = document.createElement('div');
        page.content.appendChild(listWrap);
        listWrap.appendChild(ui.skeletonList(5));

        function load() {
          api.listDrivers({ deliveryId: delivery.id }).then(function (res) {
            if (!page.alive) return;
            // { drivers, summary: { registered, available } }; an older server sends no summary.
            riders = Array.isArray(res) ? res : (res && res.drivers) || [];
            summary = res && !Array.isArray(res) && res.summary ? res.summary : null;
            draw();
          }).catch(function (err) {
            if (!page.alive) return;
            listWrap.innerHTML = '';
            listWrap.appendChild(ui.errorState(ui.errorMessage(err), function () { listWrap.innerHTML = ''; listWrap.appendChild(ui.skeletonList(5)); load(); }));
          });
        }

        function draw() {
          if (!riders) return;
          listWrap.innerHTML = '';
          if (!riders.length) {
            autoSec.hidden = true;
            // Riders exist but none is online right now: say so, and that they show up here the moment they are.
            var noneOnline = summary && summary.registered > 0 && summary.available === 0;
            listWrap.appendChild(ui.emptyState(noneOnline
              ? { icon: 'users', title: 'No rider is online right now', body: 'Riders appear here as soon as they go online. Check again in a moment.', actionLabel: 'Check again', actionKind: 'tinted', onAction: function () { listWrap.innerHTML = ''; listWrap.appendChild(ui.skeletonList(5)); load(); } }
              : { icon: 'users', title: 'No riders yet', body: 'Riders are added by the LOUMOO team. Contact support to add riders in your area.' }));
            return;
          }
          autoSec.hidden = false;
          var shown = riders.filter(function (r) {
            return !query || String(r.name || '').toLowerCase().indexOf(query) !== -1 || String(r.phone || '').replace(/\s/g, '').indexOf(query.replace(/\s/g, '')) !== -1;
          });
          var current = delivery.status === 'assigned' && delivery.driver ? delivery.driver.id : null;
          var preferredId = order && order.preferredDriverId ? order.preferredDriverId : null;
          if (preferredId) {
            // The customer's pick leads the list so one tap confirms it.
            shown = shown.slice().sort(function (a, b) { return (b.id === preferredId ? 1 : 0) - (a.id === preferredId ? 1 : 0); });
            if (!riders.some(function (r) { return r.id === preferredId; })) {
              var bpName = order.preferredDriver && order.preferredDriver.name ? order.preferredDriver.name : 'Your customer’s chosen rider';
              listWrap.appendChild(ui.h('<div class="ldx-section-foot" style="padding:0 4px 12px">' + ui.esc(bpName) + ' — your customer’s pick — isn’t available right now. Choose another to keep the order moving.</div>'));
            }
          }
          var sec = ui.section('Riders', { count: shown.length });
          if (!shown.length) {
            sec.group.appendChild(ui.h('<div class="ldx-row is-static"><span class="ldx-row-main"><div class="ldx-row-sub">No rider matches “' + ui.esc(query) + '”.</div></span></div>'));
          }
          shown.forEach(function (r) {
            var busy = r.openDeliveries || 0;
            var load = busy === 0 ? 'Free' : busy + ' active';
            var isCurrent = r.id === current;
            var el = ui.h(
              '<button class="ldx-row' + (r.declined ? ' is-dim' : '') + '" style="--ldx-inset:68px">' + ui.avatar(r.name, 40) +
                '<span class="ldx-row-main"><div class="ldx-row-title"></div><div class="ldx-row-sub"></div></span>' +
                '<span class="ldx-row-end"></span>' +
              '</button>'
            );
            el.querySelector('.ldx-row-title').textContent = r.name;
            el.querySelector('.ldx-row-sub').textContent = r.phone || '';
            var end = el.querySelector('.ldx-row-end');
            var isPreferred = preferredId && r.id === preferredId;
            if (isCurrent) end.insertAdjacentHTML('beforeend', ui.badge('Offered', 'accent'));
            else if (r.declined) end.insertAdjacentHTML('beforeend', ui.badge('Passed', 'muted'));
            else {
              if (isPreferred) end.insertAdjacentHTML('beforeend', ui.badge('Buyer’s pick', 'accent'));
              end.insertAdjacentHTML('beforeend', ui.badge(load, busy === 0 ? 'ok' : 'warn'));
            }
            el.setAttribute('aria-label', r.name + ', ' + (busy === 0 ? 'free' : 'on ' + busy + (busy === 1 ? ' delivery' : ' deliveries')) + (isPreferred ? ', your customer’s pick' : '') + (r.declined ? ', already passed on this order' : ''));
            if (isCurrent) { el.classList.add('is-static'); el.disabled = true; }
            else el.addEventListener('click', function () { offer(r); });
            sec.group.appendChild(el);
          });
          listWrap.appendChild(sec);
        }

        function offer(r) {
          var name = firstName(r.name);
          ui.confirm({
            title: 'Offer to ' + r.name + '?',
            message: (r.declined ? name + ' already passed on this order once. ' : '') + name + ' will be asked to accept. If they don’t answer in time, it comes back to you.',
            confirmLabel: 'Send offer'
          }).then(function (yes) {
            if (!yes) return;
            api.assign(delivery.id, r.id).then(function (res) {
              ui.toast('Offer sent to ' + name);
              delivery = res.delivery || delivery;
              nav.pop();
            }).catch(function (err) { ui.toast(ui.errorMessage(err), { tone: 'error' }); load(); });
          });
        }

        load();
      }
    };
  }

  // ------------------------------------------------ agency rider delegation
  function agencyRiderPickerView(nav, delivery) {
    return {
      title: 'Delegate to a rider',
      subtitle: 'Hand this delivery to one of the agency’s riders.',
      render: function (page) {
        var ui = UI(), api = API();
        page.content.appendChild(ui.skeletonList(4));
        function load() {
          page.content.innerHTML = '';
          page.content.appendChild(ui.skeletonList(4));
          api.agencyRiders(delivery.driver.id).then(function (res) {
            if (!page.alive) return;
            var riders = (res && res.riders) || [];
            page.content.innerHTML = '';
            if (!riders.length) {
              page.content.appendChild(ui.emptyState({ icon: 'users', title: 'No riders in this agency', body: 'The agency has no active riders to take this delivery yet.' }));
              return;
            }
            var sec = ui.section('Riders', { count: riders.length });
            riders.forEach(function (r) {
              var busy = r.openDeliveries || 0;
              var el = ui.h('<button class="ldx-row" style="--ldx-inset:68px">' + ui.avatar(r.name, 40) +
                '<span class="ldx-row-main"><div class="ldx-row-title"></div><div class="ldx-row-sub"></div></span>' +
                '<span class="ldx-row-end"></span></button>');
              el.querySelector('.ldx-row-title').textContent = r.name;
              el.querySelector('.ldx-row-sub').textContent = r.vehicleType ? r.vehicleType : 'Rider';
              el.querySelector('.ldx-row-end').insertAdjacentHTML('beforeend', ui.badge(busy === 0 ? 'Free' : busy + ' active', busy === 0 ? 'ok' : 'warn'));
              el.setAttribute('aria-label', r.name + ', ' + (busy === 0 ? 'free' : 'on ' + busy + (busy === 1 ? ' delivery' : ' deliveries')));
              el.addEventListener('click', function () {
                ui.confirm({
                  title: 'Delegate to ' + r.name + '?',
                  message: firstName(r.name) + ' will be offered this delivery and accepts it in their app.',
                  confirmLabel: 'Delegate'
                }).then(function (yes) {
                  if (!yes) return;
                  api.delegate(delivery.id, r.id).then(function () {
                    ui.toast('Delegated to ' + firstName(r.name));
                    nav.pop();
                  }).catch(function (err) { ui.toast(ui.errorMessage(err), { tone: 'error' }); load(); });
                });
              });
              sec.group.appendChild(el);
            });
            page.content.appendChild(sec);
          }).catch(function (err) {
            if (!page.alive) return;
            page.content.innerHTML = '';
            page.content.appendChild(ui.errorState(ui.errorMessage(err), load));
          });
        }
        load();
      }
    };
  }

  // --------------------------------------------------------------- triggers
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-open-dispatch]') : null;
    if (!t) return;
    e.preventDefault();
    open({ orderId: t.getAttribute('data-order-id') || null });
  });

  window.LoumooSellerDispatch = { open: open, mount: mount, _bucketOf: bucketOf };
})();
