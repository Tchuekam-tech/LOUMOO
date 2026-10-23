/**
 * Use Case: Purchase History & Orders (04.06)
 * Queries authentic customer orders, projecting buyer-safe order representations
 * (items, delivery status, escrow state, payments) without leaking merchant margins.
 */

const { OrderCreationService } = require('../../commerce/application/OrderCreationService');
const { OrderQueryService } = require('../../commerce/application/OrderQueryService');
const { ValidationError, NotFoundError, AuthorizationError } = require('../../../shared/errors/AppError');
const logger = require('../../../shared/logging/logger');


class PurchaseHistoryUseCase {
  constructor() {
    this.creationService = new OrderCreationService();
    this.queryService = new OrderQueryService();
  }

  async getPurchaseHistory(userId, { status = 'all', limit = 20, offset = 0 } = {}) {
    if (!userId) throw new ValidationError('User ID is required');
    return this.queryService.getUserOrders(userId, { status, limit, offset });
  }

  /**
   * Place a new order with server-authoritative pricing and validation.
   *
   * The idempotency key is passed through, not dropped: without it a retry after
   * a dropped connection places a second order for the same bag.
   */
  async createOrder(userId, payload = {}, { idempotencyKey = null } = {}) {
    if (!userId) throw new ValidationError('User ID is required');
    const order = await this.creationService.createOrder(userId, payload, { idempotencyKey });
    return order.toJSON();
  }

  /**
   * Get details for a single order (Strict buyer ownership verification / anti-IDOR)
   */
  async getOrderDetails(userId, orderId) {
    if (!userId || !orderId) throw new ValidationError('User ID and Order ID are required');
    return this.queryService.getOrderById(orderId, userId);
  }

  _mapRow(row) {
    return {
      id: row.id,
      buyerId: row.buyer_id,
      sellerId: row.seller_id,
      orderNumber: row.order_number,
      totalAmountXaf: Number(row.total_amount_xaf),
      items: row.items || [],
      shippingAddress: row.shipping_address || {},
      paymentStatus: row.payment_status,
      fulfillmentStatus: row.fulfillment_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

module.exports = new PurchaseHistoryUseCase();

