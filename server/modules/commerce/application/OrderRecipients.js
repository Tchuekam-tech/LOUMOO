/**
 * LOUMOO Commerce Core — Order recipients
 * ---------------------------------------------------------------------------
 * Looks up the contact details an order message needs that the order itself does
 * not carry: where to e-mail the seller, and who the buyer is when their
 * shipping address left the name or phone empty.
 *
 * Both are best effort and read-only. A failed lookup answers null, never throws:
 * the message goes out with what the order already says, or the e-mail is skipped
 * and the in-app notification (the guaranteed channel) still reaches the seller.
 *
 * This is NOT identity matching. Every lookup is by an id the server already
 * holds (the order's seller, buyer and store); nothing here finds a user by e-mail.
 */
'use strict';

const { SupabaseDatabase } = require('../../../infrastructure/database/SupabaseClient');
const logger = require('../../../shared/logging/logger');

// Deliberately plain: one address, no display name, no quoting, no whitespace or
// control characters (so a stored value can never smuggle a header into the message).
const EMAIL_PATTERN = /^[^\s@<>",;:()[\]\\]+@[^\s@<>",;:()[\]\\]+\.[^\s@<>",;:()[\]\\]+$/;

function usableEmail(value) {
  const email = String(value == null ? '' : value).trim();
  return email.length > 0 && email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

class OrderRecipients {
  /**
   * @param {object} [options]
   * @param {object|null} [options.db] Supabase-style client; omit for the shared admin client.
   * @param {{findById: (id: string) => Promise<object|null>}} [options.profiles]
   *   Profile reader; omit for the identity ProfileRepository (the only reader of iam.profiles).
   */
  constructor(options = {}) {
    const opts = options || {};
    this._customDb = opts.db;
    this._profiles = opts.profiles || null;
  }

  get db() {
    if (this._customDb !== undefined) return this._customDb;
    try {
      return SupabaseDatabase.getAdmin();
    } catch {
      return null;
    }
  }

  get profiles() {
    return this._profiles || require('../../identity/infrastructure/ProfileRepository');
  }

  /**
   * Where to e-mail the seller about an order: the store's own address, else the
   * seller's profile address. Null when there is none, or when the store has
   * turned new-order e-mails off (iam.store_settings.notification_settings).
   * @returns {Promise<string|null>}
   */
  async sellerEmail({ sellerId, storeId } = {}) {
    try {
      const db = this.db;
      if (db && storeId) {
        const { data: settings } = await db
          .from('store_settings')
          .select('notification_settings')
          .eq('store_id', storeId)
          .maybeSingle();
        if (settings && settings.notification_settings && settings.notification_settings.new_order_email === false) {
          return null;
        }
        const { data: store } = await db.from('stores').select('email').eq('id', storeId).maybeSingle();
        const storeEmail = store ? usableEmail(store.email) : null;
        if (storeEmail) return storeEmail;
      }
      if (sellerId) {
        const profile = await this.profiles.findById(sellerId);
        return profile ? usableEmail(profile.email) : null;
      }
    } catch (err) {
      logger.warn(`[OrderRecipients] seller e-mail lookup failed (${err && (err.code || err.name) || 'error'})`);
    }
    return null;
  }

  /**
   * The buyer's name, phone and e-mail from their profile, to fill what the order's
   * shipping address left out.
   * @returns {Promise<{name: string|null, phone: string|null, email: string|null}|null>}
   */
  async buyerContact(buyerId) {
    if (!buyerId) return null;
    try {
      const profile = await this.profiles.findById(buyerId);
      if (!profile) return null;
      const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
      return {
        name: name || null,
        phone: profile.phone_number || null,
        email: usableEmail(profile.email)
      };
    } catch (err) {
      logger.warn(`[OrderRecipients] buyer contact lookup failed (${err && (err.code || err.name) || 'error'})`);
      return null;
    }
  }
}

module.exports = { OrderRecipients, usableEmail };
