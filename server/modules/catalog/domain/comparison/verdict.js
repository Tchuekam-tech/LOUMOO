/**
 * Verdict writer — turns computed facts into sentences, in English or French.
 *
 * Every sentence is generated from a number the engine computed and carries the
 * data it came from (`data`), so the UI can show the evidence and a test can
 * check the claim. Nothing here decides who wins; analysis.js already did.
 */

const F = require('./format');
const { stripCopyMarker } = require('./productIdentity');

const TYPE_PLURAL = {
  smartphone: { en: 'smartphones', fr: 'smartphones' },
  laptop: { en: 'laptops', fr: 'ordinateurs portables' },
  tablet: { en: 'tablets', fr: 'tablettes' },
  headphones: { en: 'headphones', fr: 'casques' },
  earbuds: { en: 'earbuds', fr: 'écouteurs' },
  speaker: { en: 'speakers', fr: 'enceintes' },
  microphone: { en: 'microphones', fr: 'microphones' },
  power_bank: { en: 'power banks', fr: 'batteries externes' },
  charger: { en: 'chargers', fr: 'chargeurs' },
  smartwatch: { en: 'smartwatches', fr: 'montres connectées' },
  watch: { en: 'watches', fr: 'montres' },
  footwear: { en: 'shoes', fr: 'chaussures' },
  clothing: { en: 'clothing items', fr: 'vêtements' },
  bag: { en: 'bags', fr: 'sacs' },
  jewelry: { en: 'jewellery pieces', fr: 'bijoux' },
  kitchen_appliance: { en: 'kitchen appliances', fr: 'appareils de cuisine' },
  cookware: { en: 'cookware items', fr: 'ustensiles de cuisson' },
  tableware: { en: 'tableware sets', fr: "arts de la table" },
  perfume: { en: 'perfumes', fr: 'parfums' },
  skincare: { en: 'skincare products', fr: 'soins' }
};

const FACET_LABEL = {
  price: { en: 'price', fr: 'le prix' },
  performance: { en: 'performance', fr: 'la performance' },
  battery: { en: 'battery', fr: "l'autonomie" },
  display: { en: 'the screen', fr: "l'écran" },
  portability: { en: 'portability', fr: 'la légèreté' },
  warranty: { en: 'warranty', fr: 'la garantie' },
  camera: { en: 'the camera', fr: 'la photo' },
  audio: { en: 'sound', fr: 'le son' },
  capacity: { en: 'capacity', fr: 'la capacité' },
  durability: { en: 'durability', fr: 'la résistance' },
  connectivity: { en: 'connectivity', fr: 'la connectivité' },
  fit: { en: 'sizes', fr: 'les tailles' },
  reputation: { en: 'buyer ratings', fr: 'les avis' },
  trust: { en: 'seller trust', fr: 'la confiance vendeur' },
  value: { en: 'value for money', fr: 'le rapport qualité-prix' }
};

