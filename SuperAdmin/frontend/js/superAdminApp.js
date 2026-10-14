/**
 * LOUMOO Enterprise Control — superAdminApp.js
 * ---------------------------------------------------------------------------
 * Interactive controller for the redesigned SuperAdmin console.
 * Drives the new shell (sidebar routing, tables, KYC drawer, settings, audit)
 * against the existing window.SuperAdminAPI contract. No API/behavior changes.
 */
(function () {
  'use strict';

  var api = window.SuperAdminAPI;

  /* ----------------------------- helpers ------------------------------- */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var el = function (id) { return document.getElementById(id); };

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function icon(name) { return '<svg class="ic" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function initials(name) { return (String(name || '?').trim()[0] || '?').toUpperCase(); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }
  function fmtTime(v) { try { return new Date(v).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return esc(v); } }
  function relTime(v) {
    var d = new Date(v).getTime(); if (isNaN(d)) return '';
    var s = Math.round((Date.now() - d) / 1000);
    if (s < 60) return "à l'instant";
    if (s < 3600) return Math.floor(s / 60) + ' min';
    if (s < 86400) return Math.floor(s / 3600) + ' h';
    return Math.floor(s / 86400) + ' j';
  }

  /* ----------------------------- toast --------------------------------- */
  var toastTimer, toastHideTimer;
  function toast(msg, isError) {
    var t = el('toast'); if (!t) return;
    // Cancel any prior toast's tail so a new toast is never hidden by an old timer.
    clearTimeout(toastTimer); clearTimeout(toastHideTimer);
    el('toastText').textContent = msg;
    el('toastIcon').innerHTML = '<use href="#i-' + (isError ? 'x' : 'check') + '"/>';
    t.classList.toggle('error', !!isError);
    t.hidden = false;
    // force reflow so transition runs
    void t.offsetWidth;
    t.classList.add('show');
    toastTimer = setTimeout(function () {
      t.classList.remove('show');
      toastHideTimer = setTimeout(function () { t.hidden = true; }, 200);
    }, 3200);
  }

  /* ----------------------------- modal --------------------------------- */
  function openModal(opts) {
    // opts: { title, body, confirmText, danger, field:{label,value,placeholder}, required }
    return new Promise(function (resolve) {
      var root = el('modalRoot');
      el('modalTitle').textContent = opts.title || 'Confirmer';
      el('modalBody').textContent = opts.body || '';
      var wrap = el('modalReasonWrap'), ta = el('modalReason'), lbl = el('modalReasonLabel');
      if (opts.field) {
        wrap.hidden = false;
        lbl.textContent = opts.field.label || 'Motif';
        ta.value = opts.field.value || '';
        ta.placeholder = opts.field.placeholder || '';
      } else { wrap.hidden = true; ta.value = ''; }
      var confirmBtn = el('modalConfirm'), cancelBtn = el('modalCancel');
      confirmBtn.textContent = opts.confirmText || 'Confirmer';
      confirmBtn.className = 'btn ' + (opts.danger ? 'btn-danger solid' : 'btn-primary');
      root.hidden = false;
      (opts.field ? ta : confirmBtn).focus();

      function cleanup(val) {
        root.hidden = true;
        confirmBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        el('modalScrim').removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      }
      function onOk() {
        if (opts.field) {
          var v = ta.value.trim();
          if (opts.required !== false && !v) { ta.focus(); return; }
          cleanup(v);
        } else cleanup(true);
      }
      function onCancel() { cleanup(null); }
      function onKey(e) { if (e.key === 'Escape') onCancel(); else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onOk(); }
      confirmBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      el('modalScrim').addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);
    });
  }

  /* ----------------------------- drawer -------------------------------- */
  function openDrawer(opts) {
    var root = el('drawerRoot');
    el('drawerEyebrow').textContent = opts.eyebrow || '';
    el('drawerTitle').textContent = opts.title || '';
    el('drawerBody').innerHTML = opts.body || '';
    el('drawerFoot').innerHTML = '';
    (opts.footer || []).forEach(function (b) {
      var btn = document.createElement('button');
      btn.className = 'btn ' + (b.variant || 'btn-ghost');
      btn.innerHTML = (b.icon ? icon(b.icon) : '') + '<span>' + esc(b.label) + '</span>';
      btn.addEventListener('click', b.onClick);
      el('drawerFoot').appendChild(btn);
    });
    root.hidden = false;
    el('drawerClose').focus();
  }
  function closeDrawer() { el('drawerRoot').hidden = true; }

  /* --------------------------- row menu -------------------------------- */
  function closeRowMenu() { var m = el('rowMenu'); m.hidden = true; m.innerHTML = ''; }
  function openRowMenu(anchor, items) {
    var m = el('rowMenu');
    m.innerHTML = items.map(function (it, i) {
      if (it.sep) return '<div class="menu-sep"></div>';
      return '<button class="menu-item ' + (it.danger ? 'danger' : '') + '" data-i="' + i + '">' + icon(it.icon) + '<span>' + esc(it.label) + '</span></button>';
    }).join('');
    m.hidden = false;
    var r = anchor.getBoundingClientRect();
    var mw = m.offsetWidth, mh = m.offsetHeight;
    var left = Math.min(r.right - mw, window.innerWidth - mw - 8);
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
    m.style.left = Math.max(8, left) + 'px';
    m.style.top = Math.max(8, top) + 'px';
    $$('.menu-item', m).forEach(function (b) {
      b.addEventListener('click', function () {
        var it = items[parseInt(b.getAttribute('data-i'), 10)];
        closeRowMenu();
        it.onClick();
      });
    });
  }
  document.addEventListener('click', function (e) {
    var m = el('rowMenu');
    if (!m.hidden && !m.contains(e.target) && !e.target.closest('[data-rowmenu]')) closeRowMenu();
    var pop = el('filterPop');
    if (pop && !pop.hidden && !pop.contains(e.target) && !e.target.closest('#filterBtn')) toggleFilterPop(false);
  });
  window.addEventListener('resize', closeRowMenu);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeRowMenu(); if (!el('drawerRoot').hidden) closeDrawer(); } });

  /* ----------------------------- routing ------------------------------- */
  var SECTIONS = { overview: 'Tableau de bord', stores: 'Boutiques', kyc: 'Vérification KYC', settings: 'Paramètres', audit: "Journal d'audit" };
  var loaded = {};
  function go(section) {
    if (!SECTIONS[section]) section = 'overview';
    $$('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + section; v.classList.toggle('is-active', v.id === 'view-' + section); });
    $$('.nav-item').forEach(function (n) { n.classList.toggle('is-active', n.getAttribute('data-section') === section); });
    el('crumbCurrent').textContent = SECTIONS[section];
    el('content').scrollTop = 0;
    if (window.innerWidth <= 860) setNav(false);
    if (section === 'overview') loadOverview();
    else if (section === 'stores') { if (!loaded.stores) { loaded.stores = true; loadStores(); } }
    else if (section === 'kyc') { loadKyc(); }
    else if (section === 'settings') { if (!loaded.settings) { loaded.settings = true; loadSettings(); } }
    else if (section === 'audit') { if (!loaded.audit) { loaded.audit = true; renderAuditShell(); loadAudit(); } }
  }
  document.addEventListener('click', function (e) {
    var link = e.target.closest('[data-section]');
    if (link) { e.preventDefault(); var s = link.getAttribute('data-section'); history.replaceState(null, '', '#' + s); go(s); }
  });

  /* --------------------------- mobile nav ------------------------------ */
  function setNav(open) { el('app').classList.toggle('nav-open', open); el('navScrim').hidden = !open; }
  el('navToggle').addEventListener('click', function () { setNav(!el('app').classList.contains('nav-open')); });
  el('navScrim').addEventListener('click', function () { setNav(false); });

  /* ---------------------------- overview ------------------------------- */
  function metricSkeleton() {
    var one = '<div class="metric"><div class="sk sk-line" style="width:60%"></div><div class="sk sk-line" style="width:45%;height:22px;margin-top:14px"></div><div class="sk sk-line" style="width:70%;margin-top:8px"></div></div>';
    return one + one + one + one;
  }
  function rowsSkeleton(n) {
    var r = '';
    for (var i = 0; i < n; i++) r += '<div class="q-row"><div class="sk sk-circle" style="width:30px;height:30px"></div><div class="q-main"><div class="sk sk-line" style="width:55%"></div><div class="sk sk-line" style="width:35%;margin-top:7px"></div></div></div>';
    return r;
  }

  function loadOverview() {
    var m = el('metrics');
    if (!m.dataset.done) m.innerHTML = metricSkeleton();
    if (!el('ovKycQueue').dataset.done) el('ovKycQueue').innerHTML = rowsSkeleton(4);
    if (!el('ovActivity').dataset.done) el('ovActivity').innerHTML = rowsSkeleton(4);

    api.getOverview().then(function (data) {
      var k = data.kpis || {};
      var cells = [
        { icon: 'gmv', label: "Volume d'affaires", value: k.gmvFormatted || '—', foot: k.escrowInFlightFormatted ? (k.escrowInFlightFormatted + ' en séquestre') : 'Cumul plateforme' },
        { icon: 'orders', label: 'Commandes', value: (k.totalOrders != null ? k.totalOrders : '—'), foot: 'Toutes verticales' },
        { icon: 'store', label: 'Boutiques actives', value: (k.activeStores != null ? k.activeStores : '—'), foot: (k.registeredUsers != null ? (k.registeredUsers + ' utilisateurs') : 'Marketplace') },
        { icon: 'kyc', label: 'KYC en attente', value: (k.pendingKycCount != null ? k.pendingKycCount : '—'), foot: 'À vérifier' }
      ];
      m.innerHTML = cells.map(function (c) {
        return '<div class="metric"><div class="metric-label">' + icon(c.icon) + '<span>' + esc(c.label) + '</span></div>' +
          '<div class="metric-value">' + esc(c.value) + '</div><div class="metric-foot">' + esc(c.foot) + '</div></div>';
      }).join('');
      m.dataset.done = '1';
      var kc = k.pendingKycCount;
      var badge = el('navKycCount');
      if (kc && kc > 0) { badge.textContent = kc > 99 ? '99+' : kc; badge.hidden = false; } else badge.hidden = true;
    }).catch(function (err) {
      m.innerHTML = '<div class="metric" style="grid-column:1/-1"><div class="metric-foot">Indicateurs indisponibles — ' + esc(err.message) + '</div></div>';
    });

    api.getStores({ status: 'PENDING_VERIFICATION', limit: 5 }).then(function (stores) {
      var box = el('ovKycQueue'); box.dataset.done = '1';
      if (!stores || !stores.length) { box.innerHTML = emptyInline('inbox', 'Aucun dossier en attente'); return; }
      box.innerHTML = stores.map(function (s) {
        return '<div class="q-row" data-open-store="' + esc(s.id) + '" role="button" tabindex="0">' +
          '<div class="q-av">' + esc(initials(s.name)) + '</div>' +
          '<div class="q-main"><div class="q-name">' + esc(s.name || 'Sans nom') + '</div>' +
          '<div class="q-sub">' + esc((s.owner && s.owner.full_name) || 'Vendeur') + ' • ' + esc(s.city || '—') + '</div></div>' +
          '<span class="badge pending"><span class="bdot"></span>KYC</span></div>';
      }).join('');
      bindStoreOpeners(box);
    }).catch(function () { el('ovKycQueue').innerHTML = emptyInline('inbox', 'File indisponible'); });

    api.getAuditLogs({ limit: 6 }).then(function (logs) {
      var box = el('ovActivity'); box.dataset.done = '1';
      if (!logs || !logs.length) { box.innerHTML = emptyInline('clock', 'Aucun événement récent'); return; }
      box.innerHTML = logs.map(function (l) {
        return '<div class="q-row"><div class="q-av">' + esc(initials(l.admin_id)) + '</div>' +
          '<div class="q-main"><div class="q-name">' + esc(l.action) + '</div>' +
          '<div class="q-sub">' + esc(l.resource_type || '') + ' · ' + esc(l.resource_id || '') + '</div></div>' +
          '<span class="q-time">' + esc(relTime(l.created_at)) + '</span></div>';
      }).join('');
    }).catch(function () { el('ovActivity').innerHTML = emptyInline('clock', 'Journal indisponible'); });
  }

  function emptyInline(ic, title) {
    return '<div class="empty" style="padding:32px 16px">' + icon(ic) + '<div class="empty-title" style="font-size:13.5px">' + esc(title) + '</div></div>';
  }

  /* ----------------------------- stores -------------------------------- */
  var storeState = { status: 'ALL', search: '', city: '', tier: '' };
  var storeCache = [];

  function statusBadge(s) {
    if (s.status === 'ACTIVE') return '<span class="badge active"><span class="bdot"></span>Active</span>';
    if (s.status === 'PENDING_VERIFICATION') return '<span class="badge pending"><span class="bdot"></span>En attente</span>';
    if (s.status === 'SUSPENDED') return '<span class="badge suspended"><span class="bdot"></span>Suspendue</span>';
    return '<span class="badge draft"><span class="bdot"></span>Brouillon</span>';
  }
  function tierCell(s) {
    var t = s.verification_tier;
    if (t === 'official_brand') return '<span class="tier official">' + icon('check') + 'Official Brand</span>';
    if (t === 'pro_merchant') return '<span class="tier pro">' + icon('check') + 'Pro Merchant</span>';
    if (t === 'individual_verified') return '<span class="tier">Individuel</span>';
    return '<span class="tier none">Non vérifié</span>';
  }
  function tableSkeleton(cols, rows) {
    var head = '';
    var body = '';
    for (var r = 0; r < rows; r++) {
      var tds = '';
      for (var c = 0; c < cols; c++) tds += '<td><div class="sk sk-line" style="width:' + (c === 0 ? 70 : (40 + (c * 7) % 30)) + '%"></div></td>';
      body += '<tr>' + tds + '</tr>';
    }
    return body;
  }

  function loadStores() {
    var wrap = el('storesTableWrap');
    wrap.innerHTML = '<div class="table-scroll"><table class="tbl"><thead><tr>' +
      '<th>Boutique</th><th>Vendeur</th><th>Ville</th><th>Statut</th><th>Tier</th><th class="col-actions"></th></tr></thead>' +
      '<tbody id="storesBody">' + tableSkeleton(6, 6) + '</tbody></table></div>';
    api.getStores({ status: storeState.status, tier: storeState.tier, search: storeState.search }).then(function (stores) {
      storeCache = stores || [];
      var filtered = storeCache;
      if (storeState.city) {
        var q = storeState.city.toLowerCase();
        filtered = filtered.filter(function (s) { return (s.city || '').toLowerCase().indexOf(q) >= 0; });
      }
      renderStoreRows(el('storesBody'), filtered, 6, false);
    }).catch(function (err) {
      wrap.innerHTML = errorState('Impossible de charger les boutiques', err.message);
    });
  }

  function renderStoreRows(tbody, stores, cols, isKyc) {
    if (!tbody) return;
    if (!stores.length) {
      tbody.innerHTML = '<tr><td colspan="' + cols + '">' + emptyBlock('store', 'Aucune boutique', 'Modifiez vos filtres ou votre recherche.', true) + '</td></tr>';
      return;
    }
    tbody.innerHTML = stores.map(function (s) {
      var contact = (s.owner && s.owner.phone_number) || s.phone_number || 'Non renseigné';
      var vendor = (s.owner && s.owner.full_name) || 'Vendeur';
      if (isKyc) {
        return '<tr data-open-store="' + esc(s.id) + '">' +
          '<td><div class="cell-primary"><div class="cell-av">' + esc(initials(s.name)) + '</div><div style="min-width:0">' +
          '<div class="cell-name">' + esc(vendor) + '</div><div class="cell-sub">' + esc((s.owner && s.owner.email) || '—') + '</div></div></div></td>' +
          '<td><div class="cell-strong">' + esc(s.name || 'Sans nom') + '</div><div class="cell-sub">/' + esc(s.slug || s.id) + '</div></td>' +
          '<td class="cell-muted">' + esc(contact) + '</td>' +
          '<td>' + statusBadge(s) + '</td>' +
          '<td class="col-actions">' + rowMenuBtn(s.id) + '</td></tr>';
      }
      return '<tr data-open-store="' + esc(s.id) + '">' +
        '<td><div class="cell-primary"><div class="cell-av">' + esc(initials(s.name)) + '</div><div style="min-width:0">' +
        '<div class="cell-name">' + esc(s.name || 'Sans nom') + '</div><div class="cell-sub">/' + esc(s.slug || s.id) + ' • ' + esc(s.category_id || 'Commerce') + '</div></div></div></td>' +
        '<td><div class="cell-strong">' + esc(vendor) + '</div><div class="cell-sub">' + esc(contact) + '</div></td>' +
        '<td class="cell-muted">' + esc(s.city || '—') + '</td>' +
        '<td>' + statusBadge(s) + '</td>' +
        '<td>' + tierCell(s) + '</td>' +
        '<td class="col-actions">' + rowMenuBtn(s.id) + '</td></tr>';
    }).join('');
    bindStoreOpeners(tbody);
    $$('[data-rowmenu]', tbody).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var s = findStore(btn.getAttribute('data-rowmenu'));
        openRowMenu(btn, storeMenuItems(s));
      });
    });
  }
  function rowMenuBtn(id) { return '<button class="icon-btn" data-rowmenu="' + esc(id) + '" aria-label="Actions">' + icon('more') + '</button>'; }
  function findStore(id) { for (var i = 0; i < storeCache.length; i++) if (String(storeCache[i].id) === String(id)) return storeCache[i]; return { id: id }; }
  function bindStoreOpeners(root) {
    $$('[data-open-store]', root).forEach(function (rowEl) {
      var handler = function (e) { if (e.target.closest('[data-rowmenu]')) return; openStoreDrawer(rowEl.getAttribute('data-open-store')); };
      rowEl.addEventListener('click', handler);
      rowEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') handler(e); });
    });
  }

  function storeMenuItems(s) {
    var items = [{ icon: 'eye', label: 'Voir le dossier', onClick: function () { openStoreDrawer(s.id); } }];
    if (s.status === 'PENDING_VERIFICATION' || !s.is_verified) {
      items.push({ icon: 'check', label: 'Approuver le KYC', onClick: function () { doVerify(s); } });
      items.push({ icon: 'x', label: 'Rejeter le KYC', danger: true, onClick: function () { doReject(s); } });
    }
    if (s.status === 'ACTIVE') items.push({ icon: 'pause', label: 'Suspendre', danger: true, onClick: function () { doSuspend(s); } });
    else if (s.status === 'SUSPENDED') items.push({ icon: 'play', label: 'Réactiver', onClick: function () { doReactivate(s); } });
    items.push({ sep: true });
    items.push({ icon: 'phone', label: 'Modifier le WhatsApp', onClick: function () { doEditPhone(s); } });
    return items;
  }

  /* --------------------------- store actions --------------------------- */
  function refreshAfterMutation() { loaded.audit && loadAudit(); el('metrics').dataset.done = ''; }
  function reloadCurrentStoreViews() {
    if (!el('view-stores').hidden) loadStores();
    if (!el('view-kyc').hidden) loadKyc();
    if (!el('view-overview').hidden) { el('ovKycQueue').dataset.done = ''; el('metrics').dataset.done = ''; loadOverview(); }
  }

  function doVerify(s) {
    openModal({ title: 'Approuver le dossier KYC', body: 'La boutique « ' + (s.name || s.id) + " » sera activée au tier Pro Merchant.", confirmText: 'Approuver' }).then(function (ok) {
      if (!ok) return;
      api.verifyStoreKyc(s.id, 'pro_merchant', 'KYC vérifié par SuperAdmin - Tier: pro_merchant').then(function () {
        toast('Boutique approuvée (Pro Merchant).'); closeDrawer(); reloadCurrentStoreViews(); refreshAfterMutation();
      }).catch(function (e) { toast(e.message || 'Erreur lors de la validation KYC', true); });
    });
  }
  function doReject(s) {
    openModal({ title: 'Rejeter le dossier KYC', body: 'Indiquez le motif communiqué au vendeur.', confirmText: 'Rejeter', danger: true, field: { label: 'Motif du rejet', value: 'Documents non conformes' } }).then(function (reason) {
      if (!reason) return;
      api.rejectStoreKyc(s.id, reason).then(function () {
        toast('Dossier KYC rejeté.'); closeDrawer(); reloadCurrentStoreViews(); refreshAfterMutation();
      }).catch(function (e) { toast(e.message || 'Erreur lors du rejet', true); });
    });
  }
  function doSuspend(s) {
    openModal({ title: 'Suspendre la boutique', body: 'La boutique sera retirée de la marketplace.', confirmText: 'Suspendre', danger: true, field: { label: 'Motif', value: 'Non-respect des règles de la plateforme' } }).then(function (reason) {
      if (!reason) return;
      api.suspendStore(s.id, reason).then(function () {
        toast('Boutique suspendue.'); closeDrawer(); reloadCurrentStoreViews(); refreshAfterMutation();
      }).catch(function (e) { toast(e.message || 'Erreur lors de la suspension', true); });
    });
  }
  function doReactivate(s) {
    openModal({ title: 'Réactiver la boutique', body: 'La boutique sera de nouveau visible sur la marketplace.', confirmText: 'Réactiver' }).then(function (ok) {
      if (!ok) return;
      api.reactivateStore(s.id, 'Boutique réactivée par SuperAdmin').then(function () {
        toast('Boutique réactivée.'); closeDrawer(); reloadCurrentStoreViews(); refreshAfterMutation();
      }).catch(function (e) { toast(e.message || 'Erreur lors de la réactivation', true); });
    });
  }
  function doEditPhone(s) {
    openModal({ title: 'Numéro WhatsApp', body: 'Format international, ex. 237690123456.', confirmText: 'Enregistrer', field: { label: 'Numéro', value: s.phone_number || '237', placeholder: '237…' } }).then(function (phone) {
      if (!phone) return;
      api.moderateStore(s.id, { phone_number: phone.replace(/\D/g, '') }).then(function () {
        toast('Numéro de contact mis à jour.'); closeDrawer(); reloadCurrentStoreViews(); refreshAfterMutation();
      }).catch(function (e) { toast(e.message || 'Erreur lors de la mise à jour', true); });
    });
  }

  /* --------------------------- store drawer ---------------------------- */
  function openStoreDrawer(id) {
    var base = findStore(id);
    openDrawer({ eyebrow: 'Dossier boutique', title: base.name || 'Chargement…', body: '<div class="d-list">' + rowsSkeleton(5) + '</div>' });
    Promise.resolve(api.getStore(id)).then(function (full) {
      renderStoreDrawer(full || base);
    }).catch(function () { renderStoreDrawer(base); });
  }
  function kv(k, v) { return '<div class="d-item"><span class="d-key">' + esc(k) + '</span><span class="d-val">' + esc(v || '—') + '</span></div>'; }
  function renderStoreDrawer(s) {
    var owner = s.owner || {};
    var isPending = s.status === 'PENDING_VERIFICATION' || !s.is_verified;
    var body =
      '<div><div class="d-section-title">Vendeur</div><div class="d-list">' +
        kv('Nom', owner.full_name) + kv('Email', owner.email) + kv('Téléphone', owner.phone_number || s.phone_number) +
        kv('Statut KYC', owner.kyc_status || 'unverified') + '</div></div>' +
      '<div><div class="d-section-title">Boutique</div><div class="d-list">' +
        kv('Nom', s.name) + kv('Slug', '/' + (s.slug || s.id)) + kv('Catégorie', s.category_id) +
        kv('Ville', s.city) + kv('Produits', s.product_count != null ? s.product_count : '—') + '</div></div>' +
      '<div><div class="d-section-title">Vérification</div><div class="d-list">' +
        '<div class="d-item"><span class="d-key">Statut</span><span class="d-val">' + statusBadge(s) + '</span></div>' +
        '<div class="d-item"><span class="d-key">Tier</span><span class="d-val">' + tierCell(s) + '</span></div></div></div>' +
      '<div><div class="d-section-title">Documents</div><div class="d-note">' + icon('inbox') +
        '<span>Aucun document n\'est exposé par l\'API pour ce dossier.</span></div></div>';

    var footer = [];
    if (isPending) {
      footer.push({ label: 'Rejeter', variant: 'btn-danger', icon: 'x', onClick: function () { doReject(s); } });
      footer.push({ label: 'Approuver', variant: 'btn-primary', icon: 'check', onClick: function () { doVerify(s); } });
    } else if (s.status === 'ACTIVE') {
      footer.push({ label: 'Modifier WhatsApp', variant: 'btn-ghost', icon: 'phone', onClick: function () { doEditPhone(s); } });
      footer.push({ label: 'Suspendre', variant: 'btn-danger', icon: 'pause', onClick: function () { doSuspend(s); } });
    } else if (s.status === 'SUSPENDED') {
      footer.push({ label: 'Modifier WhatsApp', variant: 'btn-ghost', icon: 'phone', onClick: function () { doEditPhone(s); } });
      footer.push({ label: 'Réactiver', variant: 'btn-primary', icon: 'play', onClick: function () { doReactivate(s); } });
    } else {
      footer.push({ label: 'Modifier WhatsApp', variant: 'btn-ghost', icon: 'phone', onClick: function () { doEditPhone(s); } });
    }
    openDrawer({ eyebrow: 'Dossier boutique', title: s.name || 'Boutique', body: body, footer: footer });
  }

  /* ------------------------------ KYC ---------------------------------- */
  function loadKyc() {
    var wrap = el('kycTableWrap');
    wrap.innerHTML = '<div class="table-scroll"><table class="tbl"><thead><tr>' +
      '<th>Vendeur</th><th>Boutique</th><th>Contact</th><th>Statut</th><th class="col-actions"></th></tr></thead>' +
      '<tbody id="kycBody">' + tableSkeleton(5, 5) + '</tbody></table></div>';
    api.getStores({ status: 'PENDING_VERIFICATION', limit: 100 }).then(function (stores) {
      storeCache = (storeCache || []).concat(stores || []).reduce(dedupe, []);
      if (!stores || !stores.length) {
        el('kycBody').innerHTML = '<tr><td colspan="5">' + emptyBlock('kyc', 'File d\'attente vide', 'Aucun dossier vendeur ne requiert de vérification.', false) + '</td></tr>';
        return;
      }
      renderStoreRows(el('kycBody'), stores, 5, true);
    }).catch(function (err) { wrap.innerHTML = errorState('Impossible de charger la file KYC', err.message); });
  }
  function dedupe(acc, s) { if (!acc.some(function (x) { return String(x.id) === String(s.id); })) acc.push(s); return acc; }

  /* ---------------------------- settings ------------------------------- */
  var settings = {};
  function loadSettings() {
    renderSettingsPane('general', true);
    api.getSettings().then(function (data) { settings = data || {}; renderSettingsPane(currentPane); })
      .catch(function (e) { toast('Paramètres indisponibles: ' + e.message, true); });
  }
  var currentPane = 'general';
  $$('#settingsNav .set-nav-item').forEach(function (b) {
    b.addEventListener('click', function () {
      currentPane = b.getAttribute('data-pane');
      $$('#settingsNav .set-nav-item').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      renderSettingsPane(currentPane);
    });
  });

  function setCard(rows, foot) {
    return '<div class="set-card">' + rows + (foot ? '<div class="set-foot">' + foot + '</div>' : '') + '</div>';
  }
  function setRow(name, help, control) {
    return '<div class="set-row"><div class="set-info"><div class="set-name">' + esc(name) + '</div><div class="set-help">' + esc(help) + '</div></div><div class="set-control">' + control + '</div></div>';
  }
  function switchCtl(id, checked, label) {
    return '<div class="switch-row"><span class="switch-label">' + esc(label) + '</span>' +
      '<label class="switch"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '><span class="track"></span></label></div>';
  }

  function renderSettingsPane(pane, skeleton) {
    var main = el('settingsMain');
    if (skeleton) { main.innerHTML = setCard(setRow('Chargement…', 'Récupération de la configuration.', '<div class="sk sk-line" style="height:34px"></div>')); return; }
    var s = settings;
    if (pane === 'general') {
      var ann = s.announcement_banner || {};
      main.innerHTML = setCard(
        switchRowCard(setRow('Bannière d\'annonce', 'Bandeau affiché en tête des écrans acheteurs.',
          switchCtl('setAnnActive', !!ann.active, 'Bannière visible') +
          field('setAnnMsg', 'Message', ann.message || '') +
          field('setAnnCta', "Bouton d'action", ann.cta_text || 'Découvrir'))),
        primaryFoot('Enregistrer', saveAnnouncement));
    } else if (pane === 'commissions') {
      var c = s.platform_commission_rate || {};
      main.innerHTML = setCard(
        setRow('Taux de commission', 'Pourcentage prélevé sur chaque vente finalisée (0–50 %).',
          field('setCommission', 'Pourcentage (%)', c.rate_percent != null ? c.rate_percent : 5, 'number')),
        primaryFoot('Enregistrer le taux', saveCommission));
    } else if (pane === 'whatsapp') {
      var w = s.seller_whatsapp_default || {};
      main.innerHTML = setCard(
        setRow('Ligne WhatsApp centrale', 'Numéro de repli pour le support et les boutiques sans contact dédié.',
          field('setWaNumber', 'Numéro (international)', w.number || '237690123456') +
          field('setWaLabel', 'Libellé affiché', w.label || 'LOUMOO Central Merchant Care')),
        primaryFoot('Enregistrer', saveWhatsApp));
    } else if (pane === 'shipping') {
      var sr = s.shipping_rates_by_city || {};
      var cities = [['Douala', 1000], ['Yaounde', 1500], ['Bafoussam', 2500], ['Kribi', 2500], ['Bamenda', 3000], ['Garoua', 4000], ['Maroua', 4500]];
      var grid = '<div class="set-grid">' + cities.map(function (c) {
        return field('ship_' + c[0], c[0], sr[c[0]] != null ? sr[c[0]] : c[1], 'number');
      }).join('') + '</div>';
      main.innerHTML = setCard(
        setRow('Tarifs de livraison', 'Frais d\'expédition en XAF appliqués au calcul du panier.', grid),
        primaryFoot('Enregistrer les tarifs', saveShipping) + ghostFoot('Réinitialiser', function () { resetKey('shipping_rates_by_city'); }));
    } else if (pane === 'maintenance') {
      var mm = s.maintenance_mode || {};
      main.innerHTML = setCard(
        setRow('Mode maintenance', 'Affiche une alerte globale et suspend les mutations non-administrateur.',
          switchCtl('setMaint', !!mm.enabled, 'Activer la maintenance') +
          field('setMaintMsg', 'Message de la bannière', mm.banner_text || '')),
        primaryFoot('Mettre à jour', saveMaintenance));
    } else if (pane === 'features') {
      var ff = s.feature_flags || {};
      main.innerHTML = setCard(
        setRow('Modules de la plateforme', 'Activez ou désactivez les fonctionnalités en temps réel.',
          switchCtl('flagTravel', !!ff.travel_enabled, 'Voyage & Bus') +
          switchCtl('flagVisual', !!ff.visual_search_enabled, 'Recherche visuelle') +
          switchCtl('flagEscrow', !!ff.escrow_enabled, 'Paiement séquestre') +
          switchCtl('flagAi', !!ff.ai_assistant_enabled, 'Assistant IA')),
        primaryFoot('Enregistrer les modules', saveFeatures) + ghostFoot('Réinitialiser', function () { resetKey('feature_flags'); }));
    }
    // bind footer buttons
    $$('[data-set-action]', main).forEach(function (b) { b.addEventListener('click', settingsActions[b.getAttribute('data-set-action')]); });
  }
  function switchRowCard(inner) { return inner; }
  function field(id, label, value, type) {
    return '<label class="set-field"><span>' + esc(label) + '</span><input class="input" id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value) + '"></label>';
  }
  var settingsActions = {};
  var actionSeq = 0;
  function primaryFoot(label, fn) { var k = 'a' + (actionSeq++); settingsActions[k] = fn; return '<button class="btn btn-primary" data-set-action="' + k + '">' + esc(label) + '</button>'; }
  function ghostFoot(label, fn) { var k = 'a' + (actionSeq++); settingsActions[k] = fn; return '<button class="btn btn-ghost" data-set-action="' + k + '">' + esc(label) + '</button>'; }

  function saveCommission() {
    var v = parseFloat(el('setCommission').value);
    if (isNaN(v) || v < 0 || v > 50) { toast('Entrez un taux valide entre 0 et 50.', true); return; }
    var payload = Object.assign({}, settings.platform_commission_rate || {}, { rate_percent: v });
    api.updateSetting('platform_commission_rate', payload, 'Adjusted platform commission to ' + v + '%')
      .then(function () { settings.platform_commission_rate = payload; toast('Taux de commission enregistré (' + v + ' %).'); loaded.audit && loadAudit(); })
      .catch(function (e) { toast(e.message || 'Échec de la mise à jour', true); });
  }
  function saveWhatsApp() {
    var phone = el('setWaNumber').value.trim(); var label = el('setWaLabel').value.trim();
    if (!phone) { toast('Entrez un numéro valide.', true); return; }
    var payload = { number: phone.replace(/\D/g, ''), label: label || 'LOUMOO Central Merchant Care', fallback_message: 'Hello LOUMOO Support! I am contacting you regarding an order.' };
    api.updateSetting('seller_whatsapp_default', payload, 'Updated central WhatsApp line to ' + phone)
      .then(function () { settings.seller_whatsapp_default = payload; toast('Ligne WhatsApp centrale mise à jour.'); loaded.audit && loadAudit(); })
      .catch(function (e) { toast(e.message || 'Échec de la mise à jour', true); });
  }
  function saveMaintenance() {
    var enabled = el('setMaint').checked; var banner = el('setMaintMsg').value.trim();
    var payload = { enabled: enabled, banner_text: banner || 'LOUMOO platform upgrade in progress.', allow_admin_bypass: true };
    api.updateSetting('maintenance_mode', payload, 'Maintenance mode set to ' + (enabled ? 'ENABLED' : 'DISABLED'))
      .then(function () { settings.maintenance_mode = payload; toast('Mode maintenance ' + (enabled ? 'activé' : 'désactivé') + '.'); loaded.audit && loadAudit(); })
      .catch(function (e) { toast(e.message || 'Échec de la mise à jour', true); });
  }
  function saveAnnouncement() {
    var payload = { active: el('setAnnActive').checked, message: el('setAnnMsg').value.trim(), badge: 'NOUVEAU', cta_text: el('setAnnCta').value.trim(), cta_url: '/stores' };
    api.updateSetting('announcement_banner', payload, 'Announcement banner updated: "' + payload.message + '"')
      .then(function () { settings.announcement_banner = payload; toast('Bannière d\'annonce mise à jour.'); loaded.audit && loadAudit(); })
      .catch(function (e) { toast(e.message || 'Échec de la mise à jour', true); });
  }
  function saveFeatures() {
    var payload = { travel_enabled: el('flagTravel').checked, visual_search_enabled: el('flagVisual').checked, escrow_enabled: el('flagEscrow').checked, ai_assistant_enabled: el('flagAi').checked, crypto_payments_enabled: false };
    api.updateSetting('feature_flags', payload, 'Updated platform runtime feature flags')
      .then(function () { settings.feature_flags = payload; toast('Modules mis à jour.'); loaded.audit && loadAudit(); })
      .catch(function (e) { toast(e.message || 'Échec de la mise à jour', true); });
  }
  function saveShipping() {
    var cities = ['Douala', 'Yaounde', 'Bafoussam', 'Kribi', 'Bamenda', 'Garoua', 'Maroua'];
    var def = { Douala: 1000, Yaounde: 1500, Bafoussam: 2500, Kribi: 2500, Bamenda: 3000, Garoua: 4000, Maroua: 4500 };
    var payload = {};
    cities.forEach(function (c) { var v = parseInt((el('ship_' + c) || {}).value, 10); payload[c] = (isNaN(v) || v < 0) ? def[c] : v; });
    api.updateSetting('shipping_rates_by_city', payload, 'Updated regional delivery fees by city')
      .then(function () { settings.shipping_rates_by_city = payload; toast('Tarifs de livraison enregistrés.'); loaded.audit && loadAudit(); })
      .catch(function (e) { toast(e.message || 'Échec de l\'enregistrement', true); });
  }
  function resetKey(key) {
    openModal({ title: 'Réinitialiser', body: 'Rétablir « ' + key + ' » aux valeurs d\'usine ?', confirmText: 'Réinitialiser', danger: true }).then(function (ok) {
      if (!ok) return;
      api.resetSetting(key, 'Réinitialisation usine demandée pour ' + key).then(function () {
        toast('Paramètre réinitialisé.');
        return api.getSettings();
      }).then(function (data) { if (data) { settings = data; renderSettingsPane(currentPane); } loaded.audit && loadAudit(); })
        .catch(function (e) { toast(e.message || 'Échec de la réinitialisation', true); });
    });
  }

  /* ------------------------------ audit -------------------------------- */
  var audit = { action: '', resource: '', search: '', range: 'all', page: 1, limit: 20 };
  function renderAuditShell() {
    el('auditMount').innerHTML =
      '<div class="audit-toolbar">' +
        '<div class="field-search"><svg class="ic"><use href="#i-search"/></svg><input type="search" id="auditSearch" placeholder="Rechercher un motif, une cible, un opérateur…" aria-label="Rechercher"></div>' +
        '<select class="input" id="auditAction" style="width:auto">' +
          ['', 'setting.update', 'setting.reset', 'store.verify', 'store.suspend', 'store.reactivate', 'maintenance.toggle', 'audit.export']
            .map(function (a) { return '<option value="' + a + '">' + (a || 'Toutes les actions') + '</option>'; }).join('') + '</select>' +
        '<select class="input" id="auditResource" style="width:auto">' +
          ['', 'system_setting', 'store', 'user', 'order', 'audit_log']
            .map(function (a) { return '<option value="' + a + '">' + (a || 'Tous types') + '</option>'; }).join('') + '</select>' +
        '<div class="segmented" id="auditRange">' +
          [['all', 'Tout'], ['today', "Aujourd'hui"], ['7d', '7 j'], ['30d', '30 j']]
            .map(function (r, i) { return '<button class="seg' + (i === 0 ? ' is-active' : '') + '" data-range="' + r[0] + '">' + r[1] + '</button>'; }).join('') + '</div>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-ghost btn-sm" id="auditCsv">' + icon('download') + '<span>CSV</span></button>' +
        '<button class="btn btn-ghost btn-sm" id="auditJson">' + icon('download') + '<span>JSON</span></button>' +
      '</div>' +
      '<div class="audit-meta"><span><strong id="auditShowing">0</strong> sur <strong id="auditTotal">0</strong> événements</span>' +
        '<button class="btn btn-text btn-sm" id="auditClear">Effacer les filtres</button></div>' +
      '<div class="table-wrap"><div class="table-scroll"><table class="tbl"><thead><tr>' +
        '<th>Horodatage</th><th>Action</th><th>Cible</th><th>Opérateur</th><th>Modification</th></tr></thead>' +
        '<tbody id="auditBody"></tbody></table></div>' +
        '<div class="pager"><span class="pager-info">Page <strong id="auditPage">1</strong> / <strong id="auditPages">1</strong></span>' +
        '<div class="pager-btns"><button class="btn btn-ghost btn-sm" id="auditPrev" disabled>' + icon('chev-left') + '<span>Précédent</span></button>' +
        '<button class="btn btn-ghost btn-sm" id="auditNext" disabled><span>Suivant</span>' + icon('chev-right') + '</button></div></div></div>';

    el('auditSearch').addEventListener('input', debounce(function () { audit.search = el('auditSearch').value.trim(); audit.page = 1; loadAudit(); }, 260));
    el('auditAction').addEventListener('change', function () { audit.action = this.value; audit.page = 1; loadAudit(); });
    el('auditResource').addEventListener('change', function () { audit.resource = this.value; audit.page = 1; loadAudit(); });
    $$('#auditRange .seg').forEach(function (b) { b.addEventListener('click', function () { $$('#auditRange .seg').forEach(function (x) { x.classList.toggle('is-active', x === b); }); audit.range = b.getAttribute('data-range'); audit.page = 1; loadAudit(); }); });
    el('auditPrev').addEventListener('click', function () { if (audit.page > 1) { audit.page--; loadAudit(); } });
    el('auditNext').addEventListener('click', function () { audit.page++; loadAudit(); });
    el('auditCsv').addEventListener('click', function () { exportAudit('csv'); });
    el('auditJson').addEventListener('click', function () { exportAudit('json'); });
    el('auditClear').addEventListener('click', function () {
      audit = { action: '', resource: '', search: '', range: 'all', page: 1, limit: 20 };
      el('auditSearch').value = ''; el('auditAction').value = ''; el('auditResource').value = '';
      $$('#auditRange .seg').forEach(function (x, i) { x.classList.toggle('is-active', i === 0); });
      loadAudit(); toast('Filtres réinitialisés.');
    });
  }
  function rangeStart() {
    var now = Date.now();
    if (audit.range === 'today') { var d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }
    if (audit.range === '7d') return new Date(now - 7 * 86400000).toISOString();
    if (audit.range === '30d') return new Date(now - 30 * 86400000).toISOString();
    return undefined;
  }
  function actTag(action) {
    var cls = ''; var a = action || '';
    if (a.indexOf('verify') >= 0 || a.indexOf('reactivate') >= 0 || a.indexOf('export') >= 0) cls = 'ok';
    else if (a.indexOf('update') >= 0 || a.indexOf('toggle') >= 0) cls = 'warn';
    else if (a.indexOf('suspend') >= 0 || a.indexOf('reject') >= 0 || a.indexOf('reset') >= 0) cls = 'danger';
    return '<span class="act-tag ' + cls + '">' + esc(a) + '</span>';
  }
  function loadAudit() {
    var body = el('auditBody'); if (!body) return;
    if (!body.children.length) body.innerHTML = tableSkeleton(5, 6);
    api.getAuditLogs({ limit: audit.limit, offset: (audit.page - 1) * audit.limit, action: audit.action || undefined, resourceType: audit.resource || undefined, search: audit.search || undefined, startDate: rangeStart() })
      .then(function (logs) {
        var total = logs.totalCount != null ? logs.totalCount : logs.length;
        var pages = Math.ceil(total / audit.limit) || 1;
        el('auditShowing').textContent = logs.length; el('auditTotal').textContent = total;
        el('auditPage').textContent = audit.page; el('auditPages').textContent = pages;
        el('auditPrev').disabled = audit.page <= 1; el('auditNext').disabled = audit.page >= pages;
        if (!logs.length) { body.innerHTML = '<tr><td colspan="5">' + emptyBlock('audit', 'Aucun événement', 'Aucune action ne correspond aux filtres actuels.', false) + '</td></tr>'; return; }
        body.innerHTML = logs.map(function (l) {
          var chg = JSON.stringify(l.new_values || l.reason || {});
          return '<tr><td class="cell-muted" style="white-space:nowrap">' + esc(fmtTime(l.created_at)) + '</td>' +
            '<td>' + actTag(l.action) + '</td>' +
            '<td><span class="cell-strong">' + esc(l.resource_type || '') + '</span> <span class="cell-mono">' + esc(l.resource_id || '') + '</span></td>' +
            '<td><span class="actor"><span class="adot">' + esc(initials(l.admin_id)) + '</span>' + esc(l.admin_id || '—') + '</span></td>' +
            '<td><span class="chg">' + esc(chg) + '</span></td></tr>';
        }).join('');
      }).catch(function (err) { body.innerHTML = '<tr><td colspan="5">' + errorState("Journal indisponible", err.message) + '</td></tr>'; });
  }
  function exportAudit(format) {
    toast('Préparation de l\'export ' + format.toUpperCase() + '…');
    api.exportAuditLogs({ action: audit.action || undefined, resourceType: audit.resource || undefined, search: audit.search || undefined, startDate: rangeStart() }, format)
      .then(function () { toast('Export ' + format.toUpperCase() + ' téléchargé.'); setTimeout(loadAudit, 500); })
      .catch(function (e) { toast(e.message || 'Échec de l\'export', true); });
  }

  /* --------------------------- empty / error --------------------------- */
  function emptyBlock(ic, title, desc, withClear) {
    return '<div class="empty">' + icon(ic) + '<div class="empty-title">' + esc(title) + '</div><div class="empty-desc">' + esc(desc) + '</div>' +
      (withClear ? '<button class="btn btn-ghost btn-sm" id="emptyClear">Réinitialiser les filtres</button>' : '') + '</div>';
  }
  function errorState(title, msg) {
    return '<div class="empty">' + icon('x') + '<div class="empty-title">' + esc(title) + '</div><div class="empty-desc">' + esc(msg || '') + '</div></div>';
  }
  document.addEventListener('click', function (e) {
    if (e.target.id === 'emptyClear' || e.target.closest('#emptyClear')) {
      storeState = { status: 'ALL', search: '', city: '', tier: '' };
      $$('#storeSeg .seg').forEach(function (x) { x.classList.toggle('is-active', x.getAttribute('data-status') === 'ALL'); x.setAttribute('aria-selected', x.getAttribute('data-status') === 'ALL'); });
      if (el('storeSearch')) el('storeSearch').value = '';
      if (el('fCity')) el('fCity').value = ''; if (el('fTier')) el('fTier').value = '';
      el('filterDot').hidden = true; loadStores();
    }
  });

  /* ------------------------- stores toolbar wiring --------------------- */
  $$('#storeSeg .seg').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('#storeSeg .seg').forEach(function (x) { x.classList.toggle('is-active', x === b); x.setAttribute('aria-selected', x === b); });
      storeState.status = b.getAttribute('data-status'); loadStores();
    });
  });
  el('storeSearch').addEventListener('input', debounce(function () { storeState.search = el('storeSearch').value.trim(); loadStores(); }, 260));

  function toggleFilterPop(force) {
    var pop = el('filterPop'); var open = force != null ? force : pop.hidden;
    pop.hidden = !open; el('filterBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  el('filterBtn').addEventListener('click', function (e) { e.stopPropagation(); toggleFilterPop(); });
  el('fApply').addEventListener('click', function () {
    storeState.city = el('fCity').value.trim(); storeState.tier = el('fTier').value;
    el('filterDot').hidden = !(storeState.city || storeState.tier);
    toggleFilterPop(false); loadStores();
  });
  el('fClear').addEventListener('click', function () {
    el('fCity').value = ''; el('fTier').value = ''; storeState.city = ''; storeState.tier = '';
    el('filterDot').hidden = true; toggleFilterPop(false); loadStores();
  });

  /* ----------------------------- drawer close -------------------------- */
  el('drawerClose').addEventListener('click', closeDrawer);
  el('drawerScrim').addEventListener('click', closeDrawer);

  /* --------------------------- system status --------------------------- */
  function paintHealth(res) {
    var status = (res && res.status) || 'UNKNOWN';
    var box = el('sysStatus');
    box.classList.remove('ok', 'warn', 'down');
    box.classList.add(status === 'HEALTHY' ? 'ok' : (status === 'UNKNOWN' ? 'down' : 'warn'));
    el('sysLabel').textContent = status === 'HEALTHY' ? 'Système opérationnel' : ('Système ' + status.toLowerCase());
  }
  function probeHealth(announce) {
    if (announce) toast('Diagnostic d\'infrastructure en cours…');
    api.getDeepHealth().then(function (res) {
      paintHealth(res);
      if (announce) {
        var db = (res.services && res.services.database) || {}; var ca = (res.services && res.services.cache) || {}; var me = (res.services && res.services.memory) || {};
        openModal({ title: 'Diagnostic infrastructure', body: 'Statut global : ' + (res.status || 'N/A') + '\nBase de données : ' + (db.status || 'N/A') + ' (' + (db.latencyMs || 0) + ' ms)\nCache : ' + (ca.status || 'N/A') + ' (' + (ca.latencyMs || 0) + ' ms)\nRAM heap : ' + (me.heapUsedMb || 0) + ' MB\nUptime : ' + (res.uptimeSeconds || 0) + ' s', confirmText: 'Fermer' });
      }
    }).catch(function (e) { paintHealth({ status: 'UNKNOWN' }); if (announce) toast('Diagnostic échoué: ' + e.message, true); });
  }
  el('sysStatus').addEventListener('click', function () { probeHealth(true); });

  /* ------------------------------ init --------------------------------- */
  // Boot only once superAdminGate.js has let the visitor in (docs/ROUTING.md): a
  // visitor without the role sees why, not a wall of failed requests.
  function boot() {
    el('adminMail').textContent = 'admin@loumoo.cm';
    el('adminAvatar').textContent = 'A';
    var initial = (location.hash || '#overview').replace('#', '');
    go(SECTIONS[initial] ? initial : 'overview');
    probeHealth(false);
  }
  var gate = window.SuperAdminGate;
  if (gate && gate.ready && typeof gate.ready.then === 'function') {
    gate.ready.then(function (open) { if (open) boot(); });
  } else {
    boot();
  }
})();
