/**
 * LOUMOO Delivery — Handover code
 * ---------------------------------------------------------------------------
 * The 4-digit code the buyer reads out to the rider to prove the parcel reached
 * the right person.
 *
 * It is DERIVED, not stored: HMAC-SHA256(key, "<deliveryId>|<nonce>") reduced to
 * four digits. The database holds only the nonce, so a dump of the deliveries
 * table reveals no live code, and re-assigning a failed delivery bumps the nonce
 * so the old code dies with it.
 *
 * Four digits are guessable, so the guess budget is the real defence: the
 * service allows MAX_HANDOVER_ATTEMPTS wrong codes per delivery, then locks it.
 *
 * Key: HKDF from SUPABASE_JWT_SECRET, the same root secret the identity module
 * already derives its keys from (see OtpSecurity). There is no fallback; with no
 * secret the code is unavailable and the caller fails loudly.
 */

'use strict';

const crypto = require('crypto');
const config = require('../../../config/env');

const HKDF_SALT = Buffer.from('loumoo.delivery.handover.v1');
const HKDF_INFO = Buffer.from('handover-code-key');
const DIGITS = 4;

function key() {
  const secret = config.supabase.jwtSecret;
  if (!secret) {
    throw new Error('Delivery handover codes are unavailable: SUPABASE_JWT_SECRET is not configured.');
  }
  return Buffer.from(crypto.hkdfSync('sha256', secret, HKDF_SALT, HKDF_INFO, 32));
}

function codeFor(deliveryId, nonce) {
  if (!deliveryId) throw new Error('codeFor requires a delivery id');
  const mac = crypto.createHmac('sha256', key()).update(`${deliveryId}|${Number(nonce) || 0}`).digest();
  // 32 bits reduced mod 10^4: the bias (2^32 mod 10^4 = 7296) is ~0.00017
  // relative, far below anything a 5-guess budget can exploit.
  return String(mac.readUInt32BE(0) % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** Constant-time comparison of a candidate against the derived code. */
function verifyCode(candidate, deliveryId, nonce) {
  const expected = Buffer.from(codeFor(deliveryId, nonce), 'utf8');
  const given = Buffer.from(String(candidate == null ? '' : candidate).trim(), 'utf8');
  if (given.length !== expected.length) {
    crypto.timingSafeEqual(expected, expected);
    return false;
  }
  return crypto.timingSafeEqual(expected, given);
}

module.exports = { codeFor, verifyCode, HANDOVER_CODE_DIGITS: DIGITS };
