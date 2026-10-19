/**
 * LOUMOO SuperAdmin — SuperAdminUsersController
 * ---------------------------------------------------------------------------
 * Handles user directory search, profile inspection, role elevation (RBAC),
 * and KYC verification status overrides.
 */

const SuperAdminService = require('../services/SuperAdminService');
const { ValidationError, AuthorizationError } = require('../../../server/shared/errors/AppError');
const { Role, ROLES } = require('../../../server/modules/identity/value-objects/Role');
const { clientIp } = require('../utils/clientIp');

/**
 * What the generic "edit this user" endpoint may change. It used to spread the request
 * body straight into the profile row, so `{ "primary_role": "super_admin" }` (or any
 * other column: clerk_user_id, status, seller_status...) was accepted from any admin.
 * Role changes have their own super-admin-only route; KYC has its own route; everything
 * that is not a plain moderation edit is refused rather than silently ignored.
 */
const EDITABLE_USER_FIELDS = Object.freeze(['first_name', 'last_name', 'city', 'avatar_url', 'phone_number', 'status']);
const VALID_STATUSES = Object.freeze(['active', 'suspended', 'deactivated']);

class SuperAdminUsersController {
  static async listUsers(req, res, next) {
    try {
      const role = req.query.role || null;
      const kyc = req.query.kyc || req.query.kyc_status || null;
      const search = req.query.search || null;
      const limit = parseInt(req.query.limit, 10) || 50;
      const offset = parseInt(req.query.offset, 10) || 0;

      const users = await SuperAdminService.listUsers({ role, kyc, search, limit, offset });
      res.json({
        success: true,
        data: {
          users,
          count: users.length,
          limit,
          offset
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getUser(req, res, next) {
    try {
      const { id } = req.params;
      const user = await SuperAdminService.getUserDetail(id);
      res.json({
        success: true,
        data: { user }
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateUser(req, res, next) {
    try {
      const { id } = req.params;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { reason, ...updates } = body;
      const adminId = (req.principal && req.principal.id) || 'super_admin';
      const ipAddress = clientIp(req);

      const rejected = Object.keys(updates).filter(k => !EDITABLE_USER_FIELDS.includes(k));
      if (rejected.length) {
        throw new ValidationError(
          `These fields cannot be changed here: ${rejected.join(', ')}. Editable: ${EDITABLE_USER_FIELDS.join(', ')}. ` +
          'Roles are changed by a super administrator on /users/:id/role.'
        );
      }
      if (!Object.keys(updates).length) throw new ValidationError('Nothing to update.');
      if ('status' in updates && !VALID_STATUSES.includes(updates.status)) {
        throw new ValidationError(`Invalid status [${updates.status}]. Allowed: ${VALID_STATUSES.join(', ')}`);
      }

      // An administrator cannot act on an account that outranks them (e.g. suspend a super admin).
      const actorRole = (req.principal && (req.principal.primaryRole || req.principal.role)) || 'customer';
      const target = await SuperAdminService.getUserDetail(id);
      const targetRole = target.primary_role || target.primaryRole || 'customer';
      if (Role.hasRole(targetRole, ROLES.ADMIN) && !Role.hasRole(actorRole, ROLES.SUPER_ADMIN)) {
        throw new AuthorizationError('Only a super administrator can change an administrator account.');
      }

      const user = await SuperAdminService.updateUser(id, updates, {
        adminId,
        reason: reason || null,
        ipAddress
      });

      res.json({
        success: true,
        message: `User ${id} successfully updated.`,
        data: { user }
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateUserRole(req, res, next) {
    try {
      const { id } = req.params;
      const role = req.body.role || req.body.primary_role || req.body;
      const adminId = (req.principal && req.principal.id) || 'super_admin';
      const ipAddress = clientIp(req);

      const user = await SuperAdminService.updateUserRole(id, role, {
        adminId,
        actorRole: (req.principal && (req.principal.primaryRole || req.principal.role)) || 'customer',
        reason: req.body.reason || null,
        ipAddress
      });

      res.json({
        success: true,
        message: `User ${id} role updated to ${user.primary_role}.`,
        data: { user }
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateUserKyc(req, res, next) {
    try {
      const { id } = req.params;
      const status = req.body.status || req.body.kyc_status || req.body;
      const adminId = (req.principal && req.principal.id) || 'super_admin';
      const ipAddress = clientIp(req);

      const user = await SuperAdminService.updateUserKyc(id, status, {
        adminId,
        reason: req.body.reason || null,
        ipAddress
      });

      res.json({
        success: true,
        message: `User ${id} KYC status updated to ${user.kyc_status}.`,
        data: { user }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = SuperAdminUsersController;
