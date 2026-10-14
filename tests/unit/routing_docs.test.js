/**
 * The routing documentation cannot drift from the registry.
 *
 *   - the generated route map in docs/ROUTING.md equals what scripts/sync_route_docs.js
 *     produces from src/routing/routes.js (every route, alias and unrouted screen)
 *   - the areas the project names are documented with their real status
 *   - the commands the document tells people to run exist
 */
'use strict';

require('../setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const Routes = require('../../src/routing/routes');
const docs = require('../../scripts/sync_route_docs');

const ROOT = path.resolve(__dirname, '../..');

async function run() {
  const text = fs.readFileSync(docs.DOC, 'utf8');
  assert.ok(text.includes(docs.generate()), 'docs/ROUTING.md route map is out of date: run node scripts/sync_route_docs.js');
  Routes.routes.forEach(r => assert.ok(text.includes('`' + r.path + '`'), `docs/ROUTING.md does not mention ${r.path}`));
  Routes.aliases.forEach(a => assert.ok(text.includes('`' + a.from + '` -> `' + a.to + '`'), `alias ${a.from} is not documented`));
  Object.keys(Routes.unroutedScreens).forEach(k => assert.ok(text.includes('`' + k + '`'), `unrouted screen ${k} is not documented`));
  console.log(`    ✓ routing_docs: the generated route map lists all ${Routes.routes.length} routes, ${Routes.aliases.length} aliases and ${Object.keys(Routes.unroutedScreens).length} unrouted screens`);

  // The honest statements.
  assert.ok(/\*\*MarketHub\*\*[^|]*\|[^|]*\|[^|]*does not exist/.test(text), 'MarketHub must be documented as not existing');
  assert.ok(/\*\*Agency workspace\*\*[^|]*\|[^|]*\|[^|]*does not exist/.test(text), 'the agency workspace must be documented as not existing');
  assert.ok(text.includes('`<base href="/">`') || text.includes('<base href="/">'), 'the asset strategy must be documented');
  assert.ok(text.includes('no catch-all') || text.includes('There is **no catch-all rewrite**'), 'the no-catch-all rule must be documented');
  console.log('    ✓ routing_docs: MarketHub and agency are documented as not built; the asset and rewrite strategy is documented');

  // The commands it names exist.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  ['scripts/sync_route_config.js', 'scripts/sync_route_docs.js', 'tests/routing/backend_authz.e2e.test.js', 'tests/routing/README.md', 'src/routing/routes.js', 'src/services/appRouter.js']
    .forEach(f => assert.ok(fs.existsSync(path.join(ROOT, f)), `docs/ROUTING.md refers to ${f}, which does not exist`));
  assert.ok(pkg.scripts['routes:check'] && pkg.scripts['test:routing'], 'package.json must expose routes:check and test:routing');
  console.log('    ✓ routing_docs: every file and npm script the document refers to exists');
}

module.exports = { run };

if (require.main === module) {
  run().then(() => { console.log('routing_docs: OK'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
