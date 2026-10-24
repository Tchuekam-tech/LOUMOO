#!/usr/bin/env node
'use strict';

/**
 * LOUMOO — purge/archive junk catalogue data (cleanup brief, Steps 2 & 3).
 *
 *   node scripts/cleanup_junk_data.js            DRY RUN (default): print the plan + before/after counts
 *   node scripts/cleanup_junk_data.js --apply    execute it
 *
 * GROUND RULES (from the brief), enforced here:
 *   - Dry-run first, always. --apply is required to change anything.
 *   - Never HARD-DELETE a record referenced by an order or a review: it is ARCHIVED instead
 *     (status ARCHIVED, visibility PRIVATE, deleted_at set) so order history and reviews still
 *     resolve. Only unreferenced junk is deleted outright.
 *   - Take a DB snapshot before --apply. ROLLBACK = restore that snapshot. (There is no automatic
 *     undo; the migrations' and this script's writes are not transactional across tables.)
 *
 * WHAT IT TOUCHES (and does NOT):
 *   a) Test stores (is_test=true, or the harness name/slug patterns) → delete if unreferenced,
 *      else archive. Their listings/media cascade (ON DELETE CASCADE).
 *   b) Placeholder listings (untitled-draft-listing-*, harness-test-listing-*) → delete/archive.
 *   d) Duplicate listings (same title+seller+category+price, IndexingPolicy.duplicateKey) → keep the
 *      OLDEST, archive the rest, and register a 301 (iam.listing_redirects) from each archived
 *      slug to the kept one so old links 301 instead of 404.
 *   It NEVER touches the curated catalogue (src/data/catalog_products.js — the real NanoAfrica
 *   house-store products), and it does NOT rewrite order history: an order's items JSONB keeps its
 *   snapshot; the referenced listing/store is archived, not deleted or re-pointed.
 *
 * planCleanup() is a PURE function (no I/O): it takes the rows and returns the plan, so the
 * classification is unit-tested (tests/unit/cleanup_junk_data.test.js) without a database. The CLI
 * is the thin I/O wrapper that fetches the rows, prints the plan, and on --apply executes it.
 */

const IndexingPolicy = require('../server/modules/system/seo/IndexingPolicy');

/** A listing/store id or slug "referenced" by an order (its items JSONB) or a review (target_id). */
function buildReferenceIndex(orders, reviews) {
  const inOrders = [];
  for (const o of orders || []) {
    let hay = '';
    try { hay = (typeof o.items === 'string' ? o.items : JSON.stringify(o.items || '')) + '|' + (o.seller_id || ''); }
    catch (_) { hay = String(o.seller_id || ''); }
    inOrders.push(hay);
  }
  const reviewTargets = new Set((reviews || []).map((r) => String(r.target_id || '')));
  // Match a token only as a WHOLE identifier/slug — bounded by a non [A-Za-z0-9_-] character or the
  // string end — so "l_under_test" does not match inside "l_under_test_ref" (ids and slugs are
  // [A-Za-z0-9_-]). The scan stays conservative: anything it is unsure of it reports as referenced
  // (→ archive, never delete), which is the brief's required direction.
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const whole = (hay, token) => new RegExp(`(?:^|[^A-Za-z0-9_-])${esc(token)}(?:[^A-Za-z0-9_-]|$)`).test(hay);
  return {
    // true when any order's snapshot, or any review, names this id or slug.
    referenced(...tokens) {
      const toks = tokens.map(String).filter(Boolean);
      if (toks.some((t) => reviewTargets.has(t))) return true;
      return inOrders.some((hay) => toks.some((t) => whole(hay, t)));
    }
  };
}

function text(v) { return String(v == null ? '' : v); }

/** Oldest first, then by id — the same listing survives every run. */
function oldestFirst(a, b) {
  const ta = text(a.created_at); const tb = text(b.created_at);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return text(a.id) < text(b.id) ? -1 : text(a.id) > text(b.id) ? 1 : 0;
}

/**
 * Build the cleanup plan from the rows. Pure.
 * @param {{stores:object[], listings:object[], orders?:object[], reviews?:object[]}} data
 * @returns {{stores:{delete:object[],archive:object[]}, listings:{delete:object[],archive:object[]},
 *            duplicates:{keep:object[],archive:object[],redirects:object[]}, counts:object}}
 */
