/**
 * Use Case: Privacy Preferences (02.14)
 * Manages user privacy consents, marketing communications, profile visibility,
 * and informs PostHog analytics opt-in/opt-out.
 */

const { z } = require('zod');
const { SupabaseClient, handleDatabaseFailure, tryGetAdmin } = require('../../../infrastructure/database/SupabaseClient.js');
const CacheService = require('../../../infrastructure/cache/CacheService');
const AnalyticsService = require('../../../infrastructure/analytics/AnalyticsService');
const { ValidationError, AuthorizationError } = require('../../../shared/errors/AppError');
const logger = require('../../../shared/logging/logger');

const PrivacySchema = z.object({
  analyticsConsent: z.boolean().optional(),
  marketingEmails: z.boolean().optional(),
  personalizedRecommendations: z.boolean().optional(),
  profileVisibility: z.enum(['public', 'contacts_only', 'private']).optional()
});

class PrivacyPreferencesUseCase {
  async getPreferences(userId) {
    if (!userId) throw new AuthorizationError('Authentication required');

    const cacheKey = `identity:privacy:${userId}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    const defaultPrefs = {
      userId,
      analyticsConsent: true,
      marketingEmails: true,
      personalizedRecommendations: true,
      profileVisibility: 'public'
    };

    const adminDb = tryGetAdmin('PrivacyPreferencesUseCase');
    if (adminDb) {
      try {
        const { data, error } = await adminDb.schema('system').from('privacy_preferences').select('*').eq('user_id', userId).single();
        if (error) { handleDatabaseFailure(error, 'PrivacyPreferences'); }
        if (data && !error) {
          const loaded = {
            userId: data.user_id,
            analyticsConsent: data.analytics_consent,
            marketingEmails: data.marketing_emails,
            personalizedRecommendations: data.personalized_recommendations,
            profileVisibility: data.profile_visibility
          };
          await CacheService.set(cacheKey, loaded, 1800);
          return loaded;
        }
      } catch (err) {
        // Fallback to defaults
      }
    }

    return defaultPrefs;
  }

  /**
   * Whether this profile is hidden from people who are not its owner.
   *
   * One answer for every path that serves a profile, so they cannot disagree
   * — /u/:username refused a private profile while /users/:id/public handed
   * the same person's card out. Answers false when the preference cannot be
   * read, which matches getPreferences' own default of 'public': a lookup
   * failure must not silently hide every seller on the platform.
   */
  async isProfilePrivate(userId) {
    if (!userId) return false;
    try {
      const prefs = await this.getPreferences(userId);
      return Boolean(prefs && prefs.profileVisibility === 'private');
    } catch (err) {
      return false;
    }
  }

  async updatePreferences(userId, updates) {
    if (!userId) throw new AuthorizationError('Authentication required');

    const parseResult = PrivacySchema.safeParse(updates);
    if (!parseResult.success) {
      throw new ValidationError('Invalid privacy preferences format');
    }
    const data = parseResult.data;

    const current = await this.getPreferences(userId);
    const updated = {
      userId,
      analyticsConsent: data.analyticsConsent !== undefined ? data.analyticsConsent : current.analyticsConsent,
      marketingEmails: data.marketingEmails !== undefined ? data.marketingEmails : current.marketingEmails,
      personalizedRecommendations: data.personalizedRecommendations !== undefined ? data.personalizedRecommendations : current.personalizedRecommendations,
      profileVisibility: data.profileVisibility !== undefined ? data.profileVisibility : current.profileVisibility
    };

    const adminDb = tryGetAdmin('PrivacyPreferencesUseCase');
    if (adminDb) {
      try {
        // Must target the unique user_id, or a second update hits the unique
        // constraint and the row silently never changes.
        const { error } = await adminDb.schema('system').from('privacy_preferences').upsert({
          user_id: userId,
          analytics_consent: updated.analyticsConsent,
          marketing_emails: updated.marketingEmails,
          personalized_recommendations: updated.personalizedRecommendations,
          profile_visibility: updated.profileVisibility,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (error) handleDatabaseFailure(error, 'Supabase upsert privacy_preferences');
      } catch (err) {
        handleDatabaseFailure(err, 'Supabase upsert');
      }
    }

    await CacheService.set(`identity:privacy:${userId}`, updated, 1800);

    // Track consent update without violating privacy
    if (updated.analyticsConsent) {
      AnalyticsService.track('privacy_preferences_updated', {
        userId,
        properties: { marketingEmails: updated.marketingEmails, profileVisibility: updated.profileVisibility }
      });
    }

    logger.info(`[PrivacyPreferences] Updated preferences for user ${userId}`);

    return {
      success: true,
      message: 'Privacy preferences updated successfully',
      preferences: updated
    };
  }
}

module.exports = new PrivacyPreferencesUseCase();
