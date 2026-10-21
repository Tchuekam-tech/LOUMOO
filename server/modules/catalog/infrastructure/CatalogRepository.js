/**
 * LOUMOO — Canonical Catalog Repository
 * ---------------------------------------------------------------------------
 * The authoritative query engine for buyer-facing product discovery.
 * Reads directly from PostgreSQL `iam.listings`, `iam.listing_media`, and
 * `iam.stores`.
 *
 * Rules:
 *   - Only returns listings that are status='PUBLISHED', visibility='PUBLIC',
 *     and deleted_at IS NULL.
 *   - Joins/hydrates store metadata and cover media URLs.
 *   - Supports full-text search, category taxonomy drilldown, and pagination.
 */

const { SupabaseDatabase, getAdminClient } = require('../../../infrastructure/database/SupabaseClient');
const { InfrastructureError } = require('../../../shared/errors/AppError');
const MediaStorageService = require('../../../infrastructure/storage/MediaStorageService');
const { config } = require('../../../config/env');
const { HOUSE_STORE } = require('../../store/domain/HouseStore');
const { getSharedHouseStore } = require('../../store/application/HouseStoreService');
const { priceToNumber } = require('../domain/CuratedCatalog');

const CATALOG_SELECT_COLUMNS = [
  'id', 'store_id', 'seller_id', 'listing_type', 'category_id', 'title', 'slug',
  'short_description', 'description', 'brand', 'model', 'condition',
  'status', 'visibility', 'currency', 'base_price_minor', 'sale_price_minor',
  'compare_at_price_minor', 'has_variants', 'fulfillment_model',
  'view_count', 'save_count', 'order_count', 'rating', 'rating_count',
  'published_at', 'created_at', 'updated_at'
].join(', ');

class CatalogRepository {
  static get db() {
    return SupabaseDatabase.getAdmin();
  }

  /** The admin client, or null when no database is configured (dev/demo only:
   *  production refuses to boot without one). */
  static get configuredDb() {
    return getAdminClient();
  }

