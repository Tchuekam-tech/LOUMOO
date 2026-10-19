/**
 * Chip performance index.
 *
 * Maps a processor named in free text to an approximate multi-core performance
 * index so that "Tensor G3" and "Snapdragon 8 Gen 3" can be ranked by what they
 * do, not by their marketing name.
 *
 * BASIS: rounded public Geekbench 6 multi-core medians, as orders of magnitude.
 * They are good enough to say "clearly faster" (≥ 15 % apart) and are NOT precise
 * enough to quote as benchmark scores. Entries marked `estimated` are recent
 * chips whose figures were less settled when this table was written; they carry
 * lower confidence. Unknown chips return null — the engine never guesses.
 *
 * Patterns must match the chip name itself (no optional prefixes), because
 * lookupChip picks the chip mentioned earliest; at equal positions the earlier,
 * more specific entry wins ("M3 Pro" before "M3").
 */

const CHIP_INDEX_VERSION = '2026-10-17';

const CHIPS = [
  // Apple laptop silicon
  { id: 'apple-m3-pro', name: 'Apple M3 Pro', pattern: /\bM3\s*Pro\b/i, index: 13500, segment: 'laptop' },
  { id: 'apple-m3', name: 'Apple M3', pattern: /(?<!Titan\s)\bM3\b(?!\s*Pro)/i, index: 11700, segment: 'laptop' },
  { id: 'apple-m2', name: 'Apple M2', pattern: /(?<!Titan\s)\bM2\b/i, index: 9700, segment: 'laptop' },

  // Apple phone silicon
  { id: 'apple-a19-pro', name: 'Apple A19 Pro', pattern: /\bA19\s*Pro\b/i, index: 9800, segment: 'phone', estimated: true },
  { id: 'apple-a19', name: 'Apple A19', pattern: /\bA19\b/i, index: 9000, segment: 'phone', estimated: true },
  { id: 'apple-a18-pro', name: 'Apple A18 Pro', pattern: /\bA18\s*Pro\b/i, index: 8500, segment: 'phone' },
  { id: 'apple-a17-pro', name: 'Apple A17 Pro', pattern: /\bA17\s*Pro\b/i, index: 7200, segment: 'phone' },
  { id: 'apple-a16', name: 'Apple A16 Bionic', pattern: /\bA16\b/i, index: 6700, segment: 'phone' },

  // Qualcomm
  { id: 'sd-8-elite', name: 'Snapdragon 8 Elite', pattern: /\bSnapdragon\s*8\s*(?:Elite|Gen\s*4)\b/i, index: 9500, segment: 'phone' },
  { id: 'sd-8-gen-3', name: 'Snapdragon 8 Gen 3', pattern: /\bSnapdragon\s*8\s*Gen\s*3\b/i, index: 6800, segment: 'phone' },
  { id: 'sd-8-gen-2', name: 'Snapdragon 8 Gen 2', pattern: /\bSnapdragon\s*8\s*Gen\s*2\b/i, index: 5200, segment: 'phone' },
  { id: 'sd-8-gen-1', name: 'Snapdragon 8 Gen 1', pattern: /\bSnapdragon\s*8\+?\s*Gen\s*1\b/i, index: 4000, segment: 'phone' },
  { id: 'sd-7-gen-3', name: 'Snapdragon 7 Gen 3', pattern: /\bSnapdragon\s*7s?\s*Gen\s*3\b/i, index: 3200, segment: 'phone' },

  // Google
  { id: 'tensor-g5', name: 'Google Tensor G5', pattern: /\bTensor\s*G5\b/i, index: 6300, segment: 'phone', estimated: true },
  { id: 'tensor-g4', name: 'Google Tensor G4', pattern: /\bTensor\s*G4\b/i, index: 4600, segment: 'phone' },
  { id: 'tensor-g3', name: 'Google Tensor G3', pattern: /\bTensor\s*G3\b/i, index: 4400, segment: 'phone' },
  { id: 'tensor-g2', name: 'Google Tensor G2', pattern: /\bTensor\s*G2\b/i, index: 3300, segment: 'phone' },

  // Samsung
  { id: 'exynos-2400', name: 'Exynos 2400', pattern: /\bExynos\s*2400\b/i, index: 7000, segment: 'phone' },
  { id: 'exynos-1480', name: 'Exynos 1480', pattern: /\bExynos\s*1480\b/i, index: 3500, segment: 'phone' },
  { id: 'exynos-1380', name: 'Exynos 1380', pattern: /\bExynos\s*1380\b/i, index: 2800, segment: 'phone' },
  { id: 'exynos-1280', name: 'Exynos 1280', pattern: /\bExynos\s*1280\b/i, index: 1900, segment: 'phone' },

  // MediaTek
  { id: 'dimensity-9300', name: 'Dimensity 9300', pattern: /\bDimensity\s*9300\b/i, index: 7300, segment: 'phone' },
  { id: 'dimensity-8020', name: 'Dimensity 8020', pattern: /\bDimensity\s*8020\b/i, index: 3500, segment: 'phone' },
  { id: 'dimensity-7050', name: 'Dimensity 7050', pattern: /\bDimensity\s*7050\b/i, index: 2600, segment: 'phone' },
  { id: 'dimensity-6080', name: 'Dimensity 6080', pattern: /\bDimensity\s*6080\b/i, index: 2000, segment: 'phone' },
  { id: 'helio-g99', name: 'Helio G99', pattern: /\bHelio\s*G99\b/i, index: 2000, segment: 'phone' },
  { id: 'helio-g88', name: 'Helio G88', pattern: /\bHelio\s*G88\b/i, index: 1300, segment: 'phone' },

  // Intel laptop
  { id: 'intel-ultra-7-155h', name: 'Intel Core Ultra 7 155H', pattern: /\bUltra\s*7\s*155H\b/i, index: 12000, segment: 'laptop' },
  { id: 'intel-i7-13700h', name: 'Intel Core i7-13700H', pattern: /\bi7[-\s]?13700H\b/i, index: 12500, segment: 'laptop' },
  { id: 'intel-i7-1360p', name: 'Intel Core i7-1360P', pattern: /\bi7[-\s]?1360P\b/i, index: 9500, segment: 'laptop' },
  { id: 'intel-i7-1365u', name: 'Intel Core i7-1365U', pattern: /\bi7[-\s]?1365U\b/i, index: 8200, segment: 'laptop' },
  { id: 'intel-i7-1255u', name: 'Intel Core i7-1255U', pattern: /\bi7[-\s]?1255U\b/i, index: 8000, segment: 'laptop' },
  { id: 'intel-i5-1235u', name: 'Intel Core i5-1235U', pattern: /\bi5[-\s]?1235U\b/i, index: 7500, segment: 'laptop' },

  // AMD laptop
  { id: 'amd-r7-7840u', name: 'AMD Ryzen 7 7840U', pattern: /\bRyzen\s*7\s*7840U\b/i, index: 10500, segment: 'laptop' },
  { id: 'amd-r5-7530u', name: 'AMD Ryzen 5 7530U', pattern: /\bRyzen\s*5\s*7530U\b/i, index: 6500, segment: 'laptop' }
];

/**
 * Finds the chip a text is about: the known chip named EARLIEST in the text
 * (a spec line leads with the main processor; "Tensor G5 avec puce de sécurité
 * Titan M2" is a Tensor G5). Ties at the same position go to the more specific
 * table entry. Returns { id, name, index, segment, confidence } or null.
 */
function lookupChip(text) {
  if (!text) return null;
  const s = String(text);
  let best = null;
  let bestPos = Infinity;
  for (const chip of CHIPS) {
    const m = chip.pattern.exec(s);
    if (m && m.index < bestPos) {
      best = chip;
      bestPos = m.index;
    }
  }
  if (!best) return null;
  return {
    id: best.id,
    name: best.name,
    index: best.index,
    segment: best.segment,
    confidence: best.estimated ? 0.5 : 0.7
  };
}

module.exports = { lookupChip, CHIP_INDEX_VERSION, _CHIPS: CHIPS };
