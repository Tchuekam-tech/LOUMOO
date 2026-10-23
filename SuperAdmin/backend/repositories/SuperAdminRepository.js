/**
 * LOUMOO SuperAdmin — SuperAdminRepository
 * ---------------------------------------------------------------------------
 * Encapsulates all database operations for system settings, audit logs,
 * and high-level platform aggregation metrics.
 */

const { SupabaseDatabase } = require('../../../server/infrastructure/database/SupabaseClient.js');
const logger = require('../../../server/shared/logging/logger');
const { NotFoundError, InfrastructureError, ValidationError } = require('../../../server/shared/errors/AppError');

// Default in-memory seed settings for fallback / local testing
const DEFAULT_SETTINGS = {
  platform_commission_rate: {
    rate_percent: 5.0,
    payout_fee_fixed_xaf: 150,
    escrow_hold_days: 3,
    category_rates: { electronics: 5.0, fashion: 8.0, services: 10.0, travel: 7.5 }
  },
  seller_whatsapp_default: {
    number: '237690123456',
    label: 'LOUMOO Central Merchant & Client Care',
    fallback_message: 'Hello LOUMOO Support! I am contacting you regarding an order.'
  },
  maintenance_mode: {
    enabled: false,
    banner_text: 'LOUMOO platform upgrade in progress. Order processing remains active.',
    allow_admin_bypass: true
  },
  announcement_banner: {
    active: true,
    message: 'Bienvenue sur LOUMOO! Expédition express sécurisée partout à Douala et Yaoundé.',
    badge: 'NOUVEAU',
    cta_text: 'Découvrir les boutiques',
    cta_url: '/stores'
  },
  shipping_rates_by_city: {
    Douala: 1000,
    Yaounde: 1500,
    Bafoussam: 2500,
    Kribi: 2500,
    Bamenda: 3000,
    Garoua: 4000,
    Maroua: 4500
  },
  feature_flags: {
    travel_enabled: true,
    visual_search_enabled: true,
    escrow_enabled: true,
    ai_assistant_enabled: true,
    crypto_payments_enabled: false
  }
};

// Default in-memory stores for fallback / test runs
const DEFAULT_STORES = [
  {
    id: 'store_orca_1',
    owner_id: 'usr_seller_1',
    name: 'Orca Electronics',
    slug: 'orca-electronics',
    description: 'Premier electronics and camera flagship in Douala Akwa.',
    category_id: 'electronics',
    phone_number: '237677101234',
    email: 'contact@orca.cm',
    city: 'Douala',
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    is_verified: true,
    verification_tier: 'official_brand',
    rating: 4.9,
    product_count: 34,
    created_at: '2026-08-10T10:00:00Z',
    owner: { full_name: 'Jean-Paul Ndedi', email: 'jp.ndedi@gmail.com', phone: '237677101234', kyc_status: 'verified' }
  },
  {
    id: 'store_kamer_2',
    owner_id: 'usr_seller_2',
    name: 'Kamer Tech Solutions',
    slug: 'kamer-tech-solutions',
    description: 'Laptops, components and network repair services in Yaoundé.',
    category_id: 'electronics',
    phone_number: '237677814455',
    email: 'info@kamertech.cm',
    city: 'Yaoundé',
    status: 'PENDING_VERIFICATION',
    visibility: 'PUBLIC',
    is_verified: false,
    verification_tier: 'unverified',
    rating: 4.6,
    product_count: 12,
    created_at: '2026-09-12T14:30:00Z',
    owner: { full_name: 'Alain Fotso', email: 'alain.fotso@yahoo.fr', phone: '237677814455', kyc_status: 'submitted' }
  },
  {
    id: 'store_milano_3',
    owner_id: 'usr_seller_3',
    name: 'Armonía Milano Boutique',
    slug: 'armonia-milano',
    description: 'High luxury Italian leather goods & bespoke tailoring.',
    category_id: 'fashion',
    phone_number: '237655907755',
    email: 'armonia@milano.cm',
    city: 'Douala',
    status: 'PENDING_VERIFICATION',
    visibility: 'PUBLIC',
    is_verified: false,
    verification_tier: 'unverified',
    rating: 5.0,
    product_count: 28,
    created_at: '2026-09-14T09:15:00Z',
    owner: { full_name: 'Chantal Biya Mbarga', email: 'chantal.mbarga@gmail.com', phone: '237655907755', kyc_status: 'submitted' }
  },
  {
    id: 'store_fake_4',
    owner_id: 'usr_seller_4',
    name: 'Counterfeit Express',
    slug: 'counterfeit-express',
    description: 'Flagged for counterfeit luxury items.',
    category_id: 'fashion',
    phone_number: '237699000111',
    email: 'scam@sketchy.com',
    city: 'Kribi',
    status: 'SUSPENDED',
    visibility: 'PRIVATE',
    is_verified: false,
    verification_tier: 'unverified',
    rating: 1.2,
    product_count: 5,
    created_at: '2026-09-01T11:00:00Z',
    owner: { full_name: 'Unknown Operator', email: 'unknown@sketchy.com', phone: '237699000111', kyc_status: 'rejected' }
  }
];

// Default in-memory listings for fallback / test runs
const DEFAULT_LISTINGS = [
  {
    id: 'lst_macbook_1',
    store_id: 'store_orca_1',
    store_name: 'Orca Electronics',
    title: 'Apple MacBook Pro M3 Max 16" 36GB / 1TB SSD',
    slug: 'apple-macbook-pro-m3-max-16',
    category_id: 'electronics',
    base_price: 2450000,
    currency: 'XAF',
    stock_quantity: 4,
    status: 'PUBLISHED',
    is_featured: true,
    created_at: '2026-09-10T12:00:00Z'
  },
  {
    id: 'lst_bag_2',
    store_id: 'store_milano_3',
    store_name: 'Armonía Milano Boutique',
    title: 'Sac Cabas Cuir Grainé Milano Noir Prestige',
    slug: 'sac-cabas-cuir-graine-milano',
    category_id: 'fashion',
    base_price: 185000,
    currency: 'XAF',
    stock_quantity: 8,
    status: 'PENDING_APPROVAL',
    is_featured: false,
    created_at: '2026-09-15T08:30:00Z'
  },
  {
    id: 'lst_repair_3',
    store_id: 'store_kamer_2',
    store_name: 'Kamer Tech Solutions',
    title: 'Maintenance Réseau & Serveur Entreprise Douala / Yaoundé',
    slug: 'maintenance-reseau-serveur',
    category_id: 'services',
    base_price: 120000,
    currency: 'XAF',
    stock_quantity: 99,
    status: 'PUBLISHED',
    is_featured: false,
    created_at: '2026-09-14T11:00:00Z'
  }
];

