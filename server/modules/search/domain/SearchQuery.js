'use strict';
const { ValidationError } = require('../../../shared/errors/AppError');
const TYPES = [
  'all',
  'product',
  'service',
  'store',
  'hotel',
  'travel',
  'announcement',
];
const SORTS = ['relevance', 'recent', 'price_asc', 'price_desc', 'rating'];
const synonyms = [
  ['laptop', 'laptops', 'ordinateur', 'ordinateurs', 'pc'],
  ['phone', 'phones', 'telephone', 'telephones', 'smartphone'],
  ['shoes', 'chaussures', 'chaussure'],
  ['headphones', 'casque', 'ecouteurs'],
  ['flight', 'flights', 'vol', 'vols', 'avion'],
  ['hotel', 'hotels', 'hebergement'],
  ['repair', 'reparation'],
  ['hiring', 'emploi', 'job', 'jobs'],
];
const normalize = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
function text(v, key, max = 80) {
  if (v == null) return '';
  if (typeof v !== 'string' || v.length > max || /[\x00-\x1f]/.test(v))
    throw new ValidationError(`Invalid ${key}.`);
  return v.trim();
}
function number(v, key, min = 0, max = 1e10, integer = false) {
  if (v == null || v === '') return undefined;
  if (
    !['string', 'number'].includes(typeof v) ||
    (typeof v === 'string' && !/^\d+(\.\d+)?$/.test(v))
  )
    throw new ValidationError(`Invalid ${key}.`);
  const n = Number(v);
  if (
    !Number.isFinite(n) ||
    n < min ||
    n > max ||
    (integer && !Number.isInteger(n))
  )
    throw new ValidationError(`Invalid ${key}.`);
  return n;
}
function bool(v, key) {
  if (v == null || ['', false, 'false', '0'].includes(v)) return false;
  if ([true, 'true', '1'].includes(v)) return true;
  throw new ValidationError(`Invalid ${key}.`);
}
function parseSearch(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new ValidationError('Invalid search.');
  const q = text(raw.q == null ? raw.search : raw.q, 'query', 200),
    type = text(raw.type, 'type') || 'all',
    sort = text(raw.sort || raw.sortBy, 'sort') || 'relevance';
  if (!TYPES.includes(type) || !SORTS.includes(sort))
    throw new ValidationError('Invalid search type or sort.');
  const filters = {
    type,
    sort,
    verified: bool(raw.verified, 'verified'),
    inStock: bool(raw.inStock, 'inStock'),
  };
  for (const key of [
    'city',
    'category',
    'vertical',
    'brand',
    'condition',
    'storeId',
  ]) {
    const v = text(raw[key], key);
    if (v && v !== 'all') filters[key] = v;
  }
  for (const key of ['minPrice', 'maxPrice']) {
    const v = number(raw[key], key);
    if (v !== undefined) filters[key] = v;
  }
  if (
    filters.minPrice != null &&
    filters.maxPrice != null &&
    filters.minPrice > filters.maxPrice
  )
    throw new ValidationError('Minimum price must not exceed maximum price.');
  const tsquery = normalize(q)
    .split(' ')
    .filter(Boolean)
    .slice(0, 16)
    .map(
      (t) =>
        '(' +
        (synonyms.find((s) => s.includes(t)) || [t])
          .map((w) => w + ':*')
          .join(' | ') +
        ')',
    )
    .join(' & ');
  return {
    q,
    tsquery,
    filters,
    page: number(raw.page, 'page', 1, 100, true) || 1,
    limit: number(raw.limit, 'limit', 1, 40, true) || 20,
  };
}
module.exports = { parseSearch, normalize, TYPES };
