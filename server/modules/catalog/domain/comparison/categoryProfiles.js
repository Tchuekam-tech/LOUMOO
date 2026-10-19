/**
 * Category profiles — what is worth comparing for each product type.
 *
 * A dimension declares:
 *   key        stable id in the API response
 *   label      { en, fr }
 *   unit       display unit (null for text/boolean)
 *   type       'number' | 'boolean' | 'text'
 *   direction  'higher' | 'lower' | 'none' (none = shown, never scored)
 *   weight     default importance 0–3 inside its type
 *   facet      the buyer priority it answers to (price, performance, battery…)
 *   section    matrix grouping
 *   extract    (ctx) → { value, display?, source, confidence } | null
 *
 * Extractors read through `ctx` (see specExtractor.js), which looks in the most
 * reliable place first: typed database values, then the seed dataset's numeric
 * specs, then labelled attributes, then any spec text, then the title.
 */

const P = require('./specParsers');

const SECTIONS = {
  overview: { en: 'Overview', fr: 'Aperçu' },
  performance: { en: 'Performance', fr: 'Performances' },
  display: { en: 'Display', fr: 'Écran' },
  battery: { en: 'Battery & charging', fr: 'Batterie & charge' },
  camera: { en: 'Camera', fr: 'Photo & vidéo' },
  audio: { en: 'Sound', fr: 'Son' },
  build: { en: 'Build & portability', fr: 'Conception & poids' },
  capacity: { en: 'Capacity', fr: 'Capacité' },
  connectivity: { en: 'Connectivity', fr: 'Connectivité' },
  fit: { en: 'Sizes & materials', fr: 'Tailles & matières' },
  commerce: { en: 'Price, warranty & seller', fr: 'Prix, garantie & vendeur' }
};

// Facets are the buyer-facing priorities. The compare screen sends the legacy
// keys price/performance/battery/display/portability/warranty/delivery/value.
const FACETS = ['price', 'performance', 'battery', 'display', 'portability', 'warranty', 'camera', 'audio', 'capacity', 'durability', 'connectivity', 'fit', 'reputation', 'trust', 'value'];

/* ── Dimension builders ────────────────────────────────────────────────── */

function dim(key, en, fr, opts) {
  return Object.assign({ key, label: { en, fr }, unit: null, type: 'number', direction: 'higher', weight: 1, facet: null, section: 'overview' }, opts);
}

// A number found by `parse` in: db slug(s) → structured path(s) → attributes
// whose key matches `attrKey` → all spec text → title (if `fromTitle`).
function numeric({ parse, db = [], structured = [], attrKey = null, anyText = true, fromTitle = false }) {
  return (ctx) => {
    for (const slug of db) {
      const v = ctx.db(slug);
      const n = typeof v === 'number' ? v : (v !== null && v !== undefined ? parse(String(v)) : null);
      if (n !== null && n !== undefined && Number.isFinite(Number(n))) return { value: Number(n), source: `db:${slug}`, confidence: 1 };
    }
    for (const path of structured) {
      const v = ctx.structured(path);
      if (typeof v === 'number' && Number.isFinite(v)) return { value: v, source: `spec:${path}`, confidence: 1 };
      if (typeof v === 'string') {
        const n = parse(v);
        if (n !== null) return { value: n, source: `spec:${path}`, confidence: 0.9 };
      }
    }
    if (attrKey) {
      const t = ctx.attr(attrKey);
      const n = t ? parse(t) : null;
      if (n !== null) return { value: n, source: `attr:${ctx.attrKeyName(attrKey)}`, confidence: 0.9 };
    }
    if (anyText) {
      const n = parse(ctx.specText);
      if (n !== null) return { value: n, source: 'text', confidence: 0.75 };
    }
    if (fromTitle) {
      const n = parse(ctx.title);
      if (n !== null) return { value: n, source: 'title', confidence: 0.8 };
    }
    return null;
  };
}