  /**
   * Discovers and queries published listings with flexible filters and pagination.
   *
   * @param {object} options
   * @param {string} [options.category]
   * @param {string} [options.vertical]
   * @param {string} [options.search]
   * @param {string} [options.storeId]
   * @param {string} [options.brand]
   * @param {number} [options.page=1]
   * @param {number} [options.limit=20]
   * @param {string} [options.sortBy='recent'] 'recent' | 'price_asc' | 'price_desc' | 'popular' | 'rating'
   */
  static async listPublishedListings({
    category,
    vertical,
    search,
    storeId,
    brand,
    city,
    verified,
    page = 1,
    limit = 20,
    sortBy = 'recent'
  } = {}) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    // `stores!inner(status)` + `.eq('stores.status','ACTIVE')` is an INNER JOIN:
    // a listing is only merchandisable while the boutique behind it is live.
    // Without it, products from DRAFT boutiques — stores that never completed
    // activation and whose owner is not even SELLER_READY — were on sale in the
    // public marketplace.
    let dbItems = [];
    let dbTotal = 0;
    try {
      let query = this.db
        .from('listings')
        .select(`${CATALOG_SELECT_COLUMNS}, stores!inner(status)`, { count: 'exact' })
        .eq('status', 'PUBLISHED')
        .eq('visibility', 'PUBLIC')
        .eq('stores.status', 'ACTIVE')
        .is('deleted_at', null);

      if (storeId) {
        query = query.eq('store_id', storeId);
      }

      if (category && category !== 'all') {
        query = query.eq('category_id', category);
      }

      if (brand) {
        query = query.ilike('brand', `%${brand}%`);
      }

      // PostgREST parses the `or()` argument as a filter expression, so a comma,
      // parenthesis or quote typed into the search box rewrites the filter set
      // and 400s the whole query — which the catch below silently turns into
      // "no seller listings". Strip those the same way the detail lookup does.
      const q = String(search || '').trim().replace(/["(),]/g, ' ').trim();
      if (q) {
        // Searches across title, description, and brand
        query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%,brand.ilike.%${q}%`);
      }

      // Sort order
      switch (sortBy) {
        case 'price_asc':
          query = query.order('base_price_minor', { ascending: true, nullsFirst: false });
          break;
        case 'price_desc':
          query = query.order('base_price_minor', { ascending: false, nullsFirst: false });
          break;
        case 'popular':
          query = query
            .order('order_count', { ascending: false, nullsFirst: false })
            .order('view_count', { ascending: false, nullsFirst: false });
          break;
        case 'rating':
          query = query.order('rating', { ascending: false, nullsFirst: false });
          break;
        case 'recent':
        default:
          // `nullsFirst: false` is load-bearing, not a nicety. PostgreSQL sorts
          // NULLs FIRST for DESC by default, so rows carrying status=PUBLISHED
          // with a NULL published_at occupied the entire first page and buried
          // every genuinely published listing — a seller published an item and
          // never saw it appear in the marketplace.
          query = query
            .order('published_at', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false, nullsFirst: false });
          break;
      }

      query = query.range(offset, offset + limitNum - 1);

      const { data: rows, error, count } = await query;
      if (error) {
        throw new InfrastructureError('Supabase', `Catalog query failed: ${error.message}`, error);
      }

      const listingList = rows || [];
      dbTotal = count || listingList.length;

      if (listingList.length > 0) {
        // Hydrate store metadata and cover images in parallel
        const listingIds = listingList.map(l => l.id);
        const storeIds = [...new Set(listingList.map(l => l.store_id).filter(Boolean))];

        const [mediaRows, storeRows] = await Promise.all([
          this._loadMediaForListings(listingIds),
          this._loadStores(storeIds)
        ]);

        const mediaByListing = mediaRows.reduce((acc, m) => {
          if (!acc[m.listing_id]) acc[m.listing_id] = [];
          acc[m.listing_id].push(m);
          return acc;
        }, {});

        const storesById = storeRows.reduce((acc, s) => {
          acc[s.id] = s;
          return acc;
        }, {});

        // Transform into canonical product contract
        dbItems = listingList.map(l => {
          const mediaList = mediaByListing[l.id] || [];
          const cover = mediaList.find(m => m.is_cover) || mediaList[0] || null;
          const coverUrl = cover ? (cover.url || `/media-fallback/${cover.storage_path}`) : null;
          const store = storesById[l.store_id] || null;
          return this._formatProductCard(l, coverUrl, store, mediaList);
        });

        // Keep QA/test boutiques out of the public buyer feed in non-test environments — a shopper must
        // never see "Test Boutique …" listings sitting among real inventory.
        if (!config || !config.isTest) {
          const beforeFilter = dbItems.length;
          dbItems = dbItems.filter((it) =>
            !/^store_test_/i.test(String(it.storeId || '')) &&
            !/test\s*boutique/i.test(String(it.storeName || '')));
          dbTotal = Math.max(dbItems.length, dbTotal - (beforeFilter - dbItems.length));
        }
      }
    } catch (err) {
      // An empty or unreachable database is not fatal for discovery: the curated
      // storefront catalogue below is the real pre-launch inventory and keeps the
      // marketplace browsable. Fall through with no DB items.
      dbItems = [];
      dbTotal = 0;
    }

    // Marketplace refinement filters (city + verified store). Both live on the
    // hydrated card (merchantCity / verified), so they are applied uniformly to
    // DB and curated items rather than in SQL — keeping the two sources
    // consistent. After a JS filter the DB `count` no longer reflects the result
    // set, so treat the filtered page as the authoritative DB total.
    const wantVerified = verified === true || verified === 'true' || verified === '1';
    const cityMatch = CatalogRepository._cityMatcher(city);
    if (cityMatch || wantVerified) {
      dbItems = dbItems.filter((it) =>
        (!cityMatch || cityMatch(it.merchantCity)) &&
        (!wantVerified || it.verified === true));
      dbTotal = dbItems.length;
    }

    // Fill from the curated storefront catalogue. Real seller listings always
    // take precedence; curated products fill the remainder of the page so the
    // marketplace is never empty while inventory is still being onboarded.
    let items = dbItems;
    let total = dbTotal;
    if (dbItems.length < limitNum) {
      // Every curated product belongs to the house store. When it is provisioned
      // its real facts (verified, phone) replace the static ones.
      const house = await this._houseStore();
      let curated = this._filterCurated(this._curatedCards(), {
        category, vertical, search, brand, storeId, city, verified,
        houseVerified: house ? house.isVerified : undefined
      });
      curated = this._sortCurated(curated, sortBy);
      const seen = new Set(dbItems.map(i => i.id));
      curated = curated.filter(c => !seen.has(c.id));
      const curatedOffset = Math.max(0, offset - dbTotal);
      const need = limitNum - dbItems.length;
      items = dbItems.concat(curated.slice(curatedOffset, curatedOffset + need).map(c => this._presentWithHouse(c, house)));
      total = dbTotal + curated.length;
    }

    return {
      items,
      total,
      page: pageNum,
      limit: limitNum,
      hasMore: offset + items.length < total
    };
  }

  /**
   * Resolves a single public product by ID or Slug from database.
   */
  static async findPublicProductByIdOrSlug(idOrSlug) {
    if (!idOrSlug) return null;

    // Same rule as the listing query: a product detail page must not be
    // reachable for a boutique that is not live, or the link would simply be a
    // back door into what the catalog refuses to list.
    let row = null;
    try {
      let query = this.db
        .from('listings')
        .select(`${CATALOG_SELECT_COLUMNS}, stores!inner(status)`)
        .eq('status', 'PUBLISHED')
        .eq('visibility', 'PUBLIC')
        .eq('stores.status', 'ACTIVE')
        .is('deleted_at', null);

      const cleanId = String(idOrSlug).trim().replace(/["(),]/g, '');
      query = query.or(`id.eq.${cleanId},slug.eq.${cleanId}`);

      const { data, error } = await query.maybeSingle();
      if (error) {
        throw new InfrastructureError('Supabase', `Product lookup failed: ${error.message}`, error);
      }
      row = data;
    } catch (err) {
      row = null;
    }

    // No live listing? Fall back to the curated storefront product of that id.
    if (!row) return this._enrichCuratedDetail(this._curatedDetail(idOrSlug));

    const [mediaRows, storeRows, attributes] = await Promise.all([
      this._loadMediaForListings([row.id]),
      this._loadStores([row.store_id]),
      this._loadAttributes(row.id)
    ]);

    const store = storeRows[0] || null;
    const media = mediaRows.map(m => ({
      id: m.id,
      url: m.url || `/media-fallback/${m.storage_path}`,
      isCover: m.is_cover,
      displayOrder: m.display_order,
      width: m.width,
      height: m.height,
      altText: m.alt_text
    }));

    return this._formatProductDetail(row, store, media, attributes);
  }

  /**
   * STRICT public lookup for indexable surfaces (prerender, SEO head, 404
   * decisions). Returns the real published product — a live DB listing or a
   * REAL curated product — or `null` for an unknown id. Unlike
   * findPublicProductByIdOrSlug it NEVER fabricates a synthetic placeholder, so
   * a caller can answer 404 for an id that does not exist. (P3 aligns the public
   * products API with this same "unknown => not found" rule.)
   */
  static async findIndexableProductByIdOrSlug(idOrSlug) {
    if (!idOrSlug) return null;
    const cleanId = String(idOrSlug).trim().replace(/["(),]/g, '');

    // A DB ERROR must THROW (so a caller like the prerender can degrade to a
    // route-level 200 shell instead of wrongly 404-ing a real product during an
    // outage). Only a reachable DB that returns no row falls through to curated.
    // No database configured at all (local/demo without Supabase) is not an
    // outage: there are no seller listings to miss, so the curated catalogue is
    // the whole answer — otherwise every product page, real ones included, 503s.
    const db = this.configuredDb;
    let data = null;
    if (db) {
      const result = await db
        .from('listings')
        .select(`${CATALOG_SELECT_COLUMNS}, stores!inner(status)`)
        .eq('status', 'PUBLISHED')
        .eq('visibility', 'PUBLIC')
        .eq('stores.status', 'ACTIVE')
        .is('deleted_at', null)
        .or(`id.eq.${cleanId},slug.eq.${cleanId}`)
        .maybeSingle();
      if (result.error) {
        throw new InfrastructureError('Supabase', `Indexable product lookup failed: ${result.error.message}`, result.error);
      }
      data = result.data;
    }
    if (data) {
      const [mediaRows, storeRows, attributes] = await Promise.all([
        this._loadMediaForListings([data.id]),
        this._loadStores([data.store_id]),
        this._loadAttributes(data.id)
      ]);
      const media = mediaRows.map(m => ({
        id: m.id,
        url: m.url || `/media-fallback/${m.storage_path}`,
        isCover: m.is_cover,
        displayOrder: m.display_order,
        width: m.width,
        height: m.height,
        altText: m.alt_text
      }));
      return this._formatProductDetail(data, storeRows[0] || null, media, attributes);
    }

    // DB reachable, no live listing: a REAL curated product only (exact id/slug),
    // never the fabricated placeholder findPublicProductByIdOrSlug falls back to.
    const card = this._curatedCards().find(c => c.id === idOrSlug || c.slug === idOrSlug);
    return card ? this._enrichCuratedDetail(this._curatedDetail(card.id)) : null;
  }

  static _formatProductDetail(row, store, media = [], attributes = []) {
    const cover = (media && media.find(m => m.isCover)) || (media && media[0]) || null;
    return {
      ...this._formatProductCard(row, cover ? cover.url : null, store, media),
      description: row.description || '',
      shortDescription: row.short_description || '',
      attributes,
      media,
      coverImage: cover ? cover.url : null,
      images: (media || []).map(m => m.url),
      condition: row.condition || 'new',
      fulfillmentModel: row.fulfillment_model || 'DELIVERY_OR_PICKUP',
      tags: row.tags || [],
      specs: attributes,
      store: store ? {
        id: store.id,
        name: store.name,
        slug: store.slug,
        logoUrl: store.logo_url,
        phoneNumber: store.phone_number || (store.metadata && store.metadata.phone) || null,
        whatsapp: store.phone_number || (store.metadata && store.metadata.phone) || null,
        isVerified: Boolean(store.is_verified),
        verificationTier: store.verification_tier,
        rating: Number(store.rating) || 5.0,
        ratingCount: store.rating_count || 0,
        city: (store.metadata && store.metadata.city) || 'Douala'
      } : null
    };
  }

  static async _loadMediaForListings(listingIds) {
    if (!listingIds.length) return [];
    const { data, error } = await this.db
      .from('listing_media')
      .select('id, listing_id, url, storage_path, is_cover, display_order, width, height, alt_text')
      .in('listing_id', listingIds)
      .order('display_order', { ascending: true });

    if (error) return [];
    return data || [];
  }

  static async _loadStores(storeIds) {
    if (!storeIds.length) return [];
    const { data, error } = await this.db
      .from('stores')
      .select('id, name, slug, logo_url, phone_number, is_verified, verification_tier, rating, rating_count, metadata')
      .in('id', storeIds);

    if (error) return [];
    return data || [];
  }

  static async _loadAttributes(listingId) {
    const { data, error } = await this.db
      .from('listing_attribute_values')
      .select('attribute_slug, value_text, value_number, value_boolean, value_json')
      .eq('listing_id', listingId);

    if (error || !data) return {};
    return data.reduce((acc, r) => {
      acc[r.attribute_slug] = r.value_json ?? r.value_boolean ?? r.value_number ?? r.value_text;
      return acc;
    }, {});
  }

  // Local asset paths in seed/curated data carry raw spaces and ampersands
  // (e.g. "telephone&PC/..."), which break the URL and 404 the image. Encode
  // those defensively. Remote (http/https) URLs are left untouched so query
  // strings — where "&" is significant — are never corrupted.
  static _enc(u) {
    if (!u) return u;
    const s = String(u);
    if (/^https?:\/\//i.test(s)) return s;
    return s.replace(/ /g, '%20').replace(/&/g, '%26');
  }

  static _formatProductCard(listing, coverUrl, store, mediaList = []) {
    const priceMinor = Number(listing.base_price_minor) || 0;
    const salePriceMinor = listing.sale_price_minor ? Number(listing.sale_price_minor) : null;
    const formattedPrice = formatXaf(priceMinor);
    // Without its store record (it failed to load) a listing has not earned a
    // "verified" name or badge: both used to default to verified.
    const storeName = store ? store.name : 'Marketplace seller';

    // Seeded/demo listings ship with auto-generated gradient placeholder covers
    // hosted on Supabase Storage. Swap those for a real product photo matched
    // from the curated catalogue by title. Guarded so genuine merchant uploads
    // in production are never touched: always allowed for explicit dev/test
    // stores; otherwise only outside production (pre-launch, where every remote
    // cover is still a seed placeholder).
    let resolvedCover = coverUrl;
    let resolvedImages = mediaList.map(m => m.url).filter(Boolean);
    const isDevOrTestStore = /^store_(dev|test)_/.test(String(listing.store_id || ''));
    const coverIsRemote = /^https?:\/\//i.test(String(coverUrl || ''));
    const allowSubstitute = isDevOrTestStore ||
      (process.env.NODE_ENV !== 'production' && coverIsRemote);
    if (allowSubstitute) {
      const alt = CatalogRepository._curatedImageMatch(listing.title, listing.category_id);
      if (alt) {
        resolvedCover = alt;
        resolvedImages = [alt];
      }
    }

    return {
      id: listing.id,
      slug: listing.slug || listing.id,
      title: listing.title,
      description: listing.description || '',
      category: listing.category_id,
      brand: listing.brand || '',
      model: listing.model || '',
      price: formattedPrice,
      priceNumeric: priceMinor,
      salePrice: salePriceMinor ? formatXaf(salePriceMinor) : null,
      salePriceNumeric: salePriceMinor,
      currency: listing.currency || 'XAF',
      image: CatalogRepository._enc(resolvedCover),
      imageUrl: CatalogRepository._enc(resolvedCover),
      images: resolvedImages.map((u) => CatalogRepository._enc(u)),
      merchant: storeName,
      storeName: storeName,
      storeId: listing.store_id,
      merchantCity: (store && store.metadata && store.metadata.city) || 'Douala',
      phoneNumber: store ? (store.phone_number || (store.metadata && store.metadata.phone) || null) : null,
      storePhone: store ? (store.phone_number || (store.metadata && store.metadata.phone) || null) : null,
      sellerPhone: store ? (store.phone_number || (store.metadata && store.metadata.phone) || null) : null,
      verified: store ? Boolean(store.is_verified) : false,
      rating: Number(listing.rating) || 5.0,
      reviewsCount: listing.rating_count || 0,
      soldCount: listing.order_count || 0,
      status: listing.status,
      visibility: listing.visibility,
      inStock: true,
      stock: 1000,
      stockQuantity: 1000,
      stockUnits: 1000,
      publishedAt: listing.published_at,
      createdAt: listing.created_at
    };
  }

  // Accent- and case-insensitive normaliser (e.g. "Yaoundé" → "yaounde") so a
  // filter chip with no diacritics still matches stored city names.
  static _norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  }

  // Builds a predicate over a card's merchantCity, or null when no city filter
  // is requested. The "kribi" chip covers the Kribi/Limbe coastal cluster.
  static _cityMatcher(city) {
    const c = CatalogRepository._norm(city);
    if (!c) return null;
    const accepted = c === 'kribi' ? ['kribi', 'limbe'] : [c];
    // merchantCity is often "Neighborhood, City" (e.g. "Akwa, Douala"), so match
    // the city token as a substring rather than requiring an exact equal.
    return (value) => {
      const v = CatalogRepository._norm(value);
      return accepted.some((a) => v.includes(a));
    };
  }

  // ── Curated storefront catalogue ──────────────────────────────────────────
  // The products the app ships with (src/data/catalog_products.js, generated
  // from PRODUCTS_DATA). They back discovery/search/detail until — and
  // alongside — real seller listings exist.
  static _priceToNumber(str) {
    return priceToNumber(str);
  }

  // The house store (NanoAfrica) as the database holds it, or null when it is not
  // provisioned or cannot be read. Never throws: browsing must not depend on it.
  // `_houseService` is a seam for tests.
  static async _houseStore() {
    try {
      return await (this._houseService || getSharedHouseStore()).resolve();
    } catch (_) {
      return null;
    }
  }

  // A curated card as the buyer should see it once the house store is known: the
  // store's own verification and contact replace the dataset's static values, so
  // the cart and the product page reach the real owner. Real listings and the
  // unprovisioned case pass through untouched.
  static _presentWithHouse(card, house) {
    if (!house || !card || card.storeId !== HOUSE_STORE.id) return card;
    return {
      ...card,
      merchant: house.name,
      storeName: house.name,
      verified: Boolean(house.isVerified),
      phoneNumber: house.phone || null,
      storePhone: house.phone || null,
      sellerPhone: house.phone || null
    };
  }

  // The product page's seller block for a curated product, from the provisioned
  // store row (logo, contact, rating, city). Without the row the detail keeps the
  // static block, exactly as before it was provisioned.
  static async _enrichCuratedDetail(detail) {
    if (!detail || detail.storeId !== HOUSE_STORE.id) return detail;
    const house = await this._houseStore();
    if (!house) return detail;
    return {
      ...this._presentWithHouse(detail, house),
      store: {
        id: house.storeId,
        name: house.name,
        slug: house.slug,
        logoUrl: house.logoUrl,
        phoneNumber: house.phone,
        whatsapp: house.phone,
        isVerified: Boolean(house.isVerified),
        verificationTier: house.verificationTier,
        rating: Number(house.rating) || 5.0,
        ratingCount: house.ratingCount || 0,
        city: house.city || (detail.store && detail.store.city) || 'Douala'
      }
    };
  }

  // How many curated products the house store sells (what its store page should
  // say instead of 0 real listings).
  static curatedProductCount() {
    return this._curatedCards().length;
  }

  // The house store's curated products as catalogue cards, for a store page that
  // lists a store's products from iam.listings only.
  static async curatedStorefront({ limit = 100 } = {}) {
    const house = await this._houseStore();
    const cards = this._curatedCards();
    const n = Math.max(0, Math.min(Number(limit) || 0, cards.length));
    return { items: cards.slice(0, n).map(c => this._presentWithHouse(c, house)), total: cards.length };
  }

  static _curatedCards() {
    if (this.__curatedCache) return this.__curatedCache;
    let map = {};
    try { map = require('../dataLoader').catalogProducts || {}; } catch (e) { map = {}; }
    const cards = Object.keys(map)
      .map((id) => this._formatCuratedCard(id, map[id]))
      .filter((c) => c && c.title);
    this.__curatedCache = cards;
    return cards;
  }

  // Find the best real product photo from the curated catalogue for a given
  // listing title (used to replace seed placeholder covers). Matches on shared
  // brand/model tokens after stripping size/colour/marketing noise.
  static _curatedImageMatch(title, category) {
    if (!title) return null;
    const cards = this._curatedCards();
    if (!cards.length) return null;
    const STOP = new Set(['the', 'and', 'with', 'for', 'new', 'sealed', 'box', 'boxed', 'official', 'brand', 'set',
      'edition', 'gb', 'tb', 'ram', 'ssd', '256gb', '512gb', '128gb', '64gb', '1tb', 'same', 'day', 'guarantee',
      'month', 'months', 'warranty', 'black', 'white', 'grey', 'gray', 'blue', 'green', 'red', 'gold', 'silver',
      'titanium', 'space', 'natural', 'graphite', 'unlocked', 'dual', 'sim', 'inch', 'series', 'xaf', 'fcfa',
      // Generic product-type and marketing words: matching on these alone caused
      // cross-category mismatches (a Sony headphone getting an AirPods photo).
      'wireless', 'headphones', 'headphone', 'earbuds', 'earbud', 'speaker', 'smartphone', 'phone', 'laptop',
      'tablet', 'charger', 'case', 'cover', 'smart', 'bluetooth', 'anc', 'noise', 'cancelling', 'cancellation',
      'premium', 'luxury', 'best', 'features', 'stunning', 'finish', 'look', 'colors', 'color', 'buy', 'screen',
      'replacement', 'repair']);
    const tok = (s) => String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w));
    const target = new Set(tok(title));
    if (!target.size) return null;
    let best = null;
    let bestScore = 0;
    for (const c of cards) {
      if (!c.imageUrl) continue;
      const ct = tok(c.title + ' ' + (c.brand || '') + ' ' + (c.categoryLabel || ''));
      let score = 0;
      for (const w of ct) if (target.has(w)) score++;
      if (category && c.category && String(category).toLowerCase() === String(c.category).toLowerCase()) score += 0.5;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    // Require at least two shared meaningful tokens (e.g. brand + model). A
    // single weak token is not enough to justify replacing the cover, which is
    // what produced wrong-product photos.
    return (best && bestScore >= 2) ? best.imageUrl : null;
  }

  static _formatCuratedCard(id, p) {
    if (!p || typeof p !== 'object') return null;
    const priceNumeric = this._priceToNumber(p.price);
    const compareAt = this._priceToNumber(p.salePrice);
    const cover = p.coverImage || (Array.isArray(p.images) && p.images[0]) || null;
    const hasDiscount = compareAt && compareAt > priceNumeric;
    return {
      id: p.id || id,
      slug: p.id || id,
      title: p.title,
      category: p.category || 'general',
      categoryLabel: p.categoryLabel || '',
      brand: p.brand || '',
      model: '',
      price: p.price || (priceNumeric ? formatXaf(priceNumeric) : ''),
      priceNumeric: priceNumeric,
      salePrice: hasDiscount ? p.salePrice : null,
      salePriceNumeric: hasDiscount ? compareAt : null,
      currency: 'XAF',
      image: CatalogRepository._enc(cover),
      imageUrl: CatalogRepository._enc(cover),
      images: (Array.isArray(p.images) ? p.images : (cover ? [cover] : [])).map((u) => CatalogRepository._enc(u)),
      // Every curated product belongs to the house store, whatever seller name the
      // dataset still carries from before it had one.
      merchant: HOUSE_STORE.name,
      storeName: HOUSE_STORE.name,
      storeId: HOUSE_STORE.id,
      merchantCity: p.storeCity || 'Douala',
      verified: Boolean(p.storeVerified),
      rating: Number(p.rating) || 5.0,
      reviewsCount: p.reviewCount || 0,
      soldCount: p.soldCount || 0,
      badge: p.badge || null,
      tagline: String(p.description || '').split('. ')[0].slice(0, 90),
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      inStock: true,
      stock: Math.max(1000, Number(p.stock || p.stockQuantity || p.stockUnits || 1000)),
      stockQuantity: Math.max(1000, Number(p.stockQuantity || p.stock || p.stockUnits || 1000)),
      stockUnits: Math.max(1000, Number(p.stockUnits || p.stockQuantity || p.stock || 1000)),
      curated: true
    };
  }

  static _filterCurated(cards, { category, vertical, search, brand, storeId, city, verified, houseVerified } = {}) {
    // Curated products all belong to the house store: a query scoped to any other
    // store has none of them.
    if (storeId && storeId !== HOUSE_STORE.id) return [];
    let out = cards;
    const cityMatch = CatalogRepository._cityMatcher(city);
    if (cityMatch) {
      out = out.filter((p) => cityMatch(p.merchantCity));
    }
    if (verified === true || verified === 'true' || verified === '1') {
      // Once the house store exists its own verification decides, for all of them.
      out = out.filter((p) => (houseVerified !== undefined && p.storeId === HOUSE_STORE.id ? houseVerified : p.verified) === true);
    }
    if (category && category !== 'all') {
      const c = String(category).toLowerCase();
      out = out.filter((p) => String(p.category || '').toLowerCase() === c);
    }
    if (brand) {
      const b = String(brand).toLowerCase();
      out = out.filter((p) => String(p.brand || '').toLowerCase().includes(b));
    }
    if (search && String(search).trim()) {
      const q = String(search).trim().toLowerCase();
      out = out.filter((p) =>
        (p.title + ' ' + p.brand + ' ' + (p.categoryLabel || '') + ' ' + (p.storeName || '')).toLowerCase().includes(q));
    }
    return out;
  }

  static _sortCurated(cards, sortBy) {
    const out = cards.slice();
    switch (sortBy) {
      case 'price_asc': out.sort((a, b) => a.priceNumeric - b.priceNumeric); break;
      case 'price_desc': out.sort((a, b) => b.priceNumeric - a.priceNumeric); break;
      case 'rating': out.sort((a, b) => b.rating - a.rating); break;
      case 'popular': out.sort((a, b) => (b.soldCount || 0) - (a.soldCount || 0)); break;
      default: break; // 'recent' keeps the curated ordering
    }
    return out;
  }

  // The curated product whose id (or slug, which is the same thing for curated
  // cards) is exactly `idOrSlug`, or null. No fuzzy or partial matching: a near
  // miss would show one product's page, price and photos under another's link.
  static _curatedDetail(idOrSlug) {
    const wanted = String(idOrSlug == null ? '' : idOrSlug).trim();
    if (!wanted) return null;
    const card = this._curatedCards().find((c) => c.id === wanted || c.slug === wanted);
    if (!card) return null;
    let raw = {};
    try { raw = (require('../dataLoader').catalogProducts || {})[card.id] || {}; } catch (e) { raw = {}; }
    return {
      ...card,
      description: raw.description || card.tagline || '',
      shortDescription: String(raw.description || card.tagline || '').slice(0, 140),
      attributes: raw.attributes || [],
      media: (card.images || []).map((u, i) => ({ id: card.id + '_m' + i, url: u, isCover: i === 0, displayOrder: i })),
      coverImage: card.imageUrl,
      condition: raw.conditionLabel || 'new',
      fulfillmentModel: 'DELIVERY_OR_PICKUP',
      tags: [],
      specs: raw.attributes || [],
      store: {
        id: card.storeId || null,
        name: card.storeName,
        slug: card.storeId === HOUSE_STORE.id ? HOUSE_STORE.slug : null,
        logoUrl: null,
        phoneNumber: card.phoneNumber || card.storePhone || null,
        whatsapp: card.phoneNumber || card.storePhone || null,
        isVerified: card.verified,
        verificationTier: null,
        rating: card.rating,
        ratingCount: card.reviewsCount,
        city: card.merchantCity
      }
    };
  }
}

function formatXaf(amount) {
  const s = String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${s} FCFA`;
}

module.exports = CatalogRepository;