const T = {
  en: {
    vs: 'vs',
    categoryTop: (dim, pct, plural) => `${dim} in the top ${pct}% of ${plural} on LOUMOO`,
    categoryBottom: (dim, pct, plural) => `${dim} in the bottom ${pct}% of ${plural} on LOUMOO`,
    cheaper: (a, diff, pct) => `${a} costs ${diff} less (${pct} cheaper)`,
    valueBelow: (pct, plural, n) => `Priced ${pct} below what ${plural} with comparable specs usually cost on LOUMOO (fitted on ${n} products)`,
    valueAbove: (pct, plural, n) => `Priced ${pct} above what ${plural} with comparable specs usually cost on LOUMOO (fitted on ${n} products)`,
    valueInLine: (plural) => `Priced in line with comparable ${plural} on LOUMOO`,
    dominates: (a, b, k, n) => `${a} is at least as good as ${b} on all ${n} compared points, and better on ${k}`,
    clear: (a) => `${a} comes out ahead whatever you prioritise.`,
    leaning: (a, facet, b) => `${a} leads, but if ${facet} matters most to you, ${b} is the better pick.`,
    leaningThin: (a, m) => `${a} leads by a thin margin (${m} points).`,
    close: (a, m, facet, b) => `Close call: ${a} leads by ${m} points; if ${facet} matters most, choose ${b}.`,
    unitCost: (a, cost, label) => `${a}: ${cost} ${label}`,
    conflict: (title, dim, range) => `Listings of ${title} disagree on ${dim} (${range}); treat that figure with caution.`,
    approximate: 'Processor performance uses an approximate benchmark index (order of magnitude, not an exact score).',
    uniform: (dim, plural) => `${dim} is the same template value on most ${plural} listings, so it was not used to rank.`,
    uniformBool: (dim, plural) => `Every ${plural.replace(/s$/, '')} listing on LOUMOO states ${dim}, so it does not separate them.`,
    partial: (dim, titles) => `${dim} is only known for ${titles}, so it was not used to rank.`,
    limited: 'These are different kinds of product, so they are shown side by side without a ranking.',
    partialLevel: 'These products are related but not the same kind: only the specs they share are compared.',
    none: 'Products cannot be ranked against stores or stays; they are shown side by side only.',
    insufficient: 'Add at least one more product to compare.',
    equivalent: 'These products are practically equivalent on everything compared, price included; choose on seller or delivery.',
    withheld: 'These listings share no verified specification, so no product is recommended; compare price and seller below.',
    noBasis: 'Not enough shared, reliable information to rank these products.',
    bestFor: 'Best for',
    yes: 'Yes',
    no: 'No',
    and: 'and'
  },
  fr: {
    vs: 'contre',
    categoryTop: (dim, pct, plural) => `${dim} dans les ${pct} % meilleurs ${plural} sur LOUMOO`,
    categoryBottom: (dim, pct, plural) => `${dim} parmi les ${pct} % les plus faibles des ${plural} sur LOUMOO`,
    cheaper: (a, diff, pct) => `${a} coûte ${diff} de moins (${pct} moins cher)`,
    valueBelow: (pct, plural, n) => `Prix ${pct} sous celui des ${plural} aux caractéristiques comparables sur LOUMOO (modèle calculé sur ${n} produits)`,
    valueAbove: (pct, plural, n) => `Prix ${pct} au-dessus de celui des ${plural} aux caractéristiques comparables sur LOUMOO (modèle calculé sur ${n} produits)`,
    valueInLine: (plural) => `Prix conforme à celui des ${plural} comparables sur LOUMOO`,
    dominates: (a, b, k, n) => `${a} égale ou dépasse ${b} sur les ${n} points comparés, et fait mieux sur ${k}`,
    clear: (a) => `${a} l'emporte quelle que soit votre priorité.`,
    leaning: (a, facet, b) => `${a} est devant, mais si ${facet} compte le plus pour vous, ${b} est le meilleur choix.`,
    leaningThin: (a, m) => `${a} est devant, de peu (${m} points).`,
    close: (a, m, facet, b) => `Match serré : ${a} devance de ${m} points ; si ${facet} compte le plus, choisissez ${b}.`,
    unitCost: (a, cost, label) => `${a} : ${cost} ${label}`,
    conflict: (title, dim, range) => `Les annonces de ${title} ne s'accordent pas sur ${dim} (${range}) ; prudence sur ce chiffre.`,
    approximate: 'La performance du processeur repose sur un indice de benchmark approximatif (ordre de grandeur, pas un score exact).',
    uniform: (dim) => `${dim} affiche la même valeur type sur la plupart des annonces de cette catégorie ; non utilisé pour classer.`,
    uniformBool: (dim) => `${dim} : toutes les annonces de cette catégorie l'indiquent ; ce point ne les départage pas.`,
    partial: (dim, titles) => `${dim} n'est connu que pour ${titles} ; non utilisé pour classer.`,
    limited: 'Ces produits ne sont pas du même type : affichage côte à côte, sans classement.',
    partialLevel: 'Ces produits sont proches mais pas du même type : seules les caractéristiques communes sont comparées.',
    none: 'Un produit ne se classe pas face à une boutique ou un séjour ; affichage côte à côte uniquement.',
    insufficient: 'Ajoutez au moins un autre produit pour comparer.',
    equivalent: 'Ces produits sont pratiquement équivalents sur tous les points comparés, prix compris ; choisissez selon le vendeur ou la livraison.',
    withheld: "Ces annonces n'ont aucune caractéristique vérifiée en commun : aucun produit n'est recommandé ; comparez le prix et le vendeur ci-dessous.",
    noBasis: 'Pas assez d’informations communes et fiables pour classer ces produits.',
    bestFor: 'Idéal pour',
    yes: 'Oui',
    no: 'Non',
    and: 'et'
  }
};

// French typography puts a space before the colon.
function sep(l) {
  return l === 'fr' ? ' : ' : ': ';
}

function shortTitle(title) {
  let t = stripCopyMarker(title);
  // Drop a trailing parenthetical configuration note when the title is long.
  if (t.length > 48) t = t.replace(/\s*\([^()]*\)\s*$/, '');
  if (t.length > 60) t = `${t.slice(0, 57).replace(/\s+\S*$/, '')}…`;
  return t;
}