// Default in-memory users for fallback / test runs
const DEFAULT_USERS = [
  {
    id: 'usr_admin_1',
    full_name: 'Super Admin LOUMOO',
    email: 'admin@loumoo.cm',
    phone_number: '237690123456',
    primary_role: 'super_admin',
    kyc_status: 'verified',
    status: 'active',
    city: 'Douala',
    created_at: '2026-01-01T00:00:00Z'
  },
  {
    id: 'usr_seller_1',
    full_name: 'Jean-Paul Ndedi',
    email: 'jp.ndedi@gmail.com',
    phone_number: '237677101234',
    primary_role: 'seller',
    kyc_status: 'verified',
    status: 'active',
    city: 'Douala',
    created_at: '2026-08-01T10:00:00Z'
  },
  {
    id: 'usr_buyer_1',
    full_name: 'Martine Ngo Yomkil',
    email: 'martine.ngo@gmail.com',
    phone_number: '237699112233',
    primary_role: 'customer',
    kyc_status: 'unverified',
    status: 'active',
    city: 'Yaoundé',
    created_at: '2026-09-05T14:20:00Z'
  }
];

// Default in-memory orders for fallback / test runs
const DEFAULT_ORDERS = [
  {
    id: 'ord_1001',
    order_number: 'LM-2609-8472',
    user_id: 'usr_buyer_1',
    customer_name: 'Martine Ngo Yomkil',
    store_id: 'store_orca_1',
    store_name: 'Orca Electronics',
    total_amount: 2450000,
    currency: 'XAF',
    status: 'DELIVERED',
    payment_status: 'PAID',
    escrow_status: 'HELD',
    created_at: '2026-09-16T15:00:00Z'
  },
  {
    id: 'ord_1002',
    order_number: 'LM-2609-9134',
    user_id: 'usr_buyer_1',
    customer_name: 'Martine Ngo Yomkil',
    store_id: 'store_milano_3',
    store_name: 'Armonía Milano Boutique',
    total_amount: 185000,
    currency: 'XAF',
    status: 'PROCESSING',
    payment_status: 'PAID',
    escrow_status: 'HELD',
    created_at: '2026-09-17T10:30:00Z'
  }
];

/**
 * Public settings exposure policy.
 *
 * The public bootstrap endpoints (/api/config, /api/v1/config) are
 * UNAUTHENTICATED, so exposure is deny-by-default: only the keys named here are
 * ever sent to a browser, and for a key listed in PUBLIC_SETTING_FIELDS only
 * those sub-fields are kept. Everything else stays server-side — most
 * importantly the internal commission economics (`category_rates`) and the
 * maintenance admin-bypass policy. A setting whose database row is flagged
 * `is_secret` is withheld even when it is listed here.
 */
const PUBLIC_SETTING_KEYS = Object.freeze([
  'seller_whatsapp_default',
  'maintenance_mode',
  'announcement_banner',
  'shipping_rates_by_city',
  'feature_flags',
  'platform_commission_rate'
]);

// Per-key sub-field allowlist. A key absent here is exposed whole (after the
// is_secret and key checks); a key present here is reduced to just these fields
// before it leaves the server.
const PUBLIC_SETTING_FIELDS = Object.freeze({
  platform_commission_rate: ['rate_percent', 'payout_fee_fixed_xaf', 'escrow_hold_days'],
  maintenance_mode: ['enabled', 'banner_text']
});

