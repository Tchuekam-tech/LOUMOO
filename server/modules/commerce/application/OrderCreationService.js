/**
 * LOUMOO Commerce Core — Order Creation Service
 * ---------------------------------------------------------------------------
 * Primary coordinator for order placement.
 * Enforces strict input validation, listing/variant integrity, derived seller identity,
 * server-authoritative pricing, scoped idempotency, and concurrency controls.
 */

const crypto = require('crypto');
const { Order, OrderItem, FULFILLMENT_STATUS, PAYMENT_STATUS, DELIVERY_METHOD } = require('../domain/Order');
const { PricingEngine, resolveCityRate, foldCity } = require('../domain/PricingEngine');
const { CreateOrderInputSchema } = require('../presentation/validators/orderSchemas');
const { OrderRepository } = require('../infrastructure/OrderRepository');
const IdempotencyService = require('../../../infrastructure/cache/IdempotencyService');
const DistributedLockService = require('../../../infrastructure/cache/DistributedLockService');
const CacheService = require('../../../infrastructure/cache/CacheService');
const {
  ValidationError,
  NotFoundError,
  ConflictError,
  AuthorizationError,
  IdempotencyError
} = require('../../../shared/errors/AppError');
const logger = require('../../../shared/logging/logger');
const Messages = require('./OrderNotificationBuilder');
const { OrderRecipients } = require('./OrderRecipients');
const { isHouseStoreId } = require('../../store/domain/HouseStore');

// Optional cross-cutting services (loaded lazily to avoid circular dependencies)
let UserActivityUseCase = null;
let NotificationService = null;
try { UserActivityUseCase = require('../../identity/application/UserActivityUseCase'); } catch (e) {}
try { NotificationService = require('../../identity/application/NotificationService'); } catch (e) {}

/**
 * A one-time, non-persisted notice for the buyer when the delivery provider they
 * chose at checkout turned out unavailable by the time the order was placed. The
 * order still succeeds at the standard city rate; this tells the buyer honestly
 * rather than switching silently (integration spec item E). `reason` is one of
 * 'gone' | 'suspended' | 'out_of_area'.
 */
function buildDroppedPreferenceNotice(reason, effectiveFeeXaf) {
  const lead = reason === 'out_of_area'
    ? 'The delivery provider you chose doesn’t cover this address'
    : 'The delivery provider you chose is no longer available';
  return {
    code: 'preferred_provider_unavailable',
    reason,
    effectiveFeeXaf: Number.isFinite(Number(effectiveFeeXaf)) ? Number(effectiveFeeXaf) : null,
    message: `${lead}, so your order was placed at the standard delivery rate. The seller will arrange another rider.`
  };
}

/**
 * Whether a delivery provider takes orders for a city: no declared service areas
 * means everywhere, otherwise the order's city (accent- and punctuation-folded
 * like the tariff table) must be one of them. One rule for a buyer's chosen
 * provider and for the house default.
 */
function providerServes(provider, city) {
  const areas = provider && Array.isArray(provider.serviceAreas) ? provider.serviceAreas : [];
  const folded = city ? foldCity(city) : '';
  return areas.length === 0 || Boolean(folded && areas.includes(folded));
}

// How long a best-effort lookup for an order message may take before the message
// goes out with what the order already says.
const LOOKUP_TIMEOUT_MS = 2000;

function bounded(promise, ms = LOOKUP_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([Promise.resolve(promise).catch(() => null), timeout]).finally(() => clearTimeout(timer));
}

/**
 * An error as it may be logged: class and code, plus the message with anything
 * that looks like an e-mail address or a phone number removed. Transport errors
 * routinely quote the recipient.
 */
