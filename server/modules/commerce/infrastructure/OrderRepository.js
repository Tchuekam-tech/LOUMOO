/**
 * LOUMOO Commerce Core — Order Repository
 * ---------------------------------------------------------------------------
 * Authoritative persistence gateway for Commerce Orders and catalog verifications.
 * Direct PostgreSQL queries on `iam.orders`, `iam.listings`, and `iam.listing_variants`.
 * Features fail-safe transactional consistency and unit-test in-memory backing.
 */

const { SupabaseDatabase, handleDatabaseFailure } = require('../../../infrastructure/database/SupabaseClient');
const { Order, OrderItem, FULFILLMENT_STATUS, PAYMENT_STATUS, DELIVERY_METHOD } = require('../domain/Order');
const { ConflictError, NotFoundError, InfrastructureError } = require('../../../shared/errors/AppError');
const logger = require('../../../shared/logging/logger');
const { findCuratedProduct, payablePriceXaf } = require('../../catalog/domain/CuratedCatalog');
const { getSharedHouseStore } = require('../../store/application/HouseStoreService');

class OrderRepository {
  constructor(options = {}) {
    const opts = options || {};
    this._customDb = opts.db;
    // Resolves the house store (NanoAfrica), which is the seller of every curated
    // product. Injectable so a test needs neither a database nor the shared cache.
    this._houseStore = opts.houseStore || null;
    // The curated dataset, keyed by product id. Injectable for the same reason.
    this._curatedCatalog = opts.curatedCatalog || null;
    // In-memory fallback for local unit tests when DB credentials are absent
    this._inMemoryOrders = new Map();
    this._inMemoryListings = new Map();
    this._inMemoryVariants = new Map();
    this._inMemoryInventory = new Map();
  }

  get db() {
    if (this._customDb !== undefined) return this._customDb;
    try {
      return SupabaseDatabase.getAdmin();
    } catch {
      return null;
    }
  }

  /**
   * Authoritatively retrieves an orderable listing.
   * @param {string} listingId
   * @returns {Promise<object|null>}
   */
  async findListingById(listingId) {
    if (!listingId) return null;

    // Check in-memory store first for test mocks
    if (this._inMemoryListings.has(listingId)) {
      return this._inMemoryListings.get(listingId);
    }

    if (!this.db) return this._findCuratedListing(listingId);

    try {
      const { data, error } = await this.db
        .from('listings')
        .select(`
          id, store_id, seller_id, title, slug, status, visibility,
          currency, base_price_minor, sale_price_minor, has_variants,
          fulfillment_model, metadata, deleted_at,
          stores(id, name, status, owner_id, phone_number, metadata)
        `)
        .eq('id', listingId)
        .is('deleted_at', null)
        .maybeSingle();

      if (error) {
        handleDatabaseFailure(error, 'OrderRepository.findListingById');
      }

      if (data) {
        const storePhone = data.stores?.phone_number || (data.stores?.metadata && data.stores.metadata.phone) || null;
        return {
          id: data.id,
          storeId: data.store_id,
          sellerId: data.seller_id || (data.stores && data.stores.owner_id) || null,
          storeName: data.stores ? data.stores.name : null,
          storeStatus: data.stores ? data.stores.status : 'ACTIVE',
          storePhone,
          sellerPhone: storePhone,
          title: data.title,
          status: data.status,
          visibility: data.visibility,
          currency: data.currency || 'XAF',
          basePriceMinor: Number(data.base_price_minor) || 0,
          salePriceMinor: data.sale_price_minor != null ? Number(data.sale_price_minor) : null,
          hasVariants: Boolean(data.has_variants),
          fulfillment: data.metadata?.fulfillment || null,
          deletedAt: data.deleted_at
        };
      }
    } catch (err) {
      handleDatabaseFailure(err, 'OrderRepository.findListingById');
    }

    // Not a listing in iam.listings. The only other thing that can be ordered is a
    // product of the curated storefront dataset, which belongs to the house store.
    return this._findCuratedListing(listingId);
  }

