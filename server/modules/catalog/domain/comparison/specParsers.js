/**
 * Spec parsers — free text (French and English) to typed, unit-normalised values.
 *
 * The curated catalogue stores specifications as prose ("5100 mAh Charge Rapide",
 * "Jusqu'à 18h d'utilisation continue", "Intel Core i7-1255U · 16GB LPDDR5x ·
 * 512GB SSD"). Every parser here is pure, never invents a value and returns null
 * when the text does not say. Callers attach provenance and confidence.
 */

// "1.035.000", "1 035 000", "13,6", "13.6" → Number. Dots or spaces followed by
// exactly three digits are thousands separators; a lone comma is a decimal mark.
function parseNumberFr(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim().replace(/[  ]/g, ' ');
  if (!s) return null;
  if (/^\d{1,3}([. ]\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/[. ]/g, '').replace(',', '.');
  } else {
    s = s.replace(/\s+/g, '').replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const NUM = '(\\d+(?:[.,]\\d+)?)';

function firstMatch(text, regex, map = (m) => parseNumberFr(m[1])) {
  if (!text) return null;
  const m = String(text).match(regex);
  if (!m) return null;
  const v = map(m);
  return v === null || v === undefined || Number.isNaN(v) ? null : v;
}

function maxMatch(text, regex, map = (m) => parseNumberFr(m[1])) {
  if (!text) return null;
  let best = null;
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  for (const m of String(text).matchAll(re)) {
    const v = map(m);
    if (v !== null && Number.isFinite(v) && (best === null || v > best)) best = v;
  }
  return best;
}

/* ── Memory and storage ─────────────────────────────────────────────────── */

const RAM_CUES = /\b(ram|lpddr\d*x?|ddr\d|m[ée]moire|unifi[ée]e|unified)\b/i;
const STORAGE_CUES = /\b(ssd|ufs|rom|stockage|storage|emmc|nvme|disque)\b/i;
const VRAM_CUES = /\b(rtx|gtx|gpu|vram|radeon|arc)\b/i;

// Splits a spec string into the chunks a human would read as one fact.
function segments(text) {
  return String(text || '')
    .split(/[·•|,;()+]|\s\/\s|\/(?=\s*\d)/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Pulls RAM and storage (both in GB) out of a spec or title string.
 * "12GB LPDDR5X · 128GB UFS 3.1" → { ramGb: 12, storageGb: 128 }
 * "RTX 4060 8GB" is graphics memory and is ignored.
 * Bare capacities are classified by size: ≥ 64 GB storage, ≤ 24 GB RAM;
 * those carry `inferred: true` so the caller can lower confidence.
 */
function parseMemory(text) {
  const out = { ramGb: null, storageGb: null, inferred: { ramGb: false, storageGb: false } };
  for (const seg of segments(text)) {
    const re = /(\d+(?:[.,]\d+)?)\s*(TB|To|GB|Go)\b/gi;
    for (const m of seg.matchAll(re)) {
      const n = parseNumberFr(m[1]);
      if (n === null) continue;
      const gb = /^t/i.test(m[2]) ? n * 1024 : n;
      // Look only at the words around this number, not the whole segment.
      const after = seg.slice(m.index + m[0].length, m.index + m[0].length + 18);
      const before = seg.slice(Math.max(0, m.index - 12), m.index);
      const ctx = before + ' ' + after;
      if (VRAM_CUES.test(before) || /^\s*(gddr|vram)/i.test(after)) continue;
      if (RAM_CUES.test(ctx)) {
        if (out.ramGb === null) out.ramGb = gb;
      } else if (STORAGE_CUES.test(ctx)) {
        if (out.storageGb === null) out.storageGb = gb;
      } else if (gb >= 64) {
        if (out.storageGb === null) { out.storageGb = gb; out.inferred.storageGb = true; }
      } else if (gb <= 24 && gb >= 2) {
        if (out.ramGb === null) { out.ramGb = gb; out.inferred.ramGb = true; }
      }
    }
  }
  return out;
}

/* ── Power, battery, charging ───────────────────────────────────────────── */

// "5100 mAh", "30 000 mAh", "30000mAh"
function parseMah(text) {
  return maxMatch(text, /(\d{1,3}(?:[ . ]\d{3})+|\d+)\s*mAh\b/i);
}

function parseWh(text) {
  return firstMatch(text, new RegExp(NUM + '\\s*Wh\\b', 'i'));
}

// Highest wattage mentioned ("120W HyperCharge", "Chargeur 140W", "60W RMS").
function parseWatts(text) {
  return maxMatch(text, /(\d+(?:[.,]\d+)?)\s*W\b(?!h)/i);
}

// "60W RMS" — continuous audio output power.
function parseRmsWatts(text) {
  return maxMatch(text, /(\d+(?:[.,]\d+)?)\s*W\s*RMS\b/i);
}

// Battery life in hours: "Jusqu'à 18h", "18 heures", "40h de batterie", "35h avec boîtier".
function parseHours(text) {
  return maxMatch(text, /(\d+(?:[.,]\d+)?)\s*(?:h\b|heures?\b|hours?\b|hrs?\b)/i);
}

// Duration in minutes ("Batterie Li-ion 90 min").
function parseMinutes(text) {
  return firstMatch(text, /(\d+)\s*min\b/i);
}

/* ── Display ────────────────────────────────────────────────────────────── */

// Highest refresh rate: "1-144Hz variable" → 144.
function parseRefreshHz(text) {
  return maxMatch(text, /(\d{2,3})\s*Hz\b/i);
}

// Screen diagonal: 13.6 pouces, 6.78", 15.3-inch.
function parseInches(text) {
  return firstMatch(text, /(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:pouces?|inch(?:es)?|"|''|”|-inch)/i);
}

function parseNits(text) {
  return maxMatch(text, /(\d{3,4})\s*nits?\b/i);
}

/* ── Camera ─────────────────────────────────────────────────────────────── */

function parseMegapixels(text) {
  return maxMatch(text, /(\d{1,3})\s*MP\b/i);
}

function parseOpticalZoom(text) {
  return maxMatch(text, /(\d{1,3})\s*x\s*(?:optique|optical|p[ée]riscope)?/i, (m) => {
    const n = parseNumberFr(m[1]);
    return n !== null && n <= 15 ? n : null; // "100x Space Zoom" is digital.
  });
}

/* ── Physical ───────────────────────────────────────────────────────────── */

function parseKg(text) {
  const kg = firstMatch(text, new RegExp(NUM + '\\s*kg\\b', 'i'));
  if (kg !== null) return kg;
  const g = firstMatch(text, /(\d{2,4})\s*g\b/i);
  return g !== null ? g / 1000 : null;
}

// Warranty in months: "24 Mois", "2 ans", "12 Months".
function parseWarrantyMonths(text) {
  const months = firstMatch(text, /(\d{1,2})\s*(?:mois|months?)\b/i);
  if (months !== null) return months;
  const years = firstMatch(text, /(\d)\s*(?:ans?|years?)\b/i);
  return years !== null ? years * 12 : null;
}

// IP67 / IPX8 → water protection digit (the second character).
function parseIpWater(text) {
  return firstMatch(text, /\bIP([0-6X])([0-9])\b/i, (m) => Number(m[2]));
}

function parseBluetoothVersion(text) {
  return firstMatch(text, /bluetooth\s*(\d(?:[.,]\d)?)/i);
}

// Driver diameter in mm: "Transducteurs dynamiques 40mm", "Diaphragmes graphène 11mm".
function parseDriverMm(text) {
  return firstMatch(text, /(\d{1,2})\s*mm\b/i);
}

// "Portée 250m", "jusqu'à 20 mètres".
function parseRangeMeters(text) {
  return firstMatch(text, /(\d{1,4})\s*(?:m|m[èe]tres?|meters?)\b/i);
}

// Number of pieces in a set: "Set 12 pièces", "Service 24 pcs".
function parsePieces(text) {
  return firstMatch(text, /(\d{1,3})\s*(?:pi[èe]ces?|pcs|pieces?|couverts)\b/i);
}

function parseLitres(text) {
  return firstMatch(text, new RegExp(NUM + '\\s*(?:L|litres?|liters?)\\b', 'i'));
}

function parseMillilitres(text) {
  return firstMatch(text, /(\d{2,4})\s*ml\b/i);
}

// "Water resistant 50m", "Étanche 5 ATM" → metres of water resistance.
function parseWaterResistanceM(text) {
  const atm = firstMatch(text, /(\d{1,3})\s*ATM\b/i);
  if (atm !== null) return atm * 10;
  return firstMatch(text, /(?:[ée]tanch\w*|water\s*resist\w*)[^0-9]{0,20}(\d{2,3})\s*m\b/i);
}

/* ── Sizes (fashion) ────────────────────────────────────────────────────── */

// "Du 38 au 45", "38-45", "39 40 41 42" → { min, max, count }
function parseShoeSizes(text) {
  if (!text) return null;
  const nums = Array.from(String(text).matchAll(/\b(3[0-9]|4[0-9]|50)\b/g)).map(m => Number(m[1]));
  if (!nums.length) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const isRange = /(?:au|à|-|–|to)\s*(?:3[0-9]|4[0-9]|50)\b/i.test(text) && nums.length === 2;
  const count = isRange ? (max - min + 1) : new Set(nums).size;
  return { min, max, count };
}

// "XS au XXL", "S, M, L, XL" → number of letter sizes covered.
const LETTER_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
function parseLetterSizeCount(text) {
  if (!text) return null;
  const found = Array.from(String(text).toUpperCase().matchAll(/\b(XXS|XS|S|M|L|XL|XXL|XXXL|3XL|4XL|5XL)\b/g))
    .map(m => (m[1] === 'XXXL' ? '3XL' : m[1]));
  if (!found.length) return null;
  const idx = found.map(s => LETTER_SIZES.indexOf(s)).filter(i => i >= 0);
  if (!idx.length) return null;
  const isRange = /\b(?:au|à|to|-|–)\b/i.test(text) && idx.length === 2;
  return isRange ? Math.max(...idx) - Math.min(...idx) + 1 : new Set(idx).size;
}

/* ── Booleans ───────────────────────────────────────────────────────────── */

function mentions(text, regex) {
  return Boolean(text) && regex.test(String(text));
}

const hasAnc = (t) => mentions(t, /\b(ANC|r[ée]duction (?:active )?(?:du |de )?bruit|noise cancel)/i);
const has5g = (t) => mentions(t, /\b5G\b/);
const hasWirelessCharging = (t) => mentions(t, /\b(sans fil qi|qi wireless|wireless charging|magsafe|charge sans fil)\b/i);
const hasDedicatedGpu = (t) => mentions(t, /\b(RTX|GTX|Radeon RX|Arc A\d)/i);

module.exports = {
  parseNumberFr,
  parseMemory,
  parseMah,
  parseWh,
  parseWatts,
  parseRmsWatts,
  parseHours,
  parseMinutes,
  parseRefreshHz,
  parseInches,
  parseNits,
  parseMegapixels,
  parseOpticalZoom,
  parseKg,
  parseWarrantyMonths,
  parseIpWater,
  parseBluetoothVersion,
  parseDriverMm,
  parseRangeMeters,
  parsePieces,
  parseLitres,
  parseMillilitres,
  parseWaterResistanceM,
  parseShoeSizes,
  parseLetterSizeCount,
  hasAnc,
  has5g,
  hasWirelessCharging,
  hasDedicatedGpu,
  _segments: segments
};
