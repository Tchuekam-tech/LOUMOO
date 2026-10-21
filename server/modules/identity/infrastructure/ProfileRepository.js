/**
 * LOUMOO — Profile Repository
 * ---------------------------------------------------------------------------
 * The ONLY module that reads or writes `iam.profiles`.
 *
 * Design rules enforced here:
 *   - `clerk_user_id` is the stable external identity, and every authorization
 *     decision is keyed on it. Users are never matched by email, phone,
 *     username or display name to decide what they may do. The lone exception
 *     is `findAuthIdByVerifiedEmail`, used only to resolve the owning account of
 *     an email that has JUST been proven by OTP during the sign-in handshake —
 *     it returns an id, never an authorization.
 *   - There is no in-memory fallback store. If the database is unavailable the
 *     request fails; it does not silently succeed against a Map that vanishes
 *     on restart and lets two servers disagree about who someone is.
 *   - `is_email_verified` / `is_phone_verified` are GENERATED columns in the
 *     database (migration 006). This repository writes only the canonical
 *     `email_verified_at` / `phone_verified_at` timestamps.
 */

const { SupabaseDatabase } = require('../../../infrastructure/database/SupabaseClient.js');
const CacheService = require('../../../infrastructure/cache/CacheService');
const logger = require('../../../shared/logging/logger');
const { ConflictError, InfrastructureError } = require('../../../shared/errors/AppError');
const { ONBOARDING_STATUS, SELLER_STATUS } = require('../domain/AccountState');

const PROFILE_CACHE_TTL_SECONDS = 300;
const CACHE_NAMESPACE = 'identity';

/** Columns selected everywhere, so every caller sees the same shape. */
const PROFILE_COLUMNS = [
  'id', 'clerk_user_id', 'email', 'phone_number', 'first_name', 'last_name',
  'avatar_url', 'city', 'primary_role', 'metadata', 'status',
  'email_verified_at', 'phone_verified_at', 'is_email_verified', 'is_phone_verified',
  'onboarding_status', 'onboarding_started_at', 'onboarding_completed_at',
  'seller_status', 'primary_store_id', 'clerk_last_synced_at', 'clerk_deleted_at',
  'username', 'bio', 'headline', 'social_links', 'badges',
  'follower_count', 'following_count', 'reputation_score',
  'buyer_interests', 'shopping_priorities', 'seller_type', 'business_name',
  'tax_niu_number', 'rccm_number', 'business_address', 'kyc_doc_type',
  'kyc_doc_status', 'completion_percentage', 'account_status',
  'adaptive_status', 'adaptive_started_at', 'adaptive_completed_at',
  'deletion_requested_at', 'last_login_at', 'created_at', 'updated_at', 'deleted_at'
].join(', ');

class ProfileRepository {
  static get db() {
    return SupabaseDatabase.getAdmin();
  }

  /** Whether a profile row belongs to a deleted (anonymized) account. */
  static isDeletedProfile(profile) {
    return Boolean(profile && (profile.deleted_at || profile.clerk_deleted_at || profile.account_status === 'anonymized'));
  }

  /* ---------------------------------------------------------------- reads */

  static async findByClerkUserId(clerkUserId, { useCache = true } = {}) {
    if (!clerkUserId) return null;

    if (useCache) {
      const cached = await CacheService.get(cacheKey(clerkUserId), CACHE_NAMESPACE);
      if (cached) return cached;
    }

    const { data, error } = await this.db
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('clerk_user_id', clerkUserId)
      .maybeSingle();

    if (error) {
      throw new InfrastructureError('Supabase', `profile lookup by clerk_user_id failed: ${error.message}`, error);
    }
    if (!data) return null;

    await CacheService.set(cacheKey(clerkUserId), data, PROFILE_CACHE_TTL_SECONDS, CACHE_NAMESPACE);
    return data;
  }

