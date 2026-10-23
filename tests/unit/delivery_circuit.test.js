/**
 * LOUMOO Unit Tests - The delivery circuit's shared logic (browser module)
 * ---------------------------------------------------------------------------
 * src/services/deliveryCircuit.js is loaded by the browser, but its logic is pure
 * and runs here in Node. It is what makes the four screens agree on where an
 * order is, whose move it is, and what each person is told, so those rules are
 * pinned: every status for every role, the strip's markup, the checkout helpers
 * (one order per store, a payload the server accepts, the server's order mapped
 * back) and the reasons given when an order is refused.
 */

require('../setup');
const assert = require('assert');
const C = require('../../src/services/deliveryCircuit');
const { CreateOrderInputSchema } = require('../../server/modules/commerce/presentation/validators/orderSchemas');

const STATUSES = ['none', 'pending_assignment', 'assigned', 'accepted', 'picked_up', 'arrived', 'delivered', 'failed', 'cancelled'];
const d = (status, extra) => Object.assign({ status }, extra || {});

function testStagesAndMoves() {
  const stageOf = (s, role) => C.model(s === 'none' ? null : d(s), role);

  // No delivery yet is a normal first state, and it is the seller's move.
  const first = stageOf('none', 'seller');
  assert.deepStrictEqual(first.movers, ['seller']);
  assert.strictEqual(first.yourMove, true);
  assert.strictEqual(first.step, 2, 'the order is placed; finding a rider is in progress');
  assert.strictEqual(first.stages[0].state, 'done');
  assert.strictEqual(first.stages[1].state, 'current');
  assert.strictEqual(first.stages[2].state, 'todo');

  // Whose move it is, status by status.
  const movers = { none: ['seller'], pending_assignment: ['seller'], assigned: ['rider'], accepted: ['rider'], picked_up: ['rider'], arrived: ['buyer', 'rider'], failed: ['seller'], delivered: [], cancelled: [] };
  for (const s of STATUSES) assert.deepStrictEqual(stageOf(s, 'buyer').movers, movers[s], `movers at ${s}`);

  // Progress only moves forward along the happy path.
  const steps = ['pending_assignment', 'assigned', 'accepted', 'picked_up', 'arrived', 'delivered'].map((s) => stageOf(s, 'buyer').step);
  assert.deepStrictEqual(steps, [2, 2, 3, 4, 5, 5]);
  const done = stageOf('delivered', 'buyer');
  assert.strictEqual(done.done, true);
  assert.ok(done.stages.every((s) => s.state === 'done'), 'a delivered order has every stage done');

  // A failed or cancelled attempt marks its stage as a problem, not progress.
  assert.strictEqual(stageOf('failed', 'seller').stages[1].state, 'problem');
  assert.strictEqual(stageOf('cancelled', 'buyer').problem, true);

  // yourMove is true only for the party whose move it is.
  assert.strictEqual(stageOf('assigned', 'rider').yourMove, true);
  assert.strictEqual(stageOf('assigned', 'seller').yourMove, false);
  assert.strictEqual(stageOf('arrived', 'buyer').yourMove, true);
  assert.strictEqual(stageOf('arrived', 'rider').yourMove, true, 'at the door the rider enters the code the buyer reads out');
  assert.strictEqual(stageOf('arrived', 'seller').yourMove, false);
  assert.strictEqual(stageOf('arrived', 'admin').yourMove, false);
  assert.strictEqual(stageOf('delivered', 'buyer').yourMove, false, 'nobody has a move once it is delivered');

  // The viewer's own stages are flagged, so the strip can say "you".
  const rider = stageOf('picked_up', 'rider').stages.filter((s) => s.you).map((s) => s.key);
  assert.deepStrictEqual(rider, ['collect', 'transit', 'handover']);
  assert.deepStrictEqual(stageOf('picked_up', 'buyer').stages.filter((s) => s.you).map((s) => s.key), ['placed', 'handover']);
  assert.deepStrictEqual(stageOf('picked_up', 'admin').stages.filter((s) => s.you), [], 'an admin steps in only on exceptions');

  // The role defaults from the delivery's own viewerRole, and falls back safely.
  assert.strictEqual(C.model(d('accepted', { viewerRole: 'seller' })).role, 'seller');
  assert.strictEqual(C.model(d('accepted', { viewerRole: 'driver' })).role, 'rider', 'the API names the rider\'s view "driver"');
  assert.strictEqual(C.model(d('accepted'), 'nonsense').role, 'buyer');
  assert.strictEqual(C.model({ status: 'a_status_from_the_future' }, 'buyer').status, 'none', 'an unknown status never crashes');
  assert.doesNotThrow(() => C.model(undefined, undefined));
}

