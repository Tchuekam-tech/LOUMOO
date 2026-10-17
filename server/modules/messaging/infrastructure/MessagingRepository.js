/**
 * LOUMOO Messaging — persistence
 * ---------------------------------------------------------------------------
 * Two implementations of one interface:
 *
 *   SupabaseMessagingRepository   iam.conversations / iam.messages (migration 021)
 *   InMemoryMessagingRepository   tests and the UI harness; mirrors the trigger
 *
 * Unlike the notification feed, messaging has NO silent in-memory fallback. A
 * message that only lived in one serverless instance's memory would be a message
 * the other side never receives while the sender sees it as sent. A database
 * failure is therefore an error the client shows ("not sent, tap to retry"), and
 * a missing table is a 503 that says messaging is not set up yet.
 */
'use strict';

const crypto = require('crypto');
const { SupabaseClient } = require('../../../infrastructure/database/SupabaseClient');
const { InfrastructureError, ServiceUnavailableError } = require('../../../shared/errors/AppError');
const { applyInsert, toMicros } = require('../domain/Conversation');

const byLatest = (a, b) => (toMicros(b.lastMessageAt) || 0) - (toMicros(a.lastMessageAt) || 0);

const CONVERSATION_COLUMNS = 'id, buyer_id, seller_id, store_id, last_message_at, last_message_preview, '
  + 'last_message_kind, last_sender_id, buyer_unread, seller_unread, buyer_last_read_at, seller_last_read_at, created_at';
const MESSAGE_COLUMNS = 'id, seq, conversation_id, sender_id, kind, body, metadata, client_id, created_at';
const STORE_COLUMNS = 'id, owner_id, name, slug, status, logo_url, is_verified, phone_number, metadata, deleted_at';

const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205', 'PGRST106']);

function fail(error, context) {
  if (error && MISSING_TABLE_CODES.has(error.code)) {
    throw new ServiceUnavailableError('In-app messaging is not available yet. Please try again later.');
  }
  throw new InfrastructureError('Messaging', context, error);
}

function mapConversation(r) {
  if (!r) return null;
  return {
    id: r.id,
    buyerId: r.buyer_id,
    sellerId: r.seller_id,
    storeId: r.store_id,
    lastMessageAt: r.last_message_at || null,
    lastMessagePreview: r.last_message_preview || '',
    lastMessageKind: r.last_message_kind || null,
    lastSenderId: r.last_sender_id || null,
    buyerUnread: Number(r.buyer_unread) || 0,
    sellerUnread: Number(r.seller_unread) || 0,
    buyerLastReadAt: r.buyer_last_read_at || null,
    sellerLastReadAt: r.seller_last_read_at || null,
    createdAt: r.created_at || null
  };
}

function mapMessage(r) {
  if (!r) return null;
  return {
    id: r.id,
    seq: Number(r.seq),
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    kind: r.kind,
    body: r.body || '',
    metadata: r.metadata || {},
    clientId: r.client_id || null,
    createdAt: r.created_at
  };
}

function mapStore(r) {
  if (!r) return null;
  const meta = r.metadata || {};
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    slug: r.slug || null,
    status: r.status || null,
    logoUrl: r.logo_url || null,
    isVerified: Boolean(r.is_verified),
    phone: r.phone_number || meta.phone || null,
    deleted: Boolean(r.deleted_at)
  };
}

function mapProfile(r) {
  if (!r) return null;
  return {
    id: r.id,
    firstName: r.first_name || '',
    lastName: r.last_name || '',
    avatarUrl: r.avatar_url || null
  };
}

class SupabaseMessagingRepository {
  constructor({ db } = {}) {
    this._db = db || null;
  }

  get db() {
    if (!this._db) this._db = SupabaseClient.getAdmin();
    return this._db;
  }

  async findConversation(id) {
    const { data, error } = await this.db.from('conversations').select(CONVERSATION_COLUMNS).eq('id', id).maybeSingle();
    if (error) fail(error, 'findConversation');
    return mapConversation(data);
  }

