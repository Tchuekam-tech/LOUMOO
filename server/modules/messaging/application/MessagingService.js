/**
 * LOUMOO Messaging — application service
 * ---------------------------------------------------------------------------
 * Buyer ↔ boutique conversations inside the app.
 *
 * Authority:
 *   - The seller of a conversation is NEVER taken from a request. It is the
 *     owner of the store, found from the listing (OrderRepository, which also
 *     knows that every curated product belongs to the house store), from the
 *     store row, or from the order.
 *   - Only the conversation's buyer and seller may read or write it. Anyone else
 *     gets the same 404 as for an id that does not exist, so ids cannot be probed.
 *   - Opening a conversation from an order is allowed to that order's buyer and
 *     seller only.
 *
 * The recipient of a message is told through the notification feed, once per
 * unread streak (when their unread count goes from 0 to 1), not once per message.
 */
'use strict';

const {
  ValidationError,
  NotFoundError
} = require('../../../shared/errors/AppError');
const logger = require('../../../shared/logging/logger');
const {
  ROLES,
  normalizeBody,
  normalizeClientId,
  roleOf,
  buyerDisplayName,
  toConversationView,
  toMessageView
} = require('../domain/Conversation');

const CLOSED_STORE_STATUSES = new Set(['SUSPENDED', 'CLOSED', 'ARCHIVED']);
const MAX_PAGE = 100;

function clampLimit(raw, fallback) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_PAGE);
}

function parseSeq(raw) {
  if (raw == null || raw === '') return null;
  if (!/^\d{1,15}$/.test(String(raw))) throw new ValidationError('The message cursor is not valid.');
  return Number(raw);
}

/** The price the buyer pays: the lower of the pair when both are set (catalogue convention). */
function payablePrice(listing) {
  const base = Number(listing.basePriceMinor) || 0;
  const sale = listing.salePriceMinor != null ? Number(listing.salePriceMinor) || 0 : 0;
  if (base > 0 && sale > 0) return Math.min(base, sale);
  return base > 0 ? base : sale;
}

class MessagingService {
  /**
   * @param {object} deps
   * @param {object} deps.repository        MessagingRepository implementation
   * @param {object} [deps.orderRepository] resolves listings (incl. curated) and orders
   * @param {object} [deps.notifier]        { create(userId, payload) }
   * @param {function} [deps.curatedCover]  (listingId) => image path of a curated product
   */
  constructor({ repository, orderRepository = null, notifier = null, curatedCover = null } = {}) {
    if (!repository) throw new Error('MessagingService needs a repository.');
    this.repository = repository;
    this._orderRepository = orderRepository;
    this._notifier = notifier;
    this._curatedCover = curatedCover;
  }

  get orderRepository() {
    if (!this._orderRepository) {
      const { OrderRepository } = require('../../commerce/infrastructure/OrderRepository');
      this._orderRepository = new OrderRepository();
    }
    return this._orderRepository;
  }

  get notifier() {
    if (!this._notifier) {
      try { this._notifier = require('../../identity/application/NotificationService'); } catch (_) { this._notifier = null; }
    }
    return this._notifier;
  }

  curatedCover(listingId) {
    if (this._curatedCover) return this._curatedCover(listingId);
    try {
      const { findCuratedProduct } = require('../../catalog/domain/CuratedCatalog');
      const product = findCuratedProduct(listingId);
      return (product && (product.coverImage || (product.images && product.images[0]))) || null;
    } catch (_) {
      return null;
    }
  }

  // ── Reading ─────────────────────────────────────────────────────────────────

  async listInbox(userId, { role = 'all', limit } = {}) {
    const side = role === 'buying' || role === 'selling' ? role : 'all';
    const conversations = await this.repository.listConversations(userId, { role: side, limit: clampLimit(limit, 50) });
    return this._views(conversations, userId);
  }

  async unreadCount(userId) {
    return this.repository.unreadTotal(userId);
  }

  /**
   * The thread: the conversation header and its messages. With `after`, only
   * the messages newer than that cursor (what the open thread polls for).
   */
  async getThread(userId, conversationId, { after = null, before = null, limit } = {}) {
    const conversation = await this._participantConversation(userId, conversationId);
    const afterSeq = parseSeq(after);
    const beforeSeq = afterSeq == null ? parseSeq(before) : null;
    const pageSize = clampLimit(limit, 50);
    const messages = await this.repository.listMessages(conversation.id, { afterSeq, beforeSeq, limit: pageSize + 1 });
    let hasMore = false;
    if (afterSeq == null && messages.length > pageSize) {
      hasMore = true;
      messages.shift();
    } else if (afterSeq != null && messages.length > pageSize) {
      messages.length = pageSize;
    }
    const [view] = await this._views([conversation], userId);
    return {
      conversation: view,
      messages: messages.map((m) => toMessageView(m, conversation, userId)),
      hasMore
    };
  }

