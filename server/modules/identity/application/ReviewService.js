/**
 * Review & Rating Application Service
 * ---------------------------------------------------------------------------
 * Handles quantitative 1-5 star ratings and qualitative written feedback
 * with transaction verification eligibility and reputation recalculation.
 */

'use strict';

const { SupabaseClient, handleDatabaseFailure } = require('../../../infrastructure/database/SupabaseClient');
const { ReputationEngine } = require('../domain/ReputationEngine');
const { NotFoundError, UnauthorizedError, ValidationError, ConflictError } = require('../../../shared/errors/AppError');
const CacheService = require('../../../infrastructure/cache/CacheService');
const logger = require('../../../shared/logging/logger');

class ReviewService {
  /**
   * Submit a review for a seller, product, or service.
   */
  static async createReview(authorPrincipal, payload = {}) {
    const targetType = String(payload.targetType || 'seller').toLowerCase();
    const targetId = payload.targetId || payload.storeId || payload.listingId;
    const rating = parseInt(payload.rating, 10);
    const title = payload.title ? String(payload.title).trim() : null;
    const content = String(payload.content || '').trim();
    const orderId = payload.orderId || null;

    if (!['seller', 'product', 'service'].includes(targetType)) {
      throw new ValidationError(`Invalid targetType '${targetType}'. Must be 'seller', 'product', or 'service'.`);
    }
    if (!targetId) throw new ValidationError('targetId is required.');
    if (isNaN(rating) || rating < 1 || rating > 5) {
      throw new ValidationError('Rating must be an integer between 1 and 5.');
    }
    if (!content || content.length < 5) {
      throw new ValidationError('Review content must be at least 5 characters long.');
    }

    const adminDb = SupabaseClient.getAdmin();
    let isVerifiedPurchase = false;

    // ── 1. Target Existence & Self-Review Prevention ──
    let targetOwnerId = null;
    if (targetType === 'seller') {
      const { data: store } = await adminDb
        .from('stores')
        .select('id, owner_id, status')
        .eq('id', targetId)
        .maybeSingle();

      if (!store || store.status === 'ARCHIVED' || store.status === 'DELETED') {
        throw new NotFoundError('Seller Store', targetId);
      }
      if (store.owner_id === authorPrincipal.id) {
        throw new ValidationError('You cannot review your own boutique.');
      }
      targetOwnerId = store.owner_id;
    } else if (['product', 'service'].includes(targetType)) {
      const { data: listing } = await adminDb
        .from('listings')
        .select('id, store_id, seller_id, status')
        .eq('id', targetId)
        .maybeSingle();

      if (listing && listing.status !== 'ARCHIVED') {
        if (listing.seller_id === authorPrincipal.id) {
          throw new ValidationError('You cannot review your own product or service listing.');
        }
        targetOwnerId = listing.seller_id;
      } else {
        // Not a live DB listing — accept the review only if it targets a product
        // from the curated storefront catalogue (src/data/catalog_products.js).
        // Those products have no seller account, so there is no owner to notify
        // or run a block check against.
        let curated = {};
        try { curated = require('../../catalog/dataLoader').catalogProducts || {}; } catch (e) { curated = {}; }
        if (!curated[targetId]) {
          throw new NotFoundError('Listing', targetId);
        }
        targetOwnerId = null;
      }
    }

    // ── 2. Check Blocking Preferences ──
    if (targetOwnerId) {
      // A mutual block is two rows; maybeSingle() errored on it, the error was
      // ignored, and the review went through. limit(1) reads either row.
      const { data: blocks } = await adminDb
        .from('social_blocks')
        .select('id')
        .or(`and(blocker_id.eq.${authorPrincipal.id},blocked_id.eq.${targetOwnerId}),and(blocker_id.eq.${targetOwnerId},blocked_id.eq.${authorPrincipal.id})`)
        .limit(1);

      if (Array.isArray(blocks) && blocks.length > 0) {
        throw new ValidationError('Unable to review this entity due to privacy/blocking preferences.');
      }
    }

    // ── 3. Check Verified Transaction Eligibility & Prevent Order Spoofing ──
    if (orderId) {
      const { data: order } = await adminDb
        .from('orders')
        .select('id, buyer_id, seller_id, payment_status, fulfillment_status, items')
        .eq('id', orderId)
        .maybeSingle();

      if (!order) {
        throw new NotFoundError('Order', orderId);
      }

      if (order.buyer_id !== authorPrincipal.id && authorPrincipal.primaryRole !== 'admin') {
        throw new UnauthorizedError('You cannot attach an order that does not belong to your account.');
      }

      // Check payment or fulfillment completion
      if (['paid', 'escrow_held'].includes(order.payment_status) || order.fulfillment_status === 'delivered') {
        if (targetType === 'seller') {
          if (order.seller_id === targetId || (Array.isArray(order.items) && order.items.some(it => it.storeId === targetId || it.store_id === targetId))) {
            isVerifiedPurchase = true;
          }
        } else {
          if (Array.isArray(order.items) && order.items.some(it => it.productId === targetId || it.id === targetId || it.listingId === targetId)) {
            isVerifiedPurchase = true;
          }
        }
      }

      if (!isVerifiedPurchase) {
        throw new ValidationError('This order is not eligible for a verified purchase review of the specified target.');
      }
    } else {
      // ── 4. Prevent Unverified Review Flooding / Duplicates ──
      const { data: existingUnverified } = await adminDb
        .from('reviews')
        .select('id')
        .eq('author_id', authorPrincipal.id)
        .eq('target_type', targetType)
        .eq('target_id', targetId)
        .is('order_id', null)
        .maybeSingle();

      if (existingUnverified) {
        throw new ConflictError('You have already submitted a review for this entity. Edit your existing review instead.');
      }
    }

    // Insert review
    let reviewRecord = null;
    try {
      const { data, error } = await adminDb
        .from('reviews')
        .insert({
          author_id: authorPrincipal.id,
          target_type: targetType,
          target_id: targetId,
          order_id: orderId,
          rating,
          title,
          content,
          is_verified_purchase: isVerifiedPurchase,
          status: 'PUBLISHED'
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new ConflictError('You have already submitted a review for this transaction.');
        }
        throw error;
      }
      reviewRecord = data;

      // Invalidate cache BEFORE recalculating ratings (Fix Bug 3)
      await CacheService.del(`reviews:summary:${targetType}:${targetId}`);

      // Recalculate target ratings and reputation
      await this._recalculateTargetRatings(targetType, targetId);
      logger.info(`[ReviewService] User ${authorPrincipal.id} reviewed ${targetType} ${targetId} (${rating} stars, verified=${isVerifiedPurchase})`);
    } catch (err) {
      if (err instanceof ConflictError || err instanceof ValidationError || err instanceof UnauthorizedError || err instanceof NotFoundError) {
        throw err;
      }
      handleDatabaseFailure(err, 'Insert review');
      reviewRecord = {
        id: `rev_${Date.now()}`,
        author_id: authorPrincipal.id,
        target_type: targetType,
        target_id: targetId,
        order_id: orderId,
        rating,
        title,
        content,
        is_verified_purchase: isVerifiedPurchase,
        status: 'PUBLISHED',
        created_at: new Date()
      };
    }

    await CacheService.del(`reviews:summary:${targetType}:${targetId}`);
    return {
      id: reviewRecord.id,
      authorId: reviewRecord.author_id,
      targetType: reviewRecord.target_type,
      targetId: reviewRecord.target_id,
      orderId: reviewRecord.order_id,
      rating: reviewRecord.rating,
      title: reviewRecord.title,
      content: reviewRecord.content,
      isVerifiedPurchase: reviewRecord.is_verified_purchase,
      status: reviewRecord.status,
      createdAt: reviewRecord.created_at,
      author: {
        id: authorPrincipal.id,
        name: authorPrincipal.fullName,
        username: authorPrincipal.username,
        avatarUrl: authorPrincipal.avatarUrl
      }
    };
  }

