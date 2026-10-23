/**
 * LOUMOO Unit Tests — the delivery fee the buyer was shown is the fee they pay
 * ---------------------------------------------------------------------------
 * Two defects made the charged delivery fee differ from the quoted one:
 *
 *   1. A listing's own `fulfillment.deliveryFeeMinor` outranked everything
 *      except the seller's free-delivery promise — including the tariff of the
 *      delivery provider the buyer had just picked and been quoted. The order
 *      was then priced at the listing's number, not the picker's.
 *
 *   2. The publishing wizard wrote `deliveryFeeMinor: 0` whenever a seller
 *      ticked "delivery" and left the fee box empty (`toInt(blank) || 0`). A
 *      declared zero reads as free delivery, so every order of that listing
 *      shipped free while the checkout went on showing the city rate.
 *
 * What must hold:
 *   - the chosen provider's tariff beats a listing's own delivery fee;
 *   - the seller's free-delivery threshold still beats both (it only ever
 *     lowers what the buyer pays, and it was promised to them);
 *   - a listing fee still beats the city rate when no provider was chosen;
 *   - a BLANK fee is null (use the platform rate), while a typed 0 is still
 *     free delivery, because the seller meant it.
 */

require('../setup');
const assert = require('assert');

const { PricingEngine, DEFAULT_STANDARD_SHIPPING_XAF } = require('../../server/modules/commerce/domain/PricingEngine');
const { DELIVERY_METHOD } = require('../../server/modules/commerce/domain/Order');

/** One order line at 10 000 XAF, optionally carrying the seller's fulfillment block. */
function line(fulfillment = null) {
  return [{
    listingId: 'lst_1',
    quantity: 1,
    unitPriceXaf: 10000,
    sellerId: 'seller_1',
    storeId: 'store_1',
    title: 'Item',
    listing: fulfillment ? { id: 'lst_1', title: 'Item', fulfillment } : { id: 'lst_1', title: 'Item' }
  }];
}

function feeFor(items, options) {
  return PricingEngine.calculateOrderPricing(items, {
    deliveryMethod: DELIVERY_METHOD.HOME_DELIVERY,
    ...options
  }).shippingFeeXaf;
}

function testProviderTariffBeatsTheListingFee() {
  const items = line({ delivery: true, deliveryFeeMinor: 500 });

  // No provider chosen: the seller's own fee is what applies.
  assert.strictEqual(feeFor(items, { standardShippingFeeXaf: 3000 }), 500,
    'a listing fee still beats the city rate when the buyer chose nobody');

  // The buyer picked a provider and was quoted 2 000. That is the deal.
  assert.strictEqual(feeFor(items, { standardShippingFeeXaf: 3000, providerTariffXaf: 2000 }), 2000,
    'the tariff the buyer was quoted is the tariff the order is priced at');
}

function testFreeDeliveryPromiseStillWins() {
  const items = line({ delivery: true, deliveryFeeMinor: 500, freeDeliveryOverMinor: 5000 });
  assert.strictEqual(feeFor(items, { standardShippingFeeXaf: 3000, providerTariffXaf: 2000 }), 0,
    'the seller promised free delivery over 5 000 and the subtotal is 10 000');
}

function testAProviderTariffOfZeroIsHonoured() {
  const items = line({ delivery: true, deliveryFeeMinor: 500 });
  assert.strictEqual(feeFor(items, { standardShippingFeeXaf: 3000, providerTariffXaf: 0 }), 0,
    'a provider who quotes nothing charges nothing — zero is a tariff, not a missing one');
}

function testTheOrdinaryLadderIsUnchanged() {
  assert.strictEqual(feeFor(line(), { standardShippingFeeXaf: 3000 }), 3000, 'the city rate');
  assert.strictEqual(feeFor(line(), {}), DEFAULT_STANDARD_SHIPPING_XAF, 'the platform default when no city matched');
  assert.strictEqual(
    PricingEngine.calculateOrderPricing(line(), {
      deliveryMethod: DELIVERY_METHOD.STORE_PICKUP,
      standardShippingFeeXaf: 3000,
      providerTariffXaf: 2000
    }).shippingFeeXaf,
    0,
    'a pickup is never charged delivery, whatever was quoted'
  );
}

/**
 * The wizard half. publishingEngine is a browser module; it is loaded the way
 * the other suites load it and asked to map a seller's form to the payload.
 */
function testBlankFeeIsNotADeclaredZero() {
  const engine = require('../../src/services/publishingEngine');
  const build = engine.buildPayload || engine.toPayload || null;
  if (typeof build !== 'function') {
    // The mapping is exercised through the shipped wizard elsewhere; assert on
    // the source so this check cannot quietly stop testing anything.
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/services/publishingEngine.js'), 'utf8');
    assert.ok(
      /deliveryFeeMinor:\s*v\.delivery\s*\?\s*toInt\(v\.deliveryFee\)\s*:\s*null/.test(src),
      'a blank delivery fee maps to null, not to a declared zero'
    );
    assert.ok(
      !/deliveryFeeMinor:\s*v\.delivery\s*\?\s*\(toInt\(v\.deliveryFee\)\s*\|\|\s*0\)/.test(src),
      'the `|| 0` that turned a blank box into free delivery is gone'
    );
    return;
  }
  const blank = build({ delivery: true, deliveryFee: '' });
  assert.strictEqual(blank.fulfillment.deliveryFeeMinor, null, 'a blank fee means "charge the platform rate"');
  const zero = build({ delivery: true, deliveryFee: '0' });
  assert.strictEqual(zero.fulfillment.deliveryFeeMinor, 0, 'a typed 0 still means free delivery');
}

function run() {
  const tests = [
    ['the provider tariff beats the listing fee', testProviderTariffBeatsTheListingFee],
    ['the free-delivery promise still wins', testFreeDeliveryPromiseStillWins],
    ['a provider tariff of zero is honoured', testAProviderTariffOfZeroIsHonoured],
    ['the ordinary fee ladder is unchanged', testTheOrdinaryLadderIsUnchanged],
    ['a blank wizard fee is not a declared zero', testBlankFeeIsNotADeclaredZero]
  ];

  let failures = 0;
  for (const [name, fn] of tests) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failures += 1;
      console.error(`  ✗ ${name}\n    ${err && err.stack ? err.stack : err}`);
    }
  }

  console.log(`\nDelivery fee precedence: ${tests.length - failures}/${tests.length} passed.`);
  if (failures) process.exitCode = 1;
}

run();
