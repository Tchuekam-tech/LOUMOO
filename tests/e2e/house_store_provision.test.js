/**
 * Provisioning NanoAfrica and nanoDelivery, proven on the REAL schema.
 * ---------------------------------------------------------------------------
 * scripts/provision_nanoafrica.js creates the house store, its agency and the
 * owner's selling rights as rows. This runs it (the CLI as a child process for the
 * first write, the service in-process for the rest) over the repo's real
 * migrations on PGlite, through the unmodified supabase-js client and the
 * PostgREST stand-in, so every foreign key and CHECK constraint is the real one.
 *
 *   1. A dry run writes nothing, and says what it would write.
 *   2. Refusals: no / unverified / ambiguous / unknown owner email, both or neither of
 *      email and id, a missing or wrong --confirm-owner-id, a rider with no phone.
 *   3. Apply creates everything (store, membership, public records, agency, agency
 *      provider, riders, the owner's seller status) and every constraint holds.
 *   4. A second apply changes nothing; what an owner/admin edited since survives.
 *   5. resolve() / resolveDefaultProvider() then return the owner and nanoDelivery, and
 *      the agency can see its rider (the real dispatch lookups).
 *   6. Rows that belong to someone else, or an owner who already holds another provider
 *      record, are blockers that stop --apply.
 */
'use strict';

require('../setup');
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const { createLocalDb, loadPglite } = require('./support/localDb');
const { createMiniPostgrest } = require('./support/miniPostgrest');

const REPO = path.resolve(__dirname, '../..');
const CLI = path.join(REPO, 'scripts', 'provision_nanoafrica.js');