  /**
   * List reviews for a target entity.
   */
  static async listReviews(targetType, targetId, { limit = 20, offset = 0, verifiedOnly = false, minRating = null } = {}) {
    const adminDb = SupabaseClient.getAdmin();
    try {
      let query = adminDb
        .from('reviews')
        .select(`
          id,
          author_id,
          target_type,
          target_id,
          order_id,
          rating,
          title,
          content,
          is_verified_purchase,
          helpful_votes_count,
          status,
          created_at,
          profiles:author_id (
            id,
            first_name,
            last_name,
            avatar_url,
            username,
            city
          )
        `, { count: 'exact' })
        .eq('target_type', targetType.toLowerCase())
        .eq('target_id', targetId)
        .eq('status', 'PUBLISHED');

      if (verifiedOnly) {
        query = query.eq('is_verified_purchase', true);
      }
      if (minRating) {
        query = query.gte('rating', parseInt(minRating, 10));
      }

      const { data, count, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return {
        reviews: (data || []).map(r => ({
          id: r.id,
          authorId: r.author_id,
          targetType: r.target_type,
          targetId: r.target_id,
          orderId: r.order_id,
          rating: r.rating,
          title: r.title,
          content: r.content,
          isVerifiedPurchase: r.is_verified_purchase,
          helpfulVotesCount: r.helpful_votes_count || 0,
          createdAt: r.created_at,
          author: r.profiles ? {
            id: r.profiles.id,
            name: `${r.profiles.first_name || ''} ${r.profiles.last_name || ''}`.trim() || 'LOUMOO Buyer',
            username: r.profiles.username,
            avatarUrl: r.profiles.avatar_url,
            city: r.profiles.city
          } : null
        })),
        total: count || 0,
        limit,
        offset
      };
    } catch (err) {
      handleDatabaseFailure(err, 'List reviews');
      return { reviews: [], total: 0, limit, offset };
    }
  }

  /**
   * Get rating summary and star distribution breakdown.
   */
  static async getRatingSummary(targetType, targetId, { bypassCache = false } = {}) {
    const cacheKey = `reviews:summary:${targetType}:${targetId}`;
    if (!bypassCache) {
      const cached = await CacheService.get(cacheKey);
      if (cached) return cached;
    }

    const adminDb = SupabaseClient.getAdmin();
    try {
      const { data: reviews, error } = await adminDb
        .from('reviews')
        .select('rating, is_verified_purchase')
        .eq('target_type', targetType.toLowerCase())
        .eq('target_id', targetId)
        .eq('status', 'PUBLISHED');

      if (error) throw error;

      const total = (reviews || []).length;
      let sum = 0;
      let verifiedCount = 0;
      const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

      (reviews || []).forEach(r => {
        sum += r.rating;
        if (r.is_verified_purchase) verifiedCount++;
        if (breakdown[r.rating] !== undefined) breakdown[r.rating]++;
      });

      const average = total > 0 ? Math.round((sum / total) * 100) / 100 : 5.0;
      const result = {
        targetType,
        targetId,
        average,
        total,
        verifiedCount,
        breakdown,
        percentageBreakdown: {
          5: total > 0 ? Math.round((breakdown[5] / total) * 100) : 0,
          4: total > 0 ? Math.round((breakdown[4] / total) * 100) : 0,
          3: total > 0 ? Math.round((breakdown[3] / total) * 100) : 0,
          2: total > 0 ? Math.round((breakdown[2] / total) * 100) : 0,
          1: total > 0 ? Math.round((breakdown[1] / total) * 100) : 0
        }
      };

      await CacheService.set(cacheKey, result, 300);
      return result;
    } catch (err) {
      handleDatabaseFailure(err, 'Get rating summary');
      return {
        targetType,
        targetId,
        average: 5.0,
        total: 0,
        verifiedCount: 0,
        breakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
        percentageBreakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
      };
    }
  }

  /**
   * Delete a review (author or admin only).
   */
  static async deleteReview(authorPrincipal, reviewId) {
    const adminDb = SupabaseClient.getAdmin();
    try {
      const { data: existing } = await adminDb
        .from('reviews')
        .select('*')
        .eq('id', reviewId)
        .maybeSingle();

      if (!existing) throw new NotFoundError('Review', reviewId);
      if (existing.author_id !== authorPrincipal.id && authorPrincipal.primaryRole !== 'admin') {
        throw new UnauthorizedError('You do not have permission to delete this review.');
      }

      await adminDb
        .from('reviews')
        .delete()
        .eq('id', reviewId);

      // Invalidate cache BEFORE recalculating ratings
      await CacheService.del(`reviews:summary:${existing.target_type}:${existing.target_id}`);
      await this._recalculateTargetRatings(existing.target_type, existing.target_id);

      return { success: true, deletedId: reviewId };
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof UnauthorizedError) {
        throw err;
      }
      handleDatabaseFailure(err, 'Delete review');
      return { success: true, deletedId: reviewId };
    }
  }