function testEveryoneIsToldSomething() {
  for (const s of STATUSES) {
    for (const role of C.ROLES) {
      const m = C.model(s === 'none' ? null : d(s), role);
      assert.ok(m.headline && m.detail, `${role} has a line at ${s}`);
      assert.ok(m.youAre.startsWith('You are'), 'the role is named');
      // A move is announced as one, to the person who must make it, and to nobody else.
      assert.strictEqual(/^Your move/.test(m.headline), m.yourMove, `"${m.headline}" (${role}, ${s}): headline says "Your move" exactly when it is their move`);
    }
  }
}

function testStripMarkup() {
  const html = C.renderStrip(d('arrived'), 'buyer');
  assert.ok(html.includes('You are the buyer'));
  assert.ok(html.includes('Step 5 of 5'));
  assert.strictEqual((html.match(/<li class="lcx-step/g) || []).length, 5, 'five stages');
  assert.ok(html.includes('aria-current="step"'), 'the current stage is exposed to screen readers');
  assert.ok(html.includes('lcx-move mine'), 'it is the buyer\'s move at the door');
  assert.ok(html.includes('Your move: give the rider your code'));
  assert.ok(C.renderStrip(null, 'seller').includes('lcx-move mine'));
  assert.ok(C.renderStrip(d('picked_up'), 'seller').includes('lcx-move wait'));
  assert.ok(C.renderStrip(d('delivered'), 'rider').includes('Complete'));
  assert.ok(C.renderStrip(d('failed'), 'buyer').includes('lcx-move problem'));
  assert.ok(C.renderStrip(d('arrived'), 'admin').includes('You are an administrator'));

  // Nothing a person controls can inject markup.
  const hostile = C.renderStrip({ status: '<img src=x onerror=alert(1)>' }, '"><script>alert(1)</script>');
  assert.ok(!/<script|<img/i.test(hostile), 'role and status are never echoed as markup');
  assert.ok(C.renderStrip(d('arrived'), 'buyer', { note: '<b onmouseover=1>x</b>' }).includes('&lt;b onmouseover=1&gt;'), 'a note is escaped');
}

function testBagToOrders() {
  const bag = [
    { id: 'l1', name: 'Phone', priceXaf: 50000, qty: 2, store: 'Tech Shop' },
    { id: 'l3', name: 'Novel', priceXaf: 4000, qty: 1, store: 'Books Corner' },
    { id: 'l2', name: 'Case', priceXaf: 3000, qty: 1, store: 'Tech Shop' },
    { id: 'l9', name: 'Mystery', priceXaf: 100, qty: 1 }
  ];
  const groups = C.groupByStore(bag);
  assert.deepStrictEqual(groups.map((g) => g.store), ['Tech Shop', 'Books Corner', 'LOUMOO seller'], 'one group per store, in order of first appearance');
  assert.deepStrictEqual(groups[0].items.map((i) => i.id), ['l1', 'l2']);
  assert.deepStrictEqual(C.groupByStore([]), []);
  assert.deepStrictEqual(C.groupByStore(null), []);

  // The payload is exactly what the server's schema accepts, and carries no total.
  const payload = C.toOrderPayload(groups[0].items, { name: 'Awa Njoya', phone: '+237622222222', street: 'Rue 1', city: 'Douala' });
  const parsed = CreateOrderInputSchema.safeParse(payload);
  assert.ok(parsed.success, 'the server accepts the payload: ' + (parsed.error && JSON.stringify(parsed.error.issues)));
  assert.ok(!('totalAmountXaf' in payload) && !('totalXaf' in payload), 'no client total: the server prices the order');
  assert.ok(!('orderNumber' in payload), 'the server numbers the order');
  assert.strictEqual(payload.deliveryMethod, 'HOME_DELIVERY');
  assert.strictEqual(payload.items[0].quantity, 2);
  assert.strictEqual(payload.items[0].unitPriceXaf, 50000, 'the unit price is sent so a stale price is caught');
  assert.strictEqual(payload.shippingAddress.fullName, 'Awa Njoya');

  // Odd bag lines are normalised rather than sent as nonsense.
  const odd = C.toOrderPayload([{ id: 7, qty: '3', priceXaf: '1500.4', name: 'x'.repeat(400) }], {});
  assert.strictEqual(odd.items[0].id, '7');
  assert.strictEqual(odd.items[0].quantity, 3);
  assert.strictEqual(odd.items[0].unitPriceXaf, 1500);
  assert.strictEqual(odd.items[0].title.length, 255);
  assert.strictEqual(C.toOrderPayload([{ id: 'a', qty: 0 }], {}).items[0].quantity, 1, 'a quantity is at least one');
}

function testServerOrderMapping() {
  const server = {
    id: 'ord_1', orderNumber: 'KM-ABC-123', buyerId: 'b', sellerId: 's', sellerPhone: '+237611111111',
    subtotalXaf: 103000, shippingFeeXaf: 1500, totalAmountXaf: 104500, currency: 'XAF',
    items: [{ listingId: 'l1', title: 'Phone', unitPriceXaf: 50000, quantity: 2, storeName: 'Tech Shop', storePhone: '+237611111111', imageUrl: null }],
    shippingAddress: { fullName: 'Awa Njoya', phone: '+237622222222', street: 'Rue 1', city: 'Douala' },
    deliveryMethod: 'HOME_DELIVERY', paymentStatus: 'pending', fulfillmentStatus: 'processing', createdAt: '2026-10-04T10:00:00.000Z'
  };
  const o = C.orderFromServer(server, { images: { l1: 'https://img/phone.jpg' }, paymentMethod: 'MTN MoMo' });
  assert.strictEqual(o.id, 'ord_1', 'the SERVER\'s id is the order\'s id');
  assert.strictEqual(o.orderNumber, 'KM-ABC-123', 'and its number: the one every other party sees');
  assert.strictEqual(o.serverSynced, true);
  assert.strictEqual(o.totalXaf, 104500, 'the server\'s total, not a client guess');
  assert.strictEqual(o.shippingFeeXaf, 1500);
  assert.strictEqual(o.items[0].image, 'https://img/phone.jpg', 'the picture the shopper saw is kept');
  assert.strictEqual(o.paymentMethod, 'MTN MoMo');
  assert.strictEqual(o.seller, 'Tech Shop');
  assert.strictEqual(o.itemCount, 2);
  assert.strictEqual(o.status, 'processing');
  assert.strictEqual(o.address.city, 'Douala');
  assert.strictEqual(o.createdAt, Date.parse('2026-10-04T10:00:00.000Z'));
  assert.strictEqual(C.orderStatusLabel(o), 'PREPARING');
  assert.strictEqual(C.orderStatusLabel(Object.assign({}, o, { status: 'in_transit' })), 'OUT FOR DELIVERY');
  assert.strictEqual(C.orderStatusLabel(Object.assign({}, o, { status: 'delivered' })), 'DELIVERED');
  assert.strictEqual(C.orderStatusLabel(Object.assign({}, o, { status: 'cancelled' })), 'CANCELLED');
  assert.strictEqual(C.orderStatusLabel({ orderNumber: 'LM-OLD', serverSynced: false }), 'NOT SENT', 'a device-only order says it never reached the seller');
  assert.strictEqual(C.orderStatusLabel({ orderNumber: 'LM-OLD', status: 'pending' }), 'NOT SENT', 'even before the first server refresh has flagged it');
  assert.doesNotThrow(() => C.orderFromServer({ id: 'x', items: [] }, undefined));
}

function testMergeOrders() {
  const mk = (id, over) => Object.assign({ id, orderNumber: 'N-' + id, serverSynced: true, status: 'processing', createdAt: 1000, items: [{ id: 'l', name: 'n', image: '' }] }, over);
  const local = [
    mk('a', { items: [{ id: 'l', name: 'n', image: 'kept.jpg' }], paymentMethod: 'Orange Money', status: 'processing' }),
    { orderNumber: 'LM-OLD', createdAt: 500, items: [] }, // from before orders reached the server
    mk('b', { createdAt: 2000 })
  ];
  const fresh = [mk('a', { status: 'in_transit', createdAt: 3000 }), mk('c', { createdAt: 4000 })];
  const merged = C.mergeOrders(local, fresh);

  assert.deepStrictEqual(merged.map((o) => o.id || o.orderNumber), ['c', 'a', 'b', 'LM-OLD'], 'newest first');
  const a = merged.find((o) => o.id === 'a');
  assert.strictEqual(a.status, 'in_transit', 'the server wins on status');
  assert.strictEqual(a.items[0].image, 'kept.jpg', 'but the picture the device knew survives');
  assert.strictEqual(a.paymentMethod, 'Orange Money');
  assert.ok(merged.find((o) => o.id === 'b'), 'an order outside this page of results is kept, not dropped');
  const old = merged.find((o) => o.orderNumber === 'LM-OLD');
  assert.strictEqual(old.serverSynced, false);
  assert.strictEqual(C.mergeOrders([], []).length, 0);
  assert.strictEqual(C.mergeOrders(null, null).length, 0);
}

function testOrderErrors() {
  const bag = [{ id: 'elec-1', name: 'MacBook Pro' }, { id: 'l1', name: 'Phone' }];
  const e = (status, message, code) => C.explainOrderError(Object.assign(new Error(message), { status, code }), bag);

  const auth = e(401, 'x', 'UNAUTHENTICATED');
  assert.strictEqual(auth.kind, 'auth');

  const missing = e(404, "Listing with id 'elec-1' was not found");
  assert.strictEqual(missing.kind, 'unavailable');
  assert.deepStrictEqual(missing.itemIds, ['elec-1'], 'it says which item');
  assert.ok(/MacBook Pro/.test(missing.message) && /showcase/.test(missing.message), 'in words a shopper can act on');
  assert.ok(!/elec-1|Listing with id/.test(missing.message), 'no internal id shown');
  assert.strictEqual(e(404, 'Order not found').kind, 'unavailable');

  assert.strictEqual(e(409, 'Insufficient stock for "Phone". Only 1 unit(s) available, but requested 3.').kind, 'stock');
  assert.ok(/Only 1 unit/.test(e(409, 'Insufficient stock for "Phone". Only 1 unit(s) available, but requested 3.').message), 'the server\'s own stock message is shown');
  assert.strictEqual(e(400, 'Unit price mismatch on "Phone"').kind, 'invalid');
  assert.strictEqual(e(0, 'Cannot reach LOUMOO', 'OFFLINE').kind, 'network');
  const notReady = e(403, 'Verify your email address before continuing.', 'FORBIDDEN');
  assert.strictEqual(notReady.kind, 'account', 'an account that may not buy yet is not a server outage');
  assert.strictEqual(notReady.message, 'Verify your email address before continuing.', 'the server\'s next step is shown');
  assert.strictEqual(e(429, 'Too many attempts').kind, 'server');
  assert.strictEqual(e(503, 'whatever').kind, 'server');
  assert.ok(/bag is saved/.test(e(500, 'boom').message), 'a server failure reassures that the bag is kept');
  assert.strictEqual(C.explainOrderError(undefined, bag).kind, 'server', 'never throws on a missing error');
}

function testNotificationRouting() {
  const calls = [];
  global.LoumooDeliveryTracking = { open: (o) => calls.push(['track', o]) };
  global.LoumooSellerDispatch = { open: (o) => calls.push(['dispatch', o]) };
  global.LoumooRiderHub = { open: () => calls.push(['rider']) };
  global.LoumooRidersAdmin = { open: () => calls.push(['admin']) };
  try {
    assert.strictEqual(C.openFromNotification({ metadata: { action: 'track_order', orderId: 'o1', deliveryId: 'd1' } }), true);
    assert.deepStrictEqual(calls.pop(), ['track', { deliveryId: 'd1' }], 'a known delivery opens directly');
    C.openFromNotification({ action: 'track_order', orderId: 'o1' });
    assert.deepStrictEqual(calls.pop(), ['track', { orderId: 'o1' }], 'a bare order opens its tracker');
    C.openFromNotification({ metadata: { action: 'open_dispatch', orderId: 'o2' } });
    assert.deepStrictEqual(calls.pop(), ['dispatch', { orderId: 'o2' }], 'the seller lands on that order');
    C.openFromNotification({ metadata: { action: 'open_dispatch' } });
    assert.deepStrictEqual(calls.pop(), ['dispatch', undefined], 'or on the board');
    assert.strictEqual(C.openFromNotification({ metadata: { action: 'open_rider_hub' } }), true);
    assert.strictEqual(calls.pop()[0], 'rider');
    assert.strictEqual(C.openFromNotification({ metadata: { action: 'open_riders_admin' } }), true);
    assert.strictEqual(calls.pop()[0], 'admin');
    assert.strictEqual(C.openFromNotification({ metadata: { action: null } }), false, 'a notification with no screen does nothing');
    assert.strictEqual(C.openFromNotification({ metadata: { action: 'track_order' } }), false, 'and tracking with nothing to track does nothing');
    assert.strictEqual(C.openFromNotification(null), false);
    delete global.LoumooSellerDispatch;
    assert.strictEqual(C.openFromNotification({ metadata: { action: 'open_dispatch' } }), false, 'a screen that is not loaded is reported, not thrown');
  } finally {
    delete global.LoumooDeliveryTracking; delete global.LoumooSellerDispatch; delete global.LoumooRiderHub; delete global.LoumooRidersAdmin;
  }
}

function testMoney() {
  assert.strictEqual(C.money(1234567), 'XAF 1 234 567');
  assert.strictEqual(C.money(0), 'XAF 0');
  assert.strictEqual(C.money('abc'), '');
}

async function run() {
  console.log('  Testing the delivery circuit (shared browser logic)...');
  testStagesAndMoves();
  testEveryoneIsToldSomething();
  testStripMarkup();
  testBagToOrders();
  testServerOrderMapping();
  testMergeOrders();
  testOrderErrors();
  testNotificationRouting();
  testMoney();
  console.log('    ✓ Stages, whose move it is, per-role lines, strip markup, checkout helpers and notification routing hold.');
}

module.exports = { run };
