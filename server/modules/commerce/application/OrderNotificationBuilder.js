/**
 * LOUMOO Commerce Core — Order notification builder
 * ---------------------------------------------------------------------------
 * Turns a placed Order into the messages its parties receive. Pure: no database,
 * no clock (except the order's own timestamp), no transport. OrderCreationService
 * decides WHO is told and HOW; this file decides WHAT they read.
 *
 * The seller's message carries everything needed to act on the order without
 * opening anything else: who the customer is and how to reach them, where the
 * goods go (or that the customer collects), which delivery provider was chosen
 * (or defaulted), every line with its price, the totals, and how it is paid.
 *
 * Payment is always described as it is: there is no payment gateway, the
 * customer pays on delivery or on pickup, and no message ever says money is held
 * or has been paid.
 *
 * Everything the customer typed (name, address, notes, item titles) is untrusted.
 * It is stripped of control and bidi characters, length-capped, and HTML-escaped
 * wherever it enters markup. Nothing secret ever enters a message: no token, and
 * in particular not the delivery handover code.
 */
'use strict';

const { DELIVERY_METHOD } = require('../domain/Order');

// iam.notifications.title is varchar(255); a few characters of headroom for the ellipsis.
const MAX_TITLE = 240;
const CAPS = Object.freeze({
  name: 80,
  phone: 32,
  email: 120,
  street: 160,
  area: 80,
  notes: 300,
  itemTitle: 120,
  label: 80
});
const MAX_DETAIL_ITEMS = 50;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Cameroon observes WAT (UTC+1) all year, with no daylight saving.
const CAMEROON_UTC_OFFSET_MS = 60 * 60 * 1000;

/* ---------------------------------------------------------------- sanitising */

// C0/C1 controls, line and paragraph separators, and the bidi override/isolate
// characters that can make text read differently from how it is stored.
const UNSAFE_CHARS = new RegExp('[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B-\u200F\uFEFF]', 'g');