  /**
   * A curated storefront product (src/data/catalog_products.js) as an orderable
   * listing, or null.
   *
   * Every curated product belongs to the house store (NanoAfrica). Its seller is
   * therefore the owner of that store's DATABASE ROW: never the request, never the
   * dataset. Filing these orders under an invented seller ('usr_seller_default')
   * is what broke every such checkout with a foreign-key 500 until 2026-10-07, so
   * the rules here are strict:
   *   - the id must be an EXACT key of the dataset. The catalogue's own lookup
   *     fabricates a placeholder product for unknown ids and fuzzy-matches partial
   *     ones; it must never decide what can be bought;
   *   - the house store must be provisioned (HouseStoreService.resolve). If it is
   *     not, nothing is orderable and the caller refuses the line as a showcase
   *     item, exactly as before;
   *   - the price is the PAYABLE one (the lower of price and salePrice), never the
   *     compare-at "was" price.
   * @param {string} listingId
   * @returns {Promise<object|null>}
   */
  async _findCuratedListing(listingId) {
    const product = findCuratedProduct(listingId, this._curatedCatalog || undefined);
    if (!product) return null;
    const priceXaf = payablePriceXaf(product);
    if (!(priceXaf > 0)) return null;

    const houseService = this._houseStore || getSharedHouseStore();
    let house = null;
    try {
      house = await houseService.resolve();
    } catch (err) {
      // Not being able to read the store is not a reason to invent one.
      logger.warn('[OrderRepository] house store lookup failed; curated product left un-orderable', {
        message: err && err.message
      });
    }
    if (!house || !house.ownerId) return null;

    return {
      id: listingId,
      storeId: house.storeId,
      sellerId: house.ownerId,
      storeName: house.name,
      storeStatus: house.status,
      storePhone: house.phone || null,
      sellerPhone: house.phone || null,
      title: product.title,
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      currency: 'XAF',
      basePriceMinor: priceXaf,
      salePriceMinor: null,
      hasVariants: false,
      fulfillment: null,
      curated: true,
      deletedAt: null
    };
  }

  /**
   * Authoritatively retrieves an active variant belonging to a listing.
   * @param {string} listingId
   * @param {string} variantId
   * @returns {Promise<object|null>}
   */
  async findVariantById(listingId, variantId) {
    if (!listingId || !variantId) return null;

    const memKey = `${listingId}:${variantId}`;
    if (this._inMemoryVariants.has(memKey)) {
      return this._inMemoryVariants.get(memKey);
    }

    if (!this.db) return null;

    try {
      const { data, error } = await this.db
        .from('listing_variants')
        .select('id, listing_id, sku, title, price_minor, currency, stock_quantity, is_active')
        .eq('id', variantId)
        .eq('listing_id', listingId)
        .maybeSingle();

      if (error) {
        handleDatabaseFailure(error, 'OrderRepository.findVariantById');
      }

      if (data) {
        return {
          id: data.id,
          listingId: data.listing_id,
          sku: data.sku,
          title: data.title,
          priceMinor: Number(data.price_minor) || 0,
          currency: data.currency || 'XAF',
          stockQuantity: Number(data.stock_quantity) || 0,
          isActive: Boolean(data.is_active)
        };
      }
    } catch (err) {
      handleDatabaseFailure(err, 'OrderRepository.findVariantById');
    }

    return null;
  }

