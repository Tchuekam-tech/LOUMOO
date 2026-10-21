/**
 * Social Graph Application Service
 * ---------------------------------------------------------------------------
 * Coordinates follows, recommendations, endorsements, social blocks, and connections
 * across buyers and commercial seller entities on LOUMOO.
 */

'use strict';

const { SocialFollow, SocialRecommendation, SocialBlock } = require('../domain/SocialGraph');
const { SupabaseClient, handleDatabaseFailure } = require('../../../infrastructure/database/SupabaseClient');
const { NotFoundError, UnauthorizedError, ValidationError, ConflictError } = require('../../../shared/errors/AppError');
const CacheService = require('../../../infrastructure/cache/CacheService');
const logger = require('../../../shared/logging/logger');

class SocialGraphService {
  /**
   * Follow a user or seller entity.
   */
  static async follow(followerPrincipal, payload = {}) {
    const targetType = String(payload.targetType || 'user').toLowerCase();
    const targetId = payload.targetId || payload.storeId || payload.userId;

    SocialFollow.validate({
      followerId: followerPrincipal.id,
      targetType,
      targetId
    });

    const adminDb = SupabaseClient.getAdmin();

    // Check if blocked
    let targetUserId = targetType === 'user' ? targetId : null;

    // Check if target exists
    if (targetType === 'user') {
      const { data: userRow } = await adminDb
        .from('profiles')
        .select('id, follower_count, account_status')
        .eq('id', targetId)
        .maybeSingle();

      if (!userRow || userRow.account_status === 'anonymized') {
        throw new NotFoundError('User', targetId);
      }
    } else if (targetType === 'seller') {
      const { data: storeRow } = await adminDb
        .from('stores')
        .select('id, owner_id, follower_count, status')
        .eq('id', targetId)
        .maybeSingle();

      if (!storeRow || storeRow.status === 'ARCHIVED' || storeRow.status === 'DELETED') {
        throw new NotFoundError('Seller Store', targetId);
      }
      targetUserId = storeRow.owner_id;
    }

    if (targetUserId) {
      const isBlocked = await this.isBlockedBetween(followerPrincipal.id, targetUserId);
      if (isBlocked) {
        throw new ValidationError('Unable to follow this account due to blocking preferences.');
      }
    }

    let followRecord = null;
    try {
      const { data, error } = await adminDb
        .from('social_follows')
        .insert({
          follower_id: followerPrincipal.id,
          target_type: targetType,
          target_id: targetId
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          // Already following
          return { isFollowing: true, targetType, targetId };
        }
        throw error;
      }
      followRecord = data;

      // Update counters
      await this._recalculateFollowCounts(followerPrincipal.id, targetType, targetId);
      logger.info(`[SocialGraph] User ${followerPrincipal.id} followed ${targetType} ${targetId}`);
    } catch (err) {
      handleDatabaseFailure(err, 'Follow target');
      followRecord = { id: `follow_${Date.now()}`, follower_id: followerPrincipal.id, target_type: targetType, target_id: targetId };
    }

    await CacheService.del(`social:follow:${followerPrincipal.id}:${targetType}:${targetId}`);
    return {
      isFollowing: true,
      targetType,
      targetId,
      createdAt: followRecord.created_at || new Date()
    };
  }

  /**
   * Unfollow a user or seller entity.
   */
  static async unfollow(followerPrincipal, payload = {}) {
    const targetType = String(payload.targetType || 'user').toLowerCase();
    const targetId = payload.targetId || payload.storeId || payload.userId;

    if (!targetId) throw new ValidationError('targetId is required.');

    const adminDb = SupabaseClient.getAdmin();
    try {
      const { error } = await adminDb
        .from('social_follows')
        .delete()
        .eq('follower_id', followerPrincipal.id)
        .eq('target_type', targetType)
        .eq('target_id', targetId);

      if (error) throw error;
      await this._recalculateFollowCounts(followerPrincipal.id, targetType, targetId);
      logger.info(`[SocialGraph] User ${followerPrincipal.id} unfollowed ${targetType} ${targetId}`);
    } catch (err) {
      handleDatabaseFailure(err, 'Unfollow target');
    }

    await CacheService.del(`social:follow:${followerPrincipal.id}:${targetType}:${targetId}`);
    return {
      isFollowing: false,
      targetType,
      targetId
    };
  }