function cliEnv(url, key) {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'NODE_PATH'];
  const env = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  // Explicit and minimal: the child can reach only the stand-in, never a real project.
  return { ...env, LOUMOO_NO_DOTENV: '1', NODE_ENV: 'development', SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key };
}

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: REPO, env });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function run() {
  if (!loadPglite()) {
    if (process.env.CI) throw new Error('@electric-sql/pglite is not installed: run npm ci.');
    console.log('    - house_store_provision: SKIPPED (@electric-sql/pglite is not installed; run npm install)');
    return;
  }

  const { db } = await createLocalDb();
  const rest = createMiniPostgrest({ db, secret: 'house-store-provision-test-secret' });
  await new Promise((r) => rest.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${rest.server.address().port}`;
  const serviceKey = rest.mintKey('service_role');
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, db: { schema: 'iam' } });

  // The delivery repository reaches its database through SupabaseDatabase.getAdmin() at call time.
  const { SupabaseDatabase, SupabaseClient } = require('../../server/infrastructure/database/SupabaseClient');
  const originalAdmin = SupabaseDatabase.getAdmin;
  const originalClientAdmin = SupabaseClient.getAdmin;
  SupabaseDatabase.getAdmin = () => admin;
  SupabaseClient.getAdmin = () => admin;

  const { HouseStoreService } = require('../../server/modules/store/application/HouseStoreService');
  const { HOUSE_STORE_VERIFICATION_TIER } = require('../../server/modules/store/application/HouseStoreProvisioner');
  const { HOUSE_STORE, HOUSE_AGENCY } = require('../../server/modules/store/domain/HouseStore');
  const { getSharedDeliveryService } = require('../../server/modules/delivery/application/DeliveryService');
  const service = new HouseStoreService({ db: admin });
  const env = cliEnv(url, serviceKey);

  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0];
  const count = async (table, where = 'true', params = []) => Number((await one(`SELECT count(*)::int AS n FROM iam.${table} WHERE ${where}`, params)).n);
  const tables = ['stores', 'store_members', 'store_profiles', 'store_settings', 'store_locations', 'store_hours',
    'organizations', 'organization_members', 'delivery_drivers'];
  const snapshot = async () => {
    const out = {};
    for (const t of tables) out[t] = await count(t);
    return out;
  };
  const rejects = async (fn, pattern, label) => {
    let error = null;
    try { await fn(); } catch (e) { error = e; }
    assert.ok(error, `${label}: expected a refusal`);
    assert.ok(pattern.test(error.message), `${label}: got "${error.message}"`);
    return error;
  };

  try {
    // ---- accounts the operator could name ---------------------------------
    await db.query(`
      INSERT INTO iam.profiles (id, clerk_user_id, email, email_verified_at, phone_number, first_name, last_name, city) VALUES
        ('usr_owner',   'c-owner',   'Nano_Owner@Example.com', now(), '+237699111222', 'Ama', 'Owner', 'Douala'),
        ('usr_rider_1', 'c-rider-1', 'rider.one@example.com',  now(), '+237677000001', 'Rik', 'One',   'Douala'),
        ('usr_rider_2', 'c-rider-2', 'rider.two@example.com',  now(), NULL,            'Rin', 'Two',   'Douala'),
        ('usr_rider_3', 'c-rider-3', 'jean.dupont85@example.com', now(), '+237677000003', '', '', 'Douala'),
        ('usr_unverified', 'c-unv',  'unverified@example.com', NULL,  '+237600000003', 'Una', 'Verified', 'Douala'),
        ('usr_twin_a',  'c-twin-a',  'twin@example.com',       now(), '+237600000004', 'Twin', 'A', 'Douala'),
        ('usr_twin_b',  'c-twin-b',  'twin@example.com',       now(), '+237600000005', 'Twin', 'B', 'Douala'),
        ('usr_other',   'c-other',   'other.owner@example.com', now(), '+237600000006', 'Oto', 'Other', 'Douala')`);
    const base = { ownerEmail: 'nano_owner@example.com', phone: '+237699111222' };

    // ---- 2. refusals before anything is written ---------------------------
    const empty = await snapshot();
    await rejects(() => service.provision({}), /exactly one of --owner-email or --owner-id/, 'no owner');
    await rejects(() => service.provision({ ownerEmail: 'a@b.c', ownerId: 'usr_owner' }), /exactly one/, 'both owner flags');
    await rejects(() => service.provision({ ownerEmail: 'nobody@example.com' }), /No account has the email/, 'unknown email');
    await rejects(() => service.provision({ ownerEmail: 'unverified@example.com' }), /not verified/, 'unverified email');
    await rejects(() => service.provision({ ownerEmail: 'twin@example.com' }), /More than one account/, 'ambiguous email');
    await rejects(() => service.provision({ ownerId: 'usr_missing' }), /No account has the id/, 'unknown id');
    await rejects(() => service.provision({ ownerId: 'usr_unverified' }), /no verified email/, 'unverified owner id');
    await rejects(() => service.provision({ ...base, riderEmails: ['unverified@example.com'] }), /not verified/, 'unverified rider');
    await rejects(() => service.provision({ ...base, riderEmails: ['nano_owner@example.com'] }), /agency itself/, 'owner as rider');
    // A LIKE wildcard in the email must not widen the match.
    await rejects(() => service.provision({ ownerEmail: '%@example.com' }), /No account has the email/, 'wildcard email');
    assert.deepStrictEqual(await snapshot(), empty, 'refusals wrote nothing');

    // ---- 1. dry run -------------------------------------------------------
    const dry = await service.provision({ ...base, riderEmails: ['rider.one@example.com'] });
    assert.strictEqual(dry.mode, 'dry-run');
    assert.strictEqual(dry.applied, false);
    // A rider whose profile has no name is not shown to buyers under their e-mail address.
    const nameless = await service.provision({ ...base, riderEmails: ['jean.dupont85@example.com'] });
    const namelessStep = nameless.steps.find((st) => st.table === 'delivery_drivers' && st.key === 'usr_rider_3');
    assert.ok(namelessStep, 'the nameless rider would be registered');
    assert.strictEqual(namelessStep.fields.display_name, 'nanoDelivery rider');
    assert.ok(nameless.warnings.some((w) => /no name on their profile/.test(w)), 'and the operator is told');
    assert.ok(!/jean\.dupont85/.test(JSON.stringify(nameless)), 'the e-mail local part appears nowhere in the report');
    assert.strictEqual(dry.owner.id, 'usr_owner');
    assert.ok(/^Na\*+@Example\.com$/.test(dry.owner.email), `masked, got ${dry.owner.email}`);
    assert.ok(!/nano_owner@/i.test(JSON.stringify(dry)), 'the owner email is only ever shown masked');
    assert.deepStrictEqual(dry.steps.filter((s) => s.action === 'create').map((s) => s.table).sort(), [
      'delivery_drivers', 'delivery_drivers', 'organization_members', 'organization_members', 'organizations',
      'store_hours', 'store_locations', 'store_members', 'store_profiles', 'store_settings', 'stores'
    ].sort());
    assert.ok(dry.steps.some((s) => s.table === 'profiles' && s.action === 'update'), 'it would make the owner able to sell');
    assert.deepStrictEqual(dry.blockers, []);
    assert.deepStrictEqual(await snapshot(), empty, 'a dry run wrote nothing');
    assert.strictEqual((await one(`SELECT seller_status, primary_role FROM iam.profiles WHERE id = 'usr_owner'`)).seller_status, 'NONE');

    // ---- apply needs the second confirmation ------------------------------
    await rejects(() => service.provision({ ...base, apply: true }), /--confirm-owner-id must equal/, 'apply without confirmation');
    await rejects(() => service.provision({ ...base, apply: true, confirmOwnerId: 'usr_other' }), /--confirm-owner-id must equal/, 'apply with the wrong id');
    assert.deepStrictEqual(await snapshot(), empty, 'a refused apply wrote nothing');

    // A rider with no phone number cannot be reached by a customer: a blocker.
    const noPhone = await service.provision({ ...base, riderEmails: ['rider.two@example.com'] });
    assert.ok(noPhone.blockers.some((b) => /no usable phone/.test(b)), 'reported in the dry run');
    await rejects(() => service.provision({ ...base, riderEmails: ['rider.two@example.com'], apply: true, confirmOwnerId: 'usr_owner' }), /must be fixed first/, 'apply with a blocker');
    assert.deepStrictEqual(await snapshot(), empty);

    // ---- 3. apply, through the CLI ----------------------------------------
    const cliArgs = ['--owner-email', 'nano_owner@example.com', '--phone', '+237699111222', '--rider-email', 'rider.one@example.com'];
    const cliDry = await runCli(cliArgs, env);
    assert.strictEqual(cliDry.code, 0, cliDry.stderr);
    assert.ok(/DRY RUN/.test(cliDry.stdout) && /usr_owner/.test(cliDry.stdout) && /--confirm-owner-id usr_owner/.test(cliDry.stdout), 'the CLI shows who matched and how to confirm');
    assert.ok(!/nano_owner@example\.com/i.test(cliDry.stdout), 'and masks the email');
    assert.deepStrictEqual(await snapshot(), empty, 'the CLI dry run wrote nothing');

    const cliBad = await runCli([...cliArgs, '--apply', '--confirm-owner-id', 'usr_other'], env);
    assert.strictEqual(cliBad.code, 1);
    assert.ok(/--confirm-owner-id must equal/.test(cliBad.stderr));
    assert.deepStrictEqual(await snapshot(), empty);

    const cliApply = await runCli([...cliArgs, '--apply', '--confirm-owner-id', 'usr_owner'], env);
    assert.strictEqual(cliApply.code, 0, cliApply.stderr + cliApply.stdout);
    assert.ok(/Applied 12 change\(s\)/.test(cliApply.stdout), cliApply.stdout);

    const store = await one(`SELECT * FROM iam.stores WHERE id = $1`, [HOUSE_STORE.id]);
    assert.strictEqual(store.owner_id, 'usr_owner');
    assert.strictEqual(store.name, 'NanoAfrica');
    assert.strictEqual(store.slug, 'nanoafrica');
    assert.strictEqual(store.status, 'ACTIVE');
    assert.strictEqual(store.visibility, 'PUBLIC');
    assert.strictEqual(store.is_verified, true);
    assert.strictEqual(store.verification_tier, HOUSE_STORE_VERIFICATION_TIER);
    assert.strictEqual(store.seller_type, 'BRAND');
    assert.strictEqual(store.onboarding_completed, true);
    assert.strictEqual(store.onboarding_step, 'ACTIVE');
    assert.strictEqual(store.phone_number, '+237699111222');
    assert.strictEqual(store.email, 'nano_owner@example.com');
    assert.ok(store.product_count > 900, `the product count is the curated count, got ${store.product_count}`);
    assert.deepStrictEqual(await q(`SELECT user_id, role FROM iam.store_members WHERE store_id = $1`, [HOUSE_STORE.id]), [{ user_id: 'usr_owner', role: 'owner' }]);
    assert.strictEqual(await count('store_profiles', 'store_id = $1', [HOUSE_STORE.id]), 1);
    assert.strictEqual(await count('store_hours', 'store_id = $1', [HOUSE_STORE.id]), 1);
    const settings = await one(`SELECT accepts_escrow, accepts_cash_on_delivery FROM iam.store_settings WHERE store_id = $1`, [HOUSE_STORE.id]);
    assert.deepStrictEqual(settings, { accepts_escrow: false, accepts_cash_on_delivery: true }, 'no payment gateway is claimed');
    const loc = await one(`SELECT city, region FROM iam.store_locations WHERE store_id = $1`, [HOUSE_STORE.id]);
    assert.deepStrictEqual(loc, { city: 'Douala', region: 'Littoral' });
    const profile = await one(`SELECT badges FROM iam.store_profiles WHERE store_id = $1`, [HOUSE_STORE.id]);
    assert.deepStrictEqual(profile.badges, [], 'no escrow badge');

    const org = await one(`SELECT * FROM iam.organizations WHERE id = $1`, [HOUSE_AGENCY.organizationId]);
    assert.strictEqual(org.org_type, 'AGENCY');
    assert.strictEqual(org.name, 'nanoDelivery');
    assert.strictEqual(org.owner_id, 'usr_owner');
    assert.deepStrictEqual(
      await q(`SELECT user_id, role, status FROM iam.organization_members WHERE organization_id = $1 ORDER BY user_id`, [org.id]),
      [{ user_id: 'usr_owner', role: 'OWNER', status: 'ACTIVE' }, { user_id: 'usr_rider_1', role: 'MEMBER', status: 'ACTIVE' }]);

    const agency = await one(`SELECT * FROM iam.delivery_drivers WHERE profile_id = 'usr_owner'`);
    assert.strictEqual(agency.display_name, 'nanoDelivery');
    assert.strictEqual(agency.is_agency, true);
    assert.strictEqual(agency.organization_id, HOUSE_AGENCY.organizationId);
    assert.strictEqual(agency.status, 'active');
    assert.strictEqual(agency.base_fee_xaf, null, 'quotes the standard city rate');
    assert.deepStrictEqual(agency.service_areas, []);
    assert.strictEqual(agency.phone, '+237699111222');
    const rider = await one(`SELECT * FROM iam.delivery_drivers WHERE profile_id = 'usr_rider_1'`);
    assert.strictEqual(rider.is_agency, false);
    assert.strictEqual(rider.status, 'active');
    assert.strictEqual(rider.phone, '+237677000001');
    assert.strictEqual(rider.display_name, 'Rik One');

    const owner = await one(`SELECT primary_role, seller_status, onboarding_status, onboarding_completed_at, primary_store_id FROM iam.profiles WHERE id = 'usr_owner'`);
    assert.strictEqual(owner.primary_role, 'seller');
    assert.strictEqual(owner.seller_status, 'READY');
    assert.strictEqual(owner.onboarding_status, 'COMPLETED');
    assert.ok(owner.onboarding_completed_at);
    assert.strictEqual(owner.primary_store_id, HOUSE_STORE.id);

    // ---- 5. the runtime lookups now answer --------------------------------
    const house = await service.resolve({ force: true });
    assert.strictEqual(house.ownerId, 'usr_owner');
    assert.strictEqual(house.name, 'NanoAfrica');
    assert.strictEqual(house.status, 'ACTIVE');
    assert.strictEqual(house.phone, '+237699111222');
    assert.strictEqual(house.isVerified, true);
    assert.strictEqual(house.verificationTier, 'official_brand');
    assert.strictEqual(house.city, 'Douala');
    const provider = await service.resolveDefaultProvider();
    assert.ok(provider, 'the default provider resolves');
    assert.strictEqual(provider.id, 'usr_owner');
    assert.strictEqual(provider.name, 'nanoDelivery');
    assert.strictEqual(provider.isAgency, true);
    assert.strictEqual(provider.organizationId, HOUSE_AGENCY.organizationId);
    const roster = await getSharedDeliveryService().listAgencyRiders({ userId: 'usr_owner', userRole: 'seller' }, 'usr_owner');
    assert.deepStrictEqual(roster.riders.map((r) => r.id), ['usr_rider_1'], 'the agency can delegate to its rider');

    // ---- 4. idempotent, and edits survive ---------------------------------
    const afterFirst = await snapshot();
    const again = await service.provision({ ...base, riderEmails: ['rider.one@example.com'], apply: true, confirmOwnerId: 'usr_owner' });
    assert.strictEqual(again.changed, 0, 'a second apply changes nothing');
    assert.ok(again.steps.every((s) => s.action === 'exists'), JSON.stringify(again.steps.filter((s) => s.action !== 'exists')));
    assert.deepStrictEqual(await snapshot(), afterFirst);

    await db.query(`UPDATE iam.stores SET description = 'Our own words', phone_number = '+237655555555', logo_url = 'https://cdn.example.test/logo.png', status = 'SUSPENDED' WHERE id = $1`, [HOUSE_STORE.id]);
    await db.query(`UPDATE iam.store_hours SET is_always_open = true WHERE store_id = $1`, [HOUSE_STORE.id]);
    await db.query(`UPDATE iam.store_locations SET city = 'Yaoundé', street_address = 'Rue Kennedy' WHERE store_id = $1`, [HOUSE_STORE.id]);
    await db.query(`UPDATE iam.store_profiles SET tagline = 'Custom tagline' WHERE store_id = $1`, [HOUSE_STORE.id]);
    await db.query(`UPDATE iam.organizations SET description = 'Custom agency text', phone_number = '+237644444444' WHERE id = $1`, [HOUSE_AGENCY.organizationId]);
    await db.query(`UPDATE iam.delivery_drivers SET base_fee_xaf = 700, service_areas = '["douala","yaounde"]'::jsonb, phone = '+237633333333', photo_url = 'https://cdn.example.test/p.png' WHERE profile_id = 'usr_owner'`);
    await db.query(`UPDATE iam.delivery_drivers SET vehicle_type = 'motorbike' WHERE profile_id = 'usr_rider_1'`);
    const rerun = await service.provision({ ...base, city: 'Douala', riderEmails: ['rider.one@example.com'], apply: true, confirmOwnerId: 'usr_owner' });
    assert.strictEqual(rerun.changed, 0, 'edits are not "fixed" back');
    assert.ok(rerun.warnings.some((w) => /SUSPENDED/.test(w)), 'a suspended store is reported, not silently reactivated');
    const kept = await one(`SELECT description, phone_number, logo_url, status FROM iam.stores WHERE id = $1`, [HOUSE_STORE.id]);
    assert.deepStrictEqual(kept, { description: 'Our own words', phone_number: '+237655555555', logo_url: 'https://cdn.example.test/logo.png', status: 'SUSPENDED' });
    assert.strictEqual((await one(`SELECT is_always_open FROM iam.store_hours WHERE store_id = $1`, [HOUSE_STORE.id])).is_always_open, true);
    assert.deepStrictEqual(await one(`SELECT city, street_address FROM iam.store_locations WHERE store_id = $1`, [HOUSE_STORE.id]), { city: 'Yaoundé', street_address: 'Rue Kennedy' });
    assert.strictEqual((await one(`SELECT tagline FROM iam.store_profiles WHERE store_id = $1`, [HOUSE_STORE.id])).tagline, 'Custom tagline');
    assert.deepStrictEqual(await one(`SELECT description, phone_number FROM iam.organizations WHERE id = $1`, [HOUSE_AGENCY.organizationId]), { description: 'Custom agency text', phone_number: '+237644444444' });
    const keptAgency = await one(`SELECT base_fee_xaf, service_areas, phone, photo_url FROM iam.delivery_drivers WHERE profile_id = 'usr_owner'`);
    assert.deepStrictEqual(keptAgency, { base_fee_xaf: 700, service_areas: ['douala', 'yaounde'], phone: '+237633333333', photo_url: 'https://cdn.example.test/p.png' });
    assert.strictEqual((await one(`SELECT vehicle_type FROM iam.delivery_drivers WHERE profile_id = 'usr_rider_1'`)).vehicle_type, 'motorbike');
    // The city shown on the product page follows the seller's edit of the location, not the provisioning default.
    assert.strictEqual((await service.resolve({ force: true })).city, 'Yaoundé');
    assert.strictEqual((await service.resolve({ force: true })).status, 'SUSPENDED', 'resolve reports the real status so checkout refuses a suspended store');

    // Only blanks are filled: a cleared phone is restored, a set one is not.
    await db.query(`UPDATE iam.stores SET phone_number = NULL, status = 'ACTIVE' WHERE id = $1`, [HOUSE_STORE.id]);
    const fill = await service.provision({ ...base, apply: true, confirmOwnerId: 'usr_owner' });
    assert.strictEqual(fill.changed, 1);
    assert.strictEqual((await one(`SELECT phone_number FROM iam.stores WHERE id = $1`, [HOUSE_STORE.id])).phone_number, '+237699111222');
    // The derived count is refreshed.
    await db.query(`UPDATE iam.stores SET product_count = 3 WHERE id = $1`, [HOUSE_STORE.id]);
    await service.provision({ ...base, apply: true, confirmOwnerId: 'usr_owner' });
    assert.ok((await one(`SELECT product_count FROM iam.stores WHERE id = $1`, [HOUSE_STORE.id])).product_count > 900);

    // A rider added later joins the agency; the previous rider is untouched.
    await db.query(`UPDATE iam.profiles SET phone_number = '+237677000002' WHERE id = 'usr_rider_2'`);
    const later = await service.provision({ ...base, riderEmails: ['rider.one@example.com', 'rider.two@example.com'], apply: true, confirmOwnerId: 'usr_owner' });
    assert.strictEqual(later.changed, 2, 'one provider record and one membership');
    const roster2 = await getSharedDeliveryService().listAgencyRiders({ userId: 'usr_owner', userRole: 'seller' }, 'usr_owner');
    assert.deepStrictEqual(roster2.riders.map((r) => r.id).sort(), ['usr_rider_1', 'usr_rider_2']);

    // ---- a curated product is orderable, and the order lands under the owner ----
    // This is the foreign key that failed in production (orders_seller_id_fkey), checked on the real schema.
    const { OrderRepository } = require('../../server/modules/commerce/infrastructure/OrderRepository');
    const { OrderCreationService } = require('../../server/modules/commerce/application/OrderCreationService');
    const { catalogProducts } = require('../../server/modules/catalog/dataLoader');
    await db.query(`INSERT INTO iam.profiles (id, clerk_user_id, email, email_verified_at, first_name, last_name, city) VALUES ('usr_buyer', 'c-buyer', 'buyer@example.com', now(), 'Bo', 'Buyer', 'Douala')`);
    const curatedId = 'phone_tecno_tecno_spark_20_pro_256gb_8gb_ram_';
    const unit = Math.min(...[catalogProducts[curatedId].price, catalogProducts[curatedId].salePrice].map((v) => parseInt(String(v).replace(/[^0-9]/g, ''), 10)));
    const orders = new OrderRepository({ db: admin, houseStore: service });
    service.invalidate();
    const listing = await orders.findListingById(curatedId);
    assert.ok(listing, 'the provisioned house store makes the curated product orderable');
    assert.strictEqual(listing.sellerId, 'usr_owner');
    assert.strictEqual(listing.storeStatus, 'ACTIVE');
    assert.strictEqual(listing.basePriceMinor, unit);
    assert.strictEqual(await orders.findListingById('phone_tecno_tecno_spark_20_pro'), null, 'a partial id is not');
    const creation = new OrderCreationService(orders, { resolveProvider: async () => null });
    const placed = await creation.createOrder('usr_buyer', {
      items: [{ id: curatedId, listingId: curatedId, quantity: 1, unitPriceXaf: unit }],
      shippingAddress: { fullName: 'Bo Buyer', phone: '+237622222222', street: 'Rue 1', city: 'Douala' },
      deliveryMethod: 'HOME_DELIVERY'
    });
    const row = await one(`SELECT seller_id, buyer_id FROM iam.orders WHERE id = $1`, [placed.id]);
    assert.deepStrictEqual(row, { seller_id: 'usr_owner', buyer_id: 'usr_buyer' }, 'the order is filed under the owner account');
    // The notification is sent after the order is saved and is not awaited by the checkout.
    let told = 0;
    for (let i = 0; i < 30 && !told; i++) {
      told = await count('notifications', 'user_id = $1', ['usr_owner']);
      if (!told) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(told >= 1, 'and the owner has been notified');

    // ---- 6. rows that belong to someone else are blockers -----------------
    const hijack = await service.provision({ ownerEmail: 'other.owner@example.com', phone: '+237600000006' });
    assert.ok(hijack.blockers.some((b) => /belongs to another account/.test(b) && /store_nanoafrica/.test(b)), JSON.stringify(hijack.blockers));
    assert.ok(hijack.blockers.some((b) => /organization/.test(b)));
    await rejects(() => service.provision({ ownerEmail: 'other.owner@example.com', phone: '+237600000006', apply: true, confirmOwnerId: 'usr_other' }), /must be fixed first/, 'taking over the store');
    assert.strictEqual((await one(`SELECT owner_id FROM iam.stores WHERE id = $1`, [HOUSE_STORE.id])).owner_id, 'usr_owner', 'ownership did not move');
    const cliBlocked = await runCli(['--owner-email', 'other.owner@example.com', '--phone', '+237600000006'], env);
    assert.strictEqual(cliBlocked.code, 3, 'the CLI exits 3 when the dry run found blockers');
    assert.ok(/BLOCKERS/.test(cliBlocked.stdout));

    // An owner who already holds a different provider record (here: a plain rider) cannot become the agency.
    await db.query(`DELETE FROM iam.organization_members WHERE organization_id = $1 AND user_id <> 'usr_owner'`, [HOUSE_AGENCY.organizationId]);
    await db.query(`DELETE FROM iam.delivery_drivers WHERE profile_id = 'usr_rider_2'`);
    const asRider = await service.provision({ ownerEmail: 'rider.one@example.com' });
    assert.ok(asRider.blockers.some((b) => /already registered as a delivery provider/.test(b) || /belongs to another account/.test(b)));

    // ---- the documented rollback really works (docs/NANOAFRICA.md, "Undoing it") ----
    // The runbook says it is only safe before the first real order, so clear the test order first.
    await db.query(`DELETE FROM iam.orders`);
    const doc = require('fs').readFileSync(path.join(REPO, 'docs', 'NANOAFRICA.md'), 'utf8').replace(/\r\n/g, '\n');
    const rollback = /```sql\n(BEGIN;[\s\S]*?COMMIT;)\n```/.exec(doc.slice(doc.indexOf('## Undoing it')));
    assert.ok(rollback, 'the runbook carries the rollback SQL');
    let riderIds = ['usr_rider_1', 'usr_rider_2'];
    await db.exec(rollback[1].replace(/<rider id>/g, () => riderIds.shift() || 'usr_rider_2'));
    assert.deepStrictEqual(await snapshot(), empty, 'the rollback removes every row the provisioning created');
    assert.strictEqual((await one(`SELECT primary_store_id FROM iam.profiles WHERE id = 'usr_owner'`)).primary_store_id, null);
    assert.strictEqual(await service.resolve({ force: true }), null, 'curated products are un-orderable again after the rollback');
    assert.strictEqual(await new OrderRepository({ db: admin, houseStore: service }).findListingById(curatedId), null);

    console.log('    ✓ house_store_provision: dry run, refusals, apply, idempotence, edits kept, runtime lookups, conflicts');
  } finally {
    SupabaseDatabase.getAdmin = originalAdmin;
    SupabaseClient.getAdmin = originalClientAdmin;
    await new Promise((r) => rest.server.close(r));
    await db.close();
  }
}

module.exports = { run };

if (require.main === module) {
  run().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