  async findConversationByPair(buyerId, storeId) {
    const { data, error } = await this.db.from('conversations').select(CONVERSATION_COLUMNS)
      .eq('buyer_id', buyerId).eq('store_id', storeId).maybeSingle();
    if (error) fail(error, 'findConversationByPair');
    return mapConversation(data);
  }

  /** Creates the pair's conversation, or returns the one a concurrent request just created. */
  async createConversation({ buyerId, sellerId, storeId }) {
    const { data, error } = await this.db.from('conversations')
      .insert({ buyer_id: buyerId, seller_id: sellerId, store_id: storeId })
      .select(CONVERSATION_COLUMNS).single();
    if (error) {
      if (error.code === '23505') return this.findConversationByPair(buyerId, storeId);
      fail(error, 'createConversation');
    }
    return mapConversation(data);
  }

  async listConversations(userId, { role = 'all', limit = 50 } = {}) {
    const sides = role === 'buying' ? ['buyer_id'] : role === 'selling' ? ['seller_id'] : ['buyer_id', 'seller_id'];
    const lists = await Promise.all(sides.map(async (column) => {
      const { data, error } = await this.db.from('conversations').select(CONVERSATION_COLUMNS)
        .eq(column, userId)
        .not('last_message_at', 'is', null)
        .order('last_message_at', { ascending: false })
        .limit(limit);
      if (error) fail(error, 'listConversations');
      return (data || []).map(mapConversation);
    }));
    return lists.flat()
      .sort(byLatest)
      .slice(0, limit);
  }

  async insertMessage({ conversationId, senderId, kind, body, metadata, clientId }) {
    const row = {
      conversation_id: conversationId,
      sender_id: senderId,
      kind,
      body: body || '',
      metadata: metadata || {},
      client_id: clientId || null
    };
    const { data, error } = await this.db.from('messages').insert(row).select(MESSAGE_COLUMNS).single();
    if (error) {
      if (error.code === '23505' && clientId) {
        const { data: existing, error: readError } = await this.db.from('messages').select(MESSAGE_COLUMNS)
          .eq('conversation_id', conversationId).eq('sender_id', senderId).eq('client_id', clientId).maybeSingle();
        if (readError) fail(readError, 'insertMessage (retry lookup)');
        if (existing) return { message: mapMessage(existing), duplicate: true };
      }
      fail(error, 'insertMessage');
    }
    return { message: mapMessage(data), duplicate: false };
  }

  /** Messages in ascending order: the newest `limit`, or those after `afterSeq`. */
  async listMessages(conversationId, { afterSeq = null, beforeSeq = null, limit = 50 } = {}) {
    let query = this.db.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id', conversationId);
    if (afterSeq != null) {
      const { data, error } = await query.gt('seq', afterSeq).order('seq', { ascending: true }).limit(limit);
      if (error) fail(error, 'listMessages');
      return (data || []).map(mapMessage);
    }
    if (beforeSeq != null) query = query.lt('seq', beforeSeq);
    const { data, error } = await query.order('seq', { ascending: false }).limit(limit);
    if (error) fail(error, 'listMessages');
    return (data || []).map(mapMessage).reverse();
  }

  async findLatestCard(conversationId) {
    const { data, error } = await this.db.from('messages').select(MESSAGE_COLUMNS)
      .eq('conversation_id', conversationId).in('kind', ['product', 'order'])
      .order('seq', { ascending: false }).limit(1);
    if (error) fail(error, 'findLatestCard');
    return mapMessage((data || [])[0]);
  }

  async markRead(conversationId, role) {
    const patch = role === 'buyer'
      ? { buyer_unread: 0, buyer_last_read_at: new Date().toISOString() }
      : { seller_unread: 0, seller_last_read_at: new Date().toISOString() };
    const { data, error } = await this.db.from('conversations').update(patch).eq('id', conversationId)
      .select(CONVERSATION_COLUMNS).maybeSingle();
    if (error) fail(error, 'markRead');
    return mapConversation(data);
  }

