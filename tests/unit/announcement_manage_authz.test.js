/**
 * LOUMOO — only an announcement's author (or its store's team) may change it
 * ---------------------------------------------------------------------------
 * Every mutation (update, publish, schedule, cancel-schedule, archive, delete)
 * checked a non-author with _verifyStoreAndOrgAccess(principal, store_id),
 * which returns quietly when there is no store. So for a personal (store-less)
 * announcement ANY signed-in user could rewrite, publish or delete it.
 *
 * Hermetic: the admin client is a recording stand-in.
 */

require('../setup');

const assert = require('assert');
const SupabaseModule = require('../../server/infrastructure/database/SupabaseClient');
const AnnouncementService = require('../../server/modules/announcement/application/AnnouncementService');

function fakeDb(row) {
  const writes = [];
  const from = (table) => {
    let op = 'select';
    let payload = null;
    const q = {
      select: () => q, eq: () => q, is: () => q, in: () => q, order: () => q, limit: () => q,
      update: (p) => { op = 'update'; payload = p; return q; },
      insert: (p) => { op = 'insert'; payload = p; return q; },
      delete: () => { op = 'delete'; return q; },
      maybeSingle: async () => ({ data: table === 'announcements' && op === 'select' ? { ...row } : null, error: null }),
      single: async () => { writes.push({ table, op, payload }); return { data: { ...row, ...(payload || {}) }, error: null }; },
      then: (resolve) => { if (op !== 'select') writes.push({ table, op, payload }); return resolve({ data: null, error: null }); }
    };
    return q;
  };
  return { db: { from }, writes };
}

const PERSONAL = { id: 'ann_1', author_id: 'usr_author', store_id: null, title: 'My bike for sale', status: 'DRAFT', deleted_at: null };

async function refused(label, fn) {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert.ok(err, `${label}: a stranger was allowed`);
  assert.ok(/permission|not found/i.test(err.message), `${label}: refused for the right reason (${err.message})`);
}

(async () => {
  const original = SupabaseModule.SupabaseClient.getAdmin;
  const stranger = { id: 'usr_stranger', primaryRole: 'customer' };
  try {
    const fake = fakeDb(PERSONAL);
    SupabaseModule.SupabaseClient.getAdmin = () => fake.db;

    await refused('update', () => AnnouncementService.updateAnnouncement(stranger, 'ann_1', { title: 'Hacked title' }));
    await refused('publish', () => AnnouncementService.publishAnnouncement(stranger, 'ann_1'));
    await refused('archive', () => AnnouncementService.archiveAnnouncement(stranger, 'ann_1'));
    await refused('delete', () => AnnouncementService.deleteAnnouncement(stranger, 'ann_1'));
    assert.deepStrictEqual(fake.writes.filter((w) => w.table === 'announcements'), [], 'nothing was written for a stranger');

    // The author still can.
    const own = fakeDb(PERSONAL);
    SupabaseModule.SupabaseClient.getAdmin = () => own.db;
    await AnnouncementService.updateAnnouncement({ id: 'usr_author' }, 'ann_1', { title: 'My red bike for sale' });
    assert.ok(own.writes.some((w) => w.table === 'announcements' && w.op === 'update'), 'the author edits their own announcement');
  } finally {
    SupabaseModule.SupabaseClient.getAdmin = original;
  }

  console.log('announcement_manage_authz: a stranger cannot change a personal announcement; its author can');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
