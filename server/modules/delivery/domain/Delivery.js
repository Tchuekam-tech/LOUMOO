/**
 * LOUMOO Delivery — Domain model
 * ---------------------------------------------------------------------------
 * Statuses, geo helpers and the single place that decides what each kind of
 * viewer is allowed to see of a delivery.
 *
 * The contract this implements is docs/DELIVERY_API.md. Change that file first.
 */

const crypto = require('crypto');
const { AppError, ValidationError } = require('../../../shared/errors/AppError');

const DELIVERY_STATUS = Object.freeze({
  PENDING_ASSIGNMENT: 'pending_assignment',
  ASSIGNED: 'assigned',
  ACCEPTED: 'accepted',
  PICKED_UP: 'picked_up',
  ARRIVED: 'arrived',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
});

const TERMINAL_STATUSES = Object.freeze([DELIVERY_STATUS.DELIVERED, DELIVERY_STATUS.CANCELLED]);

// A rider's phone is only worth tracking from acceptance until the parcel is
// handed over.
const LOCATION_ACCEPTING_STATUSES = Object.freeze([
  DELIVERY_STATUS.ACCEPTED,
  DELIVERY_STATUS.PICKED_UP,
  DELIVERY_STATUS.ARRIVED
]);

// The customer only sees the rider on the map once the rider has the parcel.
// Before that the rider is travelling to the shop, which is the rider's and the
// seller's business, not the buyer's.
const BUYER_VISIBLE_LOCATION_STATUSES = Object.freeze([
  DELIVERY_STATUS.PICKED_UP,
  DELIVERY_STATUS.ARRIVED
]);

const DRIVER_STATUS = Object.freeze({ ACTIVE: 'active', SUSPENDED: 'suspended' });

// Location ping policy (docs/DELIVERY_API.md → POST /:id/location).
const LOCATION_MIN_INTERVAL_MS = 3000;
const LOCATION_MAX_ACCURACY_M = 200;
// A phone reporting a jump faster than this between two close-together pings is
// a GPS glitch (or spoofing), not a rider. The window is deliberately short: if
// the FIRST fix after a glitch is the bad one, every later good ping would look
// like a jump from it, so tracking could freeze for at most this long.
const LOCATION_MAX_PLAUSIBLE_KMH = 200;
const LOCATION_PLAUSIBILITY_WINDOW_MS = 60 * 1000;

// ETA v0: straight-line distance, inflated for roads, at an assumed urban speed.
// Replace with routed distances when a routing service is added.
const ETA_ROAD_FACTOR = 1.3;
const ETA_ASSUMED_SPEED_KMH = 20;

const MAX_HANDOVER_ATTEMPTS = 5;

// An `assigned` delivery is an offer the rider has this long to accept before it
// goes back to the seller (docs/DELIVERY_API.md, "Offer expiry"). A starting
// point to tune with real riders, not a measured value. 0 disables expiry.
const OFFER_DEFAULT_TTL_MINUTES = 15;
// Bounds on a configured window. A positive value below a second would round to
// 0 ms, which means "never expire", so it is raised to the floor; one above a
// week is clamped to it (an operator writing a huge number means "very long", and
// an unbounded one would push the deadline past the largest representable Date).
const OFFER_MIN_TTL_MS = 1000;
const OFFER_MAX_TTL_MINUTES = 7 * 24 * 60;

// The timeline note written when an offer lapses. It is also how the lapse is
// told apart from a decline (both are a rider-attributed move back to
// pending_assignment), so it is a constant that is both written and matched.
const OFFER_EXPIRED_NOTE = 'Offer expired: no response from the rider';

// A rider who let an offer lapse sorts behind every rider who did not for this
// long, so one who never answers (offline, or suspended at the account level where
// nothing yet syncs that to the rider record) does not take the first offer of
// every delivery. Short on purpose: it fades without anyone having to clear it.
const RECENT_LAPSE_WINDOW_MS = 60 * 60 * 1000;

