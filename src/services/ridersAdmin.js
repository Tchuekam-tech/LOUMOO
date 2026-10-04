/**
 * LOUMOO Riders admin
 * ---------------------------------------------------------------------------
 * For administrators: the rider roster (all / active / suspended, searchable),
 * adding a rider by finding their LOUMOO account, editing a rider's name and
 * phone, and suspending or reactivating them. Suspension takes a rider off new
 * offers and hands their un-started jobs back to the sellers (the server does it).
 *
 * Backed by window.deliveryApi (docs/DELIVERY_API.md v1.2: GET /drivers?status=,
 * POST /drivers/:profileId; the account search uses the SuperAdmin user
 * directory), drawn with window.LoumooDispatchUI.
 *
 *   <button data-open-riders-admin>Riders</button>
 *   window.LoumooRidersAdmin.open()
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  function UI() { return window.LoumooDispatchUI; }
  function API() { return window.deliveryApi; }

  function open() {
    var ui = UI(), api = API();
    if (!ui || !api) { console.warn('[RidersAdmin] the UI kit or the delivery API is missing'); return null; }
    var nav = ui.openStack({ label: 'Riders' });
    nav.push(rosterView(nav));
    return nav;
  }

  function rosterView(nav) {
    return {
      title: 'Riders',
      subtitle: 'Who can be offered deliveries.',
      render: function (page) {
        var ui = UI(), api = API();
        var riders = null, filter = 'all', query = '';
        page.setRight([{ icon: 'plus', label: 'Add rider', onClick: function () { nav.push(addView(nav)); } }]);
        var seg = ui.segmented([{ label: 'All', value: 'all' }, { label: 'Active', value: 'active' }, { label: 'Suspended', value: 'suspended' }], 'all', function (v) { filter = v; draw(); });
        page.content.appendChild(seg);
        page.content.appendChild(ui.searchField({ placeholder: 'Search by name or phone', onInput: function (q) { query = q.toLowerCase(); draw(); } }));
        var body = document.createElement('div');
        page.content.appendChild(body);
        body.appendChild(ui.skeletonList(5));

        function load() {
          return api.riderRoster('all').then(function (res) {
            if (!page.alive) return;
            riders = res.drivers || [];
            draw();
          }).catch(function (err) {
            if (!page.alive) return;
            body.innerHTML = '';
            if (err && err.status === 403) body.appendChild(ui.emptyState({ icon: 'lock', tone: 'muted', title: 'Administrators only', body: 'Sign in with an administrator account to manage riders.' }));
            else body.appendChild(ui.errorState(ui.errorMessage(err), function () { body.innerHTML = ''; body.appendChild(ui.skeletonList(5)); load(); }));
          });
        }

        function draw() {
          if (!riders) return;
          body.innerHTML = '';
          var active = riders.filter(function (r) { return r.status === 'active'; });
          var suspended = riders.filter(function (r) { return r.status !== 'active'; });
          seg.setCount('active', active.length);
          seg.setCount('suspended', suspended.length);
          if (!riders.length) {
            body.appendChild(ui.emptyState({ icon: 'users', title: 'No riders yet', body: 'Add the people who deliver for LOUMOO. They need a LOUMOO account first.', actionLabel: 'Add a rider', actionKind: 'filled', onAction: function () { nav.push(addView(nav)); } }));
            return;
          }
          var pool = filter === 'active' ? active : filter === 'suspended' ? suspended : riders;
          var shown = pool.filter(function (r) {
            return !query || String(r.name || '').toLowerCase().indexOf(query) !== -1 || String(r.phone || '').replace(/\s/g, '').indexOf(query.replace(/\s/g, '')) !== -1;
          });
          if (!shown.length) {
            body.appendChild(ui.emptyState({ icon: 'search', title: query ? 'No matches' : 'Nobody here', body: query ? 'No rider matches “' + query + '”.' : (filter === 'suspended' ? 'No rider is suspended.' : 'No active riders.') }));
            return;
          }
          var sec = ui.section(filter === 'all' ? 'All riders' : filter === 'active' ? 'Active' : 'Suspended', { count: shown.length });
          shown.forEach(function (r) {
            var el = ui.h('<button class="ldx-row" style="--ldx-inset:68px">' + ui.avatar(r.name, 40) + '<span class="ldx-row-main"><div class="ldx-row-title"></div><div class="ldx-row-sub"></div></span><span class="ldx-row-end"></span></button>');
            el.querySelector('.ldx-row-title').textContent = r.name;
            // Active is the norm, so only a suspension gets a badge; that leaves
            // room for the phone and the rider's current load on one line.
            var work = r.openDeliveries ? (r.openDeliveries + (r.openDeliveries === 1 ? ' delivery' : ' deliveries')) : 'Free';
            el.querySelector('.ldx-row-sub').textContent = [r.phone, r.status === 'active' ? work : null].filter(Boolean).join(' · ');
            el.querySelector('.ldx-row-end').innerHTML = (r.status === 'active' ? '' : ui.badge('Suspended', 'muted')) + ui.icon('forward', 18);
            el.setAttribute('aria-label', [r.name, r.status === 'active' ? work : 'suspended', r.phone].filter(Boolean).join(', '));
            if (r.status !== 'active') el.querySelector('.ldx-avatar').style.filter = 'grayscale(1)';
            el.addEventListener('click', function () { editSheet(r, load); });
            sec.group.appendChild(el);
          });
          body.appendChild(sec);
        }

        page.reload = load;
        load();
      },
      onResume: function (page) { if (page.reload) page.reload(); }
    };
  }

  function editSheet(r, onSaved) {
    var ui = UI(), api = API();
    var form = ui.h(
      '<div>' +
        '<div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:4px 0 18px">' + ui.avatar(r.name, 64) + '<div class="ldx-statusline"></div></div>' +
        '<div class="ldx-group">' +
          '<label class="ldx-field"><span>Name</span><input name="name" maxlength="120" autocomplete="name"></label>' +
          '<label class="ldx-field"><span>Phone (shown to customers)</span><input name="phone" maxlength="32" inputmode="tel" autocomplete="tel"></label>' +
        '</div>' +
        '<div class="ldx-hint"></div>' +
        '<div class="ldx-error-text" hidden></div>' +
        '<div class="ldx-sheet-actions" style="padding:16px 0 4px"></div>' +
      '</div>'
    );
    form.querySelector('.ldx-statusline').innerHTML = r.status === 'active' ? ui.badge('Active', 'ok') : ui.badge('Suspended', 'muted');
    form.querySelector('[name=name]').value = r.name || '';
    form.querySelector('[name=phone]').value = r.phone || '';
    form.querySelector('.ldx-hint').textContent = r.status === 'active'
      ? (r.openDeliveries ? 'Carrying ' + r.openDeliveries + (r.openDeliveries === 1 ? ' delivery' : ' deliveries') + ' right now.' : 'Not carrying any delivery right now.')
      : 'Suspended riders get no offers and can’t work on a delivery.';
    var err = form.querySelector('.ldx-error-text');
    var save = ui.button({ label: 'Save changes', block: true });
    var toggle = r.status === 'active'
      ? ui.button({ label: 'Suspend rider', kind: 'destructive', block: true })
      : ui.button({ label: 'Reactivate rider', kind: 'tinted', block: true });
    var actions = form.querySelector('.ldx-sheet-actions');
    actions.appendChild(save);
    actions.appendChild(toggle);
    var s = ui.sheet({ title: r.name, body: form });

    function values() {
      return { name: form.querySelector('[name=name]').value.trim(), phone: form.querySelector('[name=phone]').value.trim() };
    }
    function valid(v) {
      if (!v.name) return 'Enter the rider’s name.';
      if (v.phone.replace(/\D/g, '').length < 6) return 'Enter a phone number customers can call.';
      return null;
    }
    // Save stays off until something actually changed.
    var original = values();
    save.disabled = true;
    form.addEventListener('input', function () {
      var v = values();
      save.disabled = v.name === original.name && v.phone === original.phone;
    });
    function submit(btn, status, doneMessage) {
      var v = values();
      var problem = valid(v);
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      err.hidden = true;
      ui.busy(btn, function () {
        return api.registerDriver(r.id, { name: v.name, phone: v.phone, status: status }).then(function () {
          s.close(true);
          ui.toast(doneMessage);
          if (onSaved) onSaved();
        }).catch(function (e) { err.textContent = ui.errorMessage(e); err.hidden = false; });
      });
    }
    save.addEventListener('click', function () { submit(save, undefined, 'Rider updated'); });
    toggle.addEventListener('click', function () {
      if (r.status !== 'active') return submit(toggle, 'active', r.name + ' can take deliveries again');
      ui.confirm({
        title: 'Suspend ' + r.name + '?',
        message: 'They get no new offers. Deliveries they haven’t collected go back to the sellers; one already collected needs an administrator to resolve.',
        confirmLabel: 'Suspend', destructive: true
      }).then(function (yes) { if (yes) submit(toggle, 'suspended', r.name + ' is suspended'); });
    });
  }

  function addView(nav) {
    return {
      title: 'Add a rider',
      subtitle: 'Find their LOUMOO account, then confirm the details customers will see.',
      render: function (page) {
        var ui = UI(), api = API();
        var results = document.createElement('div');
        var search = ui.searchField({
          placeholder: 'Name, email or phone',
          debounce: 300,
          onInput: function (q) { find(q); }
        });
        page.content.appendChild(search);
        page.content.appendChild(results);
        var manual = ui.section(null, { foot: 'Already know the account ID? Paste it here.' });
        var idRow = ui.h('<label class="ldx-field"><span>Account ID</span><input name="pid" autocomplete="off" spellcheck="false" placeholder="e.g. 3f6c…"></label>');
        manual.group.appendChild(idRow);
        var useId = ui.button({ label: 'Use this ID', kind: 'tinted', size: 'medium' });
        useId.style.margin = '10px 0 0';
        manual.appendChild(useId);
        page.content.appendChild(manual);
        useId.addEventListener('click', function () {
          var id = idRow.querySelector('input').value.trim();
          if (!id) { idRow.querySelector('input').focus(); return; }
          confirmSheet({ id: id, name: '', phone: '' });
        });
        intro();
        setTimeout(function () { search.input.focus(); }, 300);

        function intro() {
          results.innerHTML = '';
          results.appendChild(ui.emptyState({ icon: 'search', title: 'Search accounts', body: 'Riders sign up like any customer. Find them here to give them rider access.' }));
        }

        var seq = 0;
        function find(q) {
          if (!q || q.length < 2) return intro();
          var mine = ++seq;
          results.innerHTML = '';
          results.appendChild(ui.skeletonList(3));
          api.searchUsers(q).then(function (users) {
            if (mine !== seq || !page.alive) return;
            results.innerHTML = '';
            if (!users.length) { results.appendChild(ui.emptyState({ icon: 'user', title: 'No account found', body: 'Check the spelling, or ask the rider to create a LOUMOO account first.' })); return; }
            var sec = ui.section('Accounts', { count: users.length });
            users.forEach(function (u) {
              var el = ui.h('<button class="ldx-row" style="--ldx-inset:68px">' + ui.avatar(u.name || u.email || u.id, 40) + '<span class="ldx-row-main"><div class="ldx-row-title"></div><div class="ldx-row-sub"></div></span><span class="ldx-row-end">' + ui.icon('forward', 18) + '</span></button>');
              el.querySelector('.ldx-row-title').textContent = u.name || u.email || u.id;
              el.querySelector('.ldx-row-sub').textContent = [u.phone, u.email, u.city].filter(Boolean).join(' · ');
              el.addEventListener('click', function () { confirmSheet(u); });
              sec.group.appendChild(el);
            });
            results.appendChild(sec);
          }).catch(function (err) {
            if (mine !== seq || !page.alive) return;
            results.innerHTML = '';
            results.appendChild(ui.emptyState({ icon: 'lock', tone: 'muted', title: err && err.status === 403 ? 'Account search needs admin access' : 'Search unavailable', body: err && err.status === 403 ? 'Paste the rider’s account ID below instead.' : ui.errorMessage(err) }));
          });
        }

        function confirmSheet(u) {
          var form = ui.h(
            '<div>' +
              '<div class="ldx-group">' +
                '<label class="ldx-field"><span>Name customers see</span><input name="name" maxlength="120" autocomplete="name"></label>' +
                '<label class="ldx-field"><span>Phone customers can call</span><input name="phone" maxlength="32" inputmode="tel" autocomplete="tel"></label>' +
              '</div>' +
              '<div class="ldx-hint"></div>' +
              '<div class="ldx-error-text" hidden></div>' +
              '<div class="ldx-sheet-actions" style="padding:16px 0 4px"></div>' +
            '</div>'
          );
          form.querySelector('[name=name]').value = u.name || '';
          form.querySelector('[name=phone]').value = u.phone ? (String(u.phone).charAt(0) === '+' ? u.phone : '+' + String(u.phone).replace(/\D/g, '')) : '';
          form.querySelector('.ldx-hint').textContent = 'Account ' + u.id + '. They can start taking offers right away.';
          var add = ui.button({ label: 'Add rider', block: true });
          form.querySelector('.ldx-sheet-actions').appendChild(add);
          var s = ui.sheet({ title: u.name ? 'Add ' + u.name + '?' : 'Add this account?', body: form, autofocus: 'empty' });
          var err = form.querySelector('.ldx-error-text');
          add.addEventListener('click', function () {
            var name = form.querySelector('[name=name]').value.trim();
            var phone = form.querySelector('[name=phone]').value.trim();
            if (!name) { err.textContent = 'Enter the rider’s name.'; err.hidden = false; return; }
            if (phone.replace(/\D/g, '').length < 6) { err.textContent = 'Enter a phone number customers can call.'; err.hidden = false; return; }
            err.hidden = true;
            ui.busy(add, function () {
              return api.registerDriver(u.id, { name: name, phone: phone }).then(function (res) {
                s.close(true);
                var st = res && res.driver && res.driver.status;
                ui.toast(st === 'suspended' ? name + ' is already a rider (suspended) — details updated' : name + ' can now take deliveries');
                nav.pop();
              }).catch(function (e) { err.textContent = e && e.status === 400 && /account/i.test(e.message || '') ? 'No LOUMOO account has that ID.' : ui.errorMessage(e); err.hidden = false; });
            });
          });
        }
      }
    };
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-open-riders-admin]') : null;
    if (!t) return;
    e.preventDefault();
    open();
  });

  window.LoumooRidersAdmin = { open: open };
})();
