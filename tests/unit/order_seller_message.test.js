/**
 * LOUMOO Unit Tests - The message a seller receives when someone orders
 * ---------------------------------------------------------------------------
 * A new order reaches the seller twice: an in-app notification (the guaranteed
 * channel) and an e-mail (best effort). Both carry everything needed to act on
 * the order, and neither can be turned against the seller by what the customer
 * typed.
 *
 *   1. CONTENT. A home delivery and a pickup each carry every required detail:
 *      order number and local time, customer name / phone / WhatsApp link, delivery
 *      method and full address (or "Customer collects at the store"), the delivery
 *      provider and fee, every line as "N x title - XAF total", subtotal, delivery
 *      fee, total, and a payment line that says pay on delivery / pickup and never
 *      claims money is held or paid. The structured metadata.details mirrors it.
 *   2. UNTRUSTED TEXT. A name like <script>alert(1)</script> or an address with
 *      HTML never reaches the e-mail markup raw; control characters are stripped
 *      and every field is capped (iam.notifications.title is varchar 255).
 *   3. WHATSAPP. Links are https://wa.me/<digits> from the platform's own Cameroon
 *      number rule, never doubled (+237 237...), and omitted for a bad number.
 *   4. SECRETS. No handover code or token enters any message.
 *   5. DELIVERY. Through the real OrderCreationService: the seller gets the full
 *      message AND an e-mail; the e-mail is skipped when the seller opted out, has
 *      no address, or the store turned order e-mails off; a transport or a
 *      notification service that throws never fails (or delays) an order that was
 *      saved; and an ordinary seller gets the richer message in the same shape.
 */

require('../setup');
const assert = require('assert');

const { Order, OrderItem, DELIVERY_METHOD } = require('../../server/modules/commerce/domain/Order');
const Builder = require('../../server/modules/commerce/application/OrderNotificationBuilder');

function item(title, unitPriceXaf, quantity) {
  return new OrderItem({
    listingId: `l_${title.length}_${unitPriceXaf}`, title, unitPriceXaf, quantity,
    sellerId: 'seller_1', storeId: 'store_1', storeName: 'Tech Shop'
  });
}

function makeOrder(overrides = {}) {
  return new Order({
    id: 'ord_1',
    orderNumber: 'KM-ABC123-DEF456',
    buyerId: 'buyer_1',
    sellerId: 'seller_1',
    items: [item('Wireless Mouse', 8500, 2), item('USB-C Cable', 3000, 1)],
    subtotalXaf: 20000,
    shippingFeeXaf: 1500,
    totalAmountXaf: 21500,
    shippingAddress: { fullName: 'Awa Njoya', phone: '+237 622 22 22 22', street: 'Rue 1', city: 'Douala', neighbourhood: 'Bonanjo' },
    deliveryMethod: DELIVERY_METHOD.HOME_DELIVERY,
    createdAt: '2026-10-10T13:32:00.000Z',
    ...overrides
  });
}

// --------------------------------------------------------------------- 1. content

function testHomeDeliveryContent() {
  const order = makeOrder();
  const n = Builder.buildSellerNotification(order, {
    storeName: 'Tech Shop',
    provider: { id: 'rider_9', name: 'Speedy Riders', source: 'buyer' }
  });

  assert.strictEqual(n.type, 'order');
  assert.strictEqual(n.tone, 'sale');
  assert.ok(/New order KM-ABC123-DEF456 to deliver/.test(n.title), 'the title carries the order number');
  assert.ok(n.title.includes('XAF 21,500'), 'and the total');

  const body = n.body;
  for (const needle of [
    'KM-ABC123-DEF456',
    '10 Oct 2026, 14:32 (Cameroon time)',            // UTC+1
    'Name: Awa Njoya',
    'Phone: +237 622 22 22 22',
    'WhatsApp: https://wa.me/237622222222',
    'Method: Home delivery',
    'Address: Rue 1, Bonanjo, Douala',
    'Delivery provider: Speedy Riders (chosen by the customer)',
    '2 x Wireless Mouse - XAF 17,000',
    '1 x USB-C Cable - XAF 3,000',
    'Subtotal: XAF 20,000',
    'Delivery fee: XAF 1,500',
    'Total: XAF 21,500',
    'Pay on delivery',
    'Store: Tech Shop',
    '3 items'
  ]) {
    assert.ok(body.includes(needle), `the body carries "${needle}":\n${body}`);
  }
  assert.ok(/Arrange a rider|Offer it to Speedy Riders/.test(body), 'it says what to do next');
  assert.ok(!/\b(held|escrow|paid online|has been paid)\b/i.test(body.replace('has not paid online', '')), 'it never claims money is held or paid');

  const md = n.metadata;
  assert.strictEqual(md.audience, 'seller');
  assert.strictEqual(md.action, 'open_dispatch');
  assert.strictEqual(md.orderId, 'ord_1');
  assert.strictEqual(md.orderNumber, 'KM-ABC123-DEF456');
  const d = md.details;
  assert.deepStrictEqual(
    { name: d.buyer.name, phone: d.buyer.phone, wa: d.buyer.whatsappUrl },
    { name: 'Awa Njoya', phone: '+237 622 22 22 22', wa: 'https://wa.me/237622222222' }
  );
  assert.strictEqual(d.address, 'Rue 1, Bonanjo, Douala');
  assert.strictEqual(d.deliveryMethod, 'HOME_DELIVERY');
  assert.deepStrictEqual({ id: d.provider.id, name: d.provider.name }, { id: 'rider_9', name: 'Speedy Riders' });
  assert.deepStrictEqual(d.items.map((i) => [i.title, i.quantity, i.unitPriceXaf, i.lineTotalXaf]),
    [['Wireless Mouse', 2, 8500, 17000], ['USB-C Cable', 1, 3000, 3000]]);
  assert.deepStrictEqual([d.subtotalXaf, d.shippingFeeXaf, d.totalXaf], [20000, 1500, 21500]);
  assert.strictEqual(d.paymentStatus, 'pending');
  JSON.parse(JSON.stringify(md)); // plain data: it goes into a jsonb column
}

