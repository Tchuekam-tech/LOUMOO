/**
 * Test helper — the compare screens' controller, as shipped.
 *
 * Loads the component script from the BUILT shell (Commerce App.dc.html) into a
 * vm sandbox with a minimal DCLogic, optionally with the real view model
 * (src/services/compareView.js) and an API whose compareProducts is backed by
 * the real ComparisonService. Tests then drive renderVals() like the runtime.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

class DCLogic {
  constructor(props) {
    this.props = props || {};
    this.state = {};
  }
  setState(fnOrObj, cb) {
    const patch = typeof fnOrObj === 'function' ? fnOrObj(this.state) : fnOrObj;
    this.state = Object.assign({}, this.state, patch);
    if (typeof cb === 'function') cb();
  }
}

/**
 * @param {{ withView?: boolean, api?: object }} [opts]
 * @returns {{ comp: object, context: object, vals: () => object, settle: () => Promise<void> }}
 */
function loadCompareRuntime(opts = {}) {
  const shell = fs.readFileSync(path.join(ROOT, 'Commerce App.dc.html'), 'utf8');
  const m = shell.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('data-dc-script not found in Commerce App.dc.html');

  const context = {
    DCLogic,
    console,
    Promise,
    setTimeout: (fn, ms) => {
      if (ms && ms >= 4000) return 1;
      if (typeof fn === 'function') fn();
      return 1;
    },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { documentElement: { setAttribute: () => {}, lang: opts.lang || 'en' } }
  };
  // The rest of the shell calls other endpoints on mount (catalogue, settings,
  // notifications); answer those with nothing so only compare traffic matters.
  if (opts.api) {
    context.LoumooAPI = new Proxy(opts.api, {
      get: (target, prop) => (prop in target ? target[prop] : () => Promise.resolve(null))
    });
  }
  vm.createContext(context);
  if (opts.withView) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'services', 'compareView.js'), 'utf8'), context);
  }
  vm.runInContext(m[1] + "\nvar comp = new Component({ userName: 'TestBuyer' });", context);
  const comp = context.comp;
  return {
    comp,
    context,
    vals: () => comp.renderVals(),
    // Let pending API promises resolve and their setState land.
    settle: () => new Promise(resolve => setImmediate(() => setImmediate(resolve)))
  };
}

/**
 * An API stub whose compareProducts runs the real engine through the service,
 * recording every call. `delays` (optional) holds per-call promises to gate
 * answers, for ordering tests.
 */
function engineBackedApi() {
  const ComparisonService = require(path.join(ROOT, 'server', 'modules', 'catalog', 'application', 'ComparisonService'));
  const calls = [];
  const gates = [];
  return {
    calls,
    gates,
    compareProducts(ids, priorities, lang) {
      calls.push({ ids: ids.slice(), priorities, lang });
      const gate = gates.shift() || Promise.resolve();
      return gate.then(() => ComparisonService.getComparison(ids, priorities, { locale: lang }))
        .then(r => JSON.parse(JSON.stringify(r)));
    }
  };
}

module.exports = { loadCompareRuntime, engineBackedApi };