function plural(type, l) {
  return (TYPE_PLURAL[type] && TYPE_PLURAL[type][l]) || (l === 'fr' ? 'produits' : 'products');
}

function facetLabel(facet, l) {
  return (FACET_LABEL[facet] && FACET_LABEL[facet][l]) || facet;
}

function joinTitles(titles, l) {
  if (titles.length <= 1) return titles.join('');
  return `${titles.slice(0, -1).join(', ')} ${T[l].and} ${titles[titles.length - 1]}`;
}

/**
 * Advantage of `winnerId` on one dimension against the best of the others.
 * Returns null when there is nothing a buyer would call a difference.
 */
function advantageFact(dim, winnerId, ids, cellsById, l) {
  const win = cellsById[winnerId][dim.key];
  const others = ids.filter(id => id !== winnerId).map(id => ({ id, cell: cellsById[id][dim.key] })).filter(o => o.cell);
  if (!win || !others.length) return null;
  const pick = dim.direction === 'lower'
    ? others.reduce((a, b) => (b.cell.value < a.cell.value ? b : a))
    : others.reduce((a, b) => ((dim.type === 'boolean' ? Number(b.cell.value) : b.cell.value) > (dim.type === 'boolean' ? Number(a.cell.value) : a.cell.value) ? b : a));
  const label = dim.label[l];
  const wv = F.value(dim, win, l);
  const ov = F.value(dim, pick.cell, l);
  let delta = null;
  if (dim.type === 'number' && typeof win.value === 'number' && typeof pick.cell.value === 'number' && pick.cell.value !== 0) {
    delta = (win.value - pick.cell.value) / Math.abs(pick.cell.value);
  }
  // The chip index is approximate: name the chips, never quote a % gap. A
  // percentage of a star rating means nothing either.
  const deltaText = delta !== null && dim.unit !== 'index' && dim.unit !== '/5' ? ` (${F.percent(delta, l, true)})` : '';
  const text = `${label}${sep(l)}${wv} ${T[l].vs} ${ov}${deltaText}`;
  // The same fact from the runner-up's side, for its list of drawbacks.
  const back = delta !== null && win.value !== 0 ? (pick.cell.value - win.value) / Math.abs(win.value) : null;
  const backText = back !== null && dim.unit !== 'index' && dim.unit !== '/5' ? ` (${F.percent(back, l, true)})` : '';
  const loserText = `${label}${sep(l)}${ov} ${T[l].vs} ${wv}${backText}`;
  return {
    kind: 'advantage',
    productId: winnerId,
    dimension: dim.key,
    text,
    loserText,
    data: { winner: win.value, runnerUp: pick.cell.value, runnerUpId: pick.id, delta: delta !== null ? Math.round(delta * 1000) / 1000 : null }
  };
}

/**
 * @param {object} a  everything the engine computed (see ComparisonEngineV2)
 * @param {string} locale 'en' | 'fr'
 */
