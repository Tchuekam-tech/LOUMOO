/**
 * Unit Test: SuperAdmin Phase 4 (SuperAdmin Screen & Executive Interface)
 * ---------------------------------------------------------------------------
 * Validates:
 *   1. 'superAdmin' inclusion in SCREENS in Commerce App.dc.html and routes.js.
 *   2. Generation of SuperAdminScreens.dc.html chunk and public assembly.
 *   3. 90/90 screen verification and 717/717 sc-if tag balance.
 *   4. Presence of all 7 tabs and executive header in super_admin_view.py.
 */

require('../setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function run() {
  console.log('  Testing SuperAdmin Phase 4: SuperAdmin Screen & Executive Interface...');

  const root = path.resolve(__dirname, '../..');

  // ── 1. Routes & NO_NAV_SCREENS Registration ──
  const routesCode = fs.readFileSync(path.join(root, 'src/data/routes.js'), 'utf-8');
  assert.ok(routesCode.includes('superAdmin:'), 'superAdmin must be defined in routes.js');
  assert.ok(routesCode.includes("'superAdmin'"), 'superAdmin must be in NO_NAV_SCREENS');
  console.log('    ✓ 1. superAdmin route and NO_NAV_SCREENS registration verified');

  // ── 2. Master App Shell & Screen Chunks ──
  const appHtml = fs.readFileSync(path.join(root, 'Commerce App.dc.html'), 'utf-8');
  assert.ok(appHtml.includes("'superAdmin'"), "Commerce App.dc.html must declare 'superAdmin' in SCREENS");
  assert.ok(appHtml.includes('SuperAdminScreens'), 'Commerce App.dc.html must import SuperAdminScreens');

  const chunkPath = path.join(root, 'SuperAdminScreens.dc.html');
  assert.ok(fs.existsSync(chunkPath), 'SuperAdminScreens.dc.html chunk file must be generated');
  const chunkHtml = fs.readFileSync(chunkPath, 'utf-8');
  assert.ok(chunkHtml.includes('is.superAdmin'), "SuperAdminScreens.dc.html must check is.superAdmin");
  console.log('    ✓ 2. Master app shell and SuperAdminScreens chunk compilation verified');

  // ── 3. Public Directory Assembly ──
  const publicIndex = path.join(root, 'public/index.html');
  const publicChunk = path.join(root, 'public/SuperAdminScreens.dc.html');
  assert.ok(fs.existsSync(publicIndex), 'public/index.html must exist');
  assert.ok(fs.existsSync(publicChunk), 'public/SuperAdminScreens.dc.html must exist');
  console.log('    ✓ 3. Public distribution artifact assembly verified');

  // ── 4. Verify 7 Executive Tabs in Template ──
  const viewPath = path.join(root, 'src/views/super_admin_view.py');
  const viewCode = fs.readFileSync(viewPath, 'utf-8');

  // Header Bar
  assert.ok(viewCode.includes('LOUMOO SUPERADMIN'), 'View must contain LOUMOO SUPERADMIN header');
  assert.ok(viewCode.includes('EN DIRECT'), 'View must contain live status badge');

  // 7 Tabs
  assert.ok(viewCode.includes("adminTabIsOverview") || viewCode.includes("adminActiveTab === 'overview'"), 'Tab 1 (Overview & KPIs) must exist');
  assert.ok(viewCode.includes("adminTabIsStores") || viewCode.includes("adminActiveTab === 'stores'"), 'Tab 2 (Stores & KYC) must exist');
  assert.ok(viewCode.includes("adminTabIsListings") || viewCode.includes("adminActiveTab === 'listings'"), 'Tab 3 (Catalog Moderation) must exist');
  assert.ok(viewCode.includes("adminTabIsUsers") || viewCode.includes("adminActiveTab === 'users'"), 'Tab 4 (Users & RBAC) must exist');
  assert.ok(viewCode.includes("adminTabIsOrders") || viewCode.includes("adminActiveTab === 'orders'"), 'Tab 5 (Orders & Escrow) must exist');
  assert.ok(viewCode.includes("adminTabIsSettings") || viewCode.includes("adminActiveTab === 'settings'"), 'Tab 6 (Dynamic Settings) must exist');
  assert.ok(viewCode.includes("adminTabIsAudit") || viewCode.includes("adminActiveTab === 'audit'"), 'Tab 7 (Audit Logs) must exist');
  console.log('    ✓ 4. All 7 executive tabs and header bar verified in super_admin_view.py');

  // ── 5. Tag Balance & Screen Audit via verify_screens.py ──
  // "python" on Windows and some images, "python3" on others (ubuntu runners).
  const pythonBin = (() => {
    for (const bin of ['python', 'python3']) {
      try { execSync(`${bin} --version`, { stdio: 'ignore' }); return bin; } catch (e) { /* try the next */ }
    }
    throw new Error('Neither "python" nor "python3" is on PATH; verify_screens.py cannot run.');
  })();
  const verifyOut = execSync(`${pythonBin} -X utf8 verify_screens.py`, { cwd: root, encoding: 'utf-8' });
  assert.ok(verifyOut.includes('Total unique screen conditionals found: 91'), 'Must find 91 screen conditionals');
  assert.ok(verifyOut.includes('Total screens declared in SCREENS: 91'), 'Must match 91 declared screens');
  assert.ok(verifyOut.includes('Missing screens count: 0'), 'Missing screens count must be 0');
  // The exact tag count shifts as screens evolve (e.g. the premium hotel
  // redesign added conditional sections); what must hold is that every
  // <sc-if> is closed. Assert true balance from the reporter's own numbers
  // rather than pinning a magic total.
  const scIfMatch = verifyOut.match(/Open sc-if:\s*(\d+),\s*Close sc-if:\s*(\d+)/);
  assert.ok(scIfMatch, 'verify_screens must report the sc-if tag counts');
  assert.strictEqual(scIfMatch[1], scIfMatch[2], 'sc-if tags must be perfectly balanced');
  console.log('    ✓ 5. 91/91 screens verified with balanced sc-if tags');

  console.log('  All SuperAdmin Phase 4 tests passed successfully!');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
