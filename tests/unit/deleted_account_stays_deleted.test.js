/**
 * LOUMOO — a deleted account stays deleted
 * ---------------------------------------------------------------------------
 * ProfileRepository.getOrCreateForClerkUser used to un-delete an anonymized
 * profile it found (deleted_at/account_status reset to active), and
 * recordLogin did the same on every sign-in. Both ran before the login
 * route's "deleted account cannot be reopened" check, so that check never
 * fired and a deleted account signed straight back in.
 *
 * Hermetic: the repository's database is a recording stand-in.
 */

require('../setup');

const assert = require('assert');
const ProfileRepository = require('../../server/modules/identity/infrastructure/ProfileRepository');

function recordingDb(row) {
  const writes = [];
  const query = (table) => {
    const q = {
      select: () => q,
      eq: () => q,
      is: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: row ? { ...row } : null, error: null }),
      single: async () => ({ data: row ? { ...row } : null, error: null }),
      insert: (payload) => { writes.push({ table, op: 'insert', payload }); return q; },
      update: (payload) => { writes.push({ table, op: 'update', payload }); return q; },
      then: (resolve) => resolve({ data: null, error: null })
    };
    return q;
  };
  return { db: { from: query }, writes };
}

async function withDb(fake, fn) {
  const descriptor = Object.getOwnPropertyDescriptor(ProfileRepository, 'db');
  Object.defineProperty(ProfileRepository, 'db', { configurable: true, get: () => fake.db });
  try { return await fn(); } finally { Object.defineProperty(ProfileRepository, 'db', descriptor); }
}

const DELETED = {
  id: 'prof_deleted_1',
  clerk_user_id: 'auth_deleted_1',
  email: 'anonymized_proftest@deleted.loumoo.cm',
  status: 'deactivated',
  account_status: 'anonymized',
  deleted_at: '2026-10-01T00:00:00.000Z',
  clerk_deleted_at: null
};

(async () => {
  // 1. A deleted profile is returned as it is, and nothing is written.
  let fake = recordingDb(DELETED);
  const { profile, created } = await withDb(fake, () =>
    ProfileRepository.getOrCreateForClerkUser({ clerkUserId: DELETED.clerk_user_id, email: 'old@example.com' }));
  assert.strictEqual(created, false);
  assert.strictEqual(profile.deleted_at, DELETED.deleted_at, 'the deleted_at stamp survives');
  assert.strictEqual(profile.account_status, 'anonymized', 'the account is still anonymized');
  assert.deepStrictEqual(fake.writes, [], 'provisioning never writes to a deleted profile');

  // 2. The shared predicate recognises every deleted shape.
  assert.ok(ProfileRepository.isDeletedProfile(DELETED));
  assert.ok(ProfileRepository.isDeletedProfile({ clerk_deleted_at: '2026-10-01T00:00:00.000Z' }));
  assert.ok(ProfileRepository.isDeletedProfile({ account_status: 'anonymized' }));
  assert.ok(!ProfileRepository.isDeletedProfile({ account_status: 'active', status: 'active' }));
  assert.ok(!ProfileRepository.isDeletedProfile(null));

  // 3. Recording a sign-in only stamps last_login_at: it cannot un-delete or un-suspend.
  fake = recordingDb(DELETED);
  await withDb(fake, () => ProfileRepository.recordLogin(DELETED.id, DELETED.clerk_user_id));
  assert.strictEqual(fake.writes.length, 1, 'one write');
  assert.deepStrictEqual(Object.keys(fake.writes[0].payload), ['last_login_at'],
    `recordLogin writes only last_login_at, not ${JSON.stringify(fake.writes[0].payload)}`);

  console.log('deleted_account_stays_deleted: all checks passed');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
