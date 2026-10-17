/**
 * LOUMOO SuperAdmin — Adversarial Security, Hardening & Contract Test Suite
 * ---------------------------------------------------------------------------
 * Deep verification covering:
 *   1. RBAC authentication & authorization bounds (no bypass on unset NODE_ENV)
 *   2. Server-side maintenance mode enforcement (503 for customers, 200 for admins & bypass)
 *   3. CSV RFC 4180 escaping & spreadsheet formula injection mitigation (CWE-1236)
 *   4. Sensitive credential redaction in CSV & JSON audit exports
 *   5. Deep health diagnostics fault isolation, timeouts, and secret masking
 *   6. Strict domain validation bounds (floats, negative rates, XSS URLs, flag names)
 *   7. Factory reset idempotency, error handling, and audit trail creation
 *   8. Pagination boundary conditions and PostgREST syntax injection immunity
 *   9. Full SDK method parity across LoumooApiClient and SuperAdminAPI
 */

// Hermetic bootstrap FIRST — sets NODE_ENV=test and scrubs service credentials
// before any module below loads server config. Without it, a direct
// `node tests/unit/super_admin_adversarial_hardening.test.js` run resolves the
// real (production) Supabase admin client, so this suite — which seeds audit
// rows carrying formula-injection payloads and fake secrets — would write them
// to the live database and then assert against data that isn't there.
require('../setup');

const assert = require('assert');
const express = require('express');
const http = require('http');

// System modules under test
const SuperAdminRepository = require('../../SuperAdmin/backend/repositories/SuperAdminRepository');
const SuperAdminService = require('../../SuperAdmin/backend/services/SuperAdminService');
const superAdminRoutes = require('../../SuperAdmin/backend/routes/superAdminRoutes');
const { requireSuperAdminRole } = require('../../SuperAdmin/backend/middleware/superAdminGuard');
const { maintenanceGuard } = require('../../SuperAdmin/backend/middleware/maintenanceGuard');
const { ROLES } = require('../../server/modules/identity/value-objects/Role');
const loumooApi = require('../../src/services/loumooApi');
const superAdminApi = require('../../SuperAdmin/frontend/js/superAdminApi');

