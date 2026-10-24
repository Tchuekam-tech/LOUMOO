# LOUMOO — junk-data cleanup runbook (operator)

The cleanup brief's Steps 2–3 change the **production database**. The code (migrations + a
dry-run-first script) ships in the repo; **you run it**, with a snapshot. This is the order.

## What it does
- Flags the test harnesses' stores (`iam.stores.is_test`) so they never reach a public surface.
- Deletes test stores and placeholder listings (`untitled-draft-listing-*`, `harness-test-listing-*`)
  that nothing references; **archives** (never hard-deletes) any store/listing an order or review
  references.
- Keeps the **oldest** of each duplicate listing family, archives the rest, and registers a 301 from
  each archived slug to the survivor (`iam.listing_redirects`).
- Never touches the curated NanoAfrica catalogue (`src/data/catalog_products.js`) or order history.

## Run order
```bash
# 0. SNAPSHOT the database first (Supabase dashboard → Database → Backups, or pg_dump). This is the
#    only rollback — the steps below have no automatic cross-table undo.

# 1. Apply the migrations (adds a column + a table + RLS; additive and safe to leave in place).
node scripts/apply_migration.js 023_store_is_test_flag.sql
node scripts/apply_migration.js 024_listing_redirects.sql

# 2. DRY RUN — prints the plan and before/after counts, changes nothing.
node scripts/cleanup_junk_data.js

# 3. Review the plan. When it looks right, execute:
node scripts/cleanup_junk_data.js --apply

# 4. Rebuild/resubmit the sitemap (archived rows and test stores drop out).
#    The live sitemap regenerates on its own cache cycle; resubmit in Search Console if you want it now.
```

## Rollback
Restore the snapshot from step 0. The migrations may be left in place (the `is_test` column defaults
to false; `listing_redirects` is empty until the script writes to it). To undo only the code, revert the
branch — nothing here deploys on its own.

## Not done by this runbook (separate, flagged in the PR)
The app-facing hardcoded values (announcement banner dates, the category frontend copies, the demo
products, and the browser/admin halves of the currency formatter) live in the baked shell generator
`build_redesign.py` and need their own change — see the PR description. WhatsApp number and maintenance
mode are already platform settings editable in SuperAdmin; no action needed.