// A feature not mentioned is UNKNOWN, not absent ("Galaxy S24 Ultra 256GB"
// does not say 5G and has it). Absence reads as `false` only where the listing
// format names the feature whenever it exists (`absenceIsFalse`, e.g. a laptop's
// component line lists a dedicated GPU when there is one).
function boolean({ test, db = [], structured = [], fromTitle = true, absenceIsFalse = false }) {
  return (ctx) => {
    for (const slug of db) {
      const v = ctx.db(slug);
      if (typeof v === 'boolean') return { value: v, source: `db:${slug}`, confidence: 1 };
    }
    for (const path of structured) {
      const v = ctx.structured(path);
      if (typeof v === 'string' && v) return { value: test(v), source: `spec:${path}`, confidence: 0.9 };
    }
    const text = fromTitle ? `${ctx.title} ${ctx.specText}` : ctx.specText;
    if (test(text)) return { value: true, source: 'text', confidence: 0.8 };
    return absenceIsFalse && ctx.hasSpecText ? { value: false, source: 'not-mentioned', confidence: 0.5 } : null;
  };
}

function text({ attrKey, structured = [], db = [] }) {
  return (ctx) => {
    for (const slug of db) {
      const v = ctx.db(slug);
      if (v !== null && v !== undefined && v !== '') return { value: String(v), source: `db:${slug}`, confidence: 1 };
    }
    for (const path of structured) {
      const v = ctx.structured(path);
      if (typeof v === 'string' && v) return { value: v, source: `spec:${path}`, confidence: 1 };
    }
    const t = attrKey ? ctx.attr(attrKey) : null;
    return t ? { value: t, source: `attr:${ctx.attrKeyName(attrKey)}`, confidence: 0.9 } : null;
  };
}

/* ── Shared dimensions ─────────────────────────────────────────────────── */

const PRICE = dim('price', 'Price', 'Prix', {
  unit: 'XAF', direction: 'lower', weight: 3, facet: 'price', section: 'commerce',
  extract: (ctx) => (ctx.product.price > 0 ? { value: ctx.product.price, source: 'listing', confidence: 1 } : null)
});

const RATING = dim('rating', 'Buyer rating', 'Note acheteurs', {
  unit: '/5', weight: 1, facet: 'reputation', section: 'commerce', adjust: 'bayesian',
  extract: (ctx) => (ctx.product.rating !== null && ctx.product.rating !== undefined
    ? { value: ctx.product.rating, source: 'reviews', confidence: 1, meta: { reviewCount: ctx.product.reviewCount } }
    : null)
});

const WARRANTY = dim('warrantyMonths', 'Warranty', 'Garantie', {
  unit: 'months', weight: 1, facet: 'warranty', section: 'commerce',
  extract: (ctx) => numeric({
    parse: P.parseWarrantyMonths,
    db: ['warranty_months', 'warranty'],
    structured: ['commerce.warrantyMonths', 'commerce.warranty'],
    attrKey: /garantie|warranty/i,
    anyText: false
  })(ctx) || (ctx.product.conditionLabel && P.parseWarrantyMonths(ctx.product.conditionLabel) !== null
    ? { value: P.parseWarrantyMonths(ctx.product.conditionLabel), source: 'condition', confidence: 0.8 }
    : null)
});

const SELLER_VERIFIED = dim('sellerVerified', 'Verified seller', 'Vendeur vérifié', {
  type: 'boolean', weight: 1, facet: 'trust', section: 'commerce',
  extract: (ctx) => (ctx.product.seller && ctx.product.seller.name
    ? { value: Boolean(ctx.product.seller.verified), source: 'store', confidence: 1 }
    : null)
});

const IN_STOCK = dim('inStock', 'Available', 'Disponible', {
  type: 'boolean', weight: 0, facet: 'trust', section: 'commerce',
  extract: (ctx) => (typeof ctx.product.inStock === 'boolean' ? { value: ctx.product.inStock, source: 'listing', confidence: ctx.product.stockKnown ? 1 : 0.6 } : null)
});

const COMMERCE = [PRICE, WARRANTY, RATING, SELLER_VERIFIED, IN_STOCK];

/* ── Reusable spec dimensions ──────────────────────────────────────────── */

const CHIP = dim('chipPerformance', 'Processor performance', 'Performance du processeur', {
  unit: 'index', weight: 3, facet: 'performance', section: 'performance', approximate: true,
  extract: (ctx) => {
    const chip = ctx.chip;
    return chip ? { value: chip.index, display: chip.name, source: 'chip-index', confidence: chip.confidence, meta: { chipId: chip.id } } : null;
  }
});

