/**
 * LOUMOO — every name a template binds is something the view provides
 * ---------------------------------------------------------------------------
 * A `{{ name }}` the view props do not define renders as nothing, and an
 * `onClick="{{ name }}"` becomes a button that does nothing. Two had shipped:
 * the toast's OK button was bound to `clearToast`, which nothing defined, and
 * the feeds' "You've explored all current listings" line read `catalogHasMore`,
 * which lived in state but was never exposed — so it showed under every page.
 *
 * Drives the REAL compiled app (Commerce App.dc.html) in a sandbox, takes the
 * keys renderVals() returns, and checks every identifier used in a template
 * expression against them (plus loop variables, arrow parameters, and the names
 * the search controller's view() adds at runtime).
 */

require('../setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'Commerce App.dc.html'), 'utf8');
const script = html.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*?)<\/script>/);
assert.ok(script, 'Must find data-dc-script block');

class DCLogic {
  constructor(props) { this.props = props || {}; this.state = {}; }
  setState(x) { this.state = Object.assign({}, this.state, typeof x === 'function' ? x(this.state) : x); }
}
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const store = {};
const context = {
  DCLogic,
  console: quiet,
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  Promise,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  document: { documentElement: { setAttribute() {} } }
};
vm.createContext(context);
vm.runInContext(script[1] + '\nvar comp = new Component({});', context);
const provided = new Set(Object.keys(context.comp.renderVals()));

// The search controller merges its own view() into the props when it is loaded.
const searchSrc = fs.readFileSync(path.join(ROOT, 'src/services/searchExperience.js'), 'utf8');
const fromSearch = (name) => new RegExp(`\\b${name}\\s*:`).test(searchSrc);

const templates = html.replace(script[0], '');
const loopVars = new Set([...templates.matchAll(/\b(?:as|index)="([A-Za-z_$][\w$]*)"/g)].map((m) => m[1]));
const LANGUAGE = new Set(('true false null undefined typeof instanceof new this return if else const let var function in of void delete ' +
  'Math Number String Boolean Array Object JSON Date window document event e encodeURIComponent decodeURIComponent ' +
  'parseInt parseFloat isNaN Infinity NaN console Promise setTimeout navigator location alert confirm').split(' '));

const unresolved = new Map();
for (const binding of templates.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
  const expr = binding[1].replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
  const params = new Set();
  for (const a of expr.matchAll(/\(?\s*([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)\s*\)?\s*=>/g)) a[1].split(',').forEach((p) => params.add(p.trim()));
  for (const id of expr.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g)) {
    const name = id[2];
    const rest = expr.slice(id.index + id[0].length).trimStart();
    const lead = expr.slice(0, id.index + id[1].length).trimEnd();
    if (rest.startsWith(':') && /[{,]$/.test(lead)) continue; // an object-literal key
    if (LANGUAGE.has(name) || provided.has(name) || loopVars.has(name) || params.has(name) || fromSearch(name)) continue;
    unresolved.set(name, (unresolved.get(name) || 0) + 1);
  }
}

assert.ok(provided.size > 500, `renderVals() provides the view (${provided.size} names)`);
assert.deepStrictEqual([...unresolved.keys()], [], 'every name a template binds is provided by the view');

// And the two that had shipped unbound now behave.
const vals = context.comp.renderVals();
context.comp.state.toast = 'Saved';
vals.clearToast();
assert.strictEqual(context.comp.state.toast, '', 'the toast\'s OK button dismisses it');
context.comp.state.catalogHasMore = true;
assert.strictEqual(context.comp.renderVals().catalogHasMore, true, 'a catalogue with more pages does not say it has ended');
context.comp.state.catalogHasMore = false;
assert.strictEqual(context.comp.renderVals().catalogHasMore, false);

console.log(`template_bindings_resolve: every template name resolves (${provided.size} view names)`);
process.exit(0);
