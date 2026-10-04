/**
 * LOUMOO Delivery — Application service
 * ---------------------------------------------------------------------------
 * Every delivery use case: create, assign, accept/decline, status updates, GPS
 * pings, handover-code completion, cancellation, and the participant-scoped
 * reads. Implements docs/DELIVERY_API.md.
 *
 * Trust model (same rules as the order module):
 *   - Identity comes from the authenticated caller only, never from a body field.
 *   - A non-participant gets 404, not 403 (no enumeration of delivery ids).
 *   - A participant without the right role gets 403.
 *   - Every state change is a compare-and-swap in the repository, so two racing
 *     requests cannot both win.
 *   - The order's fulfillment status is DRIVEN by the delivery (picked_up ->
 *     in_transit, delivered -> delivered), through the order module's own state
 *     machine and atomic update.
 */

const { DeliveryRepository } = require('../infrastructure/DeliveryRepository');
const deliveryEvents = require('../infrastructure/DeliveryEvents');
const { OrderRepository } = require('../../commerce/infrastructure/OrderRepository');
const { OrderStateMachine } = require('../../commerce/domain/OrderStateMachine');
const { FULFILLMENT_STATUS, DELIVERY_METHOD, PAYMENT_STATUS } = require('../../commerce/domain/Order');
const { DeliveryStateMachine } = require('../domain/DeliveryStateMachine');
const { codeFor, verifyCode, HANDOVER_CODE_DIGITS } = require('../domain/HandoverCode');
const {
  DELIVERY_STATUS: S,
  DRIVER_STATUS,
  LOCATION_ACCEPTING_STATUSES,
  LOCATION_MIN_INTERVAL_MS,
  LOCATION_MAX_ACCURACY_M,
  LOCATION_MAX_PLAUSIBLE_KMH,
  LOCATION_PLAUSIBILITY_WINDOW_MS,
  MAX_HANDOVER_ATTEMPTS,
  DeliveryLockedError,
  newDeliveryId,
  parseLocation,
  optionalNumber,
  haversineKm,
  estimateEta,
  offerTtlMsFrom,
  isOfferLapsed,
  OFFER_EXPIRED_NOTE,
  RECENT_LAPSE_WINDOW_MS,
  OfferExpiredError,
  NoRiderAvailableError,
  describeAddress,
  describeArea,
  presentDelivery
} = require('../domain/Delivery');
const {
  NotFoundError,
  ValidationError,
  AuthorizationError,
  ConflictError,
  InfrastructureError
} = require('../../../shared/errors/AppError');
const logger = require('../../../shared/logging/logger');

let NotificationService = null;
try { NotificationService = require('../../identity/application/NotificationService'); } catch (e) {}
let CacheService = null;
try { CacheService = require('../../../infrastructure/cache/CacheService'); } catch (e) {}

const ADMIN_ROLES = ['admin', 'super_admin'];
const SELLER_ROLES = ['seller', 'seller_staff', ...ADMIN_ROLES];
const RIDER_REPORTABLE_STATUSES = [S.PICKED_UP, S.ARRIVED, S.FAILED];
const CANCELLABLE_STATUSES = [S.PENDING_ASSIGNMENT, S.ASSIGNED, S.ACCEPTED];
const CAS_RETRIES = 3;
// How many active riders one listing or auto-assign considers. Far above a
// realistic fleet; a warning is logged if it is ever reached.
const MAX_RIDERS_CONSIDERED = 500;
// Releasing lapsed offers ahead of a ranking: this many per round, at most this
// many rounds (so at most 200 per call), then stop. Bounded so one listing cannot
// become a long write storm; the sweeper and later calls take the rest.
const RELEASE_BATCH = 50;
const MAX_RELEASE_ROUNDS = 4;
const ORDER_PATH = [FULFILLMENT_STATUS.PROCESSING, FULFILLMENT_STATUS.IN_TRANSIT, FULFILLMENT_STATUS.DELIVERED];