const RAM = dim('ramGb', 'Memory (RAM)', 'Mémoire vive (RAM)', {
  unit: 'GB', weight: 2, facet: 'performance', section: 'performance',
  extract: (ctx) => {
    const db = ctx.db('ram_gb') ?? ctx.db('ram');
    if (db !== null && db !== undefined && Number.isFinite(Number(db))) return { value: Number(db), source: 'db:ram', confidence: 1 };
    const s = ctx.structured('performance.ramNumericGb');
    if (typeof s === 'number') return { value: s, source: 'spec:performance.ramNumericGb', confidence: 1 };
    const m = ctx.memory;
    return m.ramGb !== null ? { value: m.ramGb, source: m.source, confidence: m.inferred.ramGb ? 0.6 : 0.9 } : null;
  }
});

const STORAGE = dim('storageGb', 'Storage', 'Stockage', {
  unit: 'GB', weight: 2, facet: 'capacity', section: 'performance',
  extract: (ctx) => {
    const db = ctx.db('storage_gb') ?? ctx.db('storage');
    if (db !== null && db !== undefined && Number.isFinite(Number(db))) return { value: Number(db), source: 'db:storage', confidence: 1 };
    const s = ctx.structured('storage.storageNumericGb');
    if (typeof s === 'number') return { value: s, source: 'spec:storage.storageNumericGb', confidence: 1 };
    const m = ctx.memory;
    return m.storageGb !== null ? { value: m.storageGb, source: m.source, confidence: m.inferred.storageGb ? 0.75 : 0.9 } : null;
  }
});

const BATTERY_MAH = (weight = 2, facet = 'battery') => dim('batteryMah', 'Battery capacity', 'Capacité batterie', {
  unit: 'mAh', weight, facet, section: facet === 'capacity' ? 'capacity' : 'battery',
  extract: numeric({ parse: P.parseMah, db: ['battery_mah', 'battery_capacity'], structured: ['battery.capacity'], attrKey: /batterie|battery|capacit/i, fromTitle: true })
});

const BATTERY_HOURS = (weight = 2) => dim('batteryHours', 'Battery life', 'Autonomie', {
  unit: 'h', weight, facet: 'battery', section: 'battery',
  extract: numeric({ parse: P.parseHours, db: ['battery_hours', 'battery_life'], structured: ['battery.batteryLifeHours', 'battery.batteryLife'], attrKey: /autonomie|battery life|batterie/i, anyText: true })
});

const CHARGE_W = dim('chargeWatts', 'Charging power', 'Puissance de charge', {
  unit: 'W', weight: 1, facet: 'battery', section: 'battery',
  extract: numeric({ parse: P.parseWatts, db: ['charging_watts'], structured: ['battery.fastCharging'], attrKey: /charge|batterie/i })
});

const REFRESH = dim('refreshHz', 'Refresh rate', 'Taux de rafraîchissement', {
  unit: 'Hz', weight: 1, facet: 'display', section: 'display',
  extract: numeric({ parse: P.parseRefreshHz, db: ['refresh_rate'], structured: ['display.refreshRate'], attrKey: /écran|ecran|display|sp[ée]cifications/i })
});

const SCREEN = dim('screenInches', 'Screen size', "Taille d'écran", {
  unit: 'in', direction: 'none', weight: 0, facet: 'display', section: 'display',
  extract: numeric({ parse: P.parseInches, db: ['screen_size'], structured: ['display.sizeNumericInches', 'display.size'], attrKey: /écran|ecran|display/i, fromTitle: true })
});

const BRIGHTNESS = dim('brightnessNits', 'Peak brightness', 'Luminosité maximale', {
  unit: 'nits', weight: 1, facet: 'display', section: 'display',
  extract: numeric({ parse: P.parseNits, structured: ['display.brightness'], attrKey: /écran|ecran|display/i })
});

const MAIN_CAMERA = dim('cameraMp', 'Main camera', 'Capteur principal', {
  unit: 'MP', weight: 1, facet: 'camera', section: 'camera',
  extract: numeric({ parse: P.parseMegapixels, db: ['camera_mp'], structured: ['cameraAudio.camera'], attrKey: /photo|cam[ée]ra|optique|sp[ée]cifications/i })
});

const OPTICAL_ZOOM = dim('opticalZoom', 'Optical zoom', 'Zoom optique', {
  unit: '×', weight: 1, facet: 'camera', section: 'camera',
  extract: numeric({ parse: P.parseOpticalZoom, structured: ['cameraAudio.camera'], attrKey: /photo|cam[ée]ra|optique|t[ée]l[ée]objectif/i, anyText: false })
});

const FIVE_G = dim('has5g', '5G', '5G', {
  type: 'boolean', weight: 1, facet: 'connectivity', section: 'connectivity',
  extract: boolean({ test: P.has5g, structured: ['connectivity.network'] })
});

