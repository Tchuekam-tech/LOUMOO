/**
 * Unit costs — what a buyer actually pays per unit of the thing that matters
 * for that type (XAF per GB of storage, per 1,000 mAh, per 100 ml…).
 *
 * Shown as analysis, never added to the score: price is already weighted once.
 */

const UNIT_COSTS = {
  smartphone: [{ key: 'pricePerGbStorage', dim: 'storageGb', per: 1, label: { en: 'per GB of storage', fr: 'par Go de stockage' } }],
  laptop: [{ key: 'pricePerGbStorage', dim: 'storageGb', per: 1, label: { en: 'per GB of storage', fr: 'par Go de stockage' } }],
  tablet: [{ key: 'pricePerGbStorage', dim: 'storageGb', per: 1, label: { en: 'per GB of storage', fr: 'par Go de stockage' } }],
  power_bank: [{ key: 'pricePer1000mAh', dim: 'batteryMah', per: 1000, label: { en: 'per 1,000 mAh', fr: 'par 1 000 mAh' } }],
  speaker: [{ key: 'pricePerWatt', dim: 'outputWatts', per: 1, label: { en: 'per watt of output', fr: 'par watt de puissance' } }],
  charger: [{ key: 'pricePerWatt', dim: 'outputWatts', per: 1, label: { en: 'per watt of charging', fr: 'par watt de charge' } }],
  perfume: [{ key: 'pricePer100ml', dim: 'volumeMl', per: 100, label: { en: 'per 100 ml', fr: 'les 100 ml' } }],
  skincare: [{ key: 'pricePer100ml', dim: 'volumeMl', per: 100, label: { en: 'per 100 ml', fr: 'les 100 ml' } }],
  tableware: [{ key: 'pricePerPiece', dim: 'pieceCount', per: 1, label: { en: 'per piece', fr: 'par pièce' } }],
  cookware: [{ key: 'pricePerPiece', dim: 'pieceCount', per: 1, label: { en: 'per piece', fr: 'par pièce' } }]
};

/**
 * @returns {Array<{ key, label, values: {id: number|null}, bestId: string|null }>}
 *          only metrics computable for EVERY product in the set
 */
function unitCosts(type, ids, cellsById) {
  const defs = UNIT_COSTS[type] || [];
  const out = [];
  for (const def of defs) {
    const values = {};
    for (const id of ids) {
      const price = cellsById[id].price && cellsById[id].price.value;
      const qty = cellsById[id][def.dim] && cellsById[id][def.dim].value;
      values[id] = price > 0 && qty > 0 ? Math.round(price / (qty / def.per)) : null;
    }
    if (Object.values(values).some(v => v === null)) continue;
    const min = Math.min(...Object.values(values));
    const best = ids.filter(id => values[id] === min);
    out.push({ key: def.key, label: def.label, values, bestId: best.length === 1 ? best[0] : null });
  }
  return out;
}

module.exports = { unitCosts, UNIT_COSTS };