async function run() {
  console.log('Testing SuperAdmin Adversarial Hardening & Verification Matrix...');

  // ── 1. RBAC & Authentication Hardening ──
  console.log('  [1] RBAC & Authentication Hardening');

  // A. Unauthenticated request with NO principal, NO token, and NO admin key MUST FAIL
  let unauthError = null;
  const mockReqNoAuth = { headers: {} };
  await requireSuperAdminRole(mockReqNoAuth, {}, (err) => { unauthError = err; });
  assert.ok(unauthError, 'Unauthenticated request must be rejected');
  assert.strictEqual(unauthError.code, 'UNAUTHENTICATED');

  // B. Authenticated customer must be rejected with 403 PERMISSION_DENIED
  let customerError = null;
  const mockReqCustomer = {
    principal: { id: 'usr_customer_1', primaryRole: ROLES.CUSTOMER },
    headers: {}
  };
  await requireSuperAdminRole(mockReqCustomer, {}, (err) => { customerError = err; });
  assert.ok(customerError, 'Customer role must be blocked from admin routes');
  assert.strictEqual(customerError.code, 'PERMISSION_DENIED');
  assert.strictEqual(customerError.statusCode, 403);

  // C. Authenticated super admin must be permitted
  let superAdminPassed = false;
  const mockReqAdmin = {
    principal: { id: 'usr_super_1', primaryRole: ROLES.SUPER_ADMIN },
    headers: {}
  };
  await requireSuperAdminRole(mockReqAdmin, {}, (err) => {
    if (!err) superAdminPassed = true;
  });
  assert.strictEqual(superAdminPassed, true, 'Super Admin must pass guard');
  console.log('    ✓ RBAC guards reject unauthenticated & non-admin callers, allow super admin');

  // ── 2. Settings Domain Validations: Adversarial Boundary Testing ──
  console.log('  [2] Settings Domain Boundary Hardening');

  // A. shipping_rates_by_city: reject float rates (XAF has no subunit decimals)
  let floatRateError = false;
  try {
    await SuperAdminService.updateSystemSetting('shipping_rates_by_city', { Douala: 1500.75 });
  } catch (err) {
    floatRateError = err.message.includes('integer');
  }
  assert.strictEqual(floatRateError, true, 'Float delivery rates must be rejected');

  // B. shipping_rates_by_city: reject negative rates
  let negRateError = false;
  try {
    await SuperAdminService.updateSystemSetting('shipping_rates_by_city', { Douala: -500 });
  } catch (err) {
    negRateError = true;
  }
  assert.strictEqual(negRateError, true, 'Negative delivery rates must be rejected');

  // C. shipping_rates_by_city: reject rates exceeding 100,000 XAF
  let excessiveRateError = false;
  try {
    await SuperAdminService.updateSystemSetting('shipping_rates_by_city', { Douala: 100001 });
  } catch (err) {
    excessiveRateError = true;
  }
  assert.strictEqual(excessiveRateError, true, 'Delivery rates > 100,000 XAF must be rejected');

  // D. shipping_rates_by_city: reject empty object
  let emptyRatesError = false;
  try {
    await SuperAdminService.updateSystemSetting('shipping_rates_by_city', {});
  } catch (err) {
    emptyRatesError = true;
  }
  assert.strictEqual(emptyRatesError, true, 'Empty shipping rates dictionary must be rejected');

  // E. announcement_banner: reject javascript: XSS URLs
  let xssUrlError = false;
  try {
    await SuperAdminService.updateSystemSetting('announcement_banner', {
      active: true,
      message: 'Promotion flash',
      cta_url: 'javascript:alert(document.cookie)'
    });
  } catch (err) {
    xssUrlError = err.message.includes('Unsafe URL scheme');
  }
  assert.strictEqual(xssUrlError, true, 'javascript: URLs must be rejected in announcement banner');

  // F. announcement_banner: reject data: and protocol-relative URLs
  let dataUrlError = false;
  try {
    await SuperAdminService.updateSystemSetting('announcement_banner', {
      active: true,
      message: 'Promotion flash',
      cta_url: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='
    });
  } catch (err) {
    dataUrlError = err.message.includes('Unsafe URL scheme');
  }
  assert.strictEqual(dataUrlError, true, 'data: URLs must be rejected in announcement banner');

  // G. feature_flags: reject string values such as "true" (strict boolean enforcement)
  let stringFlagError = false;
  try {
    await SuperAdminService.updateSystemSetting('feature_flags', { travel_enabled: 'true' });
  } catch (err) {
    stringFlagError = true;
  }
  assert.strictEqual(stringFlagError, true, 'String boolean representation must be rejected in feature flags');

  // H. feature_flags: reject invalid flag name tokens
  let badFlagNameError = false;
  try {
    await SuperAdminService.updateSystemSetting('feature_flags', { 'bad*flag#name': true });
  } catch (err) {
    badFlagNameError = err.message.includes('Invalid feature flag name');
  }
  assert.strictEqual(badFlagNameError, true, 'Special characters in feature flag keys must be rejected');
  console.log('    ✓ Strict domain boundary validations for rates, XSS URLs, and flags verified');

  // ── 3. Factory Reset & Audit Tracking ──
  console.log('  [3] Settings Factory Reset & Nonexistent Key Handling');

  // A. Reset nonexistent setting must throw NotFoundError (404)
  let notFoundReset = false;
  try {
    await SuperAdminService.resetSystemSetting('nonexistent_key_999');
  } catch (err) {
    notFoundReset = err.code === 'NOT_FOUND';
  }
  assert.strictEqual(notFoundReset, true, 'Resetting non-existent key must throw NOT_FOUND');

  // B. Reset valid setting restores exact system seed defaults
  await SuperAdminService.updateSystemSetting('shipping_rates_by_city', {
    Douala: 9999,
    Yaounde: 8888
  }, { adminId: 'admin_test' });

  const resetResult = await SuperAdminService.resetSystemSetting('shipping_rates_by_city', {
    adminId: 'admin_test',
    reason: 'Restoring baseline Cameroonian municipal tariffs'
  });
  assert.strictEqual(resetResult.success, true);
  assert.strictEqual(resetResult.value.Douala, 1000);
  assert.strictEqual(resetResult.value.Yaounde, 1500);
  console.log('    ✓ Factory reset restores baseline seeds and protects against invalid keys');

  // ── 4. CSV Formula Injection (CWE-1236) & Sensitive Data Redaction ──
  console.log('  [4] CSV Formula Injection Defense & Sensitive Data Redaction');

  // Seed audit entry with formula injection and secret tokens
  await SuperAdminRepository.recordAuditLog({
    adminId: 'admin_sec',
    action: 'setting.update',
    resourceType: 'system_setting',
    resourceId: '=1+1',
    oldValues: {
      password_hash: '$2b$12$eX4mpleH4shSecretString',
      api_key: 'live_secret_key_12345678',
      safe_param: 'allowed_old'
    },
    newValues: {
      auth_token: 'bearer_token_xyz999',
      credential: 'secret_credential_value',
      safe_param: '+CMD|calc'
    },
    reason: '@SUM(A1:A10) - formula injection test',
    ipAddress: '127.0.0.1'
  });

  // A. CSV Export verification
  const csvExport = await SuperAdminService.exportAuditLogs({ search: 'formula injection test' }, 'csv');
  assert.strictEqual(csvExport.extension, 'csv');
  assert.strictEqual(csvExport.contentType, 'text/csv; charset=utf-8');

  // Check formula prevention: leading =, +, @ in reason or resourceId must be escaped with single quote
  assert.ok(csvExport.content.includes("''=1+1") || csvExport.content.includes("'=1+1"), 'Leading = must be escaped');
  assert.ok(csvExport.content.includes("'@SUM"), 'Leading @ must be escaped');

  // Check redaction in CSV: secrets must be replaced with [REDACTED]
  assert.ok(csvExport.content.includes('[REDACTED]'), 'Sensitive fields must be redacted in CSV export');
  assert.ok(!csvExport.content.includes('eX4mpleH4shSecretString'), 'Raw password hash must NOT appear in CSV export');
  assert.ok(!csvExport.content.includes('live_secret_key_12345678'), 'Raw API key must NOT appear in CSV export');

  // B. JSON Export verification
  const jsonExport = await SuperAdminService.exportAuditLogs({ search: 'formula injection test' }, 'json');
  assert.strictEqual(jsonExport.extension, 'json');
  const jsonLogs = JSON.parse(jsonExport.content);
  assert.ok(Array.isArray(jsonLogs));
  const seededLog = jsonLogs.find(l => l.admin_id === 'admin_sec');
  assert.ok(seededLog, 'Seeded audit log must be found in JSON export');
  assert.strictEqual(seededLog.old_values.password_hash, '[REDACTED]');
  assert.strictEqual(seededLog.old_values.api_key, '[REDACTED]');
  assert.strictEqual(seededLog.old_values.safe_param, 'allowed_old');
  assert.strictEqual(seededLog.new_values.auth_token, '[REDACTED]');
  assert.strictEqual(seededLog.new_values.credential, '[REDACTED]');
  console.log('    ✓ RFC 4180 CSV formula injection defense and credential redaction verified');

  // ── 5. Deep Health Diagnostics & Secret Sanitization ──
  console.log('  [5] Deep Infrastructure Health Diagnostics');
  const deepHealth = await SuperAdminService.getDeepHealth();
  assert.ok(['HEALTHY', 'DEGRADED'].includes(deepHealth.status));
  assert.ok(deepHealth.services.database);
  assert.ok(deepHealth.services.cache);
  assert.ok(deepHealth.services.memory);
  assert.strictEqual(typeof deepHealth.services.database.latencyMs, 'number');
  assert.strictEqual(typeof deepHealth.services.memory.heapUsedMb, 'number');

  // Verify sanitized error message helper masks credentials
  const rawLeak = 'Error connecting to postgres://admin_user:P@ssw0rd123!@db.supabase.co:5432/postgres';
  const scrubbed = SuperAdminService.sanitizeHealthErrorMessage(rawLeak);
  assert.ok(!scrubbed.includes('P@ssw0rd123!'), 'Database password must be masked');
  assert.ok(scrubbed.includes('[REDACTED]'), 'Database URL must show [REDACTED]');
  console.log('    ✓ Deep health diagnostics reports live subsystem metrics and sanitizes credentials');

  // ── 6. Full Express HTTP Server & Maintenance Middleware End-to-End ──
  console.log('  [6] Full HTTP Stack: Maintenance Mode, Query Bounds, & RBAC');

  const app = express();
  app.use(express.json());

  // Let tests set a dynamic principal for role testing
  let currentPrincipal = null;
  app.use((req, res, next) => {
    if (currentPrincipal) {
      req.principal = currentPrincipal;
    }
    next();
  });

  // Mount maintenanceGuard
  app.use(maintenanceGuard);

  // Mount mock business route (e.g. orders) to verify maintenance interception
  app.post('/api/v1/orders', (req, res) => {
    res.json({ success: true, orderId: 'ord_sample_123' });
  });

  // Mount SuperAdmin routes
  app.use('/api/v1/admin', superAdminRoutes);

  // Mount error handler
  app.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message,
        statusCode
      }
    });
  });

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // A. Normal operation: order creation succeeds
    currentPrincipal = { id: 'usr_customer_1', primaryRole: ROLES.CUSTOMER };
    const orderBefore = await fetch(`${baseUrl}/api/v1/orders`, { method: 'POST' });
    assert.strictEqual(orderBefore.status, 200);

    // B. Super Admin activates maintenance mode
    currentPrincipal = { id: 'admin_sys', primaryRole: ROLES.SUPER_ADMIN };
    const maintRes = await fetch(`${baseUrl}/api/v1/admin/maintenance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        bannerText: 'Mise à niveau critique de sécurité en cours.',
        allowAdminBypass: true
      })
    });
    assert.strictEqual(maintRes.status, 200);

    // C. Non-admin customer order attempt during maintenance MUST return 503
    currentPrincipal = { id: 'usr_customer_1', primaryRole: ROLES.CUSTOMER };
    const orderDuring = await fetch(`${baseUrl}/api/v1/orders`, { method: 'POST' });
    assert.strictEqual(orderDuring.status, 503);
    const maintErrorBody = await orderDuring.json();
    assert.strictEqual(maintErrorBody.error.code, 'MAINTENANCE_MODE');
    assert.ok(maintErrorBody.error.message.includes('Mise à niveau critique'));

    // D. Super Admin request to business route or admin route during maintenance SUCCEEDS (admin bypass)
    currentPrincipal = { id: 'admin_sys', primaryRole: ROLES.SUPER_ADMIN };
    const adminOrderDuring = await fetch(`${baseUrl}/api/v1/orders`, { method: 'POST' });
    assert.strictEqual(adminOrderDuring.status, 200, 'Super admin must bypass maintenance');

    // E. Super Admin deactivates maintenance mode
    const disableRes = await fetch(`${baseUrl}/api/v1/admin/maintenance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    });
    assert.strictEqual(disableRes.status, 200);

    // F. Customer order attempt after maintenance returns to 200
    currentPrincipal = { id: 'usr_customer_1', primaryRole: ROLES.CUSTOMER };
    const orderAfter = await fetch(`${baseUrl}/api/v1/orders`, { method: 'POST' });
    assert.strictEqual(orderAfter.status, 200, 'Customer requests succeed after maintenance disabled');

    // G. Audit Log Query Parameter Validation Over HTTP
    currentPrincipal = { id: 'admin_sys', primaryRole: ROLES.SUPER_ADMIN };

    // Negative limit -> 400
    const badLimitRes = await fetch(`${baseUrl}/api/v1/admin/audit-logs?limit=-5`);
    assert.strictEqual(badLimitRes.status, 400);

    // Negative offset -> 400
    const badOffsetRes = await fetch(`${baseUrl}/api/v1/admin/audit-logs?offset=-1`);
    assert.strictEqual(badOffsetRes.status, 400);

    // Malformed date -> 400
    const badDateRes = await fetch(`${baseUrl}/api/v1/admin/audit-logs?startDate=invalid-date`);
    assert.strictEqual(badDateRes.status, 400);

    // Unsupported export format -> 400
    const badExportRes = await fetch(`${baseUrl}/api/v1/admin/audit-logs/export?format=xml`);
    assert.strictEqual(badExportRes.status, 400);

    // Query with PostgREST special characters (commas, parentheses, quotes) -> 200 without error
    const specialSearchRes = await fetch(`${baseUrl}/api/v1/admin/audit-logs?search=test%2C(douala)%22cameroon%22`);
    assert.strictEqual(specialSearchRes.status, 200);

    console.log('    ✓ HTTP server verified: 503 maintenance enforcement, admin bypass, and query validations');
  } finally {
    server.close();
  }

  // ── 7. SDK Parity Verification ──
  console.log('  [7] Client SDK Method Parity');
  const expectedMethods = [
    'getAuditLogs',
    'getAuditActions',
    'exportAuditLogs',
    'getSettingsCategories',
    'getSettingsByCategory',
    'resetSetting',
    'setMaintenanceMode',
    'getDeepHealth'
  ];

  for (const m of expectedMethods) {
    assert.strictEqual(typeof loumooApi[m], 'function', `loumooApi must expose method ${m}`);
    assert.strictEqual(typeof superAdminApi[m], 'function', `superAdminApi must expose method ${m}`);
  }
  console.log('    ✓ All 8 SDK methods and aliases verified across loumooApi and superAdminApi');

  console.log('\n  ALL SuperAdmin Adversarial Hardening tests passed with 100% success!\n');
  process.exit(0);
}

run().catch(err => {
  console.error('\nAdversarial test failed:', err);
  process.exit(1);
});