  // ── Writing ─────────────────────────────────────────────────────────────────

  /**
   * Opens (or reopens) the conversation between the caller and a boutique, about
   * a listing, a store or an order, optionally with a first message.
   * @param {string} userId
   * @param {{listingId?:string, storeId?:string, orderId?:string, body?:string, clientId?:string}} input
   */
  async startConversation(userId, input = {}) {
    const subjects = ['listingId', 'storeId', 'orderId'].filter((k) => typeof input[k] === 'string' && input[k].trim());
    if (subjects.length !== 1) {
      throw new ValidationError('Say which product, boutique or order the conversation is about.');
    }
    // Validate the first message before anything is created, so a bad message
    // does not leave an empty conversation behind.
    const body = input.body != null && String(input.body).trim() !== '' ? normalizeBody(input.body) : null;

    const subject = await this._resolveSubject(userId, subjects[0], input[subjects[0]].trim());
    if (subject.buyerId === subject.sellerId) {
      throw new ValidationError('This is your own boutique — buyers will message you here.');
    }

    let conversation = await this.repository.findConversationByPair(subject.buyerId, subject.storeId);
    let created = false;
    if (!conversation) {
      conversation = await this.repository.createConversation({
        buyerId: subject.buyerId,
        sellerId: subject.sellerId,
        storeId: subject.storeId
      });
      created = true;
    }

    // A card for what the conversation is about, unless it is already the last
    // card in the thread (asking twice about one product adds nothing).
    if (subject.card) {
      const latest = await this.repository.findLatestCard(conversation.id);
      const same = latest && latest.kind === subject.card.kind
        && (latest.metadata || {})[subject.card.key] === subject.card.metadata[subject.card.key];
      if (!same) {
        await this._insert(userId, conversation, { kind: subject.card.kind, body: '', metadata: subject.card.metadata });
      }
    }

    if (body) {
      await this._insert(userId, conversation, { kind: 'text', body, clientId: normalizeClientId(input.clientId) });
    }

    const thread = await this.getThread(userId, conversation.id);
    return Object.assign(thread, { created });
  }

  async sendMessage(userId, conversationId, { body, clientId } = {}) {
    const text = normalizeBody(body);
    const conversation = await this._participantConversation(userId, conversationId);
    const { message, conversation: after } = await this._insert(userId, conversation, {
      kind: 'text',
      body: text,
      clientId: normalizeClientId(clientId)
    });
    return { message: toMessageView(message, after || conversation, userId) };
  }

