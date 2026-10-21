/**
 * Create Store Use Case (05.01)
 * ---------------------------------------------------------------------------
 * Creates the seller's boutique and establishes ownership.
 *
 * This is the ONLY transition that can move an account from ACCOUNT_READY
 * towards selling. It refuses to run for an account that has not completed
 * onboarding, and it never leaves half a store behind: if the owner-membership
 * row cannot be written, the store row is removed again.
 */

const { z } = require('zod');
const { SupabaseDatabase } = require('../../../infrastructure/database/SupabaseClient.js');
const AnalyticsService = require('../../../infrastructure/analytics/AnalyticsService');
const ProfileRepository = require('../../../modules/identity/infrastructure/ProfileRepository');
const StoreRepository = require('../infrastructure/StoreRepository');
const { SELLER_STATUS } = require('../../identity/domain/AccountState');
const { ValidationError, ConflictError, UnauthorizedError, InfrastructureError } = require('../../../shared/errors/AppError');
const Store = require('../domain/Store');
const logger = require('../../../shared/logging/logger');

const VALID_STORE_CATEGORIES = [
  'electronics', 'fashion', 'home', 'services', 'hotels', 'food', 'automotive', 'beauty', 'travel', 'general'
];

const CreateStoreSchema = z.object({
  name: z.string().trim().min(2, 'Store name must be at least 2 characters').max(255),
  categoryId: z.string().trim().min(1, 'Choose what type of store or business you are operating.')
    .refine(v => VALID_STORE_CATEGORIES.includes(v.toLowerCase()), {
      message: 'Select a valid business category from the LOUMOO taxonomy.'
    }),
  sellerType: z.enum(['FREELANCER', 'SHOP', 'AGENCY', 'INSTITUTE', 'BRAND', 'ORGANIZATION', 'OTHER', 'freelancer', 'shop', 'agency', 'institute', 'brand', 'organization', 'other']).default('SHOP'),
  organizationId: z.string().trim().max(64).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  city: z.string().trim().max(64).optional().nullable(),
  phoneNumber: z.string().trim().max(32).optional().nullable(),
  email: z.string().email('Enter a valid store email address').optional().nullable(),
  tagline: z.string().trim().max(255).optional().nullable(),
  streetAddress: z.string().trim().max(255).optional().nullable(),
  logoUrl: z.string().trim().max(1000000).optional().nullable(),
  logo_url: z.string().trim().max(1000000).optional().nullable()
});