// The deliveries that make a rider "busy" when the seller picks one. `failed` is
// deliberately absent: that job is waiting on a seller/admin decision, not on
// the rider's time.
const WORKLOAD_STATUSES = Object.freeze([
  DELIVERY_STATUS.ASSIGNED,
  DELIVERY_STATUS.ACCEPTED,
  DELIVERY_STATUS.PICKED_UP,
  DELIVERY_STATUS.ARRIVED
]);

// Extends AppError so the shared error handler renders it as a real 423; a bare
// Error subclass would fall through to a 500.
class DeliveryLockedError extends AppError {
  constructor(message = 'Too many incorrect handover codes. An administrator must resolve this delivery.') {
    super(message, { code: 'DELIVERY_LOCKED', statusCode: 423 });
  }
}

// 409 with its own code, so a rider app can tell "too late" from "someone else
// changed it" and show the right message.
class OfferExpiredError extends AppError {
  constructor(message = 'This offer expired before it was accepted.') {
    super(message, { code: 'OFFER_EXPIRED', statusCode: 409 });
  }
}

// Auto-assign found nobody eligible. A 409 (the delivery is fine; the situation
// is what blocks it), distinct from a validation error on a rider the seller chose.
class NoRiderAvailableError extends AppError {
  constructor(message = 'No rider is available for this delivery right now.') {
    super(message, { code: 'NO_RIDER_AVAILABLE', statusCode: 409 });
  }
}

function newDeliveryId() {
  return `dlv_${crypto.randomUUID()}`;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validates an untrusted `{ lat, lng }`. Returns a clean object, or `null` when
 * the input is absent. Throws when it is present but wrong, so a typo never
 * silently becomes "no location".
 */
function parseLocation(raw, field = 'location') {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError(`${field} must be an object with lat and lng`, [{ field, message: 'Expected { lat, lng }.' }]);
  }
  const lat = typeof raw.lat === 'string' && raw.lat.trim() !== '' ? Number(raw.lat) : raw.lat;
  const lng = typeof raw.lng === 'string' && raw.lng.trim() !== '' ? Number(raw.lng) : raw.lng;
  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) {
    throw new ValidationError(`${field}.lat must be a number between -90 and 90`, [{ field: `${field}.lat`, message: 'Latitude out of range.' }]);
  }
  if (!isFiniteNumber(lng) || lng < -180 || lng > 180) {
    throw new ValidationError(`${field}.lng must be a number between -180 and 180`, [{ field: `${field}.lng`, message: 'Longitude out of range.' }]);
  }
  return { lat, lng };
}

function optionalNumber(raw, field, { min, max, exclusiveMax = false } = {}) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'string' ? Number(raw) : raw;
  const tooHigh = max !== undefined && (exclusiveMax ? n >= max : n > max);
  if (!isFiniteNumber(n) || (min !== undefined && n < min) || tooHigh) {
    throw new ValidationError(`${field} is out of range`, [{ field, message: `Expected a number between ${min} and ${max}.` }]);
  }
  return n;
}

