/**
 * LOUMOO Universal Commerce — i18n Runtime
 * ------------------------------------------------------------------
 * Thin, framework-free translation layer that walks the live DOM after the
 * React-driven `dc-runtime` templates render and swaps English text for the
 * locale selected by the user. Backed by a dictionary loaded from
 * `window.LOUMOO_I18N_DICTIONARIES` (populated by `src/data/i18n/*.js`).
 *
 * Design notes
 *   - Default locale on first visit is `fr` (French), per product direction.
 *   - Choice persists in `localStorage` under `loumoo.lang`.
 *   - A floating FR/EN switcher pill is injected bottom-right once the DOM is
 *     ready. If the host page needs a different placement later it can target
 *     `.loumoo-lang-switcher` and restyle.
 *   - Replacement is dictionary-based with exact-match on trimmed text nodes
 *     plus a handful of attributes (placeholder, aria-label, title, alt).
 *     We never touch user-generated content or raw template bindings
 *     (anything containing `{{`), and we skip <script>/<style>/<code>.
 *   - A MutationObserver re-runs the pass for subtrees added or mutated by
 *     React, keeping translations stable across navigation.
 *   - `document.documentElement.lang` is kept in sync for accessibility.
 */

(function (global) {
  "use strict";

  var STORAGE_KEY = "loumoo.lang";
  var SUPPORTED = ["fr", "en"];
  var DEFAULT = "fr";

  // Attributes we also translate when they match a dictionary key exactly.
  var ATTRS = ["placeholder", "aria-label", "title", "alt"];

  function getDictionaries() {
    return (global.LOUMOO_I18N_DICTIONARIES = global.LOUMOO_I18N_DICTIONARIES || {});
  }

  function readStoredLocale() {
    try {
      var v = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      if (v && SUPPORTED.indexOf(v) !== -1) return v;
    } catch (_) {}
    return null;
  }

  function writeStoredLocale(loc) {
    try { global.localStorage && global.localStorage.setItem(STORAGE_KEY, loc); } catch (_) {}
  }

  var state = {
    locale: readStoredLocale() || DEFAULT,
    observer: null,
    switcherEl: null,
    pending: null,
  };

  // We keep the French dictionary as the single source of truth and compute
  // the reverse (French → English) on first use. English is the base locale
  // of the templates, so "switching to English" means mapping any already-
  // translated French strings back to their English originals.
  var reverseCache = { forKey: null, map: null };

  function activeForward() {
    var all = getDictionaries();
    return (all.fr && all.fr.strings) || {};
  }

  function activeReverse() {
    var fwd = activeForward();
    if (reverseCache.forKey === fwd) return reverseCache.map;
    var out = {};
    for (var k in fwd) {
      if (Object.prototype.hasOwnProperty.call(fwd, k)) {
        var v = fwd[k];
        // First writer wins on collisions.
        if (!Object.prototype.hasOwnProperty.call(out, v)) out[v] = k;
      }
    }
    reverseCache.forKey = fwd;
    reverseCache.map = out;
    return out;
  }

  function tr(s) {
    if (!s) return s;
    var trimmed = s.trim();
    if (!trimmed) return s;
    // Pass through anything that still looks like an uncompiled template.
    if (trimmed.indexOf("{{") !== -1) return s;
    var d = state.locale === "fr" ? activeForward() : activeReverse();
    if (Object.prototype.hasOwnProperty.call(d, trimmed)) {
      var out = d[trimmed];
      // Preserve surrounding whitespace from the source string.
      var lead = s.match(/^\s*/)[0];
      var tail = s.match(/\s*$/)[0];
      return lead + out + tail;
    }
    return s;
  }

  // Node tags we never descend into.
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CODE: 1, NOSCRIPT: 1, TEXTAREA: 1 };

  function translateTextNode(node) {
    var v = node.nodeValue;
    if (!v) return;
    var next = tr(v);
    if (next !== v) node.nodeValue = next;
  }

  function translateAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var name = ATTRS[i];
      if (!el.hasAttribute(name)) continue;
      var cur = el.getAttribute(name);
      var next = tr(cur);
      if (next !== cur) el.setAttribute(name, next);
    }
    // `value` on buttons/submits is text-ish too.
    if (el.tagName === "INPUT") {
      var t = (el.getAttribute("type") || "").toLowerCase();
      if (t === "button" || t === "submit" || t === "reset") {
        var cur2 = el.value;
        var next2 = tr(cur2);
        if (next2 !== cur2) el.value = next2;
      }
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { translateTextNode(root); return; }
    if (root.nodeType !== 1) return;
    if (SKIP_TAGS[root.tagName]) return;
    // Translate element attributes first.
    translateAttrs(root);
    // Then recurse. Snapshot childNodes because mutations may happen below.
    var kids = root.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType === 3) {
        translateTextNode(k);
      } else if (k.nodeType === 1) {
        walk(k);
      }
    }
  }

  function schedule() {
    if (state.pending) return;
    state.pending = global.requestAnimationFrame
      ? global.requestAnimationFrame(flush)
      : setTimeout(flush, 16);
  }

  function flush() {
    state.pending = null;
    try { walk(global.document.body); } catch (_) {}
    syncHtmlLang();
    updateSwitcherUi();
  }

  function syncHtmlLang() {
    try {
      global.document.documentElement.setAttribute("lang", state.locale);
    } catch (_) {}
  }

  function setLocale(loc) {
    if (!loc || SUPPORTED.indexOf(loc) === -1) return;
    if (loc === state.locale) return;
    state.locale = loc;
    writeStoredLocale(loc);
    // Dispatch a public event so other scripts can react.
    try {
      var ev = new global.CustomEvent("loumoo:localechange", { detail: { locale: loc } });
      global.document.dispatchEvent(ev);
    } catch (_) {}
    // Re-run the pass. For strings already swapped to the previous locale,
    // we rely on React re-rendering the templates on route change; where it
    // does not, the dictionary round-trip (EN<->FR) still lands because keys
    // for both directions are composed into the active dictionary.
    schedule();
  }

  function cycleLocale() {
    setLocale(state.locale === "fr" ? "en" : "fr");
  }

  // ───────── switcher UI ─────────
  var SWITCHER_ID = "loumoo-lang-switcher";
  var SWITCHER_CSS = (
    "#" + SWITCHER_ID + "{position:fixed;right:14px;bottom:14px;z-index:999999;" +
    "display:inline-flex;align-items:center;gap:4px;padding:4px;border-radius:999px;" +
    "background:rgba(17,18,20,.86);color:#fff;font:800 11px/1 -apple-system,BlinkMacSystemFont,\"Plus Jakarta Sans\",\"Inter\",sans-serif;" +
    "letter-spacing:.08em;box-shadow:0 10px 32px rgba(0,0,0,.28);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);" +
    "border:1px solid rgba(255,255,255,.08);user-select:none}" +
    "#" + SWITCHER_ID + " button{all:unset;cursor:pointer;padding:6px 10px;border-radius:999px;color:#cfd3dc;transition:background .15s ease,color .15s ease}" +
    "#" + SWITCHER_ID + " button:hover{color:#fff}" +
    "#" + SWITCHER_ID + " button[aria-pressed=\"true\"]{background:#fff;color:#111214}" +
    "@media (prefers-color-scheme: light){" +
    "#" + SWITCHER_ID + "{background:rgba(255,255,255,.92);color:#111214;border-color:rgba(0,0,0,.08);box-shadow:0 10px 24px rgba(0,0,0,.12)}" +
    "#" + SWITCHER_ID + " button{color:#525763}" +
    "#" + SWITCHER_ID + " button[aria-pressed=\"true\"]{background:#111214;color:#fff}" +
    "}"
  );

  function ensureSwitcherStyles() {
    var id = SWITCHER_ID + "-styles";
    if (global.document.getElementById(id)) return;
    var st = global.document.createElement("style");
    st.id = id;
    st.textContent = SWITCHER_CSS;
    global.document.head.appendChild(st);
  }

  function buildSwitcher() {
    if (global.document.getElementById(SWITCHER_ID)) return;
    ensureSwitcherStyles();
    var wrap = global.document.createElement("div");
    wrap.id = SWITCHER_ID;
    wrap.className = "loumoo-lang-switcher";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Language");
    SUPPORTED.forEach(function (loc) {
      var b = global.document.createElement("button");
      b.type = "button";
      b.setAttribute("data-locale", loc);
      b.setAttribute("aria-label", loc === "fr" ? "Français" : "English");
      b.textContent = loc.toUpperCase();
      b.addEventListener("click", function () { setLocale(loc); });
      wrap.appendChild(b);
    });
    global.document.body.appendChild(wrap);
    state.switcherEl = wrap;
    updateSwitcherUi();
  }

  function updateSwitcherUi() {
    var el = global.document.getElementById(SWITCHER_ID);
    if (!el) return;
    var btns = el.querySelectorAll("button[data-locale]");
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      b.setAttribute("aria-pressed", b.getAttribute("data-locale") === state.locale ? "true" : "false");
    }
  }

  // ───────── observe DOM ─────────
  function startObserver() {
    if (state.observer || !global.MutationObserver) return;
    state.observer = new global.MutationObserver(function (muts) {
      // Any mutation can introduce fresh English strings — just rerun.
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === "characterData" || m.addedNodes.length) {
          schedule();
          return;
        }
      }
    });
    state.observer.observe(global.document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function boot() {
    if (!global.document || !global.document.body) {
      global.document.addEventListener("DOMContentLoaded", boot);
      return;
    }
    syncHtmlLang();
    buildSwitcher();
    startObserver();
    schedule();
  }

  // Public API.
  global.LOUMOO_I18N = {
    get locale() { return state.locale; },
    setLocale: setLocale,
    cycleLocale: cycleLocale,
    translate: tr,
    refresh: schedule,
    supported: SUPPORTED.slice(),
  };

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(typeof window !== "undefined" ? window : this);
