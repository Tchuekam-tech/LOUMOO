/**
 * LOUMOO Delivery — State Machine
 * ---------------------------------------------------------------------------
 * Legal delivery transitions, and how a delivery status drives the order's
 * `fulfillmentStatus`. Mirrors the table in docs/DELIVERY_API.md.
 */

const { DELIVERY_STATUS: S } = require('./Delivery');
const { FULFILLMENT_STATUS } = require('../../commerce/domain/Order');
const { ConflictError, ValidationError } = require('../../../shared/errors/AppError');

const ALLOWED_TRANSITIONS = Object.freeze({
  [S.PENDING_ASSIGNMENT]: Object.freeze([S.ASSIGNED, S.CANCELLED]),
  // `assigned -> assigned` is a re-assignment to a different rider; the service
  // permits it explicitly via canAssign(), not as a generic transition.
  [S.ASSIGNED]: Object.freeze([S.ACCEPTED, S.PENDING_ASSIGNMENT, S.CANCELLED]),
  // `accepted -> pending_assignment` is the rider releasing a job they can no
  // longer do, so the seller can hand it on without cancelling.
  [S.ACCEPTED]: Object.freeze([S.PICKED_UP, S.PENDING_ASSIGNMENT, S.CANCELLED]),
  [S.PICKED_UP]: Object.freeze([S.ARRIVED, S.FAILED]),
  [S.ARRIVED]: Object.freeze([S.DELIVERED, S.FAILED]),
  [S.FAILED]: Object.freeze([S.ASSIGNED]),
  [S.DELIVERED]: Object.freeze([]),
  [S.CANCELLED]: Object.freeze([])
});

// Only these delivery statuses move the order. Everything else leaves it alone:
// in particular `cancelled` does NOT cancel the order (the seller may re-dispatch
// it), and `failed` keeps it in transit until it is resolved.
const ORDER_STATUS_FOR_DELIVERY = Object.freeze({
  [S.PICKED_UP]: FULFILLMENT_STATUS.IN_TRANSIT,
  [S.DELIVERED]: FULFILLMENT_STATUS.DELIVERED
});

class DeliveryStateMachine {
  static canTransition(current, next) {
    const allowed = ALLOWED_TRANSITIONS[current];
    return Array.isArray(allowed) && allowed.includes(next);
  }

  static assertTransition(current, next, label = 'Delivery') {
    if (!ALLOWED_TRANSITIONS[current]) {
      throw new ValidationError(`Unknown delivery status: "${current}"`);
    }
    if (!Object.values(S).includes(next)) {
      throw new ValidationError(`Unknown delivery status: "${next}"`);
    }
    if (current === next) {
      throw new ConflictError(`${label} is already "${current}".`);
    }
    if (!DeliveryStateMachine.canTransition(current, next)) {
      if (current === S.DELIVERED) throw new ConflictError(`${label} is already delivered.`);
      if (current === S.CANCELLED) throw new ConflictError(`${label} has been cancelled.`);
      throw new ConflictError(`Invalid delivery transition from "${current}" to "${next}".`);
    }
  }

  /** A seller may hand an open, un-started delivery to a (different) rider. */
  static canAssign(current) {
    return [S.PENDING_ASSIGNMENT, S.ASSIGNED, S.FAILED].includes(current);
  }

  static assertCanAssign(current, label = 'Delivery') {
    if (!DeliveryStateMachine.canAssign(current)) {
      throw new ConflictError(`${label} cannot be assigned while it is "${current}".`);
    }
  }

  /** The order status this delivery status implies, or null if it implies none. */
  static orderStatusFor(deliveryStatus) {
    return ORDER_STATUS_FOR_DELIVERY[deliveryStatus] || null;
  }
}

module.exports = { DeliveryStateMachine, ALLOWED_TRANSITIONS, ORDER_STATUS_FOR_DELIVERY };
