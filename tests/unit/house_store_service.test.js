/**
 * LOUMOO Unit Tests - The house store lookup
 * ---------------------------------------------------------------------------
 * HouseStoreService.resolve() is what turns "a curated product" into "an order for
 * the owner's account". It must answer from the DATABASE ROW only, say null when the
 * store is not there (so checkout keeps refusing showcase items), report the store's
 * real status, and not hit the database once per bag line.
 *
 *   1. Row present => the owner, status, phone and public facts; absent => null.
 *   2. A hit is cached briefly, a miss for even less, invalidate()/force re-read.
 *   3. No database, or a failing one, is "not provisioned", never a throw or an invented store.
 *   4. The verification tier written by provisioning is one the schema accepts.
 */

require('../setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { HouseStoreService } = require('../../server/modules/store/application/HouseStoreService');
const { HOUSE_STORE, isHouseStoreId } = require('../../server/modules/store/domain/HouseStore');
const { HOUSE_STORE_VERIFICATION_TIER, maskEmail } = require('../../server/modules/store/application/HouseStoreProvisioner');

const ROW = {
  id: HOUSE_STORE.id, owner_id: 'usr_owner', name: 'NanoAfrica', slug: 'nanoafrica', status: 'ACTIVE',
  phone_number: null, email: 'owner@example.test', logo_url: 'https://cdn.example.test/l.png', is_verified: true,
  verification_tier: 'official_brand', rating: '4.50', rating_count: 3, metadata: { phone: '+237699000111', city: 'Douala' }, deleted_at: null
};

function fakeDb({ row = ROW, locationCity = null, error = null } = {}) {
  const reads = [];
  return {
    reads,
    from(table) {
      const filters = {};
      const q = {
        select() { return q; },
        eq(c, v) { filters[c] = v; return q; },
        is() { return q; },
        async maybeSingle() {
          reads.push({ table, filters: { ...filters } });
          if (error) return { data: null, error };
          if (table === 'stores') return { data: row && filters.id === row.id ? row : null, error: null };
          if (table === 'store_locations') return { data: locationCity ? { city: locationCity } : null, error: null };
          return { data: null, error: null };
        }
      };
      return q;
    }
  };
}

async function testResolve() {
  const svc = new HouseStoreService({ db: fakeDb({ locationCity: 'Yaoundé' }) });
  const house = await svc.resolve();
  assert.deepStrictEqual(house, {
    storeId: HOUSE_STORE.id, slug: 'nanoafrica', name: 'NanoAfrica', ownerId: 'usr_owner', status: 'ACTIVE',
    phone: '+237699000111', email: 'owner@example.test', logoUrl: 'https://cdn.example.test/l.png',
    isVerified: true, verificationTier: 'official_brand', rating: 4.5, ratingCount: 3, city: 'Yaoundé'
  });

  assert.strictEqual(await new HouseStoreService({ db: fakeDb({ row: null }) }).resolve(), null, 'not provisioned => null');
  assert.strictEqual(await new HouseStoreService({ db: fakeDb({ row: { ...ROW, owner_id: null } }) }).resolve(), null, 'a store with no owner cannot be a seller');
  const suspended = await new HouseStoreService({ db: fakeDb({ row: { ...ROW, status: 'SUSPENDED' } }) }).resolve();
  assert.strictEqual(suspended.status, 'SUSPENDED', 'the real status is reported, not hidden');
  const noLoc = await new HouseStoreService({ db: fakeDb() }).resolve();
  assert.strictEqual(noLoc.city, 'Douala', 'falls back to the store metadata city');
}

async function testCaching() {
  let t = 1000;
  const db = fakeDb();
  const svc = new HouseStoreService({ db, now: () => t });
  await svc.resolve();
  const storeReads = () => db.reads.filter((r) => r.table === 'stores').length;
  assert.strictEqual(storeReads(), 1);
  t += 29 * 1000;
  await svc.resolve();
  assert.strictEqual(storeReads(), 1, 'a hit is served from the cache for 30 seconds');
  t += 2 * 1000;
  await svc.resolve();
  assert.strictEqual(storeReads(), 2, 'then re-read');
  svc.invalidate();
  await svc.resolve();
  assert.strictEqual(storeReads(), 3, 'invalidate() forces a re-read');
  await svc.resolve({ force: true });
  assert.strictEqual(storeReads(), 4, 'so does force');

  // A miss is remembered for a much shorter time, so a store provisioned a moment ago becomes orderable fast.
  const missDb = fakeDb({ row: null });
  const missing = new HouseStoreService({ db: missDb, now: () => t });
  await missing.resolve(); await missing.resolve();
  assert.strictEqual(missDb.reads.filter((r) => r.table === 'stores').length, 1);
  t += 6 * 1000;
  await missing.resolve();
  assert.strictEqual(missDb.reads.filter((r) => r.table === 'stores').length, 2, 'a miss expires after 5 seconds');
}

async function testNoDatabase() {
  assert.strictEqual(await new HouseStoreService({ db: null }).resolve(), null, 'no database => not provisioned');
  const failing = new HouseStoreService({ db: fakeDb({ error: { message: 'boom', code: 'XX000' } }) });
  assert.strictEqual(await failing.resolve(), null, 'a failing read is not provisioned either (outside production)');
  let error = null;
  try { await new HouseStoreService({ db: null }).provision({ ownerEmail: 'a@b.c' }); } catch (e) { error = e; }
  assert.ok(error && /No database connection/.test(error.message), 'provisioning without a database says why');
}

async function testConstants() {
  assert.ok(isHouseStoreId('store_nanoafrica'));
  assert.ok(!isHouseStoreId('store_nanoafrica2') && !isHouseStoreId(undefined) && !isHouseStoreId('STORE_NANOAFRICA'));

  const sql = fs.readFileSync(path.join(__dirname, '../../server/infrastructure/database/migrations/004_store_business_system.sql'), 'utf8');
  const allowed = /verification_tier[^\n]*CHECK \(verification_tier IN \(([^)]*)\)\)/.exec(sql)[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.ok(allowed.includes(HOUSE_STORE_VERIFICATION_TIER), `"${HOUSE_STORE_VERIFICATION_TIER}" must be one of ${allowed.join(', ')}`);
  assert.strictEqual(HOUSE_STORE_VERIFICATION_TIER, 'official_brand');

  assert.strictEqual(maskEmail('ama.owner@example.com'), 'am*******@example.com');
  assert.strictEqual(maskEmail('ab@x.io'), 'ab***@x.io');
  assert.strictEqual(maskEmail(''), '(no email)');
}

async function run() {
  await testResolve();
  await testCaching();
  await testNoDatabase();
  await testConstants();
  console.log('house_store_service: 4 checks passed');
}

if (require.main === module) {
  run().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