function cleanText(value, field, max = 255) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be text`, [{ field, message: 'Expected a string.' }]);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new ValidationError(`${field} is too long`, [{ field, message: `Keep it under ${max} characters.` }]);
  }
  return trimmed;
}

class DeliveryService {
  /**
   * `offerTtlMs` is how long a rider has to accept an assigned delivery (0 = never
   * expires). Unset, it comes from DELIVERY_OFFER_TTL_MINUTES, then the default.
   * An explicit value that is not a finite number >= 0 also falls back, so a bad
   * option cannot silently switch expiry off.
   */
  constructor({ repository, orderRepository, events, now, offerTtlMs } = {}) {
    this.repo = repository || new DeliveryRepository();
    this.orders = orderRepository || new OrderRepository();
    this.events = events || deliveryEvents;
    this.now = typeof now === 'function' ? now : () => Date.now();
    this._serialQueue = Promise.resolve(); // see _serialised()
    this.offerTtlMs = typeof offerTtlMs === 'number'
      ? offerTtlMsFrom(offerTtlMs / 60000)
      : offerTtlMsFrom(process.env.DELIVERY_OFFER_TTL_MINUTES);
  }

  // ----------------------------------------------------------------- identity

  _caller(caller) {
    const userId = caller && caller.userId;
    if (!userId) throw new AuthorizationError('Authentication required.');
    return { userId: String(userId), userRole: (caller && caller.userRole) || 'customer' };
  }

  _isAdmin(role) { return ADMIN_ROLES.includes(role); }

  /** 'admin' | 'seller' | 'driver' | 'buyer' | null for this caller on this delivery. */
  _participantRole(delivery, caller) {
    if (this._isAdmin(caller.userRole)) return 'admin';
    if (delivery.sellerId && delivery.sellerId === caller.userId) return 'seller';
    if (delivery.driverId && delivery.driverId === caller.userId) return 'driver';
    if (delivery.buyerId === caller.userId) return 'buyer';
    return null;
  }

  async _loadForCaller(deliveryId, callerInput) {
    const caller = this._caller(callerInput);
    if (!deliveryId) throw new ValidationError('Delivery ID is required.');
    // A lapsed offer is released before anyone is judged against it, so a rider
    // whose window closed is no longer a participant (404, as after a decline).
    const delivery = await this._releaseIfLapsed(await this.repo.findById(deliveryId));
    const role = delivery ? this._participantRole(delivery, caller) : null;
    // Same response for "does not exist" and "not yours": no id enumeration.
    if (!delivery || !role) throw new NotFoundError('Delivery', deliveryId);
    return { caller, delivery, role };
  }

  async _requireStaff(deliveryId, callerInput) {
    const ctx = await this._loadForCaller(deliveryId, callerInput);
    if (ctx.role !== 'seller' && ctx.role !== 'admin') {
      throw new AuthorizationError('Only the seller or an administrator can do this.');
    }
    return ctx;
  }

  /**
   * The caller must be THE assigned rider and an active one. The assignment is
   * checked directly (not through the single-valued participant role), so a
   * seller who delivers their own parcel, or an admin acting as a rider, can
   * still use the rider endpoints on a delivery assigned to them.
   */
  async _requireAssignedRider(deliveryId, callerInput) {
    const caller = this._caller(callerInput);
    if (!deliveryId) throw new ValidationError('Delivery ID is required.');
    const delivery = await this.repo.findById(deliveryId);
    if (!delivery) throw new NotFoundError('Delivery', deliveryId);
    if (!delivery.driverId || delivery.driverId !== caller.userId) {
      if (!this._participantRole(delivery, caller)) throw new NotFoundError('Delivery', deliveryId);
      throw new AuthorizationError('Only the assigned rider can do this.');
    }
    // Suspension revokes work already assigned, not just new accepts.
    const driver = await this.repo.findDriver(caller.userId);
    if (!driver || driver.status !== DRIVER_STATUS.ACTIVE) {
      throw new AuthorizationError('Your rider account is not active.');
    }
    return { caller, delivery, role: 'driver', driver };
  }

  /** Refuses to move a delivery whose order has been cancelled in the meantime. */
  async _assertOrderNotCancelled(delivery) {
    const order = await this._freshOrder(delivery.orderId);
    if (!order) throw new NotFoundError('Order', delivery.orderId);
    if (order.fulfillmentStatus === FULFILLMENT_STATUS.CANCELLED) {
      throw new ConflictError('The order was cancelled, so this delivery cannot continue.');
    }
    return order;
  }

  // ------------------------------------------------------------- shared steps

  _nowIso() { return new Date(this.now()).toISOString(); }

  /**
   * The order as the database has it NOW. OrderRepository.findOrderById serves a
   * per-instance memory cache that is never invalidated, so an order cancelled or
   * refunded elsewhere would still look live here. Every guard and every status
   * sync in this service decides from a fresh read.
   */
  async _freshOrder(idOrNumber) {
    const repo = this.orders;
    return typeof repo.findOrderByIdFresh === 'function'
      ? repo.findOrderByIdFresh(idOrNumber)
      : repo.findOrderById(idOrNumber);
  }

  async _withDriver(delivery) {
    if (!delivery) return delivery;
    const withDriver = { ...delivery, driver: null };
    if (delivery.driverId) {
      const driver = await this.repo.findDriver(delivery.driverId);
      if (driver) withDriver.driver = { id: driver.id, name: driver.name, phone: driver.phone };
    }
    return withDriver;
  }

  async _present(delivery, role, { includeTimeline = true } = {}) {
    const hydrated = await this._withDriver(delivery);
    let timeline = [];
    if (includeTimeline) timeline = await this.repo.listEvents(delivery.id);
    let order = null;
    try { order = await this.orders.findOrderById(delivery.orderId); } catch (e) { /* number is cosmetic */ }
    return presentDelivery(hydrated, role, { timeline, order, offerTtlMs: this.offerTtlMs });
  }

  /**
   * Timeline row + live event, AFTER the state change has already been applied.
   * Best-effort by design: the compare-and-swap is the source of truth, and a
   * failing audit write must not abort the request and skip the order sync,
   * notifications and stream that follow (the rider would see an error for a
   * change that did happen, and retrying would be refused as a conflict).
   */
  async _record(delivery, previousStatus, actorId, note = null, { retries = 0 } = {}) {
    // `retries` is for rows other decisions depend on (the lapse row), which a single
    // transient failure would otherwise silently void.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.repo.insertEvent({
          deliveryId: delivery.id,
          status: delivery.status,
          previousStatus,
          actorId,
          note,
          at: delivery.updatedAt
        });
        break;
      } catch (err) {
        if (attempt < retries) continue;
        logger.error(`[Delivery] Timeline write failed for ${delivery.id} (${previousStatus} -> ${delivery.status}): ${err.message}`);
        break;
      }
    }
    this.events.publish(delivery.id, {
      type: 'status',
      status: delivery.status,
      at: delivery.updatedAt,
      etaMinutes: delivery.etaMinutes ?? null,
      distanceKm: delivery.distanceKm ?? null
    });
  }

  _notify(userId, { title, body, tone = 'accent', delivery }) {
    if (!userId || !NotificationService || typeof NotificationService.create !== 'function') return;
    NotificationService.create(userId, {
      type: 'delivery',
      tone,
      title,
      body,
      metadata: { deliveryId: delivery.id, orderId: delivery.orderId }
    }).catch((e) => logger.warn(`[Delivery] Notification error: ${e.message}`));
  }

  async _invalidateBuyerCache(buyerId) {
    try {
      if (CacheService && CacheService.delPattern) await CacheService.delPattern(`purchases:${buyerId}:*`);
    } catch (e) { /* cache is an optimisation */ }
  }

  /**
   * Brings the order in line with what the delivery now implies. Idempotent and
   * best-effort: the delivery is the source of truth for the rider, so a failure
   * here is logged loudly and can be repaired by calling reconcileOrder() again,
   * never by failing a rider's request after the parcel has already moved.
   */
  async _syncOrder(delivery, actorId) {
    const target = DeliveryStateMachine.orderStatusFor(delivery.status);
    if (!target) return;
    try {
      const order = await this._freshOrder(delivery.orderId);
      if (!order) {
        logger.error(`[Delivery] Order ${delivery.orderId} for delivery ${delivery.id} not found while syncing.`);
        return;
      }
      // Walk the order's own legal path (processing -> in_transit -> delivered),
      // so a missed pickup sync is repaired on the way to `delivered` instead of
      // being refused as an illegal jump and leaving a delivered parcel
      // 'processing' forever.
      const from = ORDER_PATH.indexOf(order.fulfillmentStatus);
      const to = ORDER_PATH.indexOf(target);
      if (from === -1) {
        logger.warn(`[Delivery] Order ${order.id} is "${order.fulfillmentStatus}"; not syncing delivery ${delivery.id}.`);
        return;
      }
      if (from >= to) return;
      let current = order.fulfillmentStatus;
      for (const step of ORDER_PATH.slice(from + 1, to + 1)) {
        OrderStateMachine.assertTransition(current, step, order.orderNumber);
        await this.orders.updateFulfillmentStatusAtomic(order.id, current, step, {
          note: `Delivery ${delivery.id} is ${delivery.status}`,
          updatedBy: actorId || 'delivery'
        });
        current = step;
      }
      await this._invalidateBuyerCache(order.buyerId);
    } catch (err) {
      logger.error(`[Delivery] Could not sync order ${delivery.orderId} to "${target}" for delivery ${delivery.id}: ${err.message}`);
    }
  }

  /** Repair path: re-applies the order status for a delivery. Admin/ops use. */
  async reconcileOrder(deliveryId, callerInput) {
    const caller = this._caller(callerInput);
    if (!this._isAdmin(caller.userRole)) throw new AuthorizationError('Only an administrator can reconcile an order.');
    const delivery = await this.repo.findById(deliveryId);
    if (!delivery) throw new NotFoundError('Delivery', deliveryId);
    await this._syncOrder(delivery, 'reconcile');
    return { reconciled: true, deliveryStatus: delivery.status };
  }

  async _transition(delivery, expected, patch, { actorId, note = null, label }) {
    const updated = await this.repo.updateWhere(delivery.id, expected, patch);
    if (!updated) {
      throw new ConflictError(`${label || 'Delivery'} was changed by someone else. Reload and try again.`);
    }
    await this._record(updated, delivery.status, actorId, note);
    return updated;
  }

  // ------------------------------------------------------------- offer expiry

  /**
   * Returns a lapsed offer to the seller. Returns the updated record, or `null`
   * when someone else got there first (the rider accepted, the seller
   * re-assigned or cancelled): the caller should re-read, not retry.
   *
   * The swap is guarded on `assignedAt` as well as the rider: a seller who
   * re-assigns the same rider while a sweep is in flight has just started a
   * fresh window, and a status+rider match alone would expire it.
   *
   * The timeline row names the RIDER as the actor (the transition is their
   * silence, and `_ridersWhoPassed` reads it to keep them off the next offer).
   */
  async _expireOffer(delivery) {
    const riderId = delivery.driverId;
    const updated = await this.repo.updateWhere(
      delivery.id,
      { status: S.ASSIGNED, driverId: riderId, assignedAt: delivery.assignedAt },
      // updatedAt is the lapse's timestamp (it becomes the timeline row's time, which
      // the recent-lapse ranking compares with this service's clock), so it is
      // stamped here rather than left to the repository's own wall clock.
      { status: S.PENDING_ASSIGNMENT, driverId: null, assignedAt: null, acceptedAt: null, updatedAt: this._nowIso() }
    );
    if (!updated) return null;
    // Retried once: the recent-lapse ranking, the declined flag and the late-accept
    // answer all read this row, and a lost one would silently void them.
    await this._record(updated, S.ASSIGNED, riderId, OFFER_EXPIRED_NOTE, { retries: 1 });
    this._notify(updated.sellerId, {
      title: 'A rider did not respond',
      body: 'The offer expired. Assign another rider to keep the order moving.',
      tone: 'neutral',
      delivery: updated
    });
    this._notify(riderId, {
      title: 'A delivery offer expired',
      body: 'It was not accepted in time and went back to the seller.',
      tone: 'neutral',
      delivery: updated
    });
    return updated;
  }

  /**
   * The delivery as it stands now: if its offer has lapsed, releases it first.
   * Every read path calls this, so a deployment that cannot run the sweeper
   * (serverless) still never shows or honours a dead offer.
   */
  async _releaseIfLapsed(delivery) {
    if (!delivery || !isOfferLapsed(delivery, this.offerTtlMs, this.now())) return delivery;
    let released;
    try {
      released = await this._expireOffer(delivery);
    } catch (err) {
      // Best effort. A read must not become a 500 because the housekeeping write
      // failed (a degraded write path with working reads, a locked row): show the
      // delivery as it is. Accept still refuses a lapsed offer on its own, and the
      // sweeper or the next read retries the release.
      logger.warn(`[Delivery] Could not release lapsed offer ${delivery.id} while reading it: ${err.message}`);
      return delivery;
    }
    if (released) return released;
    // Lost the race: whatever happened is the truth now.
    return (await this.repo.findById(delivery.id)) || delivery;
  }

  /**
   * Sweeps lapsed offers back to their sellers. For the background sweeper; the
   * reads above cover the same ground one delivery at a time. Bounded per call
   * (`limit`), so a backlog is worked off over several ticks, and one failing
   * row never stops the rest. Returns how many were released.
   */
  async expireStaleOffers({ limit = 50 } = {}) {
    if (!(this.offerTtlMs > 0)) return { expired: 0 };
    const cutoff = new Date(this.now() - this.offerTtlMs).toISOString();
    const stale = await this.repo.findStaleOffers(cutoff, { limit });
    let expired = 0;
    for (const delivery of stale) {
      try {
        if (await this._expireOffer(delivery)) expired += 1;
      } catch (err) {
        logger.error(`[Delivery] Could not expire offer ${delivery.id}: ${err.message}`);
        if (err instanceof InfrastructureError) {
          // The database itself is failing, not this row: do not repeat the failure
          // for every remaining offer. The next tick (or call) retries.
          logger.error('[Delivery] Stopping this sweep: the database looks unhealthy.');
          break;
        }
      }
    }
    return { expired };
  }

  // ------------------------------------------------------------------- create

  async createDelivery(orderId, callerInput, input = {}) {
    const caller = this._caller(callerInput);
    if (!orderId) throw new ValidationError('Order ID is required.');

    const order = await this._freshOrder(orderId);
    const isAdmin = this._isAdmin(caller.userRole);
    if (!order || (!isAdmin && order.sellerId !== caller.userId)) {
      throw new NotFoundError('Order', orderId);
    }

    if (order.deliveryMethod !== DELIVERY_METHOD.HOME_DELIVERY) {
      throw new ConflictError('Only home-delivery orders can have a delivery.');
    }
    if (order.fulfillmentStatus !== FULFILLMENT_STATUS.PROCESSING) {
      throw new ConflictError(`A delivery can only be created while the order is processing (it is "${order.fulfillmentStatus}").`);
    }
    if (order.paymentStatus === PAYMENT_STATUS.REFUNDED) {
      throw new ConflictError('This order was refunded and cannot be delivered.');
    }

    const latest = await this.repo.findByOrder(order.id);
    if (latest && latest.status === S.DELIVERED) {
      // The order can still read "processing" if its sync was missed; a second
      // delivery for a parcel that was already handed over must not be created.
      throw new ConflictError('This order was already delivered.', { deliveryId: latest.id });
    }
    if (latest && latest.status !== S.CANCELLED) {
      throw new ConflictError('This order already has an open delivery.', { deliveryId: latest.id });
    }

    const body = input && typeof input === 'object' ? input : {};
    const pickupIn = body.pickup && typeof body.pickup === 'object' ? body.pickup : {};
    const ship = order.shippingAddress || {};
    const firstItem = order.items && order.items[0];

    const pickup = {
      label: cleanText(pickupIn.label, 'pickup.label', 120) || (firstItem && firstItem.storeName) || 'Pickup',
      address: cleanText(pickupIn.address, 'pickup.address'),
      contactPhone: order.sellerPhone || null,
      location: parseLocation(pickupIn.location, 'pickup.location')
    };
    const dropoff = {
      label: cleanText(ship.fullName, 'dropoff.label', 120) || 'Customer',
      address: cleanText(body.dropoffAddress, 'dropoffAddress') || describeAddress(ship) || null,
      area: describeArea(ship) || null,
      contactPhone: ship.phone || null,
      notes: ship.notes || null,
      location: parseLocation(body.dropoffLocation, 'dropoffLocation')
    };

    const nowIso = this._nowIso();
    const record = {
      id: newDeliveryId(),
      orderId: order.id,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      driverId: null,
      status: S.PENDING_ASSIGNMENT,
      pickup,
      dropoff,
      handoverNonce: 1,
      codeAttempts: 0,
      etaMinutes: null,
      distanceKm: null,
      lastLocation: null,
      failureReason: null,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    const created = await this.repo.insertDelivery(record);
    await this._record(created, null, caller.userId, 'Delivery created');
    this._notify(order.buyerId, {
      title: `Delivery being arranged for order ${order.orderNumber}`,
      body: 'We are finding a rider for your order.',
      delivery: created
    });

    return this._present(created, isAdmin ? 'admin' : 'seller');
  }

  // ------------------------------------------------------------------- assign

  async assignDriver(deliveryId, driverId, callerInput) {
    const { caller, delivery, role } = await this._requireStaff(deliveryId, callerInput);
    if (!driverId || typeof driverId !== 'string') {
      throw new ValidationError('driverId is required', [{ field: 'driverId', message: 'Choose a rider.' }]);
    }
    DeliveryStateMachine.assertCanAssign(delivery.status);
    await this._assertOrderNotCancelled(delivery);

    const driver = await this.repo.findDriver(driverId);
    if (!driver || driver.status !== DRIVER_STATUS.ACTIVE) {
      throw new ValidationError('That rider is not available', [{ field: 'driverId', message: 'Unknown or suspended rider.' }]);
    }
    if (driver.id === delivery.buyerId) {
      // A rider who is also the buyer could read the handover code to themselves.
      throw new ValidationError('A rider cannot deliver their own order', [{ field: 'driverId', message: 'Choose a different rider.' }]);
    }

    return this._applyAssignment(delivery, driver, caller, role, `Assigned to ${driver.name}`);
  }

  /**
   * Picks the rider for the seller: the least busy active rider who is not the
   * buyer, has not already handed this delivery back, and is not the rider who
   * already holds the offer (re-offering to them would change nothing). Ties
   * break by name, then id, so the choice is deterministic. There is no
   * "nearest" rider: positions are only recorded during a delivery (see
   * decision 10 in docs/DELIVERY_API.md).
   */
  async autoAssignDriver(deliveryId, callerInput) {
    // Who is asking comes first. Releasing lapsed offers is platform-wide work —
    // up to MAX_RELEASE_ROUNDS * RELEASE_BATCH swaps, each with a timeline row and
    // two notifications — so a caller with no claim to this delivery must not be
    // able to set it going by naming an id at random. GET /drivers guards its own
    // ranking the same way, by role.
    await this._requireStaff(deliveryId, callerInput);

    // Only then release lapsed offers, and BEFORE this delivery is read for the
    // swap. If the ranking did it afterwards, it could release the very delivery
    // being assigned (its offer lapsing between the read and the ranking) and the
    // swap below would fail with a spurious "changed by someone else". The second
    // read is one row, against a sweep of up to two hundred.
    await this._releaseLapsedOffers();
    const { caller, delivery, role } = await this._requireStaff(deliveryId, callerInput);
    DeliveryStateMachine.assertCanAssign(delivery.status);
    await this._assertOrderNotCancelled(delivery);

    // Rank and assign as ONE step, one at a time per process. Ranking reads each
    // rider's workload and the assignment is what changes it, so concurrent calls
    // (a bulk "assign all", two tabs) would all read the same zeros and offer every
    // delivery to the same rider. Serialised, each sees the previous one's offer.
    // Best effort across several API instances, which do not share this queue.
    return this._serialised(async () => {
      const [ranked, passed] = await Promise.all([this._rankedActiveRiders({ release: false }), this._ridersWhoPassed(delivery.id)]);
      const pick = ranked.find(({ driver }) => driver.id !== delivery.buyerId
        && !passed.has(driver.id)
        && !(delivery.status === S.ASSIGNED && driver.id === delivery.driverId));
      if (!pick) throw new NoRiderAvailableError();

      return this._applyAssignment(delivery, pick.driver, caller, role, `Auto-assigned to ${pick.driver.name}`);
    });
  }

  /** Runs `task` once every earlier serialised task has finished, whatever its outcome. */
  _serialised(task) {
    const result = this._serialQueue.then(task);
    this._serialQueue = result.then(() => {}, () => {});
    return result;
  }

  /** What the rider is told with a new offer: how long they have, when there is a limit. */
  _offerPrompt() {
    const base = 'Open LOUMOO to accept or decline it';
    if (!(this.offerTtlMs > 0)) return `${base}.`;
    // Rounded DOWN: the text must never promise more time than the server honours
    // (a rider who trusts "within 1 minute" on a 30 s window would be refused).
    const seconds = Math.floor(this.offerTtlMs / 1000);
    if (seconds < 60) return `${base} within ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
    const minutes = Math.floor(seconds / 60);
    return `${base} within ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
  }

  /**
   * The shared tail of assign and auto-assign: the rider is already chosen and
   * validated; this performs the compare-and-swap, notifies them and presents
   * the result. `note` is the timeline text.
   */
  async _applyAssignment(delivery, driver, caller, role, note) {
    const retrying = delivery.status === S.FAILED;
    const patch = {
      driverId: driver.id,
      status: S.ASSIGNED,
      assignedAt: this._nowIso(),
      acceptedAt: null,
      failureReason: null
    };
    if (retrying) {
      // A fresh attempt gets a fresh code and a clean trail (the customer is not
      // shown the old rider's position). It does NOT get a fresh guess budget:
      // codeAttempts is lifetime-per-delivery. Resetting it here would let a
      // seller and rider cycle arrived -> failed -> assigned to farm unlimited
      // guesses at a 4-digit code. Only an administrator can reset it.
      patch.handoverNonce = delivery.handoverNonce + 1;
      patch.pickedUpAt = null;
      patch.arrivedAt = null;
      patch.lastLocation = null;
      patch.etaMinutes = null;
      patch.distanceKm = null;
    }

    const updated = await this._transition(
      delivery,
      { status: delivery.status, driverId: delivery.driverId },
      patch,
      { actorId: caller.userId, note, label: 'Delivery' }
    );

    this._notify(driver.id, {
      title: 'New delivery assigned',
      body: this._offerPrompt(),
      delivery: updated
    });
    return this._present(updated, role);
  }

  // ------------------------------------------------------------ rider actions

  /**
   * True when `callerInput`'s most recent hand-back of this delivery was an offer
   * that lapsed on them (rather than a decline or a release). Read from the
   * timeline, whose lapse row names the rider as its actor.
   */
  async _offerLapsedFor(deliveryId, callerInput) {
    const caller = this._caller(callerInput);
    // No such delivery, or it is theirs right now (a fresh offer): nothing lapsed on them.
    const current = await this.repo.findById(deliveryId);
    if (!current || current.driverId === caller.userId) return false;
    let last = null;
    for (const e of await this.repo.listEvents(deliveryId)) {
      const handedBack = e.status === S.PENDING_ASSIGNMENT
        && (e.previousStatus === S.ASSIGNED || e.previousStatus === S.ACCEPTED);
      if (handedBack && e.actorId === caller.userId) last = e;
    }
    return Boolean(last) && last.note === OFFER_EXPIRED_NOTE;
  }

  async acceptDelivery(deliveryId, callerInput) {
    let ctx;
    try {
      ctx = await this._requireAssignedRider(deliveryId, callerInput);
    } catch (err) {
      // The sweeper (or any read) may already have released a lapsed offer by the
      // time the rider taps Accept, which makes them a stranger to the delivery
      // (404), or, for a seller or admin delivering it themselves, a participant
      // who is no longer the holder (403). Tell them it was too late, as for a
      // lapse not yet released.
      const notTheHolder = err instanceof NotFoundError || err instanceof AuthorizationError;
      if (notTheHolder && await this._offerLapsedFor(deliveryId, callerInput)) {
        throw new OfferExpiredError();
      }
      throw err;
    }
    const { caller, delivery, driver } = ctx;
    DeliveryStateMachine.assertTransition(delivery.status, S.ACCEPTED);
    if (isOfferLapsed(delivery, this.offerTtlMs, this.now())) {
      // Too late: hand it back to the seller now (best effort) and say why. The
      // rider must never win a race against the deadline.
      try {
        await this._expireOffer(delivery);
      } catch (err) {
        logger.error(`[Delivery] Could not release lapsed offer ${delivery.id}: ${err.message}`);
      }
      throw new OfferExpiredError();
    }
    await this._assertOrderNotCancelled(delivery);

    const updated = await this._transition(
      delivery,
      { status: S.ASSIGNED, driverId: caller.userId },
      { status: S.ACCEPTED, acceptedAt: this._nowIso() },
      { actorId: caller.userId, note: 'Rider accepted' }
    );
    this._notify(updated.buyerId, {
      title: 'A rider accepted your delivery',
      body: `${driver.name} will pick up your order.`,
      tone: 'success',
      delivery: updated
    });
    return this._present(updated, 'driver');
  }

  async declineDelivery(deliveryId, callerInput) {
    const { caller, delivery } = await this._requireAssignedRider(deliveryId, callerInput);
    DeliveryStateMachine.assertTransition(delivery.status, S.PENDING_ASSIGNMENT);

    const updated = await this._transition(
      delivery,
      { status: delivery.status, driverId: caller.userId },
      { status: S.PENDING_ASSIGNMENT, driverId: null, assignedAt: null, acceptedAt: null },
      { actorId: caller.userId, note: delivery.status === S.ACCEPTED ? 'Rider released the delivery' : 'Rider declined' }
    );
    this._notify(updated.sellerId, {
      title: 'A rider declined a delivery',
      body: 'Assign another rider to keep the order moving.',
      delivery: updated
    });
    // The rider no longer has a stake in this delivery, so they get no view of it.
    return { id: updated.id, status: updated.status };
  }

  async updateStatus(deliveryId, nextStatus, note, callerInput) {
    const { caller, delivery } = await this._requireAssignedRider(deliveryId, callerInput);
    if (!RIDER_REPORTABLE_STATUSES.includes(nextStatus)) {
      throw new ValidationError('A rider can only report picked_up, arrived or failed', [
        { field: 'status', message: `Use one of: ${RIDER_REPORTABLE_STATUSES.join(', ')}.` }
      ]);
    }
    DeliveryStateMachine.assertTransition(delivery.status, nextStatus);
    // A locked delivery is frozen for the rider. Letting them report `failed`
    // would route around the lock (and, with a retry, around the guess budget);
    // an administrator resolves it with resolveDelivery().
    if (delivery.codeAttempts >= MAX_HANDOVER_ATTEMPTS) throw new DeliveryLockedError();

    const cleanNote = cleanText(note, 'note', 500);
    if (nextStatus === S.FAILED && !cleanNote) {
      throw new ValidationError('A reason is required when a delivery fails', [
        { field: 'note', message: 'Say why the delivery could not be completed.' }
      ]);
    }

    const nowIso = this._nowIso();
    const patch = { status: nextStatus };
    if (nextStatus === S.PICKED_UP) {
      await this._assertOrderNotCancelled(delivery);
      patch.pickedUpAt = nowIso;
      const eta = delivery.lastLocation ? estimateEta(delivery.lastLocation, delivery.dropoff && delivery.dropoff.location) : null;
      if (eta) { patch.etaMinutes = eta.etaMinutes; patch.distanceKm = eta.distanceKm; }
    } else if (nextStatus === S.ARRIVED) {
      await this._assertOrderNotCancelled(delivery);
      patch.arrivedAt = nowIso;
      patch.etaMinutes = 0;
    } else {
      patch.failureReason = cleanNote;
    }

    const updated = await this._transition(
      delivery,
      { status: delivery.status, driverId: caller.userId },
      patch,
      { actorId: caller.userId, note: cleanNote }
    );

    await this._syncOrder(updated, caller.userId);

    const buyerMessage = {
      [S.PICKED_UP]: { title: 'Your order is on its way', body: 'The rider has your parcel.', tone: 'accent' },
      [S.ARRIVED]: { title: 'Your rider has arrived', body: 'Share your handover code with the rider.', tone: 'success' },
      [S.FAILED]: { title: 'Delivery could not be completed', body: 'We will arrange another attempt.', tone: 'neutral' }
    }[nextStatus];
    this._notify(updated.buyerId, { ...buyerMessage, delivery: updated });
    if (nextStatus === S.FAILED) {
      this._notify(updated.sellerId, {
        title: 'A delivery failed',
        body: cleanNote,
        tone: 'neutral',
        delivery: updated
      });
    }

    return this._present(updated, 'driver');
  }

  async recordLocation(deliveryId, input, callerInput) {
    const { caller, delivery } = await this._requireAssignedRider(deliveryId, callerInput);
    if (!LOCATION_ACCEPTING_STATUSES.includes(delivery.status)) {
      throw new ConflictError(`Location is only accepted while a delivery is accepted, picked up or arrived (it is "${delivery.status}").`);
    }

    const body = input && typeof input === 'object' ? input : {};
    const point = parseLocation({ lat: body.lat, lng: body.lng }, 'location');
    if (!point) {
      throw new ValidationError('lat and lng are required', [{ field: 'lat', message: 'Send the current position.' }]);
    }
    const speedKmh = optionalNumber(body.speedKmh, 'speedKmh', { min: 0, max: 400 });
    const heading = optionalNumber(body.heading, 'heading', { min: 0, max: 360, exclusiveMax: true });
    const accuracyM = optionalNumber(body.accuracyM, 'accuracyM', { min: 0, max: 1e6 });
    if (accuracyM !== null && accuracyM > LOCATION_MAX_ACCURACY_M) {
      throw new ValidationError(`GPS accuracy is too low (${Math.round(accuracyM)} m)`, [
        { field: 'accuracyM', message: `Waiting for a better GPS fix (needs ${LOCATION_MAX_ACCURACY_M} m or better).` }
      ]);
    }

    const nowMs = this.now();
    const last = delivery.lastLocation;
    if (last && last.at) {
      const elapsed = nowMs - Date.parse(last.at);
      if (elapsed < LOCATION_MIN_INTERVAL_MS) return { accepted: false, reason: 'throttled' };
      if (elapsed < LOCATION_PLAUSIBILITY_WINDOW_MS) {
        const kmh = haversineKm(last, point) / (elapsed / 3.6e6);
        if (kmh > LOCATION_MAX_PLAUSIBLE_KMH) return { accepted: false, reason: 'implausible_jump' };
      }
    }

    const at = new Date(nowMs).toISOString();
    const lastLocation = { lat: point.lat, lng: point.lng, at, speedKmh, heading };
    const patch = { lastLocation, updatedAt: at };
    let eta = { etaMinutes: delivery.etaMinutes, distanceKm: delivery.distanceKm };
    if ((delivery.status === S.PICKED_UP || delivery.status === S.ARRIVED) && delivery.dropoff && delivery.dropoff.location) {
      eta = delivery.status === S.ARRIVED ? { etaMinutes: 0, distanceKm: 0 } : estimateEta(point, delivery.dropoff.location);
      patch.etaMinutes = eta.etaMinutes;
      patch.distanceKm = eta.distanceKm;
    }

    // `updatedAt` is the optimistic-concurrency token: if anything wrote to this
    // delivery since we read it (another ping, a status change), this ping was
    // computed from stale state. Dropping it is correct: the next ping, a few
    // seconds later, carries fresh position and will surface any status change.
    const updated = await this.repo.updateWhere(
      delivery.id,
      { status: delivery.status, driverId: caller.userId, updatedAt: delivery.updatedAt },
      patch
    );
    if (!updated) return { accepted: false, reason: 'busy' };

    await this.repo.insertLocation({
      deliveryId: delivery.id, driverId: caller.userId, lat: point.lat, lng: point.lng, speedKmh, heading, accuracyM, at
    });

    // `status` rides along so the stream layer can apply the same visibility
    // rule the REST view does (the buyer sees the rider only after pickup).
    this.events.publish(delivery.id, { type: 'location', status: updated.status, ...lastLocation });
    if (eta.etaMinutes !== delivery.etaMinutes || eta.distanceKm !== delivery.distanceKm) {
      this.events.publish(delivery.id, { type: 'eta', status: updated.status, etaMinutes: eta.etaMinutes, distanceKm: eta.distanceKm });
    }

    return { accepted: true, location: lastLocation, etaMinutes: eta.etaMinutes ?? null, distanceKm: eta.distanceKm ?? null };
  }

  async completeDelivery(deliveryId, code, callerInput) {
    for (let attempt = 0; attempt < CAS_RETRIES; attempt += 1) {
      const { caller, delivery } = await this._requireAssignedRider(deliveryId, callerInput);
      if (delivery.status !== S.ARRIVED) {
        throw new ConflictError(
          delivery.status === S.DELIVERED
            ? 'This delivery is already completed.'
            : `Mark the delivery as arrived before completing it (it is "${delivery.status}").`
        );
      }
      if (delivery.codeAttempts >= MAX_HANDOVER_ATTEMPTS) throw new DeliveryLockedError();
      await this._assertOrderNotCancelled(delivery);

      const candidate = typeof code === 'string' ? code.trim() : (typeof code === 'number' ? String(code) : '');
      if (!new RegExp(`^\\d{${HANDOVER_CODE_DIGITS}}$`).test(candidate)) {
        throw new ValidationError(`The handover code is ${HANDOVER_CODE_DIGITS} digits`, [
          { field: 'code', message: `Enter the ${HANDOVER_CODE_DIGITS}-digit code the customer gives you.` }
        ]);
      }

      const expected = { status: S.ARRIVED, driverId: caller.userId, codeAttempts: delivery.codeAttempts };

      if (!verifyCode(candidate, delivery.id, delivery.handoverNonce)) {
        const bumped = await this.repo.updateWhere(delivery.id, expected, { codeAttempts: delivery.codeAttempts + 1 });
        if (!bumped) continue; // someone else moved the row (another guess / a status change): re-read and retry
        const remaining = MAX_HANDOVER_ATTEMPTS - bumped.codeAttempts;
        if (remaining <= 0) {
          logger.warn(`[Delivery] Handover locked after ${MAX_HANDOVER_ATTEMPTS} wrong codes: delivery=${delivery.id} rider=${caller.userId}`);
          await this.repo.insertEvent({
            deliveryId: delivery.id, status: S.ARRIVED, previousStatus: S.ARRIVED, actorId: caller.userId,
            note: 'Handover locked after too many incorrect codes', at: this._nowIso()
          });
          this._notify(delivery.sellerId, {
            title: 'A delivery is locked',
            body: 'The rider entered too many wrong handover codes. An administrator must resolve it.',
            tone: 'neutral',
            delivery: bumped
          });
          throw new DeliveryLockedError();
        }
        throw new ValidationError('Incorrect handover code', [
          { field: 'code', message: `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} left.` }
        ]);
      }

      const nowIso = this._nowIso();
      const updated = await this.repo.updateWhere(delivery.id, expected, {
        status: S.DELIVERED, deliveredAt: nowIso, etaMinutes: 0, distanceKm: 0
      });
      if (!updated) continue;

      await this._record(updated, S.ARRIVED, caller.userId, 'Handover code verified');
      await this._syncOrder(updated, caller.userId);
      this._notify(updated.buyerId, {
        title: 'Order delivered',
        body: 'Your order has been handed over. Enjoy!',
        tone: 'success',
        delivery: updated
      });
      this._notify(updated.sellerId, {
        title: 'Order delivered',
        body: 'The rider completed the handover.',
        tone: 'success',
        delivery: updated
      });
      return this._present(updated, 'driver');
    }
    throw new ConflictError('Delivery is busy. Try again.');
  }

  // ------------------------------------------------------------------- cancel

  async cancelDelivery(deliveryId, reason, callerInput) {
    const { caller, delivery, role } = await this._loadForCaller(deliveryId, callerInput);
    const staff = role === 'seller' || role === 'admin';
    const buyerEarly = role === 'buyer' && delivery.status === S.PENDING_ASSIGNMENT;
    if (!staff && !buyerEarly) {
      throw new AuthorizationError(role === 'buyer'
        ? 'You can only cancel a delivery before a rider is assigned.'
        : 'Only the seller or an administrator can cancel a delivery.');
    }
    if (!CANCELLABLE_STATUSES.includes(delivery.status)) {
      DeliveryStateMachine.assertTransition(delivery.status, S.CANCELLED);
      throw new ConflictError(`A delivery cannot be cancelled while it is "${delivery.status}".`);
    }
    DeliveryStateMachine.assertTransition(delivery.status, S.CANCELLED);

    const cleanReason = cleanText(reason, 'reason', 500);
    const updated = await this._transition(
      delivery,
      { status: delivery.status },
      { status: S.CANCELLED, cancelledAt: this._nowIso() },
      { actorId: caller.userId, note: cleanReason }
    );

    if (delivery.driverId) {
      this._notify(delivery.driverId, {
        title: 'Delivery cancelled',
        body: 'This delivery was cancelled. You do not need to pick it up.',
        tone: 'neutral',
        delivery: updated
      });
    }
    if (role !== 'buyer') {
      this._notify(updated.buyerId, {
        title: 'Delivery cancelled',
        body: 'The delivery was cancelled. The seller will arrange another.',
        tone: 'neutral',
        delivery: updated
      });
    }
    return this._present(updated, role);
  }

  /**
   * Called when an order is cancelled (see OrderLifecycleService). Cancels the
   * order's open delivery if the rider has not collected the parcel yet, so a
   * rider is never left heading to a shop for an order that no longer exists.
   * Best-effort and never throws into the order flow.
   */
  async cancelForOrder(orderId, { reason = 'Order cancelled', actorId = 'order' } = {}) {
    try {
      const open = await this.repo.findOpenByOrder(orderId);
      if (!open) return null;
      if (!CANCELLABLE_STATUSES.includes(open.status)) {
        logger.warn(`[Delivery] Order ${orderId} was cancelled while delivery ${open.id} is "${open.status}"; an administrator must resolve it.`);
        return null;
      }
      const updated = await this._transition(
        open,
        { status: open.status },
        { status: S.CANCELLED, cancelledAt: this._nowIso() },
        { actorId, note: reason }
      );
      if (open.driverId) {
        this._notify(open.driverId, {
          title: 'Delivery cancelled',
          body: 'The order was cancelled. You do not need to pick it up.',
          tone: 'neutral',
          delivery: updated
        });
      }
      return updated;
    } catch (err) {
      logger.error(`[Delivery] Could not cancel the delivery for cancelled order ${orderId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Administrator-only resolution of a delivery the rider cannot move.
   *   action 'unlock' : a delivery locked by too many wrong handover codes gets a
   *                     fresh code and a fresh guess budget (the rider stays).
   *   action 'fail'   : a picked-up/arrived delivery is marked failed with a
   *                     reason (suspended rider, locked, unreachable customer),
   *                     so the seller can assign another rider.
   */
  async resolveDelivery(deliveryId, input, callerInput) {
    const caller = this._caller(callerInput);
    if (!this._isAdmin(caller.userRole)) {
      throw new AuthorizationError('Only an administrator can resolve a delivery.');
    }
    const delivery = await this.repo.findById(deliveryId);
    if (!delivery) throw new NotFoundError('Delivery', deliveryId);

    const body = input && typeof input === 'object' ? input : {};
    const note = cleanText(body.note, 'note', 500);

    if (body.action === 'unlock') {
      if (delivery.status !== S.ARRIVED || delivery.codeAttempts < MAX_HANDOVER_ATTEMPTS) {
        throw new ConflictError('Only a delivery locked by wrong handover codes can be unlocked.');
      }
      const updated = await this._transition(
        delivery,
        { status: S.ARRIVED, codeAttempts: delivery.codeAttempts },
        { codeAttempts: 0, handoverNonce: delivery.handoverNonce + 1 },
        { actorId: caller.userId, note: note || 'Handover unlocked by an administrator' }
      );
      this._notify(updated.buyerId, {
        title: 'Your handover code changed',
        body: 'Open the delivery to see your new code.',
        tone: 'neutral',
        delivery: updated
      });
      return this._present(updated, 'admin');
    }

    if (body.action === 'fail') {
      if (![S.PICKED_UP, S.ARRIVED].includes(delivery.status)) {
        throw new ConflictError(`Only a picked-up or arrived delivery can be failed by an administrator (it is "${delivery.status}").`);
      }
      if (!note) {
        throw new ValidationError('A reason is required', [{ field: 'note', message: 'Say why this delivery is being failed.' }]);
      }
      const updated = await this._transition(
        delivery,
        { status: delivery.status },
        { status: S.FAILED, failureReason: note },
        { actorId: caller.userId, note }
      );
      this._notify(updated.sellerId, { title: 'A delivery was marked failed', body: note, tone: 'neutral', delivery: updated });
      this._notify(updated.buyerId, {
        title: 'Delivery could not be completed',
        body: 'We will arrange another attempt.',
        tone: 'neutral',
        delivery: updated
      });
      return this._present(updated, 'admin');
    }

    throw new ValidationError('Unknown action', [{ field: 'action', message: 'Use "unlock" or "fail".' }]);
  }

  // -------------------------------------------------------------------- reads

  async getDelivery(deliveryId, callerInput) {
    const { delivery, role } = await this._loadForCaller(deliveryId, callerInput);
    return this._present(delivery, role);
  }

  /**
   * The caller's role on a delivery, or null if they have no access. Never
   * throws for "not yours": the live stream calls this on every status change to
   * drop a viewer whose access ended (a rider who was replaced or declined).
   */
  async getViewerRole(deliveryId, callerInput) {
    const caller = this._caller(callerInput);
    // Releasing a lapsed offer here is what ends a rider's open stream (within
    // one heartbeat) on a deployment that has no sweeper.
    const delivery = deliveryId ? await this._releaseIfLapsed(await this.repo.findById(deliveryId)) : null;
    return delivery ? this._participantRole(delivery, caller) : null;
  }

  async getDeliveryByOrder(orderId, callerInput) {
    const caller = this._caller(callerInput);
    if (!orderId) throw new ValidationError('Order ID is required.');
    // Resolve an order number or id to the real order id first.
    const order = await this.orders.findOrderById(orderId);
    const delivery = await this._releaseIfLapsed(order ? await this.repo.findByOrder(order.id) : null);
    const role = delivery ? this._participantRole(delivery, caller) : null;
    if (!delivery || !role) throw new NotFoundError('Delivery');
    return this._present(delivery, role);
  }

  /** The buyer's handover code. Only the order's buyer; never staff, never the rider. */
  async getHandoverCode(deliveryId, callerInput) {
    const { caller, delivery, role } = await this._loadForCaller(deliveryId, callerInput);
    if (delivery.buyerId !== caller.userId) {
      throw new AuthorizationError(role === 'driver'
        ? 'The customer gives you this code in person.'
        : 'Only the customer receiving the order can see the handover code.');
    }
    if (![S.ACCEPTED, S.PICKED_UP, S.ARRIVED].includes(delivery.status)) {
      throw new ConflictError('The handover code is available once a rider has accepted the delivery.');
    }
    return {
      code: codeFor(delivery.id, delivery.handoverNonce),
      digits: HANDOVER_CODE_DIGITS,
      attemptsRemaining: Math.max(0, MAX_HANDOVER_ATTEMPTS - delivery.codeAttempts)
    };
  }

  /** The signed-in rider's profile and their open deliveries. */
  async getRiderOverview(callerInput) {
    const caller = this._caller(callerInput);
    const driver = await this.repo.findDriver(caller.userId);
    if (!driver || driver.status !== DRIVER_STATUS.ACTIVE) {
      throw new AuthorizationError('You are not a registered rider.');
    }
    const open = await this.repo.findOpenByDriver(caller.userId);
    const deliveries = [];
    for (const listed of open) {
      // An offer that lapsed is no longer this rider's: release it and leave it out.
      const d = await this._releaseIfLapsed(listed);
      if (d.driverId !== caller.userId) continue;
      deliveries.push(await this._present(d, 'driver', { includeTimeline: false }));
    }
    return { driver: { id: driver.id, name: driver.name, phone: driver.phone }, deliveries };
  }

  // ------------------------------------------------------------------- riders

  async registerDriver(profileId, input, callerInput) {
    const caller = this._caller(callerInput);
    if (!this._isAdmin(caller.userRole)) {
      throw new AuthorizationError('Only an administrator can register riders.');
    }
    if (!profileId || typeof profileId !== 'string') {
      throw new ValidationError('profileId is required', [{ field: 'profileId', message: 'Provide the rider\'s account id.' }]);
    }
    const body = input && typeof input === 'object' ? input : {};
    const name = cleanText(body.name, 'name', 120);
    const phone = cleanText(body.phone, 'phone', 32);
    if (!name) throw new ValidationError('Rider name is required', [{ field: 'name', message: 'Provide the rider\'s name.' }]);
    if (!phone || phone.length < 6) {
      throw new ValidationError('A valid phone number is required', [{ field: 'phone', message: 'Provide a phone number the customer can call.' }]);
    }
    if (body.status !== undefined && body.status !== null && !Object.values(DRIVER_STATUS).includes(body.status)) {
      throw new ValidationError('Unknown rider status', [{ field: 'status', message: 'Use "active" or "suspended".' }]);
    }
    // An omitted status means "leave it as it is" for an existing rider: editing a
    // name or phone must not quietly reactivate someone an admin suspended. A new
    // rider starts active.
    const existing = await this.repo.findDriver(profileId);
    const status = body.status || (existing ? existing.status : DRIVER_STATUS.ACTIVE);
    const driver = await this.repo.upsertDriver({
      profileId, name, phone, status, createdBy: existing ? existing.createdBy : caller.userId
    });
    if (status === DRIVER_STATUS.SUSPENDED) await this._releaseDriverWork(profileId, caller.userId, 'Rider suspended');
    return { id: driver.id, name: driver.name, phone: driver.phone, status: driver.status };
  }

  /**
   * Hands a rider's un-started deliveries (assigned/accepted) back to the seller.
   * Deliveries already picked up or arrived cannot be quietly reassigned (the
   * parcel is with the rider); the seller is told and an administrator resolves
   * them with resolveDelivery('fail').
   */
  async _releaseDriverWork(driverId, actorId, note) {
    let open = [];
    try {
      open = await this.repo.findOpenByDriver(driverId, { limit: 100 });
    } catch (err) {
      logger.error(`[Delivery] Could not list open work for rider ${driverId}: ${err.message}`);
      return;
    }
    for (const d of open) {
      try {
        if (d.status === S.ASSIGNED || d.status === S.ACCEPTED) {
          const released = await this._transition(
            d,
            { status: d.status, driverId },
            { status: S.PENDING_ASSIGNMENT, driverId: null, assignedAt: null, acceptedAt: null },
            { actorId, note }
          );
          this._notify(released.sellerId, {
            title: 'A rider is no longer available',
            body: 'Assign another rider to keep the order moving.',
            tone: 'neutral',
            delivery: released
          });
        } else {
          logger.warn(`[Delivery] Rider ${driverId} is unavailable but delivery ${d.id} is "${d.status}"; needs administrator resolution.`);
          this._notify(d.sellerId, {
            title: 'A rider in the middle of a delivery was suspended',
            body: 'An administrator needs to resolve this delivery.',
            tone: 'neutral',
            delivery: d
          });
        }
      } catch (err) {
        logger.error(`[Delivery] Could not release delivery ${d.id} from rider ${driverId}: ${err.message}`);
      }
    }
  }

  /**
   * Account-deletion hook (DeleteAccountUseCase). Account deletion anonymises the
   * profile in place and keeps the row, so the rider's name and phone in
   * delivery_drivers would otherwise outlive it, and the rider would stay
   * assignable. Scrubs the rider record, suspends it, and releases un-started work.
   */
  async onAccountDeleted(userId) {
    if (!userId) return;
    const driver = await this.repo.findDriver(userId);
    if (!driver) return;
    await this.repo.upsertDriver({
      profileId: userId,
      name: 'Anonymized Rider',
      phone: '+237000000000',
      status: DRIVER_STATUS.SUSPENDED,
      createdBy: driver.createdBy
    });
    await this._releaseDriverWork(userId, userId, 'Rider account deleted');
  }

  /**
   * Riders who already handed this delivery back: declined it, released it after
   * accepting, or let the offer lapse. Read from the timeline: each of those is a
   * move back to `pending_assignment` whose actor is the rider. The timeline write
   * is best-effort, so a lost row only means a rider might be offered it again.
   */
  async _ridersWhoPassed(deliveryId) {
    const passed = new Set();
    for (const e of await this.repo.listEvents(deliveryId)) {
      const handedBack = e.status === S.PENDING_ASSIGNMENT
        && (e.previousStatus === S.ASSIGNED || e.previousStatus === S.ACCEPTED);
      if (handedBack && e.actorId) passed.add(e.actorId);
    }
    return passed;
  }

  /**
   * Returns lapsed offers to their sellers before riders are ranked. A dead offer
   * still sits in `assigned` and would count as work for a rider who never
   * answered, and (with no sweeper, i.e. serverless) nothing else may touch it for
   * a long time. Best effort: ranking must work even if this fails.
   */
  async _releaseLapsedOffers() {
    try {
      for (let round = 0; round < MAX_RELEASE_ROUNDS; round += 1) {
        const { expired } = await this.expireStaleOffers({ limit: RELEASE_BATCH });
        if (expired < RELEASE_BATCH) break; // a short round means the backlog is drained
      }
    } catch (err) {
      logger.warn(`[Delivery] Could not release lapsed offers before ranking riders: ${err.message}`);
    }
  }

  /**
   * Active riders with how many deliveries each is carrying. Order: riders who did
   * NOT let an offer lapse in the last hour (RECENT_LAPSE_WINDOW_MS) first, then
   * the least busy, then by name, then by id (so ties break the same way every
   * time). The lapse rule keeps a rider who never answers from taking the first
   * offer of every delivery just because their lapsed jobs left them at zero.
   */
  async _rankedActiveRiders({ release = true } = {}) {
    if (release) await this._releaseLapsedOffers();
    const since = new Date(this.now() - RECENT_LAPSE_WINDOW_MS).toISOString();
    const [drivers, load, lapses] = await Promise.all([
      this.repo.listDrivers({ status: DRIVER_STATUS.ACTIVE, limit: MAX_RIDERS_CONSIDERED }),
      this.repo.countOpenByDriver(),
      this.repo.countRecentLapses(since)
    ]);
    if (drivers.length >= MAX_RIDERS_CONSIDERED) {
      logger.warn(`[Delivery] Rider list hit its ${MAX_RIDERS_CONSIDERED}-row cap; riders beyond it are not offered.`);
    }
    const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    return drivers
      .map((driver) => ({ driver, openDeliveries: load.get(driver.id) || 0, recentlyLapsed: (lapses.get(driver.id) || 0) > 0 }))
      .sort((a, b) => Number(a.recentlyLapsed) - Number(b.recentlyLapsed)
        || a.openDeliveries - b.openDeliveries
        || String(a.driver.name || '').localeCompare(String(b.driver.name || ''), 'en')
        || byText(a.driver.id, b.driver.id));
  }

  /**
   * The riders a seller or admin can pick from, least busy first. With a
   * `deliveryId` (the caller must be that delivery's seller or an admin, else
   * 404) each rider also says whether they already handed THAT delivery back.
   */
  async listDrivers(callerInput, { deliveryId } = {}) {
    const caller = this._caller(callerInput);
    if (!SELLER_ROLES.includes(caller.userRole)) {
      throw new AuthorizationError('Only sellers and administrators can list riders.');
    }
    let passed = null;
    if (deliveryId !== undefined && deliveryId !== null && deliveryId !== '') {
      const { delivery } = await this._requireStaff(deliveryId, callerInput);
      passed = await this._ridersWhoPassed(delivery.id);
    }
    const ranked = await this._rankedActiveRiders();
    return ranked.map(({ driver, openDeliveries }) => ({
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      openDeliveries,
      ...(passed ? { declined: passed.has(driver.id) } : {})
    }));
  }

  /**
   * The admin rider roster (GET /drivers?status=): every rider, or only the active
   * or suspended ones, each with its status and current workload. Active riders
   * first, then by name. Administrators only: a seller only ever picks from the
   * ranked list of active riders above.
   */
  async listRiderRoster(callerInput, { status = 'all' } = {}) {
    const caller = this._caller(callerInput);
    if (!this._isAdmin(caller.userRole)) {
      throw new AuthorizationError('Only an administrator can see the full rider roster.');
    }
    if (!['all', DRIVER_STATUS.ACTIVE, DRIVER_STATUS.SUSPENDED].includes(status)) {
      throw new ValidationError('Unknown rider status filter', [{ field: 'status', message: 'Use "all", "active" or "suspended".' }]);
    }
    const [drivers, load] = await Promise.all([
      this.repo.listDrivers({ status: status === 'all' ? null : status, limit: MAX_RIDERS_CONSIDERED }),
      this.repo.countOpenByDriver()
    ]);
    const rank = (d) => (d.status === DRIVER_STATUS.ACTIVE ? 0 : 1);
    const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    return drivers
      .map((d) => ({ id: d.id, name: d.name, phone: d.phone, status: d.status, openDeliveries: load.get(d.id) || 0 }))
      .sort((a, b) => rank(a) - rank(b)
        || String(a.name || '').localeCompare(String(b.name || ''), 'en')
        || byText(a.id, b.id));
  }

  /**
   * The dispatch board (GET /dispatch): the caller's home-delivery orders that need
   * or have a delivery, newest first, each with its delivery in the seller view,
   * or null when none was created yet. An administrator sees every seller's.
   * The caller is checked BEFORE lapsed offers are released, so a customer cannot
   * use this endpoint to make the platform do work. Each delivery's timeline is
   * left empty here (one read per row would be needed); GET /:id has it.
   */
  async getDispatchBoard(callerInput, { view = 'active', limit = 50 } = {}) {
    const caller = this._caller(callerInput);
    if (!SELLER_ROLES.includes(caller.userRole)) {
      throw new AuthorizationError('Only sellers and administrators have a dispatch board.');
    }
    if (!['active', 'completed'].includes(view)) {
      throw new ValidationError('Unknown board view', [{ field: 'view', message: 'Use "active" or "completed".' }]);
    }
    const isAdmin = this._isAdmin(caller.userRole);
    await this._releaseLapsedOffers();

    const statuses = view === 'completed'
      ? [FULFILLMENT_STATUS.DELIVERED]
      : [FULFILLMENT_STATUS.PROCESSING, FULFILLMENT_STATUS.IN_TRANSIT];
    // Refunded orders are excluded inside the query, before the limit.
    const orders = await this.orders.findOrdersBySeller(isAdmin ? null : caller.userId, {
      statuses, limit, excludePaymentStatuses: [PAYMENT_STATUS.REFUNDED]
    });
    const latest = await this.repo.findLatestByOrders(orders.map((o) => o.id));

    const role = isAdmin ? 'admin' : 'seller';
    const riders = new Map(); // one lookup per rider, not per row
    const items = [];
    for (const order of orders) {
      const d = latest.get(order.id) || null;
      let delivery = null;
      if (d) {
        let driver = null;
        if (d.driverId) {
          if (!riders.has(d.driverId)) riders.set(d.driverId, await this.repo.findDriver(d.driverId));
          const r = riders.get(d.driverId);
          if (r) driver = { id: r.id, name: r.name, phone: r.phone };
        }
        delivery = presentDelivery({ ...d, driver }, role, { timeline: [], order, offerTtlMs: this.offerTtlMs });
      }
      items.push({ order: summarizeOrder(order), delivery });
    }
    return { items };
  }
}

/** What the dispatch board shows of an order: enough to recognise it, nothing more. */
function summarizeOrder(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const ship = order.shippingAddress || {};
  return {
    id: order.id,
    orderNumber: order.orderNumber || null,
    placedAt: order.createdAt || null,
    fulfillmentStatus: order.fulfillmentStatus,
    paymentStatus: order.paymentStatus,
    totalXaf: Number.isFinite(Number(order.totalAmountXaf)) ? Number(order.totalAmountXaf) : null,
    itemCount: items.reduce((n, i) => n + (Number(i.quantity) || 1), 0),
    title: items[0] && items[0].title ? items[0].title : null,
    buyerName: typeof ship.fullName === 'string' && ship.fullName.trim() ? ship.fullName.trim() : null,
    area: describeArea(ship) || null
  };
}

let sharedService = null;

/**
 * The process-wide DeliveryService. Routes and the cross-module hooks (order
 * cancellation, account deletion) must share ONE instance: with no database
 * configured the repository keeps its data in memory, and a second instance
 * would not see the first one's deliveries.
 */
function getSharedDeliveryService() {
  if (!sharedService) sharedService = new DeliveryService();
  return sharedService;
}

module.exports = { DeliveryService, getSharedDeliveryService };
