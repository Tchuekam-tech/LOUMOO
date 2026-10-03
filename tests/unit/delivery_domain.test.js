/**
 * LOUMOO — Delivery domain
 * ---------------------------------------------------------------------------
 * Pure-unit coverage (no database, no HTTP) for the delivery primitives:
 * the state machine, geo/ETA maths, input validation, the derived handover
 * code, and the per-viewer redaction rules.
 */

require('../setup');

const assert = require('assert');
const config = require('../../server/config/env');

const {
  DELIVERY_STATUS: S,
  parseLocation,
  optionalNumber,
  haversineKm,
  estimateEta,
  describeAddress,
  presentDelivery
} = require('../../server/modules/delivery/domain/Delivery');
const { DeliveryStateMachine, ALLOWED_TRANSITIONS } = require('../../server/modules/delivery/domain/DeliveryStateMachine');
const { codeFor, verifyCode } = require('../../server/modules/delivery/domain/HandoverCode');
const { FULFILLMENT_STATUS } = require('../../server/modules/commerce/domain/Order');
const { AppError } = require('../../server/shared/errors/AppError');
const { DeliveryLockedError, coarseLocation, describeArea } = require('../../server/modules/delivery/domain/Delivery');
const {
  OFFER_DEFAULT_TTL_MINUTES,
  OFFER_MIN_TTL_MS,
  OFFER_MAX_TTL_MINUTES,
  WORKLOAD_STATUSES,
  OfferExpiredError,
  NoRiderAvailableError,
  offerTtlMsFrom,
  offerDeadlineMs,
  isOfferLapsed
} = require('../../server/modules/delivery/domain/Delivery');

function throwsWithCode(fn, code) {
  try { fn(); } catch (e) { return e.code === code; }
  return false;
}

