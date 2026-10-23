/**
 * Identity & Commercial Module — Organization & Team Application Service
 * ---------------------------------------------------------------------------
 * Coordinates organization creation, team membership, permissions, and
 * organization-managed commercial entities.
 */

'use strict';

const { Organization, OrganizationMember, ORG_ROLES, ROLE_PERMISSIONS } = require('../domain/Organization');
const { SupabaseClient, handleDatabaseFailure } = require('../../../infrastructure/database/SupabaseClient');
const { NotFoundError, UnauthorizedError, ValidationError, ConflictError } = require('../../../shared/errors/AppError');
const logger = require('../../../shared/logging/logger');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class OrganizationService {
  /**
   * Create an organization and establish the creator as OWNER.
   */
  static async createOrganization(principal, payload = {}) {
    Organization.validate(payload);

    const baseSlug = Organization.slugify(payload.slug || payload.name);
    let finalSlug = baseSlug;
    const adminDb = SupabaseClient.getAdmin();

    // Check slug uniqueness
    try {
      const { data: existing } = await adminDb
        .from('organizations')
        .select('id')
        .eq('slug', baseSlug)
        .maybeSingle();

      if (existing) {
        finalSlug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
      }
    } catch (err) {
      handleDatabaseFailure(err, 'Check org slug');
    }

    const orgRow = {
      owner_id: principal.id,
      name: String(payload.name).trim(),
      slug: finalSlug,
      legal_name: payload.legalName || null,
      org_type: (payload.orgType || 'COMPANY').toUpperCase(),
      logo_url: payload.logoUrl || null,
      cover_url: payload.coverUrl || null,
      description: payload.description || null,
      email: payload.email || principal.email || null,
      phone_number: payload.phoneNumber || principal.phoneNumber || null,
      website_url: payload.websiteUrl || null,
      city: payload.city || principal.city || 'Douala',
      country: payload.country || 'Cameroon',
      status: 'ACTIVE',
      metadata: payload.metadata || {}
    };

    let createdOrg = null;
    try {
      const { data, error } = await adminDb
        .from('organizations')
        .insert(orgRow)
        .select()
        .single();

      if (error) throw error;
      createdOrg = new Organization(data);

      // Add owner to members table
      await adminDb
        .from('organization_members')
        .insert({
          organization_id: createdOrg.id,
          user_id: principal.id,
          role: ORG_ROLES.OWNER,
          permissions: ROLE_PERMISSIONS[ORG_ROLES.OWNER],
          status: 'ACTIVE'
        });

      logger.info(`[Organization] Created org ${createdOrg.id} (${createdOrg.slug}) by user ${principal.id}`);
    } catch (err) {
      if (err.code === '23505') {
        throw new ConflictError('An organization with this slug already exists.');
      }
      handleDatabaseFailure(err, 'Create organization');
      createdOrg = new Organization({ id: `org_${Date.now()}`, ...orgRow });
    }

    return createdOrg.toOwnerJSON();
  }

  /**
   * Update organization details (Owner/Admin only).
   */
  static async updateOrganization(orgId, requestingPrincipal, payload = {}) {
    const org = await this.getOrganizationRaw(orgId);
    const isOwner = org.ownerId === requestingPrincipal.id || requestingPrincipal.primaryRole === 'admin';
    const requesterMembership = await this.getMembership(org.id, requestingPrincipal.id);
    const isAdmin = requesterMembership && (requesterMembership.role === ORG_ROLES.OWNER || requesterMembership.role === ORG_ROLES.ADMIN);

    if (!isOwner && !isAdmin) {
      throw new UnauthorizedError('Only organization owners and administrators can modify organization settings.');
    }

    const updates = {};
    if (payload.name) updates.name = String(payload.name).trim();
    if (payload.legalName !== undefined) updates.legal_name = payload.legalName;
    if (payload.orgType) {
      const orgType = String(payload.orgType).toUpperCase();
      if (!Object.values(Organization.TYPES).includes(orgType)) {
        throw new ValidationError(`Invalid orgType '${payload.orgType}'.`);
      }
      updates.org_type = orgType;
    }
    if (payload.logoUrl !== undefined) updates.logo_url = payload.logoUrl;
    if (payload.coverUrl !== undefined) updates.cover_url = payload.coverUrl;
    if (payload.description !== undefined) updates.description = payload.description;
    if (payload.email !== undefined) updates.email = payload.email;
    if (payload.phoneNumber !== undefined) updates.phone_number = payload.phoneNumber;
    if (payload.websiteUrl !== undefined) updates.website_url = payload.websiteUrl;
    if (payload.city) updates.city = payload.city;
    if (payload.country) updates.country = payload.country;
    updates.updated_at = new Date().toISOString();

    const adminDb = SupabaseClient.getAdmin();
    try {
      const { data, error } = await adminDb
        .from('organizations')
        .update(updates)
        .eq('id', org.id)
        .select()
        .single();

      if (error) throw error;
      logger.info(`[Organization] Updated org ${org.id} by user ${requestingPrincipal.id}`);
      return new Organization(data).toOwnerJSON();
    } catch (err) {
      handleDatabaseFailure(err, 'Update organization');
      return { id: org.id, ...updates };
    }
  }

  /**
   * Soft-delete/deactivate organization (Owner only).
   */
  static async deleteOrganization(orgId, requestingPrincipal) {
    const org = await this.getOrganizationRaw(orgId);
    if (org.ownerId !== requestingPrincipal.id && requestingPrincipal.primaryRole !== 'admin') {
      throw new UnauthorizedError('Only the organization owner can deactivate this organization.');
    }

    const adminDb = SupabaseClient.getAdmin();
    try {
      await adminDb
        .from('organizations')
        .update({
          status: 'ARCHIVED',
          deleted_at: new Date().toISOString()
        })
        .eq('id', org.id);

      logger.info(`[Organization] Deactivated org ${org.id} by user ${requestingPrincipal.id}`);
      return { success: true, deactivatedOrgId: org.id };
    } catch (err) {
      handleDatabaseFailure(err, 'Delete organization');
      return { success: true, deactivatedOrgId: org.id };
    }
  }

  /**
   * Get raw organization entity by ID or Slug.
   */
  static async getOrganizationRaw(orgIdOrSlug) {
    const adminDb = SupabaseClient.getAdmin();
    let row = null;

    try {
      let query = adminDb.from('organizations').select('*');

      if (UUID_REGEX.test(orgIdOrSlug) || orgIdOrSlug.startsWith('org_')) {
        query = query.eq('id', orgIdOrSlug);
      } else {
        query = query.eq('slug', orgIdOrSlug.toLowerCase());
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      row = data;
    } catch (err) {
      handleDatabaseFailure(err, 'Get raw organization');
    }

    if (!row || row.deleted_at) {
      throw new NotFoundError('Organization', orgIdOrSlug);
    }

    return new Organization(row);
  }

  /**
   * Get organization by ID or Slug for presentation.
   */
  static async getOrganization(orgIdOrSlug, requestingPrincipal = null) {
    const org = await this.getOrganizationRaw(orgIdOrSlug);
    const isOwner = requestingPrincipal && (requestingPrincipal.id === org.ownerId || requestingPrincipal.primaryRole === 'admin');

    if (isOwner) {
      return org.toOwnerJSON();
    }

    // Check if requester is an active member
    if (requestingPrincipal) {
      const membership = await this.getMembership(org.id, requestingPrincipal.id);
      if (membership && membership.status === 'ACTIVE') {
        return {
          ...org.toOwnerJSON(),
          currentMemberRole: membership.role,
          currentMemberPermissions: membership.permissions
        };
      }
    }

    return org.toPublicJSON();
  }

  /**
   * Check membership for a user in an organization.
   */
  static async getMembership(orgId, userId) {
    const adminDb = SupabaseClient.getAdmin();
    try {
      const { data, error } = await adminDb
        .from('organization_members')
        .select('*')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      return data ? new OrganizationMember(data) : null;
    } catch (err) {
      handleDatabaseFailure(err, 'Get org membership');
      return null;
    }
  }

  /**
   * List organizations for a user.
   */
  static async listUserOrganizations(userId) {
    const adminDb = SupabaseClient.getAdmin();
    try {
      const { data, error } = await adminDb
        .from('organization_members')
        .select(`
          role,
          status,
          created_at,
          organizations:organization_id (
            id,
            name,
            slug,
            org_type,
            logo_url,
            cover_url,
            status,
            city,
            country
          )
        `)
        .eq('user_id', userId)
        .eq('status', 'ACTIVE');

      if (error) throw error;
      return (data || []).map(row => ({
        role: row.role,
        status: row.status,
        joinedAt: row.created_at,
        organization: row.organizations
      }));
    } catch (err) {
      handleDatabaseFailure(err, 'List user organizations');
      return [];
    }
  }

  /**
   * List members of an organization.
   */
  static async listMembers(orgId, requestingPrincipal) {
    // Verify requester access
    const requesterMembership = await this.getMembership(orgId, requestingPrincipal.id);
    const isOwner = requesterMembership && (requesterMembership.role === ORG_ROLES.OWNER || requesterMembership.role === ORG_ROLES.ADMIN);
    const isMember = requesterMembership && requesterMembership.status === 'ACTIVE';

    if (!isMember && requestingPrincipal.primaryRole !== 'admin') {
      throw new UnauthorizedError('You are not a member of this organization.');
    }

    const adminDb = SupabaseClient.getAdmin();
    try {
      const { data, error } = await adminDb
        .from('organization_members')
        .select(`
          id,
          organization_id,
          user_id,
          role,
          permissions,
          status,
          created_at,
          profiles:user_id (
            id,
            first_name,
            last_name,
            email,
            avatar_url,
            username
          )
        `)
        .eq('organization_id', orgId);

      if (error) throw error;
      return (data || []).map(m => ({
        id: m.id,
        organizationId: m.organization_id,
        userId: m.user_id,
        role: m.role,
        permissions: m.permissions,
        status: m.status,
        createdAt: m.created_at,
        user: m.profiles ? {
          id: m.profiles.id,
          name: `${m.profiles.first_name || ''} ${m.profiles.last_name || ''}`.trim() || 'LOUMOO Member',
          email: isOwner ? m.profiles.email : undefined,
          avatarUrl: m.profiles.avatar_url,
          username: m.profiles.username
        } : null
      }));
    } catch (err) {
      handleDatabaseFailure(err, 'List org members');
      return [];
    }
  }

  /**
   * Add or invite a member to an organization.
   */
  static async addMember(orgId, requestingPrincipal, payload = {}) {
    const { userId, role = ORG_ROLES.MEMBER, permissions } = payload;
    if (!userId) throw new ValidationError('Target userId is required to add an organization member.');

    const targetRole = String(role).toUpperCase();
    if (!Object.values(ORG_ROLES).includes(targetRole)) {
      throw new ValidationError(`Invalid role '${role}'. Allowed: ${Object.values(ORG_ROLES).join(', ')}`);
    }

    // Permission check
    const requesterMembership = await this.getMembership(orgId, requestingPrincipal.id);
    if (!requesterMembership || !requesterMembership.hasPermission('org.manage_members')) {
      if (!requesterMembership || (requesterMembership.role !== ORG_ROLES.OWNER && requesterMembership.role !== ORG_ROLES.ADMIN)) {
        throw new UnauthorizedError('You do not have permission to manage members for this organization.');
      }
    }

    // Only the OWNER may hand out the OWNER role. Without this an ADMIN could
    // upsert their own membership to OWNER through this endpoint and bypass the
    // owner-only guard in updateMember().
    if (targetRole === ORG_ROLES.OWNER && (!requesterMembership || requesterMembership.role !== ORG_ROLES.OWNER)) {
      throw new UnauthorizedError('Only the organization owner can grant the OWNER role.');
    }

    const assignedPermissions = this._resolveGrantedPermissions(requesterMembership, targetRole, permissions);
    const adminDb = SupabaseClient.getAdmin();

    try {
      const { data, error } = await adminDb
        .from('organization_members')
        .upsert({
          organization_id: orgId,
          user_id: userId,
          role: targetRole,
          permissions: assignedPermissions,
          status: 'ACTIVE',
          invited_by: requestingPrincipal.id,
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      logger.info(`[Organization] Added user ${userId} to org ${orgId} as ${targetRole}`);
      return new OrganizationMember(data).toJSON();
    } catch (err) {
      handleDatabaseFailure(err, 'Add org member');
      return {
        organizationId: orgId,
        userId,
        role: targetRole,
        permissions: assignedPermissions,
        status: 'ACTIVE'
      };
    }
  }

  /**
   * Client-supplied permissions may never exceed what the requester holds.
   * Without this an ADMIN could upsert ['*'] onto any non-owner membership —
   * their own included — and become owner-equivalent via hasPermission().
   */
  static _resolveGrantedPermissions(requesterMembership, role, permissions) {
    if (permissions === undefined || permissions === null) {
      return ROLE_PERMISSIONS[role] || ['org.view'];
    }
    if (!Array.isArray(permissions) || !permissions.every(p => typeof p === 'string' && p)) {
      throw new ValidationError('permissions must be an array of permission strings.');
    }
    if (requesterMembership.role !== ORG_ROLES.OWNER) {
      const exceeding = permissions.filter(p => p === '*' || !requesterMembership.hasPermission(p));
      if (exceeding.length) {
        throw new UnauthorizedError(`You cannot grant permissions you do not hold: ${exceeding.join(', ')}`);
      }
    }
    return permissions;
  }

  /**
   * Update a member's role or status.
   */
  static async updateMember(orgId, requestingPrincipal, targetUserId, payload = {}) {
    const requesterMembership = await this.getMembership(orgId, requestingPrincipal.id);
    if (!requesterMembership || (requesterMembership.role !== ORG_ROLES.OWNER && requesterMembership.role !== ORG_ROLES.ADMIN)) {
      throw new UnauthorizedError('Only organization owners and admins can update member roles.');
    }

    const targetMembership = await this.getMembership(orgId, targetUserId);
    if (!targetMembership) {
      throw new NotFoundError('Organization member', targetUserId);
    }

    if (targetMembership.role === ORG_ROLES.OWNER && requesterMembership.role !== ORG_ROLES.OWNER) {
      throw new UnauthorizedError('Only the organization owner can modify the owner membership.');
    }

    const updateData = {};
    if (payload.role) {
      const role = String(payload.role).toUpperCase();
      if (!Object.values(ORG_ROLES).includes(role)) {
        throw new ValidationError(`Invalid role '${payload.role}'.`);
      }
      // The same rule addMember enforces, and for the same reason. The guard
      // above only protects a membership that is ALREADY the owner's, so an
      // ADMIN could promote any ordinary member — their own membership
      // included — to OWNER, whose role permissions are ['*']. That is the
      // whole escalation in one request.
      if (role === ORG_ROLES.OWNER && requesterMembership.role !== ORG_ROLES.OWNER) {
        throw new UnauthorizedError('Only the organization owner can grant the OWNER role.');
      }
      updateData.role = role;
      updateData.permissions = this._resolveGrantedPermissions(requesterMembership, role, payload.permissions);
    }
    if (payload.status) {
      updateData.status = String(payload.status).toUpperCase();
    }
    updateData.updated_at = new Date().toISOString();

    const adminDb = SupabaseClient.getAdmin();
    try {
      const { data, error } = await adminDb
        .from('organization_members')
        .update(updateData)
        .eq('organization_id', orgId)
        .eq('user_id', targetUserId)
        .select()
        .single();

      if (error) throw error;
      return new OrganizationMember(data).toJSON();
    } catch (err) {
      handleDatabaseFailure(err, 'Update org member');
      return { organizationId: orgId, userId: targetUserId, ...updateData };
    }
  }

  /**
   * Remove a member from an organization.
   */
  static async removeMember(orgId, requestingPrincipal, targetUserId) {
    const isSelf = requestingPrincipal.id === targetUserId;
    const requesterMembership = await this.getMembership(orgId, requestingPrincipal.id);

    if (!isSelf && (!requesterMembership || (requesterMembership.role !== ORG_ROLES.OWNER && requesterMembership.role !== ORG_ROLES.ADMIN))) {
      throw new UnauthorizedError('You do not have permission to remove this member.');
    }

    const targetMembership = await this.getMembership(orgId, targetUserId);
    if (!targetMembership) {
      throw new NotFoundError('Organization member', targetUserId);
    }

    if (targetMembership.role === ORG_ROLES.OWNER) {
      throw new ValidationError('The organization owner cannot be removed. Transfer ownership first.');
    }

    const adminDb = SupabaseClient.getAdmin();
    try {
      const { error } = await adminDb
        .from('organization_members')
        .delete()
        .eq('organization_id', orgId)
        .eq('user_id', targetUserId);

      if (error) throw error;
      logger.info(`[Organization] Removed user ${targetUserId} from org ${orgId}`);
      return { success: true, removedUserId: targetUserId };
    } catch (err) {
      handleDatabaseFailure(err, 'Remove org member');
      return { success: true, removedUserId: targetUserId };
    }
  }
}

module.exports = OrganizationService;