  async unreadTotal(userId) {
    const [asBuyer, asSeller] = await Promise.all([
      this.db.from('conversations').select('buyer_unread').eq('buyer_id', userId).gt('buyer_unread', 0),
      this.db.from('conversations').select('seller_unread').eq('seller_id', userId).gt('seller_unread', 0)
    ]);
    if (asBuyer.error) fail(asBuyer.error, 'unreadTotal');
    if (asSeller.error) fail(asSeller.error, 'unreadTotal');
    const sum = (rows, key) => (rows || []).reduce((n, r) => n + (Number(r[key]) || 0), 0);
    const messages = sum(asBuyer.data, 'buyer_unread') + sum(asSeller.data, 'seller_unread');
    const conversations = (asBuyer.data || []).length + (asSeller.data || []).length;
    return { messages, conversations };
  }

  async findStore(storeId) {
    const { data, error } = await this.db.from('stores').select(STORE_COLUMNS).eq('id', storeId).maybeSingle();
    if (error) fail(error, 'findStore');
    return mapStore(data);
  }

  async findStoreByOwner(ownerId) {
    const { data, error } = await this.db.from('stores').select(STORE_COLUMNS)
      .eq('owner_id', ownerId).is('deleted_at', null).order('created_at', { ascending: true }).limit(1);
    if (error) fail(error, 'findStoreByOwner');
    return mapStore((data || [])[0]);
  }

  async findStores(ids) {
    const unique = Array.from(new Set((ids || []).filter(Boolean)));
    if (!unique.length) return new Map();
    const { data, error } = await this.db.from('stores').select(STORE_COLUMNS).in('id', unique);
    if (error) fail(error, 'findStores');
    return new Map((data || []).map((r) => [r.id, mapStore(r)]));
  }

  async findProfiles(ids) {
    const unique = Array.from(new Set((ids || []).filter(Boolean)));
    if (!unique.length) return new Map();
    const { data, error } = await this.db.from('profiles').select('id, first_name, last_name, avatar_url').in('id', unique);
    if (error) fail(error, 'findProfiles');
    return new Map((data || []).map((r) => [r.id, mapProfile(r)]));
  }

  /** The cover picture of a marketplace listing, or null. Display only. */
  async findListingCover(listingId) {
    const { data, error } = await this.db.from('listing_media').select('url, thumbnail_url, is_cover, display_order')
      .eq('listing_id', listingId).eq('media_type', 'IMAGE')
      .order('is_cover', { ascending: false }).order('display_order', { ascending: true }).limit(1);
    if (error) return null; // a missing picture never blocks a conversation
    const row = (data || [])[0];
    return row ? row.thumbnail_url || row.url || null : null;
  }
}

/**
 * Same interface, kept in memory. Used by the tests and by the UI harness; never
 * selected implicitly in production (see MessagingService.getShared).
 */
class InMemoryMessagingRepository {
  constructor({ stores = [], profiles = [], listingCovers = {}, now = () => new Date() } = {}) {
    this._now = now;
    this.conversations = new Map();
    this.messages = [];
    this._seq = 0;
    this.stores = new Map(stores.map((s) => [s.id, Object.assign({ status: 'ACTIVE', deleted: false }, s)]));
    this.profiles = new Map(profiles.map((p) => [p.id, p]));
    this.listingCovers = Object.assign({}, listingCovers);
  }

  _stamp() {
    // Strictly increasing, like clock_timestamp() across successive inserts.
    let t = this._now().getTime();
    if (this._lastStamp != null && t <= this._lastStamp) t = this._lastStamp + 1;
    this._lastStamp = t;
    return new Date(t).toISOString();
  }

  async findConversation(id) {
    const c = this.conversations.get(id);
    return c ? Object.assign({}, c) : null;
  }

  async findConversationByPair(buyerId, storeId) {
    for (const c of this.conversations.values()) {
      if (c.buyerId === buyerId && c.storeId === storeId) return Object.assign({}, c);
    }
    return null;
  }

