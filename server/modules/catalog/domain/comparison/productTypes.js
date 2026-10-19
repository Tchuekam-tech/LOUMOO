/**
 * Product type classification.
 *
 * The catalogue's subcategories are too coarse to compare within: "audio" mixes
 * earbuds, over-ear headphones, party speakers and a lapel microphone, and
 * "power_accessories" holds power banks, a game controller, a shaver and a
 * camera. A product TYPE is the class whose members are fair to rank against
 * each other; a FAMILY groups types that share some dimensions (earbuds and
 * headphones share battery life and ANC, not RMS power).
 */

// Ordered: the first rule whose test passes wins. `text` is the lowercased
// title + subcategory; keyword rules are scoped to their category so a word in a
// title never pulls a product into another department.
const RULES = [
  // Non-product entities that the comparison screen can still hold.
  { type: 'store', family: 'non_product', test: (p) => p.entityType === 'store' },
  { type: 'hotel', family: 'non_product', test: (p) => /^(hotels?|hospitality|travel)$/.test(p.category) },
  { type: 'service', family: 'non_product', test: (p) => /^services?$/.test(p.category) },
  { type: 'education', family: 'non_product', test: (p) => /^(universities|education)$/.test(p.category) },

  // Electronics — order matters (headphones before earbuds: "AirPods Max").
  { type: 'smartphone', family: 'mobile', test: (p) => /^(smartphones?|phones?|mobiles?)$/.test(p.sub) || /\bsmartphone\b/.test(p.sub) },
  { type: 'laptop', family: 'computer', test: (p) => /^(laptops?|ordinateurs?|computers?|ultrabooks?)$/.test(p.sub) },
  { type: 'tablet', family: 'mobile', test: (p) => p.elec && /\b(tablette|ipad|galaxy tab|tablet)\b/.test(p.text) },
  { type: 'headphones', family: 'audio', test: (p) => p.elec && /\b(casque|headphones?|wh-1000|airpods max)\b/.test(p.text) },
  { type: 'earbuds', family: 'audio', test: (p) => p.elec && /(écouteurs|ecouteurs|earbuds|\bbuds\b|spacebuds|freepods|airpods|true wireless)/.test(p.text) },
  { type: 'speaker', family: 'audio', test: (p) => p.elec && /(enceinte|speaker|boombox|echo dot|haut-parleur)/.test(p.text) },
  { type: 'microphone', family: 'audio', test: (p) => p.elec && /(microphone|\bmicro\b|\bmic\b)/.test(p.text) },
  { type: 'power_bank', family: 'power', test: (p) => p.elec && /(power ?bank|batterie externe)/.test(p.text) },
  { type: 'charger', family: 'power', test: (p) => p.elec && /(chargeur|charger)/.test(p.text) && !/(câble|cable)/.test(p.text) },
  { type: 'cable', family: 'power', test: (p) => p.elec && /(câble|cable)/.test(p.text) },
  { type: 'smartwatch', family: 'wearable', test: (p) => p.elec && /(montre connect|smartwatch|smart watch)/.test(p.text) },
  { type: 'camera', family: 'imaging', test: (p) => p.elec && /(caméra|camera|osmo|action cam|gopro)/.test(p.text) },
  { type: 'game_controller', family: 'gaming', test: (p) => p.elec && /(manette|dualsense|controller)/.test(p.text) },
  { type: 'console', family: 'gaming', test: (p) => p.elec && /(playstation|xbox|nintendo switch|console)/.test(p.text) },
  { type: 'tracker', family: 'accessory', test: (p) => p.elec && /(airtag|balise|tracker)/.test(p.text) },
  { type: 'shaver', family: 'personal_care', test: (p) => p.elec && /(rasoir|shaver|tondeuse)/.test(p.text) },

  // Fashion
  { type: 'bag', family: 'fashion_accessory', test: (p) => (p.category === 'fashion' || p.sub === 'bags') && /(\bsac\b|handbag|backpack|rucksack|birkin|pochette)/.test(p.text) },
  { type: 'footwear', family: 'fashion', test: (p) => /^(footwear|shoes|chaussures)$/.test(p.sub) },
  { type: 'watch', family: 'fashion_accessory', test: (p) => /\bmontre\b|\bwatch\b/.test(p.text) && p.category !== 'electronics' },
  { type: 'jewelry', family: 'fashion_accessory', test: (p) => p.category === 'jewelry' || /(bague|collier|bracelet|pendentif|boucles d'oreilles|necklace|ring\b)/.test(p.text) },
  { type: 'clothing', family: 'fashion', test: (p) => /^(clothing|vêtements|vetements)$/.test(p.sub) },

  // Home
  { type: 'kitchen_appliance', family: 'home', test: (p) => /^(appliances|kitchen)$/.test(p.sub) },
  { type: 'cookware', family: 'home', test: (p) => p.sub === 'cookware' },
  { type: 'tableware', family: 'home', test: (p) => p.sub === 'tableware' },
  { type: 'home_care', family: 'home', test: (p) => p.sub === 'home_care' },

  // Beauty, groceries
  { type: 'perfume', family: 'beauty', test: (p) => p.sub === 'perfume' || /(eau de (parfum|toilette)|extrait de parfum)/.test(p.text) },
  { type: 'skincare', family: 'beauty', test: (p) => p.sub === 'skincare' },
  { type: 'haircare', family: 'beauty', test: (p) => p.sub === 'haircare' },
  { type: 'grocery', family: 'grocery', test: (p) => p.category === 'groceries' }
];

function norm(s) {
  return String(s || '').toLowerCase().trim();
}

/**
 * classify({ title, category, subcategory, entityType }) → { type, family }
 * Falls back to the subcategory (or category) so that unknown products still
 * compare only with their own kind.
 */
function classify(product) {
  const category = norm(product.category);
  const sub = norm(product.subcategory || product.subCategory);
  const facts = {
    category,
    sub,
    entityType: product.entityType || null,
    // Text rules for gadgets only fire inside electronics: "Micro-Daim" boots
    // are not a microphone.
    elec: category === 'electronics',
    text: `${norm(product.title)} ${sub}`
  };
  for (const rule of RULES) {
    if (rule.test(facts)) return { type: rule.type, family: rule.family };
  }
  const fallback = sub || category || 'general';
  return { type: `other:${fallback}`, family: category || 'general' };
}

module.exports = { classify };