  /**
   * Checks available inventory for a listing/variant.
   * @param {string} listingId
   * @param {string|null} variantId
   * @param {number} requestedQuantity
   * @returns {Promise<{isAvailable: boolean, availableQuantity: number, trackInventory: boolean}>}
   */
  async checkInventory(listingId, variantId = null, requestedQuantity = 1) {
    const memKey = `${listingId}:${variantId || 'null'}`;
    if (this._inMemoryInventory.has(memKey)) {
      const inv = this._inMemoryInventory.get(memKey);
      const avail = (Number(inv.onHand) || 0) - (Number(inv.reserved) || 0);
      return {
        // `allow_backorder` counts here exactly as it does on the database path
        // below. It did not, so a seller who accepts backorders was refused in
        // every test that seeds stock in memory while production let them
        // through — the harness and the real thing disagreed about the same
        // listing.
        isAvailable: !inv.trackInventory || Boolean(inv.allowBackorder) || (avail >= requestedQuantity),
        availableQuantity: avail,
        trackInventory: Boolean(inv.trackInventory)
      };
    }

    if (!this.db) {
      return {
        isAvailable: true,
        availableQuantity: 9999,
        trackInventory: false
      };
    }

    try {
      let query = this.db
        .from('listing_inventory')
        .select('on_hand, reserved, track_inventory, allow_backorder')
        .eq('listing_id', listingId);

      if (variantId) {
        query = query.eq('variant_id', variantId);
      } else {
        query = query.is('variant_id', null);
      }

      const { data, error } = await query.maybeSingle();
      if (error) {
        handleDatabaseFailure(error, 'OrderRepository.checkInventory');
      }

      if (data && data.track_inventory) {
        const onHand = Number(data.on_hand) || 0;
        const reserved = Number(data.reserved) || 0;
        const available = onHand - reserved;
        const allowBackorder = Boolean(data.allow_backorder);
        return {
          isAvailable: allowBackorder || (available >= requestedQuantity),
          availableQuantity: available,
          trackInventory: true
        };
      }
    } catch (err) {
      handleDatabaseFailure(err, 'OrderRepository.checkInventory');
    }

    // Default if no inventory record exists: assumed available
    return {
      isAvailable: true,
      availableQuantity: 9999,
      trackInventory: false
    };
  }