  async createConversation({ buyerId, sellerId, storeId }) {
    if (buyerId === sellerId) throw new InfrastructureError('Messaging', 'createConversation', new Error('conversations_not_self'));
    const existing = await this.findConversationByPair(buyerId, storeId);
    if (existing) return existing;
    const c = {
      id: 'conv_' + crypto.randomBytes(6).toString('hex'),
      buyerId,
      sellerId,
      storeId,
      lastMessageAt: null,
      lastMessagePreview: '',
      lastMessageKind: null,
      lastSenderId: null,
      buyerUnread: 0,
      sellerUnread: 0,
      buyerLastReadAt: null,
      sellerLastReadAt: null,
      createdAt: this._stamp()
    };
    this.conversations.set(c.id, c);
    return Object.assign({}, c);
  }

  async listConversations(userId, { role = 'all', limit = 50 } = {}) {
    return Array.from(this.conversations.values())
      .filter((c) => c.lastMessageAt)
      .filter((c) => (role !== 'selling' && c.buyerId === userId) || (role !== 'buying' && c.sellerId === userId))
      .sort(byLatest)
      .slice(0, limit)
      .map((c) => Object.assign({}, c));
  }

  async insertMessage({ conversationId, senderId, kind, body, metadata, clientId }) {
    if (clientId) {
      const dup = this.messages.find((m) => m.conversationId === conversationId && m.senderId === senderId && m.clientId === clientId);
      if (dup) return { message: Object.assign({}, dup), duplicate: true };
    }
    const conversation = this.conversations.get(conversationId);
    if (!conversation) throw new InfrastructureError('Messaging', 'insertMessage', new Error('foreign key violation'));
    const message = {
      id: 'msg_' + crypto.randomBytes(6).toString('hex'),
      seq: ++this._seq,
      conversationId,
      senderId,
      kind,
      body: body || '',
      metadata: metadata || {},
      clientId: clientId || null,
      createdAt: this._stamp()
    };
    this.messages.push(message);
    this.conversations.set(conversationId, applyInsert(conversation, message));
    return { message: Object.assign({}, message), duplicate: false };
  }

  async listMessages(conversationId, { afterSeq = null, beforeSeq = null, limit = 50 } = {}) {
    const all = this.messages.filter((m) => m.conversationId === conversationId);
    if (afterSeq != null) return all.filter((m) => m.seq > afterSeq).slice(0, limit).map((m) => Object.assign({}, m));
    const older = beforeSeq != null ? all.filter((m) => m.seq < beforeSeq) : all;
    return older.slice(-limit).map((m) => Object.assign({}, m));
  }

  async findLatestCard(conversationId) {
    const cards = this.messages.filter((m) => m.conversationId === conversationId && (m.kind === 'product' || m.kind === 'order'));
    const last = cards[cards.length - 1];
    return last ? Object.assign({}, last) : null;
  }

  async markRead(conversationId, role) {
    const c = this.conversations.get(conversationId);
    if (!c) return null;
    const stamp = this._stamp();
    if (role === 'buyer') Object.assign(c, { buyerUnread: 0, buyerLastReadAt: stamp });
    else Object.assign(c, { sellerUnread: 0, sellerLastReadAt: stamp });
    return Object.assign({}, c);
  }

  async unreadTotal(userId) {
    let messages = 0;
    let conversations = 0;
    for (const c of this.conversations.values()) {
      const n = (c.buyerId === userId ? c.buyerUnread : 0) + (c.sellerId === userId ? c.sellerUnread : 0);
      if (n > 0) { messages += n; conversations += 1; }
    }
    return { messages, conversations };
  }

  async findStore(storeId) {
    const s = this.stores.get(storeId);
    return s ? Object.assign({}, s) : null;
  }

  async findStoreByOwner(ownerId) {
    for (const s of this.stores.values()) if (s.ownerId === ownerId && !s.deleted) return Object.assign({}, s);
    return null;
  }

  async findStores(ids) {
    const out = new Map();
    for (const id of ids || []) if (this.stores.has(id)) out.set(id, Object.assign({}, this.stores.get(id)));
    return out;
  }

  async findProfiles(ids) {
    const out = new Map();
    for (const id of ids || []) if (this.profiles.has(id)) out.set(id, Object.assign({}, this.profiles.get(id)));
    return out;
  }

  async findListingCover(listingId) {
    return this.listingCovers[listingId] || null;
  }
}

module.exports = { SupabaseMessagingRepository, InMemoryMessagingRepository, mapConversation, mapMessage };
