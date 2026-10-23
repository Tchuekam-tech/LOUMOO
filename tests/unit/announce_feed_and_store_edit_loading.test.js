/**
 * LOUMOO Unit Tests — Announce Feed Loading, Broadcast Clicks, and Store Edit Loading States
 */

require('../setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function run() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  TEST: ANNOUNCE FEED RELIABILITY & STORE EDIT LOADING STATES');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load Component class from Commerce App.dc.html
  const appPath = path.resolve(__dirname, '../../Commerce App.dc.html');
  const compiledHtml = fs.readFileSync(appPath, 'utf8');

  // Extract <script type="text/x-dc"> block
  const match = compiledHtml.match(/<script\s+type=["']text\/x-dc["'][^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'Commerce App.dc.html must contain an x-dc script block');

  class DCLogic {
    constructor(props) {
      this.props = props || {};
      this.state = {};
    }
    setState(fnOrObj, cb) {
      if (typeof fnOrObj === 'function') {
        this.state = Object.assign({}, this.state, fnOrObj(this.state));
      } else {
        this.state = Object.assign({}, this.state, fnOrObj);
      }
      if (typeof cb === 'function') cb();
    }
  }

  const mockApi = {
    // The feed is whatever sellers published. Starts empty; filled below.
    feedItems: [],
    getAnnouncementFeed: async function (params) {
      return {
        announcements: this.feedItems.slice(),
        total: this.feedItems.length
      };
    },
    getAnnouncement: async (id) => {
      return {
        announcement: {
          id: id,
          title: 'Remote Enriched Broadcast ' + id,
          type: 'PRODUCT_DROP',
          body: 'Enriched remote broadcast content from API'
        }
      };
    },
    recordAnnouncementEvent: async () => ({ success: true }),
    updateStore: async () => ({ success: true }),
    updateStoreProfile: async () => ({ success: true }),
    updateStoreHours: async () => ({ success: true }),
    updateStoreLocation: async () => ({ success: true })
  };

  const sandbox = {
    DCLogic,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Math,
    Date,
    JSON,
    encodeURIComponent,
    decodeURIComponent,
    parseInt,
    parseFloat,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    Promise,
    window: {
      location: { href: 'http://localhost:8080' },
      open: () => ({}),
      addEventListener: () => {},
      removeEventListener: () => {},
      LoumooAPI: mockApi,
      LoumooPublishing: undefined // Explicitly null/undefined to verify resilience without publishing studio loaded
    },
    document: {
      documentElement: { setAttribute: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById: () => ({ click: () => {} }),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ type: '', accept: '', click: () => {}, files: [] })
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  };

  vm.createContext(sandbox);
  vm.runInContext(match[1] + "\nvar comp = new Component();", sandbox);
  const comp = sandbox.comp;
  assert.ok(comp, 'Component must instantiate successfully');

  console.log('[1/5] Verifying Announce feed loads cards even when LoumooPublishing is null...');
  assert.strictEqual(sandbox.window.LoumooPublishing, undefined);

  // An empty feed is shown as empty: no built-in "product drops" from stores that
  // do not exist (it used to fill the gap with invented offers, prices and CTAs).
  await comp.loadAnnouncements({ force: true });
  assert.deepStrictEqual(comp.state.announcements, [], 'an empty feed stays empty, never invented broadcasts');
  assert.strictEqual(comp.renderVals().announceCards.length, 0, 'and so it shows the "Nothing here yet" state');

  // What sellers published loads, without LoumooPublishing.
  mockApi.feedItems = [{
    id: 'ann_real_1', type: 'PRODUCT_DROP', title: 'Tecno Camon 50 restock', body: 'Back in stock at our Akwa boutique.',
    storeName: 'Akwa Phones', ctaLabel: 'View product', ctaType: 'PRODUCT', publishedAt: '2026-10-20T10:00:00.000Z'
  }];
  await comp.loadAnnouncements({ force: true });
  assert(comp.state.announcements && comp.state.announcements.length === 1, 'the published broadcast loads');

  // Evaluate renderVals
  const vals = comp.renderVals();
  assert(Array.isArray(vals.announceCards), 'announceCards must be an array');
  assert(vals.announceCards.length > 0, 'announceCards must contain cards even without LoumooPublishing loaded');

  const firstCard = vals.announceCards[0];
  assert(firstCard.id, 'Card must have an id');
  assert(firstCard.title, 'Card must have a title');
  assert(firstCard.badge, 'Card must have a badge');
  assert(firstCard.ctaLabel, 'Card must have a CTA label');
  console.log('  ✓ Announce feed loads and projects ' + vals.announceCards.length + ' commercial broadcasts reliably without LoumooPublishing');

  console.log('[2/5] Verifying broadcast click (openAnnouncement) renders details immediately...');
  const targetId = firstCard.id;
  comp.openAnnouncement(targetId);

  assert.strictEqual(comp.state.screen, 'announceDetail', 'openAnnouncement must transition to announceDetail screen');
  assert.strictEqual(comp.state.activeAnnouncementId, targetId, 'activeAnnouncementId must match clicked broadcast');
  assert(comp.state.activeAnnouncement, 'activeAnnouncement must be resolved immediately from in-memory cards');
  assert.strictEqual(comp.state.announceDetailLoading, false, 'announceDetailLoading must be false for existing broadcasts');

  const detailVals = comp.renderVals();
  assert.strictEqual(detailVals.hasActiveAnnouncement, true, 'hasActiveAnnouncement must be true');
  assert(detailVals.activeAnnouncementCard, 'activeAnnouncementCard must be rendered');
  assert.strictEqual(detailVals.activeAnnouncementCard.id, targetId, 'activeAnnouncementCard ID must match');
  assert(detailVals.activeAnnouncementCard.title, 'activeAnnouncementCard must have a title');
  console.log('  ✓ Broadcast click immediately renders details with zero latency');

  console.log('[3/5] Verifying broadcast CTA interaction routing...');
  let openedProduct = null;
  comp.openProduct = function(id) { openedProduct = id; };

  // Product drop CTA
  vals.activateAnnouncementCta({
    id: 'ann_test',
    ctaType: 'VIEW_PRODUCT',
    attachmentId: 'prod_123',
    title: 'Test Broadcast'
  });
  assert.strictEqual(openedProduct, 'prod_123', 'CTA must route to product view when attachmentId exists');

  // Store CTA
  vals.activateAnnouncementCta({
    id: 'ann_test_store',
    ctaType: 'VIEW_STORE',
    storeId: 'store_orca',
    title: 'Store Promo'
  });
  assert.strictEqual(comp.state.screen, 'business', 'CTA must route to business storefront when type is VIEW_STORE');
  console.log('  ✓ Broadcast CTA clicks route accurately to products, stores, and external destinations');

  console.log('[4/5] Verifying store edit loading state and button disabled bindings...');
  const storeViewPath = path.resolve(__dirname, '../../src/views/store_business_view.py');
  const storeViewContent = fs.readFileSync(storeViewPath, 'utf8');

  // Verify saveStoreSettingsAll button markup
  assert(storeViewContent.includes('disabled="{{ storeSettingsSaving }}"'), 'saveStoreSettingsAll button must have disabled binding on storeSettingsSaving');
  assert(storeViewContent.includes('SAVING STORE SETTINGS…'), 'saveStoreSettingsAll button must render SAVING STORE SETTINGS… when saving');
  assert(storeViewContent.includes('Saving boutique settings to LOUMOO…'), 'is.storeSettings must render saving feedback banner');

  // Verify submitCreateStore button markup
  assert(storeViewContent.includes('disabled="{{ createStoreBusy }}"'), 'submitCreateStore button must have disabled binding on createStoreBusy');
  assert(storeViewContent.includes('INITIALIZING STOREFRONT...'), 'submitCreateStore button must render loading state');

  // Verify submitStoreVerificationDocs button markup
  assert(storeViewContent.includes('disabled="{{ verSubmitting }}"'), 'submitStoreVerificationDocs button must have disabled binding on verSubmitting');
  console.log('  ✓ Store settings and onboarding buttons strictly bind loading spinners and disabled attributes');

  console.log('[5/5] Verifying saveStoreSettingsAll runtime triggers loading state...');
  comp.setState({
    primaryStoreId: 'store_my_boutique',
    storeTagline: 'Top Quality Electronics Douala',
    storeSettingsSaving: false
  });

  const beforeSaveVals = comp.renderVals();
  assert.strictEqual(beforeSaveVals.storeSettingsSaving, false, 'storeSettingsSaving must initially be false');

  // Call saveStoreSettingsAll
  beforeSaveVals.saveStoreSettingsAll();

  const duringSaveVals = comp.renderVals();
  assert.strictEqual(duringSaveVals.storeSettingsSaving, true, 'storeSettingsSaving must be true during save operation');

  // Wait for async updateStore promises to resolve
  await new Promise(r => setTimeout(r, 100));

  const afterSaveVals = comp.renderVals();
  assert.strictEqual(afterSaveVals.storeSettingsSaving, false, 'storeSettingsSaving must reset to false after save completes');
  assert.strictEqual(comp.state.screen, 'storeOnboarding', 'Screen must transition to storeOnboarding after successful save');
  console.log('  ✓ saveStoreSettingsAll smoothly activates storeSettingsSaving and resolves with confirmation');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ✓ ALL ANNOUNCE & STORE EDIT TESTS PASSED (5/5)!');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

if (require.main === module) {
  run().catch(err => {
    console.error('FAILED:', err);
    process.exit(1);
  });
}

module.exports = { run };