const WEIGHT = dim('weightKg', 'Weight', 'Poids', {
  unit: 'kg', direction: 'lower', weight: 2, facet: 'portability', section: 'build',
  extract: numeric({ parse: P.parseKg, db: ['weight_kg', 'weight'], structured: ['build.weightNumericKg', 'build.weight'], attrKey: /poids|weight|ch[âa]ssis/i })
});

const DEDICATED_GPU = dim('dedicatedGpu', 'Dedicated graphics', 'Carte graphique dédiée', {
  type: 'boolean', weight: 1, facet: 'performance', section: 'performance',
  extract: boolean({ test: P.hasDedicatedGpu, structured: ['performance.gpu'], absenceIsFalse: true })
});

const ANC = dim('noiseCancelling', 'Active noise cancelling', 'Réduction de bruit active', {
  type: 'boolean', weight: 2, facet: 'audio', section: 'audio',
  extract: boolean({ test: P.hasAnc })
});

const BLUETOOTH = dim('bluetoothVersion', 'Bluetooth', 'Bluetooth', {
  unit: null, weight: 1, facet: 'connectivity', section: 'connectivity',
  extract: numeric({ parse: P.parseBluetoothVersion, structured: ['connectivity.bluetooth'], attrKey: /connectivit|bluetooth/i })
});

const DRIVER = dim('driverMm', 'Driver size', 'Taille du transducteur', {
  unit: 'mm', weight: 1, facet: 'audio', section: 'audio',
  extract: numeric({ parse: P.parseDriverMm, attrKey: /acoustique|son|transducteur|audio/i, anyText: false })
});

const WATER = dim('waterProtection', 'Water protection (IPx)', "Protection contre l'eau (IPx)", {
  unit: 'IPx', weight: 1, facet: 'durability', section: 'build',
  extract: numeric({ parse: P.parseIpWater, attrKey: /[ée]tanch|protection|acoustique/i, fromTitle: true })
});

const RMS = dim('outputWatts', 'Output power', 'Puissance de sortie', {
  unit: 'W', weight: 3, facet: 'audio', section: 'audio',
  extract: (ctx) => numeric({ parse: P.parseRmsWatts, attrKey: /puissance|acoustique|son/i, fromTitle: true })(ctx)
    || numeric({ parse: P.parseWatts, attrKey: /puissance/i, fromTitle: true, anyText: false })(ctx)
});

const RANGE = dim('rangeMeters', 'Wireless range', 'Portée sans fil', {
  unit: 'm', weight: 2, facet: 'connectivity', section: 'connectivity',
  extract: numeric({ parse: P.parseRangeMeters, attrKey: /port[ée]e|range|acoustique/i, fromTitle: true })
});

const OUTPUT_W = (weight = 2) => dim('outputWatts', 'Output power', 'Puissance de sortie', {
  unit: 'W', weight, facet: 'performance', section: 'performance',
  extract: numeric({ parse: P.parseWatts, attrKey: /caract[ée]ristiques|puissance|charge/i, fromTitle: true })
});

const PORTS = dim('portCount', 'Charging ports', 'Ports de charge', {
  unit: null, weight: 1, facet: 'connectivity', section: 'connectivity',
  extract: (ctx) => {
    const m = `${ctx.title} ${ctx.specText}`.match(/(\d)\s*ports?\b/i);
    return m ? { value: Number(m[1]), source: 'text', confidence: 0.8 } : null;
  }
});

const SHOE_SIZES = dim('sizeCount', 'Sizes available', 'Pointures disponibles', {
  unit: null, weight: 1, facet: 'fit', section: 'fit',
  extract: (ctx) => {
    const src = ctx.attr(/pointure|taille|size/i) || ctx.title;
    const s = P.parseShoeSizes(src);
    return s ? { value: s.count, display: `${s.min}–${s.max}`, source: ctx.attr(/pointure|taille|size/i) ? 'attr' : 'title', confidence: 0.85 } : null;
  }
});

const LETTER_SIZES = dim('sizeCount', 'Sizes available', 'Tailles disponibles', {
  unit: null, weight: 1, facet: 'fit', section: 'fit',
  extract: (ctx) => {
    const src = ctx.attr(/taille|size/i);
    const n = src ? P.parseLetterSizeCount(src) : null;
    return n !== null ? { value: n, display: src, source: 'attr', confidence: 0.85 } : null;
  }
});

