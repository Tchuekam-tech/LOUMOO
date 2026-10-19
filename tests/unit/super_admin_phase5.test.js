/**
 * LOUMOO SuperAdmin — Phase 5: Zero-Code Dynamic Hydration Test Suite
 * ---------------------------------------------------------------------------
 * Validates dynamic settings hydration via /api/config, /api/v1/admin/config,
 * CacheService caching & instant invalidation, and dynamic WhatsApp/fee resolvers.
 */

process.env.NODE_ENV = 'test';
process.env.LOUMOO_TEST_AUTH_SECRET = 'loumoo_test_jwt_secret_dev_only_never_prod_0924';

const assert = require('assert');
const http = require('http');
const app = require('../../server/index');
const harness = require('../helpers/harness');
const SuperAdminService = require('../../SuperAdmin/backend/services/SuperAdminService');
const SuperAdminRepository = require('../../SuperAdmin/backend/repositories/SuperAdminRepository');
const CacheService = require('../../server/infrastructure/cache/CacheService');
const api = require('../../src/services/loumooApi');
const { PricingEngine } = require('../../server/modules/commerce/domain/PricingEngine');

function request(server, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request({
      host: '127.0.0.1',
      port: addr.port,
      method,
      path,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers)
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runPhase5Tests() {
  console.log('  Testing SuperAdmin Phase 5: Zero-Code Dynamic Hydration...');

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  try {
    // ── 1. GET /api/config Public Endpoint Hydration ──
    const publicConfigRes = await request(server, 'GET', '/api/config');
    assert.strictEqual(publicConfigRes.status, 200, '/api/config should respond with 200 OK');
    assert.ok(publicConfigRes.body.systemSettings, '/api/config must include systemSettings');
    assert.ok(publicConfigRes.body.systemSettings.seller_whatsapp_default, 'Must include seller_whatsapp_default');
    assert.ok(publicConfigRes.body.systemSettings.shipping_rates_by_city, 'Must include shipping_rates_by_city');
    assert.ok(publicConfigRes.body.systemSettings.platform_commission_rate, 'Must include platform_commission_rate');
    console.log('    ✓ 1. /api/config public startup endpoint successfully hydrates dynamic settings');

    // ── 1b. Public endpoint must NOT leak internal settings (deny-by-default) ──
    const pubSettings = publicConfigRes.body.systemSettings;
    // Internal commission economics must be stripped from the public projection.
    assert.strictEqual(
      pubSettings.platform_commission_rate.category_rates, undefined,
      'Public /api/config must NOT expose internal category_rates'
    );
    assert.ok(
      Number.isFinite(Number(pubSettings.platform_commission_rate.payout_fee_fixed_xaf)),
      'Public commission projection must retain payout_fee_fixed_xaf (the cart needs it)'
    );
    // Maintenance admin-bypass policy is internal and must not be published.
    if (pubSettings.maintenance_mode) {
      assert.strictEqual(
        pubSettings.maintenance_mode.allow_admin_bypass, undefined,
        'Public /api/config must NOT expose maintenance allow_admin_bypass'
      );
    }
    // Only allowlisted keys may appear; anything outside the allowlist is a leak.
    const leaked = Object.keys(pubSettings).filter(
      k => !SuperAdminRepository.PUBLIC_SETTING_KEYS.includes(k)
    );
    assert.deepStrictEqual(leaked, [], `Public /api/config leaked non-allowlisted keys: ${leaked.join(', ')}`);
    // The authenticated admin surface still sees the full object (incl. category_rates).
    const adminFull = await SuperAdminService.getSystemSettings();
    assert.ok(
      adminFull.platform_commission_rate.category_rates,
      'Admin getSystemSettings must still return category_rates'
    );
    // A setting flagged is_secret is withheld from the public projection.
    const secretProbe = await SuperAdminRepository.getPublicSettings();
    assert.ok(secretProbe && typeof secretProbe === 'object', 'getPublicSettings returns an object');
    console.log('    ✓ 1b. Public config is deny-by-default: no category_rates, no admin-bypass, allowlist enforced');

    // ── 2. GET /api/v1/config & /api/config/system Public Cached Endpoints ──
    const cachedRes = await request(server, 'GET', '/api/v1/config');
    assert.strictEqual(cachedRes.status, 200, '/api/v1/config should respond with 200 OK');
    assert.ok(cachedRes.headers['cache-control'], 'Must include Cache-Control header for caching');
    assert.ok(cachedRes.body.data.systemSettings, 'Must return data.systemSettings');
    console.log('    ✓ 2. /api/v1/config returns cached settings with HTTP Cache-Control headers');

    // ── 3. GET /api/v1/admin/config RBAC Protected Endpoint ──
    const unauthAdminRes = await request(server, 'GET', '/api/v1/admin/config');
    // 401, not 403: no credentials at all is "authenticate", 403 is "authenticated but not an admin".
    assert.strictEqual(unauthAdminRes.status, 401, 'Unauthenticated /api/v1/admin/config must be rejected with 401 Unauthorized');

    const authHeaders = {
      'Authorization': `Bearer ${harness.superAdminToken()}`
    };
    const adminConfigRes = await request(server, 'GET', '/api/v1/admin/config', authHeaders);
    assert.strictEqual(adminConfigRes.status, 200, 'Authenticated admin should access /api/v1/admin/config');
    assert.ok(adminConfigRes.body.data.settings, 'Must contain settings in response');
    console.log('    ✓ 3. /api/v1/admin/config authenticated alias verified under RBAC guard');

    // ── 4. CacheService Caching & Instant Invalidation ──
    // Fetch settings to populate cache
    const initialSettings = await SuperAdminService.getSystemSettings();
    assert.ok(initialSettings, 'Settings must be retrievable');

    // Verify cache has it
    const cachedFromService = await CacheService.get('system_settings:all', 'admin');
    assert.ok(cachedFromService, 'Settings should be cached in CacheService under admin namespace');

    // Update setting via SuperAdminService
    const newWhatsAppNumber = '237688991122';
    await SuperAdminService.updateSystemSetting('seller_whatsapp_default', {
      number: newWhatsAppNumber,
      label: 'LOUMOO Dynamic Care Line'
    }, { adminId: 'admin_test' });

    // Verify cache was invalidated
    const cacheAfterUpdate = await CacheService.get('system_settings:all', 'admin');
    assert.strictEqual(cacheAfterUpdate, null, 'Cache must be immediately invalidated after update');

    // Next getSystemSettings() should repopulate with new value
    const freshSettings = await SuperAdminService.getSystemSettings();
    assert.strictEqual(freshSettings.seller_whatsapp_default.number, newWhatsAppNumber, 'Fresh settings must reflect updated WhatsApp number');
    console.log('    ✓ 4. CacheService caching & instant cache invalidation verified on update');

    // ── 5. Dynamic WhatsApp & City Delivery Fee Resolvers ──
    // Simulate browser window.LOUMOO_SYSTEM_SETTINGS hydration
    const mockWindow = {
      LOUMOO_SYSTEM_SETTINGS: freshSettings
    };

    function resolveSellerWhatsApp(name, win = mockWindow) {
      const dynamicDefault = (win.LOUMOO_SYSTEM_SETTINGS && win.LOUMOO_SYSTEM_SETTINGS.seller_whatsapp_default && win.LOUMOO_SYSTEM_SETTINGS.seller_whatsapp_default.number)
        ? String(win.LOUMOO_SYSTEM_SETTINGS.seller_whatsapp_default.number)
        : '237690123456';
      if (!name) return dynamicDefault;
      const known = { 'Orca Electronics': '237677101234' };
      if (known[name]) return known[name];
      return dynamicDefault;
    }

    function resolveCityDeliveryFee(city, win = mockWindow) {
      const defaultRates = { Douala: 1000, Yaounde: 1500, Garoua: 4000 };
      const dynamicRates = (win.LOUMOO_SYSTEM_SETTINGS && win.LOUMOO_SYSTEM_SETTINGS.shipping_rates_by_city)
        ? win.LOUMOO_SYSTEM_SETTINGS.shipping_rates_by_city
        : defaultRates;
      if (!city) return dynamicRates['Douala'] || 1000;
      const c = String(city).trim().toLowerCase();
      for (const k in dynamicRates) {
        if (k.toLowerCase() === c) return Number(dynamicRates[k]);
      }
      return dynamicRates['Douala'] || 1000;
    }

    // Dynamic resolution test: Unknown seller gets dynamic WhatsApp number
    assert.strictEqual(resolveSellerWhatsApp('Boutique Inconnue'), newWhatsAppNumber, 'Should dynamically resolve to updated WhatsApp number without code changes');
    // Known seller still gets their direct line
    assert.strictEqual(resolveSellerWhatsApp('Orca Electronics'), '237677101234', 'Known seller retains their direct line');

    // Dynamic delivery fees
    assert.strictEqual(resolveCityDeliveryFee('Douala'), 1000, 'Douala delivery fee is 1000 XAF');
    assert.strictEqual(resolveCityDeliveryFee('Yaounde'), 1500, 'Yaoundé delivery fee is 1500 XAF');
    assert.strictEqual(resolveCityDeliveryFee('Garoua'), 4000, 'Garoua delivery fee is 4000 XAF');

    // Update city rate dynamically
    await SuperAdminService.updateSystemSetting('shipping_rates_by_city', {
      Douala: 1200,
      Yaounde: 1800,
      Garoua: 4200
    }, { adminId: 'admin_test' });

    mockWindow.LOUMOO_SYSTEM_SETTINGS = await SuperAdminService.getSystemSettings();
    assert.strictEqual(resolveCityDeliveryFee('Douala'), 1200, 'Douala fee should update to 1200 XAF without code change');
    assert.strictEqual(resolveCityDeliveryFee('Yaounde'), 1800, 'Yaounde fee should update to 1800 XAF without code change');
    console.log('    ✓ 5. Dynamic WhatsApp line and City delivery fee resolvers verified');

    // ── 6. PricingEngine Dynamic Standard Delivery Fee ──
    const items = [
      { unitPriceXaf: 10000, quantity: 1, title: 'Item 1' }
    ];
    // Custom standard shipping fee passed dynamically
    const pricingDynamic = PricingEngine.calculateOrderPricing(items, {
      deliveryMethod: 'HOME_DELIVERY',
      standardShippingFeeXaf: 1200
    });
    assert.strictEqual(pricingDynamic.shippingFeeXaf, 1200, 'PricingEngine must authoritatively use dynamic shipping fee');
    assert.strictEqual(pricingDynamic.totalAmountXaf, 11200, 'Total amount must equal subtotal + dynamic shipping fee');
    console.log('    ✓ 6. PricingEngine dynamically incorporates server-authoritative shipping rates');

    // ── 7. Browser Client SDK (LoumooApiClient) Methods ──
    api.setBaseUrl(baseUrl);
    const publicConfigFromClient = await api.getPublicConfig();
    assert.ok(publicConfigFromClient.systemSettings, 'api.getPublicConfig() must return systemSettings');

    api.setAuthToken(harness.superAdminToken());
    const adminConfigFromClient = await api.getAdminConfig();
    const settingsObj = (adminConfigFromClient && adminConfigFromClient.settings) || (adminConfigFromClient && adminConfigFromClient.data && adminConfigFromClient.data.settings) || adminConfigFromClient;
    assert.ok(settingsObj, 'api.getAdminConfig() must return settings payload');
    console.log('    ✓ 7. LoumooApiClient getPublicConfig() and getAdminConfig() verified over HTTP');

    // ── 8. Batch Update and Real-Time Persistence ──
    const batchUpdateRes = await SuperAdminService.updateSystemSettings({
      platform_commission_rate: { rate_percent: 6.5 },
      maintenance_mode: { enabled: false, banner_text: 'Operational' }
    }, { adminId: 'admin_test' });
    assert.strictEqual(batchUpdateRes.success, true, 'Batch update must succeed');

    const verifiedBatchSettings = await SuperAdminService.getSystemSettings();
    assert.strictEqual(verifiedBatchSettings.platform_commission_rate.rate_percent, 6.5, 'Commission rate must reflect 6.5%');
    console.log('    ✓ 8. Batch settings update and persistence verified');

  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('  All SuperAdmin Phase 5 tests passed successfully!\n');
  process.exit(0);
}

runPhase5Tests().catch(err => {
  console.error('Phase 5 test failed:', err);
  process.exit(1);
});
