/**
 * LOUMOO Delivery Circuit
 * ---------------------------------------------------------------------------
 * One order passes through four parties: the BUYER places it, the SELLER gets it
 * ready and arranges a rider, the RIDER collects and delivers it, and an ADMIN
 * steps in only when something goes wrong. Every screen in the circuit (the
 * buyer's tracker, the seller's board, the rider's jobs, the admin's riders) must
 * make the same three things obvious: where the order is, whose move it is, and
 * which part the person looking plays. This file is the single source of that, so
 * the four screens cannot drift apart:
 *
 *   - the stage model and the "whose move" rule (pure, tested in Node);
 *   - the plain-language line each role sees at each status;
 *   - a progress strip ("You are the buyer · 3 of 5") any screen can drop in,
 *     including from a DC template, through [data-circuit-strip];
 *   - the order helpers the checkout uses (one order per store, the payload the
 *     server accepts, the server's order mapped back to the app's shape, and a
 *     human reason when an order is refused);
 *   - routing a tapped notification to the screen that notification is about.
 *
 * Exposes window.LoumooCircuit in the browser and module.exports in Node.
 */
(function (global) {
  'use strict';

  var ROLES = ['buyer', 'seller', 'rider', 'admin'];
  var ROLE_NAME = { buyer: 'buyer', seller: 'seller', rider: 'rider', admin: 'administrator' };

  // The five stages of the circuit. `actors` are who the stage involves, which is
  // what lights up "you" on the strip; `label` is what the stage is called.
  var STAGES = [
    { key: 'placed', label: 'Order placed', actors: ['buyer'] },
    { key: 'rider', label: 'Rider arranged', actors: ['seller'] },
    { key: 'collect', label: 'Parcel collected', actors: ['rider', 'seller'] },
    { key: 'transit', label: 'On the way', actors: ['rider'] },
    { key: 'handover', label: 'Handed over', actors: ['buyer', 'rider'] }
  ];

  // Delivery status -> index of the stage that is in progress. `none` is an order
  // with no delivery yet, which is the normal first state, not an error.
  var STAGE_OF = {
    none: 1,
    pending_assignment: 1,
    assigned: 1,
    accepted: 2,
    picked_up: 3,
    arrived: 4,
    delivered: 5, // past the last stage: all done
    failed: 1,
    cancelled: 1
  };

  // Who must act for the order to advance, at each status. At the door two people
  // act together: the buyer reads the code out and the rider enters it.
  var MOVE_OF = {
    none: ['seller'],
    pending_assignment: ['seller'],
    assigned: ['rider'],
    accepted: ['rider'],
    picked_up: ['rider'],
    arrived: ['buyer', 'rider'],
    failed: ['seller'],
    delivered: [],
    cancelled: []
  };

  // What each role is told at each status: [headline, detail]. The headline says
  // the move when it is theirs ("Your move: ..."), otherwise what is happening.
  var LINES = {
    none: {
      buyer: ['The seller is getting your order ready', 'They will arrange a rider shortly. We will notify you.'],
      seller: ['Your move: arrange the delivery', 'Create the delivery and offer it to a rider.'],
      rider: ['Not assigned to you', 'This order has no delivery yet.'],
      admin: ['Waiting for the seller', 'No delivery has been arranged for this order yet.']
    },
    pending_assignment: {
      buyer: ['Finding you a rider', 'The seller is choosing who will bring your order.'],
      seller: ['Your move: choose a rider', 'Pick a rider yourself, or let LOUMOO pick the one with the least work.'],
      rider: ['Not assigned to you', 'No rider has been chosen yet.'],
      admin: ['Waiting for the seller', 'No rider has been chosen yet.']
    },
    assigned: {
      buyer: ['A rider is being asked', 'We will tell you as soon as they accept.'],
      seller: ['Waiting for the rider to answer', 'If they do not answer in time, the delivery comes back to you.'],
      rider: ['Your move: accept or decline', 'Check the pickup and the drop-off area, then answer before the offer runs out.'],
      admin: ['Waiting for the rider to answer', 'The offer returns to the seller if it lapses.']
    },
    accepted: {
      buyer: ['Your rider is on the way to collect', 'Next they pick up your parcel and head to you.'],
      seller: ['Have the parcel ready', 'The rider is coming to collect it.'],
      rider: ['Your move: collect the parcel', 'Go to the pickup, then tap Picked up.'],
      admin: ['Rider heading to the seller', 'Nothing needed from you.']
    },
    picked_up: {
      buyer: ['Your order is on its way', 'Follow the rider live and keep your handover code ready.'],
      seller: ['The parcel is with the rider', 'It is on its way to the customer.'],
      rider: ['Your move: deliver the parcel', 'Drive to the drop-off, then tap Arrived.'],
      admin: ['Out for delivery', 'Nothing needed from you.']
    },
    arrived: {
      buyer: ['Your move: give the rider your code', 'Read your 4-digit code out to the rider to receive your order.'],
      seller: ['The rider is at the customer', 'The handover is about to be confirmed.'],
      rider: ['Your move: enter the customer’s code', 'Ask for the 4-digit code, then confirm the handover.'],
      admin: ['Handover in progress', 'Nothing needed from you unless it locks.']
    },
    delivered: {
      buyer: ['Delivered', 'Your order was handed over. Enjoy it!'],
      seller: ['Delivered', 'The customer confirmed the handover with their code.'],
      rider: ['Delivery complete', 'The handover was confirmed. Thank you.'],
      admin: ['Delivered', 'Completed normally.']
    },
    failed: {
      buyer: ['The delivery did not work out', 'The seller will arrange another attempt.'],
      seller: ['Your move: try another rider', 'The last attempt failed. Offer the delivery to a rider again.'],
      rider: ['Marked as failed', 'The seller will arrange another attempt.'],
      admin: ['Delivery attempt failed', 'The seller can offer it to a rider again.']
    },
    cancelled: {
      buyer: ['Delivery cancelled', 'The seller can arrange a new one.'],
      seller: ['Delivery cancelled', 'You can arrange a new delivery for this order.'],
      rider: ['Delivery cancelled', 'You do not need to do this one.'],
      admin: ['Delivery cancelled', 'The seller can arrange a new one.']
    }
  };

  var YOU_ARE = {
    buyer: 'You are the buyer',
    seller: 'You are the seller',
    rider: 'You are the rider',
    admin: 'You are an administrator'
  };

  function statusOf(delivery) {
    var s = delivery && delivery.status;
    return Object.prototype.hasOwnProperty.call(STAGE_OF, s) ? s : 'none';
  }

  // The delivery API names the rider's view `driver` (DELIVERY_API.md, `viewerRole`);
  // everywhere in the app the person is "the rider".
  var ROLE_ALIASES = { driver: 'rider' };

  function normaliseRole(role) {
    var r = ROLE_ALIASES[role] || role;
    return ROLES.indexOf(r) === -1 ? 'buyer' : r;
  }

  /**
   * Where the order is, whose move it is and what to say, for one viewer.
   * `delivery` may be null (no delivery yet). Never throws on odd input.
   */
  function model(delivery, role) {
    var r = normaliseRole(role || (delivery && delivery.viewerRole));
    var status = statusOf(delivery);
    var current = STAGE_OF[status];
    var problem = status === 'failed' || status === 'cancelled';
    var stages = STAGES.map(function (s, i) {
      var state = i < current ? 'done' : (i === current ? 'current' : 'todo');
      if (problem && i === current) state = 'problem';
      return { key: s.key, label: s.label, actors: s.actors.slice(), state: state, you: s.actors.indexOf(r) !== -1 };
    });
    var movers = MOVE_OF[status].slice();
    var line = (LINES[status] && LINES[status][r]) || ['', ''];
    return {
      role: r,
      youAre: YOU_ARE[r],
      status: status,
      step: Math.min(current + 1, STAGES.length),
      total: STAGES.length,
      done: status === 'delivered',
      problem: problem,
      movers: movers,
      yourMove: movers.indexOf(r) !== -1,
      headline: line[0],
      detail: line[1],
      stages: stages
    };
  }

  // ------------------------------------------------------------------ rendering

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var ACTOR_NAME = { buyer: 'Buyer', seller: 'Seller', rider: 'Rider', admin: 'Admin' };

  /**
   * The strip, as an HTML string. Every dynamic value goes through esc(). The
   * viewer's own stages carry a "You" tag, and the banner says whether the next
   * move is theirs.
   */
  function renderStrip(delivery, role, opts) {
    injectStyles(); // harmless in Node; makes the strip look right wherever it is dropped in
    var m = model(delivery, role);
    var steps = m.stages.map(function (s, i) {
      var mark = s.state === 'done' ? '✓' : (s.state === 'problem' ? '!' : String(i + 1));
      var who = s.actors.map(function (a) { return ACTOR_NAME[a]; }).join(' + ');
      return '<li class="lcx-step ' + esc(s.state) + (s.you ? ' you' : '') + '"' +
        (s.state === 'current' || s.state === 'problem' ? ' aria-current="step"' : '') + '>' +
        '<span class="lcx-dot" aria-hidden="true">' + mark + '</span>' +
        '<span class="lcx-lbl">' + esc(s.label) + '</span>' +
        '<span class="lcx-who">' + esc(who) + (s.you ? ' <b>· you</b>' : '') + '</span>' +
        '</li>';
    }).join('');
    var banner = m.yourMove ? 'mine' : (m.problem ? 'problem' : (m.done ? 'done' : 'wait'));
    return '<section class="lcx" role="group" aria-label="Delivery progress">' +
      '<div class="lcx-top"><span class="lcx-role">' + esc(m.youAre) + '</span>' +
      '<span class="lcx-count">' + (m.done ? 'Complete' : 'Step ' + m.step + ' of ' + m.total) + '</span></div>' +
      '<ol class="lcx-steps">' + steps + '</ol>' +
      // A screen whose own hero already says this (the seller's board) can hide it.
      (opts && opts.banner === false ? '' : '<div class="lcx-move ' + banner + '" role="status"><b>' + esc(m.headline) + '</b><span>' + esc(m.detail) + '</span></div>') +
      (opts && opts.note ? '<p class="lcx-note">' + esc(opts.note) + '</p>' : '') +
      '</section>';
  }

  var STYLE_ID = 'loumoo-lcx-styles';
  var CSS = [
    '.lcx{display:flex;flex-direction:column;gap:12px;font-family:var(--font-body,system-ui,sans-serif);color:var(--color-text,#111)}',
    '.lcx-top{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.lcx-role{font:700 11px/1.2 var(--font-heading,inherit);letter-spacing:.06em;text-transform:uppercase;color:var(--color-text,#111)}',
    '.lcx-count{font:600 11.5px/1.2 var(--font-body,inherit);color:var(--color-text-secondary,#555)}',
    '.lcx-steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px}',
    '.lcx-step{display:flex;flex-direction:column;align-items:center;text-align:center;gap:5px;min-width:0;position:relative}',
    '.lcx-step::before{content:"";position:absolute;top:13px;left:-50%;width:100%;height:2px;background:var(--color-divider,#d9d9d9);z-index:0}',
    '.lcx-step:first-child::before{display:none}',
    '.lcx-step.done::before,.lcx-step.current::before,.lcx-step.problem::before{background:var(--color-success,#1a9d4b)}',
    '.lcx-dot{position:relative;z-index:1;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 12px/1 var(--font-heading,inherit);background:var(--color-surface,#fff);border:2px solid var(--color-divider,#cfcfcf);color:var(--color-text-secondary,#555)}',
    '.lcx-step.done .lcx-dot{background:var(--color-success,#1a9d4b);border-color:var(--color-success,#1a9d4b);color:#fff}',
    '.lcx-step.current .lcx-dot{background:var(--color-accent,#0a63e8);border-color:var(--color-accent,#0a63e8);color:#fff;box-shadow:0 0 0 4px rgba(0,122,255,.22)}',
    '.lcx-step.problem .lcx-dot{background:var(--color-danger,#c62828);border-color:var(--color-danger,#c62828);color:#fff}',
    '.lcx-lbl{font:600 11px/1.25 var(--font-body,inherit);color:var(--color-text,#111);overflow-wrap:anywhere}',
    '.lcx-who{font:500 10px/1.25 var(--font-body,inherit);color:var(--color-text-secondary,#555);overflow-wrap:anywhere}',
    '.lcx-who b{font-weight:800;color:var(--color-text,#111)}',
    '.lcx-step.you .lcx-lbl{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px;text-decoration-color:var(--color-accent,#0a63e8)}',
    '.lcx-move{display:flex;flex-direction:column;gap:2px;padding:11px 14px;border-radius:var(--radius-md,12px);border-left:4px solid var(--color-divider,#cfcfcf);background:var(--color-surface-subtle,#f4f5f7)}',
    '.lcx-move b{font:700 14px/1.3 var(--font-heading,inherit);color:var(--color-text,#111)}',
    '.lcx-move span{font:400 12.5px/1.4 var(--font-body,inherit);color:var(--color-text-secondary,#4a4a4a)}',
    // Tints are translucent colour laid over the themed surface, not the pale
    // "-100" tokens: those stay light in dark mode and would put light text on them.
    '.lcx-move.mine{border-left-color:var(--color-accent,#0a63e8);background-image:linear-gradient(rgba(0,122,255,.13),rgba(0,122,255,.13))}',
    '.lcx-move.done{border-left-color:var(--color-success,#1a9d4b);background-image:linear-gradient(rgba(0,200,83,.15),rgba(0,200,83,.15))}',
    '.lcx-move.problem{border-left-color:var(--color-danger,#c62828);background-image:linear-gradient(rgba(217,45,32,.14),rgba(217,45,32,.14))}',
    '.lcx-note{margin:0;font:400 11.5px/1.4 var(--font-body,inherit);color:var(--color-text-secondary,#555)}',
    '@media (prefers-reduced-motion:no-preference){.lcx-dot{transition:background .2s,border-color .2s}}'
  ].join('\n');

  function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  // ------------------------------------------------------------ mounted strips
  // A DC template cannot call into this file, so it drops in
  //   <div data-circuit-strip data-order-id="..." data-role="buyer"></div>
  // and the strip fills itself from the delivery API and keeps itself fresh.

  var REFRESH_MS = 15000;
  var mounted = [];

  function stripHost(el) {
    return { el: el, orderId: null, timer: null, busy: false };
  }

  function fetchDelivery(orderId) {
    var api = global.deliveryApi;
    if (!api || !api.getByOrder) return Promise.reject(new Error('delivery api unavailable'));
    return api.getByOrder(orderId).then(function (res) { return (res && res.delivery) || null; });
  }

  // The order screen has just read this delivery. Hand it to the tracker so that a tap on
  // "Track live delivery" paints at once and, only when a rider is on it, so that the map
  // library starts downloading now rather than after the tap. A rider-less delivery has no
  // live map worth the data. It is a speculative nicety and must never break the screen.
  var WARM_STATUSES = ['assigned', 'accepted', 'picked_up', 'arrived'];
  function speculateTracking(delivery) {
    if (!delivery) return;
    try {
      var tracker = global.LoumooDeliveryTracking;
      if (!tracker) return;
      if (typeof tracker.prime === 'function') tracker.prime(delivery);
      if (typeof tracker.warm === 'function' && WARM_STATUSES.indexOf(delivery.status) !== -1) tracker.warm(true);
    } catch (e) { /* never break the page */ }
  }

  function paint(host) {
    var el = host.el;
    var orderId = el.getAttribute('data-order-id');
    var role = el.getAttribute('data-role') || 'buyer';
    if (!orderId) { el.innerHTML = ''; return; }
    if (host.busy) return;
    host.busy = true;
    fetchDelivery(orderId).then(function (delivery) {
      el.innerHTML = renderStrip(delivery, role);
      speculateTracking(delivery);
    }, function (err) {
      // 404 means "no delivery yet", the normal first state. Anything else is a
      // real failure: say so rather than imply the order is simply waiting.
      if (err && err.status === 404) el.innerHTML = renderStrip(null, role);
      else el.innerHTML = '<p class="lcx-note">Delivery progress is unavailable right now. Pull to refresh in a moment.</p>';
    }).then(function () { host.busy = false; });
  }

  function sync() {
    if (typeof document === 'undefined') return;
    injectStyles();
    // Drop hosts whose element left the page, and stop their timers.
    mounted = mounted.filter(function (h) {
      if (document.documentElement.contains(h.el)) return true;
      if (h.timer) clearInterval(h.timer);
      return false;
    });
    var found = document.querySelectorAll('[data-circuit-strip]');
    for (var i = 0; i < found.length; i++) {
      var el = found[i];
      var host = null;
      for (var j = 0; j < mounted.length; j++) if (mounted[j].el === el) { host = mounted[j]; break; }
      var orderId = el.getAttribute('data-order-id');
      if (!host) {
        host = stripHost(el);
        mounted.push(host);
        host.timer = setInterval(function (h) { return function () { if (!document.hidden) paint(h); }; }(host), REFRESH_MS);
        host.orderId = orderId;
        paint(host);
      } else if (host.orderId !== orderId) {
        host.orderId = orderId;
        paint(host);
      }
    }
  }

  // A short timer, not requestAnimationFrame: a frame callback never fires in a
  // hidden or throttled tab, and a strip that waits for one would stay empty.
  var syncScheduled = false;
  function scheduleSync() {
    if (syncScheduled) return;
    syncScheduled = true;
    setTimeout(function () {
      syncScheduled = false;
      try { sync(); } catch (e) { /* never break the page */ }
    }, 50);
  }

  function init() {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    var start = function () {
      // Attributes too: a DC template renders the element first and fills in the
      // order id a moment later, so the id arrives as an attribute change.
      new MutationObserver(scheduleSync).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-order-id', 'data-role']
      });
      scheduleSync();
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }

  // ------------------------------------------------------ notification routing

  /**
   * Opens the screen a delivery or order notification is about. Accepts either a
   * server notification row or just its metadata. Returns true when a screen was
   * opened, so the caller knows whether the tap did anything.
   */
  function openFromNotification(input) {
    var m = (input && input.metadata) || input || {};
    var g = global;
    switch (m.action) {
      case 'track_order':
        if (g.LoumooDeliveryTracking && (m.deliveryId || m.orderId)) {
          g.LoumooDeliveryTracking.open(m.deliveryId ? { deliveryId: m.deliveryId } : { orderId: m.orderId });
          return true;
        }
        return false;
      case 'open_dispatch':
        if (g.LoumooSellerDispatch) { g.LoumooSellerDispatch.open(m.orderId ? { orderId: m.orderId } : undefined); return true; }
        return false;
      case 'open_rider_hub':
        if (g.LoumooRiderHub) { g.LoumooRiderHub.open(); return true; }
        return false;
      case 'open_riders_admin':
        if (g.LoumooRidersAdmin) { g.LoumooRidersAdmin.open(); return true; }
        return false;
      default:
        return false;
    }
  }

  // --------------------------------------------------------------- order helpers

  function money(xaf) {
    var n = Number(xaf);
    if (!isFinite(n)) return '';
    return 'XAF ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /**
   * Splits a bag into one group per store. An order belongs to exactly one seller
   * (the server refuses a mixed bag), so a bag from several stores becomes several
   * orders, each delivered by its own seller. Order of first appearance is kept.
   */
  function groupByStore(items) {
    var groups = [];
    (items || []).forEach(function (it) {
      var store = (it && (it.store || it.storeName)) || 'LOUMOO seller';
      var g = null;
      for (var i = 0; i < groups.length; i++) if (groups[i].store === store) { g = groups[i]; break; }
      if (!g) { g = { store: store, items: [] }; groups.push(g); }
      g.items.push(it);
    });
    return groups;
  }

  /**
   * The body POST /api/v1/orders accepts. No totals: the server prices the order
   * (items, then the city's delivery fee) and a client total that disagrees is
   * refused as a "pricing mismatch". The unit price IS sent, so a price that
   * changed since the bag was filled is caught instead of charged.
   *
   * `deliveryMethod` is how the buyer chose to receive the order — 'HOME_DELIVERY'
   * (a rider brings it; needs a full address) or 'STORE_PICKUP' (they collect it;
   * no address, and the server charges no delivery fee). Anything else, or
   * nothing, is treated as a home delivery, which is both the common case and the
   * safe default (it is the one that asks for an address).
   */
  function toOrderPayload(items, address, deliveryMethod, preferredDriverId) {
    var a = address || {};
    var method = deliveryMethod === 'STORE_PICKUP' ? 'STORE_PICKUP' : 'HOME_DELIVERY';
    var payload = {
      items: (items || []).map(function (it) {
        var id = String(it.listingId || it.productId || it.id || '');
        return {
          id: id,
          listingId: id,
          quantity: Math.max(1, parseInt(it.qty, 10) || 1),
          unitPriceXaf: Math.round(Number(it.priceXaf) || 0),
          title: String(it.name || it.title || 'Product').slice(0, 255)
        };
      }),
      shippingAddress: {
        fullName: a.fullName || a.name || undefined,
        phone: a.phone || undefined,
        street: a.street || undefined,
        city: a.city || undefined,
        neighbourhood: a.neighbourhood || undefined
      },
      deliveryMethod: method
    };
    // The provider the buyer preferred, only for a home delivery. A hint for the
    // seller's dispatch — the server re-checks it and prices by it — never sent
    // for a pickup (no rider), and omitted entirely when there is no preference.
    if (method === 'HOME_DELIVERY' && preferredDriverId) {
      payload.preferredDriverId = String(preferredDriverId);
    }
    return payload;
  }

  /**
   * The server's order, in the shape the app's screens read. `ctx.images` maps a
   * listing id to the picture the shopper saw (the server does not store one),
   * `ctx.paymentMethod` is what they chose at checkout.
   */
  function orderFromServer(o, ctx) {
    var c = ctx || {};
    var ship = o.shippingAddress || {};
    var items = (o.items || []).map(function (it) {
      return {
        id: it.listingId,
        name: it.title,
        image: it.imageUrl || (c.images && c.images[it.listingId]) || '',
        priceXaf: it.unitPriceXaf,
        qty: it.quantity,
        store: it.storeName || '',
        storePhone: it.storePhone || null
      };
    });
    var first = items[0] || {};
    var created = Date.parse(o.createdAt);
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      serverSynced: true,
      status: o.fulfillmentStatus || 'processing',
      paymentStatus: o.paymentStatus || 'pending',
      paymentMethod: c.paymentMethod || 'Pay on delivery',
      deliveryMethod: o.deliveryMethod || 'HOME_DELIVERY',
      items: items,
      itemCount: items.reduce(function (n, it) { return n + (Number(it.qty) || 1); }, 0),
      subtotalXaf: o.subtotalXaf,
      shippingFeeXaf: o.shippingFeeXaf,
      totalXaf: o.totalAmountXaf,
      escrowXaf: 0,
      seller: first.store || 'the seller',
      sellerPhone: o.sellerPhone || first.storePhone || null,
      sellerWhatsapp: o.sellerWhatsapp || o.sellerPhone || first.storePhone || null,
      address: { name: ship.fullName || '', phone: ship.phone || '', city: ship.city || '', street: ship.street || '' },
      createdAt: isFinite(created) ? created : Date.now(),
      // A one-time placement notice from the server (e.g. the chosen delivery
      // provider was unavailable and the order fell back to the city rate). The
      // checkout shows it once; it is not persisted on the order.
      deliveryNotice: o.deliveryNotice || null
    };
  }

  /**
   * Folds the server's orders into the list kept on the device. A server order
   * replaces its local copy (the server is the truth for status) but keeps the
   * picture and payment label the device knew. A device-only order, from before
   * orders were sent to the server, stays visible and is marked as never sent.
   */
  function mergeOrders(local, serverOrders) {
    var byId = {};
    (local || []).forEach(function (o) { if (o && o.id) byId[o.id] = o; });
    var merged = (serverOrders || []).map(function (s) {
      var known = byId[s.id];
      if (!known) return s;
      s.items = s.items.map(function (it, i) {
        var was = (known.items || [])[i];
        return it.image || !was ? it : Object.assign({}, it, { image: was.image || '' });
      });
      if (known.paymentMethod) s.paymentMethod = known.paymentMethod;
      return s;
    });
    var kept = {};
    merged.forEach(function (o) { kept[o.id] = true; });
    (local || []).forEach(function (o) {
      if (!o) return;
      if (o.id) { if (!kept[o.id]) merged.push(o); } // not in this page of results: keep it
      else merged.push(Object.assign({}, o, { serverSynced: false }));
    });
    return merged.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }

  var STATUS_LABEL = {
    processing: 'PREPARING',
    in_transit: 'OUT FOR DELIVERY',
    delivered: 'DELIVERED',
    cancelled: 'CANCELLED'
  };

  function orderStatusLabel(order) {
    if (!order) return '';
    // No server id (or flagged as such) means it only ever existed on this device.
    if (order.serverSynced === false || !order.id) return 'NOT SENT';
    return STATUS_LABEL[order.status] || 'PLACED';
  }

  /**
   * Why an order was not placed, in words a shopper can act on. `items` is the bag,
   * so a refused product can be named. `kind` lets the caller decide what to do:
   * 'auth' (sign in), 'unavailable' (remove those items), 'invalid' / 'stock' /
   * 'network' / 'server' (fix or retry; the bag is kept).
   */
  function explainOrderError(err, items) {
    var e = err || {};
    var status = Number(e.status) || 0;
    var message = String(e.message || '');
    if (status === 401 || e.code === 'UNAUTHENTICATED') {
      return { kind: 'auth', message: 'Your session ended. Sign in to place your order.', itemIds: [] };
    }
    if (status === 403) {
      // The account may not buy yet (email not verified, onboarding unfinished):
      // the server says what to do next, so show that rather than "try again".
      return { kind: 'account', message: message || 'Finish setting up your LOUMOO account to place an order.', itemIds: [] };
    }
    if (e.status === 0 || e.code === 'OFFLINE') {
      return { kind: 'network', message: 'You seem to be offline. Your bag is saved: try again when you are connected.', itemIds: [] };
    }
    if (status === 404) {
      var hit = (items || []).filter(function (it) { return it && it.id && message.indexOf(String(it.id)) !== -1; });
      var named = hit.map(function (it) { return it.name || it.title || 'an item'; });
      return {
        kind: 'unavailable',
        message: named.length
          ? named.join(', ') + (named.length === 1 ? ' is' : ' are') + ' a showcase item and cannot be ordered yet. Remove it from your bag to continue.'
          : 'One of the items in your bag cannot be ordered yet. Remove it to continue.',
        itemIds: hit.map(function (it) { return it.id; })
      };
    }
    if (status === 409) return { kind: 'stock', message: message || 'An item in your bag just ran out of stock.', itemIds: [] };
    if (status === 400) return { kind: 'invalid', message: message || 'We could not place this order. Check your bag and address.', itemIds: [] };
    if (status === 429) return { kind: 'server', message: 'Too many attempts. Wait a moment and try again.', itemIds: [] };
    return { kind: 'server', message: 'LOUMOO is temporarily unavailable. Your bag is saved: try again in a moment.', itemIds: [] };
  }

  /** A ready-made card holding the strip, for the vanilla-DOM delivery screens. */
  function stripCard(delivery, role, opts) {
    if (typeof document === 'undefined') return null;
    var el = document.createElement('div');
    el.className = 'ldx-card';
    el.style.padding = '14px 16px';
    el.innerHTML = renderStrip(delivery, role, opts);
    return el;
  }

  var api = {
    ROLES: ROLES,
    ROLE_NAME: ROLE_NAME,
    STAGES: STAGES,
    model: model,
    renderStrip: renderStrip,
    stripCard: stripCard,
    openFromNotification: openFromNotification,
    speculateTracking: speculateTracking,
    sync: sync,
    money: money,
    groupByStore: groupByStore,
    toOrderPayload: toOrderPayload,
    orderFromServer: orderFromServer,
    mergeOrders: mergeOrders,
    orderStatusLabel: orderStatusLabel,
    explainOrderError: explainOrderError
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global && typeof global.document !== 'undefined') {
    global.LoumooCircuit = api;
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