function testPickupContent() {
  const order = makeOrder({
    deliveryMethod: DELIVERY_METHOD.STORE_PICKUP,
    shippingFeeXaf: 0,
    totalAmountXaf: 20000,
    shippingAddress: { fullName: 'Awa Njoya', phone: '622222222', street: 'Rue 1', city: 'Douala' }
  });
  const n = Builder.buildSellerNotification(order, { storeName: 'Tech Shop' });
  assert.ok(/New pickup order KM-ABC123-DEF456/.test(n.title));
  assert.ok(n.body.includes('Customer collects at the store'), 'no street address is shown for a pickup');
  assert.ok(!n.body.includes('Rue 1'), 'the customer address is irrelevant to a pickup');
  assert.ok(n.body.includes('Method: Store pickup'));
  assert.ok(/Pay on pickup/.test(n.body), 'payment says pickup');
  assert.ok(!/Delivery provider/.test(n.body), 'no delivery provider for a pickup');
  assert.ok(n.body.includes('WhatsApp: https://wa.me/237622222222'), 'a bare 9-digit number gets the country code once');
  assert.ok(n.body.includes('Total: XAF 20,000'));
  assert.strictEqual(n.metadata.action, null, 'nothing to dispatch');
  assert.strictEqual(n.metadata.details.address, null);
  assert.strictEqual(n.metadata.details.pickup, true);
}

function testProviderWording() {
  const order = makeOrder();
  const chosen = Builder.buildSellerNotification(order, { provider: { id: 'p1', name: 'Speedy Riders', source: 'buyer' } }).body;
  const defaulted = Builder.buildSellerNotification(order, { provider: { id: 'p2', name: 'nanoDelivery', source: 'default' } }).body;
  const none = Builder.buildSellerNotification(order, {}).body;
  const dropped = Builder.buildSellerNotification(order, { droppedProviderReason: 'suspended' }).body;

  assert.ok(chosen.includes('Delivery provider: Speedy Riders (chosen by the customer)'));
  assert.ok(defaulted.includes('Delivery provider: nanoDelivery (default: the customer did not choose one)'),
    'a defaulted provider is labelled as such, not as the customer\'s choice');
  assert.ok(!/chosen by the customer/.test(defaulted));
  assert.ok(defaulted.includes('Offer it to nanoDelivery from Deliveries.'));
  assert.ok(none.includes('Delivery provider: None chosen by the customer'));
  assert.ok(none.includes('Arrange a rider from Deliveries.'));
  assert.ok(dropped.includes('no longer available'), 'a provider that fell away is explained');
}