  /**
   * Atomically persists a new Order into PostgreSQL.
   * @param {Order} order
   * @returns {Promise<Order>}
   */
  async saveOrder(order) {
    if (!(order instanceof Order)) {
      throw new Error('OrderRepository.saveOrder requires an Order instance');
    }

    // Persist in memory store (acts as backup / unit-test ground truth)
    const orderJson = order.toJSON();
    const id = order.id || `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    order.id = id;
    orderJson.id = id;
    this._inMemoryOrders.set(id, order);

    if (!this.db) {
      return order;
    }

    try {
      const dbPayload = {
        id: order.id,
        buyer_id: order.buyerId,
        seller_id: order.sellerId,
        order_number: order.orderNumber,
        total_amount_xaf: order.totalAmountXaf,
        items: order.items.map(i => i.toJSON()),
        shipping_address: {
          ...order.shippingAddress,
          _deliveryMethod: order.deliveryMethod,
          _preferredDriverId: order.preferredDriverId || null,
          _subtotalXaf: order.subtotalXaf,
          _shippingFeeXaf: order.shippingFeeXaf,
          _idempotencyKey: order.idempotencyKey,
          _sellerPhone: order.sellerPhone || null,
          _timeline: order.timeline
        },
        payment_status: order.paymentStatus || 'pending',
        fulfillment_status: order.fulfillmentStatus || 'processing'
      };

      const { data, error } = await this.db
        .from('orders')
        .insert(dbPayload)
        .select()
        .single();

      if (error) {
        handleDatabaseFailure(error, 'OrderRepository.saveOrder');
      } else if (data) {
        return this._mapRowToOrder(data);
      }
    } catch (err) {
      if (err instanceof InfrastructureError) throw err;
      handleDatabaseFailure(err, 'OrderRepository.saveOrder');
    }

    // Reached only when the database did not store the order and the failure policy
    // allowed carrying on (development, no credentials). Production throws above.
    return order;
  }

  /**
   * Finds an order by its ID or Order Number.
   * @param {string} idOrNumber
   * @returns {Promise<Order|null>}
   */
  async findOrderById(idOrNumber) {
    if (!idOrNumber) return null;

    // Check in-memory store first
    for (const [id, ord] of this._inMemoryOrders.entries()) {
      if (id === idOrNumber || ord.orderNumber === idOrNumber) {
        return ord;
      }
    }

    if (!this.db) return null;

    try {
      let query = this.db
        .from('orders')
        .select('*');

      if (idOrNumber.startsWith('KM-') || idOrNumber.startsWith('LM-')) {
        query = query.eq('order_number', idOrNumber);
      } else {
        query = query.eq('id', idOrNumber);
      }

      const { data, error } = await query.maybeSingle();
      if (error) {
        handleDatabaseFailure(error, 'OrderRepository.findOrderById');
      }

      if (data) {
        const order = this._mapRowToOrder(data);
        this._inMemoryOrders.set(order.id, order);
        return order;
      }
    } catch (err) {
      handleDatabaseFailure(err, 'OrderRepository.findOrderById');
    }

    return null;
  }

  /**
   * Like findOrderById, but never answers from the in-memory cache when a
   * database is available. findOrderById returns whatever this instance cached
   * first and never refreshes it, which is wrong for any decision about an
   * order's CURRENT status made in a different request or by a different
   * service instance (a cancelled or refunded order must not look live). The
   * database row is read, the cache is refreshed with it, and the memory copy
   * is only used when there is no database (tests, a laptop with no credentials)
   * or, outside production, after a handled database failure.
   * @param {string} idOrNumber
   * @returns {Promise<Order|null>}
   */
  async findOrderByIdFresh(idOrNumber) {
    if (!idOrNumber) return null;
    if (!this.db) return this.findOrderById(idOrNumber);

    try {
      let query = this.db.from('orders').select('*');
      if (idOrNumber.startsWith('KM-') || idOrNumber.startsWith('LM-')) {
        query = query.eq('order_number', idOrNumber);
      } else {
        query = query.eq('id', idOrNumber);
      }
      const { data, error } = await query.maybeSingle();
      if (error) {
        handleDatabaseFailure(error, 'OrderRepository.findOrderByIdFresh');
      } else if (data) {
        const order = this._mapRowToOrder(data);
        this._inMemoryOrders.set(order.id, order);
        return order;
      } else {
        // Gone from the database: drop any stale cached copy as well.
        for (const [id, ord] of this._inMemoryOrders.entries()) {
          if (id === idOrNumber || ord.orderNumber === idOrNumber) this._inMemoryOrders.delete(id);
        }
        return null;
      }
    } catch (err) {
      handleDatabaseFailure(err, 'OrderRepository.findOrderByIdFresh');
    }
    // Handled failure outside production: serve what we have.
    return this.findOrderById(idOrNumber);
  }

  /**
   * Paged query of orders belonging to a buyer.
   * @param {string} buyerId
   * @param {object} options
   */
  async findOrdersByBuyer(buyerId, { status = 'all', limit = 20, offset = 0 } = {}) {
    if (!buyerId) return { orders: [], total: 0 };

    // Defensive cap, independent of the route clamp: no caller can turn this into
    // an unbounded scan via a huge/negative limit or offset.
    limit = Math.max(1, Math.min(Number(limit) || 20, 100));
    offset = Math.max(0, Number(offset) || 0);

    let dbOrders = [];
    let dbTotal = 0;

    if (this.db) {
      try {
        let query = this.db
          .from('orders')
          .select('*', { count: 'exact' })
          .eq('buyer_id', buyerId);

        if (status && status !== 'all') {
          query = query.eq('fulfillment_status', status);
        }

        const { data, count, error } = await query
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) {
          handleDatabaseFailure(error, 'OrderRepository.findOrdersByBuyer');
        }

        if (data) {
          dbOrders = data.map(r => this._mapRowToOrder(r));
          dbTotal = count || dbOrders.length;
          return { orders: dbOrders, total: dbTotal };
        }
      } catch (err) {
        handleDatabaseFailure(err, 'OrderRepository.findOrdersByBuyer');
      }
    }

    // Fallback: search in-memory orders
    const memOrders = Array.from(this._inMemoryOrders.values())
      .filter(o => o.buyerId === buyerId && (status === 'all' || o.fulfillmentStatus === status))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return {
      orders: memOrders.slice(offset, offset + limit),
      total: memOrders.length
    };
  }

  /**
   * A seller's orders in the given fulfillment statuses, newest first, read fresh
   * (never from this instance's cache). `sellerId` null means every seller's
   * (administrators). Used by the delivery dispatch board.
   *
   * The delivery method is stored inside the shipping_address JSON, and a row
   * WITHOUT it maps to HOME_DELIVERY (see _mapRowToOrder); an SQL filter on that
   * JSON key would silently drop those rows. So rows are filtered after mapping,
   * from an over-fetch of twice the limit; `homeDeliveryOnly` defaults to true.
   * `excludePaymentStatuses` is applied the same way, BEFORE the limit, so that a
   * limit of N never returns fewer than N rows just because some were excluded.
   * @returns {Promise<Order[]>}
   */
  async findOrdersBySeller(sellerId, { statuses = [], limit = 50, homeDeliveryOnly = true, excludePaymentStatuses = [] } = {}) {
    const wanted = Array.isArray(statuses) ? statuses.filter(Boolean) : [];
    const excluded = Array.isArray(excludePaymentStatuses) ? excludePaymentStatuses : [];
    const cap = Math.max(1, Math.min(Number(limit) || 50, 100));
    const keep = (o) => (!homeDeliveryOnly || o.deliveryMethod === DELIVERY_METHOD.HOME_DELIVERY)
      && (!wanted.length || wanted.includes(o.fulfillmentStatus))
      && !excluded.includes(o.paymentStatus);

    if (this.db) {
      try {
        let query = this.db.from('orders').select('*');
        if (sellerId) query = query.eq('seller_id', sellerId);
        if (wanted.length) query = query.in('fulfillment_status', wanted);
        const { data, error } = await query.order('created_at', { ascending: false }).limit(cap * 2);
        if (error) {
          handleDatabaseFailure(error, 'OrderRepository.findOrdersBySeller');
        } else {
          // Mapped row by row: one malformed order must not blank the whole board.
          const mapped = [];
          for (const r of data || []) {
            try {
              mapped.push(this._mapRowToOrder(r));
            } catch (err) {
              logger.warn(`[OrderRepository] Skipping unreadable order ${r && r.id} on the dispatch board: ${err.message}`);
            }
          }
          return mapped.filter(keep).slice(0, cap);
        }
      } catch (err) {
        handleDatabaseFailure(err, 'OrderRepository.findOrdersBySeller');
      }
    }

    return Array.from(this._inMemoryOrders.values())
      .filter((o) => (!sellerId || o.sellerId === sellerId) && keep(o))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, cap);
  }

  /**
   * Concurrency-safe atomic fulfillment state update.
   * Uses conditional WHERE on current status to prevent race conditions.
   *
   * @param {string} orderId
   * @param {string} expectedCurrentStatus
   * @param {string} nextStatus
   * @param {object} metadata
   * @returns {Promise<Order>}
   */
  async updateFulfillmentStatusAtomic(orderId, expectedCurrentStatus, nextStatus, { note = '', updatedBy = 'system' } = {}) {
    // Compare against the database, not a cached copy: a stale cache would turn a
    // legitimate transition into a spurious "concurrency conflict" (or let one
    // through that the conditional UPDATE below would then reject).
    const existing = await this.findOrderByIdFresh(orderId);
    if (!existing) {
      throw new NotFoundError('Order not found');
    }

    if (existing.fulfillmentStatus !== expectedCurrentStatus) {
      throw new ConflictError(
        `Concurrency conflict: Order status is currently "${existing.fulfillmentStatus}", ` +
        `cannot transition from "${expectedCurrentStatus}" to "${nextStatus}".`
      );
    }

    const newTimelineEntry = {
      status: nextStatus,
      previousStatus: expectedCurrentStatus,
      timestamp: new Date().toISOString(),
      updatedBy,
      note
    };

    const updatedTimeline = [...(existing.timeline || []), newTimelineEntry];

    if (this.db) {
      // The compare-and-swap: the UPDATE only matches while the row is still in the
      // status the caller read. maybeSingle() makes "nothing matched" a plain null
      // instead of a PGRST116 error, because that error used to be swallowed by the
      // production failure policy and the method went on to report an in-memory
      // "update" that never happened, defeating the swap.
      let attempted = false;
      let persisted = null;
      try {
        const { data, error } = await this.db
          .from('orders')
          .update({
            fulfillment_status: nextStatus,
            updated_at: new Date().toISOString(),
            shipping_address: {
              ...existing.shippingAddress,
              _timeline: updatedTimeline
            }
          })
          .eq('id', orderId)
          .eq('fulfillment_status', expectedCurrentStatus)
          .select()
          .maybeSingle();

        if (error) {
          handleDatabaseFailure(error, 'OrderRepository.updateFulfillmentStatusAtomic');
        } else {
          attempted = true;
          persisted = data;
        }
      } catch (err) {
        if (err instanceof InfrastructureError) throw err;
        handleDatabaseFailure(err, 'OrderRepository.updateFulfillmentStatusAtomic');
      }

      if (attempted && !persisted) {
        throw new ConflictError(
          `Concurrency conflict: Order status changed while this transition ` +
          `("${expectedCurrentStatus}" to "${nextStatus}") was being applied.`
        );
      }
      if (persisted) {
        const updated = this._mapRowToOrder(persisted);
        this._inMemoryOrders.set(updated.id, updated);
        await this._settleInventory(existing, nextStatus);
        return updated;
      }
    }

    // In-memory update (only after the durable write path has been attempted)
    existing.fulfillmentStatus = nextStatus;
    existing.timeline = updatedTimeline;
    existing.updatedAt = new Date().toISOString();
    this._inMemoryOrders.set(existing.id, existing);
    await this._settleInventory(existing, nextStatus);
    return existing;
  }

  /**
   * The stock an order held follows its end: released on cancellation, consumed
   * on delivery. Runs only after this method's compare-and-swap won, which
   * happens once per order, so stock is never released or consumed twice.
   */
  async _settleInventory(order, nextStatus) {
    const held = OrderRepository.heldInventory(order);
    if (!held.length) return;
    if (nextStatus === FULFILLMENT_STATUS.CANCELLED) await this.releaseInventory(held);
    else if (nextStatus === FULFILLMENT_STATUS.DELIVERED) await this.commitInventory(held);
  }

  /**
   * Concurrency-safe atomic payment/escrow attestation update, mirroring the
   * fulfillment updater. Guards on the expected current payment status so a
   * racing write cannot be clobbered; the caller (the delivery escrow sync, an
   * order cancellation) decides the legal transition. No real money moves — this
   * is the buyer-protection status machine (pending -> escrow_held -> released,
   * or -> refundable -> refunded).
   */
  async updatePaymentStatusAtomic(orderId, expectedCurrentStatus, nextStatus, { note = '', updatedBy = 'system' } = {}) {
    const existing = await this.findOrderByIdFresh(orderId);
    if (!existing) {
      throw new NotFoundError('Order not found');
    }

    if (existing.paymentStatus !== expectedCurrentStatus) {
      throw new ConflictError(
        `Concurrency conflict: Order payment status is currently "${existing.paymentStatus}", ` +
        `cannot transition from "${expectedCurrentStatus}" to "${nextStatus}".`
      );
    }

    const newTimelineEntry = {
      paymentStatus: nextStatus,
      previousPaymentStatus: expectedCurrentStatus,
      timestamp: new Date().toISOString(),
      updatedBy,
      note
    };

    const updatedTimeline = [...(existing.timeline || []), newTimelineEntry];

    if (this.db) {
      // The compare-and-swap: the UPDATE only matches while the row is still in the
      // status the caller read. maybeSingle() makes "nothing matched" a plain null
      // instead of a PGRST116 error, because that error used to be swallowed by the
      // production failure policy and the method went on to report an in-memory
      // "update" that never happened, defeating the swap.
      let attempted = false;
      let persisted = null;
      try {
        const { data, error } = await this.db
          .from('orders')
          .update({
            payment_status: nextStatus,
            updated_at: new Date().toISOString(),
            shipping_address: {
              ...existing.shippingAddress,
              _timeline: updatedTimeline
            }
          })
          .eq('id', orderId)
          .eq('payment_status', expectedCurrentStatus)
          .select()
          .maybeSingle();

        if (error) {
          handleDatabaseFailure(error, 'OrderRepository.updatePaymentStatusAtomic');
        } else {
          attempted = true;
          persisted = data;
        }
      } catch (err) {
        if (err instanceof InfrastructureError) throw err;
        handleDatabaseFailure(err, 'OrderRepository.updatePaymentStatusAtomic');
      }

      if (attempted && !persisted) {
        throw new ConflictError(
          `Concurrency conflict: Order payment status changed while this transition ` +
          `("${expectedCurrentStatus}" to "${nextStatus}") was being applied.`
        );
      }
      if (persisted) {
        const updated = this._mapRowToOrder(persisted);
        this._inMemoryOrders.set(updated.id, updated);
        return updated;
      }
    }

    // In-memory update (only after the durable write path has been attempted)
    existing.paymentStatus = nextStatus;
    existing.timeline = updatedTimeline;
    existing.updatedAt = new Date().toISOString();
    this._inMemoryOrders.set(existing.id, existing);
    return existing;
  }


  /* ------------------------------------------------------------- inventory
   * An order holds its stock from placement until it ends: placing it RESERVES
   * the quantity (reserved += q), cancelling RELEASES it (reserved -= q) and
   * delivering CONSUMES it (on_hand -= q, reserved -= q). checkInventory used to
   * be the only step, so stock was never held and a listing with 1 unit could be
   * sold any number of times. Each move is a compare-and-swap on the row's
   * current numbers, retried on a race, so two buyers of the last unit cannot
   * both win. Untracked listings (no row, or track_inventory false) are not
   * touched and are reported as such.
   */

  /** One listing line's inventory row, or null. */
  async _readInventory(listingId, variantId) {
    let query = this.db
      .from('listing_inventory')
      .select('id, on_hand, reserved, track_inventory, allow_backorder')
      .eq('listing_id', listingId);
    query = variantId ? query.eq('variant_id', variantId) : query.is('variant_id', null);
    const { data, error } = await query.order('id', { ascending: true }).limit(1);
    if (error) throw new InfrastructureError('Supabase', `inventory read failed: ${error.message}`, error);
    return (data && data[0]) || null;
  }

  /**
   * Applies { reserved, onHand } deltas to one line. With `requireAvailable`
   * (a reservation) it refuses when on_hand - reserved < quantity, unless the
   * listing allows backorders. Returns { tracked, available }.
   */
  async _moveInventory(listingId, variantId, { reserved = 0, onHand = 0 }, { requireAvailable = 0 } = {}) {
    const memKey = `${listingId}:${variantId || 'null'}`;
    if (this._inMemoryInventory.has(memKey)) {
      const inv = this._inMemoryInventory.get(memKey);
      if (!inv.trackInventory) return { tracked: false };
      const available = inv.onHand - inv.reserved;
      if (requireAvailable && !inv.allowBackorder && available < requireAvailable) {
        return { tracked: true, refused: true, available };
      }
      inv.reserved = Math.max(0, inv.reserved + reserved);
      inv.onHand = Math.max(0, inv.onHand + onHand);
      return { tracked: true, available: inv.onHand - inv.reserved };
    }
    if (!this.db) return { tracked: false };

    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await this._readInventory(listingId, variantId);
      if (!row || !row.track_inventory) return { tracked: false };
      const curOnHand = Number(row.on_hand) || 0;
      const curReserved = Number(row.reserved) || 0;
      const available = curOnHand - curReserved;
      if (requireAvailable && !row.allow_backorder && available < requireAvailable) {
        return { tracked: true, refused: true, available };
      }
      const { data, error } = await this.db
        .from('listing_inventory')
        .update({
          reserved: Math.max(0, curReserved + reserved),
          on_hand: Math.max(0, curOnHand + onHand),
          updated_at: new Date().toISOString()
        })
        .eq('id', row.id)
        .eq('reserved', curReserved)
        .eq('on_hand', curOnHand)
        .select('id')
        .maybeSingle();
      if (error) throw new InfrastructureError('Supabase', `inventory update failed: ${error.message}`, error);
      if (data) return { tracked: true, available: Math.max(0, curOnHand + onHand) - Math.max(0, curReserved + reserved) };
      // Someone moved this row between the read and the write: read again.
    }
    throw new ConflictError('Stock for this item is changing too quickly. Please try again.');
  }

  /**
   * Holds stock for every line of an order, all or nothing. Returns the lines
   * that were actually held (tracked listings only), to be stored on the order
   * and released or consumed when it ends. A line that cannot be held releases
   * the ones already held and throws a 409 naming the item.
   */
  async reserveInventory(lines) {
    const held = [];
    try {
      for (const line of lines) {
        const res = await this._moveInventory(line.listingId, line.variantId, { reserved: line.quantity }, { requireAvailable: line.quantity });
        if (res.refused) {
          throw new ConflictError(
            `Insufficient stock for "${line.title || line.listingId}". Only ${Math.max(0, res.available)} unit(s) available, but requested ${line.quantity}.`
          );
        }
        if (res.tracked) held.push({ listingId: line.listingId, variantId: line.variantId || null, quantity: line.quantity });
      }
    } catch (err) {
      await this.releaseInventory(held);
      throw err;
    }
    return held;
  }

  /** Gives held stock back (the order was cancelled, or never saved). Best effort. */
  async releaseInventory(lines) {
    for (const line of lines || []) {
      try {
        await this._moveInventory(line.listingId, line.variantId, { reserved: -line.quantity });
      } catch (err) {
        logger.error(`[OrderRepository] Could not release ${line.quantity} of ${line.listingId}: ${err.message}`);
      }
    }
  }

  /** The held stock left with the buyer (the order was delivered). Best effort. */
  async commitInventory(lines) {
    for (const line of lines || []) {
      try {
        await this._moveInventory(line.listingId, line.variantId, { reserved: -line.quantity, onHand: -line.quantity });
      } catch (err) {
        logger.error(`[OrderRepository] Could not consume ${line.quantity} of ${line.listingId}: ${err.message}`);
      }
    }
  }

  /** What an order holds: the lines its placement reserved. */
  static heldInventory(order) {
    const meta = (order && order.shippingAddress) || {};
    return Array.isArray(meta._inventory) ? meta._inventory : [];
  }

  // --- Test Harness Seed Helpers ---
  seedListing(listing) {
    this._inMemoryListings.set(listing.id, listing);
  }

  seedVariant(listingId, variant) {
    this._inMemoryVariants.set(`${listingId}:${variant.id}`, variant);
  }

  seedInventory(listingId, variantId, inventory) {
    this._inMemoryInventory.set(`${listingId}:${variantId || 'null'}`, inventory);
  }

  _mapRowToOrder(row) {
    const shippingMeta = (row.shipping_address && typeof row.shipping_address === 'object') ? row.shipping_address : {};
    const items = (Array.isArray(row.items) ? row.items : []).map(it => new OrderItem({
      listingId: it.listingId || it.productId || it.id,
      variantId: it.variantId || null,
      title: it.title || 'Item',
      sku: it.sku || null,
      unitPriceXaf: Number(it.unitPriceXaf ?? it.unitPrice ?? it.price ?? 0),
      quantity: Number(it.quantity) || 1,
      sellerId: it.sellerId || row.seller_id || 'usr_seller',
      storeId: it.storeId || null,
      storeName: it.storeName || null,
      storePhone: it.storePhone || it.sellerPhone || shippingMeta._sellerPhone || null,
      imageUrl: it.imageUrl || it.image || null
    }));

    return new Order({
      id: row.id,
      orderNumber: row.order_number,
      buyerId: row.buyer_id,
      sellerId: row.seller_id || (items[0] && items[0].sellerId) || 'usr_seller',
      sellerPhone: row.seller_phone || shippingMeta._sellerPhone || (items[0] && items[0].storePhone) || null,
      sellerWhatsapp: row.seller_phone || shippingMeta._sellerPhone || (items[0] && items[0].storePhone) || null,
      items,
      subtotalXaf: shippingMeta._subtotalXaf != null ? Number(shippingMeta._subtotalXaf) : undefined,
      shippingFeeXaf: shippingMeta._shippingFeeXaf != null ? Number(shippingMeta._shippingFeeXaf) : undefined,
      totalAmountXaf: Number(row.total_amount_xaf),
      currency: 'XAF',
      shippingAddress: row.shipping_address || {},
      deliveryMethod: shippingMeta._deliveryMethod || DELIVERY_METHOD.HOME_DELIVERY,
      preferredDriverId: shippingMeta._preferredDriverId || null,
      paymentStatus: row.payment_status || PAYMENT_STATUS.PENDING,
      fulfillmentStatus: row.fulfillment_status || FULFILLMENT_STATUS.PROCESSING,
      idempotencyKey: shippingMeta._idempotencyKey || null,
      timeline: shippingMeta._timeline || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }
}

module.exports = { OrderRepository };
