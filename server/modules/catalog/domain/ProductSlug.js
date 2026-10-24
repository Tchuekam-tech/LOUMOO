/**
 * LOUMOO Catalog Domain — product slugs
 * ---------------------------------------------------------------------------
 * The one place a curated product's URL slug is derived. A slug is
 *
 *     <whole words of the title, at most MAX_BASE_LENGTH characters>-<4 characters>
 *
 * for example  google-pixel-8-pro-128gb-unlocked-android-14-k3x9  — the shape the
 * hand-published listings already have (Listing.generateSlug: words, then four
 * lowercase letters/digits), but DERIVED instead of drawn at random:
 *
 *   - Deterministic and idempotent. The suffix is a hash of the product's IMMUTABLE
 *     id, so the same product gets the same slug on every run, machine and rebuild,
 *     and nothing about any OTHER product can change it.
 *   - Cut on a word boundary, never inside a word. The old generator
 *     (scripts/repopulate_full_catalog.py clean_slug) cut at 45 characters, which left
 *     "..._128gb_unlocke", "..._256gb_tit" and "..._512gb_j" in the sitemap.
 *   - No counter. Two products whose titles share their first words are told apart by
 *     the suffix, not by appending "_2", "_3" ... "_26" to whichever was generated first
 *     (that scheme minted a new URL every time the catalogue was rebuilt in a different
 *     order, and put 26 copies of one phone in the sitemap).
 *
 * The suffix space is 36^4 (1,679,616), so two products can only collide when they also
 * share every word of their truncated title; tests/unit/product_slug.test.js proves the
 * whole seed catalogue is collision-free, and CuratedUrls refuses to serve a duplicate.
 *
 * scripts/catalog_slug.py is the same algorithm for the Python catalogue generators; the
 * test runs both over the catalogue and compares.
 */
'use strict';

const crypto = require('crypto');

const MAX_BASE_LENGTH = 56;
const SUFFIX_LENGTH = 4;
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const SUFFIX_SPACE = Math.pow(ALPHABET.length, SUFFIX_LENGTH);
const FALLBACK_BASE = 'product';

// The shape of every slug this module makes (and of the hand-published ones).
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-z]{4}$/;

// "(#11)", "(Configuration Pro #11)", "(Modèle Créateur #7)" at the END of a title: a counter the
// catalogue generators add to the titles of a repeated item so each looks unique. It says nothing
// about the product, so it is neither part of its slug nor of what makes two products "the same".
const COUNTER_MARKER = /\s*\([^()]*#\d+\)\s*$/;

// Letters NFKD does not decompose.
const LIGATURES = { 'œ': 'oe', 'æ': 'ae', 'ß': 'ss' };

/** The title without its trailing generator counter. */
function stripCounterMarker(title) {
  return String(title == null ? '' : title).replace(COUNTER_MARKER, '').trim();
}

/**
 * The words of a text, each already written the way it appears in a slug. A word is what the
 * text separates with whitespace, so "Slip-On" and "13.6" are one word each ("slip-on", "13-6")
 * and a slug cuts between them, never inside. Accents fold ("Élastique" -> "elastique"),
 * apostrophes vanish without splitting ("d'Aluminium" -> "daluminium"), and a word with no
 * letter or digit in it ("/", "&") is dropped.
 */
function toWords(text) {
  const folded = String(text == null ? '' : text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[œæß]/g, (c) => LIGATURES[c])
    .replace(/['’]/g, '');
  const words = [];
  for (const part of folded.split(/\s+/)) {
    const pieces = part.match(/[a-z0-9]+/g);
    if (pieces) words.push(pieces.join('-'));
  }
  return words;
}

/**
 * Join whole words with '-' while the result stays within `max` characters. The first word is
 * always kept, even when it alone is longer than `max`: a slug never ends mid-word.
 */
function truncateOnWordBoundary(words, max) {
  const kept = [];
  let length = 0;
  for (const word of words) {
    const next = length + (kept.length ? 1 : 0) + word.length;
    if (kept.length && next > max) break;
    kept.push(word);
    length = next;
  }
  return kept.join('-');
}

/**
 * Four lowercase letters/digits derived from the immutable id: the first 32 bits of its SHA-256,
 * written in base 36. Same id, same suffix, always.
 */
function stableSuffix(immutableId) {
  const id = String(immutableId == null ? '' : immutableId);
  if (!id) throw new TypeError('a slug suffix needs the product\'s immutable id');
  let n = crypto.createHash('sha256').update(id, 'utf8').digest().readUInt32BE(0) % SUFFIX_SPACE;
  let out = '';
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    out = ALPHABET[n % ALPHABET.length] + out;
    n = Math.floor(n / ALPHABET.length);
  }
  return out;
}

/** The title part of the slug (no suffix). */
function baseOf(title) {
  return truncateOnWordBoundary(toWords(stripCounterMarker(title)), MAX_BASE_LENGTH) || FALLBACK_BASE;
}

/**
 * The slug of a product: its title's whole words, then the suffix of its immutable id.
 * @param {string} title
 * @param {string} immutableId  the id the product is stored and ordered under; never the slug
 */
function productSlug(title, immutableId) {
  return `${baseOf(title)}-${stableSuffix(immutableId)}`;
}

function isProductSlug(value) {
  return typeof value === 'string' && value.length <= 128 && SLUG_PATTERN.test(value);
}

module.exports = {
  MAX_BASE_LENGTH,
  SUFFIX_LENGTH,
  SLUG_PATTERN,
  stripCounterMarker,
  toWords,
  truncateOnWordBoundary,
  stableSuffix,
  baseOf,
  productSlug,
  isProductSlug
};