function testBuyerFallbacksAndProfile() {
  // No name or phone on the address (a pickup placed with an empty form): the
  // buyer's profile fills the gaps, but never overrides what the order says.
  const bare = makeOrder({ deliveryMethod: DELIVERY_METHOD.STORE_PICKUP, shippingAddress: {} });
  const filled = Builder.buildSellerNotification(bare, { buyer: { name: 'Profile Name', phone: '690123456', email: 'buyer@example.com' } });
  assert.ok(filled.body.includes('Name: Profile Name'));
  assert.ok(filled.body.includes('WhatsApp: https://wa.me/237690123456'));
  assert.ok(filled.body.includes('Email: buyer@example.com'));
  assert.strictEqual(filled.metadata.details.buyer.email, 'buyer@example.com');

  const typed = Builder.buildSellerNotification(makeOrder(), { buyer: { name: 'Profile Name', phone: '690123456' } });
  assert.ok(typed.body.includes('Name: Awa Njoya'), 'the name typed for this order wins');
  assert.ok(typed.body.includes('wa.me/237622222222'));

  const nobody = Builder.buildSellerNotification(bare, {});
  assert.ok(nobody.body.includes('Name: Customer') && nobody.body.includes('Phone: not given'));
  assert.ok(!nobody.body.includes('WhatsApp'), 'no link without a number');
}

function testEmailContent() {
  const order = makeOrder();
  const mail = Builder.buildSellerEmail(order, {
    storeName: 'Tech Shop',
    provider: { id: 'rider_9', name: 'Speedy Riders', source: 'buyer' }
  });
  assert.ok(/New order KM-ABC123-DEF456/.test(mail.subject) && mail.subject.includes('XAF 21,500'));
  for (const needle of ['Awa Njoya', '+237 622 22 22 22', 'https://wa.me/237622222222', 'Rue 1, Bonanjo, Douala',
    'Speedy Riders', '2 x Wireless Mouse', 'XAF 17,000', 'Subtotal', 'Delivery fee', 'XAF 1,500', 'XAF 21,500', 'Pay on delivery']) {
    assert.ok(mail.html.includes(needle), `the e-mail HTML carries "${needle}"`);
  }
  assert.ok(mail.text.includes('Total: XAF 21,500') && mail.text.includes('1 x USB-C Cable - XAF 3,000'), 'and the text part is the full message');
  assert.ok(mail.html.includes('href="https://wa.me/237622222222"'));
}

// ------------------------------------------------------------- 2. untrusted text

function testEscapingAndCaps() {
  const evil = makeOrder({
    items: [item('<img src=x onerror=alert(2)>Phone & "Case"', 5000, 1)],
    subtotalXaf: 5000, shippingFeeXaf: 0, totalAmountXaf: 5000,
    shippingAddress: {
      fullName: '<script>alert(1)</script>',
      phone: '+237622222222',
      street: '<b onmouseover=alert(3)>12 Rue</b>',
      city: 'Douala"><svg/onload=alert(4)>',
      neighbourhood: 'Akwa',
      notes: 'Ring twice\r\nBcc: attacker@example.com‮gnp.exe'
    }
  });
  const mail = Builder.buildSellerEmail(evil, { storeName: 'Tech <i>Shop</i>', buyer: { email: 'x"><script>1</script>@example.com' } });

  for (const raw of ['<script>', '<img', '<svg', '<b onmouseover', '<i>Shop', '"><script']) {
    assert.ok(!mail.html.includes(raw), `raw markup "${raw}" never reaches the e-mail HTML`);
  }
  assert.ok(mail.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'it is shown as text instead');
  assert.ok(mail.html.includes('&lt;b onmouseover=alert(3)&gt;12 Rue&lt;/b&gt;'));
  assert.ok(mail.html.includes('Phone &amp; &quot;Case&quot;'));
  assert.ok(!/[\r\n]Bcc:/.test(mail.subject), 'nothing typed by the customer can add a header line to the subject');
  assert.ok(!/[\u0000-\u001F]/.test(mail.subject), 'no control character in the subject');
  assert.ok(!mail.html.includes('‮') && !mail.text.includes('‮'), 'bidi overrides are stripped');
  assert.ok(!/[\r]/.test(mail.text), 'no stray carriage returns in the text part');

  const n = Builder.buildSellerNotification(evil, {});
  assert.ok(!n.body.includes('‮'));
  assert.ok(n.body.includes('Customer note: Ring twice Bcc: attacker@example.com'), 'a multi-line note becomes one harmless line');
}