  /**
   * Recalculate average rating and reputation for target entity.
   */
  static async _recalculateTargetRatings(targetType, targetId) {
    const adminDb = SupabaseClient.getAdmin();
    try {
      // Force bypass cache to calculate fresh numbers
      const summary = await this.getRatingSummary(targetType, targetId, { bypassCache: true });

      if (targetType === 'seller') {
        // Fetch store metadata for reputation calculation
        const { data: store } = await adminDb
          .from('stores')
          .select('id, is_verified, recommendation_count, completed_orders_count, response_rate_percent')
          .eq('id', targetId)
          .maybeSingle();

        const rep = ReputationEngine.calculateReputation({
          ratingAvg: summary.average,
          ratingCount: summary.total,
          verifiedReviewsCount: summary.verifiedCount,
          recommendationCount: (store && store.recommendation_count) || 0,
          completedOrdersCount: (store && store.completed_orders_count) || 0,
          isKycVerified: Boolean(store && store.is_verified),
          responseRatePercent: (store && store.response_rate_percent) || 100
        });

        await adminDb
          .from('stores')
          .update({
            rating: summary.average,
            rating_count: summary.total,
            reputation_score: rep.score,
            trust_tier: rep.trustTier,
            updated_at: new Date().toISOString()
          })
          .eq('id', targetId);
      }
    } catch (err) {
      handleDatabaseFailure(err, 'Recalculate ratings and reputation');
    }
  }
}

module.exports = ReviewService;