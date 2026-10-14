/**
 * LOUMOO Provider Profile
 * ---------------------------------------------------------------------------
 * The public marketplace profile of a delivery provider — a rider or an AGENCY:
 * photo, vehicle, the areas they serve, rating, deliveries completed, the fee they
 * quote, a Follow button and recent reviews. An agency says it delivers through
 * its own riders. No phone is ever shown (that is shared only once a delivery is
 * theirs). Built on the shared dispatch UI kit (window.LoumooDispatchUI) and
 * backed by window.deliveryApi (integration items B & C).
 *
 * Following reuses the social graph: a provider is followed by its account id
 * (target_type `user`), the same follow the rest of the app uses — no parallel
 * system.
 *
 * Open it:
 *   window.LoumooProviderProfile.open({ providerId, city })
 *   window.LoumooProviderProfile.openFollowed()        // "Riders & agencies you follow"
 *   <button data-open-provider data-provider-id="…" data-city="…">
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  function UI() { return window.LoumooDispatchUI; }
  function API() { return window.deliveryApi; }

  var VEHICLES = { motorbike: 'Motorbike', bicycle: 'Bicycle', car: 'Car', van: 'Van', tricycle: 'Tricycle', on_foot: 'On foot' };
  function vehicleLabel(v) { return VEHICLES[v] || null; }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || n; }
  function ratingText(r) {
    return (r && r.average) ? (Number(r.average).toFixed(1) + ' ★ · ' + r.count + (r.count === 1 ? ' review' : ' reviews')) : 'New';
  }
  function feeText(ui, feeXaf) { return feeXaf != null ? ui.money(feeXaf) : 'Fee shown at checkout'; }
  function kindLine(p) { return (p.isAgency ? 'Agency' : (vehicleLabel(p.vehicleType) || 'Rider')) + ' · ' + ratingText(p.rating); }

  // ------------------------------------------------------------------ entry
  // open() / openFollowed() are the compatibility entry points: with URL routing active
  // they navigate to the canonical address and the route calls mount() / mountFollowed().
  function open(opts) {
    var o = opts || {};
    if (!o.providerId) return null;
    var R = window.LoumooRouter;
    if (R && R.isActive()) return R.openOverlay('providerProfile', o);
    return mount(o);
  }

  function mount(opts) {
    var ui = UI(), api = API();
    if (!ui || !api) { console.warn('[ProviderProfile] the UI kit or the delivery API is missing'); return null; }
    var o = opts || {};
    if (!o.providerId) return null;
    var nav = ui.openStack({ label: 'Provider', onClose: o.onClose });
    nav.push(profileView(nav, o.providerId, o.city || null));
    return nav;
  }

  function openFollowed(opts) {
    var R = window.LoumooRouter;
    if (R && R.isActive()) return R.openOverlay('providerFollowed', {});
    return mountFollowed(opts);
  }

  function mountFollowed(opts) {
    var ui = UI(), api = API();
    if (!ui || !api) { console.warn('[ProviderProfile] the UI kit or the delivery API is missing'); return null; }
    var nav = ui.openStack({ label: 'Following', onClose: opts && opts.onClose });
    nav.push(followedView(nav));
    return nav;
  }

  // ------------------------------------------------------------- one profile
  function profileView(nav, providerId, city) {
    return {
      title: 'Provider',
      render: function (page) {
        var ui = UI(), api = API();
        var provider = null;

        function load() {
          page.content.innerHTML = '';
          page.content.appendChild(ui.skeletonList(3));
          return api.getProvider(providerId, city).then(function (res) {
            if (!page.alive) return;
            provider = res && res.provider;
            draw();
          }).catch(function (err) {
            if (!page.alive) return;
            page.content.innerHTML = '';
            page.content.appendChild(ui.errorState(ui.errorMessage(err), load));
          });
        }

        function draw() {
          page.content.innerHTML = '';
          page.footer.innerHTML = '';
          if (!provider) {
            page.content.appendChild(ui.emptyState({ icon: 'user', title: 'Provider unavailable', body: 'This rider or agency is not taking deliveries right now.' }));
            return;
          }
          page.setTitle(provider.name, provider.isAgency ? 'Delivery agency' : 'Rider');

          var veh = vehicleLabel(provider.vehicleType);
          var head = ui.h('<div class="ldx-card is-hero ldx-fade-in">' +
            '<div style="display:flex;gap:16px;align-items:center">' +
              ui.avatar(provider.name, 56) +
              '<div style="flex:1;min-width:0"><h2 class="ldx-title2"></h2><p class="ldx-body" style="margin-top:4px"></p></div>' +
            '</div><div class="ldx-meta" style="margin-top:16px"></div></div>');
          head.querySelector('h2').textContent = provider.name;
          head.querySelector('.ldx-body').textContent = kindLine(provider);
          var meta = head.querySelector('.ldx-meta');
          var facts = [['package', (provider.completedDeliveries || 0) + ' delivered']];
          if (veh) facts.push(['scooter', veh]);
          facts.push(['pin', (provider.serviceAreas && provider.serviceAreas.length) ? provider.serviceAreas.map(cap).join(', ') : 'Anywhere']);
          facts.push(['clock', feeText(ui, provider.feeXaf)]);
          facts.forEach(function (f) {
            var span = document.createElement('span');
            span.innerHTML = ui.icon(f[0], 16);
            var t = document.createElement('span');
            t.textContent = ' ' + f[1];
            span.appendChild(t);
            meta.appendChild(span);
          });
          page.content.appendChild(head);

          if (provider.isAgency) {
            page.content.appendChild(ui.h('<div class="ldx-section-foot" style="padding:0 4px 14px">An agency — your order is delivered by one of its own riders.</div>'));
          }

          // Reviews
          var reviews = provider.reviews || [];
          var sec = ui.section('Reviews', { count: reviews.length });
          if (!reviews.length) {
            sec.group.appendChild(ui.h('<div class="ldx-row is-static"><span class="ldx-row-main"><div class="ldx-row-sub is-wrap">No reviews yet.</div></span></div>'));
          }
          reviews.forEach(function (rv) {
            var who = (rv.author && rv.author.name) || 'A customer';
            var el = ui.h('<div class="ldx-row is-static" style="align-items:flex-start;--ldx-inset:68px">' + ui.avatar(who, 40) +
              '<span class="ldx-row-main"><div class="ldx-row-title"></div><div class="ldx-row-sub is-wrap"></div></span></div>');
            el.querySelector('.ldx-row-title').textContent = who;
            el.querySelector('.ldx-row-sub').textContent = rv.note || '';
            sec.group.appendChild(el);
          });
          page.content.appendChild(sec);

          // Follow / Following in the footer, so it stays in reach.
          var following = Boolean(provider.following && provider.following.isFollowing);
          var fBtn = ui.button({ label: following ? 'Following' : 'Follow ' + firstName(provider.name), kind: following ? 'gray' : null, block: true });
          fBtn.addEventListener('click', function () {
            ui.busy(fBtn, function () {
              var call = following ? api.unfollowProvider(providerId) : api.followProvider(providerId);
              return call.then(function () {
                following = !following;
                provider.following = { isFollowing: following };
                draw();
                ui.toast(following ? 'Following ' + firstName(provider.name) : 'Unfollowed', { tone: 'info', duration: 1600 });
              }).catch(function (err) { ui.toast(ui.errorMessage(err), { tone: 'error' }); });
            });
          });
          page.footer.appendChild(fBtn);
        }

        page.reload = load;
        load();
      },
      onResume: function (page) { if (page.reload) page.reload(); }
    };
  }

  // ------------------------------------------------------- followed providers
  function followedView(nav) {
    return {
      title: 'Following',
      subtitle: 'Riders & agencies you follow.',
      render: function (page) {
        var ui = UI(), api = API();

        function load() {
          page.content.innerHTML = '';
          page.content.appendChild(ui.skeletonList(4));
          api.followedProviders().then(function (res) {
            if (!page.alive) return;
            var providers = (res && res.providers) || [];
            page.content.innerHTML = '';
            if (!providers.length) {
              page.content.appendChild(ui.emptyState({ icon: 'users', title: 'No one followed yet', body: 'Follow a rider or agency from their profile to find them again here.' }));
              return;
            }
            var sec = ui.section('Following', { count: providers.length });
            providers.forEach(function (p) {
              var el = ui.h('<button class="ldx-row" style="--ldx-inset:68px">' + ui.avatar(p.name, 40) +
                '<span class="ldx-row-main"><div class="ldx-row-title"></div><div class="ldx-row-sub"></div></span>' +
                '<span class="ldx-row-end">' + ui.icon('forward', 18) + '</span></button>');
              el.querySelector('.ldx-row-title').textContent = p.name;
              el.querySelector('.ldx-row-sub').textContent = kindLine(p);
              el.addEventListener('click', function () { nav.push(profileView(nav, p.id, null)); });
              sec.group.appendChild(el);
            });
            page.content.appendChild(sec);
          }).catch(function (err) {
            if (!page.alive) return;
            page.content.innerHTML = '';
            page.content.appendChild(ui.errorState(ui.errorMessage(err), load));
          });
        }

        page.reload = load;
        load();
      },
      onResume: function (page) { if (page.reload) page.reload(); }
    };
  }

  // --------------------------------------------------------------- triggers
  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    var p = e.target.closest('[data-open-provider]');
    if (p) {
      e.preventDefault();
      var id = p.getAttribute('data-provider-id');
      if (id) open({ providerId: id, city: p.getAttribute('data-city') || null });
      return;
    }
    // A DC template can open the followed list with a plain attribute, no handler.
    var f = e.target.closest('[data-open-followed-providers]');
    if (f) { e.preventDefault(); openFollowed(); }
  });

  window.LoumooProviderProfile = { open: open, openFollowed: openFollowed, mount: mount, mountFollowed: mountFollowed };
})();