async function run() {
  console.log('  Testing Delivery domain...');

  // The handover code derives its key from SUPABASE_JWT_SECRET. Provide one for
  // this suite only, then restore, so no other suite sees a changed config.
  const hadSecret = config.supabase.jwtSecret;
  if (!hadSecret) config.supabase.jwtSecret = 'unit-test-delivery-secret-0123456789abcdef';

  try {
    // --- 1. State machine ----------------------------------------------------
    assert.ok(DeliveryStateMachine.canTransition(S.PENDING_ASSIGNMENT, S.ASSIGNED));
    assert.ok(DeliveryStateMachine.canTransition(S.ARRIVED, S.DELIVERED));
    assert.ok(DeliveryStateMachine.canTransition(S.FAILED, S.ASSIGNED), 'a failed delivery can be retried');
    assert.ok(!DeliveryStateMachine.canTransition(S.PENDING_ASSIGNMENT, S.PICKED_UP), 'cannot skip assignment');
    assert.ok(!DeliveryStateMachine.canTransition(S.ACCEPTED, S.DELIVERED), 'cannot deliver without picking up');
    assert.ok(!DeliveryStateMachine.canTransition(S.PICKED_UP, S.CANCELLED), 'cannot cancel once picked up');
    assert.ok(!DeliveryStateMachine.canTransition(S.ASSIGNED, S.ASSIGNED), 'same-state is not a transition');
    assert.ok(DeliveryStateMachine.canTransition(S.ACCEPTED, S.PENDING_ASSIGNMENT), 'a rider can release an accepted job');
    assert.ok(!DeliveryStateMachine.canTransition(S.PICKED_UP, S.PENDING_ASSIGNMENT), 'but not once the parcel is collected');

    // 423 must flow through the shared error handler, which only renders AppError.
    const locked = new DeliveryLockedError();
    assert.ok(locked instanceof AppError, 'DeliveryLockedError is an AppError, or the handler would answer 500');
    assert.strictEqual(locked.statusCode, 423);
    assert.strictEqual(locked.code, 'DELIVERY_LOCKED');
    assert.strictEqual(locked.toJSON().error.statusCode, 423);
    for (const terminal of [S.DELIVERED, S.CANCELLED]) {
      assert.deepStrictEqual([...ALLOWED_TRANSITIONS[terminal]], [], `${terminal} is terminal`);
    }
    assert.ok(throwsWithCode(() => DeliveryStateMachine.assertTransition(S.DELIVERED, S.ARRIVED), 'CONFLICT'));
    assert.ok(throwsWithCode(() => DeliveryStateMachine.assertTransition(S.ACCEPTED, S.ACCEPTED), 'CONFLICT'));
    assert.ok(throwsWithCode(() => DeliveryStateMachine.assertTransition('warp', S.ARRIVED), 'VALIDATION_ERROR'));
    assert.ok(throwsWithCode(() => DeliveryStateMachine.assertTransition(S.ACCEPTED, 'teleported'), 'VALIDATION_ERROR'));

    // Every status named in the table exists as a key, so nothing is unreachable by typo.
    const all = new Set(Object.values(S));
    for (const [from, tos] of Object.entries(ALLOWED_TRANSITIONS)) {
      assert.ok(all.has(from), `unknown source status ${from}`);
      tos.forEach((to) => assert.ok(all.has(to), `unknown target status ${to} from ${from}`));
    }

    // Assignment rules (re-assigning an `assigned` delivery is allowed; an accepted one is not).
    assert.ok(DeliveryStateMachine.canAssign(S.PENDING_ASSIGNMENT));
    assert.ok(DeliveryStateMachine.canAssign(S.ASSIGNED));
    assert.ok(DeliveryStateMachine.canAssign(S.FAILED));
    assert.ok(!DeliveryStateMachine.canAssign(S.ACCEPTED));
    assert.ok(!DeliveryStateMachine.canAssign(S.DELIVERED));

    // --- 2. Order linkage ----------------------------------------------------
    assert.strictEqual(DeliveryStateMachine.orderStatusFor(S.PICKED_UP), FULFILLMENT_STATUS.IN_TRANSIT);
    assert.strictEqual(DeliveryStateMachine.orderStatusFor(S.DELIVERED), FULFILLMENT_STATUS.DELIVERED);
    assert.strictEqual(DeliveryStateMachine.orderStatusFor(S.CANCELLED), null, 'cancelling a delivery must not cancel the order');
    assert.strictEqual(DeliveryStateMachine.orderStatusFor(S.FAILED), null);
    assert.strictEqual(DeliveryStateMachine.orderStatusFor(S.ARRIVED), null);

    // --- 3. Location validation ---------------------------------------------
    assert.strictEqual(parseLocation(undefined), null);
    assert.strictEqual(parseLocation(null), null);
    assert.deepStrictEqual(parseLocation({ lat: '4.05', lng: 9.7 }), { lat: 4.05, lng: 9.7 }, 'numeric strings are accepted');
    assert.ok(throwsWithCode(() => parseLocation({ lat: 91, lng: 0 }), 'VALIDATION_ERROR'), 'lat > 90 rejected');
    assert.ok(throwsWithCode(() => parseLocation({ lat: 0, lng: -181 }), 'VALIDATION_ERROR'), 'lng < -180 rejected');
    assert.ok(throwsWithCode(() => parseLocation({ lat: 'abc', lng: 0 }), 'VALIDATION_ERROR'));
    assert.ok(throwsWithCode(() => parseLocation({ lat: NaN, lng: 0 }), 'VALIDATION_ERROR'), 'NaN rejected');
    assert.ok(throwsWithCode(() => parseLocation({ lat: Infinity, lng: 0 }), 'VALIDATION_ERROR'), 'Infinity rejected');
    assert.ok(throwsWithCode(() => parseLocation({ lng: 5 }), 'VALIDATION_ERROR'), 'missing lat rejected, not treated as 0');
    assert.ok(throwsWithCode(() => parseLocation('4,9'), 'VALIDATION_ERROR'));
    assert.ok(throwsWithCode(() => parseLocation([4, 9]), 'VALIDATION_ERROR'));
    assert.deepStrictEqual(parseLocation({ lat: 0, lng: 0 }), { lat: 0, lng: 0 }, '0,0 is a valid point');

    assert.strictEqual(optionalNumber(undefined, 'x', { min: 0, max: 10 }), null);
    assert.strictEqual(optionalNumber('', 'x', { min: 0, max: 10 }), null);
    assert.strictEqual(optionalNumber('7', 'x', { min: 0, max: 10 }), 7);
    assert.ok(throwsWithCode(() => optionalNumber(-1, 'x', { min: 0, max: 10 }), 'VALIDATION_ERROR'));
    assert.ok(throwsWithCode(() => optionalNumber(360, 'heading', { min: 0, max: 360, exclusiveMax: true }), 'VALIDATION_ERROR'));
    assert.strictEqual(optionalNumber(359.9, 'heading', { min: 0, max: 360, exclusiveMax: true }), 359.9);

    // --- 4. Distance and ETA -------------------------------------------------
    const douala = { lat: 4.0511, lng: 9.7679 };
    const yaounde = { lat: 3.848, lng: 11.5021 };
    const d = haversineKm(douala, yaounde);
    assert.ok(d > 190 && d < 200, `Douala-Yaounde straight line is ~193 km, got ${d}`);
    assert.strictEqual(haversineKm(douala, douala), 0);
    assert.ok(Math.abs(haversineKm(douala, yaounde) - haversineKm(yaounde, douala)) < 1e-9, 'distance is symmetric');

    const near = { lat: 4.0511, lng: 9.7679 };
    const nearby = { lat: 4.0601, lng: 9.7679 }; // ~1 km north
    const eta = estimateEta(near, nearby);
    assert.ok(eta.distanceKm > 1.2 && eta.distanceKm < 1.4, `1 km straight line ≈ 1.3 km by road, got ${eta.distanceKm}`);
    assert.strictEqual(eta.etaMinutes, 4, '1.3 km at 20 km/h rounds up to 4 minutes');
    assert.deepStrictEqual(estimateEta(near, null), { etaMinutes: null, distanceKm: null });
    assert.deepStrictEqual(estimateEta(null, near), { etaMinutes: null, distanceKm: null });
    assert.strictEqual(estimateEta(near, near).etaMinutes, 0, 'already there is 0 minutes');
    const tiny = estimateEta(near, { lat: 4.05111, lng: 9.7679 });
    assert.ok(tiny.etaMinutes >= 1, 'any non-zero distance is at least 1 minute');

    assert.strictEqual(describeAddress({ street: ' Rue 1 ', neighbourhood: '', city: 'Douala' }), 'Rue 1, Douala');
    assert.strictEqual(describeAddress({}), '');
    assert.strictEqual(describeAddress(undefined), '');

    // --- 5. Handover code ----------------------------------------------------
    const c1 = codeFor('dlv_a', 1);
    assert.ok(/^\d{4}$/.test(c1), 'four digits, zero-padded');
    assert.strictEqual(codeFor('dlv_a', 1), c1, 'deterministic for the same delivery and nonce');
    assert.ok(verifyCode(c1, 'dlv_a', 1));
    assert.ok(verifyCode(` ${c1} `, 'dlv_a', 1), 'surrounding whitespace is tolerated');
    const wrong = String((Number(c1) + 1) % 10000).padStart(4, '0');
    assert.ok(!verifyCode(wrong, 'dlv_a', 1));
    assert.ok(!verifyCode('', 'dlv_a', 1));
    assert.ok(!verifyCode(undefined, 'dlv_a', 1));
    assert.ok(!verifyCode('12345', 'dlv_a', 1), 'wrong length never matches');
    assert.ok(!verifyCode(c1, 'dlv_b', 1), 'a code is bound to its delivery');
    // Bumping the nonce must retire the old code (only a 1-in-10^4 collision could fail this).
    let differs = 0;
    for (let n = 2; n < 40; n += 1) if (codeFor('dlv_a', n) !== c1) differs += 1;
    assert.ok(differs >= 36, 'a new nonce yields a different code');
    // Spread: codes across many deliveries should not collapse to a few values.
    const seen = new Set();
    for (let i = 0; i < 400; i += 1) seen.add(codeFor(`dlv_${i}`, 1));
    assert.ok(seen.size > 300, `codes are well distributed (${seen.size} distinct of 400)`);

    // --- 6. Per-viewer presentation -----------------------------------------
    const base = {
      id: 'dlv_1',
      orderId: 'ord_1',
      status: S.ASSIGNED,
      driver: { id: 'drv_1', name: 'Alain', phone: '+237600000001' },
      pickup: { label: 'Shop', address: 'Rue 1', contactPhone: '+237611111111', location: { lat: 4.05, lng: 9.7 } },
      dropoff: { label: 'Awa', address: 'Bonanjo', contactPhone: '+237622222222', notes: 'Gate 4455', area: 'Bonanjo, Douala', location: { lat: 4.0612, lng: 9.7156 } },
      lastLocation: { lat: 4.055, lng: 9.705, at: '2026-10-03T10:00:00.000Z', speedKmh: 20, heading: 90 },
      etaMinutes: 9,
      distanceKm: 2.5,
      failureReason: 'Customer absent',
      handoverNonce: 7,
      codeAttempts: 3,
      createdAt: 't0',
      updatedAt: 't1'
    };
    const timeline = [{ status: 'assigned', at: 't', note: 'Assigned to Alain' }];

    for (const viewer of ['buyer', 'seller', 'admin', 'driver']) {
      const json = JSON.stringify(presentDelivery(base, viewer, { timeline }));
      assert.ok(!json.includes('handoverNonce') && !/nonce/i.test(json), `${viewer} never sees the nonce`);
      assert.ok(!json.includes('codeAttempts'), `${viewer} never sees the attempt counter`);
    }

    // Buyer before the rider accepts: no rider identity, no position, no ETA.
    const buyerEarly = presentDelivery(base, 'buyer', { timeline });
    assert.strictEqual(buyerEarly.driver, null, 'buyer does not learn who is assigned before acceptance');
    assert.strictEqual(buyerEarly.lastLocation, null);
    assert.strictEqual(buyerEarly.etaMinutes, null);
    assert.strictEqual(buyerEarly.failureReason, null, 'internal failure reason is staff-only');
    assert.strictEqual(buyerEarly.timeline[0].note, null, 'internal timeline notes are staff-only');

    // Buyer once accepted: sees the rider, but still not the position until pickup.
    const buyerAccepted = presentDelivery({ ...base, status: S.ACCEPTED }, 'buyer');
    assert.strictEqual(buyerAccepted.driver.name, 'Alain');
    assert.strictEqual(buyerAccepted.lastLocation, null, 'rider-to-shop travel is not shown to the buyer');

    // Buyer after pickup: position and ETA.
    const buyerPicked = presentDelivery({ ...base, status: S.PICKED_UP }, 'buyer');
    assert.ok(buyerPicked.lastLocation && buyerPicked.etaMinutes === 9);

    // Seller/admin always see the assigned rider and the live position.
    for (const viewer of ['seller', 'admin']) {
      const v = presentDelivery(base, viewer, { timeline });
      assert.strictEqual(v.driver.phone, '+237600000001');
      assert.ok(v.lastLocation);
      assert.strictEqual(v.failureReason, 'Customer absent');
      assert.strictEqual(v.timeline[0].note, 'Assigned to Alain');
    }

    // The rider does not get the customer's phone/address until they accept.
    const riderEarly = presentDelivery(base, 'driver');
    assert.deepStrictEqual(riderEarly.dropoff, { area: 'Bonanjo, Douala', location: { lat: 4.06, lng: 9.72 } },
      'before accepting, a rider gets a whitelist: a coarse area and a ~1 km rounded point, nothing else');
    assert.strictEqual(riderEarly.dropoff.label, undefined, 'not the customer name');
    assert.strictEqual(riderEarly.dropoff.notes, undefined, 'not the gate code');
    assert.strictEqual(riderEarly.dropoff.contactPhone, undefined);
    assert.strictEqual(riderEarly.dropoff.address, undefined);
    assert.deepStrictEqual(coarseLocation({ lat: 4.0612, lng: 9.7156 }), { lat: 4.06, lng: 9.72 });
    assert.strictEqual(coarseLocation(null), null);
    assert.strictEqual(coarseLocation({ lat: 'x', lng: 1 }), null);
    assert.strictEqual(describeArea({ neighbourhood: ' Bonanjo ', city: 'Douala' }), 'Bonanjo, Douala');
    assert.strictEqual(describeArea({}), '');
    const riderAccepted = presentDelivery({ ...base, status: S.ACCEPTED }, 'driver');
    assert.strictEqual(riderAccepted.dropoff.contactPhone, '+237622222222');
    assert.strictEqual(riderAccepted.dropoff.address, 'Bonanjo');
    assert.strictEqual(riderAccepted.dropoff.label, 'Awa', 'after accepting, the rider gets the full drop-off');
    assert.deepStrictEqual(riderAccepted.dropoff.location, { lat: 4.0612, lng: 9.7156 }, 'and the exact point');

    // Presenting must not mutate the stored record.
    assert.strictEqual(base.dropoff.contactPhone, '+237622222222', 'presenting did not mutate the record');
    assert.strictEqual(base.status, S.ASSIGNED);

    // --- 7. Offer expiry and rider workload ----------------------------------
    assert.strictEqual(OFFER_DEFAULT_TTL_MINUTES, 15, 'the offer window defaults to 15 minutes');
    assert.deepStrictEqual([...WORKLOAD_STATUSES].sort(), [S.ACCEPTED, S.ARRIVED, S.ASSIGNED, S.PICKED_UP].sort(),
      'a rider is busy while assigned, accepted, picked up or arrived');
    assert.ok(!WORKLOAD_STATUSES.includes(S.FAILED), 'a failed job is waiting on the seller, not the rider');
    for (const [Err, code] of [[OfferExpiredError, 'OFFER_EXPIRED'], [NoRiderAvailableError, 'NO_RIDER_AVAILABLE']]) {
      const err = new Err();
      assert.ok(err instanceof AppError, `${code} extends AppError so the shared handler renders it`);
      assert.strictEqual(err.code, code);
      assert.strictEqual(err.statusCode, 409, `${code} is a 409, not a 500`);
    }

    const MIN = 60 * 1000;
    assert.strictEqual(offerTtlMsFrom(undefined), 15 * MIN, 'unset means the default');
    assert.strictEqual(offerTtlMsFrom(''), 15 * MIN, 'empty means the default');
    assert.strictEqual(offerTtlMsFrom('   '), 15 * MIN, 'blank text is "unset", not 0 ("never expire")');
    assert.strictEqual(offerTtlMsFrom('30'), 30 * MIN, 'an environment string works');
    assert.strictEqual(offerTtlMsFrom(2), 2 * MIN);
    assert.strictEqual(offerTtlMsFrom(0), 0, '0 is a real value: never expire');
    assert.strictEqual(offerTtlMsFrom('0'), 0);
    assert.strictEqual(offerTtlMsFrom('abc'), 15 * MIN, 'a typo cannot switch expiry off');
    assert.strictEqual(offerTtlMsFrom(-5), 15 * MIN, 'a negative window is a typo, not "instant expiry"');
    assert.strictEqual(offerTtlMsFrom(NaN), 15 * MIN);
    assert.strictEqual(offerTtlMsFrom(Infinity), 15 * MIN, 'a non-finite window falls back to the default');
    const WEEK_MS = OFFER_MAX_TTL_MINUTES * MIN;
    assert.strictEqual(OFFER_MAX_TTL_MINUTES, 7 * 24 * 60, 'the cap is one week');
    assert.strictEqual(offerTtlMsFrom(OFFER_MAX_TTL_MINUTES), WEEK_MS, 'exactly the cap is allowed');
    assert.strictEqual(offerTtlMsFrom(OFFER_MAX_TTL_MINUTES + 1), WEEK_MS, 'one minute over is clamped to the cap');
    assert.strictEqual(offerTtlMsFrom('999999999999'), WEEK_MS, 'a huge value is clamped, not passed through to overflow a Date');
    assert.strictEqual(offerTtlMsFrom('1e12'), WEEK_MS);
    assert.strictEqual(offerTtlMsFrom(Number.MAX_VALUE), WEEK_MS);
    assert.strictEqual(OFFER_MIN_TTL_MS, 1000, 'the floor is one second');
    assert.strictEqual(offerTtlMsFrom('0.00000001'), OFFER_MIN_TTL_MS, 'a tiny positive value is raised to the floor, not rounded to 0 (never expire)');
    assert.strictEqual(offerTtlMsFrom(0.0001), OFFER_MIN_TTL_MS);
    assert.strictEqual(offerTtlMsFrom(1 / 60), OFFER_MIN_TTL_MS, 'exactly one second is allowed');
    assert.strictEqual(offerTtlMsFrom('0'), 0, 'but a real 0 still means never');
    assert.ok(offerTtlMsFrom('1e12') > 0 && offerTtlMsFrom('0.00000001') > 0, 'neither extreme disables expiry');

    const offered = { status: S.ASSIGNED, assignedAt: '2026-10-03T10:00:00.000Z' };
    const t0 = Date.parse(offered.assignedAt);
    assert.strictEqual(offerDeadlineMs(offered, 15 * MIN), t0 + 15 * MIN, 'the deadline is assignedAt + the window');
    assert.strictEqual(offerDeadlineMs({ ...offered, status: S.ACCEPTED }, 15 * MIN), null, 'an accepted job has no deadline');
    assert.strictEqual(offerDeadlineMs({ ...offered, status: S.PENDING_ASSIGNMENT }, 15 * MIN), null);
    assert.strictEqual(offerDeadlineMs(offered, 0), null, 'expiry off means no deadline');
    assert.strictEqual(offerDeadlineMs({ status: S.ASSIGNED }, 15 * MIN), null, 'no assignedAt, nothing to count from');
    assert.strictEqual(offerDeadlineMs({ status: S.ASSIGNED, assignedAt: 'not a date' }, 15 * MIN), null);
    assert.strictEqual(offerDeadlineMs(null, 15 * MIN), null);
    assert.strictEqual(isOfferLapsed(offered, 15 * MIN, t0 + 15 * MIN - 1), false, 'one millisecond early is still open');
    assert.strictEqual(isOfferLapsed(offered, 15 * MIN, t0 + 15 * MIN), true, 'the deadline itself has lapsed');
    assert.strictEqual(isOfferLapsed(offered, 15 * MIN, t0 + 16 * MIN), true);
    assert.strictEqual(isOfferLapsed({ ...offered, status: S.ACCEPTED }, 15 * MIN, t0 + 99 * MIN), false, 'accepted jobs never lapse');
    assert.strictEqual(isOfferLapsed(offered, 0, t0 + 99 * MIN), false, 'with expiry off nothing lapses');

    // A deadline that would pass the largest representable Date is "no deadline", not a crash.
    const edge = { status: S.ASSIGNED, assignedAt: '+275760-09-13T00:00:00.000Z' };
    assert.strictEqual(offerDeadlineMs(edge, 15 * MIN), null, 'an unrepresentable deadline is null');
    assert.strictEqual(isOfferLapsed(edge, 15 * MIN, Date.now()), false);
    assert.doesNotThrow(() => presentDelivery({ ...base, ...edge }, 'seller', { offerTtlMs: 15 * MIN }), 'presenting never throws on it');
    assert.strictEqual(presentDelivery({ ...base, ...edge }, 'seller', { offerTtlMs: 15 * MIN }).offerExpiresAt, null);

    const offerBase = { ...base, assignedAt: '2026-10-03T10:00:00.000Z' };
    for (const viewer of ['seller', 'admin', 'driver']) {
      assert.strictEqual(presentDelivery(offerBase, viewer, { offerTtlMs: 15 * MIN }).offerExpiresAt, '2026-10-03T10:15:00.000Z',
        `${viewer} sees when the offer lapses`);
    }
    assert.strictEqual(presentDelivery(offerBase, 'buyer', { offerTtlMs: 15 * MIN }).offerExpiresAt, null, 'the buyer never learns of the offer');
    for (const viewer of ['buyer', 'seller', 'admin', 'driver']) {
      assert.strictEqual(presentDelivery(offerBase, viewer).offerExpiresAt, null, `${viewer}: no window given means no deadline`);
      assert.strictEqual(presentDelivery(offerBase, viewer, { offerTtlMs: 0 }).offerExpiresAt, null, `${viewer}: expiry off means no deadline`);
      assert.strictEqual(presentDelivery({ ...offerBase, status: S.ACCEPTED }, viewer, { offerTtlMs: 15 * MIN }).offerExpiresAt, null,
        `${viewer}: an accepted job has no deadline`);
      assert.ok(!JSON.stringify(presentDelivery(offerBase, viewer, { offerTtlMs: 15 * MIN })).includes('assignedAt'),
        `${viewer} never sees the raw assignedAt column`);
    }

    console.log('    ✓ Delivery domain: state machine, geo, handover code and viewer redaction hold.');
  } finally {
    if (!hadSecret) config.supabase.jwtSecret = hadSecret;
  }
}

module.exports = { run };
