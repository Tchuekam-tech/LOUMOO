/**
 * LOUMOO — a mutual block is still a block
 * ---------------------------------------------------------------------------
 * Two users can block EACH OTHER: two social_blocks rows. The block checks
 * read them with maybeSingle(), which PostgREST answers with an error for two
 * rows; SocialGraphService.isBlockedBetween caught it and answered "not
 * blocked", and ReviewService ignored it — so a mutual block let either side
 * follow, recommend and review the other again.
 *
 * Hermetic: the admin client is a stand-in that behaves like PostgREST
 * (maybeSingle() over two rows is an error).
 */

require('../setup');

const assert = require('assert');
const SupabaseModule = require('../../server/infrastructure/database/SupabaseClient');
const SocialGraphService = require('../../server/modules/identity/application/SocialGraphService');

function blocksDb(rows) {
  const query = () => {
    const q = {
      select: () => q,
      or: () => q,
      eq: () => q,
      limit: async (n) => ({ data: rows.slice(0, n), error: null }),
      maybeSingle: async () => (rows.length > 1
        ? { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
        : { data: rows[0] || null, error: null })
    };
    return q;
  };
  return { from: query };
}

(async () => {
  const original = SupabaseModule.SupabaseClient.getAdmin;
  try {
    // Mutual block: two rows.
    SupabaseModule.SupabaseClient.getAdmin = () => blocksDb([{ id: 'blk_1' }, { id: 'blk_2' }]);
    assert.strictEqual(await SocialGraphService.isBlockedBetween('usr_a', 'usr_b'), true, 'a mutual block is a block');

    // One-way block: one row.
    SupabaseModule.SupabaseClient.getAdmin = () => blocksDb([{ id: 'blk_3' }]);
    assert.strictEqual(await SocialGraphService.isBlockedBetween('usr_c', 'usr_d'), true, 'a one-way block is a block');

    // No block.
    SupabaseModule.SupabaseClient.getAdmin = () => blocksDb([]);
    assert.strictEqual(await SocialGraphService.isBlockedBetween('usr_e', 'usr_f'), false, 'no rows, no block');
  } finally {
    SupabaseModule.SupabaseClient.getAdmin = original;
  }

  console.log('mutual_block: mutual, one-way and no block all read correctly');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
