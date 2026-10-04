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

class OrderRepository {
  constructor(options = {}) {
    const opts = options || {};
    this._customDb = opts.db;
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

    if (!this.db) return null;

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

    // Try fallback lookup via CatalogRepository (handles curated products in dev)
    try {
      const CatalogRepository = require('../../catalog/infrastructure/CatalogRepository');
      const product = await CatalogRepository.findPublicProductByIdOrSlug(listingId);
      if (product) {
        const storePhone = product.storePhone || product.phoneNumber || (product.store && (product.store.phoneNumber || product.store.whatsapp)) || null;
        return {
          id: product.id,
          storeId: product.storeId || 'str_default',
          sellerId: product.sellerId || (product.store && product.store.id) || 'usr_seller_default',
          storeName: product.merchant || (product.store && product.store.name) || 'LOUMOO Merchant',
          storeStatus: 'ACTIVE',
          storePhone,
          sellerPhone: storePhone,
          title: product.title,
          status: 'PUBLISHED',
          visibility: 'PUBLIC',
          currency: product.currency || 'XAF',
          basePriceMinor: product.priceNumeric || 0,
          salePriceMinor: product.salePriceNumeric || null,
          hasVariants: false,
          fulfillment: null,
          deletedAt: null
        };
      }
    } catch (catErr) {
      // Catalog fallback not available or failed
    }

    return null;
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
      const avail = inv.onHand - inv.reserved;
      return {
        isAvailable: !inv.trackInventory || (avail >= requestedQuantity),
        availableQuantity: avail,
        trackInventory: inv.trackInventory
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
      }

      if (data) {
        return this._mapRowToOrder(data);
      }
    } catch (err) {
      handleDatabaseFailure(err, 'OrderRepository.saveOrder');
    }

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
          .single();

        if (error) {
          handleDatabaseFailure(error, 'OrderRepository.updateFulfillmentStatusAtomic');
        }

        if (data) {
          const updated = this._mapRowToOrder(data);
          this._inMemoryOrders.set(updated.id, updated);
          return updated;
        }
      } catch (err) {
        handleDatabaseFailure(err, 'OrderRepository.updateFulfillmentStatusAtomic');
      }
    }

    // In-memory update (only after the durable write path has been attempted)
    existing.fulfillmentStatus = nextStatus;
    existing.timeline = updatedTimeline;
    existing.updatedAt = new Date().toISOString();
    this._inMemoryOrders.set(existing.id, existing);
    return existing;
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
