/**
 * A DOM small enough to read in one sitting, faithful enough to run the
 * browser-only overlays in src/services (the delivery tracking screen, the rider
 * hub) under Node, where this repository has no jsdom.
 *
 * It parses the markup an overlay assigns to `innerHTML` into a real tree
 * (nesting, attributes, the `hidden` property) so that `querySelector`,
 * `parentNode` and `hidden` behave the way the overlay's own code expects. It
 * understands exactly the selectors those overlays use (`[attr]`, `[attr="v"]`,
 * `.class`, `#id`, `tag`) and throws on anything else, so a test never passes
 * because a selector silently matched nothing.
 *
 * It is not a browser. CSS is not applied: a test that needs to know whether a
 * rule hides an element reads the stylesheet text instead.
 */
'use strict';

const VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'use', 'source']);

class FakeEl {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.hidden = false;
    this.textContent = '';
    this.className = '';
    this.listeners = {};
    this._html = '';
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'hidden') this.hidden = true;
  }

  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }

  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = String(v); }

  set innerHTML(html) {
    this.children = [];
    this._html = String(html == null ? '' : html);
    parseInto(this, this._html, this.ownerDocument);
  }

  get innerHTML() { return this._html; }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    const hook = this.ownerDocument && this.ownerDocument.onAppend;
    if (hook && this._attached()) hook(child);
    return child;
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }

  _attached() {
    let n = this;
    while (n) {
      if (n === this.ownerDocument.head || n === this.ownerDocument.body) return true;
      n = n.parentNode;
    }
    return false;
  }

  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }

  dispatch(type, extra) {
    const evt = Object.assign({ type, target: this, preventDefault() {} }, extra || {});
    (this.listeners[type] || []).forEach((fn) => fn(evt));
  }

  click() { this.dispatch('click'); }

  querySelector(selector) {
    const test = compile(selector);
    const walk = (el) => {
      for (const child of el.children) {
        if (test(child)) return child;
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
  }

  querySelectorAll(selector) {
    const test = compile(selector);
    const out = [];
    const walk = (el) => { for (const child of el.children) { if (test(child)) out.push(child); walk(child); } };
    walk(this);
    return out;
  }
}

function compile(selector) {
  let m;
  if ((m = /^\[([\w-]+)\]$/.exec(selector))) return (el) => Object.prototype.hasOwnProperty.call(el.attrs, m[1]);
  if ((m = /^\[([\w-]+)="([^"]*)"\]$/.exec(selector))) return (el) => el.attrs[m[1]] === m[2];
  if ((m = /^\.([\w-]+)$/.exec(selector))) return (el) => el.className.split(/\s+/).includes(m[1]);
  if ((m = /^#([\w-]+)$/.exec(selector))) return (el) => el.attrs.id === m[1];
  if ((m = /^([a-zA-Z][\w-]*)$/.exec(selector))) return (el) => el.tagName === m[1].toUpperCase();
  throw new Error(`fakeDom does not support the selector "${selector}"`);
}

function parseInto(parent, html, doc) {
  const stack = [parent];
  const tag = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)(\/?)>/g;
  let m;
  while ((m = tag.exec(html))) {
    const closing = m[1];
    const name = m[2];
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === name.toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }
    const el = new FakeEl(name, doc);
    const attr = /([\w:-]+)(?:\s*=\s*"([^"]*)")?/g;
    let a;
    while ((a = attr.exec(m[3]))) el.setAttribute(a[1], a[2] == null ? '' : a[2]);
    el.parentNode = stack[stack.length - 1];
    stack[stack.length - 1].children.push(el);
    if (!m[4] && !VOID.has(name.toLowerCase())) stack.push(el);
  }
}

function createDocument() {
  const doc = {
    onAppend: null,
    listeners: {},
    createElement(tag) { return new FakeEl(tag, doc); },
    getElementById(id) {
      const find = (el) => {
        for (const child of el.children) {
          if (child.attrs.id === id) return child;
          const found = find(child);
          if (found) return found;
        }
        return null;
      };
      return find(doc.head) || find(doc.body);
    },
    addEventListener(type, fn) { (doc.listeners[type] = doc.listeners[type] || []).push(fn); },
    dispatch(type, extra) { (doc.listeners[type] || []).forEach((fn) => fn(Object.assign({ type }, extra || {}))); }
  };
  doc.head = new FakeEl('head', doc);
  doc.body = new FakeEl('body', doc);
  doc.documentElement = new FakeEl('html', doc);
  return doc;
}

/** Timers a test drives by hand: nothing runs until `advance` says time has passed. */
function createClock() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  return {
    setTimeout(fn, ms) { const id = ++seq; pending.set(id, { fn, at: now + (ms || 0) }); return id; },
    clearTimeout(id) { pending.delete(id); },
    /** Delays (ms) of the timers still waiting, soonest first. */
    delays() { return [...pending.values()].map((t) => t.at - now).sort((a, b) => a - b); },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
      }
      now = until;
    }
  };
}

module.exports = { FakeEl, createDocument, createClock };
