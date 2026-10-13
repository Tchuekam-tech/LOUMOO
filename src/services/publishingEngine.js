/**
 * LOUMOO — Publishing Engine
 * ===========================================================================
 * ONE core behind everything a seller can put in front of buyers.
 *
 *      Sell  ->  intent  ->  sections  ->  fields  ->  validation
 *                                              |
 *                                       normalized Publication
 *                                          /            \
 *                                  API payload      feed card
 *
 * The two branches at the bottom are the point of this file. The preview and
 * the real feed are fed by the SAME `toFeedCard()` projection, so a preview
 * cannot flatter a listing the feed will render differently. Create, draft,
 * edit and preview are four entry points into one pipeline, not four forms.
 *
 * What lives here:
 *   - the intent catalogue (product / service / broadcast)
 *   - section and field definitions, including conditional visibility
 *   - client-side validation that mirrors ListingValidationService and
 *     Announcement.validate — the server stays authoritative, this only makes
 *     the failure arrive before the round trip
 *   - readiness scoring, so "3 things need attention" is computed, not guessed
 *   - draft persistence (localStorage), so a refresh does not cost work
 *   - the canonical PublicationCard projection
 *
 * What does NOT live here: anything that decides whether the seller is allowed
 * to publish. That is the server's, every time.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LoumooPublishing = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════ */
  /* 1. INTENTS — what the seller is actually publishing                     */
  /* ══════════════════════════════════════════════════════════════════════ */

  var INTENTS = {
    PRODUCT: {
      key: 'PRODUCT',
      label: 'Product or inventory',
      blurb: 'Something a buyer pays for and receives.',
      examples: 'Phones, fashion, food, vehicles, property, spare parts, wholesale stock',
      surface: 'listing',
      listingTypes: ['PHYSICAL_PRODUCT', 'DIGITAL_PRODUCT', 'BUNDLE', 'RENTAL'],
      defaultListingType: 'PHYSICAL_PRODUCT'
    },
    SERVICE: {
      key: 'SERVICE',
      label: 'Service or booking',
      blurb: 'Something a buyer books, requests or hires you for.',
      examples: 'Repairs, beauty, photography, consulting, transport, accommodation',
      surface: 'listing',
      listingTypes: ['SERVICE', 'BOOKING', 'SUBSCRIPTION'],
      defaultListingType: 'SERVICE'
    },
    BROADCAST: {
      key: 'BROADCAST',
      label: 'Broadcast',
      blurb: 'Something you want people to know.',
      examples: 'Promotions, new arrivals, events, store updates, jobs, tenders',
      surface: 'announcement',
      listingTypes: [],
      defaultListingType: null
    }
  };

  /** Which intents a boutique of a given vertical may publish. */
  var STORE_VERTICAL_INTENTS = {
    services: ['SERVICE', 'BROADCAST'],
    education: ['SERVICE', 'BROADCAST'],
    professional: ['SERVICE', 'BROADCAST'],
    banks: ['SERVICE', 'BROADCAST'],
    hotels: ['SERVICE', 'BROADCAST'],
    hospitality: ['SERVICE', 'BROADCAST'],
    travel: ['SERVICE', 'BROADCAST']
  };

  var DEFAULT_INTENTS = ['PRODUCT', 'BROADCAST'];

  function intentsForStore(storeCategoryId) {
    var key = String(storeCategoryId || '').toLowerCase();
    var keys = STORE_VERTICAL_INTENTS[key] || DEFAULT_INTENTS;
    return keys.map(function (k) { return INTENTS[k]; });
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  /* 2. STATIC OPTION SETS                                                   */
  /*    Mirrors of the server enums. Served values win when the client has   */
  /*    fetched GET /api/v1/listings/schema; these are the offline fallback. */
  /* ══════════════════════════════════════════════════════════════════════ */

  var CONDITIONS = [
    { value: 'new', label: 'New' },
    { value: 'refurbished', label: 'Refurbished' },
    { value: 'used_like_new', label: 'Used — like new' },
    { value: 'used_good', label: 'Used — good' },
    { value: 'pre_owned', label: 'Pre-owned' },
    { value: 'not_applicable', label: 'Not applicable' }
  ];

  var PRICE_MODES_PRODUCT = [
    { value: 'FIXED', label: 'Fixed price', hint: 'One price, shown as-is.' },
    { value: 'FROM', label: 'Starting from', hint: 'The lowest of several prices.' },
    { value: 'QUOTE', label: 'Price on request', hint: 'Buyers ask; no price is shown.' },
    { value: 'FREE', label: 'Free', hint: 'Giveaway or no-charge item.' }
  ];

  var PRICE_MODES_SERVICE = [
    { value: 'FIXED', label: 'Fixed price' },
    { value: 'FROM', label: 'Starting from' },
    { value: 'HOURLY', label: 'Per hour' },
    { value: 'DAILY', label: 'Per day' },
    { value: 'PER_PERSON', label: 'Per person' },
    { value: 'QUOTE', label: 'Quote on request' }
  ];

  var SERVICE_FORMATS = [
    { value: 'APPOINTMENT', label: 'Appointment', hint: 'Buyers pick a time slot.' },
    { value: 'BOOKING', label: 'Booking', hint: 'Buyers reserve dates.' },
    { value: 'ONE_TIME', label: 'One-off job', hint: 'Arranged directly, no calendar.' },
    { value: 'RECURRING', label: 'Recurring', hint: 'Repeats on a schedule.' },
    { value: 'ON_DEMAND', label: 'On demand', hint: 'Whenever you have capacity.' },
    { value: 'QUOTE', label: 'Quote first', hint: 'Scope agreed before any booking.' }
  ];

  var SERVICE_LOCATION_MODES = [
    { value: 'AT_SELLER', label: 'At my location' },
    { value: 'AT_CUSTOMER', label: 'I travel to the customer' },
    { value: 'REMOTE', label: 'Online / remote' },
    { value: 'HYBRID', label: 'Either' }
  ];

  var BOOKING_MODES = [
    { value: 'INSTANT', label: 'Instant booking', hint: 'Confirmed without you lifting a finger.' },
    { value: 'REQUEST', label: 'Request to book', hint: 'You approve each request.' },
    { value: 'ENQUIRY', label: 'Enquiry only', hint: 'Buyers message you first.' }
  ];

  var DELIVERY_SCOPES = [
    { value: 'LOCAL', label: 'My neighbourhood' },
    { value: 'CITY', label: 'Across my city' },
    { value: 'REGIONAL', label: 'My region' },
    { value: 'NATIONWIDE', label: 'Anywhere in Cameroon' },
    { value: 'CROSS_BORDER', label: 'CEMAC / cross-border' }
  ];

  var RETURN_POLICIES = [
    { value: 'NONE', label: 'No returns' },
    { value: 'EXCHANGE_ONLY', label: 'Exchange only' },
    { value: 'DAYS_3', label: '3-day returns' },
    { value: 'DAYS_7', label: '7-day returns' },
    { value: 'DAYS_14', label: '14-day returns' },
    { value: 'DAYS_30', label: '30-day returns' }
  ];

  var PAYMENT_METHODS = [
    { value: 'MOMO', label: 'MTN MoMo' },
    { value: 'ORANGE_MONEY', label: 'Orange Money' },
    { value: 'CASH_ON_DELIVERY', label: 'Cash on delivery' },
    { value: 'CARD', label: 'Card' },
    { value: 'BANK_TRANSFER', label: 'Bank transfer' },
    { value: 'ESCROW', label: 'LOUMOO escrow' }
  ];

  var AUDIENCE_SCOPES = [
    { value: 'EVERYONE', label: 'Everyone on LOUMOO' },
    { value: 'FOLLOWERS', label: 'People who follow my boutique' },
    { value: 'PREVIOUS_BUYERS', label: 'People who bought from me' },
    { value: 'TARGETED', label: 'Specific cities' }
  ];

  var CTA_TYPES = [
    { value: 'BUY_NOW', label: 'Buy now' },
    { value: 'VIEW_PRODUCT', label: 'View product' },
    { value: 'BOOK_SERVICE', label: 'Book service' },
    { value: 'CONTACT_SELLER', label: 'Contact seller' },
    { value: 'VIEW_STORE', label: 'Visit boutique' },
    { value: 'FOLLOW_SELLER', label: 'Follow boutique' },
    { value: 'LEARN_MORE', label: 'Learn more' },
    { value: 'REGISTER', label: 'Register' },
    { value: 'APPLY_NOW', label: 'Apply now' }
  ];

  var CITIES = [
    'Douala', 'Yaoundé', 'Bafoussam', 'Bamenda', 'Garoua', 'Maroua',
    'Ngaoundéré', 'Bertoua', 'Buea', 'Limbe', 'Kribi', 'Ebolowa', 'Kumba', 'Edéa'
  ];

  var WEEKDAYS = [
    { key: 'monday', label: 'Mon' },
    { key: 'tuesday', label: 'Tue' },
    { key: 'wednesday', label: 'Wed' },
    { key: 'thursday', label: 'Thu' },
    { key: 'friday', label: 'Fri' },
    { key: 'saturday', label: 'Sat' },
    { key: 'sunday', label: 'Sun' }
  ];

  var EXPIRY_PRESETS = [
    { value: '', label: 'No end date' },
    { value: '48', label: 'Ends in 48 hours' },
    { value: '168', label: 'Ends in 7 days' },
    { value: '720', label: 'Ends in 30 days' }
  ];

  /* ══════════════════════════════════════════════════════════════════════ */
  /* 3. DRAFT STATE                                                          */
  /* ══════════════════════════════════════════════════════════════════════ */

  var DRAFT_STORAGE_KEY = 'loumoo_publishing_draft_v1';

  /**
   * A draft is one flat-ish object. Everything the studio edits lives under
   * `values`; everything about where it came from lives beside it.
   */
  function createDraft(intent, context) {
    var ctx = context || {};
    var now = new Date().toISOString();

    var values = {
      // Identity
      listingType: (INTENTS[intent] || INTENTS.PRODUCT).defaultListingType,
      categoryId: '',
      parentCategoryId: '',
      title: '',
      shortDescription: '',
      description: '',
      brand: '',
      model: '',
      sku: '',
      condition: intent === 'SERVICE' ? 'not_applicable' : 'new',
      tags: [],
      attributes: {},

      // Money
      currency: ctx.currency || 'XAF',
      priceMode: 'FIXED',
      basePrice: '',
      salePrice: '',
      compareAtPrice: '',
      negotiable: false,
      minOrderQuantity: '',
      wholesalePrice: '',

      // Stock
      trackInventory: intent === 'PRODUCT',
      quantity: '',
      lowStockThreshold: '3',
      allowBackorder: false,
      variantOptions: {},

      // Fulfilment
      delivery: intent === 'PRODUCT',
      pickup: false,
      deliveryScope: 'CITY',
      deliveryZones: [],
      etaText: '',
      deliveryFee: '',
      freeDeliveryOver: '',
      pickupAddress: '',

      // Service
      serviceFormat: 'APPOINTMENT',
      durationMinutes: '',
      locationMode: 'AT_SELLER',
      serviceAreas: [],
      includes: [],
      excludes: [],
      bookingMode: 'REQUEST',
      capacity: '',
      minParticipants: '',
      leadTimeHours: '2',
      weeklySchedule: defaultSchedule(),
      blackoutDates: [],
      cancellationPolicy: '',

      // Trust
      warranty: '',
      returnPolicy: '',
      authenticity: '',
      paymentMethods: [],
      availableFrom: '',

      // Discovery
      city: ctx.storeCity || '',
      neighbourhood: '',
      contactPhone: ctx.storePhone || '',
      visibility: 'PUBLIC',

      // Broadcast
      broadcastType: 'PROMOTION',
      body: '',
      highlights: [],
      broadcastFields: {},
      attachmentType: 'NONE',
      attachmentId: '',
      ctaType: '',
      ctaLabel: '',
      audienceScope: 'EVERYONE',
      targetCities: [],
      publishMode: 'NOW',
      scheduledFor: '',
      expiresInHours: ''
    };

    return {
      intent: intent,
      values: values,
      media: [],                 // [{uploadId,url,width,height,status,name}]
      remoteId: null,            // listing id / announcement id once created
      remoteStatus: 'NEW',       // NEW | DRAFT | PUBLISHED | PAUSED | SCHEDULED
      mode: 'create',            // create | edit
      activeSection: null,
      touched: {},
      createdAt: now,
      updatedAt: now,
      savedAt: null
    };
  }

  function defaultSchedule() {
    return {
      monday: [{ start: '08:00', end: '18:00' }],
      tuesday: [{ start: '08:00', end: '18:00' }],
      wednesday: [{ start: '08:00', end: '18:00' }],
      thursday: [{ start: '08:00', end: '18:00' }],
      friday: [{ start: '08:00', end: '18:00' }],
      saturday: [{ start: '09:00', end: '14:00' }],
      sunday: []
    };
  }

  /** Immutable-enough field write. Paths are one or two segments deep. */
  function setValue(draft, path, value) {
    var next = shallowClone(draft);
    next.values = shallowClone(draft.values);
    next.touched = shallowClone(draft.touched);
    next.touched[path] = true;
    next.updatedAt = new Date().toISOString();

    // Changing the category (or the broadcast type) changes which fields EXIST.
    // Answers to the old set are not merely stale, they are rejected outright:
    // the server refuses an attribute the new category does not define, and a
    // metadata key the new broadcast type does not define. Clearing them here
    // is what stops a seller who reconsiders their category from being unable
    // to save at all.
    if (path === 'categoryId' && value !== draft.values.categoryId) {
      next.values.attributes = {};
      next.values.variantOptions = {};
    }
    if (path === 'broadcastType' && value !== draft.values.broadcastType) {
      next.values.broadcastFields = {};
      // The CTA defaults per type, so a CTA the seller never chose should not
      // survive into a type where it makes no sense.
      next.values.ctaType = '';
    }

    var dot = path.indexOf('.');
    if (dot === -1) {
      next.values[path] = value;
      return next;
    }

    var head = path.slice(0, dot);
    var tail = path.slice(dot + 1);
    next.values[head] = shallowClone(next.values[head] || {});
    next.values[head][tail] = value;
    return next;
  }

  function getValue(draft, path) {
    var dot = path.indexOf('.');
    if (dot === -1) return draft.values[path];
    var head = draft.values[path.slice(0, dot)];
    return head ? head[path.slice(dot + 1)] : undefined;
  }

  function shallowClone(obj) {
    var out = {};
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  /* 4. SECTIONS & FIELDS                                                    */
  /*    Progressive disclosure lives here: a section whose `when` is false    */
  /*    is not hidden, it does not exist.                                     */
  /* ══════════════════════════════════════════════════════════════════════ */

  /**
   * @param {object} draft
   * @param {object} ctx  { categorySchema, taxonomy, broadcastSchema, store }
   * @returns {Array} sections, each with resolved, visible fields
   */
  function sections(draft, ctx) {
    ctx = ctx || {};
    var v = draft.values;
    var out = [];

    if (draft.intent === 'BROADCAST') {
      out = broadcastSections(draft, ctx);
    } else if (draft.intent === 'SERVICE') {
      out = serviceSections(draft, ctx);
    } else {
      out = productSections(draft, ctx);
    }

    // Resolve visibility, then attach per-section completion.
    return out.map(function (section) {
      var fields = (section.fields || []).filter(function (f) {
        return f.when === undefined || f.when === true;
      });
      return {
        key: section.key,
        label: section.label,
        hint: section.hint,
        icon: section.icon,
        fields: fields
      };
    }).filter(function (s) { return s.fields.length > 0 || s.key === 'media'; });
  }

  /* ---------------------------------------------------------- PRODUCT ---- */

  function productSections(draft, ctx) {
    var v = draft.values;
    var schema = ctx.categorySchema || null;
    var isDigital = v.listingType === 'DIGITAL_PRODUCT';
    var hasPrice = v.priceMode !== 'QUOTE' && v.priceMode !== 'FREE';

    return [
      {
        key: 'what', label: 'What it is', icon: 'box',
        hint: 'Buyers scan the category before they read anything else.',
        fields: [
          field('categoryId', 'Category', 'category', {
            required: true,
            help: 'Pick the most specific match — it decides which details buyers can filter on.'
          }),
          field('condition', 'Condition', 'select', {
            required: true, options: CONDITIONS,
            when: v.listingType !== 'DIGITAL_PRODUCT'
          })
        ]
      },
      {
        key: 'basics', label: 'Tell buyers what it is', icon: 'type',
        hint: 'A clear title and an honest description do most of the selling.',
        fields: [
          field('title', 'Title', 'text', {
            required: true, minLength: 8, maxLength: 255,
            placeholder: 'e.g. iPhone 14 Pro 256GB — Deep Purple, sealed',
            help: 'What it is, the detail that matters most, then the condition.'
          }),
          field('brand', 'Brand', 'text', { maxLength: 128, placeholder: 'Optional' }),
          field('model', 'Model', 'text', { maxLength: 128, placeholder: 'Optional' }),
          field('description', 'Description', 'longtext', {
            required: true, minLength: 30, maxLength: 20000,
            placeholder: 'Condition, what is included, warranty, anything a buyer would ask.',
            help: 'At least 30 characters. Say what is included and what is not.'
          }),
          field('tags', 'Search keywords', 'chips', {
            maxItems: 20, placeholder: 'Add a keyword and press Enter',
            help: 'Words buyers would actually type.'
          }),
          field('sku', 'Your reference', 'text', { maxLength: 128, placeholder: 'Optional internal code', advanced: true })
        ]
      },
      {
        key: 'specs', label: 'Specifications', icon: 'list',
        hint: schema
          ? 'What buyers filter on in ' + schema.categoryName + '.'
          : 'Choose a category to see what buyers filter on.',
        fields: attributeFields(schema, v.attributes)
      },
      {
        key: 'media', label: 'Photos', icon: 'image',
        hint: 'The first photo is what stops the scroll. Use it well.',
        fields: [field('__media', 'Photos', 'media', { required: true })]
      },
      {
        key: 'price', label: 'Set your price', icon: 'tag',
        hint: 'One price story per listing.',
        fields: [
          field('priceMode', 'How is it priced', 'segmented', {
            required: true, options: PRICE_MODES_PRODUCT
          }),
          field('basePrice', v.priceMode === 'FROM' ? 'Starting price' : 'Price', 'money', {
            required: hasPrice, when: hasPrice, currency: v.currency
          }),
          field('salePrice', 'Sale price', 'money', {
            when: hasPrice, currency: v.currency,
            help: 'Leave empty unless it is on offer. Must be below the price.'
          }),
          field('compareAtPrice', 'Compare-at price', 'money', {
            when: hasPrice, currency: v.currency, advanced: true,
            help: 'The higher price you are beating. Shown struck through.'
          }),
          field('negotiable', 'Price is negotiable', 'toggle', { when: hasPrice }),
          field('minOrderQuantity', 'Minimum order', 'number', { min: 1, advanced: true, placeholder: '1' }),
          field('wholesalePrice', 'Wholesale price', 'money', {
            when: hasPrice, currency: v.currency, advanced: true,
            help: 'Shown to buyers ordering at or above the minimum.'
          })
        ]
      },
      {
        key: 'stock', label: 'Stock', icon: 'layers',
        hint: 'LOUMOO hides a listing when it runs out, so buyers never order what you do not have.',
        fields: [
          field('trackInventory', 'Track stock for this listing', 'toggle', {}),
          field('quantity', 'Quantity available', 'number', {
            required: v.trackInventory, when: v.trackInventory, min: 0
          }),
          field('lowStockThreshold', 'Warn me at', 'number', {
            when: v.trackInventory, min: 0, advanced: true,
            help: 'You get a low-stock nudge at this level.'
          }),
          field('allowBackorder', 'Accept orders when out of stock', 'toggle', {
            when: v.trackInventory, advanced: true
          }),
          field('variantOptions', 'Variants', 'variants', {
            when: Boolean(schema && variantOptionsOf(schema).length),
            options: schema ? variantOptionsOf(schema) : [],
            help: 'Sizes, colours or capacities that are priced and stocked separately.'
          })
        ]
      },
      {
        key: 'delivery', label: 'How buyers get it', icon: 'truck',
        hint: 'A listing with no way to receive it cannot be published.',
        fields: isDigital ? [
          field('etaText', 'Delivery note', 'text', {
            maxLength: 120, placeholder: 'e.g. Download link sent immediately'
          })
        ] : [
          field('delivery', 'I deliver', 'toggle', {}),
          field('deliveryScope', 'How far', 'select', {
            when: v.delivery, options: DELIVERY_SCOPES, required: v.delivery
          }),
          field('deliveryZones', 'Specific areas', 'chips', {
            when: v.delivery, suggestions: CITIES,
            placeholder: 'Add a city or neighbourhood',
            help: 'Optional if you already chose how far you go.'
          }),
          field('etaText', 'Typical delivery time', 'text', {
            when: v.delivery, maxLength: 120, placeholder: 'e.g. Same day in Douala, 2 days elsewhere'
          }),
          field('deliveryFee', 'Delivery fee', 'money', { when: v.delivery, currency: v.currency }),
          field('freeDeliveryOver', 'Free delivery over', 'money', {
            when: v.delivery, currency: v.currency, advanced: true
          }),
          field('pickup', 'Buyers can collect', 'toggle', {}),
          field('pickupAddress', 'Collection address', 'text', {
            when: v.pickup, required: v.pickup, maxLength: 240,
            placeholder: 'e.g. Rue Njo-Njo, Bonapriso, Douala'
          })
        ]
      },
      {
        key: 'trust', label: 'Trust and payment', icon: 'shield',
        hint: 'Optional, but these are the questions buyers message you to ask.',
        fields: [
          field('warranty', 'Warranty', 'text', { maxLength: 160, placeholder: 'e.g. 12 months official warranty' }),
          field('returnPolicy', 'Returns', 'select', { options: RETURN_POLICIES }),
          field('authenticity', 'Authenticity', 'text', {
            maxLength: 160, placeholder: 'e.g. Official Apple reseller, receipt included', advanced: true
          }),
          field('paymentMethods', 'Payment accepted', 'multiselect', { options: PAYMENT_METHODS }),
          field('availableFrom', 'Available from', 'date', { advanced: true })
        ]
      },
      {
        key: 'discovery', label: 'Where it shows up', icon: 'map-pin',
        hint: 'Prefilled from your boutique. Change it only if this listing is somewhere else.',
        fields: [
          field('city', 'City', 'select', { required: true, options: CITIES.map(toOption) }),
          field('neighbourhood', 'Neighbourhood', 'text', { maxLength: 120, placeholder: 'e.g. Akwa' }),
          field('contactPhone', 'Contact number', 'text', { maxLength: 32, placeholder: '+237…' }),
          field('visibility', 'Visibility', 'select', {
            advanced: true,
            options: [
              { value: 'PUBLIC', label: 'Public — anyone can find it' },
              { value: 'UNLISTED', label: 'Unlisted — only people with the link' },
              { value: 'PRIVATE', label: 'Private — only me' }
            ]
          })
        ]
      }
    ];
  }

  /* ---------------------------------------------------------- SERVICE ---- */

  function serviceSections(draft, ctx) {
    var v = draft.values;
    var schema = ctx.categorySchema || null;
    var needsSchedule = v.serviceFormat === 'APPOINTMENT'
      || v.serviceFormat === 'BOOKING' || v.serviceFormat === 'RECURRING';
    var travels = v.locationMode === 'AT_CUSTOMER' || v.locationMode === 'HYBRID';
    var hasPrice = v.priceMode !== 'QUOTE';

    return [
      {
        key: 'what', label: 'What you offer', icon: 'wrench',
        hint: 'How the service is transacted decides what LOUMOO asks for next.',
        fields: [
          field('categoryId', 'Category', 'category', { required: true }),
          field('serviceFormat', 'How is it booked', 'radiocards', {
            required: true, options: SERVICE_FORMATS
          })
        ]
      },
      {
        key: 'basics', label: 'Describe the service', icon: 'type',
        hint: 'What is included matters more than adjectives.',
        fields: [
          field('title', 'Service name', 'text', {
            required: true, minLength: 8, maxLength: 255,
            placeholder: 'e.g. iPhone screen replacement — same day'
          }),
          field('description', 'Description', 'longtext', {
            required: true, minLength: 30, maxLength: 20000,
            placeholder: 'What you do, how it works, what the customer should expect.'
          }),
          field('includes', "What's included", 'chips', {
            maxItems: 12, placeholder: 'Add an item and press Enter',
            help: 'Each one becomes a tick on your listing.'
          }),
          field('excludes', "What's not included", 'chips', {
            maxItems: 12, placeholder: 'Add an exclusion and press Enter'
          }),
          field('tags', 'Search keywords', 'chips', { maxItems: 20, advanced: true })
        ]
      },
      {
        key: 'specs', label: 'Details', icon: 'list',
        hint: schema ? 'Specific to ' + schema.categoryName + '.' : '',
        fields: attributeFields(schema, v.attributes)
      },
      {
        key: 'media', label: 'Photos', icon: 'image',
        hint: 'Show your work, your space, or your team.',
        fields: [field('__media', 'Photos', 'media', { required: true })]
      },
      {
        key: 'availability', label: 'When you are available', icon: 'clock',
        hint: needsSchedule
          ? 'Buyers can only book inside these hours.'
          : 'Optional for a service arranged directly.',
        fields: [
          field('durationMinutes', 'How long does one booking last', 'duration', {
            required: needsSchedule, when: needsSchedule
          }),
          field('weeklySchedule', 'Weekly hours', 'schedule', {
            required: needsSchedule, when: needsSchedule
          }),
          field('leadTimeHours', 'Minimum notice', 'number', {
            when: needsSchedule, min: 0, unit: 'hours', advanced: true,
            help: 'How far ahead a buyer must book.'
          }),
          field('blackoutDates', 'Dates you are closed', 'chips', {
            when: needsSchedule, advanced: true, placeholder: 'YYYY-MM-DD'
          })
        ]
      },
      {
        key: 'location', label: 'Where it happens', icon: 'map-pin',
        hint: '',
        fields: [
          field('locationMode', 'Where do you work', 'radiocards', {
            required: true, options: SERVICE_LOCATION_MODES
          }),
          field('serviceAreas', 'Areas you cover', 'chips', {
            when: travels, required: travels, suggestions: CITIES,
            placeholder: 'Add a city or neighbourhood'
          }),
          field('pickupAddress', 'Your address', 'text', {
            when: v.locationMode === 'AT_SELLER' || v.locationMode === 'HYBRID',
            maxLength: 240, placeholder: 'Where customers come to you'
          })
        ]
      },
      {
        key: 'price', label: 'Set your price', icon: 'tag',
        hint: '',
        fields: [
          field('priceMode', 'How is it priced', 'segmented', {
            required: true, options: PRICE_MODES_SERVICE
          }),
          field('basePrice', priceLabelForMode(v.priceMode), 'money', {
            required: hasPrice, when: hasPrice, currency: v.currency
          }),
          field('salePrice', 'Promotional price', 'money', {
            when: hasPrice, currency: v.currency, advanced: true
          }),
          field('negotiable', 'Price is negotiable', 'toggle', { when: hasPrice })
        ]
      },
      {
        key: 'booking', label: 'Booking rules', icon: 'check-circle',
        hint: '',
        fields: [
          field('bookingMode', 'How are requests handled', 'radiocards', {
            required: true, options: BOOKING_MODES
          }),
          field('capacity', 'Maximum people per booking', 'number', { min: 1, advanced: true }),
          field('minParticipants', 'Minimum people', 'number', { min: 1, advanced: true }),
          field('cancellationPolicy', 'Cancellation policy', 'longtext', {
            maxLength: 500, placeholder: 'e.g. Free cancellation up to 24 hours before.'
          })
        ]
      },
      {
        key: 'discovery', label: 'Where it shows up', icon: 'compass',
        hint: 'Prefilled from your boutique.',
        fields: [
          field('city', 'Base city', 'select', { required: true, options: CITIES.map(toOption) }),
          field('neighbourhood', 'Neighbourhood', 'text', { maxLength: 120 }),
          field('contactPhone', 'Contact number', 'text', { maxLength: 32 }),
          field('paymentMethods', 'Payment accepted', 'multiselect', { options: PAYMENT_METHODS })
        ]
      }
    ];
  }

  function priceLabelForMode(mode) {
    if (mode === 'HOURLY') return 'Price per hour';
    if (mode === 'DAILY') return 'Price per day';
    if (mode === 'PER_PERSON') return 'Price per person';
    if (mode === 'FROM') return 'Starting price';
    return 'Price';
  }

  /* -------------------------------------------------------- BROADCAST ---- */

  function broadcastSections(draft, ctx) {
    var v = draft.values;
    var def = broadcastDefinition(ctx, v.broadcastType);
    var isScheduled = v.publishMode === 'SCHEDULE';

    return [
      {
        key: 'what', label: 'What are you announcing', icon: 'megaphone',
        hint: 'Each kind of broadcast asks for what it actually needs.',
        fields: [
          field('broadcastType', 'Type', 'radiocards', {
            required: true,
            options: (ctx.broadcastSchema && ctx.broadcastSchema.types
              ? ctx.broadcastSchema.types
              : []).map(function (t) {
              return { value: t.type, label: t.label, hint: t.blurb };
            })
          })
        ]
      },
      {
        key: 'message', label: 'Your message', icon: 'type',
        hint: 'Short and specific beats long and general.',
        fields: [
          field('title', 'Headline', 'text', {
            required: true, minLength: 3, maxLength: 255,
            placeholder: 'e.g. Weekend flash sale — 50 000 XAF off every MacBook'
          }),
          field('body', 'Message', 'longtext', {
            required: true, minLength: 10, maxLength: 8000,
            placeholder: 'The offer, the dates, where to find you.'
          }),
          field('highlights', 'Highlights', 'chips', {
            maxItems: 6, placeholder: 'Add a highlight and press Enter',
            help: 'Shown as tick marks on the card. Three is plenty.'
          })
        ]
      },
      {
        key: 'details', label: def ? def.label : 'Details', icon: 'list',
        hint: def ? def.blurb : '',
        fields: (def ? def.fields : []).map(function (f) {
          return field('broadcastFields.' + f.key, f.label, mapBroadcastFieldType(f), {
            required: Boolean(f.required),
            options: f.options || null,
            placeholder: f.placeholder || '',
            maxLength: f.maxLength,
            min: f.min, max: f.max, unit: f.unit,
            currency: v.currency
          });
        })
      },
      {
        key: 'media', label: 'Image', icon: 'image',
        hint: 'A broadcast with an image gets read. One is usually enough.',
        fields: [field('__media', 'Images', 'media', {})]
      },
      {
        key: 'link', label: 'What should people do', icon: 'mouse-pointer',
        hint: 'Attach a listing and the card carries its live price and photo.',
        fields: [
          field('attachmentId', 'Attach a listing', 'listingpicker', {
            help: 'Optional. Pulls the live price, photo and stock from your catalogue.'
          }),
          field('ctaType', 'Button', 'select', {
            options: CTA_TYPES,
            help: def ? 'Defaults to ' + labelFor(CTA_TYPES, def.defaultCta) + ' for this type.' : ''
          }),
          field('ctaLabel', 'Button text', 'text', {
            maxLength: 40, advanced: true, placeholder: 'Leave blank to use the default'
          })
        ]
      },
      {
        key: 'audience', label: 'Who sees it', icon: 'users',
        hint: '',
        fields: [
          field('audienceScope', 'Audience', 'radiocards', {
            required: true, options: AUDIENCE_SCOPES
          }),
          field('targetCities', 'Cities', 'chips', {
            when: v.audienceScope === 'TARGETED',
            required: v.audienceScope === 'TARGETED',
            suggestions: CITIES, placeholder: 'Add a city'
          })
        ]
      },
      {
        key: 'schedule', label: 'When it runs', icon: 'calendar',
        hint: def && def.needsWindow
          ? 'A time-limited offer needs an end date.'
          : 'Publish now, or pick a time.',
        fields: [
          field('publishMode', 'Publishing', 'segmented', {
            required: true,
            options: [
              { value: 'NOW', label: 'Publish now' },
              { value: 'SCHEDULE', label: 'Schedule' }
            ]
          }),
          field('scheduledFor', 'Goes live', 'datetime', {
            when: isScheduled, required: isScheduled
          }),
          field('expiresInHours', 'Runs for', 'select', {
            required: Boolean(def && def.needsWindow),
            options: EXPIRY_PRESETS
          })
        ]
      }
    ];
  }

  function broadcastDefinition(ctx, type) {
    var types = (ctx && ctx.broadcastSchema && ctx.broadcastSchema.types) || [];
    for (var i = 0; i < types.length; i++) {
      if (types[i].type === type) return types[i];
    }
    return null;
  }

  function mapBroadcastFieldType(f) {
    if (f.type === 'money') return 'money';
    if (f.type === 'longtext') return 'longtext';
    if (f.type === 'select') return 'select';
    if (f.type === 'number') return 'number';
    if (f.type === 'date') return 'date';
    if (f.type === 'time') return 'time';
    return 'text';
  }

  /* ------------------------------------------------- field construction -- */

  function field(path, label, type, opts) {
    opts = opts || {};
    return {
      path: path,
      key: path.replace(/\./g, '__'),
      label: label,
      type: type,
      required: Boolean(opts.required),
      advanced: Boolean(opts.advanced),
      when: opts.when,
      options: opts.options || null,
      suggestions: opts.suggestions || null,
      placeholder: opts.placeholder || '',
      help: opts.help || '',
      unit: opts.unit || '',
      currency: opts.currency || '',
      minLength: opts.minLength,
      maxLength: opts.maxLength,
      min: opts.min,
      max: opts.max,
      maxItems: opts.maxItems
    };
  }

  /** Turns the server's category attribute definitions into studio fields. */
  function attributeFields(schema, current) {
    if (!schema || !schema.attributes) return [];
    return schema.attributes.map(function (attr) {
      var type = 'text';
      if (attr.attributeType === 'longtext') type = 'longtext';
      else if (attr.attributeType === 'number' || attr.attributeType === 'decimal') type = 'number';
      else if (attr.attributeType === 'boolean') type = 'toggle';
      else if (attr.attributeType === 'select') type = 'select';
      else if (attr.attributeType === 'multi_select') type = 'multiselect';

      return field('attributes.' + attr.slug, attr.name, type, {
        required: attr.isRequired,
        options: (attr.allowedValues || []).map(toOption),
        unit: attr.unit || '',
        min: attr.validationRules ? attr.validationRules.min : undefined,
        max: attr.validationRules ? attr.validationRules.max : undefined,
        maxLength: attr.validationRules ? attr.validationRules.maxLength : undefined,
        help: attr.isVariantOption ? 'Can also be used to build variants.' : ''
      });
    });
  }

  function variantOptionsOf(schema) {
    if (!schema || !schema.attributes) return [];
    return schema.attributes.filter(function (a) { return a.isVariantOption; })
      .map(function (a) {
        return {
          slug: a.slug,
          name: a.name,
          values: (a.allowedValues || []).map(String)
        };
      });
  }

  function toOption(v) {
    if (v && typeof v === 'object') return { value: v.value || v.id, label: v.label || v.name || v.id };
    return { value: String(v), label: String(v) };
  }

  function labelFor(options, value) {
    for (var i = 0; i < (options || []).length; i++) {
      if (options[i].value === value) return options[i].label;
    }
    return value || '';
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  /* 5. VALIDATION                                                           */
  /*    Mirrors the server. The server still decides; this only means the    */
  /*    seller finds out before the round trip.                              */
  /* ══════════════════════════════════════════════════════════════════════ */

  function validate(draft, ctx, options) {
    options = options || {};
    var forPublish = options.forPublish !== false;
    var v = draft.values;
    var errors = {};
    var warnings = [];

    function fail(path, message) {
      if (!errors[path]) errors[path] = message;
    }

    var allSections = sections(draft, ctx);

    // Generic, definition-driven rules first.
    allSections.forEach(function (section) {
      section.fields.forEach(function (f) {
        if (f.type === 'media') return;
        var val = getValue(draft, f.path);
        var empty = val === undefined || val === null || val === ''
          || (Array.isArray(val) && val.length === 0);

        if (f.required && empty && forPublish) {
          fail(f.path, f.label + ' is needed before you can publish.');
          return;
        }
        if (empty) return;

        if (f.minLength && String(val).trim().length < f.minLength) {
          fail(f.path, f.label + ' needs at least ' + f.minLength + ' characters.');
        }
        if (f.maxLength && String(val).length > f.maxLength) {
          fail(f.path, f.label + ' cannot exceed ' + f.maxLength + ' characters.');
        }
        if (f.type === 'number' || f.type === 'money') {
          var num = toNumber(val);
          if (num === null) fail(f.path, f.label + ' must be a number.');
          else {
            if (f.min !== undefined && num < f.min) fail(f.path, f.label + ' cannot be below ' + f.min + '.');
            if (f.max !== undefined && num > f.max) fail(f.path, f.label + ' cannot exceed ' + f.max + '.');
          }
        }
        if (f.type === 'select' && f.options && f.options.length) {
          var ok = f.options.some(function (o) { return String(o.value) === String(val); });
          if (!ok) fail(f.path, 'Choose one of the listed options for ' + f.label + '.');
        }
      });
    });

    // Media.
    if (draft.intent !== 'BROADCAST' && forPublish && draft.media.length === 0) {
      fail('__media', 'Add at least one photo before publishing.');
    }
    if (draft.media.length > 12) {
      fail('__media', 'A listing can carry at most 12 photos.');
    }
    if (draft.media.some(function (m) { return m.status === 'error'; })) {
      fail('__media', 'One of your photos failed to upload. Remove or retry it.');
    }

    // Type-specific cross-field rules.
    if (draft.intent === 'BROADCAST') {
      validateBroadcast(draft, ctx, fail, warnings, forPublish);
    } else {
      validateListing(draft, ctx, fail, warnings, forPublish);
    }

    var blockers = Object.keys(errors).map(function (path) {
      return { path: path, message: errors[path], section: sectionOf(allSections, path) };
    });

    return { errors: errors, blockers: blockers, warnings: warnings, valid: blockers.length === 0 };
  }

  function validateListing(draft, ctx, fail, warnings, forPublish) {
    var v = draft.values;
    var base = toNumber(v.basePrice);
    var sale = toNumber(v.salePrice);
    var compare = toNumber(v.compareAtPrice);
    var wholesale = toNumber(v.wholesalePrice);
    var hasPrice = v.priceMode !== 'QUOTE' && v.priceMode !== 'FREE';

    if (hasPrice && forPublish && !base) {
      fail('basePrice', 'Set a price above zero, or switch to "Price on request".');
    }
    if (sale !== null && base !== null && sale >= base) {
      fail('salePrice', 'The sale price must be lower than the price.');
    }
    if (compare !== null && base !== null && compare < base) {
      fail('compareAtPrice', 'The compare-at price cannot be below your price.');
    }
    if (wholesale !== null && base !== null && wholesale > base) {
      fail('wholesalePrice', 'The wholesale price cannot be above the retail price.');
    }
    if (!hasPrice && base) {
      fail('basePrice', v.priceMode === 'FREE'
        ? 'A free listing cannot also carry a price.'
        : 'A quote-on-request listing cannot also show a price.');
    }

    if (draft.intent === 'PRODUCT' && v.listingType !== 'DIGITAL_PRODUCT') {
      if (forPublish && !v.delivery && !v.pickup) {
        fail('delivery', 'Choose at least one way buyers can receive this.');
      }
      if (v.delivery && !v.deliveryScope && (v.deliveryZones || []).length === 0) {
        fail('deliveryZones', 'You offer delivery — say where you deliver to.');
      }
      if (v.pickup && !v.pickupAddress) {
        fail('pickupAddress', 'You offer collection — buyers need the address.');
      }
      if (v.freeDeliveryOver && !v.delivery) {
        fail('freeDeliveryOver', 'A free-delivery threshold needs delivery switched on.');
      }
    }

    if (v.trackInventory && draft.intent === 'PRODUCT') {
      var qty = toNumber(v.quantity);
      if (forPublish && (qty === null || qty <= 0) && !v.allowBackorder) {
        fail('quantity', 'Stock is tracked but empty. Add stock, allow backorders, or turn tracking off.');
      }
      var low = toNumber(v.lowStockThreshold);
      if (qty !== null && low !== null && qty > 0 && low > qty) {
        fail('lowStockThreshold', 'The low-stock warning is higher than the stock you have.');
      }
    }

    if (draft.intent === 'SERVICE') {
      var needsSchedule = v.serviceFormat === 'APPOINTMENT'
        || v.serviceFormat === 'BOOKING' || v.serviceFormat === 'RECURRING';
      if (needsSchedule) {
        var open = scheduleDayCount(v.weeklySchedule);
        if (forPublish && open === 0) {
          fail('weeklySchedule', 'A bookable service needs the days and hours you are available.');
        }
        var bad = badScheduleWindow(v.weeklySchedule);
        if (bad) fail('weeklySchedule', capitalize(bad) + ' closes at or before it opens.');
        if (forPublish && !toNumber(v.durationMinutes)) {
          fail('durationMinutes', 'How long does one booking last?');
        }
      }
      if ((v.locationMode === 'AT_CUSTOMER' || v.locationMode === 'HYBRID')
        && forPublish && (v.serviceAreas || []).length === 0) {
        fail('serviceAreas', 'You travel to customers — say which areas you cover.');
      }
      var cap = toNumber(v.capacity);
      var minP = toNumber(v.minParticipants);
      if (cap !== null && minP !== null && minP > cap) {
        fail('minParticipants', 'The minimum cannot be above the capacity.');
      }
    }

    // Warnings never block publication; they are advice.
    if (draft.media.length === 1) {
      warnings.push('One photo works, but listings with three or more get noticeably more views.');
    }
    if ((v.tags || []).length === 0) {
      warnings.push('No search keywords yet — buyers find listings by typing.');
    }
    if (v.description && v.description.length > 3000) {
      warnings.push('That description is very long. Buyers skim; the first two lines do the work.');
    }
  }

  function validateBroadcast(draft, ctx, fail, warnings, forPublish) {
    var v = draft.values;
    var def = broadcastDefinition(ctx, v.broadcastType);

    if (def && def.needsWindow && forPublish && !v.expiresInHours) {
      fail('expiresInHours', 'A time-limited broadcast needs an end date.');
    }
    if (v.publishMode === 'SCHEDULE') {
      if (!v.scheduledFor) {
        fail('scheduledFor', 'Pick when this should go live.');
      } else if (new Date(v.scheduledFor).getTime() <= Date.now()) {
        fail('scheduledFor', 'The scheduled time has already passed.');
      }
    }

    var bf = v.broadcastFields || {};
    if (v.broadcastType === 'PROMOTION') {
      var orig = toNumber(bf.originalPriceMinor);
      var promo = toNumber(bf.promoPriceMinor);
      if (orig !== null && promo !== null && promo >= orig) {
        fail('broadcastFields.promoPriceMinor', 'The promotional price must be below the usual price.');
      }
    }
    if (v.broadcastType === 'EVENT' && bf.startTime && bf.endTime && bf.endTime <= bf.startTime) {
      fail('broadcastFields.endTime', 'The event ends at or before it starts.');
    }

    if ((v.highlights || []).length === 0) {
      warnings.push('Highlights are the tick marks buyers scan first. Two or three help.');
    }
    if (draft.media.length === 0) {
      warnings.push('Broadcasts with an image are read far more often than ones without.');
    }
  }

  function sectionOf(allSections, path) {
    for (var i = 0; i < allSections.length; i++) {
      var s = allSections[i];
      if (path === '__media' && s.key === 'media') return s.key;
      for (var j = 0; j < s.fields.length; j++) {
        if (s.fields[j].path === path) return s.key;
      }
    }
    return null;
  }

  function scheduleDayCount(schedule) {
    var n = 0;
    for (var k in (schedule || {})) {
      if ((schedule[k] || []).length > 0) n++;
    }
    return n;
  }

  function badScheduleWindow(schedule) {
    for (var k in (schedule || {})) {
      var windows = schedule[k] || [];
      for (var i = 0; i < windows.length; i++) {
        if (windows[i].end <= windows[i].start) return k;
      }
    }
    return null;
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  /* 6. READINESS                                                            */
  /* ══════════════════════════════════════════════════════════════════════ */

  /**
   * Per-section completion plus the blocking list. This is what turns
   * "something is wrong somewhere" into "3 things need attention", each one a
   * link straight to the field.
   */
  function readiness(draft, ctx) {
    var allSections = sections(draft, ctx);
    var result = validate(draft, ctx, { forPublish: true });

    var totalRequired = 0;
    var doneRequired = 0;

    var sectionStates = allSections.map(function (s) {
      var required = s.fields.filter(function (f) { return f.required; });
      var filled = required.filter(function (f) {
        if (f.type === 'media') return draft.media.length > 0;
        var val = getValue(draft, f.path);
        return !(val === undefined || val === null || val === ''
          || (Array.isArray(val) && val.length === 0));
      });

      // The media section carries one implicit requirement for listings.
      var reqCount = required.length;
      var doneCount = filled.length;
      if (s.key === 'media' && draft.intent !== 'BROADCAST') {
        reqCount = 1;
        doneCount = draft.media.length > 0 ? 1 : 0;
      }

      totalRequired += reqCount;
      doneRequired += doneCount;

      var issues = result.blockers.filter(function (b) { return b.section === s.key; });

      return {
        key: s.key,
        label: s.label,
        hint: s.hint,
        icon: s.icon,
        requiredCount: reqCount,
        doneCount: doneCount,
        complete: reqCount > 0 ? doneCount >= reqCount && issues.length === 0 : issues.length === 0,
        started: doneCount > 0,
        issueCount: issues.length,
        issues: issues
      };
    });

    var percent = totalRequired === 0
      ? (result.valid ? 100 : 0)
      : Math.round((doneRequired / totalRequired) * 100);

    // Never show 100% while something still blocks publication — the number
    // and the button must agree.
    if (!result.valid && percent >= 100) percent = 99;

    return {
      percent: percent,
      sections: sectionStates,
      // The per-field map, so the editor can mark the offending inputs rather
      // than only listing them on the review screen.
      errors: result.errors,
      blockers: result.blockers,
      warnings: result.warnings,
      canPublish: result.valid,
      summary: result.valid
        ? 'Ready to publish'
        : result.blockers.length + (result.blockers.length === 1 ? ' thing needs' : ' things need') + ' attention'
    };
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  /* 7. NORMALIZATION — draft to API payload                                 */
  /* ══════════════════════════════════════════════════════════════════════ */

  /** The listing payload, in exactly the shape ListingValidationService parses. */
  function toListingPayload(draft, ctx) {
    var v = draft.values;
    var hasPrice = v.priceMode !== 'QUOTE' && v.priceMode !== 'FREE';
    var isDigital = v.listingType === 'DIGITAL_PRODUCT';
    var isService = draft.intent === 'SERVICE';

    var payload = {
      listingType: v.listingType,
      categoryId: v.categoryId,
      description: trim(v.description),
      condition: v.condition || 'new',
      currency: v.currency || 'XAF',
      basePriceMinor: hasPrice ? (toInt(v.basePrice) || 0) : 0,
      visibility: v.visibility || 'PUBLIC',
      tags: (v.tags || []).slice(0, 20),
      attributes: pruneEmpty(v.attributes),
      city: trim(v.city).toLowerCase(),
      priceMode: v.priceMode || 'FIXED',
      negotiable: Boolean(v.negotiable),
      fulfillmentModel: fulfillmentModelFor(draft)
    };

    // The draft schema types title as .min(1).optional(), so an empty string is
    // a hard 400 — which is exactly what the first autosave sends before the
    // seller has typed anything. Omit it until there is one.
    if (trim(v.title)) payload.title = trim(v.title);
    if (trim(v.shortDescription)) payload.shortDescription = trim(v.shortDescription);
    if (trim(v.brand)) payload.brand = trim(v.brand);
    if (trim(v.model)) payload.model = trim(v.model);
    if (trim(v.sku)) payload.sku = trim(v.sku);
    if (trim(v.neighbourhood)) payload.neighbourhood = trim(v.neighbourhood);
    if (trim(v.contactPhone)) payload.contactPhone = trim(v.contactPhone);

    if (hasPrice) {
      if (toInt(v.salePrice)) payload.salePriceMinor = toInt(v.salePrice);
      if (toInt(v.compareAtPrice)) payload.compareAtPriceMinor = toInt(v.compareAtPrice);
      if (toInt(v.wholesalePrice)) payload.wholesalePriceMinor = toInt(v.wholesalePrice);
    }
    if (toInt(v.minOrderQuantity)) payload.minOrderQuantity = toInt(v.minOrderQuantity);

    if (draft.intent === 'PRODUCT' && !isDigital) {
      payload.inventory = {
        trackInventory: Boolean(v.trackInventory),
        quantity: toInt(v.quantity) || 0,
        lowStockThreshold: toInt(v.lowStockThreshold) || 0,
        allowBackorder: Boolean(v.allowBackorder)
      };
      payload.fulfillment = {
        delivery: Boolean(v.delivery),
        pickup: Boolean(v.pickup),
        deliveryScope: v.delivery ? (v.deliveryScope || null) : null,
        deliveryZones: v.delivery ? (v.deliveryZones || []) : [],
        etaText: trim(v.etaText) || null,
        deliveryFeeMinor: v.delivery ? (toInt(v.deliveryFee) || 0) : null,
        freeDeliveryOverMinor: v.delivery && toInt(v.freeDeliveryOver) ? toInt(v.freeDeliveryOver) : null,
        pickupAddress: v.pickup ? (trim(v.pickupAddress) || null) : null
      };
      // Always sent, even when empty: the server rewrites variants only when the
      // key is present, so omitting it makes "I removed every variant"
      // indistinguishable from "I did not touch variants".
      payload.variantOptions = pruneEmptyArrays(v.variantOptions);
    }

    // Gated on the listing TYPE, not the intent: the SERVICE intent also covers
    // SUBSCRIPTION, and the server refuses a service block on a type whose
    // capabilities carry neither a schedule nor booking dates.
    var takesServiceBlock = v.listingType === 'SERVICE'
      || v.listingType === 'BOOKING'
      || v.listingType === 'RENTAL';

    if (isService && takesServiceBlock) {
      payload.service = {
        format: v.serviceFormat || 'APPOINTMENT',
        durationMinutes: toInt(v.durationMinutes),
        locationMode: v.locationMode || 'AT_SELLER',
        serviceAreas: v.serviceAreas || [],
        includes: v.includes || [],
        excludes: v.excludes || [],
        bookingMode: v.bookingMode || 'REQUEST',
        capacity: toInt(v.capacity),
        minParticipants: toInt(v.minParticipants),
        leadTimeHours: toInt(v.leadTimeHours) || 0,
        weeklySchedule: v.weeklySchedule || {},
        blackoutDates: v.blackoutDates || [],
        cancellationPolicy: trim(v.cancellationPolicy) || null,
        // Where customers come to you. Collected by the location section for
        // AT_SELLER/HYBRID services; previously built only into the product
        // fulfilment block, so for a service it was silently discarded.
        locationAddress: trim(v.pickupAddress) || null
      };
    }

    var trust = {
      warranty: trim(v.warranty) || null,
      returnPolicy: v.returnPolicy || null,
      authenticity: trim(v.authenticity) || null,
      paymentMethods: v.paymentMethods || [],
      availableFrom: v.availableFrom || null
    };
    // Same reasoning as variantOptions: always send it, so clearing warranty or
    // payment methods actually clears them.
    payload.trust = trust;

    return payload;
  }

  function fulfillmentModelFor(draft) {
    var v = draft.values;
    if (v.listingType === 'DIGITAL_PRODUCT') return 'DIGITAL_DOWNLOAD';
    if (draft.intent === 'SERVICE') {
      if (v.locationMode === 'REMOTE') return 'SERVICE_REMOTE';
      if (v.serviceFormat === 'BOOKING') return 'BOOKING_VOUCHER';
      return 'SERVICE_ONSITE';
    }
    if (v.delivery && v.pickup) return 'DELIVERY_OR_PICKUP';
    if (v.pickup) return 'PICKUP';
    return 'DELIVERY';
  }

  /** The announcement payload, in the shape AnnouncementService accepts. */
  function toAnnouncementPayload(draft, ctx) {
    var v = draft.values;
    var def = broadcastDefinition(ctx, v.broadcastType);

    var payload = {
      storeId: (ctx && ctx.storeId) || null,
      title: trim(v.title),
      type: v.broadcastType,
      body: trim(v.body),
      highlights: (v.highlights || []).slice(0, 6),
      metadata: pruneEmpty(v.broadcastFields),
      ctaType: v.ctaType || (def ? def.defaultCta : 'VIEW_STORE'),
      audienceScope: v.audienceScope || 'EVERYONE',
      targetCities: v.audienceScope === 'TARGETED' ? (v.targetCities || []) : [],
      // Only ids the server actually staged. `fromAnnouncement` synthesises
      // 'existing_N' placeholders for images already published, and an upload
      // still in flight has a 'pending_…' id; sending either is a 404 from
      // loadOwnedStaged. Already-published images travel as URLs instead, which
      // is the shape `_resolveMediaUrls` keeps.
      mediaUploadIds: draft.media
        .filter(function (m) { return m.status === 'ready'; })
        .map(function (m) { return m.uploadId; }),
      mediaUrls: draft.media
        .filter(function (m) { return m.status === 'attached' && /^https?:/.test(m.url || ''); })
        .map(function (m) { return m.url; })
    };

    if (trim(v.ctaLabel)) payload.ctaLabel = trim(v.ctaLabel);
    if (trim(v.attachmentId)) {
      payload.attachmentId = trim(v.attachmentId);
      payload.attachmentType = 'PRODUCT';
    }

    if (v.publishMode === 'SCHEDULE' && v.scheduledFor) {
      payload.scheduledFor = new Date(v.scheduledFor).toISOString();
    }
    if (v.expiresInHours) {
      var from = payload.scheduledFor ? new Date(payload.scheduledFor).getTime() : Date.now();
      payload.expiresAt = new Date(from + Number(v.expiresInHours) * 3600 * 1000).toISOString();
    }

    return payload;
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  /* 8. HYDRATION — server object back into a draft (edit mode)              */
  /* ══════════════════════════════════════════════════════════════════════ */

  function fromListing(listing, ctx) {
    var intent = (listing.listingType === 'SERVICE' || listing.listingType === 'BOOKING'
      || listing.listingType === 'SUBSCRIPTION') ? 'SERVICE' : 'PRODUCT';

    var draft = createDraft(intent, ctx || {});
    var v = draft.values;
    var pricing = listing.pricingOptions || {};
    var f = listing.fulfillment || {};
    var s = listing.service || {};
    var t = listing.trust || {};
    var stock = listing.stock || {};
    var meta = listing.metadata || {};

    v.listingType = listing.listingType;
    v.categoryId = listing.categoryId;
    v.title = listing.title || '';
    v.shortDescription = listing.shortDescription || '';
    v.description = listing.description || '';
    v.brand = listing.brand || '';
    v.model = listing.model || '';
    v.sku = listing.sku || '';
    v.condition = listing.condition || 'new';
    v.tags = listing.tags || [];
    v.attributes = listing.attributes || {};
    v.visibility = listing.visibility || 'PUBLIC';

    var price = listing.pricing || {};
    v.currency = price.currency || listing.currency || 'XAF';
    v.basePrice = minorToInput(price.basePriceMinor != null ? price.basePriceMinor : listing.basePriceMinor);
    v.salePrice = minorToInput(price.salePriceMinor != null ? price.salePriceMinor : listing.salePriceMinor);
    v.compareAtPrice = minorToInput(price.compareAtPriceMinor != null ? price.compareAtPriceMinor : listing.compareAtPriceMinor);
    v.priceMode = pricing.priceMode || 'FIXED';
    v.negotiable = Boolean(pricing.negotiable);
    v.minOrderQuantity = pricing.minOrderQuantity ? String(pricing.minOrderQuantity) : '';
    v.wholesalePrice = minorToInput(pricing.wholesalePriceMinor);

    v.trackInventory = stock.trackInventory !== false && intent === 'PRODUCT';
    v.quantity = stock.quantity != null ? String(stock.quantity) : '';
    v.lowStockThreshold = stock.lowStockThreshold != null ? String(stock.lowStockThreshold) : '3';
    v.allowBackorder = Boolean(stock.allowBackorder);
    v.variantOptions = listing.variantOptions || {};

    v.delivery = Boolean(f.delivery);
    v.pickup = Boolean(f.pickup);
    v.deliveryScope = f.deliveryScope || 'CITY';
    v.deliveryZones = f.deliveryZones || [];
    v.etaText = f.etaText || '';
    v.deliveryFee = minorToInput(f.deliveryFeeMinor);
    v.freeDeliveryOver = minorToInput(f.freeDeliveryOverMinor);
    v.pickupAddress = f.pickupAddress || '';

    v.serviceFormat = s.format || 'APPOINTMENT';
    v.durationMinutes = s.durationMinutes ? String(s.durationMinutes) : '';
    v.locationMode = s.locationMode || 'AT_SELLER';
    v.serviceAreas = s.serviceAreas || [];
    v.includes = s.includes || [];
    v.excludes = s.excludes || [];
    v.bookingMode = s.bookingMode || 'REQUEST';
    v.capacity = s.capacity ? String(s.capacity) : '';
    v.minParticipants = s.minParticipants ? String(s.minParticipants) : '';
    v.leadTimeHours = s.leadTimeHours != null ? String(s.leadTimeHours) : '2';
    if (s.weeklySchedule && Object.keys(s.weeklySchedule).length) v.weeklySchedule = s.weeklySchedule;
    v.blackoutDates = s.blackoutDates || [];
    v.cancellationPolicy = s.cancellationPolicy || '';

    v.warranty = t.warranty || '';
    v.returnPolicy = t.returnPolicy || '';
    v.authenticity = t.authenticity || '';
    v.paymentMethods = t.paymentMethods || [];
    v.availableFrom = t.availableFrom || '';

    v.city = titleCase(meta.city || '');
    v.neighbourhood = meta.neighbourhood || '';
    v.contactPhone = meta.contactPhone || '';

    draft.remoteId = listing.id;
    draft.remoteStatus = listing.status || 'DRAFT';
    draft.mode = 'edit';
    draft.media = (listing.media || []).map(function (m) {
      return {
        uploadId: m.id, mediaId: m.id, url: m.url,
        width: m.width, height: m.height, status: 'attached', name: ''
      };
    });

    return draft;
  }

  function fromAnnouncement(ann, ctx) {
    var draft = createDraft('BROADCAST', ctx || {});
    var v = draft.values;

    v.broadcastType = ann.type || 'ANNOUNCEMENT';
    v.title = ann.title || '';
    v.body = ann.body || '';
    v.highlights = ann.highlights || [];
    v.broadcastFields = ann.metadata || {};
    v.ctaType = ann.ctaType || '';
    v.ctaLabel = ann.ctaLabel || '';
    v.attachmentId = ann.attachmentId || '';
    v.attachmentType = ann.attachmentType || 'NONE';
    v.audienceScope = (ann.target && ann.target.audience_scope) || 'EVERYONE';
    v.targetCities = (ann.target && ann.target.target_cities) || [];

    if (ann.scheduledFor) {
      v.publishMode = 'SCHEDULE';
      v.scheduledFor = toLocalDateTimeInput(ann.scheduledFor);
    }
    if (ann.expiresAt) {
      var from = ann.publishedAt || ann.scheduledFor || ann.createdAt;
      var hours = Math.round((new Date(ann.expiresAt) - new Date(from)) / 3600000);
      v.expiresInHours = nearestExpiryPreset(hours);
    }

    draft.remoteId = ann.id;
    draft.remoteStatus = ann.status || 'DRAFT';
    draft.mode = 'edit';
    draft.media = (ann.mediaUrls || []).map(function (url, i) {
      return { uploadId: 'existing_' + i, url: url, status: 'attached', name: '' };
    });

    return draft;
  }

  function nearestExpiryPreset(hours) {
    var candidates = [48, 168, 720];
    for (var i = 0; i < candidates.length; i++) {
      if (hours <= candidates[i] * 1.5) return String(candidates[i]);
    }
    return '';
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  /* 9. THE PUBLICATION CARD                                                 */
  /*    One projection. The studio preview and the buyer-facing feed render  */
  /*    the same object through the same markup, so they cannot disagree.    */
  /* ══════════════════════════════════════════════════════════════════════ */

  function emptyCard() {
    return {
      id: '',
      kind: 'PRODUCT', badge: null, badgeTone: 'neutral',
      storeName: '', storeInitials: '', storeCity: '', storeVerified: false, storeRating: '',
      coverUrl: '', mediaCount: 0, hasMedia: false,
      mediaType: 'image', // 'image' | 'video'
      videoUrl: '', videoPoster: '',
      mediaStyle: 'cutout', // 'cutout' | 'lifestyle' | 'video'
      backgroundType: 'ISOLATED', // 'TRANSPARENT' | 'ISOLATED' | 'STUDIO' | 'LIFESTYLE' | 'ORIGINAL'
      processingStatus: 'PROCESSED',
      title: '', subtitle: '', tagline: '', body: '',
      priceLine: '', comparePrice: '', priceNote: '',
      // Social proof is only ever real. A brand-new listing has no rating and
      // no reviews, and the card renders that row only when hasRating is true —
      // inventing "★ 4.9 (18)" would be telling buyers something untrue.
      rating: '', reviewCount: '', soldCount: '', hasRating: false, trustNote: '',
      chips: [], meta: [], highlights: [],
      specifications: [], attributes: [],
      ctaLabel: 'Buy now', href: '', statusLabel: '',
      attached: null, isPlaceholder: true
    };
  }

  function detectMediaStyle(url, item) {
    if (item && item.mediaType === 'video') return 'video';
    if (item && (item.videoUrl || item.video_url)) return 'video';
    if (item && item.mediaStyle) return item.mediaStyle;
    if (item && item.metadata && item.metadata.mediaStyle) return item.metadata.mediaStyle;
    var u = String(url || '').toLowerCase();
    if (u.endsWith('.mp4') || u.endsWith('.webm') || u.includes('/videos/')) {
      return 'video';
    }
    if (u.includes('cutout') || u.includes('isolated') || u.includes('transparent') || u.includes('.png') || u.includes('no-bg')) {
      return 'cutout';
    }
    if (u.includes('lifestyle') || u.includes('hotel') || u.includes('travel') || u.includes('suite') || u.includes('beach') || u.includes('fashion-scene')) {
      return 'lifestyle';
    }
    var cat = String((item && (item.category || item.category_id || item.intent)) || '').toLowerCase();
    if (cat.includes('hotel') || cat.includes('travel') || cat.includes('hospitality')) {
      return 'lifestyle';
    }
    return 'cutout';
  }

  /**
   * Builds the card from a live draft. Placeholder text appears only where the
   * seller has genuinely entered nothing — the moment they type, the card
   * shows what they typed and nothing else.
   */
  function toFeedCard(draft, ctx) {
    ctx = ctx || {};
    var v = draft.values;
    var store = ctx.store || {};
    var card = emptyCard();

    card.kind = draft.intent;
    card.storeName = store.name || 'Your boutique';
    card.storeInitials = initialsOf(card.storeName);
    card.storeCity = titleCase(v.city || store.city || '');
    card.storeVerified = Boolean(store.isVerified);
    card.storeRating = store.rating ? String(store.rating) : '';

    var cover = draft.media.length ? draft.media[0] : null;
    card.coverUrl = cover ? cover.url : '';
    card.hasMedia = Boolean(cover);
    card.mediaCount = draft.media.length;
    card.mediaStyle = detectMediaStyle(card.coverUrl, v);

    card.title = trim(v.title);
    card.isPlaceholder = !card.title;

    if (draft.intent === 'BROADCAST') {
      buildBroadcastCard(card, draft, ctx);
    } else if (draft.intent === 'SERVICE') {
      buildServiceCard(card, draft, ctx);
    } else {
      buildProductCard(card, draft, ctx);
    }

    if (!card.title) card.title = defaultTitleFor(draft.intent);
    card.statusLabel = draft.remoteStatus === 'PUBLISHED' ? 'LIVE' : 'PREVIEW';
    return card;
  }

  function defaultTitleFor(intent) {
    if (intent === 'BROADCAST') return 'Your announcement headline';
    if (intent === 'SERVICE') return 'Your service name';
    return 'Your product title';
  }

  function buildProductCard(card, draft, ctx) {
    var v = draft.values;
    var currency = v.currency || 'XAF';
    var base = toNumber(v.basePrice);
    var sale = toNumber(v.salePrice);
    var compare = toNumber(v.compareAtPrice);

    if (v.priceMode === 'QUOTE') {
      card.priceLine = 'Price on request';
    } else if (v.priceMode === 'FREE') {
      card.priceLine = 'Free';
    } else if (sale) {
      card.priceLine = formatMoney(sale, currency);
      card.comparePrice = base ? formatMoney(base, currency) : '';
    } else if (base) {
      card.priceLine = (v.priceMode === 'FROM' ? 'From ' : '') + formatMoney(base, currency);
      card.comparePrice = compare ? formatMoney(compare, currency) : '';
    } else {
      card.priceLine = 'No price yet';
    }

    if (v.negotiable) card.priceNote = 'Negotiable';

    var discount = discountPercent(base, sale || null) || discountPercent(compare, base);
    if (discount) {
      card.badge = 'Save ' + discount + '%';
      card.badgeTone = 'sale';
    } else if (v.condition === 'new') {
      card.badge = 'New';
      card.badgeTone = 'new';
    }

    var chips = [];
    var cond = labelFor(CONDITIONS, v.condition);
    if (cond && v.condition !== 'not_applicable') chips.push(cond);
    if (trim(v.brand)) chips.push(trim(v.brand));
    if (v.delivery) chips.push(trim(v.etaText) || labelFor(DELIVERY_SCOPES, v.deliveryScope) || 'Delivery');
    if (v.pickup) chips.push('Collection');
    if (trim(v.warranty)) chips.push(trim(v.warranty));
    card.chips = chips.slice(0, 4).map(toChip);

    var meta = [];
    // Stock is only reported once the seller has actually entered a quantity.
    // Announcing "Out of stock" on an untouched draft describes the default,
    // not a decision they have made.
    if (v.trackInventory) {
      var qty = toNumber(v.quantity);
      if (qty) meta.push(qty + ' in stock');
      else if (draft.touched && draft.touched.quantity) meta.push('Out of stock');
    }
    if (card.storeCity) meta.push(card.storeCity);
    if (toNumber(v.minOrderQuantity) > 1) meta.push('Min ' + toNumber(v.minOrderQuantity));
    card.meta = meta.map(toChip);

    // No invented strapline: an empty description shows nothing, which is what
    // the seller will actually get until they write one.
    card.tagline = firstLine(v.shortDescription || v.description);
    card.subtitle = card.tagline;
    card.ctaLabel = v.priceMode === 'QUOTE' ? 'Request a price' : 'Buy now';
    card.href = draft.remoteId ? '/product/' + draft.remoteId : '';
  }

  function buildServiceCard(card, draft, ctx) {
    var v = draft.values;
    var currency = v.currency || 'XAF';
    var base = toNumber(v.basePrice);

    if (v.priceMode === 'QUOTE') {
      card.priceLine = 'Quote on request';
    } else if (base) {
      var prefix = v.priceMode === 'FROM' ? 'From ' : '';
      var suffix = v.priceMode === 'HOURLY' ? ' / hour'
        : v.priceMode === 'DAILY' ? ' / day'
          : v.priceMode === 'PER_PERSON' ? ' / person' : '';
      card.priceLine = prefix + formatMoney(base, currency) + suffix;
    } else {
      card.priceLine = 'No price yet';
    }

    card.badge = labelFor(SERVICE_FORMATS, v.serviceFormat).toUpperCase();
    card.badgeTone = 'accent';

    var chips = [];
    var duration = formatDuration(toNumber(v.durationMinutes));
    if (duration) chips.push(duration);
    chips.push(labelFor(SERVICE_LOCATION_MODES, v.locationMode));
    if (v.bookingMode === 'INSTANT') chips.push('Instant booking');
    (v.includes || []).slice(0, 2).forEach(function (i) { chips.push(i); });
    card.chips = chips.filter(Boolean).slice(0, 4).map(toChip);

    var meta = [];
    var open = scheduleDayCount(v.weeklySchedule);
    if (open > 0) meta.push(open === 7 ? 'Open every day' : 'Available ' + open + ' days a week');
    if ((v.serviceAreas || []).length) meta.push(v.serviceAreas.slice(0, 2).join(', '));
    else if (card.storeCity) meta.push(card.storeCity);
    card.meta = meta.map(toChip);

    card.subtitle = firstLine(v.description);
    card.ctaLabel = v.bookingMode === 'INSTANT' ? 'Book now'
      : v.bookingMode === 'ENQUIRY' ? 'Send an enquiry' : 'Request a booking';
    card.href = draft.remoteId ? '/product/' + draft.remoteId : '';
  }

  function buildBroadcastCard(card, draft, ctx) {
    var v = draft.values;
    var bf = v.broadcastFields || {};
    var def = broadcastDefinition(ctx, v.broadcastType);
    var currency = v.currency || 'XAF';

    // The badge is a glance-level label ("DEAL"), not the picker's sentence.
    card.badge = def ? (def.short || def.label).toUpperCase() : String(v.broadcastType);
    card.badgeTone = v.broadcastType === 'PROMOTION' ? 'sale'
      : v.broadcastType === 'ALERT' ? 'warn' : 'accent';

    if (v.broadcastType === 'PROMOTION') {
      var pct = toNumber(bf.discountPercent);
      if (pct) card.badge = 'DEAL · -' + pct + '%';
      var promo = toNumber(bf.promoPriceMinor);
      var orig = toNumber(bf.originalPriceMinor);
      if (promo) {
        card.priceLine = formatMoney(promo, currency);
        card.comparePrice = orig ? formatMoney(orig, currency) : '';
      } else if (trim(bf.offer)) {
        card.priceLine = trim(bf.offer);
      }
      if (bf.promoCode) card.priceNote = 'Code ' + bf.promoCode;
    } else if (v.broadcastType === 'HIRING') {
      card.priceLine = trim(bf.compensation) || '';
      card.subtitle = [labelOfOption(bf.employmentType), labelOfOption(bf.workMode)]
        .filter(Boolean).join(' · ');
    } else if (v.broadcastType === 'ALERT') {
      card.priceLine = trim(bf.budget) ? 'Budget: ' + trim(bf.budget) : '';
      if (bf.reference) card.priceNote = 'Ref ' + bf.reference;
    } else if (v.broadcastType === 'EVENT') {
      card.priceLine = trim(bf.ticketInfo) || '';
      card.subtitle = [formatDate(bf.eventDate), bf.startTime, trim(bf.venue)]
        .filter(Boolean).join(' · ');
    } else if (v.broadcastType === 'SERVICE_AVAILABLE') {
      var from = toNumber(bf.startingPriceMinor);
      if (from) card.priceLine = 'From ' + formatMoney(from, currency);
      card.subtitle = trim(bf.coverage);
    }

    if (!card.subtitle) card.subtitle = '';
    card.body = trim(v.body);
    card.highlights = (v.highlights || []).slice(0, 4).map(toChip);

    var meta = [];
    if (v.expiresInHours) meta.push('Ends in ' + expiryLabel(v.expiresInHours));
    if (v.publishMode === 'SCHEDULE' && v.scheduledFor) meta.push('Goes live ' + formatDateTime(v.scheduledFor));
    meta.push(labelFor(AUDIENCE_SCOPES, v.audienceScope));
    if (bf.deadline) meta.push('Deadline ' + formatDate(bf.deadline));
    card.meta = meta.filter(Boolean).map(toChip);

    card.ctaLabel = trim(v.ctaLabel)
      || labelFor(CTA_TYPES, v.ctaType || (def ? def.defaultCta : 'VIEW_STORE'));
    card.href = draft.remoteId ? '/announcements/' + draft.remoteId : '';

    if (ctx.attachedListing) {
      card.attached = {
        title: ctx.attachedListing.title,
        priceLine: formatMoney(
          ctx.attachedListing.salePriceMinor || ctx.attachedListing.basePriceMinor,
          ctx.attachedListing.currency || currency
        ),
        comparePrice: ctx.attachedListing.salePriceMinor
          ? formatMoney(ctx.attachedListing.basePriceMinor, ctx.attachedListing.currency || currency)
          : '',
        coverUrl: ctx.attachedListing.coverUrl || ''
      };
    }
  }

  function labelOfOption(value) {
    if (!value) return '';
    return String(value).replace(/_/g, ' ').toLowerCase()
      .replace(/^(.)/, function (c) { return c.toUpperCase(); });
  }

  function expiryLabel(hours) {
    var h = Number(hours);
    if (h <= 48) return '48 hours';
    if (h <= 168) return '7 days';
    return '30 days';
  }

  /* ------------------------- the same card, from real published objects -- */

  /** A published listing rendered as a PublicationCard. */
  function cardFromListing(listing, opts) {
    opts = opts || {};
    var card = emptyCard();
    card.isPlaceholder = false;
    card.kind = (listing.listingType === 'SERVICE' || listing.listingType === 'BOOKING')
      ? 'SERVICE' : 'PRODUCT';

    var store = listing.store || {};
    card.storeName = store.name || opts.storeName || '';
    card.storeInitials = initialsOf(card.storeName);
    card.storeCity = titleCase((listing.metadata && listing.metadata.city) || store.city || opts.storeCity || '');
    card.storeVerified = Boolean(store.isVerified);
    card.storeRating = store.rating ? String(store.rating) : '';

    card.coverUrl = listing.coverUrl
      || (listing.media && listing.media[0] ? listing.media[0].url : '')
      || '';
    card.hasMedia = Boolean(card.coverUrl);
    card.mediaCount = listing.imageCount || (listing.media || []).length;
    card.videoUrl = listing.videoUrl || (listing.metadata && listing.metadata.videoUrl) || '';
    card.videoPoster = listing.videoPoster || (listing.metadata && listing.metadata.videoPoster) || card.coverUrl;
    card.mediaType = card.videoUrl ? 'video' : 'image';
    card.mediaStyle = detectMediaStyle(card.coverUrl, listing);
    card.backgroundType = listing.backgroundType || (listing.metadata && listing.metadata.backgroundType) || (card.mediaStyle === 'cutout' ? 'ISOLATED' : 'LIFESTYLE');
    card.processingStatus = listing.processingStatus || 'PROCESSED';

    card.title = listing.title || '';
    card.tagline = listing.tagline || firstLine(listing.shortDescription || listing.short_description || listing.description || '');
    card.subtitle = card.tagline;

    // Two shapes reach this function: the owner projection (camelCase, from
    // CreateListingUseCase.hydrate) and raw catalogue rows (snake_case, from
    // GET /listings/seller and the public product feed). Reading only camelCase
    // left every card in the seller's studio with a blank price.
    var pick = function (camel, snake) {
      if (listing[camel] !== undefined && listing[camel] !== null) return listing[camel];
      if (listing[snake] !== undefined && listing[snake] !== null) return listing[snake];
      return (listing.pricing || {})[camel];
    };

    var currency = listing.currency || 'XAF';
    var base = pick('basePriceMinor', 'base_price_minor');
    var sale = pick('salePriceMinor', 'sale_price_minor');
    var mode = ((listing.pricingOptions || (listing.metadata || {}).pricing || {}).priceMode) || 'FIXED';

    if (mode === 'QUOTE') card.priceLine = 'Price on request';
    else if (mode === 'FREE') card.priceLine = 'Free';
    else if (sale) {
      card.priceLine = formatMoney(sale, currency);
      card.comparePrice = formatMoney(base, currency);
    } else {
      card.priceLine = (mode === 'FROM' ? 'From ' : '') + formatMoney(base, currency);
      if (listing.comparePriceMinor) {
        card.comparePrice = formatMoney(listing.comparePriceMinor, currency);
      }
    }

    var pct = discountPercent(base, sale);
    if (pct) { card.badge = 'Save ' + pct + '%'; card.badgeTone = 'sale'; }
    else if (listing.condition === 'new') { card.badge = 'New'; card.badgeTone = 'new'; }
    else if (listing.badge) { card.badge = listing.badge; card.badgeTone = 'accent'; }

    var chips = [];
    var cond = labelFor(CONDITIONS, listing.condition);
    if (cond && listing.condition !== 'not_applicable') chips.push(cond);
    if (listing.brand) chips.push(listing.brand);
    var f = listing.fulfillment || {};
    if (f.delivery) chips.push(f.etaText || 'Delivery');
    if (f.pickup) chips.push('Collection');
    card.chips = chips.slice(0, 4).map(toChip);

    var meta = [];
    if (card.storeCity) meta.push(card.storeCity);
    var views = listing.viewCount || listing.view_count || 0;
    if (views) meta.push(views + ' views');
    card.meta = meta.map(toChip);

    // Ratings come from the listing's own counters. `rating` defaults to 5.00 in
    // the database, so it means nothing until at least one person has rated —
    // ratingCount is the gate, not the score.
    var ratingCount = Number(listing.ratingCount || listing.rating_count || 0);
    card.hasRating = ratingCount > 0;
    card.rating = card.hasRating ? Number(listing.rating).toFixed(1) : '';
    card.reviewCount = card.hasRating ? String(ratingCount) : '';
    var sold = Number(listing.orderCount || listing.order_count || 0);
    card.soldCount = sold > 0 ? String(sold) : '';
    // The trust line reflects what this seller actually accepts.
    var methods = (listing.trust && listing.trust.paymentMethods) || [];
    card.trustNote = methods.indexOf('ESCROW') !== -1 ? 'Escrow protected' : '';
    card.ctaLabel = card.kind === 'SERVICE' ? 'Book now' : 'Buy now';
    card.href = '/product/' + listing.id;
    card.statusLabel = listing.status || '';
    card.specifications = listing.specifications || [];
    card.attributes = listing.attributes || {};
    card.id = listing.id;
    return card;
  }

  /** A published broadcast rendered as a PublicationCard. */
  function cardFromAnnouncement(ann, ctx) {
    ctx = ctx || {};
    var card = emptyCard();
    card.isPlaceholder = false;
    card.kind = 'BROADCAST';

    var store = ann.store || {};
    var author = ann.author || {};
    card.storeName = store.name
      || [author.first_name, author.last_name].filter(Boolean).join(' ')
      || 'LOUMOO member';
    card.storeInitials = initialsOf(card.storeName);
    card.storeCity = titleCase(store.city || author.city || '');
    card.storeVerified = Boolean(store.is_verified || store.isVerified);
    card.storeRating = store.rating ? String(store.rating) : '';

    card.coverUrl = (ann.mediaUrls && ann.mediaUrls[0]) || '';
    card.hasMedia = Boolean(card.coverUrl);
    card.mediaCount = (ann.mediaUrls || []).length;

    card.title = ann.title || '';
    card.body = ann.body || '';
    card.highlights = (ann.highlights || []).slice(0, 4).map(toChip);

    var def = broadcastDefinition(ctx, ann.type);
    card.badge = def ? (def.short || def.label).toUpperCase() : String(ann.type || '').replace(/_/g, ' ');
    card.badgeTone = ann.type === 'PROMOTION' ? 'sale' : ann.type === 'ALERT' ? 'warn' : 'accent';

    // Rebuild the type-specific line through the same code the preview uses,
    // so a published broadcast reads exactly as it did in the studio.
    var pseudo = createDraft('BROADCAST', {});
    pseudo.values.broadcastType = ann.type;
    pseudo.values.broadcastFields = ann.metadata || {};
    pseudo.values.body = ann.body || '';
    pseudo.values.highlights = ann.highlights || [];
    pseudo.values.ctaType = ann.ctaType;
    pseudo.values.ctaLabel = ann.ctaLabel;
    pseudo.values.audienceScope = (ann.target && ann.target.audience_scope) || 'EVERYONE';
    var projected = emptyCard();
    buildBroadcastCard(projected, pseudo, ctx);

    card.priceLine = projected.priceLine;
    card.comparePrice = projected.comparePrice;
    card.priceNote = projected.priceNote;
    card.subtitle = projected.subtitle;
    card.ctaLabel = ann.ctaLabel || projected.ctaLabel;
    card.ctaType = ann.ctaType || projected.ctaType || '';
    card.ctaUrl = ann.ctaUrl || '';

    var meta = [];
    if (ann.metrics && ann.metrics.views) meta.push(ann.metrics.views + ' views');
    if (ann.expiresAt) {
      var left = new Date(ann.expiresAt) - Date.now();
      if (left > 0) meta.push('Ends in ' + humanDuration(left));
      else meta.push('Ended');
    }
    if (card.storeCity) meta.push(card.storeCity);
    card.meta = meta.map(toChip);

    if (ann.attachedEntity) {
      card.attached = {
        title: ann.attachedEntity.title,
        priceLine: formatMoney(ann.attachedEntity.base_price_minor, ann.attachedEntity.currency || 'XAF'),
        comparePrice: '',
        coverUrl: ''
      };
    }

    card.href = '/announcements/' + (ann.slug || ann.id);
    card.statusLabel = ann.status || '';
    card.id = ann.id;
    return card;
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  /* 10. DRAFT PERSISTENCE                                                   */
  /* ══════════════════════════════════════════════════════════════════════ */

  function saveLocal(draft) {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        draft: draft
      }));
      return true;
    } catch (e) {
      return false;   // private mode, quota, blocked storage — never fatal
    }
  }

  function loadLocal() {
    try {
      if (typeof localStorage === 'undefined') return null;
      var raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.draft || !parsed.draft.values) return null;
      // A draft older than a fortnight is almost certainly abandoned.
      if (Date.now() - new Date(parsed.savedAt).getTime() > 14 * 86400000) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function clearLocal() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (e) { /* nothing to clear */ }
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  /* 11. FORMATTING HELPERS                                                  */
  /* ══════════════════════════════════════════════════════════════════════ */

  /** XAF has no subunit, so a minor unit IS a franc. */
  function formatMoney(minor, currency) {
    var n = Number(minor);
    if (!Number.isFinite(n)) return '';
    var grouped = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    if (currency === 'XAF' || currency === 'XOF' || !currency) return grouped + ' FCFA';
    return currency + ' ' + grouped;
  }

  function discountPercent(from, to) {
    var a = Number(from), b = Number(to);
    if (!a || !b || b >= a) return 0;
    return Math.round(((a - b) / a) * 100);
  }

  function formatDuration(minutes) {
    if (!minutes) return '';
    if (minutes < 60) return minutes + ' min';
    if (minutes % 60 === 0) {
      var h = minutes / 60;
      if (h < 24) return h + (h === 1 ? ' hour' : ' hours');
      var d = h / 24;
      if (Number.isInteger(d)) return d + (d === 1 ? ' day' : ' days');
    }
    return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
  }

  function humanDuration(ms) {
    var hours = Math.round(ms / 3600000);
    if (hours < 24) return hours + 'h';
    return Math.round(hours / 24) + ' days';
  }

  function formatDate(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatDateTime(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      + ' at ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function toLocalDateTimeInput(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function minorToInput(minor) {
    return minor === null || minor === undefined || minor === 0 ? '' : String(minor);
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    var cleaned = String(value).replace(/[^0-9.-]/g, '');
    if (cleaned === '' || cleaned === '-') return null;
    var n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Every quantity, duration and minor-unit column on the server is an integer.
   * A seller who types 1500.5 into a price should not be shown a raw schema
   * error, so the value is rounded on the way out.
   */
  function toInt(value) {
    var n = toNumber(value);
    return n === null ? null : Math.round(n);
  }

  function trim(v) {
    return v === null || v === undefined ? '' : String(v).trim();
  }

  function firstLine(text) {
    var t = trim(text);
    if (!t) return '';
    var line = t.split(/\n/)[0];
    return line.length > 140 ? line.slice(0, 137) + '…' : line;
  }

  function initialsOf(name) {
    return trim(name).split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || 'LM';
  }

  function titleCase(s) {
    var t = trim(s);
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }

  function capitalize(s) {
    return trim(s).charAt(0).toUpperCase() + trim(s).slice(1);
  }

  function toChip(label) {
    return { label: String(label) };
  }

  function pruneEmpty(obj) {
    var out = {};
    for (var k in (obj || {})) {
      var v = obj[k];
      if (v === null || v === undefined || v === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = v;
    }
    return out;
  }

  function pruneEmptyArrays(obj) {
    var out = {};
    for (var k in (obj || {})) {
      if (Array.isArray(obj[k]) && obj[k].length > 0) out[k] = obj[k];
    }
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════ */

  return {
    INTENTS: INTENTS,
    intentsForStore: intentsForStore,

    createDraft: createDraft,
    setValue: setValue,
    getValue: getValue,
    defaultSchedule: defaultSchedule,

    sections: sections,
    variantOptionsOf: variantOptionsOf,
    broadcastDefinition: broadcastDefinition,

    validate: validate,
    readiness: readiness,

    toListingPayload: toListingPayload,
    toAnnouncementPayload: toAnnouncementPayload,
    fromListing: fromListing,
    fromAnnouncement: fromAnnouncement,

    toFeedCard: toFeedCard,
    cardFromListing: cardFromListing,
    cardFromAnnouncement: cardFromAnnouncement,
    emptyCard: emptyCard,

    saveLocal: saveLocal,
    loadLocal: loadLocal,
    clearLocal: clearLocal,

    formatMoney: formatMoney,
    formatDuration: formatDuration,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    discountPercent: discountPercent,
    labelFor: labelFor,

    WEEKDAYS: WEEKDAYS,
    CITIES: CITIES,
    CONDITIONS: CONDITIONS,
    CTA_TYPES: CTA_TYPES,
    AUDIENCE_SCOPES: AUDIENCE_SCOPES
  };
});