class CreateStoreUseCase {
  /**
   * @param {object} principal   The authenticated principal (never client data).
   * @param {object} accountState The derived account state.
   * @param {object} rawInput    Untrusted request body.
   */
  static async execute(principal, accountState, rawInput = {}) {
    if (!principal || !principal.id) {
      throw new ValidationError('Authentication required to create a store.');
    }

    // Authorization happens BEFORE any write.
    if (!accountState.capabilities.canStartSelling && !accountState.capabilities.canManageStore) {
      throw new ConflictError(
        'Finish setting up your LOUMOO account before creating a boutique.',
        { currentState: accountState.state, resolveAt: accountState.destination }
      );
    }

    const rawCategory = rawInput.categoryId || rawInput.category;
    const parsed = CreateStoreSchema.safeParse({
      ...rawInput,
      categoryId: rawCategory ? String(rawCategory).toLowerCase().trim() : undefined
    });
    if (!parsed.success) {
      throw new ValidationError('Store details need your attention.', {
        fields: parsed.error.issues.map(i => ({ field: i.path.join('.') || '_', message: i.message }))
      });
    }
    const input = parsed.data;

    // One boutique per seller for now — a second POST is a conflict, not a
    // silent duplicate. This is also the double-click defence.
    const existing = await StoreRepository.findOwnedBy(principal.id);
    if (existing.length > 0) {
      throw new ConflictError('You already have a LOUMOO boutique.', {
        storeId: existing[0].id,
        store: existing[0]
      });
    }

    const db = SupabaseDatabase.getAdmin();

    // Verify organization membership if organizationId is supplied (Prevent IDOR)
    if (input.organizationId) {
      const { data: orgMembership } = await db
        .from('organization_members')
        .select('role, status')
        .eq('organization_id', input.organizationId)
        .eq('user_id', principal.id)
        .eq('status', 'ACTIVE')
        .maybeSingle();

      if (!orgMembership && principal.primaryRole !== 'admin') {
        throw new UnauthorizedError('You are not an active member of the specified organization.');
      }
    }

    const city = input.city || principal.city || 'Douala';
    const sellerType = String(input.sellerType || 'SHOP').toUpperCase();

    const storeData = {
      id: `store_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      owner_id: principal.id,
      organization_id: input.organizationId || null,
      seller_type: sellerType,
      name: input.name,
      slug: Store.generateSlug(input.name),
      description: input.description || `Official store for ${input.name} in ${city}, Cameroon.`,
      category_id: input.categoryId.toLowerCase(),
      logo_url: input.logoUrl || input.logo_url || null,
      // The store's phone is PUBLIC (Store.toPublicJSON, the WhatsApp button). Only a
      // number the seller typed for the store is published; the account's own phone
      // (given for verification) is never copied onto a public storefront unasked.
      phone_number: input.phoneNumber || '',
      email: input.email || principal.email || '',
      // A created storefront is immediately discoverable. Onboarding still
      // controls seller readiness and listing capabilities, not whether the
      // storefront exists for shoppers.
      status: 'ACTIVE',
      visibility: 'PUBLIC',
      is_verified: false,
      verification_tier: 'unverified',
      reputation_score: 100.00,
      trust_tier: 'NEW',
      onboarding_step: 'IN_PROGRESS',
      onboarding_completed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { error: storeError } = await db.from('stores').insert(storeData);
    if (storeError) {
      throw new InfrastructureError('Supabase', `store creation failed: ${storeError.message}`, storeError);
    }

    try {
      const { error: memberError } = await db.from('store_members').insert({
        store_id: storeData.id,
        user_id: principal.id,
        role: 'owner',
        permissions: ['*']
      });
      if (memberError) throw memberError;

      try {
        await Promise.all([
          db.from('store_profiles').insert({
            store_id: storeData.id,
            tagline: input.tagline || `Authentic ${input.name} products`,
            bio: storeData.description
          }),
          db.from('store_locations').insert({
            store_id: storeData.id,
            city,
            region: /yaound/i.test(city) ? 'Centre' : 'Littoral',
            street_address: input.streetAddress || `${city} Commercial District`
          }),
          db.from('store_hours').insert({ store_id: storeData.id, timezone: 'Africa/Douala' }),
          db.from('store_settings').insert({ store_id: storeData.id, currency: 'XAF' })
        ]);
      } catch (secErr) {
        logger.warn(`[CreateStore] Secondary record creation notice: ${secErr.message}`);
      }
    } catch (err) {
      await db.from('stores').delete().eq('id', storeData.id).then(() => {
        logger.warn(`[CreateStore] Rolled back partially created store ${storeData.id}`);
      }).catch(() => null);
      throw new InfrastructureError('Supabase', `store setup failed: ${err.message}`, err);
    }

    await ProfileRepository.update(principal.id, {
      primary_store_id: storeData.id,
      seller_status: principal.sellerStatus === SELLER_STATUS.READY
        ? SELLER_STATUS.READY
        : SELLER_STATUS.ONBOARDING
    }, principal.clerkUserId);

    AnalyticsService.track(principal.id, 'store_created', {
      storeId: storeData.id,
      storeName: input.name,
      category: storeData.category_id,
      sellerType,
      city
    });

    logger.info(`[CreateStore] user=${principal.id} created store=${storeData.id} sellerType=${sellerType}`);
    return new Store(storeData).toOwnerJSON();
  }
}

module.exports = CreateStoreUseCase;
module.exports.CreateStoreSchema = CreateStoreSchema;