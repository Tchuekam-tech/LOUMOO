/**
 * LOUMOO Enterprise User & Profile Management API Routes (Phase 4)
 * Covers: 04.01 Profile, 04.02 Dashboard, 04.03 Settings, 04.04 Saved Items,
 *         04.05 Followed Stores, 04.06 Purchase History, 04.07 Activity History,
 *         04.08 Addresses, 04.09 Notification Preferences.
 */

const express = require('express');
const router = express.Router();
const UpdateUserProfileUseCase = require('../../application/UpdateUserProfileUseCase');
const AccountDashboardUseCase = require('../../application/AccountDashboardUseCase');
const SavedItemsUseCase = require('../../application/SavedItemsUseCase');
const FollowedStoresUseCase = require('../../application/FollowedStoresUseCase');
const AddressManagementUseCase = require('../../application/AddressManagementUseCase');
const PurchaseHistoryUseCase = require('../../application/PurchaseHistoryUseCase');
const UserActivityUseCase = require('../../application/UserActivityUseCase');
const NotificationPreferencesUseCase = require('../../application/NotificationPreferencesUseCase');
const NotificationService = require('../../application/NotificationService');
const AccountSecurityService = require('../../application/AccountSecurityService');
const DeleteAccountUseCase = require('../../application/DeleteAccountUseCase');
const PrivacyPreferencesUseCase = require('../../application/PrivacyPreferencesUseCase');
const { requireAuth, requireCapability } = require('../guards/authGuard');
const ProfileRepository = require('../../infrastructure/ProfileRepository');
const AccountStateService = require('../../application/AccountStateService');
const UserProfile = require('../../entities/UserProfile');
const { NotFoundError } = require('../../../../shared/errors/AppError');
const CacheService = require('../../../../infrastructure/cache/CacheService');
const RateLimitService = require('../../../../infrastructure/cache/RateLimitService');
const logger = require('../../../../shared/logging/logger');


const profileUpdateRateLimiter = RateLimitService.middleware({
  maxRequests: 10,
  windowSeconds: 60,
  keyGenerator: req => `profile_update:${req.userProfile ? req.userProfile.id : RateLimitService.resolveKey(req)}`
});

// ── 04.01 PERSONAL PROFILE ──
// GET /api/v1/users/me
router.get('/me', requireAuth, async (req, res) => {
  res.json({
    status: 'success',
    data: {
      user: req.userProfile.toPublicJSON()
    }
  });
});

