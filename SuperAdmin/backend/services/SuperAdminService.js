/**
 * LOUMOO SuperAdmin — SuperAdminService
 * ---------------------------------------------------------------------------
 * Core application service orchestrating business validation, settings
 * persistence, and tamper-evident audit log creation.
 */

const SuperAdminRepository = require('../repositories/SuperAdminRepository');
const { ValidationError, AuthorizationError } = require('../../../server/shared/errors/AppError');
const logger = require('../../../server/shared/logging/logger');
const CacheService = require('../../../server/infrastructure/cache/CacheService');

class SuperAdminService {
  /**
   * Retrieves all dynamic settings, applying sanitization and caching.
   */
  static async getSystemSettings() {
    try {
      if (CacheService && typeof CacheService.remember === 'function') {
        return await CacheService.remember('system_settings:all', 60, () => SuperAdminRepository.getAllSettings(), 'admin');
      }
    } catch (_) {}
    return await SuperAdminRepository.getAllSettings();
  }

  /**
   * Browser-safe settings for the public, unauthenticated bootstrap endpoints
   * (/api/config, /api/v1/config). Deny-by-default projection — see
   * SuperAdminRepository.getPublicSettings. Never use this for admin surfaces,
   * and never use getSystemSettings for a public response.
   */
  static async getPublicSystemSettings() {
    try {
      if (CacheService && typeof CacheService.remember === 'function') {
        return await CacheService.remember('system_settings:public', 60, () => SuperAdminRepository.getPublicSettings(), 'admin');
      }
    } catch (_) {}
    return await SuperAdminRepository.getPublicSettings();
  }

  /**
   * Retrieves a single system setting.
   */
  static async getSystemSetting(key) {
    if (!key || typeof key !== 'string') {
      throw new ValidationError('A valid setting key must be provided.');
    }
    try {
      if (CacheService && typeof CacheService.remember === 'function') {
        return await CacheService.remember(`system_setting:${key}`, 60, () => SuperAdminRepository.getSetting(key), 'admin');
      }
    } catch (_) {}
    return await SuperAdminRepository.getSetting(key);
  }