function testCaps() {
  const long = 'A'.repeat(5000);
  const big = makeOrder({
    items: [item(long, 1000, 1)],
    subtotalXaf: 1000, shippingFeeXaf: 0, totalAmountXaf: 1000,
    shippingAddress: { fullName: long, phone: '9'.repeat(200), street: long, city: long, neighbourhood: long, notes: long }
  });
  const n = Builder.buildSellerNotification(big, { storeName: long, provider: { id: 'p', name: long, source: 'buyer' } });
  assert.ok(n.title.length <= 255, `the title fits varchar(255), got ${n.title.length}`);
  assert.ok(n.body.length < 2500, `the body stays bounded, got ${n.body.length}`);
  assert.ok(n.metadata.details.buyer.name.length <= Builder.CAPS.name);
  assert.ok(n.metadata.details.items[0].title.length <= Builder.CAPS.itemTitle);
  assert.ok(Builder.buildSellerEmail(big, {}).subject.length <= 255);

  // A very long order lists a bounded number of lines and says how many it left out.
  const many = Array.from({ length: 80 }, (_, i) => item(`Thing ${i}`, 100, 1));
  const huge = makeOrder({ items: many, subtotalXaf: 8000, totalAmountXaf: 9500 });
  const hn = Builder.buildSellerNotification(huge, {});
  assert.strictEqual(hn.metadata.details.items.length, 50);
  assert.ok(hn.body.includes('+ 30 more lines'), 'the omission is stated');
  assert.ok(hn.body.includes('80 items'), 'while the headline count is the real one');
}

// ---------------------------------------------------------------- 3. WhatsApp

function testWhatsappLinks() {
  const cases = [
    ['+237 690 12 34 56', 'https://wa.me/237690123456'],
    ['690123456', 'https://wa.me/237690123456'],
    ['237690123456', 'https://wa.me/237690123456'],        // already has the country code: not doubled
    ['00237690123456', 'https://wa.me/237690123456'],      // international 00 prefix
    ['+237 237 690 12', null],                              // too short once the prefix is read once
    ['+237 6 9012-3456', 'https://wa.me/237690123456'],
    ['(237) 690.123.456', 'https://wa.me/237690123456'],
    ['237123456', 'https://wa.me/237237123456'],            // a 9-digit landline that merely STARTS with 237
    ['12345', null],
    ['', null],
    [null, null],
    ['not a number', null],
    ['+33 6 12 34 56 78', null]                             // a foreign number is not a Cameroon contact
  ];
  for (const [input, expected] of cases) {
    assert.strictEqual(Builder.whatsappUrl(input), expected, `whatsappUrl(${JSON.stringify(input)})`);
  }
  assert.ok(!/237237/.test(Builder.buildSellerNotification(makeOrder({ shippingAddress: { fullName: 'A B', phone: '237690123456', city: 'Douala' } }), {}).body),
    'no doubled country code in a message');
  const bad = Builder.buildSellerNotification(makeOrder({ shippingAddress: { fullName: 'A B', phone: '12345', city: 'Douala' } }), {});
  assert.ok(!bad.body.includes('wa.me') && bad.metadata.details.buyer.whatsappUrl === null, 'an unusable number gets no link');
  assert.ok(bad.body.includes('Phone: 12345'), 'but the number as typed is still shown');
}

// ----------------------------------------------------------------- 4. secrets

function testNoSecrets() {
  const order = makeOrder({ shippingAddress: { fullName: 'Awa', phone: '622222222', city: 'Douala', _handoverCode: '123456', _sellerPhone: '611111111', _preferredDriverId: 'rider_9' } });
  const all = JSON.stringify([
    Builder.buildSellerNotification(order, {}),
    Builder.buildSellerEmail(order, {}),
    Builder.buildBuyerNotification(order, {})
  ]);
  assert.ok(!all.includes('123456'), 'a handover code is never in a message');
  assert.ok(!all.includes('_handoverCode') && !all.includes('_sellerPhone') && !all.includes('_preferredDriverId'), 'internal address keys never leak');
}

function testBuyerNotification() {
  const b = Builder.buildBuyerNotification(makeOrder(), { storeName: 'NanoAfrica', provider: { id: 'p', name: 'nanoDelivery', source: 'default' } });
  assert.strictEqual(b.tone, 'accent');
  assert.strictEqual(b.title, 'Order KM-ABC123-DEF456 placed');
  assert.ok(b.body.includes('NanoAfrica') && b.body.includes('nanoDelivery') && b.body.includes('XAF 21,500') && /pay on delivery/.test(b.body), b.body);
  assert.deepStrictEqual(b.metadata, { orderId: 'ord_1', orderNumber: 'KM-ABC123-DEF456', audience: 'buyer', action: 'track_order' }, 'the routing metadata is unchanged');
  const plain = Builder.buildBuyerNotification(makeOrder(), {});
  assert.ok(/Your order is confirmed — pay on delivery\. Total XAF 21,500\./.test(plain.body), 'without context it reads as before');
}

async function run() {
  testHomeDeliveryContent();
  testPickupContent();
  testProviderWording();
  testBuyerFallbacksAndProfile();
  testEmailContent();
  testEscapingAndCaps();
  testCaps();
  testWhatsappLinks();
  testNoSecrets();
  testBuyerNotification();
  console.log('order_seller_message: message-builder checks passed');
}

if (require.main === module) {
  run().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