const MATERIAL = dim('material', 'Material', 'Matière', {
  type: 'text', direction: 'none', weight: 0, facet: 'fit', section: 'fit',
  extract: text({ attrKey: /mat[ée]ri|mati[èe]re|cuir|composition|confection/i, db: ['material'] })
});

const PIECES = (weight = 2) => dim('pieceCount', 'Pieces in the set', 'Nombre de pièces', {
  unit: null, weight, facet: 'capacity', section: 'capacity',
  extract: numeric({ parse: P.parsePieces, attrKey: /coffret|composition|emballage|pi[èe]ces/i, fromTitle: true })
});

const VOLUME_L = (weight = 1) => dim('capacityLitres', 'Capacity', 'Contenance', {
  unit: 'L', weight, facet: 'capacity', section: 'capacity',
  extract: numeric({ parse: P.parseLitres, attrKey: /capacit|contenance|fonctionnalit/i, fromTitle: true })
});

const POWER_W = dim('powerWatts', 'Power', 'Puissance', {
  unit: 'W', direction: 'none', weight: 0, facet: 'performance', section: 'performance',
  extract: numeric({ parse: P.parseWatts, attrKey: /puissance|tension|fonctionnalit/i, fromTitle: true })
});

const VOLUME_ML = dim('volumeMl', 'Volume', 'Contenance', {
  unit: 'ml', weight: 1, facet: 'capacity', section: 'capacity',
  extract: numeric({ parse: P.parseMillilitres, attrKey: /contenance|volume|flacon/i, fromTitle: true })
});

const WATER_RESIST_M = dim('waterResistanceM', 'Water resistance', 'Étanchéité', {
  unit: 'm', weight: 1, facet: 'durability', section: 'build',
  extract: numeric({ parse: P.parseWaterResistanceM, attrKey: /[ée]tanch|water/i, fromTitle: true })
});

/* ── Profiles per product type ─────────────────────────────────────────── */

const PROFILES = {
  smartphone: [CHIP, RAM, STORAGE, BATTERY_MAH(2), CHARGE_W, REFRESH, SCREEN, BRIGHTNESS, MAIN_CAMERA, OPTICAL_ZOOM, FIVE_G, ...COMMERCE],
  tablet: [CHIP, RAM, STORAGE, BATTERY_MAH(1), BATTERY_HOURS(2), REFRESH, SCREEN, WEIGHT, ...COMMERCE],
  laptop: [CHIP, RAM, STORAGE, DEDICATED_GPU, REFRESH, SCREEN, BRIGHTNESS, BATTERY_HOURS(2), WEIGHT, ...COMMERCE],
  headphones: [ANC, BATTERY_HOURS(2), DRIVER, BLUETOOTH, WATER, ...COMMERCE],
  earbuds: [ANC, BATTERY_HOURS(2), DRIVER, BLUETOOTH, WATER, ...COMMERCE],
  speaker: [RMS, BATTERY_HOURS(2), BATTERY_MAH(1), WATER, BLUETOOTH, ...COMMERCE],
  microphone: [RANGE, BATTERY_HOURS(2), ...COMMERCE],
  power_bank: [BATTERY_MAH(3, 'capacity'), OUTPUT_W(2), PORTS, ...COMMERCE],
  charger: [OUTPUT_W(3), PORTS, ...COMMERCE],
  smartwatch: [BATTERY_HOURS(2), SCREEN, WATER_RESIST_M, ...COMMERCE],
  watch: [WATER_RESIST_M, MATERIAL, ...COMMERCE],
  footwear: [SHOE_SIZES, MATERIAL, ...COMMERCE],
  clothing: [LETTER_SIZES, MATERIAL, ...COMMERCE],
  kitchen_appliance: [VOLUME_L(1), POWER_W, ...COMMERCE],
  cookware: [PIECES(1), VOLUME_L(1), MATERIAL, ...COMMERCE],
  tableware: [PIECES(2), MATERIAL, ...COMMERCE],
  perfume: [VOLUME_ML, ...COMMERCE],
  skincare: [VOLUME_ML, ...COMMERCE]
};

// Anything else (stores, hotels, cables, groceries…) compares on commerce only.
const DEFAULT_PROFILE = COMMERCE;

function profileFor(type) {
  return PROFILES[type] || DEFAULT_PROFILE;
}

module.exports = { profileFor, SECTIONS, FACETS, PROFILES, DEFAULT_PROFILE };