  /**
   * Updates a system setting, validating its structure, invalidating cache, and logging the audit event.
   */
  static async updateSystemSetting(key, value, { adminId = 'super_admin', reason = null, ipAddress = null } = {}) {
    if (!key || typeof key !== 'string') {
      throw new ValidationError('A valid setting key is required.');
    }
    if (value === undefined || value === null) {
      throw new ValidationError('A setting value payload must be provided.');
    }

    // Specific domain validations
    if (key === 'platform_commission_rate') {
      if (typeof value.rate_percent !== 'number' || !Number.isFinite(value.rate_percent) || value.rate_percent < 0 || value.rate_percent > 50) {
        throw new ValidationError('Platform commission rate must be a number between 0% and 50%.');
      }
      if (value.payout_fee_fixed_xaf !== undefined) {
        if (typeof value.payout_fee_fixed_xaf !== 'number' || !Number.isInteger(value.payout_fee_fixed_xaf) || value.payout_fee_fixed_xaf < 0 || value.payout_fee_fixed_xaf > 50000) {
          throw new ValidationError('Payout fee must be an integer between 0 and 50,000 XAF.');
        }
      }
      if (value.escrow_hold_days !== undefined) {
        if (typeof value.escrow_hold_days !== 'number' || !Number.isInteger(value.escrow_hold_days) || value.escrow_hold_days < 1 || value.escrow_hold_days > 60) {
          throw new ValidationError('Escrow hold period must be an integer between 1 and 60 days.');
        }
      }
    } else if (key === 'seller_whatsapp_default') {
      if (!value.number || String(value.number).replace(/\D/g, '').length < 8) {
        throw new ValidationError('A valid WhatsApp phone number must be provided.');
      }
      if (value.label && (typeof value.label !== 'string' || value.label.length > 100)) {
        throw new ValidationError('WhatsApp hotline label must be a string up to 100 characters.');
      }
    } else if (key === 'maintenance_mode') {
      if (typeof value.enabled !== 'boolean') {
        throw new ValidationError('Maintenance mode enabled must be a boolean flag.');
      }
      if (value.banner_text !== undefined && (typeof value.banner_text !== 'string' || value.banner_text.length > 500)) {
        throw new ValidationError('Maintenance banner text must be a string up to 500 characters.');
      }
      if (value.allow_admin_bypass !== undefined && typeof value.allow_admin_bypass !== 'boolean') {
        throw new ValidationError('allow_admin_bypass must be a boolean flag.');
      }
    } else if (key === 'shipping_rates_by_city') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
        throw new ValidationError('Shipping rates must be a non-empty object mapping city names to delivery fees.');
      }
      for (const [city, rate] of Object.entries(value)) {
        if (typeof city !== 'string' || !city.trim() || city.length > 60) {
          throw new ValidationError('City name must be a valid non-empty string up to 60 characters.');
        }
        if (typeof rate !== 'number' || !Number.isInteger(rate) || rate < 0 || rate > 100000) {
          throw new ValidationError(`Delivery fee for ${city} must be an integer between 0 and 100,000 XAF.`);
        }
      }
    } else if (key === 'announcement_banner') {
      const active = value.active !== undefined ? value.active : value.enabled;
      if (typeof active !== 'boolean') {
        throw new ValidationError('Announcement active status must be a boolean.');
      }
      const msg = value.message || value.text_fr;
      if (!msg || typeof msg !== 'string' || msg.trim().length === 0) {
        throw new ValidationError('Announcement banner must include a non-empty message.');
      }
      if (msg.length > 500) {
        throw new ValidationError('Announcement banner text must not exceed 500 characters.');
      }
      const ctaUrl = value.cta_url || value.link;
      if (ctaUrl !== undefined && ctaUrl !== null && ctaUrl !== '') {
        if (typeof ctaUrl !== 'string' || ctaUrl.length > 2048) {
          throw new ValidationError('Call to action URL must be a valid string up to 2048 characters.');
        }
        if (/^\s*(javascript|data|vbscript):/i.test(ctaUrl) || /^\/\//.test(ctaUrl)) {
          throw new ValidationError('Unsafe URL scheme detected in announcement banner.');
        }
        if (!/^(\/[^/\\]|https?:\/\/)/i.test(ctaUrl)) {
          throw new ValidationError('Announcement CTA URL must be a relative path or an http/https URL.');
        }
      }
    } else if (key === 'feature_flags') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
        throw new ValidationError('Feature flags must be a non-empty object of key-value boolean flags.');
      }
      for (const [flag, enabled] of Object.entries(value)) {
        if (!/^[a-z0-9_]{2,64}$/i.test(flag)) {
          throw new ValidationError(`Invalid feature flag name [${flag}]. Use alphanumeric characters and underscores.`);
        }
        if (typeof enabled !== 'boolean') {
          throw new ValidationError(`Feature flag [${flag}] must be a boolean value.`);
        }
      }
    }

    const { oldVal } = await SuperAdminRepository.updateSetting(key, value, adminId);

    // Invalidate cache immediately on update
    try {
      if (CacheService && typeof CacheService.delete === 'function') {
        await CacheService.delete('system_settings:all', 'admin');
        await CacheService.delete('system_settings:public', 'admin');
        await CacheService.delete(`system_setting:${key}`, 'admin');
      }
    } catch (_) {}

    // Record audit log
    await SuperAdminRepository.recordAuditLog({
      adminId,
      action: 'setting.update',
      resourceType: 'system_setting',
      resourceId: key,
      oldValues: oldVal,
      newValues: value,
      reason: reason || `Updated system setting [${key}]`,
      ipAddress
    });

    logger.info(`[SuperAdminService] Setting updated: ${key} by ${adminId}`);
    return { success: true, key, value };
  }

  /**
   * Resets a setting back to factory seed defaults.
   */
  static async resetSystemSetting(key, { adminId = 'super_admin', reason = null, ipAddress = null } = {}) {
    if (!key || typeof key !== 'string') {
      throw new ValidationError('A valid setting key is required.');
    }
    if (reason && (typeof reason !== 'string' || reason.length > 500)) {
      throw new ValidationError('Reset reason must be a string up to 500 characters.');
    }
    const updateRes = await SuperAdminRepository.resetSetting(key, adminId);

    // Invalidate cache immediately
    try {
      if (CacheService && typeof CacheService.delete === 'function') {
        await CacheService.delete('system_settings:all', 'admin');
        await CacheService.delete('system_settings:public', 'admin');
        await CacheService.delete(`system_setting:${key}`, 'admin');
      }
    } catch (err) {
      logger.warn(`[SuperAdminService] Cache invalidation warning for ${key}:`, err.message);
    }

    // Record audit log
    await SuperAdminRepository.recordAuditLog({
      adminId,
      action: 'setting.reset',
      resourceType: 'system_setting',
      resourceId: key,
      oldValues: updateRes.oldVal,
      newValues: updateRes.value,
      reason: reason || `Reverted system setting [${key}] to factory defaults`,
      ipAddress
    });

    logger.info(`[SuperAdminService] Setting reset to default: ${key} by ${adminId}`);
    return { success: true, key, value: updateRes.value };
  }

  /**
   * Retrieves list of setting categories.
   */
  static getSettingCategories() {
    return SuperAdminRepository.getSettingCategories();
  }

  /**
   * Retrieves settings grouped by category.
   */
  static async getSettingsByCategory(category) {
    if (!category || typeof category !== 'string') {
      throw new ValidationError('A valid category name is required.');
    }
    return await SuperAdminRepository.getSettingsByCategory(category);
  }

  /**
   * Dedicated emergency maintenance mode toggle.
   */
  static async setMaintenanceMode({ enabled, bannerText = null, allowAdminBypass = true } = {}, { adminId = 'super_admin', ipAddress = null } = {}) {
    if (typeof enabled !== 'boolean') {
      throw new ValidationError('Maintenance status must be specified as a boolean (enabled: true/false).');
    }
    if (bannerText !== null && bannerText !== undefined) {
      if (typeof bannerText !== 'string' || bannerText.length > 500) {
        throw new ValidationError('Maintenance banner text must be a string up to 500 characters.');
      }
    }
    const current = (await SuperAdminRepository.getSetting('maintenance_mode')) || {};
    const updated = {
      ...current,
      enabled,
      banner_text: bannerText || current.banner_text || 'LOUMOO platform upgrade in progress.',
      allow_admin_bypass: allowAdminBypass !== undefined ? Boolean(allowAdminBypass) : true
    };

    const result = await this.updateSystemSetting('maintenance_mode', updated, {
      adminId,
      reason: `Maintenance mode ${enabled ? 'ACTIVATED' : 'DEACTIVATED'} by executive command`,
      ipAddress
    });

    return result;
  }

  /**
   * Updates multiple dynamic system settings in batch, invalidating caches.
   */
  static async updateSystemSettings(payload = {}, { adminId = 'super_admin', reason = null, ipAddress = null } = {}) {
    if (!payload || typeof payload !== 'object') {
      throw new ValidationError('A settings payload object must be provided.');
    }
    const updated = {};
    for (const [k, v] of Object.entries(payload)) {
      if (k === 'reason' || k === 'adminId') continue;
      if (v !== undefined && v !== null && typeof v === 'object') {
        await this.updateSystemSetting(k, v, { adminId, reason: reason || `Batch update setting [${k}]`, ipAddress });
        updated[k] = v;
      }
    }
    try {
      if (CacheService && typeof CacheService.delete === 'function') {
        await CacheService.delete('system_settings:all', 'admin');
      }
    } catch (_) {}
    return { success: true, updated };
  }

  /**
   * Retrieves overview KPIs and operational metrics.
   */
  static async getOverviewMetrics() {
    return await SuperAdminRepository.getOverviewMetrics();
  }

  /**
   * Retrieves paginated and filtered audit logs.
   */
  static async getAuditLogs(options = {}) {
    return await SuperAdminRepository.getAuditLogs(options);
  }

  /**
   * Retrieves unique distinct action types.
   */
  static async getAuditActions() {
    return await SuperAdminRepository.getAuditActions();
  }

  /**
   * Exports audit logs with compliance tracking.
   */
  static async exportAuditLogs(filters = {}, format = 'csv', { adminId = 'super_admin', ipAddress = null } = {}) {
    const exportResult = await SuperAdminRepository.exportAuditLogs(filters, format);

    // Record audit entry for the export itself
    await SuperAdminRepository.recordAuditLog({
      adminId,
      action: 'audit.export',
      resourceType: 'audit_log',
      resourceId: `export_${format}_${Date.now()}`,
      reason: `Exported ${exportResult.count} audit records in ${format.toUpperCase()} format`,
      ipAddress
    });

    return exportResult;
  }

  /**
   * Scrubs sensitive secrets and connection strings from diagnostic health messages.
   */
  static sanitizeHealthErrorMessage(msg) {
    if (!msg) return 'Service communication failure';
    return String(msg)
      .replace(/(postgres|postgresql|redis|mongodb|https?):\/\/[^@\s]+@/gi, '$1://[REDACTED]@')
      .replace(/(bearer\s+|key=|password=|secret=)[^\s&]+/gi, '$1[REDACTED]');
  }

  /**
   * Performs deep diagnostic probes on infrastructure services with timeout and fault isolation.
   */
  static async getDeepHealth() {
    const results = {
      status: 'HEALTHY',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV || 'development',
      services: {
        database: { status: 'ONLINE', latencyMs: 0 },
        cache: { status: 'ONLINE', latencyMs: 0 },
        memory: {
          heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          heapTotalMb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024)
        }
      }
    };

    // Probe Database with 2000ms timeout
    const dbStart = Date.now();
    try {
      const db = SuperAdminRepository.db;
      if (db) {
        const dbPromise = db.from('system_settings').select('key').limit(1);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database probe timed out after 2000ms')), 2000)
        );
        const { error } = await Promise.race([dbPromise, timeoutPromise]);
        if (error) throw error;
        results.services.database.latencyMs = Date.now() - dbStart;
      } else {
        results.services.database.status = 'IN_MEMORY_FALLBACK';
      }
    } catch (err) {
      results.services.database.status = 'DEGRADED';
      results.services.database.error = this.sanitizeHealthErrorMessage(err.message);
      results.status = 'DEGRADED';
    }

    // Probe Redis Cache with 2000ms timeout
    const cacheStart = Date.now();
    try {
      if (CacheService && typeof CacheService.get === 'function') {
        const cachePromise = CacheService.get('health_probe_ping', 'admin');
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Cache probe timed out after 2000ms')), 2000)
        );
        await Promise.race([cachePromise, timeoutPromise]);
        results.services.cache.latencyMs = Date.now() - cacheStart;
      }
    } catch (err) {
      results.services.cache.status = 'DEGRADED';
      results.services.cache.error = this.sanitizeHealthErrorMessage(err.message);
      results.status = 'DEGRADED';
    }

    return results;
  }

  /**
   * Lists stores with optional status/tier filters and search.
   */
  static async listStores(options = {}) {
    return await SuperAdminRepository.listStores(options);
  }

  /**
   * Retrieves full store profile for inspection.
   */
  static async getStoreDetail(id) {
    if (!id) {
      throw new ValidationError('Store ID is required.');
    }
    const store = await SuperAdminRepository.getStoreById(id);
    if (!store) {
      throw new ValidationError(`Store not found with ID ${id}`);
    }
    return store;
  }

  /**
   * Moderates a store, modifying status, tier, contact details, or visibility,
   * and persists an immutable audit log.
   */
  static async moderateStore(id, updates = {}, { adminId = 'super_admin', reason = null, ipAddress = null } = {}) {
    if (!id) {
      throw new ValidationError('Store ID is required.');
    }

    const VALID_STATUSES = ['DRAFT', 'PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'ARCHIVED'];
    if (updates.status && !VALID_STATUSES.includes(updates.status)) {
      throw new ValidationError(`Invalid store status. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    const VALID_TIERS = ['unverified', 'individual_verified', 'pro_merchant', 'official_brand'];
    if (updates.verification_tier && !VALID_TIERS.includes(updates.verification_tier)) {
      throw new ValidationError(`Invalid verification tier. Must be one of: ${VALID_TIERS.join(', ')}`);
    }

    const res = await SuperAdminRepository.updateStore(id, updates, adminId);
    if (!res.success) {
      throw new ValidationError(res.error || 'Failed to update store');
    }

    // Determine specific audit action
    let action = 'store.moderate';
    if (updates.is_verified === true) action = 'store.verify';
    else if (updates.status === 'SUSPENDED') action = 'store.suspend';
    else if (updates.status === 'ACTIVE' && res.oldStore && res.oldStore.status === 'SUSPENDED') action = 'store.reactivate';

    // Record audit log
    await SuperAdminRepository.recordAuditLog({
      adminId,
      action,
      resourceType: 'store',
      resourceId: id,
      oldValues: {
        status: res.oldStore.status,
        is_verified: res.oldStore.is_verified,
        verification_tier: res.oldStore.verification_tier,
        phone_number: res.oldStore.phone_number
      },
      newValues: updates,
      reason: reason || `Admin action [${action}] on store ${res.store.name || id}`,
      ipAddress
    });

    logger.info(`[SuperAdminService] Store ${id} moderated (${action}) by ${adminId}`);
    return res.store;
  }

  /**
   * 1-Click KYC Approval: activates store, marks verified, sets tier, updates owner KYC status.
   */
  static async verifyStoreKyc(id, { tier = 'pro_merchant', reason = 'Store KYC documents verified' } = {}, context = {}) {
    return await this.moderateStore(id, {
      is_verified: true,
      verification_tier: tier,
      status: 'ACTIVE',
      onboarding_completed: true
    }, {
      ...context,
      reason
    });
  }

  /**
   * 1-Click KYC Rejection: marks store unverified and keeps in draft.
   */
  static async rejectStoreKyc(id, { reason = 'KYC documentation insufficient or invalid' } = {}, context = {}) {
    return await this.moderateStore(id, {
      is_verified: false,
      verification_tier: 'unverified',
      status: 'DRAFT'
    }, {
      ...context,
      reason
    });
  }

  /**
   * 1-Click Store Suspension: pulls store and its listings from marketplace discovery.
   */
  static async suspendStore(id, { reason = 'Violation of LOUMOO commercial terms' } = {}, context = {}) {
    return await this.moderateStore(id, {
      status: 'SUSPENDED',
      visibility: 'PRIVATE'
    }, {
      ...context,
      reason
    });
  }

  /**
   * 1-Click Store Reactivation: restores store to active and public.
   */
  static async reactivateStore(id, { reason = 'Suspension resolved' } = {}, context = {}) {
    return await this.moderateStore(id, {
      status: 'ACTIVE',
      visibility: 'PUBLIC'
    }, {
      ...context,
      reason
    });
  }

  /**
   * Batch or flexible system settings update.
   */
  static async updateSystemSettings(payload = {}, context = {}) {
    if (!payload || typeof payload !== 'object') {
      throw new ValidationError('Settings payload must be a valid object.');
    }

    // Case 1: single setting formatted as { key: '...', value: ... }
    if (payload.key && payload.value !== undefined) {
      return await this.updateSystemSetting(payload.key, payload.value, context);
    }

    // Case 2: nested settings container { settings: { k1: v1, k2: v2 } }
    const entries = payload.settings && typeof payload.settings === 'object' ? payload.settings : payload;
    const updated = [];

    for (const [k, v] of Object.entries(entries)) {
      if (k === 'reason' || k === 'adminId') continue;
      const res = await this.updateSystemSetting(k, v, {
        ...context,
        reason: payload.reason || context.reason || `Batch setting update for [${k}]`
      });
      updated.push(res);
    }

    return {
      success: true,
      updated_count: updated.length,
      settings: await this.getSystemSettings()
    };
  }

  // ── LISTINGS MODERATION (PHASE 3) ──

  static async listListings(options = {}) {
    return await SuperAdminRepository.listListings(options);
  }

  static async getListingDetail(id) {
    if (!id) throw new ValidationError('Listing ID is required.');
    const listing = await SuperAdminRepository.getListingById(id);
    if (!listing) throw new ValidationError(`Listing not found with ID ${id}`);
    return listing;
  }

  static async moderateListing(id, actionOrUpdates, { adminId = 'super_admin', reason = null, ipAddress = null } = {}) {
    if (!id) throw new ValidationError('Listing ID is required.');
    if (!actionOrUpdates) throw new ValidationError('Action or updates payload is required.');

    let updates = {};
    let auditAction = 'listing.moderate';

    if (typeof actionOrUpdates === 'string') {
      const act = actionOrUpdates.toUpperCase();
      if (act === 'APPROVED' || act === 'APPROVE' || act === 'ACTIVE') {
        updates = { status: 'ACTIVE', is_approved: true };
        auditAction = 'listing.approve';
      } else if (act === 'REJECTED' || act === 'REJECT') {
        updates = { status: 'ARCHIVED', is_approved: false };
        auditAction = 'listing.reject';
      } else if (act === 'SUSPENDED' || act === 'SUSPEND') {
        updates = { status: 'INACTIVE', is_approved: false };
        auditAction = 'listing.suspend';
      } else {
        updates = { status: actionOrUpdates };
      }
    } else if (typeof actionOrUpdates === 'object') {
      if (actionOrUpdates.action) {
        const act = String(actionOrUpdates.action).toUpperCase();
        if (act === 'APPROVED' || act === 'APPROVE' || act === 'ACTIVE') {
          updates = { status: 'ACTIVE', is_approved: true, ...actionOrUpdates };
          auditAction = 'listing.approve';
        } else if (act === 'REJECTED' || act === 'REJECT') {
          updates = { status: 'ARCHIVED', is_approved: false, ...actionOrUpdates };
          auditAction = 'listing.reject';
        } else if (act === 'SUSPENDED' || act === 'SUSPEND') {
          updates = { status: 'INACTIVE', is_approved: false, ...actionOrUpdates };
          auditAction = 'listing.suspend';
        } else {
          updates = { ...actionOrUpdates };
        }
        delete updates.action;
      } else {
        updates = { ...actionOrUpdates };
      }
    }

    const res = await SuperAdminRepository.updateListing(id, updates, adminId);
    if (!res.success) {
      throw new ValidationError(res.error || 'Failed to moderate listing');
    }

    await SuperAdminRepository.recordAuditLog({
      adminId,
      action: auditAction,
      resourceType: 'listing',
      resourceId: id,
      oldValues: res.oldListing ? { status: res.oldListing.status } : null,
      newValues: updates,
      reason: reason || `Admin action [${auditAction}] on listing ${id}`,
      ipAddress
    });

    logger.info(`[SuperAdminService] Listing ${id} moderated (${auditAction}) by ${adminId}`);
    return res.listing;
  }

  // ── USERS & RBAC GOVERNANCE (PHASE 3) ──

  static async listUsers(options = {}) {
    return await SuperAdminRepository.listUsers(options);
  }

  static async getUserDetail(id) {
    if (!id) throw new ValidationError('User ID is required.');
    const user = await SuperAdminRepository.getUserById(id);
    if (!user) throw new ValidationError(`User not found with ID ${id}`);
    return user;
  }

  static async updateUser(id, updates = {}, { adminId = 'super_admin', reason = null, ipAddress = null } = {}) {
    if (!id) throw new ValidationError('User ID is required.');
    if (!updates || typeof updates !== 'object') throw new ValidationError('Updates must be an object.');

    const res = await SuperAdminRepository.updateUser(id, updates, adminId);
    if (!res.success) throw new ValidationError(res.error || 'Failed to update user');

    await SuperAdminRepository.recordAuditLog({
      adminId,
      action: 'user.update',
      resourceType: 'user',
      resourceId: id,
      oldValues: res.oldUser,
      newValues: updates,
      reason: reason || `User profile updated by admin`,
      ipAddress
    });

    logger.info(`[SuperAdminService] User ${id} updated by ${adminId}`);
    return res.user;
  }

  static async updateUserRole(id, role, context = {}) {
    // The route already requires a super administrator; this is the same rule one layer down,
    // so a future caller cannot reach it by another path. Internal callers (no actorRole) are trusted.
    if (context.actorRole && String(context.actorRole).toLowerCase() !== 'super_admin') {
      throw new AuthorizationError('Only a super administrator can change a role.');
    }
    if (context.adminId && String(context.adminId) === String(id)) {
      throw new ValidationError('You cannot change your own role.');
    }
    const targetRole = typeof role === 'object' && role.role ? role.role : role;
    if (!targetRole || typeof targetRole !== 'string') {
      throw new ValidationError('A valid user role must be specified.');
    }

    const VALID_ROLES = ['customer', 'seller', 'moderator', 'admin', 'super_admin'];
    if (!VALID_ROLES.includes(targetRole.toLowerCase())) {
      throw new ValidationError(`Invalid role [${targetRole}]. Allowed: ${VALID_ROLES.join(', ')}`);
    }

    return await this.updateUser(id, { primary_role: targetRole.toLowerCase() }, {
      ...context,
      reason: context.reason || `Updated user primary role to [${targetRole}]`
    });
  }

  static async updateUserKyc(id, status, context = {}) {
    const targetStatus = typeof status === 'object' && status.status ? status.status : status;
    if (!targetStatus || typeof targetStatus !== 'string') {
      throw new ValidationError('A valid KYC status must be specified.');
    }

    const VALID_STATUSES = ['unverified', 'pending', 'verified', 'rejected'];
    if (!VALID_STATUSES.includes(targetStatus.toLowerCase())) {
      throw new ValidationError(`Invalid KYC status [${targetStatus}]. Allowed: ${VALID_STATUSES.join(', ')}`);
    }

    return await this.updateUser(id, { kyc_status: targetStatus.toLowerCase() }, {
      ...context,
      reason: context.reason || `Updated user KYC status to [${targetStatus}]`
    });
  }

  // ── ORDERS & ESCROW ARBITRATION (PHASE 3) ──

  static async listOrders(options = {}) {
    return await SuperAdminRepository.listOrders(options);
  }

  static async getOrderDetail(id) {
    if (!id) throw new ValidationError('Order ID is required.');
    const order = await SuperAdminRepository.getOrderById(id);
    if (!order) throw new ValidationError(`Order not found with ID ${id}`);
    return order;
  }

  static async resolveEscrow(id, actionOrPayload, { adminId = 'super_admin', reason = null, ipAddress = null } = {}) {
    if (!id) throw new ValidationError('Order ID is required.');
    if (!actionOrPayload) throw new ValidationError('Escrow action is required.');

    const actRaw = typeof actionOrPayload === 'string'
      ? actionOrPayload
      : (actionOrPayload.action || actionOrPayload.escrow_action || '');
    const act = String(actRaw).toUpperCase();

    let updates = {};
    if (act === 'RELEASE' || act === 'RELEASED') {
      updates = { escrow_status: 'RELEASED', status: 'COMPLETED' };
    } else if (act === 'REFUND' || act === 'REFUNDED') {
      updates = { escrow_status: 'REFUNDED', status: 'CANCELLED' };
    } else if (act === 'HOLD' || act === 'HELD') {
      updates = { escrow_status: 'HELD' };
    } else {
      throw new ValidationError(`Invalid escrow action [${actRaw}]. Supported actions: RELEASE, REFUND, HOLD.`);
    }

    const res = await SuperAdminRepository.updateOrder(id, updates, adminId);
    if (!res.success) {
      throw new ValidationError(res.error || 'Failed to resolve order escrow');
    }

    await SuperAdminRepository.recordAuditLog({
      adminId,
      action: 'escrow.resolve',
      resourceType: 'order',
      resourceId: id,
      oldValues: res.oldOrder ? { escrow_status: res.oldOrder.escrow_status, status: res.oldOrder.status } : null,
      newValues: updates,
      reason: reason || (typeof actionOrPayload === 'object' && actionOrPayload.reason) || `Escrow action [${act}] executed`,
      ipAddress
    });

    logger.info(`[SuperAdminService] Order ${id} escrow resolved (${act}) by ${adminId}`);
    return res.order;
  }
}

module.exports = SuperAdminService;
