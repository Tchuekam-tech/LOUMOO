-- 024_listing_redirects.sql
-- Cleanup brief, Steps 3 & 5: when a live listing's slug changes, or a duplicate listing is
-- archived in favour of a canonical one, the old URL must keep working — a 301 to the surviving
-- slug so shared links and the search index do not break.
--
-- A tiny lookup table, consulted by the prerender ONLY when a /product/<slug> matches no live
-- listing (so it never touches the hot path of a real product page). old_slug is the URL that used
-- to resolve; target_listing_id is the listing it should now 301 to. The prerender resolves the
-- target's CURRENT slug at request time, so if the target is itself later re-slugged the redirect
-- still lands on the right page. A row whose target is gone (set null) stops redirecting and the
-- old URL becomes a normal 404 — never a redirect into nothing.
--
-- scripts/cleanup_junk_data.js writes the rows (e.g. the two duplicate "MacBook Air M3" listings
-- point at the oldest). Curated-catalogue legacy URLs do NOT use this table — they are handled in
-- the repository with no database (server/modules/catalog/domain/CuratedUrls.js).

CREATE TABLE IF NOT EXISTS iam.listing_redirects (
    old_slug          VARCHAR(255) PRIMARY KEY,
    target_listing_id VARCHAR(64) REFERENCES iam.listings(id) ON DELETE SET NULL,
    reason            VARCHAR(64) NOT NULL DEFAULT 'dedup',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listing_redirects_target ON iam.listing_redirects(target_listing_id);

-- Server-only table (the prerender reads it through the service-role admin client, which bypasses
-- RLS). Enable RLS with a service-role-only policy and revoke the API roles, exactly like iam.roles
-- (migration 022), so the anon key /api/config hands every browser cannot read or write redirects.
-- tests/unit/rls_coverage.test.js fails for any iam/system table left without RLS.
ALTER TABLE iam.listing_redirects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to listing_redirects" ON iam.listing_redirects;
CREATE POLICY "Service role full access to listing_redirects"
    ON iam.listing_redirects FOR ALL TO service_role
    USING (true) WITH CHECK (true);

REVOKE ALL ON iam.listing_redirects FROM PUBLIC, anon, authenticated;
GRANT ALL ON iam.listing_redirects TO service_role;
