/**
 * LOUMOO Commerce Core — Order Lifecycle Service
 * ---------------------------------------------------------------------------
 * Governs order status transitions and buyer cancellation workflows.
 * Enforces OrderStateMachine rules, concurrency checks, and anti-IDOR security.
 */

const { OrderRepository } = require('../infrastructure/OrderRepository');
const { OrderStateMachine } = require('../domain/OrderStateMachine');
const { FULFILLMENT_STATUS } = require('../domain/Order');
const CacheService = require('../../../infrastructure/cache/CacheService');
const { NotFoundError, ValidationError, AuthorizationError, ConflictError } = require('../../../shared/errors/AppError');
const logger = require('../../../shared/logging/logger');

let UserActivityUseCase = null;
let NotificationService = null;
try { UserActivityUseCase = require('../../identity/application/UserActivityUseCase'); } catch (e) {}
try { NotificationService = require('../../identity/application/NotificationService'); } catch (e) {}

/**
 * An order that is cancelled must not leave a rider heading to the shop. The
 * delivery module depends on commerce, so this is a lazy, best-effort call in
 * the other direction: it can never fail or slow the cancellation itself.
 */
async function cancelOpenDelivery(orderId, reason, actorId) {
  try {
    const { getSharedDeliveryService } = require('../../delivery/application/DeliveryService');
    await getSharedDeliveryService().cancelForOrder(orderId, { reason: reason || 'Order cancelled', actorId });
  } catch (e) {
    logger.warn(`[OrderLifecycle] Could not cancel the delivery for order ${orderId}: ${e.message}`);
  }
}

class OrderLifecycleService {
  constructor(repository = null) {
    this.repository = repository || new OrderRepository();
  }

  /**
   * Cancels an order on behalf of the authenticated buyer (or merchant/admin).
   *
   * @param {string} orderId - ID or Order Number
   * @param {string} callerId - Authenticated user ID
   * @param {string} [reason='Buyer requested cancellation']
   * @param {object} [options]
   * @param {string} [options.userRole='customer']
   * @returns {Promise<object>} Cancelled order
   */
  async cancelOrder(orderId, callerId, reason = 'Buyer requested cancellation', { userRole = 'customer' } = {}) {
    if (!orderId) throw new ValidationError('Order ID is required.');
    if (!callerId) throw new AuthorizationError('Authentication required.');

    const order = await this.repository.findOrderById(orderId);
    if (!order) {
      throw new NotFoundError('Order not found');
    }

    // Ownership check (404 Anti-Enumeration for non-owners)
    const isBuyer = order.buyerId === callerId;
    const isSeller = order.sellerId === callerId;
    const isAdmin = userRole === 'admin' || userRole === 'super_admin';

    if (!isBuyer && !isSeller && !isAdmin) {
      throw new NotFoundError('Order not found');
    }

    // Assert that the order can be cancelled in its current state
    OrderStateMachine.assertBuyerCanCancel(order.fulfillmentStatus, order.orderNumber);

    // Concurrency-safe atomic transition: only succeeds if still in PROCESSING status
    const cancelledOrder = await this.repository.updateFulfillmentStatusAtomic(
      order.id,
      FULFILLMENT_STATUS.PROCESSING,
      FULFILLMENT_STATUS.CANCELLED,
      {
        note: reason || 'Order cancelled',
        updatedBy: callerId
      }
    );

    await cancelOpenDelivery(order.id, reason, callerId);

    // Invalidate Buyer's Cache
    try {
      if (CacheService.delPattern) {
        await CacheService.delPattern(`purchases:${order.buyerId}:*`);
      } else if (CacheService.del) {
        await CacheService.del(`purchases:${order.buyerId}:all:20:0`);
      }
    } catch (e) {}

    // Activity log & notification
    if (UserActivityUseCase && typeof UserActivityUseCase.recordActivity === 'function') {
      UserActivityUseCase.recordActivity(order.buyerId, {
        actionType: 'order_cancelled',
        title: 'Order Cancelled',
        description: `Order ${order.orderNumber} was cancelled.`,
        resourceType: 'order',
        resourceId: order.id
      }).catch(e => logger.warn(`[OrderLifecycle] Activity log error: ${e.message}`));
    }

    if (NotificationService && typeof NotificationService.create === 'function') {
      NotificationService.create(order.buyerId, {
        type: 'order',
        tone: 'critical',
        title: `Order ${order.orderNumber} cancelled`,
        body: `Your order was cancelled. (${reason || 'Buyer requested'})`,
        metadata: { orderId: order.id, orderNumber: order.orderNumber }
      }).catch(e => logger.warn(`[OrderLifecycle] Notification error: ${e.message}`));
    }

    return cancelledOrder.toJSON();
  }

  /**
   * Transitions fulfillment status (merchant or admin operation).
   *
   * @param {string} orderId
   * @param {string} nextStatus
   * @param {string} callerId
   * @param {object} [options]
   * @param {string} [options.userRole='seller']
   * @param {string} [options.note='']
   * @returns {Promise<object>}
   */
  async updateFulfillmentStatus(orderId, nextStatus, callerId, { userRole = 'seller', note = '' } = {}) {
    if (!orderId) throw new ValidationError('Order ID is required.');
    if (!nextStatus) throw new ValidationError('Target status is required.');
    if (!callerId) throw new AuthorizationError('Authentication required.');

    const order = await this.repository.findOrderById(orderId);
    if (!order) {
      throw new NotFoundError('Order not found');
    }

    const isSeller = order.sellerId === callerId;
    const isAdmin = userRole === 'admin' || userRole === 'super_admin';

    if (!isSeller && !isAdmin) {
      throw new NotFoundError('Order not found');
    }

    // Enforce state transition rules
    OrderStateMachine.assertTransition(order.fulfillmentStatus, nextStatus, order.orderNumber);

    const updated = await this.repository.updateFulfillmentStatusAtomic(
      order.id,
      order.fulfillmentStatus,
      nextStatus,
      { note, updatedBy: callerId }
    );

    if (nextStatus === FULFILLMENT_STATUS.CANCELLED) {
      await cancelOpenDelivery(order.id, note, callerId);
    }

    // Invalidate Buyer's Cache
    try {
      if (CacheService.delPattern) {
        await CacheService.delPattern(`purchases:${order.buyerId}:*`);
      }
    } catch (e) {}

    return updated.toJSON();
  }
}

module.exports = { OrderLifecycleService };