  async markRead(userId, conversationId) {
    const conversation = await this._participantConversation(userId, conversationId);
    const role = roleOf(conversation, userId);
    const unread = role === ROLES.BUYER ? conversation.buyerUnread : conversation.sellerUnread;
    // Nothing to clear: skip the write (the open thread calls this on every poll that brings news).
    const updated = unread > 0 || !(role === ROLES.BUYER ? conversation.buyerLastReadAt : conversation.sellerLastReadAt)
      ? await this.repository.markRead(conversation.id, role)
      : conversation;
    const [view] = await this._views([updated || conversation], userId);
    return { conversation: view };
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  async _participantConversation(userId, conversationId) {
    if (typeof conversationId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(conversationId)) {
      throw new NotFoundError('Conversation');
    }
    const conversation = await this.repository.findConversation(conversationId);
    if (!conversation || !roleOf(conversation, userId)) throw new NotFoundError('Conversation');
    return conversation;
  }

  async _insert(senderId, conversation, { kind, body, metadata = {}, clientId = null }) {
    const { message, duplicate } = await this.repository.insertMessage({
      conversationId: conversation.id,
      senderId,
      kind,
      body,
      metadata,
      clientId
    });
    const after = await this.repository.findConversation(conversation.id);
    if (!duplicate && after) await this._notifyRecipient(senderId, after, message);
    return { message, conversation: after };
  }

  /** The recipient hears about the FIRST message of an unread streak only. */
  async _notifyRecipient(senderId, conversation, message) {
    const recipientIsSeller = senderId === conversation.buyerId;
    const recipientId = recipientIsSeller ? conversation.sellerId : conversation.buyerId;
    const unread = recipientIsSeller ? conversation.sellerUnread : conversation.buyerUnread;
    if (unread !== 1 || !this.notifier) return;
    try {
      let from;
      if (recipientIsSeller) {
        const profiles = await this.repository.findProfiles([senderId]);
        from = buyerDisplayName(profiles.get(senderId));
      } else {
        const store = await this.repository.findStore(conversation.storeId);
        from = (store && store.name) || 'A boutique';
      }
      await this.notifier.create(recipientId, {
        type: 'message',
        tone: 'accent',
        title: `New message from ${from}`.slice(0, 255),
        body: conversation.lastMessagePreview || '',
        metadata: { kind: 'conversation', conversationId: conversation.id, messageId: message.id }
      });
    } catch (err) {
      // The message is stored either way; the badge and the inbox still show it.
      logger.warn(`[Messaging] recipient notification failed: ${err && err.message}`);
    }
  }

  async _resolveSubject(userId, kind, id) {
    if (kind === 'listingId') return this._fromListing(userId, id);
    if (kind === 'storeId') return this._fromStore(userId, id);
    return this._fromOrder(userId, id);
  }

  async _fromListing(userId, listingId) {
    const listing = await this.orderRepository.findListingById(listingId);
    if (!listing || listing.deletedAt || listing.status !== 'PUBLISHED'
      || (listing.visibility && listing.visibility !== 'PUBLIC')) {
      throw new NotFoundError('Listing');
    }
    // One conversation per store, answered by the store's owner — whoever listed
    // this particular product.
    const store = listing.storeId ? await this.repository.findStore(listing.storeId) : null;
    if (!store || store.deleted || !store.ownerId) {
      throw new ValidationError('This product has no boutique to message yet.');
    }
    if (store.status && CLOSED_STORE_STATUSES.has(store.status)) {
      throw new ValidationError(`${store.name || 'This boutique'} is not taking messages right now.`);
    }
    const image = listing.curated ? this.curatedCover(listing.id) : await this.repository.findListingCover(listing.id);
    return {
      buyerId: userId,
      sellerId: store.ownerId,
      storeId: store.id,
      card: {
        kind: 'product',
        key: 'listingId',
        metadata: {
          listingId: listing.id,
          title: String(listing.title || '').slice(0, 200),
          priceXaf: payablePrice(listing),
          image: image || null
        }
      }
    };
  }

  async _fromStore(userId, storeId) {
    const store = await this.repository.findStore(storeId);
    if (!store || store.deleted || !store.ownerId) throw new NotFoundError('Store');
    if (store.status && CLOSED_STORE_STATUSES.has(store.status)) {
      throw new ValidationError(`${store.name || 'This boutique'} is not taking messages right now.`);
    }
    return { buyerId: userId, sellerId: store.ownerId, storeId: store.id, card: null };
  }

  async _fromOrder(userId, orderId) {
    const order = await this.orderRepository.findOrderById(orderId);
    // Only the two parties to the order may open a conversation about it.
    if (!order || (order.buyerId !== userId && order.sellerId !== userId)) throw new NotFoundError('Order');
    const items = Array.isArray(order.items) ? order.items : [];
    let store = null;
    const storeId = (items.find((it) => it && it.storeId) || {}).storeId || null;
    if (storeId) store = await this.repository.findStore(storeId);
    if (!store || store.ownerId !== order.sellerId) store = await this.repository.findStoreByOwner(order.sellerId);
    if (!store || store.deleted) {
      throw new ValidationError('The boutique for this order cannot be messaged in the app.');
    }
    const first = items[0] || {};
    return {
      buyerId: order.buyerId,
      sellerId: store.ownerId,
      storeId: store.id,
      card: {
        kind: 'order',
        key: 'orderId',
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber || null,
          title: String(first.title || '').slice(0, 200),
          itemCount: items.reduce((n, it) => n + (Number(it.quantity) || 1), 0),
          totalXaf: Number(order.totalAmountXaf) || 0,
          image: first.imageUrl || null
        }
      }
    };
  }

  async _views(conversations, viewerId) {
    if (!conversations.length) return [];
    const stores = await this.repository.findStores(conversations.map((c) => c.storeId));
    // A seller sees the buyer; a buyer sees the store and needs no profile.
    const buyerIds = conversations.filter((c) => c.sellerId === viewerId).map((c) => c.buyerId);
    const buyers = buyerIds.length ? await this.repository.findProfiles(buyerIds) : new Map();
    return conversations.map((c) => toConversationView(c, viewerId, {
      store: stores.get(c.storeId) || null,
      buyer: buyers.get(c.buyerId) || null
    }));
  }
}

let shared = null;

/** The production service, on the Supabase repository. */
function getSharedMessagingService() {
  if (!shared) {
    const { SupabaseMessagingRepository } = require('../infrastructure/MessagingRepository');
    shared = new MessagingService({ repository: new SupabaseMessagingRepository() });
  }
  return shared;
}

module.exports = { MessagingService, getSharedMessagingService, payablePrice };
