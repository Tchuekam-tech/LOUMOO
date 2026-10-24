-- 023_store_is_test_flag.sql
-- Cleanup brief, Step 2e: mark the test harnesses' stores so they are filtered out of every
-- public surface permanently, by a flag rather than by guessing from the name.
--
-- iam.stores.slug and iam.listings.slug are ALREADY `NOT NULL UNIQUE` (migrations 004 and 005),
-- so Step 1's "unique index on slug so future collisions fail in CI" is already enforced — the
-- hermetic test DB (tests/e2e/support/localDb.js applies every NNN_*.sql) rejects a duplicate
-- slug insert today. No new index is added here; adding one would be redundant.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, and the backfill only flips rows that are still false.
-- The backfill flags the stores the harnesses create (tests/helpers/harness.js now sets is_test
-- directly; this catches the rows already in the database from earlier runs). The patterns match
-- server/modules/system/seo/IndexingPolicy.js isTestStore().

ALTER TABLE iam.stores
    ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN iam.stores.is_test IS
    'Created by an automated test harness; never shown on any public surface (sitemap, store list, search).';

UPDATE iam.stores
   SET is_test = TRUE
 WHERE is_test = FALSE
   AND ( slug ~ '^(loop-)?test-boutique(-|$)'
      OR slug ~ '^harness-test(-|$)'
      OR name ~* '^(loop )?test boutique'
      OR name ~* '^harness test' );

CREATE INDEX IF NOT EXISTS idx_stores_is_test ON iam.stores(is_test) WHERE is_test = TRUE;
