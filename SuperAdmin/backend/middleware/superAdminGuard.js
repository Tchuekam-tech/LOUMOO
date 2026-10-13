/**
 * LOUMOO SuperAdmin — superAdminGuard
 * ---------------------------------------------------------------------------
 * RBAC authorization guard ensuring only users with 'admin' or 'super_admin'
 * role can access administrative control endpoints.
 *
 * There is exactly one non-session way in, and it is the project's existing
 * test-authentication mechanism rather than a second, private one: a
 * `loumoo_test:<LOUMOO_TEST_AUTH_SECRET>:<TEST_SUPER_ADMIN_SUBJECT>` bearer
 * token. `SupabaseIdentityProvider` owns the verification — it refuses the whole
 * `loumoo_test:` scheme unless `config.testAuth.enabled` (NODE_ENV is not
 * production AND the secret is explicitly configured) and compares the secret in
 * constant time. A deployment that never sets the secret therefore has no
 * bypass, whatever its NODE_ENV is spelled.
 *
 * Earlier revisions granted super-admin for the literal bearer tokens
 * 'admin_token' / 'user_admin', for any token merely CONTAINING 'super_admin',
 * and for the header `x-admin-key: loumoo_dev_admin`, all whenever NODE_ENV was
 * anything but 'production' — i.e. on staging, on development, and on any
 * deployment where NODE_ENV was unset or misspelled.
 */

const { Role, ROLES } = require('../../../server/modules/identity/value-objects/Role');
const { AuthenticationError, AuthorizationError } = require('../../../server/shared/errors/AppError');
const { extractBearerToken, requireAuth } = require('../../../server/modules/identity/presentation/guards/authGuard');
const SupabaseIdentityProvider = require('../../../server/modules/identity/infrastructure/SupabaseIdentityProvider');

const TEST_TOKEN_PREFIX = 'loumoo_test:';

/**
 * The one test-token subject that is treated as a super administrator.
 *
 * It is deliberately NOT "any valid test token": the harness also mints tokens
 * for ordinary customers and sellers (`harness.createUser()`), and those must
 * keep resolving to their real profile so the suites can prove an ordinary
 * account is refused on admin routes.
 */
const TEST_SUPER_ADMIN_SUBJECT = 'loumoo_test_super_admin';

async function requireSuperAdminRole(req, res, next) {
  // If principal is already attached by upstream requireAuth:
  if (req.principal) {
    const role = req.principal.primaryRole || req.principal.role || 'customer';
    if (Role.hasRole(role, ROLES.ADMIN)) {
      return next();
    }
    return next(new AuthorizationError('Administrative privileges required.'));
  }

  const token = extractBearerToken(req);

  // Test harness only. verifySessionToken throws (401) for a `loumoo_test:`
  // token when test auth is not enabled or the secret is wrong; for any other
  // subject we fall through to normal session verification and role checks.
  if (token && token.startsWith(TEST_TOKEN_PREFIX)) {
    try {
      const claims = await SupabaseIdentityProvider.verifySessionToken(token);
      if (claims.source === 'test-harness' && claims.userId === TEST_SUPER_ADMIN_SUBJECT) {
        req.principal = {
          id: TEST_SUPER_ADMIN_SUBJECT,
          primaryRole: ROLES.SUPER_ADMIN,
          email: claims.email
        };
        return next();
      }
    } catch (testAuthErr) {
      return next(testAuthErr);
    }
  }

  if (!token) {
    return next(new AuthenticationError('Authentication required. Sign in as administrator to continue.'));
  }

  // Cryptographically verify session token via identity provider
  try {
    await new Promise((resolve, reject) => {
      requireAuth(req, res, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    if (req.principal) {
      const role = req.principal.primaryRole || req.principal.role || 'customer';
      if (Role.hasRole(role, ROLES.ADMIN)) {
        return next();
      }
      return next(new AuthorizationError('Administrative privileges required.'));
    }
  } catch (authErr) {
    return next(authErr);
  }

  return next(new AuthorizationError('Super Administrator access is required.'));
}

/**
 * Stricter than requireSuperAdminRole: only `super_admin`. It runs AFTER
 * requireSuperAdminRole (the router applies that to every route), which has already
 * authenticated the caller and attached `req.principal`.
 *
 * `admin` and `super_admin` used to be interchangeable on /api/v1/admin/*, so an `admin`
 * could promote any account (itself included) to `super_admin`, rewrite platform
 * settings or switch maintenance mode on. The operations that make someone a platform
 * owner now require the platform owner (docs/ROUTING.md, "Admin vs super admin").
 */
function requireSuperAdminOnly(req, res, next) {
  const role = (req.principal && (req.principal.primaryRole || req.principal.role)) || 'customer';
  if (Role.hasRole(role, ROLES.SUPER_ADMIN)) return next();
  return next(new AuthorizationError('Super administrator privileges required.'));
}

module.exports = {
  requireSuperAdminRole,
  requireSuperAdminOnly,
  TEST_SUPER_ADMIN_SUBJECT
};
