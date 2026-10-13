/**
 * LOUMOO SuperAdmin — superAdminGate.js
 * ---------------------------------------------------------------------------
 * The control center is served as its own document at /admin and /superadmin
 * (docs/ROUTING.md). Before it shows anything it asks the server who the visitor is
 * (GET /api/v1/me/state) and decides, by the URL it was opened at:
 *
 *   /admin       admin or super_admin
 *   /superadmin  super_admin only
 *
 * This is a courtesy, not a security boundary: it spares an ordinary visitor a
 * wall of failed requests and says plainly why. Every administrative request is
 * authorized again by the backend (SuperAdmin/backend/middleware/superAdminGuard.js).
 *
 * Exposes `window.SuperAdminGate.ready`, a promise resolving true when the app may
 * boot and false when it must not.
 */
(function () {
  'use strict';

  var path = (location.pathname || '/').replace(/\/+$/, '') || '/';
  var REQUIRED = path === '/superadmin' ? ['super_admin'] : ['admin', 'super_admin'];

  function token() {
    try {
      return localStorage.getItem('loumoo_token') || localStorage.getItem('loumoo_supabase_session_token') || '';
    } catch (e) { return ''; }
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showPanel(kind, title, body, actions) {
    var host = document.createElement('div');
    host.id = 'saGate';
    host.setAttribute('role', 'alert');
    host.setAttribute('data-gate', kind);
    host.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;background:#0b1220;color:#e8edf7;font:15px/1.5 system-ui,sans-serif';
    host.innerHTML =
      '<div style="max-width:440px;text-align:center">' +
        '<h1 style="margin:0 0 10px;font-size:22px">' + esc(title) + '</h1>' +
        '<p style="margin:0 0 22px;color:#9fb0cc">' + esc(body) + '</p>' +
        '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">' +
          actions.map(function (a) {
            return '<a href="' + esc(a.href) + '" style="padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:700;' +
              (a.primary ? 'background:#2f5bff;color:#fff' : 'border:1px solid #33425f;color:#e8edf7') + '">' + esc(a.label) + '</a>';
          }).join('') +
        '</div>' +
      '</div>';
    document.body.appendChild(host);
    document.documentElement.setAttribute('data-sa-gate', kind);
  }

  var signIn = '/sign-in?returnTo=' + encodeURIComponent(path === '/superadmin' ? '/superadmin' : '/admin');

  var ready = new Promise(function (resolve) {
    var t = token();
    if (!t) {
      showPanel('signin', 'Connexion requise', 'Connectez-vous avec un compte administrateur pour ouvrir ce centre de contrôle.',
        [{ href: signIn, label: 'Se connecter', primary: true }, { href: '/', label: "Retour à l'application" }]);
      return resolve(false);
    }
    fetch('/api/v1/me/state', { headers: { Authorization: 'Bearer ' + t, Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (res) {
        if (res.status === 401) {
          showPanel('signin', 'Session expirée', 'Votre session n\'est plus valide. Reconnectez-vous pour continuer.',
            [{ href: signIn, label: 'Se connecter', primary: true }, { href: '/', label: "Retour à l'application" }]);
          return resolve(false);
        }
        if (res.status === 403) {
          showPanel('suspended', 'Compte suspendu', 'Ce compte est suspendu. Contactez le support LOUMOO.',
            [{ href: '/', label: "Retour à l'application", primary: true }]);
          return resolve(false);
        }
        return res.json().then(function (body) {
          var state = (body && body.data) || body || {};
          var role = state.user && state.user.primaryRole;
          if (REQUIRED.indexOf(role) !== -1) { document.documentElement.setAttribute('data-sa-gate', 'open'); return resolve(true); }
          showPanel('forbidden', 'Accès refusé',
            path === '/superadmin'
              ? 'Cette zone est réservée aux super-administrateurs.'
              : 'Cette zone est réservée aux administrateurs.',
            [{ href: '/', label: "Retour à l'application", primary: true }, { href: signIn, label: 'Changer de compte' }]);
          return resolve(false);
        });
      })
      .catch(function () {
        // The server could not be reached: say so rather than guessing. The app stays closed.
        showPanel('offline', 'Serveur injoignable', 'Impossible de vérifier votre session. Vérifiez votre connexion puis rechargez la page.',
          [{ href: path, label: 'Recharger', primary: true }]);
        resolve(false);
      });
  });

  window.SuperAdminGate = { ready: ready, required: REQUIRED };
})();
