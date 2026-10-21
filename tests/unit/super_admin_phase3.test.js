/**
 * Unit Test: SuperAdmin Phase 3 (Browser Client SDK Layer - LoumooApiClient)
 * ---------------------------------------------------------------------------
 * Validates:
 *   1. All requested administrative methods on LoumooApiClient prototype.
 *   2. getAdminOverview()
 *   3. getAdminStores(filter) & updateAdminStore(id, updates)
 *   4. getAdminListings(filter) & moderateListing(id, action)
 *   5. getAdminUsers(filter), updateAdminUserRole(id, role), updateAdminUserKyc(id, status)
 *   6. getAdminOrders(filter), resolveAdminEscrow(id, action)
 *   7. getSystemSettings(), updateSystemSettings(payload)
 *   8. getAdminAuditLogs(filter)
 *   9. Full end-to-end HTTP integration through harness with envelope unwrapping.
 */

require('../setup');
const assert = require('assert');
const harness = require('../helpers/harness');
const api = require('../../src/services/loumooApi');

async function run() {
  console.log('  Testing SuperAdmin Phase 3: Browser Client SDK Layer (LoumooApiClient)...');

  // ── 1. Prototype & Method Existence ──
  const methods = [
    'getAdminOverview',
    'getAdminStores',
    'updateAdminStore',
    'getAdminListings',
    'moderateListing',
    'getAdminUsers',
    'updateAdminUserRole',
    'updateAdminUserKyc',
    'getAdminOrders',
    'resolveAdminEscrow',
    'getSystemSettings',
    'updateSystemSettings',
    'getAdminAuditLogs'
  ];

  for (const m of methods) {
    assert.strictEqual(typeof api[m], 'function', `LoumooApiClient must implement [${m}]`);
  }
  console.log('    ✓ 1. All 13 requested admin methods are implemented on LoumooApiClient prototype');

  // ── 2. Boot Harness & Configure Client ──
  const serverUrl = await harness.start();
  api.setBaseUrl(serverUrl);
  api.setAuthToken(harness.superAdminToken());

  // ── 3. getAdminOverview() ──
  const overview = await api.getAdminOverview();
  assert.ok(overview, 'getAdminOverview must return metrics payload');
  assert.ok(overview.kpis && overview.kpis.activeStores !== undefined, 'Overview metrics must contain kpis summary');
  console.log('    ✓ 2. getAdminOverview() successfully retrieved operational metrics');

  // ── 4. getAdminStores(filter) & updateAdminStore(id, updates) ──
  const storesRes = await api.getAdminStores({ limit: 10 });
  const stores = storesRes.stores || storesRes;
  assert.ok(Array.isArray(stores) && stores.length > 0, 'getAdminStores must return stores list');

  const storeToUpdate = stores[0];
  const updatedStoreRes = await api.updateAdminStore(storeToUpdate.id, {
    phone_number: '237699112244',
    city: 'Douala-Akwa'
  });
  const updatedStore = updatedStoreRes.store || updatedStoreRes;
  assert.strictEqual(updatedStore.phone_number, '237699112244');
  assert.strictEqual(updatedStore.city, 'Douala-Akwa');
  console.log('    ✓ 3. getAdminStores() and updateAdminStore() verified');

  // ── 5. getAdminListings(filter) & moderateListing(id, action) ──
  const listingsRes = await api.getAdminListings({ limit: 10 });
  const listings = listingsRes.listings || listingsRes;
  assert.ok(Array.isArray(listings) && listings.length > 0, 'getAdminListings must return listings array');

  const listingToModerate = listings[0];
  // Moderate listing with string action
  const modRes1 = await api.moderateListing(listingToModerate.id, 'APPROVED');
  const modListing1 = modRes1.listing || modRes1;
  assert.strictEqual(modListing1.status, 'PUBLISHED', 'approving publishes the listing');

  // Moderate listing with structured object
  const modRes2 = await api.moderateListing(listingToModerate.id, {
    action: 'SUSPENDED',
    reason: 'Price anomaly investigation'
  });
  const modListing2 = modRes2.listing || modRes2;
  assert.strictEqual(modListing2.status, 'PAUSED', 'suspending pauses it');
  assert.ok(!('is_approved' in modListing2), 'no is_approved flag (a listing has no such column)');
  console.log('    ✓ 4. getAdminListings() and moderateListing() verified (string and object actions)');

  // ── 6. getAdminUsers(filter), updateAdminUserRole(id, role), updateAdminUserKyc(id, status) ──
  const usersRes = await api.getAdminUsers({ limit: 10 });
  const users = usersRes.users || usersRes;
  assert.ok(Array.isArray(users) && users.length > 0, 'getAdminUsers must return users array');

  const targetUser = users.find(u => u.id === 'usr_buyer_1') || users[0];

  // Role elevation
  const roleRes = await api.updateAdminUserRole(targetUser.id, 'moderator');
  const userWithRole = roleRes.user || roleRes;
  assert.strictEqual(userWithRole.primary_role, 'moderator');

  // KYC verification
  const kycRes = await api.updateAdminUserKyc(targetUser.id, 'verified');
  const userWithKyc = kycRes.user || kycRes;
  assert.strictEqual(userWithKyc.kyc_status, 'verified');
  console.log('    ✓ 5. getAdminUsers(), updateAdminUserRole(), and updateAdminUserKyc() verified');

  // ── 7. getAdminOrders(filter) & resolveAdminEscrow(id, action) ──
  const ordersRes = await api.getAdminOrders({ limit: 10 });
  const orders = ordersRes.orders || ordersRes;
  assert.ok(Array.isArray(orders) && orders.length > 0, 'getAdminOrders must return orders array');

  const targetOrder = orders[0];
  // Resolve escrow with action 'RELEASE'
  const escrowRes = await api.resolveAdminEscrow(targetOrder.id, 'RELEASE');
  const resolvedOrder = escrowRes.order || escrowRes;
  assert.strictEqual(resolvedOrder.escrow_status, 'RELEASED');
  assert.strictEqual(resolvedOrder.status, 'COMPLETED');
  console.log('    ✓ 6. getAdminOrders() and resolveAdminEscrow() verified');

  // ── 8. getSystemSettings() & updateSystemSettings(payload) ──
  const settingsRes = await api.getSystemSettings();
  const settings = settingsRes.settings || settingsRes;
  assert.ok(settings && settings.platform_commission_rate, 'getSystemSettings must return dynamic settings');

  // Update dynamic settings via SDK
  const updatedSettingsRes = await api.updateSystemSettings({
    platform_commission_rate: {
      rate_percent: 6.5,
      category_rates: { electronics: 6.5, fashion: 8.0 }
    }
  });
  assert.ok(updatedSettingsRes, 'updateSystemSettings must acknowledge update');

  // Re-fetch to ensure zero-code runtime persistence
  const verifySettingsRes = await api.getSystemSettings();
  const verifiedSettings = verifySettingsRes.settings || verifySettingsRes;
  assert.strictEqual(verifiedSettings.platform_commission_rate.rate_percent, 6.5);
  console.log('    ✓ 7. getSystemSettings() and updateSystemSettings() verified with persistence');

  // ── 9. getAdminAuditLogs(filter) ──
  const auditRes = await api.getAdminAuditLogs({ limit: 20 });
  const logs = auditRes.logs || auditRes;
  assert.ok(Array.isArray(logs) && logs.length > 0, 'getAdminAuditLogs must return audit records');

  // Ensure our recent actions are in the audit trail
  const hasListingAudit = logs.some(l => l.resource_type === 'listing' || (l.action && l.action.startsWith('listing.')));
  const hasUserAudit = logs.some(l => l.resource_type === 'user' || (l.action && l.action.startsWith('user.')));
  const hasEscrowAudit = logs.some(l => l.resource_type === 'order' || (l.action && l.action.startsWith('escrow.')));
  const hasSettingAudit = logs.some(l => l.resource_type === 'system_setting' || (l.action && l.action.startsWith('setting.')));

  assert.ok(hasListingAudit, 'Audit log must record listing moderation');
  assert.ok(hasUserAudit, 'Audit log must record user role/kyc changes');
  assert.ok(hasEscrowAudit, 'Audit log must record escrow arbitration');
  assert.ok(hasSettingAudit, 'Audit log must record setting modifications');
  console.log(`    ✓ 8. getAdminAuditLogs() verified (${logs.length} immutable tamper-evident records inspected)`);

  console.log('  All SuperAdmin Phase 3 tests passed successfully!');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
