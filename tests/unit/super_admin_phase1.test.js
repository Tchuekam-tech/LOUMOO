/**
 * Unit Test: SuperAdmin Phase 1 (Foundation & Dynamic Settings Architecture)
 * ---------------------------------------------------------------------------
 * Validates:
 *   1. SuperAdminRepository settings read/write & audit log persistence.
 *   2. SuperAdminService business validations & audit event generation.
 *   3. superAdminGuard RBAC enforcement.
 *   4. HTTP Endpoint integration via Express mock harness.
 */

require('../setup');
const assert = require('assert');
const SuperAdminRepository = require('../../SuperAdmin/backend/repositories/SuperAdminRepository');
const SuperAdminService = require('../../SuperAdmin/backend/services/SuperAdminService');
const { requireSuperAdminRole } = require('../../SuperAdmin/backend/middleware/superAdminGuard');
const { ROLES } = require('../../server/modules/identity/value-objects/Role');

async function run() {
  console.log('  Testing SuperAdmin Phase 1: Dynamic Settings & Audit Architecture...');

  // ── 1. Repository System Settings Read & Fallback ──
  const allSettings = await SuperAdminRepository.getAllSettings();
  assert.ok(allSettings, 'Settings object must be returned');
  assert.ok(allSettings.platform_commission_rate, 'Default commission rate setting must exist');
  assert.strictEqual(typeof allSettings.platform_commission_rate.rate_percent, 'number');
  assert.ok(allSettings.seller_whatsapp_default, 'Default seller WhatsApp setting must exist');
  assert.ok(allSettings.maintenance_mode, 'Default maintenance mode setting must exist');
  console.log('    ✓ 1. Default system settings retrieved successfully');

  // ── 2. Single Setting Lookup ──
  const comm = await SuperAdminRepository.getSetting('platform_commission_rate');
  assert.ok(comm && comm.rate_percent !== undefined);
  console.log('    ✓ 2. Single setting lookup verified');

  // ── 3. Repository Update & Audit Log Recording ──
  const updateRes = await SuperAdminRepository.updateSetting('platform_commission_rate', {
    rate_percent: 7.5,
    category_rates: { electronics: 7.5 }
  }, 'admin_test_1');
  assert.strictEqual(updateRes.success, true);
  assert.strictEqual(updateRes.value.rate_percent, 7.5);

  const updatedSetting = await SuperAdminRepository.getSetting('platform_commission_rate');
  assert.strictEqual(updatedSetting.rate_percent, 7.5);
  console.log('    ✓ 3. Dynamic setting updated and verified in repository');

  // ── 4. Audit Log Recording & Querying ──
  const auditEntry = await SuperAdminRepository.recordAuditLog({
    adminId: 'admin_test_1',
    action: 'setting.update',
    resourceType: 'system_setting',
    resourceId: 'platform_commission_rate',
    oldValues: { rate_percent: 5.0 },
    newValues: { rate_percent: 7.5 },
    reason: 'Platform fee adjustment for promo season'
  });
  assert.ok(auditEntry.id, 'Audit entry must have generated ID');
  assert.strictEqual(auditEntry.action, 'setting.update');

  const logs = await SuperAdminRepository.getAuditLogs({ limit: 10 });
  assert.ok(Array.isArray(logs) && logs.length > 0);
  assert.strictEqual(logs[0].resource_id, 'platform_commission_rate');
  console.log('    ✓ 4. Audit trail recorded and retrieved with full metadata');

  // ── 5. Service Validations ──
  // Invalid commission percentage (> 50%)
  await assert.rejects(
    async () => {
      await SuperAdminService.updateSystemSetting('platform_commission_rate', { rate_percent: 85.0 });
    },
    /Platform commission rate must be a number between 0% and 50%/
  );

  // Invalid WhatsApp number (too short)
  await assert.rejects(
    async () => {
      await SuperAdminService.updateSystemSetting('seller_whatsapp_default', { number: '123' });
    },
    /A valid WhatsApp phone number must be provided/
  );

  // Valid service update with automatic audit log
  const validServiceUpdate = await SuperAdminService.updateSystemSetting('seller_whatsapp_default', {
    number: '237677998811',
    label: 'LOUMOO Cameroon VIP Support'
  }, { adminId: 'admin_chief', reason: 'VIP line migration' });
  assert.strictEqual(validServiceUpdate.success, true);

  const freshLogs = await SuperAdminService.getAuditLogs({ limit: 5 });
  assert.strictEqual(freshLogs[0].admin_id, 'admin_chief');
  assert.strictEqual(freshLogs[0].resource_id, 'seller_whatsapp_default');
  console.log('    ✓ 5. Service domain validations & audit orchestration verified');

  // ── 6. Overview Aggregation Metrics ──
  const overview = await SuperAdminService.getOverviewMetrics();
  assert.ok(overview.kpis, 'KPIs object must exist in overview');
  assert.ok(overview.kpis.activeStores !== undefined);
  assert.ok(overview.kpis.totalOrders !== undefined);
  assert.ok(overview.kpis.gmvFormatted !== undefined);
  assert.ok(overview.health && overview.health.serverStatus === 'HEALTHY');

  // Escrow-in-flight must be COMPUTED from orders, not the old hardcoded 2,340,000.
  assert.strictEqual(typeof overview.kpis.escrowInFlightXaf, 'number', 'escrowInFlightXaf must be numeric');
  assert.notStrictEqual(overview.kpis.escrowInFlightXaf, 2340000, 'escrowInFlightXaf must not be the legacy hardcoded constant');
  // Pure aggregation helper: only HELD orders count toward escrow-in-flight.
  const escrowSample = SuperAdminRepository.sumEscrowInFlight([
    { total_amount: 100000, escrow_status: 'HELD' },
    { total_amount: 50000, escrow_status: 'held' },      // case-insensitive
    { total_amount: 999999, escrow_status: 'RELEASED' },  // settled — excluded
    { total_amount: 999999, escrow_status: 'REFUNDED' },  // settled — excluded
    { total_amount: 'nan', escrow_status: 'HELD' }         // non-numeric — treated as 0
  ]);
  assert.strictEqual(escrowSample, 150000, 'sumEscrowInFlight must sum only HELD orders with numeric amounts');
  console.log('    ✓ 6. Real-time overview metrics aggregation verified (escrow computed from orders)');

  // ── 7. superAdminGuard RBAC Check ──
  let passed = false;
  const mockReqAdmin = {
    principal: { id: 'usr_admin', primaryRole: ROLES.SUPER_ADMIN },
    headers: {}
  };
  requireSuperAdminRole(mockReqAdmin, {}, () => { passed = true; });
  assert.strictEqual(passed, true, 'Super admin role must pass guard');

  let rejected = false;
  const mockReqCustomer = {
    principal: { id: 'usr_regular', primaryRole: ROLES.CUSTOMER },
    headers: {}
  };
  requireSuperAdminRole(mockReqCustomer, {}, (err) => {
    if (err) rejected = true;
  });
  assert.strictEqual(rejected, true, 'Customer role must be blocked by guard');

  // The only non-session way in is the harness's test token (secret-verified).
  const harness = require('../helpers/harness');
  let testTokenPassed = false;
  const mockReqToken = {
    headers: { authorization: `Bearer ${harness.superAdminToken()}` }
  };
  await requireSuperAdminRole(mockReqToken, {}, (err) => { if (!err) testTokenPassed = true; });
  assert.strictEqual(testTokenPassed, true, 'Harness super-admin test token must pass guard when test auth is enabled');
  assert.strictEqual(mockReqToken.principal.primaryRole, ROLES.SUPER_ADMIN);
  console.log('    ✓ 7. RBAC security guard verification passed');

  // ── 8. HTTP Endpoint Integration via Harness ──
  const adminToken = harness.superAdminToken();
  const pageRes = await harness.request('GET', '/superadmin');
  assert.strictEqual(pageRes.status, 200, '/superadmin dedicated page must return 200');
  const htmlContent = typeof pageRes.body === 'string' ? pageRes.body : JSON.stringify(pageRes.body);
  assert.ok(htmlContent.includes('<title>LOUMOO — Enterprise Control</title>'), 'Page must be the SuperAdmin control center (SuperAdmin/frontend/index.html)');

  const settingsRes = await harness.request('GET', '/api/v1/admin/settings', { token: adminToken });
  assert.strictEqual(settingsRes.status, 200, 'GET /api/v1/admin/settings must return 200');
  assert.ok(settingsRes.body.data.settings, 'Settings payload must be returned');

  const updateHttp = await harness.request('PUT', '/api/v1/admin/settings/platform_commission_rate', {
    token: adminToken,
    body: { value: { rate_percent: 6.2 }, reason: 'HTTP integration test update' }
  });
  assert.strictEqual(updateHttp.status, 200, 'PUT /api/v1/admin/settings/:key must return 200');
  assert.strictEqual(updateHttp.body.data.value.rate_percent, 6.2);

  const overviewRes = await harness.request('GET', '/api/v1/admin/overview', { token: adminToken });
  assert.strictEqual(overviewRes.status, 200, 'GET /api/v1/admin/overview must return 200');
  assert.ok(overviewRes.body.data.kpis, 'KPIs must be returned in overview');

  await harness.stop();
  console.log('    ✓ 8. Dedicated /superadmin page and REST endpoints verified over HTTP');

  console.log('  All SuperAdmin Phase 1 tests passed successfully!\n');
}

if (require.main === module) {
  run().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error('SuperAdmin Phase 1 test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