function projectPublicSetting(key, value) {
  const fields = PUBLIC_SETTING_FIELDS[key];
  if (!fields || !value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const projected = {};
  for (const f of fields) {
    if (value[f] !== undefined) projected[f] = value[f];
  }
  return projected;
}

// Canonical set of audit action verbs this module can record. Single source of
// truth for the audit-action filter; keep in exact sync with the `action`
// strings passed to recordAuditLog across SuperAdminService. Earlier this list
// advertised verbs that are never written (`order.escrow`, `maintenance.toggle`,
// and — before role/KYC got their own verbs — `user.role_change`/`user.kyc_update`)
// while omitting ones that are (`escrow.resolve`, `listing.reject`,
// `listing.moderate`, `user.update`).
const AUDIT_ACTIONS = Object.freeze([
  'setting.update',
  'setting.reset',
  'store.moderate',
  'store.verify',
  'store.suspend',
  'store.reactivate',
  'listing.moderate',
  'listing.approve',
  'listing.reject',
  'listing.suspend',
  'user.update',
  'user.role_change',
  'user.kyc_update',
  'escrow.resolve',
  'audit.export'
]);

// In-memory audit log storage for fallback / test runs
const inMemoryAuditLogs = [];
const inMemorySettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
const inMemoryStores = JSON.parse(JSON.stringify(DEFAULT_STORES));
const inMemoryListings = JSON.parse(JSON.stringify(DEFAULT_LISTINGS));
const inMemoryUsers = JSON.parse(JSON.stringify(DEFAULT_USERS));
const inMemoryOrders = JSON.parse(JSON.stringify(DEFAULT_ORDERS));

/*
 * ── Schema translation (database path only) ──────────────────────────────
 * The admin API speaks one vocabulary (owner.full_name, kyc_status, an order's
 * status / escrow_status / total_amount, a listing's base_price) and the
 * in-memory seed rows above are written in it. The database speaks another:
 * profiles have first_name/last_name and kyc_doc_status, orders have
 * fulfillment_status / payment_status / total_amount_xaf and no store_id,
 * listings have base_price_minor. The queries used to select the admin names
 * directly, every one of them failed with 42703 (no such column), and the
 * error was swallowed into the built-in demo rows — so the console showed
 * "Orca Electronics" and invented KPIs against a live database, and moderating
 * a real store answered "Store not found". These helpers translate at the
 * boundary; a database error now throws instead of serving demo data.
 */

const OWNER_COLUMNS = 'first_name, last_name, email, phone_number, kyc_doc_status';
const USER_COLUMNS = 'id, clerk_user_id, first_name, last_name, email, phone_number, city, primary_role, kyc_doc_status, status, account_status, created_at, updated_at';
const STORE_LIST_COLUMNS = 'id, owner_id, name, slug, description, category_id, phone_number, email, status, visibility, is_verified, verification_tier, rating, product_count, metadata, created_at, updated_at';
const LISTING_LIST_COLUMNS = 'id, store_id, seller_id, title, slug, description, category_id, base_price_minor, currency, status, visibility, published_at, created_at, updated_at';
const ORDER_LIST_COLUMNS = 'id, order_number, buyer_id, seller_id, total_amount_xaf, items, payment_status, fulfillment_status, created_at, updated_at';

// Columns an admin edit may write. Anything else in an update (a `reason`, the
// legacy `is_approved`) is not a column and made the whole write fail.
const STORE_WRITABLE = new Set(['name', 'description', 'category_id', 'logo_url', 'cover_url', 'phone_number', 'email', 'website_url', 'status', 'visibility', 'is_verified', 'verification_tier', 'onboarding_completed', 'onboarding_step', 'metadata']);
const LISTING_WRITABLE = new Set(['title', 'description', 'short_description', 'category_id', 'brand', 'tags', 'status', 'visibility', 'rejection_reason', 'published_at']);
const USER_WRITABLE = new Set(['first_name', 'last_name', 'city', 'avatar_url', 'phone_number', 'status', 'primary_role', 'kyc_doc_status']);

const PAYMENT_TO_ESCROW = Object.freeze({
  pending: 'PENDING', paid: 'PAID', escrow_held: 'HELD', released: 'RELEASED', refundable: 'REFUNDABLE', refunded: 'REFUNDED'
});
const ESCROW_TO_PAYMENT = Object.freeze({
  PENDING: 'pending', PAID: 'paid', HELD: 'escrow_held', RELEASED: 'released', REFUNDABLE: 'refundable', REFUNDED: 'refunded'
});
const FULFILLMENT_TO_STATUS = Object.freeze({
  processing: 'PROCESSING', in_transit: 'IN_TRANSIT', delivered: 'DELIVERED', cancelled: 'CANCELLED'
});
const STATUS_TO_FULFILLMENT = Object.freeze({
  PENDING: 'processing', PROCESSING: 'processing', IN_TRANSIT: 'in_transit', SHIPPED: 'in_transit',
  DELIVERED: 'delivered', COMPLETED: 'delivered', CANCELLED: 'cancelled'
});

function dbFailure(context, error) {
  return new InfrastructureError('Supabase', `${context} failed: ${error && error.message ? error.message : error}`, error);
}

function pick(updates, writable) {
  const out = {};
  for (const [k, v] of Object.entries(updates || {})) {
    if (writable.has(k)) out[k] = v;
  }
  return out;
}

/** PostgREST parses an or() argument as filter syntax: a comma, parenthesis or quote in it rewrites the filter. */
function filterSafe(text) {
  return String(text || '').replace(/["(),]/g, ' ').trim();
}

function fullName(p) {
  return p ? ([p.first_name, p.last_name].filter(Boolean).join(' ').trim() || null) : null;
}

/** The KYC vocabulary the API accepts has `unverified`; the column calls that state `pending`. */
function toDbKyc(status) {
  const s = String(status || '').toLowerCase();
  return s === 'unverified' ? 'pending' : s;
}

function toAdminOwner(profile) {
  if (!profile) return null;
  return {
    full_name: fullName(profile),
    email: profile.email || null,
    phone_number: profile.phone_number || null,
    kyc_status: profile.kyc_doc_status || 'pending'
  };
}

function toAdminStore(row) {
  if (!row) return null;
  const { profiles, ...store } = row;
  return {
    ...store,
    city: (store.metadata && store.metadata.city) || null,
    owner: toAdminOwner(profiles)
  };
}

function toAdminUser(row) {
  if (!row) return null;
  return { ...row, full_name: fullName(row), kyc_status: row.kyc_doc_status || 'pending' };
}

function toAdminListing(row) {
  if (!row) return null;
  const { stores, ...listing } = row;
  return {
    ...listing,
    base_price: Number(listing.base_price_minor) || 0,
    store_name: (stores && stores.name) || 'Boutique'
  };
}

function toAdminOrder(row, buyerNames = {}) {
  if (!row) return null;
  const items = Array.isArray(row.items) ? row.items : [];
  const first = items[0] || {};
  const payment = String(row.payment_status || 'pending').toLowerCase();
  const fulfillment = String(row.fulfillment_status || 'processing').toLowerCase();
  return {
    ...row,
    user_id: row.buyer_id,
    customer_name: buyerNames[row.buyer_id] || 'Acheteur LOUMOO',
    store_id: first.storeId || null,
    store_name: first.storeName || 'Boutique',
    total_amount: Number(row.total_amount_xaf) || 0,
    currency: 'XAF',
    status: FULFILLMENT_TO_STATUS[fulfillment] || fulfillment.toUpperCase(),
    payment_status: payment.toUpperCase(),
    escrow_status: PAYMENT_TO_ESCROW[payment] || 'PENDING'
  };
}

/** An admin order patch (status / escrow_status) as the columns that hold them. */
function toDbOrderPatch(updates) {
  const patch = {};
  if (updates.escrow_status !== undefined) {
    const payment = ESCROW_TO_PAYMENT[String(updates.escrow_status).toUpperCase()];
    if (!payment) throw new ValidationError(`Unknown escrow status [${updates.escrow_status}].`);
    patch.payment_status = payment;
  }
  if (updates.status !== undefined) {
    const fulfillment = STATUS_TO_FULFILLMENT[String(updates.status).toUpperCase()];
    if (!fulfillment) throw new ValidationError(`Unknown order status [${updates.status}].`);
    patch.fulfillment_status = fulfillment;
  }
  return patch;
}

async function buyerNamesFor(db, rows) {
  const ids = [...new Set((rows || []).map(r => r.buyer_id).filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await db.from('profiles').select('id, first_name, last_name').in('id', ids);
  if (error) throw dbFailure('Admin order buyer lookup', error);
  const names = {};
  (data || []).forEach(p => { names[p.id] = fullName(p); });
  return names;
}

/** Every row of a table, a page at a time (PostgREST caps a single response). */
async function selectAll(db, table, columns, context, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db.from(table).select(columns).order('id', { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw dbFailure(context, error);
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

/** Identity reads are cached; an admin edit must reach the next request, not the one five minutes later. */
async function invalidateProfile(row) {
  if (!row) return;
  try {
    const ProfileRepository = require('../../../server/modules/identity/infrastructure/ProfileRepository');
    await ProfileRepository.invalidate(row.clerk_user_id, row.id);
  } catch (err) {
    logger.warn(`[SuperAdminRepository] Profile cache invalidation failed for ${row.id}: ${err.message}`);
  }
}

async function invalidateStore(row) {
  if (!row) return;
  try {
    const CacheService = require('../../../server/infrastructure/cache/CacheService');
    await CacheService.del(`store:public:${row.id}`);
    if (row.slug) await CacheService.del(`store:public:${row.slug}`);
    await CacheService.delPattern(`listings:store:${row.id}:*`, 'catalog');
  } catch (err) {
    logger.warn(`[SuperAdminRepository] Store cache invalidation failed for ${row.id}: ${err.message}`);
  }
}

class SuperAdminRepository {
  static get db() {
    if (process.env.NODE_ENV === 'test' && !process.env.ENABLE_TEST_REMOTE_DB) {
      return null;
    }
    try {
      return SupabaseDatabase.getAdmin();
    } catch (err) {
      return null;
    }
  }

  /**
   * Fetches all dynamic system settings.
   */
  static async getAllSettings() {
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db
          .from('system_settings')
          .select('key, value, category, description, is_secret, updated_by, updated_at');
        if (!error && Array.isArray(data) && data.length > 0) {
          const mapped = {};
          for (const row of data) {
            mapped[row.key] = row.value;
          }
          return { ...DEFAULT_SETTINGS, ...mapped };
        }
      } catch (err) {
        logger.warn('[SuperAdminRepository] Falling back to in-memory settings:', err.message);
      }
    }
    return { ...inMemorySettings };
  }

  /**
   * Returns the browser-safe projection of system settings for the public,
   * unauthenticated bootstrap endpoints. Deny-by-default: only allowlisted
   * keys, only their allowlisted sub-fields, and never a key flagged
   * `is_secret` in the database.
   *
   * Distinct from getAllSettings(), which the authenticated admin surfaces use
   * and which deliberately returns everything (including secrets).
   */
  static async getPublicSettings() {
    const merged = { ...DEFAULT_SETTINGS, ...inMemorySettings };
    const secretKeys = new Set();

    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db
          .from('system_settings')
          .select('key, value, is_secret');
        if (!error && Array.isArray(data)) {
          for (const row of data) {
            if (row.is_secret === true) {
              secretKeys.add(row.key);
            } else {
              merged[row.key] = row.value;
            }
          }
        }
      } catch (err) {
        logger.warn('[SuperAdminRepository] Public settings query failed, using in-memory:', err.message);
      }
    }

    const result = {};
    for (const key of PUBLIC_SETTING_KEYS) {
      if (secretKeys.has(key)) continue;
      const value = merged[key];
      if (value === undefined || value === null) continue;
      result[key] = projectPublicSetting(key, value);
    }
    return result;
  }

  /**
   * Fetches a single system setting by key.
   */
  static async getSetting(key) {
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db
          .from('system_settings')
          .select('key, value, category, description, updated_at')
          .eq('key', key)
          .maybeSingle();
        if (!error && data) {
          return data.value;
        }
      } catch (err) {
        logger.warn(`[SuperAdminRepository] Failed to query setting ${key}:`, err.message);
      }
    }
    return inMemorySettings[key] || DEFAULT_SETTINGS[key] || null;
  }

  /**
   * Updates or inserts a dynamic system setting.
   */
  static async updateSetting(key, value, adminId = 'super_admin') {
    const db = this.db;
    let oldVal = inMemorySettings[key] || DEFAULT_SETTINGS[key] || null;

    if (db) {
      try {
        // Fetch old value first for audit trail
        const existing = await db
          .from('system_settings')
          .select('value')
          .eq('key', key)
          .maybeSingle();
        if (existing && existing.data) {
          oldVal = existing.data.value;
        }

        const { data, error } = await db
          .from('system_settings')
          .upsert({
            key,
            value,
            updated_by: adminId,
            updated_at: new Date().toISOString()
          }, { onConflict: 'key' })
          .select()
          .single();

        if (!error && data) {
          inMemorySettings[key] = value;
          return { success: true, key, value: data.value, oldVal };
        }
      } catch (err) {
        logger.warn(`[SuperAdminRepository] DB upsert failed for ${key}, using memory:`, err.message);
      }
    }

    inMemorySettings[key] = value;
    return { success: true, key, value, oldVal };
  }

  /**
   * Records an immutable audit log entry.
   */
  static async recordAuditLog({ adminId, action, resourceType, resourceId, oldValues = null, newValues = null, reason = null, ipAddress = null }) {
    const logEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      admin_id: adminId || 'admin_unknown',
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      old_values: oldValues,
      new_values: newValues,
      reason,
      ip_address: ipAddress || '127.0.0.1',
      created_at: new Date().toISOString()
    };

    const db = this.db;
    if (db) {
      try {
        const { error } = await db.from('audit_logs').insert([logEntry]);
        if (error) {
          logger.warn('[SuperAdminRepository] Failed to insert audit log to DB:', error.message);
        }
      } catch (err) {
        logger.warn('[SuperAdminRepository] Failed to insert audit log to DB:', err.message);
      }
    }

    inMemoryAuditLogs.unshift(logEntry);
    if (inMemoryAuditLogs.length > 500) {
      inMemoryAuditLogs.pop();
    }
    return logEntry;
  }

  /**
   * Retrieves list of platform setting categories.
   */
  static getSettingCategories() {
    return [
      { id: 'financial', label: 'Financier & Commissions', icon: '💰', description: 'Taux de commission, séquestre et frais de virement' },
      { id: 'commercial', label: 'Commercial & Vendeurs', icon: '📞', description: 'Ligne WhatsApp officielle et hotlines vendeurs' },
      { id: 'operational', label: 'Opérationnel & Livraison', icon: '🚚', description: 'Tarifs de livraison régionaux et maintenance' },
      { id: 'general', label: 'Général & Marketing', icon: '📢', description: 'Bannière de diffusion et annonces marketplace' },
      { id: 'feature_flags', label: 'Fonctionnalités & Modules', icon: '⚡', description: 'Interrupteurs temps réel des fonctionnalités' }
    ];
  }

  /**
   * Fetches settings belonging to a specific category.
   */
  static async getSettingsByCategory(category) {
    const all = await this.getAllSettings();
    const categoryMap = {
      financial: ['platform_commission_rate'],
      commercial: ['seller_whatsapp_default'],
      operational: ['shipping_rates_by_city', 'maintenance_mode'],
      general: ['announcement_banner'],
      feature_flags: ['feature_flags']
    };
    const keys = categoryMap[category] || [];
    const result = {};
    for (const k of keys) {
      if (all[k] !== undefined) {
        result[k] = all[k];
      }
    }
    return result;
  }

  /**
   * Resets a setting back to its factory seed configuration.
   */
  static async resetSetting(key, adminId = 'super_admin') {
    if (!DEFAULT_SETTINGS[key]) {
      throw new NotFoundError(`No default baseline setting found for key [${key}]`);
    }
    const defaultValue = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[key]));
    return await this.updateSetting(key, defaultValue, adminId);
  }

  /**
   * Retrieves audit logs with multi-criteria filtering, pagination, and count metadata.
   */
  static async getAuditLogs({
    limit = 50,
    offset = 0,
    resourceType = null,
    action = null,
    adminId = null,
    resourceId = null,
    startDate = null,
    endDate = null,
    search = null
  } = {}) {
    limit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    offset = Math.max(parseInt(offset, 10) || 0, 0);

    const db = this.db;
    if (db) {
      try {
        let query = db
          .from('audit_logs')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false });

        if (resourceType) query = query.eq('resource_type', resourceType);
        if (action) query = query.eq('action', action);
        if (adminId) query = query.eq('admin_id', adminId);
        if (resourceId) query = query.eq('resource_id', resourceId);
        if (startDate) {
          const d = new Date(startDate);
          if (!isNaN(d.getTime())) {
            query = query.gte('created_at', d.toISOString());
          }
        }
        if (endDate) {
          const d = new Date(endDate);
          if (!isNaN(d.getTime())) {
            query = query.lte('created_at', d.toISOString());
          }
        }
        if (search) {
          const sanitized = String(search).replace(/[%_,()"\\]/g, ' ').trim();
          if (sanitized) {
            query = query.or(`reason.ilike.%${sanitized}%,resource_id.ilike.%${sanitized}%,action.ilike.%${sanitized}%,admin_id.ilike.%${sanitized}%`);
          }
        }

        query = query.range(offset, offset + limit - 1);
        const { data, count, error } = await query;
        if (!error && Array.isArray(data)) {
          const totalCount = (count !== null && count !== undefined) ? count : data.length;
          data.totalCount = totalCount;
          data.totalPages = Math.ceil(totalCount / limit) || 1;
          data.limit = limit;
          data.offset = offset;
          data.filters = { resourceType, action, adminId, resourceId, startDate, endDate, search };
          return data;
        }
      } catch (err) {
        logger.warn('[SuperAdminRepository] Audit logs query error, falling back to memory:', err.message);
      }
    }

    let filtered = inMemoryAuditLogs;
    if (resourceType) {
      filtered = filtered.filter(l => l.resource_type === resourceType);
    }
    if (action) {
      filtered = filtered.filter(l => l.action === action);
    }
    if (adminId) {
      filtered = filtered.filter(l => l.admin_id === adminId);
    }
    if (resourceId) {
      filtered = filtered.filter(l => l.resource_id === resourceId);
    }
    if (startDate) {
      const startTs = new Date(startDate).getTime();
      if (!isNaN(startTs)) {
        filtered = filtered.filter(l => new Date(l.created_at).getTime() >= startTs);
      }
    }
    if (endDate) {
      const endTs = new Date(endDate).getTime();
      if (!isNaN(endTs)) {
        filtered = filtered.filter(l => new Date(l.created_at).getTime() <= endTs);
      }
    }
    if (search) {
      const q = String(search).toLowerCase().trim();
      filtered = filtered.filter(l => {
        return (
          (l.reason && String(l.reason).toLowerCase().includes(q)) ||
          (l.resource_id && String(l.resource_id).toLowerCase().includes(q)) ||
          (l.resource_type && String(l.resource_type).toLowerCase().includes(q)) ||
          (l.action && String(l.action).toLowerCase().includes(q)) ||
          (l.admin_id && String(l.admin_id).toLowerCase().includes(q)) ||
          (l.ip_address && String(l.ip_address).toLowerCase().includes(q))
        );
      });
    }

    const totalCount = filtered.length;
    const totalPages = Math.ceil(totalCount / limit) || 1;
    const sliced = filtered.slice(offset, offset + limit);
    sliced.totalCount = totalCount;
    sliced.totalPages = totalPages;
    sliced.limit = limit;
    sliced.offset = offset;
    sliced.filters = { resourceType, action, adminId, resourceId, startDate, endDate, search };
    return sliced;
  }

  /**
   * Sanitizes sensitive fields (passwords, tokens, keys) from exported payloads.
   */
  static sanitizeAuditValues(val) {
    if (val === null || val === undefined) return val;
    if (typeof val !== 'object') return val;
    if (Array.isArray(val)) {
      return val.map(item => this.sanitizeAuditValues(item));
    }
    const sanitized = {};
    const SENSITIVE_REGEX = /^(password|token|secret|api_?key|credential|private_?key|auth_?token|jwt)/i;
    for (const [k, v] of Object.entries(val)) {
      if (SENSITIVE_REGEX.test(k)) {
        sanitized[k] = '[REDACTED]';
      } else if (typeof v === 'object' && v !== null) {
        sanitized[k] = this.sanitizeAuditValues(v);
      } else {
        sanitized[k] = v;
      }
    }
    return sanitized;
  }

  /**
   * Retrieves unique distinct action types recorded in the audit trail.
   */
  static async getAuditActions() {
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('audit_logs').select('action');
        if (!error && Array.isArray(data) && data.length > 0) {
          return Array.from(new Set(data.map(d => d.action).filter(Boolean))).sort();
        }
      } catch (_) {}
    }
    const memoryActions = inMemoryAuditLogs.map(l => l.action).filter(Boolean);
    return Array.from(new Set([...AUDIT_ACTIONS, ...memoryActions])).sort();
  }

  /**
   * Exports filtered audit logs formatted for compliance in CSV or JSON.
   */
  static async exportAuditLogs(filters = {}, format = 'csv') {
    const exportLimit = Math.min(Math.max(parseInt(filters.limit, 10) || 5000, 1), 5000);
    const exportOffset = Math.max(parseInt(filters.offset, 10) || 0, 0);
    const logs = await this.getAuditLogs({ ...filters, limit: exportLimit, offset: exportOffset });
    const count = logs.length;

    // Sanitize records prior to export
    const sanitizedLogs = logs.map(l => ({
      ...l,
      old_values: this.sanitizeAuditValues(l.old_values),
      new_values: this.sanitizeAuditValues(l.new_values)
    }));

    if (format === 'json') {
      return {
        content: JSON.stringify(sanitizedLogs, null, 2),
        contentType: 'application/json; charset=utf-8',
        extension: 'json',
        count
      };
    }

    // Standard RFC 4180 CSV generation with formula injection mitigation
    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      let str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      // OWASP Formula Injection defense: prefix dangerous leading characters with a single quote
      if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
      }
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = ['ID', 'Date', 'Action', 'ResourceType', 'ResourceId', 'AdminId', 'IPAddress', 'Reason', 'OldValues', 'NewValues'].map(h => `"${h}"`);
    const rows = sanitizedLogs.map(l => [
      escapeCsv(l.id),
      escapeCsv(l.created_at),
      escapeCsv(l.action),
      escapeCsv(l.resource_type),
      escapeCsv(l.resource_id),
      escapeCsv(l.admin_id),
      escapeCsv(l.ip_address),
      escapeCsv(l.reason),
      escapeCsv(l.old_values),
      escapeCsv(l.new_values)
    ].join(','));

    const csvContent = [headers.join(','), ...rows].join('\r\n');
    return {
      content: csvContent,
      contentType: 'text/csv; charset=utf-8',
      extension: 'csv',
      count
    };
  }

  /**
   * Aggregates live system overview metrics for the executive dashboard.
   */
  /**
   * Sum of order value currently held in escrow ("in flight") — i.e. funds
   * neither released to the seller nor refunded to the buyer yet. Pure and
   * static so the aggregation logic can be unit-tested without a database.
   */
  static sumEscrowInFlight(orders) {
    if (!Array.isArray(orders)) return 0;
    return orders.reduce((acc, o) => {
      const held = String(o && o.escrow_status).toUpperCase() === 'HELD';
      return held ? acc + (Number(o.total_amount) || 0) : acc;
    }, 0);
  }

  static async getOverviewMetrics() {
    // The seeded figures describe the in-memory demo rows only. With a database
    // every KPI is computed from it, and a failed read is an error, not a demo.
    let storesCount = 18;
    let pendingKycCount = 3;
    let usersCount = 142;
    let orders = inMemoryOrders;

    const db = this.db;
    if (db) {
      const [stores, profilesRes, orderRows] = await Promise.all([
        selectAll(db, 'stores', 'id, status, is_verified', 'Admin overview store count'),
        db.from('profiles').select('id', { count: 'exact', head: true }),
        selectAll(db, 'orders', 'id, total_amount_xaf, payment_status, fulfillment_status', 'Admin overview order totals')
      ]);
      if (profilesRes.error) throw dbFailure('Admin overview user count', profilesRes.error);

      // "Boutiques actives": live stores, not every row ever created.
      storesCount = stores.filter(s => s.status === 'ACTIVE').length;
      pendingKycCount = stores.filter(s => s.status === 'PENDING_VERIFICATION' || !s.is_verified).length;
      usersCount = Number(profilesRes.count) || 0;
      orders = orderRows.map(o => toAdminOrder(o));
    }

    const totalOrders = orders.length;
    const gmvXaf = orders.reduce((acc, o) => acc + (Number(o.total_amount) || 0), 0);
    const escrowInFlightXaf = this.sumEscrowInFlight(orders);

    return {
      kpis: {
        gmvXaf,
        gmvFormatted: `${(gmvXaf || 0).toLocaleString()} XAF`,
        totalOrders,
        activeStores: storesCount,
        pendingKycCount,
        registeredUsers: usersCount,
        escrowInFlightXaf,
        escrowInFlightFormatted: `${(escrowInFlightXaf || 0).toLocaleString()} XAF`
      },
      health: {
        serverStatus: 'HEALTHY',
        databaseStatus: db ? 'CONNECTED' : 'NOT_CONFIGURED',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Lists stores with optional status, tier, and search filtering.
   */
  static async listStores({ status = null, tier = null, search = null, limit = 50, offset = 0 } = {}) {
    const db = this.db;
    if (db) {
      let query = db
        .from('stores')
        .select(`${STORE_LIST_COLUMNS}, profiles!inner(${OWNER_COLUMNS})`)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status && status !== 'ALL') {
        query = query.eq('status', status);
      }
      if (tier && tier !== 'ALL') {
        query = query.eq('verification_tier', tier);
      }
      if (search) {
        query = query.ilike('name', `%${search}%`);
      }

      const { data, error } = await query;
      if (error) throw dbFailure('Admin store list', error);
      return (data || []).map(toAdminStore);
    }

    let results = inMemoryStores;
    if (status && status !== 'ALL') {
      results = results.filter(s => s.status === status);
    }
    if (tier && tier !== 'ALL') {
      results = results.filter(s => s.verification_tier === tier);
    }
    if (search) {
      const q = search.toLowerCase();
      results = results.filter(s =>
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.slug && s.slug.toLowerCase().includes(q)) ||
        (s.phone_number && s.phone_number.includes(q)) ||
        (s.owner && s.owner.full_name && s.owner.full_name.toLowerCase().includes(q))
      );
    }
    return results.slice(offset, offset + limit);
  }

  /**
   * Retrieves a single store by ID with owner metadata.
   */
  static async getStoreById(id) {
    const db = this.db;
    if (db) {
      const { data, error } = await db
        .from('stores')
        .select(`*, profiles!inner(${OWNER_COLUMNS})`)
        .eq('id', id)
        .maybeSingle();
      if (error) throw dbFailure(`Admin store lookup ${id}`, error);
      return toAdminStore(data);
    }

    return inMemoryStores.find(s => s.id === id) || null;
  }

  /**
   * Updates store status, verification tier, or contact details.
   */
  static async updateStore(id, updates = {}, adminId = 'super_admin') {
    const oldStore = await this.getStoreById(id);
    if (!oldStore) {
      return { success: false, error: 'Store not found' };
    }

    const db = this.db;
    if (db) {
      const patch = pick(updates, STORE_WRITABLE);
      if (!Object.keys(patch).length) {
        return { success: false, error: 'Nothing to update on this store.' };
      }
      const { data, error } = await db
        .from('stores')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select(`*, profiles!inner(${OWNER_COLUMNS})`)
        .single();
      if (error) throw dbFailure(`Admin store update ${id}`, error);

      // Verifying a store verifies its owner's KYC as well.
      if (patch.is_verified === true && data.owner_id) {
        const { data: owner, error: ownerError } = await db
          .from('profiles')
          .update({ kyc_doc_status: 'verified', updated_at: new Date().toISOString() })
          .eq('id', data.owner_id)
          .select('id, clerk_user_id')
          .maybeSingle();
        if (ownerError) throw dbFailure(`Admin owner KYC update for store ${id}`, ownerError);
        await invalidateProfile(owner);
        if (data.profiles) data.profiles.kyc_doc_status = 'verified';
      }
      await invalidateStore(data);
      return { success: true, store: toAdminStore(data), oldStore };
    }

    const payload = {
      ...updates,
      updated_at: new Date().toISOString()
    };
    const idx = inMemoryStores.findIndex(s => s.id === id);
    if (idx !== -1) {
      const updated = {
        ...inMemoryStores[idx],
        ...payload
      };
      if (updates.is_verified === true && updated.owner) {
        updated.owner.kyc_status = 'verified';
      }
      inMemoryStores[idx] = updated;
      return { success: true, store: updated, oldStore };
    }

    return { success: false, error: 'Store update failed' };
  }

  // ── LISTINGS MANAGEMENT ──

  static async listListings({ status = null, search = null, limit = 50, offset = 0 } = {}) {
    const db = this.db;
    if (db) {
      let query = db
        .from('listings')
        .select(`${LISTING_LIST_COLUMNS}, stores!inner(name)`)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status && status !== 'ALL') query = query.eq('status', status);
      if (search) query = query.ilike('title', `%${search}%`);

      const { data, error } = await query;
      if (error) throw dbFailure('Admin listing list', error);
      return (data || []).map(toAdminListing);
    }

    let results = inMemoryListings;
    if (status && status !== 'ALL') results = results.filter(l => l.status === status);
    if (search) {
      const q = search.toLowerCase();
      results = results.filter(l => (l.title && l.title.toLowerCase().includes(q)) || (l.store_name && l.store_name.toLowerCase().includes(q)));
    }
    return results.slice(offset, offset + limit);
  }

  static async getListingById(id) {
    const db = this.db;
    if (db) {
      const { data, error } = await db.from('listings').select('*, stores(name)').eq('id', id).maybeSingle();
      if (error) throw dbFailure(`Admin listing lookup ${id}`, error);
      return toAdminListing(data);
    }
    return inMemoryListings.find(l => l.id === id) || null;
  }

  static async updateListing(id, updates = {}, adminId = 'super_admin') {
    const oldListing = await this.getListingById(id);
    if (!oldListing) return { success: false, error: 'Listing not found' };

    const db = this.db;
    if (db) {
      const patch = pick(updates, LISTING_WRITABLE);
      // An approved listing goes live now if it never had a publication date;
      // the catalogue sorts by it and buries a NULL published_at.
      if (patch.status === 'PUBLISHED' && !oldListing.published_at && patch.published_at === undefined) {
        patch.published_at = new Date().toISOString();
      }
      if (!Object.keys(patch).length) {
        return { success: false, error: 'Nothing to update on this listing.' };
      }
      const { data, error } = await db
        .from('listings')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*, stores(name)')
        .single();
      if (error) throw dbFailure(`Admin listing update ${id}`, error);
      return { success: true, listing: toAdminListing(data), oldListing };
    }

    const payload = { ...updates, updated_at: new Date().toISOString() };
    const idx = inMemoryListings.findIndex(l => l.id === id);
    if (idx !== -1) {
      const updated = { ...inMemoryListings[idx], ...payload };
      inMemoryListings[idx] = updated;
      return { success: true, listing: updated, oldListing };
    }
    return { success: false, error: 'Listing update failed' };
  }

  // ── USERS & RBAC MANAGEMENT ──

  static async listUsers({ role = null, kyc = null, search = null, limit = 50, offset = 0 } = {}) {
    const db = this.db;
    if (db) {
      let query = db
        .from('profiles')
        .select(USER_COLUMNS)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (role && role !== 'ALL') query = query.eq('primary_role', role);
      if (kyc && kyc !== 'ALL') query = query.eq('kyc_doc_status', toDbKyc(kyc));
      const q = filterSafe(search);
      if (q) {
        query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone_number.ilike.%${q}%`);
      }

      const { data, error } = await query;
      if (error) throw dbFailure('Admin user list', error);
      return (data || []).map(toAdminUser);
    }

    let results = inMemoryUsers;
    if (role && role !== 'ALL') results = results.filter(u => u.primary_role === role);
    if (kyc && kyc !== 'ALL') results = results.filter(u => u.kyc_status === kyc);
    if (search) {
      const q = search.toLowerCase();
      results = results.filter(u => (u.full_name && u.full_name.toLowerCase().includes(q)) || (u.email && u.email.toLowerCase().includes(q)) || (u.phone_number && u.phone_number.includes(q)));
    }
    return results.slice(offset, offset + limit);
  }

  static async getUserById(id) {
    const db = this.db;
    if (db) {
      const { data, error } = await db.from('profiles').select(USER_COLUMNS).eq('id', id).maybeSingle();
      if (error) throw dbFailure(`Admin user lookup ${id}`, error);
      return toAdminUser(data);
    }
    return inMemoryUsers.find(u => u.id === id) || null;
  }

  static async updateUser(id, updates = {}, adminId = 'super_admin') {
    const oldUser = await this.getUserById(id);
    if (!oldUser) return { success: false, error: 'User not found' };

    const db = this.db;
    if (db) {
      const translated = { ...updates };
      if (translated.kyc_status !== undefined) {
        translated.kyc_doc_status = toDbKyc(translated.kyc_status);
        delete translated.kyc_status;
      }
      const patch = pick(translated, USER_WRITABLE);
      if (!Object.keys(patch).length) {
        return { success: false, error: 'Nothing to update on this user.' };
      }
      const { data, error } = await db
        .from('profiles')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select(USER_COLUMNS)
        .single();
      if (error) throw dbFailure(`Admin user update ${id}`, error);
      // A suspension or a role change must hold on the user's very next request.
      await invalidateProfile(data);
      return { success: true, user: toAdminUser(data), oldUser };
    }

    const payload = { ...updates, updated_at: new Date().toISOString() };
    const idx = inMemoryUsers.findIndex(u => u.id === id);
    if (idx !== -1) {
      const updated = { ...inMemoryUsers[idx], ...payload };
      inMemoryUsers[idx] = updated;
      return { success: true, user: updated, oldUser };
    }
    return { success: false, error: 'User update failed' };
  }

  // ── ORDERS & ESCROW MANAGEMENT ──

  static async listOrders({ status = null, escrowStatus = null, search = null, limit = 50, offset = 0 } = {}) {
    const db = this.db;
    if (db) {
      let query = db
        .from('orders')
        .select(ORDER_LIST_COLUMNS)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status && status !== 'ALL') {
        query = query.eq('fulfillment_status', STATUS_TO_FULFILLMENT[String(status).toUpperCase()] || String(status).toLowerCase());
      }
      if (escrowStatus && escrowStatus !== 'ALL') {
        query = query.eq('payment_status', ESCROW_TO_PAYMENT[String(escrowStatus).toUpperCase()] || String(escrowStatus).toLowerCase());
      }
      const q = filterSafe(search);
      if (q) query = query.ilike('order_number', `%${q}%`);

      const { data, error } = await query;
      if (error) throw dbFailure('Admin order list', error);
      const names = await buyerNamesFor(db, data);
      return (data || []).map(o => toAdminOrder(o, names));
    }

    let results = inMemoryOrders;
    if (status && status !== 'ALL') results = results.filter(o => o.status === status);
    if (escrowStatus && escrowStatus !== 'ALL') results = results.filter(o => o.escrow_status === escrowStatus);
    if (search) {
      const q = search.toLowerCase();
      results = results.filter(o => (o.order_number && o.order_number.toLowerCase().includes(q)) || (o.customer_name && o.customer_name.toLowerCase().includes(q)));
    }
    return results.slice(offset, offset + limit);
  }

  static async getOrderById(id) {
    const db = this.db;
    if (db) {
      const { data, error } = await db.from('orders').select('*').eq('id', id).maybeSingle();
      if (error) throw dbFailure(`Admin order lookup ${id}`, error);
      if (!data) return null;
      return toAdminOrder(data, await buyerNamesFor(db, [data]));
    }
    return inMemoryOrders.find(o => o.id === id) || null;
  }

  static async updateOrder(id, updates = {}, adminId = 'super_admin') {
    const oldOrder = await this.getOrderById(id);
    if (!oldOrder) return { success: false, error: 'Order not found' };

    const db = this.db;
    if (db) {
      const patch = toDbOrderPatch(updates);
      if (!Object.keys(patch).length) {
        return { success: false, error: 'Nothing to update on this order.' };
      }
      const { data, error } = await db
        .from('orders')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw dbFailure(`Admin order update ${id}`, error);
      return { success: true, order: toAdminOrder(data, await buyerNamesFor(db, [data])), oldOrder };
    }

    const payload = { ...updates, updated_at: new Date().toISOString() };
    const idx = inMemoryOrders.findIndex(o => o.id === id);
    if (idx !== -1) {
      const updated = { ...inMemoryOrders[idx], ...payload };
      inMemoryOrders[idx] = updated;
      return { success: true, order: updated, oldOrder };
    }
    return { success: false, error: 'Order update failed' };
  }
}

module.exports = SuperAdminRepository;
module.exports.AUDIT_ACTIONS = AUDIT_ACTIONS;
module.exports.PUBLIC_SETTING_KEYS = PUBLIC_SETTING_KEYS;
module.exports.PUBLIC_SETTING_FIELDS = PUBLIC_SETTING_FIELDS;
module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
module.exports.DEFAULT_STORES = DEFAULT_STORES;
module.exports.DEFAULT_LISTINGS = DEFAULT_LISTINGS;
module.exports.DEFAULT_USERS = DEFAULT_USERS;
module.exports.DEFAULT_ORDERS = DEFAULT_ORDERS;
