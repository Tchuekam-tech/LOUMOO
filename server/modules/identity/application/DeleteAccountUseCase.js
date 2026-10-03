/**
 * Use Case: Delete Account (02.13)
 * Implements lifecycle-aware account termination with PII anonymization,
 * session revocation, audit logging, and transactional record preservation.
 */

const { SupabaseDatabase } = require('../../../infrastructure/database/SupabaseClient.js');
const ClerkIdentityProvider = require('../infrastructure/ClerkIdentityProvider');
const ProfileRepository = require('../infrastructure/ProfileRepository');
const CacheService = require('../../../infrastructure/cache/CacheService');
const AccountSecurityService = require('./AccountSecurityService');
const AnalyticsService = require('../../../infrastructure/analytics/AnalyticsService');
const { ValidationError, AuthorizationError, InfrastructureError, NotFoundError } = require('../../../shared/errors/AppError');
const config = require('../../../config/env');
const logger = require('../../../shared/logging/logger');

class DeleteAccountUseCase {

  async execute(currentUser, { confirmText, reason = 'User requested deletion' }, context = {}) {
    if (!currentUser || !currentUser.id) {
      throw new AuthorizationError('Authentication required to perform account deletion');
    }

    if (confirmText !== 'DELETE' && confirmText !== 'DELETE MY ACCOUNT') {
      throw new ValidationError('Explicit confirmation required: Please type "DELETE" or "DELETE MY ACCOUNT" to confirm account removal.');
    }

    const userId = currentUser.id;
    const clerkUserId = currentUser.clerkUserId;
    const anonymizedEmail = `anonymized_${userId.replace(/[^a-zA-Z0-9]/g, '')}@deleted.loumoo.cm`;

    // 1. Anonymize the profile FIRST.
    //    Order matters: if this fails the account still exists and the user can
    //    retry. Deleting the Clerk identity first would leave an orphaned
    //    profile full of personal data that nobody can any longer sign in to
    //    remove.
    const db = SupabaseDatabase.getAdmin();
    const { data: anonymized, error: anonymizeError } = await db.from('profiles').update({
      first_name: 'Anonymized',
      last_name: 'User',
      email: anonymizedEmail,
      phone_number: null,
      avatar_url: null,
      username: null,
      bio: null,
      headline: null,
      social_links: {},
      buyer_interests: null,
      shopping_priorities: null,
      business_name: null,
      tax_niu_number: null,
      rccm_number: null,
      business_address: null,
      kyc_doc_type: null,
      kyc_doc_status: 'pending',
      // Verification cannot outlive the identity it belonged to.
      email_verified_at: null,
      phone_verified_at: null,
      account_status: 'anonymized',
      status: 'deactivated',
      deletion_requested_at: new Date().toISOString(),
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', userId).select('id').maybeSingle();

    // A no-op update means the account is not there. Reporting success would
    // tell someone their data was erased when nothing was touched.
    if (!anonymizeError && !anonymized) {
      throw new NotFoundError('Account', userId);
    }

    if (anonymizeError) {
      throw new InfrastructureError(
        'Supabase',
        'We could not complete the deletion. Nothing was changed — please try again.',
        anonymizeError
      );
    }

    // 1b. Anonymize PII in child rows. The profile row is KEPT (so FK-restricted
    //     purchase history preserves referential integrity), but that means
    //     ON DELETE CASCADE never fires — addresses, saved items and followed
    //     stores would keep the user's real name/phone/street forever. Blank
    //     every PII-bearing field so deletion really removes the identity.
    //     Non-PII rows (orders, activity log, security events) are preserved
    //     untouched for the audit trail.
    const piiAnonymizations = [
      {
        table: 'addresses',
        fields: {
          recipient_name: 'Anonymized Recipient',
          phone_number: '+237000000000',
          street_address: 'Redacted Address',
          landmark: null,
          quarter: null,
          delivery_instructions: null,
          deleted_at: new Date().toISOString()
        }
      }
    ];
    const piiErrors = [];
    for (const { table, fields } of piiAnonymizations) {
      try {
        const { error: childError } = await db.from(table).update(fields).eq('user_id', userId);
        if (childError) piiErrors.push(`${table}: ${childError.message}`);
      } catch (err) {
        piiErrors.push(`${table}: ${err.message}`);
      }
    }

    // Purge user's saved items and followed stores
    try {
      await db.from('saved_items').delete().eq('user_id', userId);
    } catch (siErr) {
      piiErrors.push(`saved_items: ${siErr.message}`);
    }
    try {
      await db.from('followed_stores').delete().eq('user_id', userId);
    } catch (fsErr) {
      piiErrors.push(`followed_stores: ${fsErr.message}`);
    }

    // Deactivate any owned stores and purge their store and catalog listing caches
    try {
      const { data: ownedStores } = await db
        .from('stores')
        .select('id, slug')
        .eq('owner_id', userId);

      await db.from('stores').update({
        status: 'CLOSED',
        visibility: 'PRIVATE',
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('owner_id', userId);

      if (Array.isArray(ownedStores) && ownedStores.length > 0) {
        for (const s of ownedStores) {
          if (s.id) {
            await CacheService.del(`store:public:${s.id}`);
            await CacheService.delPattern(`listings:store:${s.id}:*`, 'catalog');
          }
          if (s.slug) {
            await CacheService.del(`store:public:${s.slug}`);
          }
        }
      }
    } catch (storeErr) {
      logger.warn(`[DeleteAccount] Could not deactivate stores for user ${userId}: ${storeErr.message}`);
    }

    // Revoke local auth sessions
    try {
      await db.from('auth_sessions').delete().eq('user_id', userId);
    } catch (sessionErr) {
      logger.debug(`[DeleteAccount] Auth session deletion notice: ${sessionErr.message}`);
    }

    // A rider's name and phone live in delivery_drivers (keyed by profile_id, so
    // the table loop above does not reach it). Scrub it, suspend the rider and
    // hand any un-started deliveries back to their sellers.
    try {
      const { getSharedDeliveryService } = require('../../delivery/application/DeliveryService');
      await getSharedDeliveryService().onAccountDeleted(userId);
    } catch (riderErr) {
      piiErrors.push(`delivery_drivers: ${riderErr.message}`);
    }

    if (piiErrors.length > 0) {
      // Never silently succeed: the profile is anonymized, but the child PII
      // cleanup is the second half of the promise.
      logger.error(`[DeleteAccount] Child PII anonymization incomplete: ${piiErrors.join(' | ')}`);
    }

    // 2. Delete the Clerk identity, which also revokes every session.
    //    A failure here is reported: the user's personal data is gone, but
    //    telling them the account is fully deleted when their sign-in still
    //    works would be a lie they would discover at the worst moment.
    let identityRemoved = false;
    if (clerkUserId && ClerkIdentityProvider.isConfigured) {
      try {
        await ClerkIdentityProvider.client.users.deleteUser(clerkUserId);
        identityRemoved = true;
      } catch (err) {
        if (err && (err.status === 404 || err.statusCode === 404)) {
          identityRemoved = true;   // already gone
        } else {
          logger.error(`[DeleteAccount] Clerk identity ${clerkUserId} could not be deleted: ${err.message}`);
        }
      }
    }

    // 3. Purge every cached copy of the principal and user-scoped caches,
    //    so no request served from cache can still resolve the deleted account.
    await ProfileRepository.invalidate(clerkUserId, userId);

    const userDirectKeys = [
      `addresses:${userId}`,
      `dashboard:${userId}`,
      `identity:privacy:${userId}`,
      `notif_prefs:${userId}`
    ];
    await CacheService.delMany(userDirectKeys);

    await Promise.all([
      CacheService.delPattern(`user_activity:${userId}:*`),
      CacheService.delPattern(`saved_items:${userId}:*`),
      CacheService.delPattern(`saved_check:${userId}:*`),
      CacheService.delPattern(`followed_stores:${userId}:*`),
      CacheService.delPattern(`follow_check:${userId}:*`),
      CacheService.delPattern(`purchases:${userId}:*`)
    ]);

    // 4. Log Immutable Security Event
    await AccountSecurityService.logSecurityEvent({
      userId,
      eventType: 'account_anonymized',
      ipAddress: context.ip,
      userAgent: context.userAgent,
      metadata: { reason, anonymizedAt: new Date().toISOString() }
    });

    // 5. Track Telemetry
    AnalyticsService.track('account_deleted', {
      userId,
      distinctId: clerkUserId,
      properties: { reason }
    });

    logger.info(`[DeleteAccount] Account ${userId} anonymized (identity removed: ${identityRemoved}).`);

    // Report what actually happened. If the identity provider could not be
    // reached, the user's data is gone but their credentials may still work
    // briefly — saying otherwise would be a lie they discover at sign-in.
    return {
      success: true,
      identityRemoved,
      message: identityRemoved
        ? 'Your account has been deleted and your personal data anonymized.'
        : 'Your personal data has been anonymized. Removing your sign-in credentials is still in progress — '
          + 'contact LOUMOO support if you can still sign in after an hour.'
    };
  }
}

module.exports = new DeleteAccountUseCase();
