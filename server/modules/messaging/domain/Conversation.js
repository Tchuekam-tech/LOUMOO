/**
 * LOUMOO Messaging Domain — conversations between a buyer and a boutique
 * ---------------------------------------------------------------------------
 * Pure rules, no I/O. One conversation per (buyer, store) pair; its seller is
 * the store's owner, always derived server-side. A message is one of:
 *
 *   text     what someone typed
 *   product  a card for the listing the conversation was (re)opened about
 *   order    a card for the order the conversation was opened from
 *
 * Unread counters and the inbox preview are kept by a database trigger
 * (migration 021). `applyInsert` is the same rule in JavaScript, for the
 * in-memory repository, and the migration test pins the two together.
 */
'use strict';

const { ValidationError } = require('../../../shared/errors/AppError');

const MAX_BODY = 2000;
const PREVIEW_LENGTH = 160;
const MESSAGE_KINDS = Object.freeze(['text', 'product', 'order']);
const ROLES = Object.freeze({ BUYER: 'buyer', SELLER: 'seller' });

// C0 controls other than tab and newline, DEL, and the bidi overrides that can
// make a message display differently from what was sent.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

/**
 * What someone typed, as it will be stored, or a ValidationError.
 * @param {*} raw
 * @returns {string}
 */
function normalizeBody(raw) {
  if (typeof raw !== 'string') throw new ValidationError('Write a message before sending.');
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(UNSAFE_CHARS, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) throw new ValidationError('Write a message before sending.');
  if (text.length > MAX_BODY) {
    throw new ValidationError(`Messages are limited to ${MAX_BODY} characters (this one has ${text.length}).`);
  }
  return text;
}

/** The sender's retry key for a message, or null when absent or malformed. */
function normalizeClientId(raw) {
  if (typeof raw !== 'string') return null;
  return /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : null;
}

/** 'buyer', 'seller' or null: the part `userId` plays in the conversation. */
function roleOf(conversation, userId) {
  if (!conversation || !userId) return null;
  if (conversation.buyerId === userId) return ROLES.BUYER;
  if (conversation.sellerId === userId) return ROLES.SELLER;
  return null;
}

/** The inbox preview line for a message (same rule as the SQL trigger). */
function previewOf(kind, body, metadata) {
  const meta = metadata || {};
  let text;
  if (kind === 'product') text = 'Product · ' + (meta.title || 'a listing');
  else if (kind === 'order') text = 'Order · ' + (meta.orderNumber || '');
  else text = String(body || '').replace(/\s+/g, ' ');
  return text.slice(0, PREVIEW_LENGTH);
}

/**
 * The conversation after `message` was inserted: preview, counters, the sender's
 * read mark. Mirrors iam.messages_after_insert().
 */
function applyInsert(conversation, message) {
  const c = Object.assign({}, conversation);
  const fromSeller = message.senderId === c.sellerId;
  const fromBuyer = message.senderId === c.buyerId;
  c.lastMessageAt = message.createdAt;
  c.lastMessageKind = message.kind;
  c.lastSenderId = message.senderId;
  c.lastMessagePreview = previewOf(message.kind, message.body, message.metadata);
  c.buyerUnread = fromSeller ? (c.buyerUnread || 0) + 1 : 0;
  c.sellerUnread = fromBuyer ? (c.sellerUnread || 0) + 1 : 0;
  if (fromBuyer) c.buyerLastReadAt = message.createdAt;
  if (fromSeller) c.sellerLastReadAt = message.createdAt;
  return c;
}

/** "Amina K." — a buyer as a seller sees them: first name and an initial, nothing else. */
function buyerDisplayName(profile) {
  const first = String((profile && profile.firstName) || '').trim();
  const last = String((profile && profile.lastName) || '').trim();
  if (!first && !last) return 'LOUMOO shopper';
  if (!first) return last.charAt(0).toUpperCase() + '.';
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

/**
 * Microseconds since the epoch for an ISO timestamp (or Date). Postgres keeps
 * microseconds and prints a variable number of fraction digits, so neither a
 * string compare nor Date.parse (milliseconds) is exact enough to say whether a
 * read mark covers a message.
 */
function toMicros(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.getTime() * 1000;
  const text = String(value);
  const m = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/.exec(text);
  if (!m) {
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms * 1000 : null;
  }
  const ms = Date.parse(m[1] + (m[3] || 'Z'));
  if (!Number.isFinite(ms)) return null;
  return ms * 1000 + Number(((m[2] || '') + '000000').slice(0, 6));
}

/** True when the read mark `readAt` covers something sent at `sentAt`. */
function hasRead(readAt, sentAt) {
  const r = toMicros(readAt);
  const s = toMicros(sentAt);
  return r != null && s != null && r >= s;
}

function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}

/**
 * A conversation as `viewerId` sees it in the inbox and in the thread header.
 * Only what the viewer may know about the other side leaves the server.
 */
function toConversationView(conversation, viewerId, { store = null, buyer = null } = {}) {
  const role = roleOf(conversation, viewerId);
  const storeName = (store && store.name) || 'LOUMOO boutique';
  const isBuyer = role === ROLES.BUYER;
  const title = isBuyer ? storeName : buyerDisplayName(buyer);
  const peerLastReadAt = isBuyer ? conversation.sellerLastReadAt : conversation.buyerLastReadAt;
  const lastFromMe = Boolean(conversation.lastSenderId) && conversation.lastSenderId === viewerId;
  return {
    id: conversation.id,
    role,
    title,
    initials: initialsOf(title),
    avatarUrl: isBuyer ? (store && store.logoUrl) || null : (buyer && buyer.avatarUrl) || null,
    verified: isBuyer ? Boolean(store && store.isVerified) : false,
    storeId: conversation.storeId,
    storeName,
    storeSlug: (store && store.slug) || null,
    // The boutique's public phone, for "continue on WhatsApp". A buyer's number is
    // never sent to the seller.
    storePhone: isBuyer ? (store && store.phone) || null : null,
    lastMessageAt: conversation.lastMessageAt || conversation.createdAt || null,
    lastMessagePreview: conversation.lastMessagePreview || '',
    lastMessageKind: conversation.lastMessageKind || null,
    lastFromMe,
    lastReadByPeer: lastFromMe && hasRead(peerLastReadAt, conversation.lastMessageAt),
    unread: isBuyer ? conversation.buyerUnread || 0 : conversation.sellerUnread || 0,
    peerLastReadAt: peerLastReadAt || null
  };
}

/** A message as `viewerId` sees it. */
function toMessageView(message, conversation, viewerId) {
  const mine = message.senderId === viewerId;
  const peerLastReadAt = roleOf(conversation, viewerId) === ROLES.BUYER
    ? conversation.sellerLastReadAt
    : conversation.buyerLastReadAt;
  return {
    id: message.id,
    seq: Number(message.seq),
    kind: message.kind,
    body: message.body || '',
    metadata: message.metadata || {},
    mine,
    clientId: mine ? message.clientId || null : null,
    createdAt: message.createdAt,
    status: mine ? (hasRead(peerLastReadAt, message.createdAt) ? 'read' : 'sent') : null
  };
}

module.exports = {
  MAX_BODY,
  MESSAGE_KINDS,
  ROLES,
  normalizeBody,
  normalizeClientId,
  roleOf,
  previewOf,
  applyInsert,
  buyerDisplayName,
  initialsOf,
  toMicros,
  hasRead,
  toConversationView,
  toMessageView
};