function haversineKm(a, b) {
  const R = 6371.0088;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** `{ etaMinutes, distanceKm }` for a rider position and a destination. */
function estimateEta(from, to) {
  if (!from || !to) return { etaMinutes: null, distanceKm: null };
  const distanceKm = haversineKm(from, to) * ETA_ROAD_FACTOR;
  const etaMinutes = distanceKm === 0 ? 0 : Math.max(1, Math.ceil((distanceKm / ETA_ASSUMED_SPEED_KMH) * 60));
  return { etaMinutes, distanceKm: Math.round(distanceKm * 100) / 100 };
}

/**
 * Turns the configured window (minutes) into milliseconds. Anything that is not
 * a finite number >= 0 falls back to the default, so a typo in an environment
 * variable cannot silently switch expiry off or make every offer lapse at once.
 * `0` is a real value and means "never expire". A positive value is kept between
 * one second and one week (OFFER_MIN_TTL_MS, OFFER_MAX_TTL_MINUTES): below the
 * floor it would round to 0 ms and silently disable expiry, above the cap the
 * deadline could pass the largest representable Date.
 */
function offerTtlMsFrom(minutes) {
  const fallback = OFFER_DEFAULT_TTL_MINUTES * 60 * 1000;
  // Blank text must read as "unset", not as Number('') === 0 ("never expire").
  const raw = typeof minutes === 'string' ? minutes.trim() : minutes;
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (!isFiniteNumber(n) || n < 0) return fallback;
  if (n === 0) return 0;
  const ms = Math.round(Math.min(n, OFFER_MAX_TTL_MINUTES) * 60 * 1000);
  return Math.max(OFFER_MIN_TTL_MS, ms);
}

/**
 * When an offer lapses, as epoch milliseconds, or `null` when this delivery has
 * no deadline: it is not `assigned`, expiry is off (`ttlMs` 0), or it has no
 * `assignedAt` to count from (a row written by hand, never by the service).
 */
function offerDeadlineMs(delivery, ttlMs) {
  if (!delivery || delivery.status !== DELIVERY_STATUS.ASSIGNED) return null;
  if (!isFiniteNumber(ttlMs) || ttlMs <= 0) return null;
  const assignedAt = Date.parse(delivery.assignedAt);
  if (!Number.isFinite(assignedAt)) return null;
  const deadline = assignedAt + ttlMs;
  // Past the largest representable Date, new Date(deadline).toISOString() throws
  // and would turn every view of the delivery into a 500: no usable deadline.
  return Number.isFinite(new Date(deadline).getTime()) ? deadline : null;
}

/** True once the offer's deadline has passed (a deadline of exactly `nowMs` has). */
function isOfferLapsed(delivery, ttlMs, nowMs) {
  const deadline = offerDeadlineMs(delivery, ttlMs);
  return deadline !== null && nowMs >= deadline;
}

/** Rounds a point to ~1.1 km (2 decimals): enough to judge distance, not to find a door. */
function coarseLocation(loc) {
  if (!loc || !isFiniteNumber(loc.lat) || !isFiniteNumber(loc.lng)) return null;
  return { lat: Math.round(loc.lat * 100) / 100, lng: Math.round(loc.lng * 100) / 100 };
}

function describeArea(shippingAddress = {}) {
  return [shippingAddress.neighbourhood, shippingAddress.city]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(', ');
}

function describeAddress(shippingAddress = {}) {
  return [shippingAddress.street, shippingAddress.neighbourhood, shippingAddress.city]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(', ');
}

/**
 * The wire shape of a delivery for one kind of viewer.
 *
 * viewer: 'buyer' | 'seller' | 'admin' | 'driver'
 *
 * Never included for anyone: handover nonce, code attempts, raw rows. The
 * handover code itself is served by a separate buyer-only call.
 */
function presentDelivery(d, viewer, { timeline = [], order = null, offerTtlMs = 0 } = {}) {
  const afterAcceptance = [
    DELIVERY_STATUS.ACCEPTED, DELIVERY_STATUS.PICKED_UP, DELIVERY_STATUS.ARRIVED, DELIVERY_STATUS.DELIVERED
  ].includes(d.status);

  const staff = viewer === 'seller' || viewer === 'admin';

  // Driver identity: the buyer learns who is coming only once the rider has
  // committed. Seller/admin always see who they assigned.
  const driver = d.driver && (staff || viewer === 'driver' || afterAcceptance)
    ? { id: d.driver.id, name: d.driver.name, phone: d.driver.phone }
    : null;

  // A rider who has not accepted yet sees only a coarse area and a rounded point,
  // built from a whitelist (not by deleting fields from a copy): enough to decide
  // whether to take the job, not the customer's name, door, phone or notes. A
  // seller can assign any active rider, and a rider can decline after reading.
  const fullDropoff = d.dropoff || {};
  const dropoff = viewer === 'driver' && !afterAcceptance
    ? { area: fullDropoff.area || null, location: coarseLocation(fullDropoff.location) }
    : { ...fullDropoff };

  // The rider's position is hidden from the buyer until pickup.
  const lastLocation = viewer === 'buyer' && !BUYER_VISIBLE_LOCATION_STATUSES.includes(d.status)
    ? null
    : d.lastLocation || null;

  const hideEta = viewer === 'buyer' && !BUYER_VISIBLE_LOCATION_STATUSES.includes(d.status);

  // The buyer never learns an offer exists, let alone when it lapses.
  const deadline = staff || viewer === 'driver' ? offerDeadlineMs(d, offerTtlMs) : null;

  return {
    id: d.id,
    orderId: d.orderId,
    orderNumber: (order && order.orderNumber) || d.orderNumber || null,
    status: d.status,
    viewerRole: viewer,
    driver,
    pickup: d.pickup || null,
    dropoff,
    etaMinutes: hideEta ? null : (d.etaMinutes ?? null),
    distanceKm: hideEta ? null : (d.distanceKm ?? null),
    lastLocation,
    failureReason: staff || viewer === 'driver' ? (d.failureReason || null) : null,
    offerExpiresAt: deadline === null ? null : new Date(deadline).toISOString(),
    timeline: timeline.map((e) => ({ status: e.status, at: e.at, note: staff || viewer === 'driver' ? (e.note || null) : null })),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt
  };
}

/**
 * The wire payload of a live event for one kind of viewer, or `null` when that
 * viewer must not receive it. This is the stream's twin of presentDelivery():
 * the buyer learns nothing about the rider's position or ETA until pickup, so
 * the live feed must withhold exactly what the REST view withholds.
 *
 * `event` is the internal shape the service publishes (`status` rides along on
 * every event); the returned object is what goes on the wire.
 */
function eventForViewer(event, viewer) {
  if (!event || !event.type) return null;
  const hidden = viewer === 'buyer' && !BUYER_VISIBLE_LOCATION_STATUSES.includes(event.status);
  switch (event.type) {
    case 'status':
      return {
        status: event.status,
        at: event.at,
        etaMinutes: hidden ? null : (event.etaMinutes ?? null),
        distanceKm: hidden ? null : (event.distanceKm ?? null)
      };
    case 'location':
      return hidden ? null : {
        lat: event.lat, lng: event.lng, at: event.at,
        speedKmh: event.speedKmh ?? null, heading: event.heading ?? null
      };
    case 'eta':
      return hidden ? null : { etaMinutes: event.etaMinutes ?? null, distanceKm: event.distanceKm ?? null };
    default:
      return null;
  }
}

module.exports = {
  DELIVERY_STATUS,
  DRIVER_STATUS,
  TERMINAL_STATUSES,
  LOCATION_ACCEPTING_STATUSES,
  BUYER_VISIBLE_LOCATION_STATUSES,
  LOCATION_MIN_INTERVAL_MS,
  LOCATION_MAX_ACCURACY_M,
  LOCATION_MAX_PLAUSIBLE_KMH,
  LOCATION_PLAUSIBILITY_WINDOW_MS,
  ETA_ROAD_FACTOR,
  ETA_ASSUMED_SPEED_KMH,
  MAX_HANDOVER_ATTEMPTS,
  OFFER_DEFAULT_TTL_MINUTES,
  OFFER_MIN_TTL_MS,
  OFFER_MAX_TTL_MINUTES,
  OFFER_EXPIRED_NOTE,
  RECENT_LAPSE_WINDOW_MS,
  WORKLOAD_STATUSES,
  DeliveryLockedError,
  OfferExpiredError,
  NoRiderAvailableError,
  newDeliveryId,
  parseLocation,
  optionalNumber,
  haversineKm,
  estimateEta,
  offerTtlMsFrom,
  offerDeadlineMs,
  isOfferLapsed,
  coarseLocation,
  describeArea,
  describeAddress,
  presentDelivery,
  eventForViewer
};
