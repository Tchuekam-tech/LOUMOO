/**
 * Unit Test: SuperAdmin Audit Log Filters & Settings Expansion
 * ---------------------------------------------------------------------------
 * Validates:
 *   1. Multi-criteria audit log filtering (action, resourceType, dates, search, pagination).
 *   2. Tamper-evident audit log export in CSV and JSON formats.
 *   3. Distinct audit actions extraction.
 *   4. Settings category segmentation and retrieval.
 *   5. Settings factory reset to baseline seeds with audit tracking.
 *   6. Domain validations for shipping_rates_by_city, announcement_banner, and feature_flags.
 *   7. Deep infrastructure health diagnostic probe.
 *   8. Dedicated maintenance mode toggle endpoint.
 *   9. Full HTTP integration over Express router with strict RBAC.
 */

require('../setup');
const assert = require('assert');
const express = require('express');
const SuperAdminRepository = require('../../SuperAdmin/backend/repositories/SuperAdminRepository');
const SuperAdminService = require('../../SuperAdmin/backend/services/SuperAdminService');
const superAdminRoutes = require('../../SuperAdmin/backend/routes/superAdminRoutes');
const { ROLES } = require('../../server/modules/identity/value-objects/Role');

async function run() {
  console.log('  Testing SuperAdmin Audit Log Filters & Settings Expansion...');

  // Seed sample audit logs with diverse attributes
  const baseTime = Date.now();
  await SuperAdminRepository.recordAuditLog({
    adminId: 'admin_security',
    action: 'store.verify',
    resourceType: 'store',
    resourceId: 'store_douala_101',
    reason: 'Verified RCCM and national ID card for Douala merchant',
    oldValues: { is_verified: false },
    newValues: { is_verified: true, tier: 'official_brand' },
    ipAddress: '197.234.220.14'
  });

  await SuperAdminRepository.recordAuditLog({
    adminId: 'admin_finance',
    action: 'setting.update',
    resourceType: 'system_setting',
    resourceId: 'shipping_rates_by_city',
    reason: 'Adjusted Yaounde fuel surcharge',
    oldValues: { Yaounde: 1500 },
    newValues: { Yaounde: 1800 },
    ipAddress: '197.234.220.15'
  });

  await SuperAdminRepository.recordAuditLog({
    adminId: 'admin_safety',
    action: 'store.suspend',
    resourceType: 'store',
    resourceId: 'store_fraud_999',
    reason: 'Suspected counterfeit inventory alert',
    oldValues: { status: 'ACTIVE' },
    newValues: { status: 'SUSPENDED' },
    ipAddress: '197.234.220.16'
  });

  console.log('    ✓ 1. Seed audit logs recorded');

  // ── 1. Audit Log Filtering: By Resource Type ──
  const storeLogs = await SuperAdminService.getAuditLogs({ resourceType: 'store' });
  assert.ok(Array.isArray(storeLogs));
  assert.ok(storeLogs.length >= 2);
  assert.ok(storeLogs.every(l => l.resource_type === 'store'));
  console.log('    ✓ 2. Filter by resourceType ("store") verified');

  // ── 2. Audit Log Filtering: By Action ──
  const verifyLogs = await SuperAdminService.getAuditLogs({ action: 'store.verify' });
  assert.ok(verifyLogs.length >= 1);
  assert.ok(verifyLogs.every(l => l.action === 'store.verify'));
  console.log('    ✓ 3. Filter by action ("store.verify") verified');

  // ── 3. Audit Log Filtering: By Text Search ──
  const searchLogs = await SuperAdminService.getAuditLogs({ search: 'counterfeit' });
  assert.ok(searchLogs.length >= 1);
  assert.strictEqual(searchLogs[0].resource_id, 'store_fraud_999');
  console.log('    ✓ 4. Filter by text search ("counterfeit") verified');

  // ── 4. Audit Log Filtering: Pagination & Metadata ──
  const pagedLogs = await SuperAdminService.getAuditLogs({ limit: 1, offset: 0 });
  assert.strictEqual(pagedLogs.length, 1);
  assert.ok(pagedLogs.totalCount >= 3, 'Total count must reflect overall records');
  assert.ok(pagedLogs.totalPages >= 3, 'Total pages must be calculated');
  assert.strictEqual(pagedLogs.limit, 1);
  assert.strictEqual(pagedLogs.offset, 0);
  console.log('    ✓ 5. Audit pagination metadata (totalCount, totalPages) verified');

  // ── 5. Distinct Audit Actions ──
  const distinctActions = await SuperAdminService.getAuditActions();
  assert.ok(Array.isArray(distinctActions));
  assert.ok(distinctActions.includes('store.verify'));
  assert.ok(distinctActions.includes('store.suspend'));
  assert.ok(distinctActions.includes('setting.update'));

  // No taxonomy drift: the default list must match what the code actually records.
  // Verbs that are never written must be absent; verbs that ARE written must be present.
  assert.ok(!distinctActions.includes('order.escrow'), 'bogus order.escrow must not be advertised');
  assert.ok(!distinctActions.includes('maintenance.toggle'), 'bogus maintenance.toggle must not be advertised');
  for (const real of ['escrow.resolve', 'listing.reject', 'listing.moderate', 'user.update', 'user.role_change', 'user.kyc_update']) {
    assert.ok(distinctActions.includes(real), `real action [${real}] must be advertised`);
  }

  // Role and KYC changes must be logged under distinct actions, not generic user.update.
  await SuperAdminService.updateUserRole('usr_buyer_1', 'seller', { adminId: 'admin_ops', actorRole: 'super_admin' });
  await SuperAdminService.updateUserKyc('usr_buyer_1', 'verified', { adminId: 'admin_ops' });
  const roleLogs = await SuperAdminService.getAuditLogs({ action: 'user.role_change' });
  const kycLogs = await SuperAdminService.getAuditLogs({ action: 'user.kyc_update' });
  assert.ok(roleLogs.some(l => l.resource_id === 'usr_buyer_1'), 'role change must log action user.role_change');
  assert.ok(kycLogs.some(l => l.resource_id === 'usr_buyer_1'), 'kyc change must log action user.kyc_update');
  console.log(`    ✓ 6. Distinct audit actions verified: no drift, role/KYC logged distinctly (${distinctActions.length} actions)`);

  // ── 6. Compliance Audit Export (CSV & JSON) ──
  const csvExport = await SuperAdminService.exportAuditLogs({ resourceType: 'store' }, 'csv');
  assert.strictEqual(csvExport.extension, 'csv');
  assert.strictEqual(csvExport.contentType, 'text/csv; charset=utf-8');
  assert.ok(csvExport.content.includes('store_douala_101'));
  assert.ok(csvExport.content.startsWith('"ID","Date","Action"'));

  const jsonExport = await SuperAdminService.exportAuditLogs({}, 'json');
  assert.strictEqual(jsonExport.extension, 'json');
  const parsedJson = JSON.parse(jsonExport.content);
  assert.ok(Array.isArray(parsedJson));
  console.log('    ✓ 7. Audit log export (CSV & JSON) with compliance tracking verified');

  // ── 7. Settings Categories & Categorization ──
  const categories = SuperAdminService.getSettingCategories();
  assert.ok(Array.isArray(categories));
  assert.ok(categories.some(c => c.id === 'financial'));
  assert.ok(categories.some(c => c.id === 'operational'));

  const financialSettings = await SuperAdminService.getSettingsByCategory('financial');
  assert.ok(financialSettings.platform_commission_rate);
  assert.strictEqual(financialSettings.shipping_rates_by_city, undefined);

  const operationalSettings = await SuperAdminService.getSettingsByCategory('operational');
  assert.ok(operationalSettings.shipping_rates_by_city);
  assert.ok(operationalSettings.maintenance_mode);
  console.log('    ✓ 8. Settings categories and category grouping verified');

  // ── 8. Domain Validation: shipping_rates_by_city ──
  // Invalid rate (negative)
  await assert.rejects(
    async () => {
      await SuperAdminService.updateSystemSetting('shipping_rates_by_city', { Douala: -500 });
    },
    /Delivery fee for Douala must be an integer between 0 and 100,000 XAF/
  );

  // Invalid rate (> 100,000 XAF)
  await assert.rejects(
    async () => {
      await SuperAdminService.updateSystemSetting('shipping_rates_by_city', { Douala: 150000 });
    },
    /Delivery fee for Douala must be an integer between 0 and 100,000 XAF/
  );

  // Invalid rate (fractional): fees are whole XAF
  await assert.rejects(
    async () => {
      await SuperAdminService.updateSystemSetting('shipping_rates_by_city', { Douala: 1500.5 });
    },
    /Delivery fee for Douala must be an integer between 0 and 100,000 XAF/
  );

  // Valid update
  const validShipping = await SuperAdminService.updateSystemSetting('shipping_rates_by_city', {
    Douala: 1200,
    Yaounde: 1800,
    Bafoussam: 2800
  }, { adminId: 'admin_logistics' });
  assert.strictEqual(validShipping.success, true);
  assert.strictEqual(validShipping.value.Douala, 1200);
  console.log('    ✓ 9. Domain validation for shipping_rates_by_city verified');

  // ── 9. Domain Validation: announcement_banner & feature_flags ──
  await assert.rejects(
    async () => {
      await SuperAdminService.updateSystemSetting('announcement_banner', { active: true, message: '' });
    },
    /Announcement banner must include a non-empty message/
  );

  await assert.rejects(
    async () => {
      await SuperAdminService.updateSystemSetting('feature_flags', { travel_enabled: 'yes' });
    },
    /Feature flag \[travel_enabled\] must be a boolean value/
  );
  console.log('    ✓ 10. Domain validations for announcement banner and feature flags verified');

  // ── 10. Settings Factory Reset ──
  const resetRes = await SuperAdminService.resetSystemSetting('shipping_rates_by_city', {
    adminId: 'admin_chief',
    reason: 'Emergency baseline rollback'
  });
  assert.strictEqual(resetRes.success, true);
  assert.strictEqual(resetRes.value.Douala, 1000, 'Douala rate must be restored to default 1000 XAF');

  const afterResetLogs = await SuperAdminService.getAuditLogs({ action: 'setting.reset' });
  assert.ok(afterResetLogs.length >= 1);
  assert.strictEqual(afterResetLogs[0].resource_id, 'shipping_rates_by_city');
  console.log('    ✓ 11. Settings factory reset with audit tracking verified');

  // ── 11. Dedicated Maintenance Mode Toggle ──
  const maintRes = await SuperAdminService.setMaintenanceMode({
    enabled: true,
    bannerText: 'LOUMOO maintenance test in progress.'
  }, { adminId: 'admin_ops' });
  assert.strictEqual(maintRes.success, true);
  assert.strictEqual(maintRes.value.enabled, true);
  assert.strictEqual(maintRes.value.banner_text, 'LOUMOO maintenance test in progress.', 'camelCase bannerText must be applied');

  // Regression: the frontend clients send snake_case banner_text / allow_admin_bypass.
  // These were previously dropped (service only read camelCase), so a custom banner
  // fell back to the default and "disable admin bypass" never took effect.
  const maintSnake = await SuperAdminService.setMaintenanceMode({
    enabled: true,
    banner_text: 'Maintenance critique en cours.',
    allow_admin_bypass: false
  }, { adminId: 'admin_ops' });
  assert.strictEqual(maintSnake.value.banner_text, 'Maintenance critique en cours.', 'snake_case banner_text must be applied');
  assert.strictEqual(maintSnake.value.allow_admin_bypass, false, 'explicit allow_admin_bypass:false must be honoured');

  // An unspecified bypass still defaults to true (admins keep access).
  const maintDefault = await SuperAdminService.setMaintenanceMode({ enabled: true }, { adminId: 'admin_ops' });
  assert.strictEqual(maintDefault.value.allow_admin_bypass, true, 'unspecified bypass defaults to true');

  // A non-boolean bypass is rejected.
  await assert.rejects(
    () => SuperAdminService.setMaintenanceMode({ enabled: true, allow_admin_bypass: 'yes' }, { adminId: 'admin_ops' }),
    /allow_admin_bypass/,
    'non-boolean allow_admin_bypass must be rejected'
  );

  // Reset to a clean (disabled) state for the remaining steps.
  await SuperAdminService.setMaintenanceMode({ enabled: false }, { adminId: 'admin_ops' });
  console.log('    ✓ 12. Dedicated maintenance mode toggle verified (snake_case + camelCase, explicit bypass)');

  // ── 12. Deep Health Diagnostic Probe ──
  const health = await SuperAdminService.getDeepHealth();
  assert.ok(health.status === 'HEALTHY' || health.status === 'DEGRADED');
  assert.ok(health.services.database);
  assert.ok(health.services.cache);
  assert.ok(health.services.memory && health.services.memory.heapUsedMb > 0);
  console.log('    ✓ 13. Deep infrastructure health diagnostic probe verified');

  // ── 13. HTTP Endpoint Integration & RBAC Guard ──
  const app = express();
  app.use(express.json());

  // Test middleware simulating super_admin principal
  let testPrincipal = { id: 'admin_http_test', role: ROLES.SUPER_ADMIN };
  app.use((req, res, next) => {
    req.principal = testPrincipal;
    next();
  });
  app.use('/api/v1/admin', superAdminRoutes);

  // Loopback only (the SuperAdmin routes accept dev tokens outside production). With an
  // explicit host listen() binds asynchronously, so wait for it before reading the port.
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = server.address().port;
  const httpUrl = `http://127.0.0.1:${port}/api/v1/admin`;

  try {
    // A. GET /api/v1/admin/audit-logs with filters
    const auditRes = await fetch(`${httpUrl}/audit-logs?resourceType=store&limit=5`);
    const auditJson = await auditRes.json();
    assert.strictEqual(auditRes.status, 200);
    assert.strictEqual(auditJson.success, true);
    assert.ok(Array.isArray(auditJson.data.logs));
    assert.ok(auditJson.data.totalCount !== undefined);

    // B. GET /api/v1/admin/audit-logs/actions
    const actionsRes = await fetch(`${httpUrl}/audit-logs/actions`);
    const actionsJson = await actionsRes.json();
    assert.strictEqual(actionsRes.status, 200);
    assert.ok(Array.isArray(actionsJson.data.actions));

    // C. GET /api/v1/admin/audit-logs/export?format=csv
    const exportRes = await fetch(`${httpUrl}/audit-logs/export?format=csv`);
    assert.strictEqual(exportRes.status, 200);
    assert.strictEqual(exportRes.headers.get('content-type'), 'text/csv; charset=utf-8');
    const exportCsv = await exportRes.text();
    assert.ok(exportCsv.includes('Action'));

    // D. GET /api/v1/admin/settings/categories
    const catRes = await fetch(`${httpUrl}/settings/categories`);
    const catJson = await catRes.json();
    assert.strictEqual(catRes.status, 200);
    assert.ok(Array.isArray(catJson.data.categories));

    // E. GET /api/v1/admin/settings/category/financial
    const finRes = await fetch(`${httpUrl}/settings/category/financial`);
    const finJson = await finRes.json();
    assert.strictEqual(finRes.status, 200);
    assert.ok(finJson.data.settings.platform_commission_rate);

    // F. POST /api/v1/admin/settings/reset/platform_commission_rate
    const resetHttp = await fetch(`${httpUrl}/settings/reset/platform_commission_rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'HTTP reset test' })
    });
    const resetJson = await resetHttp.json();
    assert.strictEqual(resetHttp.status, 200);
    assert.strictEqual(resetJson.success, true);

    // G. POST /api/v1/admin/maintenance
    const maintHttp = await fetch(`${httpUrl}/maintenance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false, banner_text: 'Live' })
    });
    const maintJson = await maintHttp.json();
    assert.strictEqual(maintHttp.status, 200);
    assert.strictEqual(maintJson.success, true);

    // H. GET /api/v1/admin/health/deep
    const healthHttp = await fetch(`${httpUrl}/health/deep`);
    const healthJson = await healthHttp.json();
    assert.strictEqual(healthHttp.status, 200);
    assert.ok(healthJson.data.services);

    // I. RBAC guard test: unauthenticated / non-admin refusal
    testPrincipal = { id: 'usr_normal', role: ROLES.CUSTOMER };
    const forbiddenHttp = await fetch(`${httpUrl}/audit-logs`);
    assert.strictEqual(forbiddenHttp.status, 403);

    console.log('    ✓ 14. All 8 new SuperAdmin REST endpoints verified over HTTP with strict RBAC');
  } finally {
    server.close();
  }

  console.log('  All SuperAdmin Audit Log Filters & Settings Expansion tests passed successfully!');
  process.exit(0);
}

run().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