  /**
   * Check if user is following target.
   */
  static async getFollowStatus(followerId, targetType, targetId) {
    if (!followerId || !targetId) return { isFollowing: false };

    const cacheKey = `social:follow:${followerId}:${targetType}:${targetId}`;
    const cached = await CacheService.get(cacheKey);
    if (cached !== null) return cached;

    const adminDb = SupabaseClient.getAdmin();
    try {
      const { data, error } = await adminDb
        .from('social_follows')
        .select('id')
        .eq('follower_id', followerId)
        .eq('target_type', targetType.toLowerCase())
        .eq('target_id', targetId)
        .maybeSingle();

      if (error) throw error;
      const result = { isFollowing: Boolean(data) };
      await CacheService.set(cacheKey, result, 120);
      return result;
    } catch (err) {
      handleDatabaseFailure(err, 'Get follow status');
      return { isFollowing: false };
    }
  }

  /**
   * List followers for a user or seller.
   */
  static async listFollowers(targetType, targetId, { limit = 20, offset = 0 } = {}) {
    const adminDb = SupabaseClient.getAdmin();
    try {
      const { data, count, error } = await adminDb
        .from('social_follows')
        .select(`
          id,
          follower_id,
          created_at,
          profiles:follower_id (
            id,
            first_name,
            last_name,
            avatar_url,
            username,
            headline,
            city
          )
        `, { count: 'exact' })
        .eq('target_type', targetType.toLowerCase())
        .eq('target_id', targetId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return {
        followers: (data || []).map(row => ({
          id: row.id,
          followedAt: row.created_at,
          user: row.profiles ? {
            id: row.profiles.id,
            name: `${row.profiles.first_name || ''} ${row.profiles.last_name || ''}`.trim() || 'LOUMOO User',
            username: row.profiles.username,
            avatarUrl: row.profiles.avatar_url,
            headline: row.profiles.headline,
            city: row.profiles.city
          } : null
        })),
        total: count || 0,
        limit,
        offset
      };
    } catch (err) {
      handleDatabaseFailure(err, 'List followers');
      return { followers: [], total: 0, limit, offset };
    }
  }

  /**
   * List targets followed by a user.
   */
  static async listFollowing(userId, { limit = 20, offset = 0 } = {}) {
    const adminDb = SupabaseClient.getAdmin();
    try {
      const { data, count, error } = await adminDb
        .from('social_follows')
        .select('*', { count: 'exact' })
        .eq('follower_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      // Hydrate targets
      const userIds = (data || []).filter(r => r.target_type === 'user').map(r => r.target_id);
      const storeIds = (data || []).filter(r => r.target_type === 'seller').map(r => r.target_id);

      let userMap = {};
      let storeMap = {};

      if (userIds.length > 0) {
        const { data: users } = await adminDb
          .from('profiles')
          .select('id, first_name, last_name, username, avatar_url, city')
          .in('id', userIds);

        (users || []).forEach(u => {
          userMap[u.id] = {
            id: u.id,
            name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'LOUMOO User',
            username: u.username,
            avatarUrl: u.avatar_url,
            city: u.city
          };
        });
      }

      if (storeIds.length > 0) {
        const { data: stores } = await adminDb
          .from('stores')
          .select('id, name, slug, logo_url, seller_type, is_verified, rating')
          .in('id', storeIds);

        (stores || []).forEach(s => {
          storeMap[s.id] = {
            id: s.id,
            name: s.name,
            slug: s.slug,
            logoUrl: s.logo_url,
            sellerType: s.seller_type,
            isVerified: s.is_verified,
            rating: s.rating
          };
        });
      }

      return {
        following: (data || []).map(row => ({
          id: row.id,
          targetType: row.target_type,
          targetId: row.target_id,
          followedAt: row.created_at,
          target: row.target_type === 'user' ? userMap[row.target_id] : storeMap[row.target_id]
        })),
        total: count || 0,
        limit,
        offset
      };
    } catch (err) {
      handleDatabaseFailure(err, 'List following');
      return { following: [], total: 0, limit, offset };
    }
  }

  /**
   * Post a social recommendation endorsement.
   */
  static async createRecommendation(authorPrincipal, payload = {}) {
    const targetType = String(payload.targetType || 'seller').toLowerCase();
    const targetId = payload.targetId || payload.storeId || payload.userId;
    const note = payload.note;
    const relationshipContext = payload.relationshipContext || 'client';

    SocialRecommendation.validate({
      authorId: authorPrincipal.id,
      targetType,
      targetId,
      note,
      relationshipContext
    });

    const adminDb = SupabaseClient.getAdmin();

    // Verify target existence and prevent self-recommendation on own store
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
        throw new ValidationError('You cannot write a recommendation for your own store.');
      }
      targetOwnerId = store.owner_id;
    } else if (targetType === 'user') {
      const { data: user } = await adminDb
        .from('profiles')
        .select('id, account_status')
        .eq('id', targetId)
        .maybeSingle();

      if (!user || user.account_status === 'anonymized') {
        throw new NotFoundError('User', targetId);
      }
      targetOwnerId = user.id;
    }

    // Check block status
    if (targetOwnerId) {
      const isBlocked = await this.isBlockedBetween(authorPrincipal.id, targetOwnerId);
      if (isBlocked) {
        throw new ValidationError('Unable to recommend this account due to privacy/blocking preferences.');
      }
    }

    let rec = null;
    try {
      const { data, error } = await adminDb
        .from('social_recommendations')
        .upsert({
          author_id: authorPrincipal.id,
          target_type: targetType,
          target_id: targetId,
          note: String(note).trim(),
          relationship_context: relationshipContext.toLowerCase(),
          status: 'PUBLISHED',
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      rec = new SocialRecommendation(data);

      // Recalculate recommendation count on target
      await this._recalculateRecommendationCount(targetType, targetId);
      logger.info(`[SocialGraph] Recommendation created by ${authorPrincipal.id} for ${targetType} ${targetId}`);
    } catch (err) {
      handleDatabaseFailure(err, 'Create recommendation');
      rec = new SocialRecommendation({
        id: `rec_${Date.now()}`,
        author_id: authorPrincipal.id,
        target_type: targetType,
        target_id: targetId,
        note,
        relationship_context: relationshipContext
      });
    }

    return rec.toJSON();
  }

  /**
   * Delete own recommendation.
   */
  static async deleteRecommendation(authorPrincipal, recommendationId) {
    const adminDb = SupabaseClient.getAdmin();
    try {
      const { data: existing } = await adminDb
        .from('social_recommendations')
        .select('*')
        .eq('id', recommendationId)
        .maybeSingle();

      if (!existing) throw new NotFoundError('Recommendation', recommendationId);
      if (existing.author_id !== authorPrincipal.id && authorPrincipal.primaryRole !== 'admin') {
        throw new UnauthorizedError('You can only delete your own recommendations.');
      }

      await adminDb
        .from('social_recommendations')
        .delete()
        .eq('id', recommendationId);

      await this._recalculateRecommendationCount(existing.target_type, existing.target_id);
      return { success: true, deletedId: recommendationId };
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof UnauthorizedError) {
        throw err;
      }
      handleDatabaseFailure(err, 'Delete recommendation');
      return { success: true, deletedId: recommendationId };
    }
  }

  /**
   * List recommendations for a user or seller.
   */
  static async listRecommendations(targetType, targetId, { limit = 20, offset = 0 } = {}) {
    const adminDb = SupabaseClient.getAdmin();
    try {
      const { data, count, error } = await adminDb
        .from('social_recommendations')
        .select(`
          id,
          author_id,
          target_type,
          target_id,
          note,
          relationship_context,
          status,
          created_at,
          profiles:author_id (
            id,
            first_name,
            last_name,
            avatar_url,
            username,
            headline,
            city
          )
        `, { count: 'exact' })
        .eq('target_type', targetType.toLowerCase())
        .eq('target_id', targetId)
        .eq('status', 'PUBLISHED')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return {
        recommendations: (data || []).map(row => ({
          id: row.id,
          authorId: row.author_id,
          targetType: row.target_type,
          targetId: row.target_id,
          note: row.note,
          relationshipContext: row.relationship_context,
          createdAt: row.created_at,
          author: row.profiles ? {
            id: row.profiles.id,
            name: `${row.profiles.first_name || ''} ${row.profiles.last_name || ''}`.trim() || 'LOUMOO User',
            username: row.profiles.username,
            avatarUrl: row.profiles.avatar_url,
            headline: row.profiles.headline,
            city: row.profiles.city
          } : null
        })),
        total: count || 0,
        limit,
        offset
      };
    } catch (err) {
      handleDatabaseFailure(err, 'List recommendations');
      return { recommendations: [], total: 0, limit, offset };
    }
  }

  /**
   * Block a user.
   */
  static async blockUser(blockerPrincipal, targetUserId) {
    SocialBlock.validate({ blockerId: blockerPrincipal.id, blockedId: targetUserId });

    const adminDb = SupabaseClient.getAdmin();

    // Check if target user exists
    const { data: targetUser } = await adminDb
      .from('profiles')
      .select('id')
      .eq('id', targetUserId)
      .maybeSingle();

    if (!targetUser) throw new NotFoundError('User', targetUserId);

    try {
      // 1. Insert block
      await adminDb
        .from('social_blocks')
        .upsert({
          blocker_id: blockerPrincipal.id,
          blocked_id: targetUserId,
          created_at: new Date().toISOString()
        });

      // 2. Sever reciprocal follow relationships
      await adminDb
        .from('social_follows')
        .delete()
        .or(`and(follower_id.eq.${blockerPrincipal.id},target_id.eq.${targetUserId}),and(follower_id.eq.${targetUserId},target_id.eq.${blockerPrincipal.id})`);

      // 3. Recalculate counts
      await this._recalculateFollowCounts(blockerPrincipal.id, 'user', targetUserId);
      await this._recalculateFollowCounts(targetUserId, 'user', blockerPrincipal.id);

      logger.info(`[SocialGraph] User ${blockerPrincipal.id} blocked user ${targetUserId}`);
    } catch (err) {
      handleDatabaseFailure(err, 'Block user');
    }

    await CacheService.del(`social:block:${blockerPrincipal.id}:${targetUserId}`);
    await CacheService.del(`social:block:${targetUserId}:${blockerPrincipal.id}`);

    return { success: true, blockedUserId: targetUserId };
  }

  /**
   * Unblock a user.
   */
  static async unblockUser(blockerPrincipal, targetUserId) {
    if (!targetUserId) throw new ValidationError('targetUserId is required.');

    const adminDb = SupabaseClient.getAdmin();
    try {
      await adminDb
        .from('social_blocks')
        .delete()
        .eq('blocker_id', blockerPrincipal.id)
        .eq('blocked_id', targetUserId);

      logger.info(`[SocialGraph] User ${blockerPrincipal.id} unblocked user ${targetUserId}`);
    } catch (err) {
      handleDatabaseFailure(err, 'Unblock user');
    }

    await CacheService.del(`social:block:${blockerPrincipal.id}:${targetUserId}`);
    await CacheService.del(`social:block:${targetUserId}:${blockerPrincipal.id}`);

    return { success: true, unblockedUserId: targetUserId };
  }

  /**
   * List blocked users for a principal.
   */
  static async listBlockedUsers(principal) {
    const adminDb = SupabaseClient.getAdmin();
    try {
      const { data, error } = await adminDb
        .from('social_blocks')
        .select(`
          id,
          blocked_id,
          created_at,
          profiles:blocked_id (
            id,
            first_name,
            last_name,
            username,
            avatar_url
          )
        `)
        .eq('blocker_id', principal.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(r => ({
        id: r.id,
        blockedId: r.blocked_id,
        blockedAt: r.created_at,
        user: r.profiles ? {
          id: r.profiles.id,
          name: `${r.profiles.first_name || ''} ${r.profiles.last_name || ''}`.trim() || 'LOUMOO User',
          username: r.profiles.username,
          avatarUrl: r.profiles.avatar_url
        } : null
      }));
    } catch (err) {
      handleDatabaseFailure(err, 'List blocked users');
      return [];
    }
  }

  /**
   * Check if either user has blocked the other.
   */
  static async isBlockedBetween(userA, userB) {
    if (!userA || !userB || userA === userB) return false;

    const cacheKey1 = `social:block:${userA}:${userB}`;
    const cached1 = await CacheService.get(cacheKey1);
    if (cached1 !== null) return cached1;

    const adminDb = SupabaseClient.getAdmin();
    try {
      // Two users can block EACH OTHER, which is two rows. maybeSingle() errors
      // on two rows and the catch below answered "not blocked", so a mutual
      // block let either side follow and recommend the other again.
      const { data, error } = await adminDb
        .from('social_blocks')
        .select('id')
        .or(`and(blocker_id.eq.${userA},blocked_id.eq.${userB}),and(blocker_id.eq.${userB},blocked_id.eq.${userA})`)
        .limit(1);

      if (error) throw error;
      const result = Array.isArray(data) && data.length > 0;
      await CacheService.set(cacheKey1, result, 300);
      return result;
    } catch (err) {
      handleDatabaseFailure(err, 'Check block status');
      return false;
    }
  }

  // ── Helper count recalculators ──
  static async _recalculateFollowCounts(followerId, targetType, targetId) {
    const adminDb = SupabaseClient.getAdmin();
    try {
      // 1. Follower's following_count
      const { count: followingCount } = await adminDb
        .from('social_follows')
        .select('id', { count: 'exact', head: true })
        .eq('follower_id', followerId);

      await adminDb
        .from('profiles')
        .update({ following_count: followingCount || 0 })
        .eq('id', followerId);

      // 2. Target's follower_count
      const { count: followerCount } = await adminDb
        .from('social_follows')
        .select('id', { count: 'exact', head: true })
        .eq('target_type', targetType)
        .eq('target_id', targetId);

      if (targetType === 'user') {
        await adminDb
          .from('profiles')
          .update({ follower_count: followerCount || 0 })
          .eq('id', targetId);
      } else if (targetType === 'seller') {
        await adminDb
          .from('stores')
          .update({ follower_count: followerCount || 0 })
          .eq('id', targetId);
      }
    } catch (err) {
      handleDatabaseFailure(err, 'Recalculate follow counts');
    }
  }

  static async _recalculateRecommendationCount(targetType, targetId) {
    const adminDb = SupabaseClient.getAdmin();
    try {
      const { count: recCount } = await adminDb
        .from('social_recommendations')
        .select('id', { count: 'exact', head: true })
        .eq('target_type', targetType)
        .eq('target_id', targetId)
        .eq('status', 'PUBLISHED');

      if (targetType === 'seller') {
        await adminDb
          .from('stores')
          .update({ recommendation_count: recCount || 0 })
          .eq('id', targetId);
      }
    } catch (err) {
      handleDatabaseFailure(err, 'Recalculate recommendation count');
    }
  }
}

module.exports = SocialGraphService;