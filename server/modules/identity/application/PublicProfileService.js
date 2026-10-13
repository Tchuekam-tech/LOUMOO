/**
 * Public Profile Application Service (Section 5 & 6)
 * ---------------------------------------------------------------------------
 * Powers public user profile pages (/u/:username) and commercial seller pages
 * (/s/:sellerSlug) with privacy enforcement, ratings, reviews, and recommendations.
 */

'use strict';

const { SupabaseClient, handleDatabaseFailure } = require('../../../infrastructure/database/SupabaseClient');
const { NotFoundError } = require('../../../shared/errors/AppError');
const ReviewService = require('./ReviewService');
const SocialGraphService = require('./SocialGraphService');
const CacheService = require('../../../infrastructure/cache/CacheService');
const logger = require('../../../shared/logging/logger');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class PublicProfileService {
  /**
   * Resolve public user profile (/u/:username or /api/v1/users/:id/public)
   */
  static async getUserPublicProfile(usernameOrId, requestingPrincipal = null) {
    const adminDb = SupabaseClient.getAdmin();
    let row = null;

    try {
      let query = adminDb.from('profiles').select('*');
      if (UUID_REGEX.test(usernameOrId) || (usernameOrId.startsWith('usr_') && usernameOrId.length > 10)) {
        query = query.eq('id', usernameOrId);
      } else {
        query = query.ilike('username', usernameOrId);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      row = data;
    } catch (err) {
      handleDatabaseFailure(err, 'Get user profile for public view');
    }

    if (!row || row.deleted_at || row.account_status === 'anonymized') {
      throw new NotFoundError('User Profile', usernameOrId);
    }

    const isSelf = requestingPrincipal && requestingPrincipal.id === row.id;

    // Check privacy settings if not self
    if (!isSelf) {
      try {
        const { data: privacy } = await adminDb
          .schema('system')
          .from('privacy_preferences')
          .select('profile_visibility')
          .eq('user_id', row.id)
          .maybeSingle();

        if (privacy && privacy.profile_visibility === 'private') {
          return {
            id: row.id,
            username: row.username,
            name: `${row.first_name || ''}`.trim() || 'Private User',
            avatarUrl: null,
            isPrivate: true,
            message: 'This user profile is private.'
          };
        }
      } catch (_) { /* continue */ }
    }

    // Check follow status
    let isFollowing = false;
    if (requestingPrincipal && !isSelf) {
      const followStatus = await SocialGraphService.getFollowStatus(requestingPrincipal.id, 'user', row.id);
      isFollowing = followStatus.isFollowing;
    }

    // Get user's active seller stores
    let sellerStores = [];
    try {
      const { data: stores } = await adminDb
        .from('stores')
        .select('id, name, slug, logo_url, seller_type, rating, follower_count, is_verified, status')
        .eq('owner_id', row.id)
        .eq('status', 'ACTIVE')
        .eq('visibility', 'PUBLIC');

      sellerStores = stores || [];
    } catch (_) { /* ignore */ }

    // Get recommendations received
    const { recommendations } = await SocialGraphService.listRecommendations('user', row.id, { limit: 5 });

    return {
      id: row.id,
      username: row.username || `user_${row.id.slice(0, 8)}`,
      name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'LOUMOO User',
      avatarUrl: row.avatar_url,
      headline: row.headline || (sellerStores.length > 0 ? `${sellerStores[0].seller_type} Merchant` : 'LOUMOO Member'),
      bio: row.bio,
      city: row.city || 'Douala',
      isPhoneVerified: Boolean(row.phone_verified_at),
      isEmailVerified: Boolean(row.email_verified_at),
      followerCount: row.follower_count || 0,
      followingCount: row.following_count || 0,
      reputationScore: row.reputation_score || 100,
      badges: row.badges || [],
      isFollowing,
      sellerStores: sellerStores.map(s => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        logoUrl: s.logo_url,
        sellerType: s.seller_type || 'SHOP',
        rating: s.rating,
        isVerified: s.is_verified
      })),
      recommendations,
      createdAt: row.created_at
    };
  }

  /**
   * Resolve public commercial seller profile (/s/:sellerSlug)
   */
  static async getSellerPublicProfile(slugOrId, requestingPrincipal = null) {
    const adminDb = SupabaseClient.getAdmin();
    let store = null;

    try {
      const identifier = String(slugOrId || '').trim();
      // Store IDs are not guaranteed to be UUIDs. Older records use `str_...`
      // identifiers, so a format heuristic incorrectly interpreted valid IDs as
      // slugs and made their public storefronts unreachable. Resolve the
      // primary key first, then fall back to the unique public slug.
      const byId = await adminDb.from('stores').select('*').eq('id', identifier).maybeSingle();
      if (byId.error) throw byId.error;
      store = byId.data;

      if (!store) {
        const bySlug = await adminDb
          .from('stores')
          .select('*')
          .eq('slug', identifier.toLowerCase())
          .maybeSingle();
        if (bySlug.error) throw bySlug.error;
        store = bySlug.data;
      }
    } catch (err) {
      handleDatabaseFailure(err, 'Get seller public profile');
    }

    if (!store || store.deleted_at || store.status === 'ARCHIVED' || store.status === 'DELETED') {
      throw new NotFoundError('Seller', slugOrId);
    }

    // A storefront is public only while it is live: ACTIVE and not PRIVATE - the same rule the
    // marketplace applies to its listings (CatalogRepository joins stores on ACTIVE). A draft,
    // pending, suspended or closed store, or one its owner made private, answers exactly like a
    // store that does not exist, so changing the slug in the URL reveals nothing. The owner and
    // platform staff still see it (previewing their own page). docs/ROUTING.md, "/store/:slug".
    const isLive = String(store.status || '').toUpperCase() === 'ACTIVE'
      && String(store.visibility || 'PUBLIC').toUpperCase() !== 'PRIVATE';
    if (!isLive) {
      const role = requestingPrincipal && (requestingPrincipal.primaryRole || requestingPrincipal.role);
      const isOwner = Boolean(requestingPrincipal && requestingPrincipal.id && store.owner_id === requestingPrincipal.id);
      const isStaff = role === 'admin' || role === 'super_admin';
      if (!isOwner && !isStaff) throw new NotFoundError('Seller', slugOrId);
    }

    // Hydrate store profile
    let storeProfile = null;
    let storeHours = null;
    let storeLocation = null;
    let organization = null;

    try {
      const [pRes, hRes, lRes, oRes] = await Promise.all([
        adminDb.from('store_profiles').select('*').eq('store_id', store.id).maybeSingle(),
        adminDb.from('store_hours').select('*').eq('store_id', store.id).maybeSingle(),
        adminDb.from('store_locations').select('*').eq('store_id', store.id).maybeSingle(),
        store.organization_id ? adminDb.from('organizations').select('*').eq('id', store.organization_id).maybeSingle() : Promise.resolve({ data: null })
      ]);

      storeProfile = pRes.data;
      storeHours = hRes.data;
      storeLocation = lRes.data;
      organization = oRes.data;
    } catch (_) { /* ignore */ }

    // Follow status
    let isFollowing = false;
    if (requestingPrincipal) {
      const fs = await SocialGraphService.getFollowStatus(requestingPrincipal.id, 'seller', store.id);
      isFollowing = fs.isFollowing;
    }

    // Ratings & Reviews summary
    const ratingSummary = await ReviewService.getRatingSummary('seller', store.id);
    const { reviews } = await ReviewService.listReviews('seller', store.id, { limit: 5 });
    const { recommendations } = await SocialGraphService.listRecommendations('seller', store.id, { limit: 5 });

    // Published listings come from the canonical listing columns. The previous
    // projection selected retired `price_xaf` and `cover_image_url` columns,
    // causing the whole listing query to fail against the live schema.
    let listings = [];
    let listingCount = 0;
    try {
      const { data: listData, error: listingError, count } = await adminDb
        .from('listings')
        .select('id, title, short_description, description, base_price_minor, sale_price_minor, listing_type, category_id, rating, rating_count, created_at', { count: 'exact' })
        .eq('store_id', store.id)
        .eq('status', 'PUBLISHED')
        .order('created_at', { ascending: false })
        .limit(100);

      if (listingError) throw listingError;

      const listingRows = listData || [];
      listingCount = Number(count) || listingRows.length;
      const listingIds = listingRows.map(listing => listing.id).filter(Boolean);
      let coversByListingId = {};

      // Load every displayed listing's first image in one query, avoiding an
      // N+1 query per storefront card.
      if (listingIds.length > 0) {
        const { data: mediaRows, error: mediaError } = await adminDb
          .from('listing_media')
          .select('listing_id, url, thumbnail_url, is_cover, display_order')
          .in('listing_id', listingIds)
          .order('is_cover', { ascending: false })
          .order('display_order', { ascending: true });

        if (mediaError) throw mediaError;
        coversByListingId = (mediaRows || []).reduce((covers, media) => {
          if (!covers[media.listing_id]) {
            covers[media.listing_id] = media.thumbnail_url || media.url || '';
          }
          return covers;
        }, {});
      }

      listings = listingRows.map(listing => ({
        id: listing.id,
        title: listing.title,
        description: listing.description || listing.short_description || '',
        priceXaf: Number(listing.sale_price_minor ?? listing.base_price_minor ?? 0),
        listingType: listing.listing_type,
        categoryId: listing.category_id,
        coverImageUrl: coversByListingId[listing.id] || '',
        rating: listing.rating,
        ratingCount: listing.rating_count || 0,
        createdAt: listing.created_at
      }));
    } catch (err) {
      logger.warn('[PublicProfileService] Could not load storefront listings', {
        storeId: store.id,
        message: err && err.message
      });
    }

    return {
      id: store.id,
      name: store.name,
      slug: store.slug,
      sellerType: store.seller_type || 'SHOP',
      description: store.description,
      logoUrl: store.logo_url,
      coverUrl: store.cover_url,
      isVerified: store.is_verified,
      verificationTier: store.verification_tier || 'unverified',
      reputationScore: store.reputation_score || 100.0,
      trustTier: store.trust_tier || 'NEW',
      rating: store.rating,
      ratingCount: store.rating_count || 0,
      followerCount: store.follower_count || 0,
      recommendationCount: store.recommendation_count || 0,
      completedOrdersCount: store.completed_orders_count || 0,
      responseRatePercent: store.response_rate_percent || 100,
      isFollowing,
      profile: storeProfile ? {
        tagline: storeProfile.tagline,
        bio: storeProfile.bio,
        returnPolicy: storeProfile.return_policy,
        warrantyPolicy: storeProfile.warranty_policy,
        shippingPolicy: storeProfile.shipping_policy,
        socialLinks: storeProfile.social_links,
        badges: storeProfile.badges
      } : null,
      hours: storeHours ? {
        timezone: storeHours.timezone,
        isAlwaysOpen: storeHours.is_always_open,
        schedule: storeHours.schedule
      } : null,
      location: storeLocation ? {
        city: storeLocation.city,
        region: storeLocation.region,
        districtQuarter: storeLocation.district_quarter,
        country: storeLocation.country
      } : null,
      organization: organization ? {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        orgType: organization.org_type,
        logoUrl: organization.logo_url
      } : null,
      ratingSummary,
      reviews,
      recommendations,
      listingCount,
      listings
    };
  }
}

module.exports = PublicProfileService;