function planCleanup({ stores = [], listings = [], orders = [], reviews = [] } = {}) {
  const ref = buildReferenceIndex(orders, reviews);
  const listingsByStore = new Map();
  for (const l of listings) {
    if (!listingsByStore.has(l.store_id)) listingsByStore.set(l.store_id, []);
    listingsByStore.get(l.store_id).push(l);
  }

  // a) test stores
  const stPlan = { delete: [], archive: [] };
  const testStoreIds = new Set();
  for (const s of stores) {
    if (!IndexingPolicy.isTestStore(s) && s.is_test !== true) continue;
    testStoreIds.add(s.id);
    const own = listingsByStore.get(s.id) || [];
    const tokens = [s.id, s.slug, ...own.flatMap((l) => [l.id, l.slug])];
    const row = { id: s.id, slug: s.slug, name: s.name, listingCount: own.length };
    (ref.referenced(...tokens) ? stPlan.archive : stPlan.delete).push(row);
  }

  // b) placeholder listings (that are not already going away with a test store)
  const liPlan = { delete: [], archive: [] };
  const placeholderIds = new Set();
  for (const l of listings) {
    if (!IndexingPolicy.hasPlaceholderSlug(l)) continue;
    if (testStoreIds.has(l.store_id)) continue; // handled by the store delete/cascade
    placeholderIds.add(l.id);
    const row = { id: l.id, slug: l.slug, title: l.title };
    (ref.referenced(l.id, l.slug) ? liPlan.archive : liPlan.delete).push(row);
  }

  // d) duplicate listings — group the LIVE, non-junk ones and keep the oldest of each family.
  const live = listings.filter((l) =>
    !testStoreIds.has(l.store_id) && !placeholderIds.has(l.id) &&
    text(l.title).trim() && (l.deleted_at == null) && l.status === 'PUBLISHED');
  const groups = new Map();
  for (const l of live) {
    const key = IndexingPolicy.duplicateKey(l);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  const dup = { keep: [], archive: [], redirects: [] };
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = group.slice().sort(oldestFirst);
    const kept = sorted[0];
    dup.keep.push({ id: kept.id, slug: kept.slug, title: kept.title });
    for (const l of sorted.slice(1)) {
      dup.archive.push({ id: l.id, slug: l.slug, title: l.title, keptId: kept.id, keptSlug: kept.slug });
      dup.redirects.push({ old_slug: l.slug, target_listing_id: kept.id, reason: 'dedup' });
    }
  }

  const counts = {
    storesScanned: stores.length,
    listingsScanned: listings.length,
    testStoresDeleted: stPlan.delete.length,
    testStoresArchived: stPlan.archive.length,
    placeholderListingsDeleted: liPlan.delete.length,
    placeholderListingsArchived: liPlan.archive.length,
    duplicatesKept: dup.keep.length,
    duplicatesArchived: dup.archive.length,
    redirects: dup.redirects.length
  };
  return { stores: stPlan, listings: liPlan, duplicates: dup, counts };
}

module.exports = { planCleanup, buildReferenceIndex };

// ───────────────────────────────────────────────────────────── CLI ──────────
if (require.main === module) {
  const apply = process.argv.includes('--apply');

  // Opt into real services and read .env.local, exactly like scripts/purge_test_data.js. tests/setup
  // refuses the production project unless LOUMOO_TEST_ALLOW_PRODUCTION_DB acknowledges it — so a run
  // against prod is a deliberate, acknowledged act, with a snapshot taken first.
  process.env.LOUMOO_RUN_INTEGRATION = process.env.LOUMOO_RUN_INTEGRATION || '1';
  require('../tests/setup');
  const { SupabaseDatabase } = require('../server/infrastructure/database/SupabaseClient');
  const db = SupabaseDatabase.getAdmin();
  if (!db) { console.error('[cleanup] No admin database client (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing).'); process.exit(2); }

  const nowIso = new Date().toISOString();

  (async () => {
    const [stores, listings, orders, reviews] = await Promise.all([
      db.from('stores').select('id, slug, name, status, visibility, is_test, deleted_at').is('deleted_at', null).then((r) => r.data || []),
      db.from('listings').select('id, slug, title, store_id, category_id, base_price_minor, status, created_at, deleted_at, stores!inner(name)').then((r) => (r.data || []).map((l) => ({ ...l, stores: l.stores }))),
      db.from('orders').select('id, items, seller_id').then((r) => r.data || []),
      db.from('reviews').select('target_id').then((r) => r.data || [])
    ]);

    const plan = planCleanup({ stores, listings, orders, reviews });
    const c = plan.counts;
    console.log(`\n[cleanup] ${apply ? 'APPLY' : 'DRY RUN'} — scanned ${c.storesScanned} stores, ${c.listingsScanned} listings, ${orders.length} orders, ${reviews.length} reviews\n`);
    console.log('  Test stores     : delete %d, archive %d (archived = referenced by an order/review)', c.testStoresDeleted, c.testStoresArchived);
    console.log('  Placeholder lstn: delete %d, archive %d', c.placeholderListingsDeleted, c.placeholderListingsArchived);
    console.log('  Duplicate lstn  : keep %d, archive %d, + %d redirect(s)', c.duplicatesKept, c.duplicatesArchived, c.redirects);
    plan.duplicates.archive.forEach((d) => console.log(`      archive ${d.slug}  →301→  ${d.keptSlug}`));

    if (!apply) {
      console.log('\n[cleanup] DRY RUN only. Re-run with --apply to execute (take a DB snapshot first).');
      console.log('[cleanup] ROLLBACK: restore the pre-run snapshot. These writes have no automatic undo.\n');
      return;
    }

    console.log('\n[cleanup] applying…');
    const archiveStore = { status: 'ARCHIVED', visibility: 'PRIVATE', is_test: true, deleted_at: nowIso };
    const archiveListing = { status: 'ARCHIVED', visibility: 'PRIVATE', deleted_at: nowIso };
    for (const s of plan.stores.archive) await db.from('stores').update(archiveStore).eq('id', s.id);
    for (const s of plan.stores.delete) await db.from('stores').delete().eq('id', s.id);
    for (const l of plan.listings.archive) await db.from('listings').update(archiveListing).eq('id', l.id);
    for (const l of plan.listings.delete) await db.from('listings').delete().eq('id', l.id);
    for (const d of plan.duplicates.archive) await db.from('listings').update(archiveListing).eq('id', d.id);
    for (const r of plan.duplicates.redirects) await db.from('listing_redirects').upsert(r, { onConflict: 'old_slug' });
    console.log('[cleanup] done. Verify against your snapshot, then rebuild the sitemap.\n');
  })().catch((err) => { console.error('[cleanup] failed:', err && err.message ? err.message : err); process.exit(1); });
}