function describeError(err) {
  const head = [err && err.name, err && err.code].filter(Boolean).join(':') || 'Error';
  const message = String((err && err.message) || '')
    .replace(/[^\s@<>"']+@[^\s@<>"']+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{5,}\d/g, '[number]')
    .slice(0, 200);
  return message ? `${head} ${message}` : head;
}

/**
 * The buyers whose order is being placed at this moment, shared by every
 * OrderCreationService in the process.
 *
 * It used to be per-instance, and there are two instances — the one the
 * /api/v1/orders router holds and the one PurchaseHistoryUseCase holds for
 * /api/v1/users/me/orders — so the same bag sent to both routes at once passed
 * the guard twice and became two orders. One registry, one answer.
 */
const ACTIVE_CREATIONS = new Set();

/** How long the cross-process half of the guard holds a buyer's slot. */
const CREATE_LOCK_TTL_MS = 30000;

class OrderCreationService {
  constructor(repository = null, deps = {}) {
    this.repository = repository || new OrderRepository();
    // Buyers whose order is being placed right now, shared across every instance
    // of this service in the process (see ACTIVE_CREATIONS).
    this._activeLocks = deps.activeLocks || ACTIVE_CREATIONS;
    // The cross-process half of the same guard. Injectable for tests.
    this._lockService = deps.lockService || DistributedLockService;
    // How a preferred provider is looked up when pricing the order. Injectable so
    // a test can supply providers without the shared delivery singleton; in
    // production it lazily reads the shared DeliveryService's repository, keeping
    // the commerce→delivery dependency soft (lazy, best-effort).
    this._resolveProvider = deps.resolveProvider || (async (profileId) => {
      const { getSharedDeliveryService } = require('../../delivery/application/DeliveryService');
      return getSharedDeliveryService().repo.findDriver(profileId);
    });
    // The house store (NanoAfrica) and its agency (nanoDelivery), resolved from the
    // database: { resolve(), resolveDefaultProvider() }. Lazy for the same reason.
    this._houseStore = deps.houseStore || null;
    // Who the order messages go to and how. All injectable, all best effort.
    this._recipients = deps.recipients || new OrderRecipients();
    this._sendEmail = deps.sendEmail || ((message) => require('../../../clients/resend').sendEmail(message));
    this._getNotificationPreferences = deps.getNotificationPreferences
      || ((userId) => require('../../identity/application/NotificationPreferencesUseCase').getPreferences(userId));
    this._notifications = deps.notificationService || null;
    // Notification dispatches still running (they are never awaited by an order).
    this._pendingNotifications = new Set();
  }

  /** Resolves once every notification dispatched so far has finished (tests, graceful shutdown). */
  async notificationsSettled() {
    while (this._pendingNotifications.size) await Promise.all([...this._pendingNotifications]);
  }

  get houseStore() {
    if (!this._houseStore) {
      this._houseStore = require('../../store/application/HouseStoreService').getSharedHouseStore();
    }
    return this._houseStore;
  }

  /**
   * Authoritatively places a new order.
   *
   * @param {string} userId - Authenticated user ID (strictly from auth context)
   * @param {object} payload - Untrusted request body
   * @param {object} [options]
   * @param {string|null} [options.idempotencyKey]
   * @returns {Promise<Order>}
   */
  async createOrder(userId, payload = {}, { idempotencyKey = null } = {}) {
    if (!userId) throw new AuthorizationError('Authentication required to place an order.');

    // 1. Enforce strict input schema validation
    const parsed = CreateOrderInputSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (issue.code === 'unrecognized_keys') {
        const keysStr = (issue.keys || []).join(', ');
        throw new ValidationError(
          `Unexpected field(s) in order request: "${keysStr}". Privileged fields (sellerId, buyerId, status) are prohibited.`,
          parsed.error.issues
        );
      }
      const fieldPath = issue.path.join('.');
      throw new ValidationError(
        issue.message || `Invalid order request payload at "${fieldPath}"`,
        parsed.error.issues
      );
    }
    const data = parsed.data;

    // 2. Scoped Idempotency Check
    const effectiveIdempotencyKey = idempotencyKey || data.idempotencyKey;
    const scopedKey = effectiveIdempotencyKey ? `order:create:${userId}:${effectiveIdempotencyKey}` : null;
    let lockAcquired = false;

    if (scopedKey) {
      const authScope = crypto.createHash('sha256').update(userId).digest('hex').slice(0, 16);
      const idempotencyCheck = await IdempotencyService.checkOrLock(scopedKey, payload, 86400, authScope);

      if (idempotencyCheck.state === 'COMPLETED') {
        const cachedResponse = idempotencyCheck.responseBody;
        if (cachedResponse && cachedResponse.order) {
          logger.info(`[OrderCreationService] Idempotency hit: returning existing order for key ${effectiveIdempotencyKey}`);
          return new Order(cachedResponse.order);
        }
        // This key has already completed, but the stored response is not an order.
        // Falling through would place a SECOND order for a request the buyer has
        // already had answered — the one thing the key exists to prevent — so the
        // replay is refused instead.
        logger.warn(`[OrderCreationService] Idempotency key ${effectiveIdempotencyKey} already completed without an order; refusing the replay.`);
        throw new IdempotencyError(
          'This request has already been processed. Start a new checkout to place another order.',
          effectiveIdempotencyKey
        );
      }
      // Only an ACQUIRED key is ours to release on failure. Releasing a COMPLETED
      // one would erase the record that makes the next replay idempotent.
      lockAcquired = idempotencyCheck.state === 'ACQUIRED';
    }

    // Double-click guard: one order placement per buyer at a time. Two halves —
    // a process-wide registry (always on) and a Redis lock that extends it across
    // instances. The Redis half is best effort: when it is unavailable the local
    // guard still stands, because refusing every checkout during a cache outage
    // would be worse than the duplicate it prevents. A buyer who wants a hard
    // guarantee sends an Idempotency-Key, which does fail closed above.
    const userLockKey = `lock:createOrder:${userId}`;
    if (this._activeLocks.has(userLockKey)) {
      if (scopedKey && lockAcquired) await IdempotencyService.releaseLock(scopedKey).catch(() => {});
      throw new ConflictError('Another order creation is currently processing for your account. Please wait.');
    }
    this._activeLocks.add(userLockKey);

    let crossProcessLock = null;
    try {
      crossProcessLock = await this._lockService.acquireLock(userLockKey, CREATE_LOCK_TTL_MS);
      if (crossProcessLock === null) {
        // Held on another instance: the buyer's previous attempt is still running.
        this._activeLocks.delete(userLockKey);
        if (scopedKey && lockAcquired) await IdempotencyService.releaseLock(scopedKey).catch(() => {});
        throw new ConflictError('Another order creation is currently processing for your account. Please wait.');
      }
    } catch (err) {
      if (err instanceof ConflictError) throw err;
      logger.warn(`[OrderCreationService] Cross-instance order lock unavailable, the process-local guard stands: ${describeError(err)}`);
      crossProcessLock = null;
    }

    // Stock this attempt has taken off the shelf. Anything in here when the
    // attempt fails goes straight back — an order that was never placed must
    // never leave a listing looking sold out.
    let heldLines = [];
    let orderPlaced = false;

    try {
      // 3. Resolve and authoritatively validate each listing and variant
      const evaluatedItems = [];
      // Every line that cannot be ordered (not a listing: a showcase product) is
      // named in ONE refusal, so the buyer removes them all at once rather than
      // discovering them a retry at a time.
      const unorderableIds = [];

      for (const itemInput of data.items) {
        const listingId = itemInput.listingId || itemInput.productId || itemInput.id;
        const listing = await this.repository.findListingById(listingId);

        if (!listing) {
          unorderableIds.push(listingId);
          continue;
        }

        // Validate listing status and merchandisability
        if (listing.status !== 'PUBLISHED') {
          throw new ValidationError(
            `Listing "${listing.title}" cannot be purchased because it is not published (current status: ${listing.status}).`
          );
        }
        if (listing.visibility && listing.visibility !== 'PUBLIC') {
          throw new ValidationError(`Listing "${listing.title}" is not available for public checkout.`);
        }
        if (listing.deletedAt) {
          throw new NotFoundError('Listing', listingId);
        }
        if (listing.storeStatus && listing.storeStatus !== 'ACTIVE') {
          throw new ValidationError(`The seller boutique for "${listing.title}" is currently not accepting orders.`);
        }

        // Resolve variant if specified
        let unitPriceXaf = listing.salePriceMinor != null ? listing.salePriceMinor : listing.basePriceMinor;
        let variantTitle = null;
        let sku = listing.sku || null;

        if (itemInput.variantId) {
          const variant = await this.repository.findVariantById(listing.id, itemInput.variantId);
          if (!variant) {
            throw new ValidationError(
              `Variant "${itemInput.variantId}" does not exist for listing "${listing.title}".`
            );
          }
          if (!variant.isActive) {
            throw new ValidationError(
              `Variant "${variant.title || itemInput.variantId}" is currently not available for purchase.`
            );
          }
          unitPriceXaf = variant.priceMinor;
          variantTitle = variant.title;
          sku = variant.sku || sku;
        }

        // Verify inventory availability
        const invCheck = await this.repository.checkInventory(listing.id, itemInput.variantId, itemInput.quantity);
        if (!invCheck.isAvailable) {
          throw new ConflictError(
            `Insufficient stock for "${listing.title}". Only ${invCheck.availableQuantity} unit(s) available, but requested ${itemInput.quantity}.`
          );
        }

        // Assert client price match (if client sent a price, reject any tampering)
        PricingEngine.assertItemPriceMatch(itemInput, unitPriceXaf, listing.title);

        // Derive authoritative seller ID from listing/store — never from client
        const sellerId = listing.sellerId;
        if (!sellerId) {
          throw new ValidationError(`Listing "${listing.title}" is not associated with a valid seller.`);
        }

        evaluatedItems.push({
          listingId: listing.id,
          variantId: itemInput.variantId || null,
          title: variantTitle ? `${listing.title} (${variantTitle})` : listing.title,
          sku,
          unitPriceXaf,
          quantity: itemInput.quantity,
          sellerId,
          storeId: listing.storeId,
          storeName: listing.storeName,
          storePhone: listing.storePhone || null,
          imageUrl: null,
          listing
        });
      }

      if (unorderableIds.length) {
        throw new NotFoundError('Listing', unorderableIds.join(', '));
      }

      // Stock the order has taken off the shelf, so it can be put back if
      // anything below refuses the order. Filled by _holdStock.
      heldLines = await this._holdStock(evaluatedItems);

      // An order belongs to exactly one seller: the seller is who receives it, who
      // arranges its delivery and who is paid. A bag that mixes stores would be
      // filed under the first item's seller and the others would never hear of
      // their goods, so it is refused and the client places one order per store.
      const sellerIds = new Set(evaluatedItems.map((it) => it.sellerId));
      if (sellerIds.size > 1) {
        const stores = [...new Set(evaluatedItems.map((it) => it.storeName || 'another store'))];
        throw new ValidationError(
          `Your bag has items from ${stores.length} different stores (${stores.join(', ')}). Each store delivers on its own, so place one order per store.`,
          [{ field: 'items', message: 'Items must all come from one store.', code: 'MULTI_SELLER_ORDER', stores }]
        );
      }

      // 4. Server-Authoritative Pricing Calculation
      const orderCity = data.shippingAddress?.city || data.city;
      let standardShippingFeeXaf = null;
      if (data.deliveryMethod !== DELIVERY_METHOD.STORE_PICKUP) {
        try {
          const SuperAdminRepository = require('../../../../SuperAdmin/backend/repositories/SuperAdminRepository');
          const cityRates = await SuperAdminRepository.getSetting('shipping_rates_by_city');
          // Accent- and punctuation-insensitive ("Yaoundé" is the table's "Yaounde"),
          // the same rule the checkout uses to show the fee.
          standardShippingFeeXaf = resolveCityRate(cityRates, orderCity);
        } catch (_) {}
      }

      // If the buyer preferred a specific provider, the order is priced by THAT
      // provider's own tariff when they set one — so the fee the picker showed is
      // the fee the order gets — never the city rate, and never a client-sent
      // price. Resolved server-side from the provider record. Best-effort and lazy
      // to keep the module dependency soft (delivery already depends on commerce):
      // an unknown, suspended, or out-of-area provider falls back to the city rate
      // and the dead preference is dropped rather than stored on the order.
      let effectivePreferredDriverId = data.deliveryMethod === DELIVERY_METHOD.STORE_PICKUP
        ? null
        : (data.preferredDriverId || null);
      // When the buyer picked a provider that turns out unavailable between the
      // quote and now, the preference is dropped and the order is priced at the
      // city rate — but the buyer is TOLD (deliveryNotice below), not silently
      // switched. Stays null while nothing was dropped. (Integration spec item E.)
      let droppedPreferenceReason = null;
      // The chosen provider's own tariff, when they set one. Kept apart from the
      // city rate because it outranks a listing's delivery fee and the city rate
      // does not — see PricingEngine.calculateOrderPricing.
      let providerTariffXaf = null;
      // The provider the order ends up with, for the seller's message: the buyer's
      // pick, or (house store only) the default below. { id, name, source }.
      let messageProvider = effectivePreferredDriverId
        ? { id: effectivePreferredDriverId, name: null, source: 'buyer' }
        : null;
      if (effectivePreferredDriverId) {
        try {
          const provider = await this._resolveProvider(effectivePreferredDriverId);
          const serves = provider && providerServes(provider, orderCity);
          const active = provider && provider.status === 'active';
          if (active && serves) {
            messageProvider = { id: effectivePreferredDriverId, name: provider.name || null, source: 'buyer' };
            // The quote the buyer accepted. It goes to the pricing engine as the
            // provider tariff, not as the city rate: a listing's own delivery fee
            // outranks the city rate and was therefore silently re-pricing the
            // order away from the number the picker had shown.
            if (provider.baseFeeXaf != null) providerTariffXaf = Number(provider.baseFeeXaf);
            // else the provider quotes the standard city rate: leave it as resolved.
          } else {
            // Gone, suspended, or cannot serve this city: do not keep a dead
            // preference on the order, and price at the city rate.
            droppedPreferenceReason = !provider ? 'gone' : (!active ? 'suspended' : 'out_of_area');
            effectivePreferredDriverId = null;
            messageProvider = null;
          }
        } catch (_) { /* delivery module unavailable: keep the hint, price at city rate */ }
      }

      // House store only: a home delivery whose buyer chose nobody defaults to the
      // store's own agency (nanoDelivery), so the owner's dispatch board starts on
      // "Offer to nanoDelivery". It is a default, not a choice: it changes no price,
      // never replaces a pick the buyer made (even one that was dropped above), and
      // the buyer is not told they switched anything.
      if (data.deliveryMethod === DELIVERY_METHOD.HOME_DELIVERY && !data.preferredDriverId) {
        const house = await this._houseDefaultProvider(evaluatedItems[0].sellerId, orderCity);
        if (house) {
          effectivePreferredDriverId = house.id;
          messageProvider = { id: house.id, name: house.name || null, source: 'default' };
        }
      }

      const clientSuppliedTotal = data.totalAmountXaf ?? data.totalXaf ?? null;
      const pricing = PricingEngine.calculateOrderPricing(evaluatedItems, {
        deliveryMethod: data.deliveryMethod,
        clientSuppliedTotal,
        standardShippingFeeXaf,
        providerTariffXaf
      });

      // 5. Construct Order Aggregate
      const orderItems = pricing.lineItems.map(it => new OrderItem({
        listingId: it.listingId,
        variantId: it.variantId,
        title: it.title,
        sku: it.sku,
        unitPriceXaf: it.unitPriceXaf,
        quantity: it.quantity,
        sellerId: it.sellerId,
        storeId: it.storeId,
        storeName: it.storeName,
        storePhone: it.storePhone,
        imageUrl: it.imageUrl
      }));

      const primarySellerId = evaluatedItems[0].sellerId;
      const primarySellerPhone = evaluatedItems[0].storePhone || null;
      const orderNumber = Order.generateOrderNumber();

      const order = new Order({
        orderNumber,
        buyerId: userId,
        sellerId: primarySellerId,
        sellerPhone: primarySellerPhone,
        items: orderItems,
        subtotalXaf: pricing.subtotalXaf,
        shippingFeeXaf: pricing.shippingFeeXaf,
        totalAmountXaf: pricing.totalAmountXaf,
        currency: 'XAF',
        shippingAddress: data.shippingAddress || {},
        deliveryMethod: data.deliveryMethod,
        // The preference as RESOLVED above: null for pickup, or when the chosen
        // provider turned out unavailable, so the order never carries a dead pick.
        preferredDriverId: effectivePreferredDriverId,
        paymentStatus: PAYMENT_STATUS.PENDING,
        fulfillmentStatus: FULFILLMENT_STATUS.PROCESSING,
        idempotencyKey: effectiveIdempotencyKey,
        timeline: [
          {
            status: FULFILLMENT_STATUS.PROCESSING,
            timestamp: new Date().toISOString(),
            note: 'Order placed (Pay on Delivery / Pay on Pickup).'
          }
        ]
      });

      // 6. Atomically persist to database
      const savedOrder = await this.repository.saveOrder(order);
      // From here the stock belongs to the order: it is released when the order
      // is cancelled and consumed when it is delivered, not by this method.
      orderPlaced = true;

      // If the buyer's chosen provider was dropped above, tell them honestly: the
      // order succeeded at the standard city rate, it was not silently switched.
      // A transient on the returned order only — never persisted (toJSON ignores
      // it); the route surfaces it in the create response and the checkout shows
      // it once. A later idempotent replay reasonably omits it.
      if (droppedPreferenceReason) {
        savedOrder.deliveryNotice = buildDroppedPreferenceNotice(droppedPreferenceReason, savedOrder.shippingFeeXaf);
      }

      // 7. Save Idempotency Cache Result
      if (scopedKey) {
        const responseBody = {
          success: true,
          order: savedOrder.toJSON()
        };
        const authScope = crypto.createHash('sha256').update(userId).digest('hex').slice(0, 16);
        const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        await IdempotencyService.saveResponse(scopedKey, 201, responseBody, 86400, payloadHash, authScope).catch(err => {
          logger.warn(`[OrderCreationService] Failed to cache idempotency response: ${err.message}`);
        });
      }

      // 8. Invalidate Buyer's Purchase History Cache
      try {
        if (CacheService.delPattern) {
          await CacheService.delPattern(`purchases:${userId}:*`);
        } else if (CacheService.del) {
          await CacheService.del(`purchases:${userId}:all:20:0`);
        }
      } catch (cacheErr) {
        logger.warn(`[OrderCreationService] Cache invalidation warning: ${cacheErr.message}`);
      }

      // 9. Asynchronous Activity & Notification Dispatch
      if (UserActivityUseCase && typeof UserActivityUseCase.recordActivity === 'function') {
        UserActivityUseCase.recordActivity(userId, {
          actionType: 'order_placed',
          title: 'Order Placed',
          description: `Placed order ${savedOrder.orderNumber} (XAF ${savedOrder.totalAmountXaf}).`,
          resourceType: 'order',
          resourceId: savedOrder.id
        }).catch(e => logger.warn(`[OrderCreation] Activity log error: ${e.message}`));
      }

      this._notifyParties(savedOrder, {
        storeName: evaluatedItems[0].storeName || null,
        storeId: evaluatedItems[0].storeId || null,
        provider: messageProvider,
        droppedProviderReason: droppedPreferenceReason
      });

      return savedOrder;
    } catch (err) {
      if (scopedKey && lockAcquired) {
        await IdempotencyService.releaseLock(scopedKey).catch(() => {});
      }
      throw err;
    } finally {
      this._activeLocks.delete(userLockKey);
      if (crossProcessLock) {
        await this._lockService.releaseLock(userLockKey, crossProcessLock).catch(() => {});
      }
      // The order never got saved: put every unit back on the shelf.
      if (!orderPlaced && heldLines.length) {
        await this._releaseStock(heldLines);
      }
    }
  }

  /**
   * Takes every line of the order off the shelf, atomically, before the order is
   * written. `checkInventory` above only looked; this is what actually stops two
   * buyers from being sold the same last unit. The first line that cannot be held
   * puts back the ones already held and refuses the order with the same message
   * the availability check uses, so the buyer sees one consistent reason.
   *
   * @returns {Promise<Array<{listingId: string, variantId: string|null, quantity: number}>>}
   *          the lines actually holding stock, for the unwind path.
   */
  async _holdStock(evaluatedItems) {
    const held = [];
    for (const item of evaluatedItems) {
      let outcome;
      try {
        outcome = await this.repository.reserveInventory(item.listingId, item.variantId, item.quantity);
      } catch (err) {
        await this._releaseStock(held);
        throw err;
      }

      if (!outcome || !outcome.reserved) {
        await this._releaseStock(held);
        const available = outcome ? Math.max(0, outcome.availableQuantity) : 0;
        throw new ConflictError(
          `Insufficient stock for "${item.title}". Only ${available} unit(s) available, but requested ${item.quantity}.`
        );
      }

      // Nothing was actually held (untracked stock, or backorders allowed): there
      // is nothing to give back either, so it stays out of the unwind list.
      if (outcome.held > 0) {
        held.push({ listingId: item.listingId, variantId: item.variantId, quantity: item.quantity });
      }
    }
    return held;
  }

  /** Puts held stock back. Best effort: the caller is already failing the order. */
  async _releaseStock(heldLines) {
    for (const line of heldLines) {
      try {
        await this.repository.releaseInventory(line.listingId, line.variantId, line.quantity);
      } catch (err) {
        logger.error(`[OrderCreation] Could not release the hold on ${line.listingId}: ${describeError(err)}`);
      }
    }
  }

  /**
   * nanoDelivery as the default provider of an order, or null. It applies only
   * when the order's seller is the house store's owner (the seller is the
   * database's answer, never the request's) and the agency can take the order
   * WITHOUT changing what the buyer was shown: it is active, it serves the order's
   * city (the rule a buyer's own pick must pass), and it has no tariff of its own
   * (baseFeeXaf null: it quotes the standard city rate). Anything else, including
   * any lookup failure, answers null and the order simply has no default.
   */
  async _houseDefaultProvider(sellerId, city) {
    try {
      const house = await this.houseStore.resolve();
      if (!house || !sellerId || house.ownerId !== sellerId) return null;
      const provider = await this.houseStore.resolveDefaultProvider();
      if (!provider || !provider.id) return null;
      if (provider.status !== 'active' || provider.baseFeeXaf != null || !providerServes(provider, city)) return null;
      return provider;
    } catch (err) {
      logger.warn(`[OrderCreation] default delivery provider unavailable: ${describeError(err)}`);
      return null;
    }
  }

  /**
   * Tells both sides of a new order. The buyer gets their confirmation (naming the
   * store and, for a home delivery, the delivery provider); the seller gets the
   * order itself, with every detail needed to act on it, which is what starts the
   * delivery circuit: for a home delivery it is their cue to arrange a rider.
   * `audience` and `action` in the metadata tell the client which screen to open
   * when the notification is tapped (the same vocabulary as DeliveryService; see
   * docs/DELIVERY_API.md). The message itself is built by OrderNotificationBuilder.
   *
   * The seller is reached on two channels: the in-app notification (the guaranteed
   * one) and an e-mail. Both are best effort and asynchronous: nothing here is
   * awaited by the order, a failure of either is logged without personal data and
   * never touches the order that was saved, and one channel failing does not stop
   * the other. Returns the dispatch promise (it never rejects) for callers that
   * need to wait, such as tests; createOrder does not.
   *
   * @param {Order} order The saved order.
   * @param {object} [context] { storeName, storeId, provider, droppedProviderReason }
   */
  _notifyParties(order, context = {}) {
    const dispatch = this._dispatchNotifications(order, context || {});
    this._pendingNotifications.add(dispatch);
    dispatch.finally(() => this._pendingNotifications.delete(dispatch));
    return dispatch;
  }

  async _dispatchNotifications(order, context) {
    const notifier = this._notifications || NotificationService;
    const label = order.orderNumber;
    // Starts the work immediately (so a notification that can be sent at once is
    // sent at once), and turns a throw, synchronous or not, into a log line.
    const guard = (what, fn) => {
      const failed = (err) => logger.warn(`[OrderCreation] ${what} for ${label} failed: ${describeError(err)}`);
      try {
        return Promise.resolve(fn()).catch(failed);
      } catch (err) {
        failed(err);
        return Promise.resolve();
      }
    };

    const tasks = [];
    if (notifier && typeof notifier.create === 'function') {
      tasks.push(guard('buyer notification', () => notifier.create(order.buyerId, Messages.buildBuyerNotification(order, context))));
    }

    // The buyer's profile fills in what the shipping address left out. It is only
    // needed for the in-app message when the address has no name or phone; the
    // e-mail always uses it (it adds the buyer's e-mail address, which the order
    // does not carry). One lookup, shared, bounded.
    const ship = (order.shippingAddress && typeof order.shippingAddress === 'object') ? order.shippingAddress : {};
    const addressIncomplete = !Messages.clean(ship.fullName) || !Messages.clean(ship.phone);
    let buyerLookup = null;
    const buyerContact = () => {
      if (!buyerLookup) buyerLookup = bounded(this._recipients.buyerContact(order.buyerId));
      return buyerLookup;
    };

    // The full message (customer's name, phone and address, by notification and by
    // e-mail) is for orders of the house store (its owner) only. Every other seller gets the short
    // notification they always had: a customer's contact details do not go to
    // lock screens and mailboxes of sellers who never asked for them.
    // Decided from the order's own store, which came from the server-side listing and
    // never from the request, so there is nothing to look up and nothing to wait for.
    const houseOrder = isHouseStoreId(context.storeId);

    if (notifier && typeof notifier.create === 'function') {
      tasks.push(guard('seller notification', async () => {
        if (!houseOrder) {
          await notifier.create(order.sellerId, Messages.buildPlainSellerNotification(order));
          return;
        }
        const buyer = addressIncomplete ? await buyerContact() : null;
        await notifier.create(order.sellerId, Messages.buildSellerNotification(order, { ...context, buyer }));
      }));
    }

    if (houseOrder) tasks.push(guard('seller e-mail', async () => {
      // The seller's own switch for e-mail. If the preference cannot be read the
      // e-mail is still sent: the default is on, and a missed order costs more
      // than one e-mail the seller can turn off.
      let emailAllowed = true;
      try {
        const prefs = await this._getNotificationPreferences(order.sellerId);
        if (prefs && prefs.channels && prefs.channels.email === false) emailAllowed = false;
      } catch (_) { /* keep the default */ }
      if (!emailAllowed) return;

      const to = await this._recipients.sellerEmail({ sellerId: order.sellerId, storeId: context.storeId || null });
      if (!to) {
        logger.info(`[OrderCreation] no e-mail address for the seller of ${label}; the in-app notification stands.`);
        return;
      }
      const buyer = await buyerContact();
      const mail = Messages.buildSellerEmail(order, { ...context, buyer });
      const result = await this._sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text });
      if (result && result.sent === false) {
        logger.warn(`[OrderCreation] seller e-mail for ${label} was not sent${result.reason ? ` (${describeError({ message: result.reason })})` : ''}.`);
      }
    }));

    await Promise.all(tasks);
  }
}

module.exports = { OrderCreationService };