function buildVerdict(a, locale) {
  const l = F.normLocale(locale);
  const t = T[l];
  const titleOf = (id) => a.titles[id];
  const facts = [];
  const warnings = [];

  // Comparability notices first: they frame everything else.
  if (a.comparability.level === 'insufficient') warnings.push(t.insufficient);
  else if (a.comparability.level === 'none') warnings.push(t.none);
  else if (a.comparability.level === 'limited') warnings.push(t.limited);
  else if (a.comparability.level === 'partial') warnings.push(t.partialLevel);
  if (a.rankingWithheld === 'equivalent') warnings.push(t.equivalent);
  else if (a.rankingWithheld) warnings.push(t.withheld);

  const winnerId = a.ranking.length ? a.ranking[0][0] : null;

  // Per-dimension advantages, strongest first (weight × score gap).
  const advantages = [];
  for (const dim of a.basisDims) {
    const w = a.winnersByDim[dim.key];
    if (!w || w.winnerIds.length !== 1) continue;
    const fact = advantageFact(dim, w.winnerIds[0], a.ids, a.cellsById, l);
    if (!fact) continue;
    const s = a.scores;
    const gap = Math.abs((s[fact.productId].byDim[dim.key] || {}).score - (s[fact.data.runnerUpId].byDim[dim.key] || {}).score) || 0;
    fact.strength = Math.round((dim.weight || 0) * gap);
    advantages.push(fact);
  }
  advantages.sort((x, y) => y.strength - x.strength);
  facts.push(...advantages);

  // Position in the category (only where scores are true percentiles).
  for (const id of a.ids) {
    for (const dim of a.basisDims) {
      const d = a.scores[id].byDim[dim.key];
      if (!d || d.basis !== 'category' || dim.section === 'commerce') continue;
      if (d.score >= 85) {
        facts.push({ kind: 'categoryTop', productId: id, dimension: dim.key, text: `${titleOf(id)}${sep(l)}${t.categoryTop(dim.label[l], Math.max(1, Math.round(100 - d.score)), plural(a.type, l))}`, localText: t.categoryTop(dim.label[l], Math.max(1, Math.round(100 - d.score)), plural(a.type, l)), data: { percentile: d.score } });
      } else if (d.score <= 15) {
        facts.push({ kind: 'categoryBottom', productId: id, dimension: dim.key, text: `${titleOf(id)}${sep(l)}${t.categoryBottom(dim.label[l], Math.max(1, Math.round(d.score)), plural(a.type, l))}`, localText: t.categoryBottom(dim.label[l], Math.max(1, Math.round(d.score)), plural(a.type, l)), data: { percentile: d.score } });
      }
    }
  }

  // Price gap between the cheapest and the dearest.
  const priced = a.ids.filter(id => a.cellsById[id].price);
  if (priced.length >= 2) {
    const sorted = priced.slice().sort((x, y) => a.cellsById[x].price.value - a.cellsById[y].price.value);
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    const diff = a.cellsById[hi].price.value - a.cellsById[lo].price.value;
    if (diff > 0) {
      const pct = diff / a.cellsById[hi].price.value;
      facts.push({ kind: 'priceGap', productId: lo, text: t.cheaper(titleOf(lo), F.money(diff, l), F.percent(pct, l)), data: { cheaperId: lo, dearerId: hi, difference: diff, ratio: Math.round(pct * 1000) / 1000 } });
    }
  }

  // Market value from the price/quality curve.
  for (const id of a.ids) {
    const v = a.valueById[id];
    if (!v) continue;
    let text;
    if (v.deviation <= -0.1) text = t.valueBelow(F.percent(Math.abs(v.deviation), l), plural(a.type, l), v.fit.n);
    else if (v.deviation >= 0.1) text = t.valueAbove(F.percent(v.deviation, l), plural(a.type, l), v.fit.n);
    else text = t.valueInLine(plural(a.type, l));
    facts.push({ kind: 'marketValue', productId: id, text: `${titleOf(id)}${sep(l)}${text}`, localText: text, data: v });
  }

  // Pareto dominance — only meaningful across at least two spec dimensions.
  const specBasis = a.basisDims.filter(d => d.section !== 'commerce').length;
  for (const d of specBasis >= 2 ? a.dominance : []) {
    facts.push({ kind: 'dominance', productId: d.dominantId, text: t.dominates(titleOf(d.dominantId), titleOf(d.dominatedId), d.dimensionsBetter, d.dimensionsCompared), data: d });
  }

  // Unit costs.
  for (const u of a.unitCosts) {
    for (const id of a.ids) {
      facts.push({ kind: 'unitCost', productId: id, metric: u.key, text: t.unitCost(titleOf(id), F.money(u.values[id], l), u.label[l]), data: { value: u.values[id], best: u.bestId === id } });
    }
  }

  // Data-quality warnings.
  for (const id of a.ids) {
    for (const [dimKey, range] of Object.entries(a.conflictsById[id] || {})) {
      const dim = a.dims.find(d => d.key === dimKey);
      if (!dim || dim.section === 'commerce' || dimKey === 'rating') continue;
      const lo = F.value(dim, { value: Math.min(...range) }, l);
      const hi = F.value(dim, { value: Math.max(...range) }, l);
      warnings.push(t.conflict(titleOf(id), dim.label[l], `${lo} – ${hi}`));
    }
  }
  if (a.basisDims.some(d => d.approximate)) warnings.push(t.approximate);
  for (const dim of a.uniformDims) {
    if (dim.section === 'commerce') continue;
    warnings.push(dim.type === 'boolean' ? t.uniformBool(dim.label[l], plural(a.type, l)) : t.uniform(dim.label[l], plural(a.type, l)));
  }
  for (const p of a.partialDims) {
    warnings.push(t.partial(p.dim.label[l], joinTitles(p.knownFor.map(titleOf), l)));
  }
  if (!a.rankingWithheld && a.comparability.ranked && !a.basisDims.length) warnings.push(t.noBasis);

  // Sensitivity sentence.
  let summary = null;
  if (winnerId && a.sensitivity && a.sensitivity.verdict) {
    const s = a.sensitivity;
    const flip = Object.entries(s.winnerIf).find(([, id]) => id !== winnerId);
    if (s.verdict === 'clear') summary = t.clear(titleOf(winnerId));
    else if (flip && s.verdict === 'close') summary = t.close(titleOf(winnerId), F.number(s.margin, l), facetLabel(flip[0], l), titleOf(flip[1]));
    else if (flip) summary = t.leaning(titleOf(winnerId), facetLabel(flip[0], l), titleOf(flip[1]));
    else summary = t.leaningThin(titleOf(winnerId), F.number(s.margin, l));
  }

  // Best value: market curve when trusted, else spec score per franc.
  let bestValue = null;
  const withValue = a.ids.filter(id => a.valueById[id]);
  if (withValue.length === a.ids.length && withValue.length) {
    const id = withValue.reduce((x, y) => (a.valueById[y].score > a.valueById[x].score ? y : x));
    bestValue = { productId: id, title: titleOf(id), basis: 'market-curve', score: a.valueById[id].score, deviation: a.valueById[id].deviation };
  } else if (a.specScoreById) {
    const eligible = a.ids.filter(id => a.specScoreById[id] !== null && a.cellsById[id].price);
    if (eligible.length === a.ids.length && eligible.length) {
      const perPrice = (id) => a.specScoreById[id] / a.cellsById[id].price.value;
      const id = eligible.reduce((x, y) => (perPrice(y) > perPrice(x) ? y : x));
      bestValue = { productId: id, title: titleOf(id), basis: 'spec-score-per-price', score: null, deviation: null };
    }
  }
  if (!bestValue && priced.length === a.ids.length && priced.length) {
    const id = priced.reduce((x, y) => (a.cellsById[y].price.value < a.cellsById[x].price.value ? y : x));
    bestValue = { productId: id, title: titleOf(id), basis: 'lowest-price', score: null, deviation: null };
  }

  // Best for each facet that has a clear single leader.
  const bestFor = [];
  const facets = [...new Set(a.basisDims.map(d => d.facet).filter(f => f && f !== 'trust' && f !== 'reputation'))];
  for (const facet of facets) {
    const leaders = a.ids.map(id => [id, a.scores[id].byFacet[facet]]).filter(([, v]) => v !== null && v !== undefined);
    if (leaders.length !== a.ids.length) continue;
    leaders.sort((x, y) => y[1] - x[1]);
    if (leaders.length > 1 && leaders[0][1] - leaders[1][1] < 1) continue;
    bestFor.push({ facet, label: `${t.bestFor} ${facetLabel(facet, l)}`, productId: leaders[0][0] });
  }

  // Reasons a buyer would act on: specs, price, market value. Ratings and the
  // seller badge are near-identical across the catalogue and make weak reasons.
  const WEAK = new Set(['rating', 'sellerVerified', 'inStock']);

  // Pros and cons per product, each told from THAT product's side and without
  // repeating its name (the UI shows them under the product already).
  const tradeoffs = a.ids.map(id => {
    const mine = facts.filter(f => f.productId === id && !WEAK.has(f.dimension));
    const pros = mine.filter(f => f.kind === 'advantage' || f.kind === 'categoryTop' || (f.kind === 'marketValue' && f.data.deviation <= -0.1))
      .map(f => f.localText || f.text);
    const cons = mine.filter(f => f.kind === 'categoryBottom' || (f.kind === 'marketValue' && f.data.deviation >= 0.1))
      .map(f => f.localText || f.text);
    for (const f of advantages) {
      if (f.productId !== id && f.data.runnerUpId === id && !WEAK.has(f.dimension)) cons.push(f.loserText);
    }
    return { productId: id, title: titleOf(id), pros: pros.slice(0, 5), cons: cons.slice(0, 5) };
  });
  const topReasons = winnerId
    ? facts.filter(f => f.productId === winnerId && ['advantage', 'marketValue', 'categoryTop', 'dominance'].includes(f.kind))
      .filter(f => !WEAK.has(f.dimension))
      .filter(f => f.kind !== 'marketValue' || f.data.deviation <= -0.1)
      .slice(0, 3)
      .map(f => f.text)
    : [];

  return {
    summary,
    bestOverall: winnerId ? { productId: winnerId, title: titleOf(winnerId), score: a.scores[winnerId].total } : null,
    bestValue,
    bestFor,
    topReasons,
    facts,
    tradeoffs,
    warnings: [...new Set(warnings)]
  };
}

module.exports = { buildVerdict, shortTitle, TYPE_PLURAL, FACET_LABEL };
