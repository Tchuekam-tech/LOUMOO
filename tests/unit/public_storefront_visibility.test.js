/**
 * /store/:slug must not publish a store that is not live.
 * ---------------------------------------------------------------------------
 * The storefront page the app renders at /store/:slug reads GET /api/v1/stores/s/:slug
 * (PublicProfileService.getSellerPublicProfile). It used to hide only ARCHIVED/DELETED
 * stores, so a SUSPENDED, CLOSED, DRAFT or PRIVATE store - and its listings - stayed
 * browsable to anyone who knew or guessed the slug. The marketplace already treats only
 * ACTIVE stores as public (CatalogRepository joins stores on ACTIVE); the storefront now
 * follows the same rule, and a store that is not live answers exactly like one that does
 * not exist (404), so changing the slug in the URL reveals nothing. The owner and platform
 * staff still see their own page.
 *
 * Hermetic: a small in-test database double (`from(table).select().eq(col, v).maybeSingle()`
 * with real filtering) stands in for Supabase; no credentials, no network.
 */
'use strict';

require('../setup');
const assert = require('assert');

const { SupabaseClient } = require('../../server/infrastructure/database/SupabaseClient');

/** Rows by table; supports the chain the service uses, with .eq() filtering. */
function makeDb(tables) {
  function builder(table) {
    const filters = [];
    const b = {
      select() { return b; }, order() { return b; }, limit() { return b; }, range() { return b; }, in() { return b; },
      ilike() { return b; }, neq() { return b; }, is() { return b; }, gte() { return b; }, lte() { return b; },
      eq(col, val) { filters.push([col, val]); return b; },
      rows() { return (tables[table] || []).filter(r => filters.every(([c, v]) => r[c] === v)); },
      maybeSingle() { const rows = b.rows(); return Promise.resolve({ data: rows[0] || null, error: null }); },
      single() { const rows = b.rows(); return Promise.resolve(rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }); },
      then(resolve, reject) { const rows = b.rows(); return Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve, reject); }
    };
    return b;
  }
  return { from: builder, schema() { return this; } };
}

const store = (over) => ({
  id: 'st_1', slug: 'acme-1f3a', name: 'Acme', owner_id: 'owner_1', status: 'ACTIVE', visibility: 'PUBLIC',
  deleted_at: null, organization_id: null, ...over
});

async function run() {
  const original = SupabaseClient.getAdmin;
  const PublicProfileService = require('../../server/modules/identity/application/PublicProfileService');
  const { NotFoundError } = require('../../server/shared/errors/AppError');

  const read = async (row, who, id) => {
    SupabaseClient.getAdmin = () => makeDb({ stores: row ? [row] : [] });
    try { return { ok: await PublicProfileService.getSellerPublicProfile(id || 'acme-1f3a', who) }; }
    catch (e) { return { err: e }; }
  };
  const isNotFound = r => r.err instanceof NotFoundError || (r.err && r.err.statusCode === 404);

  try {
    // live
    let r = await read(store(), null);
    assert.ok(r.ok, `a live store is public: ${r.err && r.err.message}`);
    r = await read(store(), null, 'st_1');
    assert.ok(r.ok, 'a live store resolves by id as well as by slug');
    r = await read(store(), null, 'ACME-1F3A');
    assert.ok(r.ok, 'slug lookup is case-insensitive');
    console.log('    ✓ public_storefront_visibility: an ACTIVE, public store is visible by slug and by id');

    // not live: indistinguishable from a store that does not exist
    const cases = [
      ['SUSPENDED', { status: 'SUSPENDED' }], ['CLOSED', { status: 'CLOSED' }], ['DRAFT', { status: 'DRAFT' }],
      ['PENDING_VERIFICATION', { status: 'PENDING_VERIFICATION' }], ['PRIVATE', { visibility: 'PRIVATE' }],
      ['soft-deleted', { deleted_at: '2026-01-01T00:00:00Z' }], ['ARCHIVED', { status: 'ARCHIVED' }]
    ];
    for (const [label, over] of cases) {
      for (const who of [null, { id: 'stranger', primaryRole: 'customer' }, { id: 'rival_seller', primaryRole: 'seller' }]) {
        r = await read(store(over), who);
        assert.ok(isNotFound(r), `a ${label} store must be a 404 for ${who ? who.id : 'an anonymous visitor'} (got ${r.ok ? 'the store' : r.err && r.err.message})`);
      }
    }
    const missing = await read(null, null);
    const suspended = await read(store({ status: 'SUSPENDED' }), null);
    assert.strictEqual(missing.err.statusCode, suspended.err.statusCode, 'same status as a store that does not exist');
    assert.strictEqual(missing.err.code, suspended.err.code, 'same error code as a store that does not exist');
    console.log('    ✓ public_storefront_visibility: suspended / closed / draft / pending / private / deleted stores answer exactly like a missing store');

    // the owner and platform staff can still see it
    for (const over of [{ status: 'SUSPENDED' }, { status: 'DRAFT' }, { visibility: 'PRIVATE' }]) {
      r = await read(store(over), { id: 'owner_1', primaryRole: 'seller' });
      assert.ok(r.ok, `the owner previews their own ${JSON.stringify(over)} store`);
      r = await read(store(over), { id: 'someone', primaryRole: 'admin' });
      assert.ok(r.ok, `an admin can view a ${JSON.stringify(over)} store`);
      r = await read(store(over), { id: 'someone', primaryRole: 'super_admin' });
      assert.ok(r.ok, `a super admin can view a ${JSON.stringify(over)} store`);
    }
    // a moderator is staff of the marketplace but not of stores: no special view
    r = await read(store({ status: 'SUSPENDED' }), { id: 'mod', primaryRole: 'moderator' });
    assert.ok(isNotFound(r), 'only the owner and admins see a store that is not live');
    console.log('    ✓ public_storefront_visibility: the owner and admins still see a store that is not live; nobody else does');
  } finally {
    SupabaseClient.getAdmin = original;
  }
}

module.exports = { run };

if (require.main === module) {
  run().then(() => { console.log('public_storefront_visibility: OK'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
