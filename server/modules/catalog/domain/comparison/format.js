/**
 * Value formatting for the comparison response, in English or French.
 */

const LOCALES = ['en', 'fr'];

function normLocale(locale) {
  const l = String(locale || '').slice(0, 2).toLowerCase();
  return LOCALES.includes(l) ? l : 'en';
}

function group(n, sep) {
  const [int, dec] = String(n).split('.');
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return dec ? `${g}${sep === ',' ? '.' : ','}${dec}` : g;
}

function number(n, locale, maxDecimals = 1) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
  const f = Math.pow(10, maxDecimals);
  const r = Math.round(Number(n) * f) / f;
  return group(r, normLocale(locale) === 'fr' ? ' ' : ',');
}

function money(n, locale) {
  if (n === null || n === undefined) return null;
  const s = number(Math.round(n), locale, 0);
  return normLocale(locale) === 'fr' ? `${s} FCFA` : `XAF ${s}`;
}

function percent(ratio, locale, signed = false) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return null;
  const p = Math.round(ratio * 100);
  const sign = signed ? (p > 0 ? '+' : p < 0 ? '−' : '') : '';
  const body = number(Math.abs(p), locale, 0);
  return normLocale(locale) === 'fr' ? `${sign}${body} %` : `${sign}${body}%`;
}

const UNIT_LABEL = {
  GB: { en: 'GB', fr: 'Go' },
  months: { en: 'months', fr: 'mois' },
  h: { en: 'h', fr: 'h' },
  in: { en: '″', fr: '″' },
  kg: { en: 'kg', fr: 'kg' }
};

function unit(u, locale) {
  if (!u) return '';
  const l = normLocale(locale);
  return UNIT_LABEL[u] ? UNIT_LABEL[u][l] : u;
}

/** Human value of one dimension cell. */
function value(dim, cell, locale) {
  if (!cell) return null;
  const l = normLocale(locale);
  if (cell.display !== null && cell.display !== undefined && cell.display !== '') return String(cell.display);
  if (dim.type === 'boolean') return cell.value ? (l === 'fr' ? 'Oui' : 'Yes') : (l === 'fr' ? 'Non' : 'No');
  if (dim.type === 'text') return String(cell.value);
  const v = cell.value;
  switch (dim.unit) {
    case 'XAF': return money(v, l);
    case 'GB':
      return v >= 1024 && v % 1024 === 0
        ? `${number(v / 1024, l)} ${l === 'fr' ? 'To' : 'TB'}`
        : `${number(v, l)} ${unit('GB', l)}`;
    case '/5': return `${number(v, l)}/5`;
    case 'IPx': return `IPx${v}`;
    case 'in': return `${number(v, l, 2)}″`;
    case 'kg': return `${number(v, l, 2)} kg`;
    case '×': return `${number(v, l)}×`;
    case 'index': return number(v, l, 0);
    case null:
    case undefined: return number(v, l);
    default: return `${number(v, l)} ${unit(dim.unit, l)}`;
  }
}

module.exports = { normLocale, number, money, percent, value, unit };
