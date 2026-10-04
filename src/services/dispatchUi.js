/**
 * LOUMOO Dispatch UI kit
 * ---------------------------------------------------------------------------
 * The shared, framework-agnostic building blocks behind the seller dispatch
 * board, the rider job app and the rider admin: an iOS-style navigation stack
 * (large titles that collapse into the bar, push/pop transitions), inset grouped
 * lists, bottom sheets with a grabber and drag-to-dismiss, confirmation sheets, a
 * segmented control, offer countdown rings, toasts, skeletons and empty states.
 *
 * It renders with LOUMOO's own design tokens (--color-*, --font-*, --radius-*,
 * --shadow-*), so it inherits the brand and the [data-theme="dark"] palette. Like
 * the tracking overlay, it owns its DOM instead of being a DC child screen: these
 * screens are all logic, and DC children carry none (see docs/DELIVERY_FRONTEND.md).
 *
 * Accessibility: dialogs are labelled and modal, focus is trapped in the top
 * layer and restored on close, Escape closes the top layer, every control is at
 * least 44px, focus rings are visible, toasts use a polite live region, and all
 * motion is dropped under prefers-reduced-motion.
 *
 * Exposes window.LoumooDispatchUI. Every string that reaches innerHTML goes
 * through esc().
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.LoumooDispatchUI) return;

  var Z = 3500; // under the tracking overlay (4000), so "Track live" opens on top

  // ------------------------------------------------------------------ helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function h(html) {
    var t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  }
  function haptic(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) { /* unsupported */ }
  }
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* old browser */ }

  // Line icons on a 24px grid (Lucide-style geometry), stroke = currentColor.
  var ICONS = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    forward: '<path d="M9 18l6-6-6-6"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    package: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    scooter: '<circle cx="5.5" cy="17.5" r="2.5"/><circle cx="18.5" cy="17.5" r="2.5"/><path d="M8 17.5h7.5l-3-8H9"/><path d="M15 6h2.5l1 4.5"/><path d="M12.5 9.5H17"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 1 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    store: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v2a3 3 0 0 1-5.33 1.9A3 3 0 0 1 12 14a3 3 0 0 1-2.67-1.1A3 3 0 0 1 4 11V9z"/><path d="M5 13.5V20h14v-6.5"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.34 1.85.57 2.8.7A2 2 0 0 1 22 16.9z"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.5 8.5 0 1 1 21 11.5z"/>',
    navigate: '<path d="M3 11l18-8-8 18-2-8-8-2z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/>',
    alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    flag: '<path d="M4 21V4"/><path d="M4 4h12l-2 4 2 4H4"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    location: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5.5 3.5-5.5 3.5z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>'
  };
  function icon(name, size, extra) {
    var s = size || 20;
    return '<svg class="ldx-ico' + (extra ? ' ' + extra : '') + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  // ------------------------------------------------------------ formatting
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0).toUpperCase(); }).join('') || '?';
  }
  function hueFor(text) {
    var s = String(text || ''), n = 0;
    for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
    return n % 360;
  }
  function avatar(name, size) {
    var sz = size || 40, hue = hueFor(name);
    return '<span class="ldx-avatar" style="width:' + sz + 'px;height:' + sz + 'px;font-size:' + Math.round(sz * 0.38) + 'px;' +
      'background:linear-gradient(145deg,hsl(' + hue + ' 72% 62%),hsl(' + ((hue + 28) % 360) + ' 70% 48%))" aria-hidden="true">' + esc(initials(name)) + '</span>';
  }
  function money(xaf) {
    if (xaf == null || !isFinite(xaf)) return '';
    return 'XAF ' + Math.round(xaf).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
  function relTime(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    var s = Math.round((Date.now() - t) / 1000);
    if (s < 45) return 'just now';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    var hr = Math.round(m / 60);
    if (hr < 24) return hr + ' h ago';
    var d = Math.round(hr / 24);
    if (d < 7) return d + ' d ago';
    try { return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch (e) { return ''; }
  }
  function clockTime(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    try { return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function mmss(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }
  function digits(p) { return String(p || '').replace(/[^\d]/g, ''); }
  function telHref(phone) { return 'tel:' + String(phone || '').replace(/[^\d+]/g, ''); }
  function waHref(phone) { var d = digits(phone); return d ? 'https://wa.me/' + d : null; }
  function mapsHref(loc, address) {
    if (loc && isFinite(loc.lat) && isFinite(loc.lng)) return 'https://www.google.com/maps/dir/?api=1&destination=' + loc.lat + ',' + loc.lng;
    if (address) return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(address);
    return null;
  }
  function km(a, b) {
    if (!a || !b) return null;
    var R = 6371, toRad = function (d) { return d * Math.PI / 180; };
    var dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    var s = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  // Each delivery status, as the people who run deliveries say it.
  var STATUS = {
    none: { label: 'Needs a rider', tone: 'warn' },
    pending_assignment: { label: 'Needs a rider', tone: 'warn' },
    assigned: { label: 'Waiting for rider', tone: 'accent' },
    accepted: { label: 'Rider heading to pickup', tone: 'accent' },
    picked_up: { label: 'Out for delivery', tone: 'accent' },
    arrived: { label: 'Rider at the door', tone: 'accent' },
    delivered: { label: 'Delivered', tone: 'ok' },
    failed: { label: 'Attempt failed', tone: 'bad' },
    cancelled: { label: 'Delivery cancelled', tone: 'muted' }
  };
  function statusInfo(status) { return STATUS[status || 'none'] || { label: String(status), tone: 'muted' }; }
  function badge(text, tone) {
    return '<span class="ldx-badge ldx-tone-' + esc(tone || 'muted') + '"><span class="ldx-badge-dot"></span>' + esc(text) + '</span>';
  }
  function statusBadge(status) { var s = statusInfo(status); return badge(s.label, s.tone); }

  // ------------------------------------------------------------------ styles
  function injectStyles() {
    if (document.getElementById('ldx-styles')) return;
    var css = [
      // tokens (LOUMOO first, Apple system colours as the fallback)
      '.ldx-root{--ldx-accent:var(--color-accent,#007aff);--ldx-accent-soft:var(--color-accent-100,#eaf3ff);--ldx-ok:var(--color-success,#34c759);--ldx-ok-soft:var(--color-success-100,#e6f9ed);--ldx-warn:#ff9500;--ldx-warn-soft:#fff4e5;--ldx-bad:var(--color-danger,#ff3b30);--ldx-bad-soft:var(--color-danger-100,#fee4e2);--ldx-bg:var(--color-bg,#f2f2f7);--ldx-surface:var(--color-surface,#fff);--ldx-fill:var(--color-neutral-200,#eef0f4);--ldx-fill-2:var(--color-neutral-100,#f6f7f9);--ldx-text:var(--color-text,#111214);--ldx-text-2:var(--color-text-secondary,#525763);--ldx-text-3:var(--color-text-muted,#838a98);--ldx-sep:var(--color-divider,#e6e8ec);--ldx-font:var(--font-body,-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif);--ldx-font-h:var(--font-heading,-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif);--ldx-ease:cubic-bezier(.16,1,.3,1);--ldx-ease-out:cubic-bezier(.2,.8,.2,1);--ldx-accent-ink:var(--color-accent-600,#0062cc);--ldx-ok-ink:#007a34;--ldx-warn-ink:#b45309;--ldx-bad-ink:#b42318;font-family:var(--ldx-font);color:var(--ldx-text);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;-webkit-tap-highlight-color:transparent}',
      '[data-theme="dark"] .ldx-root{--ldx-warn:#ff9f0a;--ldx-warn-soft:rgba(255,159,10,.14);--ldx-ok-soft:rgba(48,209,88,.14);--ldx-accent-soft:rgba(10,132,255,.16);--ldx-bad-soft:rgba(255,69,58,.15);--ldx-fill:#1f2330;--ldx-fill-2:#171a23;--ldx-accent-ink:#409cff;--ldx-ok-ink:#30d158;--ldx-warn-ink:#ff9f0a;--ldx-bad-ink:#ff6b63}',
      // The bright tones fill bars, rings and tiles; text and small icons in a
      // tone use its -ink shade, which keeps 4.5:1 on white and on its soft fill.
      '.ldx-root *,.ldx-root *::before,.ldx-root *::after{box-sizing:border-box}',
      ':where(.ldx-root) button{font:inherit;color:inherit}',
      ':where(.ldx-root) a{color:inherit}',
      '.ldx-root :focus-visible{outline:3px solid var(--ldx-accent);outline:3px solid color-mix(in srgb,var(--ldx-accent) 55%,transparent);outline-offset:2px;border-radius:12px}',
      // Text fields show focus the native way (caret, tinted label or icon), not with a ring.
      '.ldx-root input:not([type=radio]):not([type=checkbox]):focus-visible,.ldx-root textarea:focus-visible{outline:none}',
      // A row's ring is drawn inside it, so its group's rounded clip can't cut it off.
      '.ldx-row:focus-visible{outline-offset:-3px}',
      // layer: full screen on phones, a centred card on wider screens
      '.ldx-layer{position:fixed;inset:0;z-index:' + Z + ';display:flex;align-items:stretch;justify-content:center}',
      '.ldx-scrim{position:absolute;inset:0;background:rgba(0,0,0,.32);opacity:0;transition:opacity .28s var(--ldx-ease-out);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}',
      '.ldx-layer.is-open .ldx-scrim{opacity:1}',
      '.ldx-window{position:relative;width:100%;height:100%;background:var(--ldx-bg);overflow:hidden;transform:translateY(24px);opacity:0;transition:transform .42s var(--ldx-ease),opacity .25s var(--ldx-ease-out)}',
      '.ldx-layer.is-open .ldx-window{transform:none;opacity:1}',
      '@media (min-width:760px){.ldx-layer{align-items:center;padding:24px}.ldx-window{max-width:520px;height:min(860px,calc(100vh - 48px));border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,.22),0 0 0 .5px rgba(0,0,0,.06)}}',
      // navigation stack
      '.ldx-page{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--ldx-bg);transition:transform .44s var(--ldx-ease),filter .44s var(--ldx-ease)}',
      '.ldx-page.is-entering{transform:translateX(100%)}',
      '.ldx-page.is-covered{transform:translateX(-28%);filter:brightness(.92)}',
      '.ldx-page.is-leaving{transform:translateX(100%)}',
      '.ldx-bar{position:relative;z-index:2;flex-shrink:0;padding:env(safe-area-inset-top,0px) 6px 0 6px;height:calc(52px + env(safe-area-inset-top,0px));display:flex;align-items:center;gap:4px;background:var(--ldx-bg);background:color-mix(in srgb,var(--ldx-bg) 82%,transparent);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);border-bottom:.5px solid transparent;transition:border-color .2s}',
      '.ldx-page.is-scrolled .ldx-bar{border-bottom-color:var(--ldx-sep)}',
      '.ldx-bar-title{position:absolute;left:64px;right:64px;text-align:center;font:600 17px/1.2 var(--ldx-font-h);letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;transform:translateY(4px);transition:opacity .2s,transform .2s;pointer-events:none}',
      '.ldx-page.is-scrolled .ldx-bar-title,.ldx-page.no-large .ldx-bar-title{opacity:1;transform:none}',
      '.ldx-navbtn{min-width:44px;height:44px;padding:0 10px;border:0;background:transparent;color:var(--ldx-accent);display:inline-flex;align-items:center;gap:2px;border-radius:12px;cursor:pointer;font:400 17px/1 var(--ldx-font);letter-spacing:-.01em;transition:opacity .15s}',
      '.ldx-navbtn:active{opacity:.45}',
      '.ldx-navbtn.is-icon{width:44px;justify-content:center;padding:0}',
      '.ldx-bar-spacer{flex:1}',
      '.ldx-scroll{flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:0 16px calc(28px + env(safe-area-inset-bottom,0px))}',
      '.ldx-large{padding:2px 4px 14px}',
      '.ldx-large h1:focus,.ldx-bar-title:focus{outline:none}',
      '.ldx-large h1{margin:0;font:700 31px/1.12 var(--ldx-font-h);letter-spacing:-.025em;color:var(--ldx-text)}',
      '.ldx-large p{margin:6px 0 0;font:400 15px/1.4 var(--ldx-font);color:var(--ldx-text-2)}',
      '.ldx-footer{flex-shrink:0;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));background:var(--ldx-bg);background:color-mix(in srgb,var(--ldx-bg) 86%,transparent);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);border-top:.5px solid var(--ldx-sep);display:flex;flex-direction:column;gap:10px}',
      '.ldx-footer:empty{display:none}',
      // grouped lists
      '.ldx-section{margin:0 0 22px}',
      '.ldx-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:0 4px 8px}',
      '.ldx-section-head h2{margin:0;font:600 13px/1.2 var(--ldx-font);letter-spacing:.02em;text-transform:uppercase;color:var(--ldx-text-3)}',
      '.ldx-section-head .ldx-count{font:500 13px/1 var(--ldx-font);color:var(--ldx-text-3);font-variant-numeric:tabular-nums}',
      '.ldx-section-foot{padding:8px 4px 0;font:400 13px/1.4 var(--ldx-font);color:var(--ldx-text-3)}',
      '.ldx-group{background:var(--ldx-surface);border-radius:16px;overflow:hidden}',
      '.ldx-row{position:relative;display:flex;align-items:center;gap:12px;width:100%;min-height:60px;padding:12px 16px;border:0;background:transparent;text-align:left;cursor:pointer;color:inherit;transition:background-color .15s}',
      '.ldx-row:not(:last-child)::after{content:"";position:absolute;left:var(--ldx-inset,16px);right:0;bottom:0;height:.5px;background:var(--ldx-sep)}',
      'button.ldx-row:active,a.ldx-row:active{background:var(--ldx-fill)}',
      '.ldx-row.is-static{cursor:default}',
      '.ldx-row.no-sep::after{display:none}',
      '.ldx-row.is-dim{opacity:.55}',
      '.ldx-row-main{flex:1;min-width:0}',
      '.ldx-row-title{font:600 16px/1.25 var(--ldx-font);letter-spacing:-.01em;color:var(--ldx-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // Mail-style first line: title, then the time pinned to the right.
      '.ldx-row-head{display:flex;align-items:baseline;gap:8px;min-width:0}',
      '.ldx-row-head .ldx-row-title{flex:1;min-width:0}',
      '.ldx-row-time{flex-shrink:0;font:400 13px/1.25 var(--ldx-font);color:var(--ldx-text-3);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.ldx-row-sub{margin-top:2px;font:400 14px/1.3 var(--ldx-font);color:var(--ldx-text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ldx-row-sub.is-wrap{white-space:normal}',
      '.ldx-row-status{margin-top:2px;font:600 14px/1.3 var(--ldx-font);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ldx-text-2)}',
      '.ldx-row-status.ldx-tone-accent{color:var(--ldx-accent-ink)}.ldx-row-status.ldx-tone-ok{color:var(--ldx-ok-ink)}.ldx-row-status.ldx-tone-warn{color:var(--ldx-warn-ink)}.ldx-row-status.ldx-tone-bad{color:var(--ldx-bad-ink)}',
      '.ldx-row-meta{margin-top:2px;font:400 13px/1.3 var(--ldx-font);color:var(--ldx-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}',
      '.ldx-row-end{display:flex;align-items:center;gap:8px;flex-shrink:0;color:var(--ldx-text-3)}',
      '.ldx-tile{width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--ldx-fill);color:var(--ldx-text-2)}',
      '.ldx-tile.ldx-tone-accent{background:var(--ldx-accent-soft);color:var(--ldx-accent-ink)}',
      '.ldx-tile.ldx-tone-ok{background:var(--ldx-ok-soft);color:var(--ldx-ok-ink)}',
      '.ldx-tile.ldx-tone-warn{background:var(--ldx-warn-soft);color:var(--ldx-warn-ink)}',
      '.ldx-tile.ldx-tone-bad{background:var(--ldx-bad-soft);color:var(--ldx-bad-ink)}',
      '.ldx-avatar{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font-weight:700;letter-spacing:.01em;flex-shrink:0;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.06)}',
      // badges
      '.ldx-badge{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;font:600 12.5px/1 var(--ldx-font);white-space:nowrap;background:var(--ldx-fill);color:var(--ldx-text-2)}',
      '.ldx-badge-dot{width:6px;height:6px;border-radius:50%;background:currentColor}',
      '.ldx-badge.ldx-tone-accent{background:var(--ldx-accent-soft);color:var(--ldx-accent-ink)}',
      '.ldx-badge.ldx-tone-ok{background:var(--ldx-ok-soft);color:var(--ldx-ok-ink)}',
      '.ldx-badge.ldx-tone-warn{background:var(--ldx-warn-soft);color:var(--ldx-warn-ink)}',
      '.ldx-badge.ldx-tone-bad{background:var(--ldx-bad-soft);color:var(--ldx-bad-ink)}',
      '.ldx-badge.ldx-plain .ldx-badge-dot{display:none}',
      // cards
      '.ldx-card{background:var(--ldx-surface);border-radius:20px;padding:18px;margin:0 0 16px}',
      '.ldx-card.is-hero{padding:22px 20px}',
      '.ldx-eyebrow{font:600 12.5px/1.2 var(--ldx-font);letter-spacing:.02em;text-transform:uppercase;color:var(--ldx-text-3);margin:0 0 6px}',
      '.ldx-eyebrow.ldx-tone-accent{color:var(--ldx-accent-ink)}.ldx-eyebrow.ldx-tone-ok{color:var(--ldx-ok-ink)}.ldx-eyebrow.ldx-tone-warn{color:var(--ldx-warn-ink)}.ldx-eyebrow.ldx-tone-bad{color:var(--ldx-bad-ink)}',
      '.ldx-title2{margin:0;font:700 22px/1.2 var(--ldx-font-h);letter-spacing:-.02em}',
      '.ldx-body{margin:6px 0 0;font:400 15px/1.45 var(--ldx-font);color:var(--ldx-text-2)}',
      '.ldx-meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:12px;font:500 13.5px/1.3 var(--ldx-font);color:var(--ldx-text-2)}',
      '.ldx-meta span{display:inline-flex;align-items:center;gap:5px}',
      // buttons
      '.ldx-btn{text-decoration:none;position:relative;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:50px;padding:0 20px;border:0;border-radius:14px;font:600 17px/1 var(--ldx-font);letter-spacing:-.01em;cursor:pointer;user-select:none;-webkit-user-select:none;transition:transform .12s var(--ldx-ease-out),opacity .15s,background-color .15s;background:var(--ldx-accent);color:#fff}',
      '.ldx-btn:active{transform:scale(.97)}',
      '.ldx-btn[disabled]{opacity:.38;cursor:default;transform:none}',
      '.ldx-btn.is-block{width:100%}',
      '.ldx-btn.is-medium{min-height:44px;font-size:16px;border-radius:12px;padding:0 16px}',
      '.ldx-btn.is-small{min-height:34px;padding:0 14px;font-size:14.5px;border-radius:999px}',
      '.ldx-btn.is-tinted{background:var(--ldx-accent-soft);color:var(--ldx-accent-ink)}',
      '.ldx-btn.is-gray{background:var(--ldx-fill);color:var(--ldx-text)}',
      '.ldx-btn.is-plain{background:transparent;color:var(--ldx-accent)}',
      '.ldx-btn.is-destructive{background:var(--ldx-bad-soft);color:var(--ldx-bad-ink)}',
      '.ldx-btn.is-ok{background:var(--ldx-ok);color:#fff}',
      '.ldx-btn.is-busy{color:transparent!important;pointer-events:none}',
      '.ldx-btn.is-busy::after{content:"";position:absolute;width:20px;height:20px;border-radius:50%;border:2.5px solid rgba(255,255,255,.35);border-top-color:#fff;animation:ldx-spin .7s linear infinite}',
      '.ldx-btn.is-busy.is-tinted::after,.ldx-btn.is-busy.is-gray::after,.ldx-btn.is-busy.is-plain::after,.ldx-btn.is-busy.is-destructive::after{border-color:var(--ldx-fill);border-top-color:var(--ldx-accent)}',
      '.ldx-btn-row{display:flex;gap:10px}',
      '.ldx-btn-row>.ldx-btn{flex:1}',
      '.ldx-iconbtn{width:44px;height:44px;border-radius:50%;border:0;display:inline-flex;align-items:center;justify-content:center;background:var(--ldx-fill);color:var(--ldx-accent);cursor:pointer;text-decoration:none;transition:transform .12s var(--ldx-ease-out)}',
      '.ldx-iconbtn:active{transform:scale(.92)}',
      // Contact buttons are one family: tinted, blue to call, green for WhatsApp.
      '.ldx-iconbtn.is-call{background:var(--ldx-accent-soft);color:var(--ldx-accent-ink)}',
      '.ldx-iconbtn.is-wa,.ldx-btn.is-wa{background:var(--ldx-ok-soft);color:var(--ldx-ok-ink)}',
      // segmented control
      '.ldx-seg{position:relative;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;padding:2px;margin:0 0 18px;border-radius:10px;background:var(--ldx-fill)}',
      '.ldx-seg-thumb{position:absolute;top:2px;bottom:2px;left:2px;border-radius:8px;background:var(--ldx-surface);box-shadow:0 3px 8px rgba(0,0,0,.12),0 3px 1px rgba(0,0,0,.04);transition:transform .32s var(--ldx-ease),width .32s var(--ldx-ease)}',
      '[data-theme="dark"] .ldx-seg-thumb{background:#3a3f4d}',
      '.ldx-seg button{position:relative;z-index:1;min-height:34px;border:0;background:transparent;font:500 14px/1 var(--ldx-font);color:var(--ldx-text);cursor:pointer;border-radius:8px;white-space:nowrap;padding:0 6px}',
      '.ldx-seg button[aria-selected="true"]{font-weight:600}',
      '.ldx-seg-n{margin-left:5px;font-variant-numeric:tabular-nums;color:var(--ldx-text-3);font-weight:500}',
      // search
      '.ldx-search{position:relative;display:block;margin:0 0 16px}',
      '.ldx-search input{width:100%;height:40px;padding:0 36px 0 36px;border:0;border-radius:11px;background:var(--ldx-fill);font:400 16px/1 var(--ldx-font);color:var(--ldx-text);outline:none;-webkit-appearance:none}',
      '.ldx-search input::placeholder{color:var(--ldx-text-3)}',
      '.ldx-search input,.ldx-field input,.ldx-field textarea{caret-color:var(--ldx-accent)}',
      '.ldx-search:focus-within>.ldx-ico{color:var(--ldx-accent)}',
      '.ldx-search .ldx-ico{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--ldx-text-3);pointer-events:none}',
      '.ldx-search-clear{position:absolute;right:4px;top:4px;width:32px;height:32px;border:0;border-radius:50%;background:transparent;color:var(--ldx-text-3);cursor:pointer;display:none;align-items:center;justify-content:center}',
      '.ldx-search.has-value .ldx-search-clear{display:flex}',
      // forms
      '.ldx-field{display:block;padding:10px 16px;position:relative}',
      '.ldx-field:not(:last-child)::after{content:"";position:absolute;left:16px;right:0;bottom:0;height:.5px;background:var(--ldx-sep)}',
      '.ldx-field span{display:block;font:500 12.5px/1.2 var(--ldx-font);color:var(--ldx-text-3);margin-bottom:3px;transition:color .15s}',
      '.ldx-field:focus-within>span{color:var(--ldx-accent)}',
      '.ldx-field input,.ldx-field textarea{width:100%;border:0;background:transparent;padding:2px 0;font:400 16px/1.35 var(--ldx-font);color:var(--ldx-text);outline:none;resize:none}',
      '.ldx-field input::placeholder,.ldx-field textarea::placeholder{color:var(--ldx-text-3)}',
      '.ldx-hint{font:400 13px/1.4 var(--ldx-font);color:var(--ldx-text-3);padding:8px 4px 0}',
      '.ldx-error-text{font:500 13.5px/1.35 var(--ldx-font);color:var(--ldx-bad-ink);padding:8px 4px 0}',
      // countdown ring
      '.ldx-ring{position:relative;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}',
      '.ldx-ring svg{transform:rotate(-90deg)}',
      '.ldx-ring .ldx-ring-track{stroke:var(--ldx-fill)}',
      '.ldx-ring .ldx-ring-val{stroke:var(--ldx-accent);transition:stroke-dashoffset 1s linear,stroke .3s}',
      '.ldx-ring.is-soon .ldx-ring-val{stroke:var(--ldx-warn)}',
      '.ldx-ring.is-urgent .ldx-ring-val{stroke:var(--ldx-bad)}',
      '.ldx-ring-label{position:absolute;font:600 12px/1 var(--ldx-font);font-variant-numeric:tabular-nums;color:var(--ldx-text)}',
      '.ldx-ring.is-large .ldx-ring-label{font:700 22px/1 var(--ldx-font-h);letter-spacing:-.02em}',
      '.ldx-ring.is-large .ldx-ring-cap{position:absolute;top:58%;font:500 11.5px/1 var(--ldx-font);color:var(--ldx-text-3)}',
      // progress steps
      '.ldx-steps{display:flex;align-items:center;gap:6px;margin-top:16px}',
      '.ldx-step{flex:1;height:4px;border-radius:2px;background:var(--ldx-fill);overflow:hidden}',
      '.ldx-step.is-done{background:var(--ldx-accent)}',
      '.ldx-step.is-ok{background:var(--ldx-ok)}',
      '.ldx-step-labels{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px;font:500 12px/1.2 var(--ldx-font);color:var(--ldx-text-3)}',
      '.ldx-step-labels span.is-on{color:var(--ldx-text);font-weight:600}',
      '.ldx-step-labels b{color:var(--ldx-text);font-weight:600}',
      // states
      '.ldx-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:56px 24px 40px}',
      '.ldx-empty-ico{width:72px;height:72px;border-radius:22px;display:flex;align-items:center;justify-content:center;background:var(--ldx-accent-soft);color:var(--ldx-accent);margin-bottom:18px}',
      '.ldx-empty-ico.is-muted{background:var(--ldx-fill);color:var(--ldx-text-2)}',
      '.ldx-empty h3{margin:0;font:700 20px/1.25 var(--ldx-font-h);letter-spacing:-.015em}',
      '.ldx-empty p{margin:8px 0 0;max-width:320px;font:400 15px/1.45 var(--ldx-font);color:var(--ldx-text-2)}',
      '.ldx-empty .ldx-btn{margin-top:22px}',
      '.ldx-skel{background:linear-gradient(90deg,var(--ldx-fill) 25%,var(--ldx-fill-2) 37%,var(--ldx-fill) 63%);background-size:400% 100%;animation:ldx-shimmer 1.4s ease infinite;border-radius:8px}',
      '.ldx-chip{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;background:var(--ldx-fill);font:500 13.5px/1 var(--ldx-font);color:var(--ldx-text-2)}',
      '.ldx-chip.is-live{background:var(--ldx-ok-soft);color:var(--ldx-ok-ink)}',
      '.ldx-chip.is-warn{background:var(--ldx-warn-soft);color:var(--ldx-warn-ink)}',
      '.ldx-pulse{width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 0 0 currentColor;animation:ldx-pulse 1.8s infinite}',
      // sheet
      '.ldx-sheet-layer{position:fixed;inset:0;z-index:' + (Z + 20) + ';display:flex;align-items:flex-end;justify-content:center}',
      '.ldx-sheet{position:relative;width:100%;max-width:560px;max-height:92vh;display:flex;flex-direction:column;background:var(--ldx-bg);border-radius:22px 22px 0 0;box-shadow:0 -8px 40px rgba(0,0,0,.18);transform:translateY(100%);transition:transform .42s var(--ldx-ease);padding-bottom:env(safe-area-inset-bottom,0px)}',
      '.ldx-sheet-layer.is-open .ldx-sheet{transform:none}',
      '@media (min-width:760px){.ldx-sheet-layer{align-items:center}.ldx-sheet{border-radius:22px;max-width:440px;transform:translateY(16px) scale(.98);opacity:0;transition:transform .3s var(--ldx-ease),opacity .2s}.ldx-sheet-layer.is-open .ldx-sheet{transform:none;opacity:1}}',
      '.ldx-grabber{display:flex;justify-content:center;padding:8px 0 2px;cursor:grab;touch-action:none}',
      '.ldx-grabber i{width:36px;height:5px;border-radius:3px;background:var(--ldx-sep)}',
      '@media (min-width:760px){.ldx-grabber{display:none}}',
      '.ldx-sheet-head{display:flex;align-items:center;gap:8px;padding:6px 8px 4px 20px}',
      '.ldx-sheet-head h2{flex:1;margin:0;font:700 20px/1.25 var(--ldx-font-h);letter-spacing:-.015em}',
      '.ldx-sheet-head h2:focus{outline:none}',
      '.ldx-sheet-body{overflow-y:auto;padding:4px 16px 8px}',
      '.ldx-sheet-msg{margin:0 4px 16px;font:400 15px/1.45 var(--ldx-font);color:var(--ldx-text-2)}',
      '.ldx-sheet-actions{display:flex;flex-direction:column;gap:10px;padding:8px 16px 16px}',
      // toast
      '.ldx-toast-wrap{position:fixed;left:0;right:0;bottom:calc(24px + env(safe-area-inset-bottom,0px));z-index:' + (Z + 900) + ';display:flex;justify-content:center;pointer-events:none;padding:0 16px}',
      '.ldx-toast{display:inline-flex;align-items:center;gap:10px;max-width:440px;padding:12px 18px;border-radius:16px;background:rgba(28,28,30,.92);color:#fff;font:500 15px/1.35 -apple-system,BlinkMacSystemFont,var(--ldx-font,system-ui),sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);transform:translateY(20px);opacity:0;transition:transform .35s cubic-bezier(.16,1,.3,1),opacity .25s}',
      '.ldx-toast.is-in{transform:none;opacity:1}',
      '.ldx-toast .ldx-ico{flex-shrink:0}',
      '.ldx-toast.is-success .ldx-ico{color:#30d158}.ldx-toast.is-error .ldx-ico{color:#ff453a}',
      // misc
      '.ldx-root .maplibregl-ctrl-attrib.maplibregl-compact{margin:8px;border-radius:12px;font:400 11px/1.35 var(--ldx-font)}',
      // Street tiles only come in a day style; in dark mode invert their
      // lightness (keeping hues: water stays blue, roads orange) and tone them
      // down. Markers are HTML on top of the canvas, so they keep their colours.
      '[data-theme="dark"] .ldx-root .maplibregl-canvas{filter:invert(.9) hue-rotate(180deg) saturate(.6) brightness(.9)}',
      // No lone last words: balanced headings, paragraphs that avoid orphans
      // (ignored where unsupported).
      '.ldx-large h1,.ldx-title2,.ldx-empty h3,.ldx-sheet-head h2{text-wrap:balance}',
      '.ldx-large p,.ldx-body,.ldx-row-sub.is-wrap,.ldx-empty p,.ldx-sheet-msg,.ldx-hint,.ldx-section-foot{text-wrap:pretty}',
      '.ldx-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
      '.ldx-shake{animation:ldx-shake .42s var(--ldx-ease-out)}',
      '.ldx-fade-in{animation:ldx-fade .32s var(--ldx-ease-out) both}',
      '@keyframes ldx-spin{to{transform:rotate(360deg)}}',
      '@keyframes ldx-shimmer{0%{background-position:100% 50%}100%{background-position:0 50%}}',
      '@keyframes ldx-pulse{0%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.8)}100%{opacity:1;transform:scale(1)}}',
      '@keyframes ldx-shake{0%,100%{transform:none}20%{transform:translateX(-8px)}40%{transform:translateX(7px)}60%{transform:translateX(-5px)}80%{transform:translateX(3px)}}',
      '@keyframes ldx-fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
      '@media (prefers-reduced-motion:reduce){.ldx-root *,.ldx-root *::before,.ldx-root *::after,.ldx-toast{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}'
    ].join('\n');
    var el = document.createElement('style');
    el.id = 'ldx-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ------------------------------------------------------------- focus layers
  // A stack of open layers (windows and sheets); the top one owns Escape and
  // keeps focus inside itself.
  var layers = [];
  function topLayer() { return layers[layers.length - 1] || null; }
  function focusables(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'),
      function (el) { return el.offsetParent !== null || el === document.activeElement; }
    );
  }
  document.addEventListener('keydown', function (e) {
    var top = topLayer();
    if (!top) return;
    // The live tracking overlay (opened from "Track live") sits above us and
    // handles its own Escape: let it.
    if (document.getElementById('loumoo-dt')) return;
    if (e.key === 'Escape') { e.preventDefault(); top.onEscape(); return; }
    if (e.key === 'Tab') {
      var items = focusables(top.el);
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!top.el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
  }, true);
  function pushLayer(layer) { layers.push(layer); }
  function popLayer(layer) { layers = layers.filter(function (l) { return l !== layer; }); }

  function lockScroll(on) {
    try { document.documentElement.style.overflow = on ? 'hidden' : ''; } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------- toasts
  var toastWrap = null, toastTimer = null;
  function toast(message, opts) {
    var o = opts || {};
    injectStyles();
    if (!toastWrap) {
      toastWrap = h('<div class="ldx-toast-wrap" role="status" aria-live="polite"></div>');
      document.body.appendChild(toastWrap);
    }
    var tone = o.tone || 'success';
    var name = tone === 'error' ? 'alert' : tone === 'info' ? 'clock' : 'checkCircle';
    toastWrap.innerHTML = '';
    var t = h('<div class="ldx-toast is-' + esc(tone) + '">' + icon(name, 20) + '<span>' + esc(message) + '</span></div>');
    toastWrap.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-in'); });
    if (tone === 'error') haptic(18); else haptic(8);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('is-in');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, o.duration || (tone === 'error' ? 4200 : 2600));
  }

  // ----------------------------------------------------------- navigation stack
  /**
   * Opens a window with an iOS-style navigation stack.
   *   var nav = ui.openStack({ label: 'Deliveries', onClose })
   *   nav.push({ title, largeTitle?, subtitle?, render(page) -> cleanup?, right?: [{icon,label,onClick}], footer? })
   * page = { scroll, footer, setTitle(t), setRight(buttons), refreshButton(fn) }
   */
  function openStack(opts) {
    var o = opts || {};
    injectStyles();
    var prevFocus = document.activeElement;
    var layerEl = h('<div class="ldx-root ldx-layer" role="dialog" aria-modal="true" aria-label="' + esc(o.label || 'Deliveries') + '"><div class="ldx-scrim"></div><div class="ldx-window"></div></div>');
    var win = layerEl.querySelector('.ldx-window');
    document.body.appendChild(layerEl);
    lockScroll(true);
    requestAnimationFrame(function () { requestAnimationFrame(function () { layerEl.classList.add('is-open'); }); });

    var pages = []; // { el, cleanup, view }
    var closed = false;
    var nav = {
      el: layerEl,
      get depth() { return pages.length; },
      push: function (view) { return mountPage(view, true); },
      replace: function (view) { var old = pages.pop(); if (old) teardown(old, true); return mountPage(view, false); },
      pop: pop,
      close: close,
      top: function () { return pages[pages.length - 1] || null; }
    };
    var layer = { el: layerEl, onEscape: function () { if (pages.length > 1) pop(); else close(); } };
    pushLayer(layer);
    layerEl.querySelector('.ldx-scrim').addEventListener('click', function () { if (window.innerWidth >= 760) close(); });

    function mountPage(view, animate) {
      var isRoot = pages.length === 0;
      var large = view.largeTitle !== false;
      var pageEl = h(
        '<section class="ldx-page' + (large ? '' : ' no-large') + '" aria-labelledby="">' +
          '<header class="ldx-bar">' +
            (isRoot
              ? '<button class="ldx-navbtn" data-ldx-close>Done</button>'
              : '<button class="ldx-navbtn" data-ldx-back aria-label="Back">' + icon('back', 22) + '<span>' + esc(view.backLabel || 'Back') + '</span></button>') +
            '<div class="ldx-bar-title" aria-hidden="' + (large ? 'true' : 'false') + '"></div>' +
            '<span class="ldx-bar-spacer"></span><span class="ldx-bar-right" style="display:flex;align-items:center"></span>' +
          '</header>' +
          '<div class="ldx-scroll">' +
            (large ? '<div class="ldx-large"><h1></h1><p hidden></p></div>' : '') +
            '<div class="ldx-content"></div>' +
          '</div>' +
          '<div class="ldx-footer"></div>' +
        '</section>'
      );
      var titleId = 'ldx-t-' + Math.random().toString(36).slice(2, 8);
      var barTitle = pageEl.querySelector('.ldx-bar-title');
      var h1 = pageEl.querySelector('.ldx-large h1');
      var sub = pageEl.querySelector('.ldx-large p');
      (h1 || barTitle).id = titleId;
      pageEl.setAttribute('aria-labelledby', titleId);
      var scroll = pageEl.querySelector('.ldx-scroll');
      var content = pageEl.querySelector('.ldx-content');
      var footer = pageEl.querySelector('.ldx-footer');
      var right = pageEl.querySelector('.ldx-bar-right');

      function setTitle(t, s) {
        barTitle.textContent = t || '';
        if (h1) h1.textContent = t || '';
        if (sub) { if (s) { sub.textContent = s; sub.hidden = false; } else { sub.hidden = true; } }
      }
      function setRight(buttons) {
        right.innerHTML = '';
        (buttons || []).forEach(function (b) {
          var btn = h('<button class="ldx-navbtn' + (b.icon && !b.text ? ' is-icon' : '') + '" aria-label="' + esc(b.label || b.text || '') + '">' + (b.icon ? icon(b.icon, 22) : '') + (b.text ? esc(b.text) : '') + '</button>');
          btn.addEventListener('click', function () { haptic(); b.onClick && b.onClick(); });
          right.appendChild(btn);
        });
      }
      setTitle(view.title, view.subtitle);
      setRight(view.right);
      scroll.addEventListener('scroll', function () {
        pageEl.classList.toggle('is-scrolled', scroll.scrollTop > (large ? 38 : 2));
      }, { passive: true });

      var closeBtn = pageEl.querySelector('[data-ldx-close]');
      if (closeBtn) closeBtn.addEventListener('click', close);
      var backBtn = pageEl.querySelector('[data-ldx-back]');
      if (backBtn) backBtn.addEventListener('click', pop);

      var prev = pages[pages.length - 1];
      if (animate && prev && !reduceMotion) {
        pageEl.classList.add('is-entering');
        win.appendChild(pageEl);
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          pageEl.classList.remove('is-entering');
          prev.el.classList.add('is-covered');
        }); });
      } else {
        win.appendChild(pageEl);
        if (prev) prev.el.classList.add('is-covered');
      }
      if (prev) prev.el.setAttribute('aria-hidden', 'true');

      var page = { el: pageEl, scroll: scroll, content: content, footer: footer, setTitle: setTitle, setRight: setRight, nav: nav, alive: true };
      var record = { el: pageEl, page: page, cleanup: null, view: view };
      pages.push(record);
      try { record.cleanup = view.render(page) || null; } catch (err) { console.error('[DispatchUI] render failed', err); content.appendChild(errorState('Something went wrong showing this screen.')); }
      // Move focus to the screen's title (announced by screen readers, no visible
      // ring), not to the first button, the way a native screen does.
      var heading = h1 || barTitle;
      heading.setAttribute('tabindex', '-1');
      setTimeout(function () { try { heading.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 60);
      return page;
    }

    function teardown(record, immediate) {
      record.page.alive = false;
      try { if (typeof record.cleanup === 'function') record.cleanup(); } catch (e) { /* ignore */ }
      if (immediate || reduceMotion) { if (record.el.parentNode) record.el.parentNode.removeChild(record.el); return; }
      record.el.classList.add('is-leaving');
      setTimeout(function () { if (record.el.parentNode) record.el.parentNode.removeChild(record.el); }, 450);
    }

    function pop() {
      if (pages.length <= 1) return close();
      var leaving = pages.pop();
      var back = pages[pages.length - 1];
      back.el.classList.remove('is-covered');
      back.el.removeAttribute('aria-hidden');
      teardown(leaving, false);
      if (back.view.onResume) { try { back.view.onResume(back.page); } catch (e) { /* ignore */ } }
      haptic(4);
    }

    function close() {
      if (closed) return;
      closed = true;
      while (pages.length) teardown(pages.pop(), true);
      popLayer(layer);
      layerEl.classList.remove('is-open');
      setTimeout(function () { if (layerEl.parentNode) layerEl.parentNode.removeChild(layerEl); }, reduceMotion ? 0 : 320);
      if (!layers.length) lockScroll(false);
      try { if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      if (o.onClose) { try { o.onClose(); } catch (e) { /* ignore */ } }
    }

    return nav;
  }

  // ------------------------------------------------------------------- sheets
  /**
   * A bottom sheet (a centred card on wide screens) with a grabber and
   * drag-to-dismiss. `body` is a Node or HTML. Returns { el, body, close, done }.
   * `done` resolves with the value passed to close(value).
   */
  function sheet(opts) {
    var o = opts || {};
    injectStyles();
    var prevFocus = document.activeElement;
    var id = 'ldx-s-' + Math.random().toString(36).slice(2, 8);
    var layerEl = h(
      '<div class="ldx-root ldx-sheet-layer" role="dialog" aria-modal="true" aria-labelledby="' + id + '">' +
        '<div class="ldx-scrim"></div>' +
        '<div class="ldx-sheet">' +
          '<div class="ldx-grabber" aria-hidden="true"><i></i></div>' +
          '<div class="ldx-sheet-head"><h2 id="' + id + '">' + esc(o.title || '') + '</h2>' +
            (o.dismissible === false ? '' : '<button class="ldx-navbtn is-icon" data-ldx-x aria-label="Close">' + '<span class="ldx-iconbtn" style="width:30px;height:30px;color:var(--ldx-text-2)">' + icon('close', 16) + '</span></button>') +
          '</div>' +
          '<div class="ldx-sheet-body"></div>' +
        '</div>' +
      '</div>'
    );
    var body = layerEl.querySelector('.ldx-sheet-body');
    if (o.message) body.appendChild(h('<p class="ldx-sheet-msg">' + esc(o.message) + '</p>'));
    if (o.body) body.appendChild(typeof o.body === 'string' ? h(o.body) : o.body);
    var panel = layerEl.querySelector('.ldx-sheet');
    document.body.appendChild(layerEl);
    lockScroll(true);
    requestAnimationFrame(function () { requestAnimationFrame(function () { layerEl.classList.add('is-open'); }); });

    var resolveDone, closed = false;
    var done = new Promise(function (r) { resolveDone = r; });
    var layer = { el: layerEl, onEscape: function () { if (o.dismissible !== false) close(undefined); } };
    pushLayer(layer);

    function close(value) {
      if (closed) return;
      closed = true;
      popLayer(layer);
      layerEl.classList.remove('is-open');
      panel.style.transform = '';
      setTimeout(function () { if (layerEl.parentNode) layerEl.parentNode.removeChild(layerEl); }, reduceMotion ? 0 : 380);
      if (!layers.length) lockScroll(false);
      try { if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      resolveDone(value);
    }
    if (o.dismissible !== false) {
      layerEl.querySelector('.ldx-scrim').addEventListener('click', function () { close(undefined); });
      var x = layerEl.querySelector('[data-ldx-x]');
      if (x) x.addEventListener('click', function () { close(undefined); });
      // Drag the grabber down to dismiss.
      var grab = layerEl.querySelector('.ldx-grabber'), startY = null, dy = 0;
      grab.addEventListener('pointerdown', function (e) { startY = e.clientY; dy = 0; panel.style.transition = 'none'; try { grab.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } });
      grab.addEventListener('pointermove', function (e) { if (startY == null) return; dy = Math.max(0, e.clientY - startY); panel.style.transform = 'translateY(' + dy + 'px)'; });
      var end = function () { if (startY == null) return; startY = null; panel.style.transition = ''; if (dy > 110) close(undefined); else panel.style.transform = ''; };
      grab.addEventListener('pointerup', end);
      grab.addEventListener('pointercancel', end);
    }
    // Focus the field the sheet asks for (autofocus: a selector, or 'empty' for
    // the first empty field), else the title. Never a button: a stray Enter
    // must not confirm, or cancel, anything.
    var heading = layerEl.querySelector('#' + id);
    heading.setAttribute('tabindex', '-1');
    setTimeout(function () {
      var f = null;
      if (o.autofocus === 'empty') f = Array.prototype.find.call(body.querySelectorAll('input:not([type=hidden]),textarea'), function (x) { return !x.value; }) || null;
      else if (o.autofocus) f = body.querySelector(o.autofocus);
      try { (f || heading).focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }, 80);
    return { el: layerEl, body: body, close: close, done: done };
  }

  /** A confirmation sheet. Resolves true when confirmed. */
  function confirm(opts) {
    var o = opts || {};
    var actions = h('<div class="ldx-sheet-actions" style="padding:4px 0 6px"></div>');
    var yes = button({ label: o.confirmLabel || 'Confirm', kind: o.destructive ? 'destructive' : 'filled', block: true });
    var no = button({ label: o.cancelLabel || 'Cancel', kind: 'plain', block: true });
    actions.appendChild(yes);
    actions.appendChild(no);
    var s = sheet({ title: o.title, message: o.message, body: actions });
    yes.addEventListener('click', function () { haptic(12); s.close(true); });
    no.addEventListener('click', function () { s.close(false); });
    return s.done.then(function (v) { return v === true; });
  }

  // ----------------------------------------------------------------- controls
  function button(opts) {
    var o = opts || {};
    var cls = 'ldx-btn' +
      (o.kind && o.kind !== 'filled' ? ' is-' + o.kind : '') +
      (o.size ? ' is-' + o.size : '') +
      (o.block ? ' is-block' : '');
    var b = h('<button type="button" class="' + cls + '">' + (o.icon ? icon(o.icon, o.size === 'small' ? 16 : 20) : '') + '<span>' + esc(o.label) + '</span></button>');
    if (o.ariaLabel) b.setAttribute('aria-label', o.ariaLabel);
    if (o.onClick) b.addEventListener('click', function (e) { haptic(); o.onClick(e, b); });
    return b;
  }
  /** Runs fn while the button shows a spinner and refuses double taps. */
  function busy(btn, fn) {
    if (!btn || btn.classList.contains('is-busy')) return Promise.resolve();
    btn.classList.add('is-busy');
    btn.setAttribute('aria-busy', 'true');
    return Promise.resolve().then(fn).finally(function () {
      btn.classList.remove('is-busy');
      btn.removeAttribute('aria-busy');
    });
  }

  function segmented(options, value, onChange) {
    var el = h('<div class="ldx-seg" role="tablist"><span class="ldx-seg-thumb"></span></div>');
    var thumb = el.querySelector('.ldx-seg-thumb');
    var current = value;
    var buttons = options.map(function (opt) {
      var b = h('<button type="button" role="tab" aria-selected="false"><span class="ldx-seg-label"></span><span class="ldx-seg-n"></span></button>');
      b.querySelector('.ldx-seg-label').textContent = opt.label;
      b.addEventListener('click', function () { if (current === opt.value) return; haptic(4); set(opt.value); onChange(opt.value); });
      el.appendChild(b);
      return { b: b, opt: opt };
    });
    function place() {
      var idx = buttons.findIndex(function (x) { return x.opt.value === current; });
      var n = buttons.length;
      thumb.style.width = 'calc((100% - 4px) / ' + n + ')';
      thumb.style.transform = 'translateX(' + (idx * 100) + '%)';
    }
    function set(v) {
      current = v;
      buttons.forEach(function (x) { x.b.setAttribute('aria-selected', String(x.opt.value === v)); });
      place();
    }
    el.setCount = function (v, n) {
      var x = buttons.find(function (y) { return y.opt.value === v; });
      if (x) x.b.querySelector('.ldx-seg-n').textContent = n ? String(n) : ''; // no "0": an empty tab says nothing
    };
    el.set = set;
    set(value);
    return el;
  }

  function searchField(opts) {
    var o = opts || {};
    var el = h('<label class="ldx-search">' + icon('search', 18) + '<input type="search" autocomplete="off" spellcheck="false"><button type="button" class="ldx-search-clear" aria-label="Clear search">' + icon('close', 16) + '</button></label>');
    var input = el.querySelector('input');
    input.setAttribute('placeholder', o.placeholder || 'Search');
    input.setAttribute('aria-label', o.placeholder || 'Search');
    var t = null;
    function fire() { el.classList.toggle('has-value', !!input.value); clearTimeout(t); t = setTimeout(function () { o.onInput && o.onInput(input.value.trim()); }, o.debounce == null ? 120 : o.debounce); }
    input.addEventListener('input', fire);
    el.querySelector('.ldx-search-clear').addEventListener('click', function (e) { e.preventDefault(); input.value = ''; fire(); input.focus(); });
    el.input = input;
    return el;
  }

  /**
   * A countdown ring to an ISO deadline. size 'small' (44px) or 'large' (120px).
   * Returns { el, stop }. Calls onExpire once when it reaches zero.
   */
  function countdown(deadlineIso, opts) {
    var o = opts || {};
    var large = o.size === 'large';
    var size = large ? 120 : 44, stroke = large ? 8 : 4, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
    var el = h(
      '<span class="ldx-ring' + (large ? ' is-large' : '') + '" role="timer" aria-label="Time left to accept">' +
        '<svg width="' + size + '" height="' + size + '"><circle class="ldx-ring-track" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="' + stroke + '"/>' +
        '<circle class="ldx-ring-val" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' + circ + '"/></svg>' +
        '<span class="ldx-ring-label"></span>' + (large ? '<span class="ldx-ring-cap">to accept</span>' : '') +
      '</span>'
    );
    var deadline = Date.parse(deadlineIso);
    var total = o.totalMs || 15 * 60 * 1000;
    var label = el.querySelector('.ldx-ring-label');
    var val = el.querySelector('.ldx-ring-val');
    var fired = false, timer = null;
    function tick() {
      var left = deadline - Date.now();
      if (!isFinite(left)) { label.textContent = ''; return; }
      label.textContent = mmss(left);
      var frac = Math.max(0, Math.min(1, left / total));
      val.style.strokeDashoffset = String(circ * (1 - frac));
      el.classList.toggle('is-soon', left <= 120000 && left > 30000);
      el.classList.toggle('is-urgent', left <= 30000);
      if (left <= 0 && !fired) { fired = true; stop(); if (o.onExpire) o.onExpire(); }
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    tick();
    timer = setInterval(tick, 1000);
    return { el: el, stop: stop };
  }

  function section(title, opts) {
    var o = opts || {};
    var el = h('<section class="ldx-section"><div class="ldx-section-head"><h2></h2><span class="ldx-count"></span></div><div class="ldx-group"></div>' + (o.foot ? '<div class="ldx-section-foot"></div>' : '') + '</section>');
    el.querySelector('h2').textContent = title || '';
    if (!title) el.querySelector('.ldx-section-head').remove();
    if (o.count != null) el.querySelector('.ldx-count').textContent = String(o.count);
    if (o.foot) el.querySelector('.ldx-section-foot').textContent = o.foot;
    el.group = el.querySelector('.ldx-group');
    return el;
  }

  function emptyState(o) {
    var el = h('<div class="ldx-empty ldx-fade-in"><div class="ldx-empty-ico' + (o.tone === 'muted' ? ' is-muted' : '') + '">' + icon(o.icon || 'inbox', 32) + '</div><h3></h3><p></p></div>');
    el.querySelector('h3').textContent = o.title || '';
    var p = el.querySelector('p');
    if (o.body) p.textContent = o.body; else p.remove();
    if (o.actionLabel) el.appendChild(button({ label: o.actionLabel, kind: o.actionKind || 'tinted', size: 'medium', onClick: o.onAction }));
    return el;
  }
  function errorState(message, onRetry) {
    return emptyState({ icon: 'alert', tone: 'muted', title: 'Couldn’t load this', body: message || 'Check your connection and try again.', actionLabel: onRetry ? 'Try again' : null, onAction: onRetry });
  }
  function skeletonList(n) {
    var rows = '';
    for (var i = 0; i < (n || 4); i++) {
      rows += '<div class="ldx-row is-static" aria-hidden="true"><span class="ldx-skel" style="width:40px;height:40px;border-radius:11px"></span>' +
        '<span class="ldx-row-main"><span class="ldx-skel" style="display:block;height:14px;width:' + (52 + (i * 13) % 30) + '%"></span>' +
        '<span class="ldx-skel" style="display:block;height:12px;width:' + (34 + (i * 17) % 28) + '%;margin-top:8px"></span></span></div>';
    }
    return h('<div class="ldx-section"><div class="ldx-group" aria-busy="true" aria-label="Loading">' + rows + '</div></div>');
  }

  /** A friendly sentence for an API error, by code then status. */
  function errorMessage(err, fallback) {
    if (!err) return fallback || 'Something went wrong.';
    var map = {
      OFFER_EXPIRED: 'This offer expired before it was accepted.',
      NO_RIDER_AVAILABLE: 'No rider is available for this delivery right now.',
      DELIVERY_LOCKED: 'Too many wrong codes. An administrator must unlock this delivery.',
      RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
      UNAUTHENTICATED: 'Your session has ended. Sign in again.'
    };
    if (err.code && map[err.code]) return map[err.code];
    if (err.status === 409) return err.message || 'This delivery just changed. Refresh and try again.';
    if (err.status === 404) return 'This delivery is no longer available to you.';
    if (err.status === 403) return err.message || 'You don’t have access to do this.';
    if (!err.status) return 'You’re offline. Check your connection and try again.';
    return err.message || fallback || 'Something went wrong.';
  }

  window.LoumooDispatchUI = {
    esc: esc, h: h, icon: icon, avatar: avatar, initials: initials, badge: badge, statusBadge: statusBadge, statusInfo: statusInfo,
    money: money, relTime: relTime, clockTime: clockTime, mmss: mmss, telHref: telHref, waHref: waHref, mapsHref: mapsHref, km: km,
    haptic: haptic, toast: toast, openStack: openStack, sheet: sheet, confirm: confirm, button: button, busy: busy,
    segmented: segmented, searchField: searchField, countdown: countdown, section: section,
    emptyState: emptyState, errorState: errorState, skeletonList: skeletonList, errorMessage: errorMessage,
    injectStyles: injectStyles, reduceMotion: function () { return reduceMotion; }
  };
})();
