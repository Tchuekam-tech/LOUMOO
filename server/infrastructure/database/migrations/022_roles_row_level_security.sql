-- ============================================================================
-- 022 — Row Level Security on iam.roles
-- ----------------------------------------------------------------------------
-- iam.roles (001) was the only table in the API-exposed `iam` schema created
-- without RLS. Supabase grants the API roles (anon, authenticated) table
-- privileges on application schemas, so with RLS off anyone holding the public
-- anon key could read AND write the role catalogue through PostgREST — including
-- DELETE, which cascades to iam.user_roles.
--
-- Nothing in the application reads iam.roles through the API roles: the server
-- uses the service role, and authorization is decided from profiles.primary_role.
-- So the table becomes service-role only, like the other internal tables.
--
-- Additive and re-runnable (scripts/apply_migration.js --all re-applies every
-- file): ENABLE is idempotent, the policy is dropped before it is created, and
-- REVOKE/GRANT are repeatable. No row is touched.
-- ============================================================================

ALTER TABLE iam.roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to roles" ON iam.roles;
CREATE POLICY "Service role full access to roles"
    ON iam.roles FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- RLS with no policy for them already denies anon/authenticated every row; the
-- privileges are removed as well so a future permissive policy cannot reopen it.
REVOKE ALL ON iam.roles FROM PUBLIC, anon, authenticated;
GRANT ALL ON iam.roles TO service_role;