// GET /api/v1/users/:userId/public (Public Merchant / User Card)
//
// Returns the real profile, projected through toSafeMerchantPublicCard() so no
// email, phone number or verification timestamp reaches a stranger. The
// previous revision invented an "Orca Electronics Douala" card for any id
// containing "orca" and a "LOUMOO Merchant" card for everything else, so this
// endpoint answered 200 for users who did not exist.
router.get('/:userId/public', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const cacheKey = `identity:public:${userId}`;

    let card = await CacheService.get(cacheKey);

    if (!card) {
      const row = await ProfileRepository.findById(userId);
      if (!row || row.deleted_at || row.account_status === 'anonymized') {
        throw new NotFoundError('User', userId);
      }

      const profile = UserProfile.fromPrincipal(AccountStateService.project(row));
      card = profile.toSafeMerchantPublicCard();
      await CacheService.set(cacheKey, card, 300);
    }

    res.json({ status: 'success', data: { user: card } });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/users/me (Hardened Profile Update with Rate Limiting)
router.patch('/me', requireAuth, profileUpdateRateLimiter, async (req, res, next) => {
  try {
    // Audit metadata follows the same server-derived, canonical address used
    // by the infrastructure limiter; never persist a raw forwarding header.
    const clientIp = RateLimitService.normalizeAddress(
      req.ip || (req.socket && req.socket.remoteAddress)
    );
    const result = await UpdateUserProfileUseCase.execute(req.userProfile, req.body, { ip: clientIp });
    await UserActivityUseCase.recordActivity(req.userProfile.id, {
      actionType: 'profile_updated',
      title: 'Profile Updated',
      description: 'Personal profile details were updated.'
    });
    res.json({
      status: 'success',
      data: result
    });
  } catch (err) {
    next(err);
  }
});

// ── 04.02 ACCOUNT DASHBOARD ──
// GET /api/v1/users/me/dashboard
router.get('/me/dashboard', requireAuth, async (req, res, next) => {
  try {
    const dashboard = await AccountDashboardUseCase.getDashboard(req.userProfile);
    res.json({
      status: 'success',
      data: dashboard
    });
  } catch (err) {
    next(err);
  }
});

// ── 04.04 SAVED ITEMS (WISHLIST) ──
// GET /api/v1/users/me/saved-items
router.get('/me/saved-items', requireAuth, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = parseInt(req.query.offset, 10) || 0;
    const result = await SavedItemsUseCase.listSavedItems(req.userProfile.id, { limit, offset });
    res.json({
      status: 'success',
      data: result
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/me/saved-items
router.post('/me/saved-items', requireAuth, async (req, res, next) => {
  try {
    const saved = await SavedItemsUseCase.saveItem(req.userProfile.id, req.body);
    await UserActivityUseCase.recordActivity(req.userProfile.id, {
      actionType: 'item_saved',
      title: 'Saved Product',
      description: `Saved "${saved.title}" to wishlist.`,
      resourceType: 'product',
      resourceId: saved.productId
    });
    res.status(201).json({
      status: 'success',
      data: { savedItem: saved }
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/users/me/saved-items/:productId
router.delete('/me/saved-items/:productId', requireAuth, async (req, res, next) => {
  try {
    const result = await SavedItemsUseCase.removeItem(req.userProfile.id, req.params.productId);
    await UserActivityUseCase.recordActivity(req.userProfile.id, {
      actionType: 'item_removed',
      title: 'Removed Product',
      description: `Removed product from wishlist.`,
      resourceType: 'product',
      resourceId: req.params.productId
    });
    res.json({
      status: 'success',
      data: result
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/users/me/saved-items/:productId/check
router.get('/me/saved-items/:productId/check', requireAuth, async (req, res, next) => {
  try {
    const isSaved = await SavedItemsUseCase.isItemSaved(req.userProfile.id, req.params.productId);
    res.json({
      status: 'success',
      data: { isSaved }
    });
  } catch (err) {
    next(err);
  }
});

// ── 04.05 FOLLOWED STORES ──
// GET /api/v1/users/me/followed-stores
router.get('/me/followed-stores', requireAuth, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = parseInt(req.query.offset, 10) || 0;
    const result = await FollowedStoresUseCase.listFollowedStores(req.userProfile.id, { limit, offset });
    res.json({
      status: 'success',
      data: result
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/me/followed-stores
router.post('/me/followed-stores', requireAuth, async (req, res, next) => {
  try {
    const followed = await FollowedStoresUseCase.followStore(req.userProfile.id, req.body);
    await UserActivityUseCase.recordActivity(req.userProfile.id, {
      actionType: 'store_followed',
      title: 'Followed Store',
      description: `Started following ${followed.storeName}.`,
      resourceType: 'store',
      resourceId: followed.storeId
    });
    res.status(201).json({
      status: 'success',
      data: { followedStore: followed }
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/users/me/followed-stores/:storeId
router.delete('/me/followed-stores/:storeId', requireAuth, async (req, res, next) => {
  try {
    const result = await FollowedStoresUseCase.unfollowStore(req.userProfile.id, req.params.storeId);
    await UserActivityUseCase.recordActivity(req.userProfile.id, {
      actionType: 'store_unfollowed',
      title: 'Unfollowed Store',
      description: `Unfollowed boutique storefront.`,
      resourceType: 'store',
      resourceId: req.params.storeId
    });
    res.json({
      status: 'success',
      data: result
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/users/me/followed-stores/:storeId/check
router.get('/me/followed-stores/:storeId/check', requireAuth, async (req, res, next) => {
  try {
    const isFollowed = await FollowedStoresUseCase.isStoreFollowed(req.userProfile.id, req.params.storeId);
    res.json({
      status: 'success',
      data: { isFollowed }
    });
  } catch (err) {
    next(err);
  }
});

// ── 04.06 PURCHASE HISTORY (ORDERS) ──
// GET /api/v1/users/me/purchases
router.get('/me/purchases', requireAuth, async (req, res, next) => {
  try {
    const status = req.query.status || 'all';
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = parseInt(req.query.offset, 10) || 0;
    const result = await PurchaseHistoryUseCase.getPurchaseHistory(req.userProfile.id, { status, limit, offset });
    res.json({
      status: 'success',
      data: result
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/users/me/purchases/:orderId
router.get('/me/purchases/:orderId', requireAuth, async (req, res, next) => {
  try {
    const order = await PurchaseHistoryUseCase.getOrderDetails(req.userProfile.id, req.params.orderId);
    res.json({
      status: 'success',
      data: { order }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/users/me/notifications — the buyer's notification feed
router.get('/me/notifications', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const notifications = await NotificationService.list(req.userProfile.id, { limit });
    res.json({ status: 'success', data: { notifications } });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/me/notifications/read-all — mark every notification read
router.post('/me/notifications/read-all', requireAuth, async (req, res, next) => {
  try {
    await NotificationService.markAllRead(req.userProfile.id);
    res.json({ status: 'success', data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/me/notifications/:id/read — mark one notification read
router.post('/me/notifications/:id/read', requireAuth, async (req, res, next) => {
  try {
    await NotificationService.markRead(req.userProfile.id, req.params.id);
    res.json({ status: 'success', data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/me/orders (Place a new order — payment deferred, pay on delivery)
// The same order placement as POST /api/v1/orders, and held to the same two rules,
// because a second door into checkout is only safe while it is the same door:
//   - `canPurchase`, so an account whose contact is unverified or whose onboarding
//     is unfinished cannot place here what the other route refuses it;
//   - the Idempotency-Key header, so a retried request after a dropped connection
//     returns the order that was already placed instead of placing a second one.
router.post('/me/orders', requireAuth, requireCapability('canPurchase'), async (req, res, next) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.body?.idempotencyKey || null;
    const order = await PurchaseHistoryUseCase.createOrder(req.userProfile.id, req.body, { idempotencyKey });
    await UserActivityUseCase.recordActivity(req.userProfile.id, {
      actionType: 'order_placed',
      title: 'Order Placed',
      description: `Placed order ${order.orderNumber} (XAF ${order.totalAmountXaf}).`,
      resourceType: 'order',
      resourceId: order.id
    });
    // Server-side notification so the buyer's feed reflects the order everywhere
    // they sign in — not just on the device that placed it.
    await NotificationService.create(req.userProfile.id, {
      type: 'order',
      tone: 'accent',
      title: `Order ${order.orderNumber} placed`,
      body: `Your order is confirmed — pay on delivery. Total XAF ${order.totalAmountXaf}.`,
      metadata: { orderId: order.id, orderNumber: order.orderNumber }
    });
    res.status(201).json({
      status: 'success',
      data: { order }
    });
  } catch (err) {
    next(err);
  }
});

// ── 04.07 ACTIVITY HISTORY ──
// GET /api/v1/users/me/activities
router.get('/me/activities', requireAuth, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = parseInt(req.query.offset, 10) || 0;
    const result = await UserActivityUseCase.getActivityFeed(req.userProfile.id, { limit, offset });
    res.json({
      status: 'success',
      data: result
    });
  } catch (err) {
    next(err);
  }
});

// ── 04.08 ADDRESSES MANAGEMENT ──
// GET /api/v1/users/me/addresses
router.get('/me/addresses', requireAuth, async (req, res, next) => {
  try {
    const addresses = await AddressManagementUseCase.listAddresses(req.userProfile.id);
    res.json({
      status: 'success',
      data: { addresses }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/me/addresses
router.post('/me/addresses', requireAuth, async (req, res, next) => {
  try {
    const address = await AddressManagementUseCase.addAddress(req.userProfile.id, req.body);
    await UserActivityUseCase.recordActivity(req.userProfile.id, {
      actionType: 'address_added',
      title: 'Address Added',
      description: `Added address in ${address.city}, ${address.quarter || address.streetAddress}.`,
      resourceType: 'address',
      resourceId: address.id
    });
    res.status(201).json({
      status: 'success',
      data: { address }
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/users/me/addresses/:id
router.patch('/me/addresses/:id', requireAuth, async (req, res, next) => {
  try {
    const updated = await AddressManagementUseCase.updateAddress(req.userProfile.id, req.params.id, req.body);
    res.json({
      status: 'success',
      data: { address: updated }
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/users/me/addresses/:id
router.delete('/me/addresses/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await AddressManagementUseCase.deleteAddress(req.userProfile.id, req.params.id);
    await UserActivityUseCase.recordActivity(req.userProfile.id, {
      actionType: 'address_removed',
      title: 'Address Removed',
      description: `Removed delivery address.`,
      resourceType: 'address',
      resourceId: req.params.id
    });
    res.json({
      status: 'success',
      data: result
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/me/addresses/:id/default
router.post('/me/addresses/:id/default', requireAuth, async (req, res, next) => {
  try {
    const updated = await AddressManagementUseCase.setDefaultAddress(req.userProfile.id, req.params.id);
    res.json({
      status: 'success',
      data: { address: updated }
    });
  } catch (err) {
    next(err);
  }
});

// ── 04.09 NOTIFICATION PREFERENCES ──
// GET /api/v1/users/me/notifications/preferences
router.get('/me/notifications/preferences', requireAuth, async (req, res, next) => {
  try {
    const preferences = await NotificationPreferencesUseCase.getPreferences(req.userProfile.id);
    res.json({
      status: 'success',
      data: { preferences }
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/users/me/notifications/preferences
router.patch('/me/notifications/preferences', requireAuth, async (req, res, next) => {
  try {
    const updated = await NotificationPreferencesUseCase.updatePreferences(req.userProfile.id, req.body);
    res.json({
      status: 'success',
      data: { preferences: updated }
    });
  } catch (err) {
    next(err);
  }
});

// ── 04.03 SETTINGS / SECURITY / PRIVACY ──
// GET /api/v1/users/me/sessions
router.get('/me/sessions', requireAuth, async (req, res, next) => {
  try {
    const sessions = await AccountSecurityService.getActiveSessions(
      req.principal.clerkUserId,
      req.auth.sessionId
    );
    res.json({
      status: 'success',
      data: { sessions }
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/users/me/sessions/:sessionId
router.delete('/me/sessions/:sessionId', requireAuth, async (req, res, next) => {
  try {
    const result = await AccountSecurityService.revokeSession(
      req.principal.clerkUserId,
      req.params.sessionId,
      { currentSessionId: req.auth.sessionId }
    );
    res.json({
      status: 'success',
      data: result
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/users/me/privacy
router.get('/me/privacy', requireAuth, async (req, res, next) => {
  try {
    const prefs = await PrivacyPreferencesUseCase.getPreferences(req.userProfile.id);
    res.json({
      status: 'success',
      data: { preferences: prefs }
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/users/me/privacy
router.patch('/me/privacy', requireAuth, async (req, res, next) => {
  try {
    const result = await PrivacyPreferencesUseCase.updatePreferences(req.userProfile.id, req.body);
    res.json({
      status: 'success',
      data: result
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/users/me (Account Deletion)
router.delete('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await DeleteAccountUseCase.execute(req.userProfile, req.body, {
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    res.json({
      status: 'success',
      data: result
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
