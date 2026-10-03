/**
 * LOUMOO Delivery — in-process event bus
 * ---------------------------------------------------------------------------
 * Fan-out for live updates (the SSE stream added in the routes step). The
 * service publishes `status`, `location` and `eta` events per delivery; each open
 * stream subscribes to one delivery id.
 *
 * Scope: ONE server process. That matches the current single-instance Railway
 * deployment. If the API is ever scaled horizontally, replace publish/subscribe
 * with Redis pub/sub behind this same interface — callers don't change.
 *
 * Listener errors are contained: a broken subscriber must never fail the write
 * that triggered the event.
 */

const { EventEmitter } = require('events');
const logger = require('../../../shared/logging/logger');

class DeliveryEvents {
  constructor() {
    this.emitter = new EventEmitter();
    // One listener per open customer/seller/rider stream; the default of 10
    // would warn on a busy delivery.
    this.emitter.setMaxListeners(0);
  }

  publish(deliveryId, event) {
    if (!deliveryId || !event || !event.type) return;
    try {
      this.emitter.emit(`d:${deliveryId}`, event);
    } catch (err) {
      logger.warn(`[DeliveryEvents] Listener for ${deliveryId} threw: ${err.message}`);
    }
  }

  /** Subscribes to a delivery's events. Returns an unsubscribe function. */
  subscribe(deliveryId, listener) {
    const channel = `d:${deliveryId}`;
    const safe = (event) => {
      try {
        listener(event);
      } catch (err) {
        logger.warn(`[DeliveryEvents] Subscriber for ${deliveryId} threw: ${err.message}`);
      }
    };
    this.emitter.on(channel, safe);
    return () => this.emitter.off(channel, safe);
  }

  listenerCount(deliveryId) {
    return this.emitter.listenerCount(`d:${deliveryId}`);
  }
}

module.exports = new DeliveryEvents();
module.exports.DeliveryEvents = DeliveryEvents;