/** One safe line of text: no control characters, collapsed whitespace, capped. */
function clean(value, max) {
  if (value == null) return '';
  let text = String(value).replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (max && text.length > max) text = `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  return text;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ----------------------------------------------------------------- formatting */

/** "XAF 31,500". Amounts are integer XAF; anything else prints as 0 rather than NaN. */
function formatXaf(amount) {
  const n = Number(amount);
  const safe = Number.isFinite(n) ? Math.round(n) : 0;
  const sign = safe < 0 ? '-' : '';
  return `XAF ${sign}${String(Math.abs(safe)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** "10 Oct 2026, 14:32 (Cameroon time)" from an ISO timestamp, or '' when unusable. */
function formatLocalTime(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms + CAMEROON_UTC_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} (Cameroon time)`;
}

let phoneNormalizer;
/**
 * The platform's own Cameroon-number rule (ContactVerificationService), loaded on
 * first use because it pulls in the identity stack. It already handles the
 * "+237 / 237 / bare number" spellings, which is where a doubled +237 came from.
 */
function loadPhoneNormalizer() {
  if (phoneNormalizer === undefined) {
    try {
      const Contact = require('../../identity/application/ContactVerificationService');
      phoneNormalizer = typeof Contact.normalizePhoneNumber === 'function' ? Contact.normalizePhoneNumber : null;
    } catch (_) {
      phoneNormalizer = null;
    }
  }
  return phoneNormalizer;
}

/**
 * The digits for https://wa.me/<digits> (country code included, no plus) from a
 * Cameroon number typed any of the usual ways, or null when it is not a number
 * the platform could dial.
 */
function whatsappDigits(phone) {
  if (phone == null) return null;
  const normalize = loadPhoneNormalizer();
  if (!normalize) return null;
  let raw = String(phone).replace(UNSAFE_CHARS, ' ').replace(/[\s\-().]/g, '');
  // A bare 9-digit national number is never already prefixed, even when it happens
  // to begin with 237 (a valid landline range): hand the normaliser the full form.
  if (/^\d{9}$/.test(raw)) raw = `+237${raw}`;
  try {
    return normalize(raw).replace(/^\+/, '');
  } catch (_) {
    return null;
  }
}

function whatsappUrl(phone) {
  const digits = whatsappDigits(phone);
  return digits ? `https://wa.me/${digits}` : null;
}

/* -------------------------------------------------------------- order → facts */

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Everything the messages need, sanitised once. Buyer details come from the
 * shipping address first (what the customer typed for THIS order), then from the
 * buyer's profile (`ctx.buyer`), which fills only what the address left out.
 */
function collectFacts(order, ctx = {}) {
  const ship = (order && order.shippingAddress && typeof order.shippingAddress === 'object') ? order.shippingAddress : {};
  const profile = (ctx.buyer && typeof ctx.buyer === 'object') ? ctx.buyer : {};
  const home = order.deliveryMethod === DELIVERY_METHOD.HOME_DELIVERY;

  const name = clean(ship.fullName, CAPS.name) || clean(profile.name, CAPS.name) || 'Customer';
  const phone = clean(ship.phone, CAPS.phone) || clean(profile.phone, CAPS.phone) || null;
  const email = clean(profile.email, CAPS.email) || null;

  const street = clean(ship.street, CAPS.street);
  const neighbourhood = clean(ship.neighbourhood, CAPS.area);
  const city = clean(ship.city, CAPS.area);
  const postalCode = clean(ship.postalCode, 32);
  const addressParts = [street, neighbourhood, city, postalCode].filter(Boolean);
  const address = home ? (addressParts.join(', ') || null) : null;
  const area = [neighbourhood, city].filter(Boolean).join(', ');
  const notes = clean(ship.notes, CAPS.notes) || null;

  const storeName = clean(ctx.storeName, CAPS.label) || null;

  const rawProvider = ctx.provider && typeof ctx.provider === 'object' ? ctx.provider : null;
  const provider = rawProvider && rawProvider.id
    ? {
      id: clean(rawProvider.id, 128),
      name: clean(rawProvider.name, CAPS.label) || 'the chosen provider',
      source: rawProvider.source === 'default' ? 'default' : 'buyer'
    }
    : null;

  const items = (Array.isArray(order.items) ? order.items : []).slice(0, MAX_DETAIL_ITEMS).map((it) => {
    const quantity = Number(it.quantity) || 1;
    const unitPriceXaf = Number(it.unitPriceXaf) || 0;
    const lineTotalXaf = Number.isFinite(Number(it.totalLineXaf)) ? Number(it.totalLineXaf) : unitPriceXaf * quantity;
    return {
      title: clean(it.title, CAPS.itemTitle) || 'Item',
      quantity,
      unitPriceXaf,
      lineTotalXaf
    };
  });
  const hiddenItems = Math.max(0, (Array.isArray(order.items) ? order.items.length : 0) - items.length);
  const units = (Array.isArray(order.items) ? order.items : []).reduce((n, it) => n + (Number(it.quantity) || 0), 0);

  return {
    orderNumber: clean(order.orderNumber, 64),
    placedAt: formatLocalTime(order.createdAt),
    home,
    name,
    phone,
    whatsapp: phone ? whatsappUrl(phone) : null,
    email,
    address,
    area,
    notes,
    storeName,
    provider,
    droppedProvider: Boolean(ctx.droppedProviderReason),
    items,
    hiddenItems,
    units,
    subtotalXaf: Number(order.subtotalXaf) || 0,
    shippingFeeXaf: Number(order.shippingFeeXaf) || 0,
    totalXaf: Number(order.totalAmountXaf) || 0,
    paymentStatus: order.paymentStatus,
    deliveryMethod: order.deliveryMethod
  };
}

/** How the customer pays, in plain words. Never claims money is held or paid. */
function paymentLine(f) {
  return f.home
    ? `Pay on delivery. The customer has not paid online; ${formatXaf(f.totalXaf)} is due in person when the order is handed over.`
    : `Pay on pickup. The customer has not paid online; ${formatXaf(f.totalXaf)} is due in person when they collect the order.`;
}

function providerLine(f) {
  if (!f.home) return null;
  if (f.provider && f.provider.source === 'default') {
    return `${f.provider.name} (default: the customer did not choose one)`;
  }
  if (f.provider) return `${f.provider.name} (chosen by the customer)`;
  if (f.droppedProvider) return 'None. The provider the customer chose is no longer available.';
  return 'None chosen by the customer';
}

function itemLine(it) {
  return `${it.quantity} x ${it.title} - ${formatXaf(it.lineTotalXaf)}`;
}

function nextStepLine(f) {
  if (!f.home) return 'Get it ready for the customer to collect.';
  if (f.provider && f.provider.source === 'default') return `Offer it to ${f.provider.name} from Deliveries.`;
  if (f.provider) return `Offer it to ${f.provider.name} (the customer's choice) from Deliveries.`;
  return 'Arrange a rider from Deliveries.';
}

/* ------------------------------------------------------- seller notification */

function titleFor(f) {
  const head = f.home ? `New order ${f.orderNumber} to deliver` : `New pickup order ${f.orderNumber}`;
  return clean(`${head} · ${formatXaf(f.totalXaf)}`, MAX_TITLE);
}

/** The plain-text body, shared by the in-app notification and the email's text part. */
function sellerBodyLines(f) {
  const lines = [];
  const glance = [plural(f.units, 'item', 'items'), formatXaf(f.totalXaf)];
  if (f.home && f.area) glance.push(`to ${f.area}`);
  lines.push(glance.join(' · '));
  lines.push(`Order ${f.orderNumber}${f.placedAt ? ` · placed ${f.placedAt}` : ''}`);
  if (f.storeName) lines.push(`Store: ${f.storeName}`);
  lines.push('');

  lines.push('CUSTOMER');
  lines.push(`Name: ${f.name}`);
  lines.push(`Phone: ${f.phone || 'not given'}`);
  if (f.whatsapp) lines.push(`WhatsApp: ${f.whatsapp}`);
  if (f.email) lines.push(`Email: ${f.email}`);
  lines.push('');

  lines.push('DELIVERY');
  if (f.home) {
    lines.push('Method: Home delivery');
    lines.push(`Address: ${f.address || 'not given'}`);
    if (f.notes) lines.push(`Customer note: ${f.notes}`);
    lines.push(`Delivery provider: ${providerLine(f)}`);
  } else {
    lines.push('Method: Store pickup');
    lines.push(`Address: Customer collects at the store${f.storeName ? ` (${f.storeName})` : ''}`);
    if (f.notes) lines.push(`Customer note: ${f.notes}`);
  }
  lines.push('');

  lines.push('ITEMS');
  for (const it of f.items) lines.push(itemLine(it));
  if (f.hiddenItems) lines.push(`+ ${plural(f.hiddenItems, 'more line', 'more lines')} (see the order)`);
  lines.push('');

  lines.push(`Subtotal: ${formatXaf(f.subtotalXaf)}`);
  lines.push(`Delivery fee: ${formatXaf(f.shippingFeeXaf)}`);
  lines.push(`Total: ${formatXaf(f.totalXaf)}`);
  lines.push(`Payment: ${paymentLine(f)}`);
  lines.push('');
  lines.push(`Next: ${nextStepLine(f)}`);
  return lines;
}

function sellerDetails(f) {
  return {
    buyer: { name: f.name, phone: f.phone, whatsappUrl: f.whatsapp, email: f.email },
    address: f.home ? f.address : null,
    pickup: !f.home,
    notes: f.notes,
    deliveryMethod: f.deliveryMethod,
    provider: f.provider ? { id: f.provider.id, name: f.provider.name, source: f.provider.source } : null,
    items: f.items.map((it) => ({
      title: it.title,
      quantity: it.quantity,
      unitPriceXaf: it.unitPriceXaf,
      lineTotalXaf: it.lineTotalXaf
    })),
    subtotalXaf: f.subtotalXaf,
    shippingFeeXaf: f.shippingFeeXaf,
    totalXaf: f.totalXaf,
    paymentStatus: f.paymentStatus,
    placedAt: f.placedAt || null
  };
}

/**
 * The in-app notification the seller receives. `audience` / `action` /
 * `orderId` / `orderNumber` keep the vocabulary the clients already route on;
 * `details` is the same information, structured, for screens that render it.
 */
function buildSellerNotification(order, ctx = {}) {
  const f = collectFacts(order, ctx);
  return {
    type: 'order',
    tone: 'sale',
    title: titleFor(f),
    body: sellerBodyLines(f).join('\n'),
    metadata: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      audience: 'seller',
      action: f.home ? 'open_dispatch' : null,
      details: sellerDetails(f)
    }
  };
}

/* ------------------------------------------------------------- seller e-mail */

const MONEY_ROW = 'padding:4px 0;color:#444';
const SECTION = 'margin:18px 0 6px;font-size:12px;letter-spacing:.08em;color:#7a7a7a;text-transform:uppercase';

function htmlRow(label, valueHtml) {
  return `<tr><td style="padding:3px 12px 3px 0;color:#7a7a7a;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:3px 0;color:#111">${valueHtml}</td></tr>`;
}

function buildSellerEmail(order, ctx = {}) {
  const f = collectFacts(order, ctx);
  const subject = clean(
    `New order ${f.orderNumber} · ${formatXaf(f.totalXaf)}${f.storeName ? ` · ${f.storeName}` : ''}`,
    MAX_TITLE
  );

  const customerRows = [
    htmlRow('Name', escapeHtml(f.name)),
    htmlRow('Phone', escapeHtml(f.phone || 'not given'))
  ];
  if (f.whatsapp) {
    // The href is built only from digits (see whatsappDigits), so it needs no
    // further escaping; the visible text is escaped anyway.
    customerRows.push(htmlRow('WhatsApp', `<a href="${f.whatsapp}" style="color:#0a7a43">${escapeHtml(f.whatsapp)}</a>`));
  }
  if (f.email) customerRows.push(htmlRow('Email', escapeHtml(f.email)));

  const deliveryRows = f.home
    ? [
      htmlRow('Method', 'Home delivery'),
      htmlRow('Address', escapeHtml(f.address || 'not given')),
      ...(f.notes ? [htmlRow('Customer note', escapeHtml(f.notes))] : []),
      htmlRow('Delivery provider', escapeHtml(providerLine(f)))
    ]
    : [
      htmlRow('Method', 'Store pickup'),
      htmlRow('Address', escapeHtml(`Customer collects at the store${f.storeName ? ` (${f.storeName})` : ''}`)),
      ...(f.notes ? [htmlRow('Customer note', escapeHtml(f.notes))] : [])
    ];

  const itemRows = f.items.map((it) => `<tr><td style="padding:4px 12px 4px 0;color:#111">${it.quantity} x ${escapeHtml(it.title)}</td><td style="padding:4px 0;color:#111;text-align:right;white-space:nowrap">${escapeHtml(formatXaf(it.lineTotalXaf))}</td></tr>`);
  if (f.hiddenItems) {
    itemRows.push(`<tr><td colspan="2" style="padding:4px 0;color:#7a7a7a">+ ${escapeHtml(plural(f.hiddenItems, 'more line', 'more lines'))} (see the order)</td></tr>`);
  }

  const money = (label, amount, strong) => `<tr><td style="${MONEY_ROW};${strong ? 'font-weight:700;color:#111' : ''}">${escapeHtml(label)}</td><td style="${MONEY_ROW};text-align:right;${strong ? 'font-weight:700;color:#111' : ''}">${escapeHtml(formatXaf(amount))}</td></tr>`;

  const html = [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#111;line-height:1.45">',
    `<h2 style="margin:0 0 4px;font-size:20px">${escapeHtml(f.home ? 'New order to deliver' : 'New pickup order')}</h2>`,
    `<p style="margin:0;color:#444">${escapeHtml(`Order ${f.orderNumber}${f.placedAt ? ` · placed ${f.placedAt}` : ''}`)}${f.storeName ? `<br>${escapeHtml(`Store: ${f.storeName}`)}` : ''}</p>`,
    `<div style="${SECTION}">Customer</div><table style="border-collapse:collapse;font-size:14px">${customerRows.join('')}</table>`,
    `<div style="${SECTION}">Delivery</div><table style="border-collapse:collapse;font-size:14px">${deliveryRows.join('')}</table>`,
    `<div style="${SECTION}">Items</div><table style="border-collapse:collapse;font-size:14px;width:100%">${itemRows.join('')}</table>`,
    '<table style="border-collapse:collapse;font-size:14px;width:100%;margin-top:8px;border-top:1px solid #e5e5e5">',
    money('Subtotal', f.subtotalXaf, false),
    money('Delivery fee', f.shippingFeeXaf, false),
    money('Total', f.totalXaf, true),
    '</table>',
    `<p style="margin:14px 0 0;font-size:14px"><strong>Payment:</strong> ${escapeHtml(paymentLine(f))}</p>`,
    `<p style="margin:14px 0 0;font-size:14px"><strong>Next:</strong> ${escapeHtml(nextStepLine(f))}</p>`,
    '<p style="margin:22px 0 0;font-size:12px;color:#7a7a7a">You are receiving this because an order was placed with your store on LOUMOO. You can turn order emails off in your notification settings; the order stays in your app either way.</p>',
    '</div>'
  ].join('');

  return { subject, html, text: sellerBodyLines(f).join('\n') };
}

/* ----------------------------------------------------------- buyer notification */

/**
 * The buyer's confirmation. Names the store the order was placed with and, for a
 * home delivery, the delivery provider when one is known. Shape unchanged from
 * before: title, one short body, the same routing metadata.
 */
function buildBuyerNotification(order, ctx = {}) {
  const f = collectFacts(order, ctx);
  const lead = f.storeName ? `Your order with ${f.storeName} is confirmed` : 'Your order is confirmed';
  const how = f.home ? 'pay on delivery' : 'pay when you collect it';
  const delivery = f.home && f.provider ? ` Delivery by ${f.provider.name}.` : '';
  return {
    type: 'order',
    tone: 'accent',
    title: clean(`Order ${f.orderNumber} placed`, MAX_TITLE),
    body: `${lead} — ${how}. Total ${formatXaf(f.totalXaf)}.${delivery}`,
    metadata: { orderId: order.id, orderNumber: order.orderNumber, audience: 'buyer', action: 'track_order' }
  };
}

module.exports = {
  buildSellerNotification,
  buildSellerEmail,
  buildBuyerNotification,
  // exposed for reuse and for tests
  whatsappUrl,
  whatsappDigits,
  formatXaf,
  formatLocalTime,
  clean,
  escapeHtml,
  CAPS,
  MAX_TITLE
};