  static async findById(userId) {
    if (!userId) return null;
    const { data, error } = await this.db
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw new InfrastructureError('Supabase', `profile lookup by id failed: ${error.message}`, error);
    }
    return data || null;
  }

  /**
   * Resolves the stable identity (`clerk_user_id`, i.e. the Supabase auth id)
   * for an email that has JUST been proven via OTP.
   *
   * This is the ONE sanctioned by-email read and it exists solely for the
   * post-verification identity handshake, replacing a full auth-table scan. It
   * returns only the id, is backed by `idx_profiles_email`, and must NEVER be
   * used to make an authorization decision — those are always keyed on
   * `clerk_user_id`, never on a mutable, re-assignable email.
   */
  static async findAuthIdByVerifiedEmail(email) {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean) return null;

    const { data, error } = await this.db
      .from('profiles')
      .select('clerk_user_id')
      .eq('email', clean)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new InfrastructureError('Supabase', `profile identity lookup by email failed: ${error.message}`, error);
    }
    return data ? data.clerk_user_id : null;
  }

  /* --------------------------------------------------------------- writes */

  /**
   * Idempotently provisions the application profile for a Clerk identity.
   *
   * Concurrency: two simultaneous first requests (or a webhook racing the
   * user's first API call) both attempt the insert. The UNIQUE constraint on
   * `clerk_user_id` makes one of them lose with SQLSTATE 23505, and that loser
   * re-reads the winner's row instead of creating a duplicate account.
   */
  static async getOrCreateForClerkUser(identity) {
    if (!identity || !identity.clerkUserId) {
      throw new ConflictError('Cannot provision a profile without a Clerk user id');
    }

    // A deleted (anonymized) profile is returned AS IS, never reactivated:
    // deletion is final, and un-deleting here ran before every caller's
    // "deleted account cannot be reopened" check, so a deleted account could
    // sign straight back in. Callers check `isDeletedProfile` and refuse.
    const existing = await this.findByClerkUserId(identity.clerkUserId, { useCache: false });
    if (existing) {
      return { profile: existing, created: false };
    }

    const insert = {
      clerk_user_id: identity.clerkUserId,
      email: identity.email || null,
      phone_number: identity.phoneNumber || null,
      first_name: identity.firstName || '',
      last_name: identity.lastName || '',
      avatar_url: identity.avatarUrl || null,
      email_verified_at: identity.emailVerified ? nowIso() : null,
      phone_verified_at: identity.phoneVerified ? nowIso() : null,
      // Public sign-up can NEVER grant a privileged role. The role stored here
      // is always 'customer'; elevation happens only through seller onboarding
      // or an administrative action, never from a client-supplied field.
      primary_role: 'customer',
      onboarding_status: ONBOARDING_STATUS.NOT_STARTED,
      seller_status: SELLER_STATUS.NONE,
      status: 'active',
      account_status: 'active',
      clerk_last_synced_at: nowIso()
    };

    const { data, error } = await this.db
      .from('profiles')
      .insert(insert)
      .select(PROFILE_COLUMNS)
      .single();

    if (error) {
      // 23505 = unique_violation: someone else provisioned it microseconds ago.
      if (error.code === '23505') {
        const winner = await this.findByClerkUserId(identity.clerkUserId, { useCache: false });
        if (winner) {
          logger.info(`[ProfileRepository] Lost provisioning race for ${identity.clerkUserId}; using existing profile ${winner.id}`);
          return { profile: winner, created: false };
        }
      }
      throw new InfrastructureError('Supabase', `profile provisioning failed: ${error.message}`, error);
    }

    await this.invalidate(identity.clerkUserId, data.id);
    logger.info(`[ProfileRepository] Provisioned profile ${data.id} for Clerk identity ${identity.clerkUserId}`);
    return { profile: data, created: true };
  }

  /**
   * Mirrors Clerk's authoritative identity facts onto the local profile.
   * Only writes when something actually changed, so a webhook storm does not
   * generate a write per event.
   */
  static async syncFromClerk(profile, identity) {
    const patch = {};

    if (identity.email !== undefined && identity.email !== profile.email) patch.email = identity.email;
    if (identity.phoneNumber !== undefined && identity.phoneNumber !== profile.phone_number) patch.phone_number = identity.phoneNumber;
    if (identity.firstName && identity.firstName !== profile.first_name) patch.first_name = identity.firstName;
    if (identity.lastName && identity.lastName !== profile.last_name) patch.last_name = identity.lastName;
    if (identity.avatarUrl && identity.avatarUrl !== profile.avatar_url) patch.avatar_url = identity.avatarUrl;

    // Verification mirrors Clerk in BOTH directions: if Clerk says an address
    // is no longer verified (it was changed), LOUMOO must stop treating it as
    // verified — otherwise a user could change their email to bypass the gate.
    const emailVerifiedNow = Boolean(identity.emailVerified);
    if (emailVerifiedNow !== Boolean(profile.email_verified_at)) {
      patch.email_verified_at = emailVerifiedNow ? nowIso() : null;
    }
    const phoneVerifiedNow = Boolean(identity.phoneVerified);
    if (phoneVerifiedNow !== Boolean(profile.phone_verified_at)) {
      patch.phone_verified_at = phoneVerifiedNow ? nowIso() : null;
    }

    if (identity.bannedOrLocked && profile.account_status !== 'suspended') {
      patch.account_status = 'suspended';
    }

    if (Object.keys(patch).length === 0) {
      return profile;
    }

    patch.clerk_last_synced_at = nowIso();
    return this.update(profile.id, patch, profile.clerk_user_id);
  }

  /**
   * Applies a patch. Callers must pass columns that already exist; this method
   * deliberately does not accept `is_email_verified` / `is_phone_verified`
   * (they are generated by the database and rejecting them here turns a silent
   * desync into a loud programming error).
   */
  static async update(userId, patch, clerkUserId = null) {
    const forbidden = ['is_email_verified', 'is_phone_verified', 'id', 'clerk_user_id'];
    for (const key of forbidden) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        throw new ConflictError(`'${key}' is not directly writable; it is derived from canonical state.`);
      }
    }

    const { data, error } = await this.db
      .from('profiles')
      .update({ ...patch, updated_at: nowIso() })
      .eq('id', userId)
      .select(PROFILE_COLUMNS)
      .single();

    if (error) {
      throw new InfrastructureError('Supabase', `profile update failed: ${error.message}`, error);
    }

    await this.invalidate(clerkUserId || data.clerk_user_id, userId);
    return data;
  }

  static async markDeleted(clerkUserId) {
    const { data, error } = await this.db
      .from('profiles')
      .update({
        status: 'deactivated',
        account_status: 'anonymized',
        clerk_deleted_at: nowIso(),
        deleted_at: nowIso(),
        updated_at: nowIso()
      })
      .eq('clerk_user_id', clerkUserId)
      .select('id')
      .maybeSingle();

    if (error) {
      throw new InfrastructureError('Supabase', `profile deletion failed: ${error.message}`, error);
    }

    await this.invalidate(clerkUserId, data && data.id);
    return data || null;
  }

  static async recordLogin(userId, clerkUserId) {
    try {
      // Only the timestamp. Clearing deleted_at / account_status here un-deleted
      // (and un-suspended) whoever got this far.
      await this.db.from('profiles').update({
        last_login_at: nowIso()
      }).eq('id', userId);
      await this.invalidate(clerkUserId, userId);
    } catch (err) {
      logger.warn(`[ProfileRepository] Could not record login for ${userId}: ${err.message}`);
    }
  }

  static async invalidate(clerkUserId, userId) {
    const identityKeys = [];
    if (clerkUserId) identityKeys.push(cacheKey(clerkUserId));
    if (userId) {
      identityKeys.push(`profile:id:${userId}`);
      identityKeys.push(`profile:public:${userId}`);
    }

    const loumooKeys = [];
    if (userId) {
      loumooKeys.push(`identity:public:${userId}`);
      loumooKeys.push(`identity:profile_card:${userId}`);
      loumooKeys.push(`identity:profile:${userId}`);
    }
    if (clerkUserId) {
      loumooKeys.push(`identity:profile:${clerkUserId}`);
    }

    await Promise.all([
      identityKeys.length > 0 ? CacheService.deleteMany(identityKeys, CACHE_NAMESPACE).catch(() => null) : Promise.resolve(),
      loumooKeys.length > 0 ? CacheService.deleteMany(loumooKeys, 'loumoo').catch(() => null) : Promise.resolve()
    ]);
  }
}

function cacheKey(clerkUserId) {
  return `profile:clerk:${clerkUserId}`;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = ProfileRepository;
module.exports.PROFILE_COLUMNS = PROFILE_COLUMNS;
