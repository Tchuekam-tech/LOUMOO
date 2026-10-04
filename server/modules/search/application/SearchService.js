'use strict';
const {
  SupabaseDatabase,
} = require('../../../infrastructure/database/SupabaseClient');
const { AppError } = require('../../../shared/errors/AppError');
const { parseSearch } = require('../domain/SearchQuery');
const unavailable = () =>
  new AppError('Search is temporarily unavailable. Please try again.', {
    code: 'SEARCH_UNAVAILABLE',
    statusCode: 503,
  });
const safeImage = (v) =>
  typeof v === 'string' &&
  (/^https:\/\//i.test(v) ||
    /^\/(?!\/)/.test(v) ||
    /^(?:\.\/)?Assets\//.test(v))
    ? v
    : '';
function card(r) {
  const n = r.price == null ? null : Number(r.price),
    price = Number.isFinite(n) ? n : null;
  return {
    id: r.id,
    entityType: r.entity_type,
    title: r.title,
    slug: r.slug,
    description: r.description,
    category: r.category,
    vertical: r.vertical,
    brand: r.brand,
    condition: r.condition,
    priceNumeric: price,
    priceFrom: r.price_from === true,
    currency: r.currency || 'XAF',
    price:
      price == null
        ? ''
        : `${r.price_from ? 'From ' : ''}${r.currency || 'XAF'} ${price.toLocaleString('fr-FR')}`,
    image: safeImage(r.image_url),
    imageUrl: safeImage(r.image_url),
    merchantCity: r.city || '',
    storeId: r.store_id,
    storeName: r.store_name || '',
    verified: r.verified === true,
    rating: r.rating == null ? null : Number(r.rating),
    inStock: typeof r.in_stock === 'boolean' ? r.in_stock : null,
    origin: r.origin,
    destination: r.destination,
    transportType: r.transport_type,
  };
}
class SearchService {
  constructor({ db = () => SupabaseDatabase.getAdmin() } = {}) {
    this.db = db;
    this.inflight = new Map();
  }
  async search(raw = {}, suggest = false) {
    const q = parseSearch(raw);
    if (q.q && !q.tsquery)
      return {
        items: [],
        suggestions: [],
        total: 0,
        page: q.page,
        limit: q.limit,
        hasMore: false,
        facets: {},
      };
    const key = JSON.stringify([q, suggest]);
    if (this.inflight.has(key)) return this.inflight.get(key);
    const work = this.execute(q, suggest);
    if (this.inflight.size < 256) this.inflight.set(key, work);
    try {
      return await work;
    } finally {
      this.inflight.delete(key);
    }
  }
  async execute(q, suggest) {
    const start = Date.now();
    let result;
    try {
      result = await this.db()
        .rpc('search_public', {
          p_query: q.q,
          p_tsquery: q.tsquery,
          p_filters: q.filters,
          p_page: q.page,
          p_limit: suggest ? Math.min(q.limit, 8) : q.limit,
          p_suggest: suggest,
        })
        .abortSignal(AbortSignal.timeout(4000));
    } catch (_) {
      throw unavailable();
    }
    if (result.error || !Array.isArray(result.data?.items)) throw unavailable();
    const d = result.data,
      items = d.items.map(card);
    return {
      ...d,
      items,
      hasMore: q.page * Number(d.limit) < Number(d.total),
      suggestions: suggest
        ? items.map((item) => ({
            id: item.id,
            label: item.title,
            type: item.entityType,
            item,
          }))
        : [],
      query: q.q,
      elapsedMs: Date.now() - start,
    };
  }
}
module.exports = { SearchService, card };
