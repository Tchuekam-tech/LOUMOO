/**
 * LOUMOO — In-app messaging service
 * ---------------------------------------------------------------------------
 * The MessagingService over the in-memory repository (which mirrors the SQL
 * trigger; tests/unit/messaging_migration.test.js runs the real SQL). Pins:
 *
 *   1. AUTHORITY. The seller is the STORE OWNER, read from the store row; no
 *      field of the request can name one. A buyer cannot message their own store.
 *   2. PRIVACY. Only the two participants can read or write a thread; anyone else
 *      gets the same 404 as for an id that does not exist. A seller sees a buyer
 *      as "First L." and never their phone; a buyer sees the boutique's phone.
 *   3. THREAD. One conversation per (buyer, store); a product card is added when
 *      the conversation is (re)opened about a different product, never twice.
 *   4. UNREAD. Counters, read receipts and the "after" cursor; the recipient is
 *      notified once per unread streak.
 *   5. INPUT. Empty / oversize / control-character bodies; retried sends with the
 *      same clientId are stored once.
 *   6. ORDERS. Either party to an order may open the thread about it; nobody else.
 */

require('../setup');
const assert = require('assert');

const { MessagingService, payablePrice } = require('../../server/modules/messaging/application/MessagingService');
const { InMemoryMessagingRepository } = require('../../server/modules/messaging/infrastructure/MessagingRepository');
const Conv = require('../../server/modules/messaging/domain/Conversation');

const BUYER = 'usr_buyer';
const OWNER = 'usr_owner';
const MEMBER = 'usr_member';
const STRANGER = 'usr_stranger';
const OTHER_OWNER = 'usr_owner2';

function world() {
  const repo = new InMemoryMessagingRepository({
    stores: [
      { id: 'store_tech', ownerId: OWNER, name: 'Orca Electronics', slug: 'orca', isVerified: true, phone: '+237690000001' },
      { id: 'store_closed', ownerId: OTHER_OWNER, name: 'Shut Shop', status: 'SUSPENDED' },
      { id: 'store_nanoafrica', ownerId: OTHER_OWNER, name: 'NanoAfrica', isVerified: true }
    ],
    profiles: [
      { id: BUYER, firstName: 'Amina', lastName: 'Kamga', avatarUrl: null },
      { id: OWNER, firstName: 'Paul', lastName: 'Toukam' }
    ],
    listingCovers: { lst_phone: 'https://cdn.example/phone.jpg' }
  });
  const listings = {
    // Listed by a store MEMBER: the conversation still belongs to the owner.
    lst_phone: { id: 'lst_phone', storeId: 'store_tech', sellerId: MEMBER, title: 'Tecno Camon 50', status: 'PUBLISHED', visibility: 'PUBLIC', basePriceMinor: 208000, salePriceMinor: 187200 },
    lst_laptop: { id: 'lst_laptop', storeId: 'store_tech', sellerId: OWNER, title: 'MacBook Air M2', status: 'PUBLISHED', visibility: 'PUBLIC', basePriceMinor: 745000, salePriceMinor: null },
    lst_draft: { id: 'lst_draft', storeId: 'store_tech', sellerId: OWNER, title: 'Hidden', status: 'DRAFT', visibility: 'PUBLIC', basePriceMinor: 1000 },
    lst_closed: { id: 'lst_closed', storeId: 'store_closed', sellerId: OTHER_OWNER, title: 'Gone', status: 'PUBLISHED', visibility: 'PUBLIC', basePriceMinor: 1000 },
    cur_rice: { id: 'cur_rice', storeId: 'store_nanoafrica', sellerId: OTHER_OWNER, title: 'Riz parfumé 25kg', status: 'PUBLISHED', visibility: 'PUBLIC', basePriceMinor: 18000, curated: true }
  };
  const orders = {
    ord_1: {
      id: 'ord_1', orderNumber: 'LM-ABC123', buyerId: BUYER, sellerId: OWNER, totalAmountXaf: 750000,
      items: [{ title: 'MacBook Air M2', quantity: 1, storeId: 'store_tech', imageUrl: 'https://cdn.example/mac.jpg' }]
    },
    ord_legacy: {
      id: 'ord_legacy', orderNumber: 'LM-OLD001', buyerId: BUYER, sellerId: OWNER, totalAmountXaf: 5000,
      items: [{ title: 'Cable', quantity: 2, storeId: null }]
    }
  };
  const notifications = [];
  const service = new MessagingService({
    repository: repo,
    orderRepository: {
      findListingById: async (id) => listings[id] || null,
      findOrderById: async (id) => orders[id] || null
    },
    notifier: { create: async (userId, payload) => { notifications.push({ userId, ...payload }); return payload; } },
    curatedCover: (id) => (id === 'cur_rice' ? './Assets/food/rice.jpg' : null)
  });
  return { repo, service, notifications };
}

async function rejects(promise, name, pattern) {
  let error = null;
  try { await promise; } catch (e) { error = e; }
  assert.ok(error, `expected a ${name}`);
  assert.strictEqual(error.constructor.name, name, `expected ${name}, got ${error.constructor.name}: ${error.message}`);
  if (pattern) assert.ok(pattern.test(error.message), `message "${error.message}" should match ${pattern}`);
  return error;
}

async function testDomainRules() {
  assert.strictEqual(Conv.normalizeBody('  hello\r\nthere  '), 'hello\nthere');
  assert.strictEqual(Conv.normalizeBody('a\n\n\n\n\nb'), 'a\n\nb', 'runs of blank lines collapse');
  assert.strictEqual(Conv.normalizeBody('pay‮evil\u0007 now'), 'payevil now', 'bidi overrides and bells are stripped');
  assert.throws(() => Conv.normalizeBody('   '), /Write a message/);
  assert.throws(() => Conv.normalizeBody(42), /Write a message/);
  assert.throws(() => Conv.normalizeBody('x'.repeat(Conv.MAX_BODY + 1)), /limited to 2000/);
  assert.strictEqual(Conv.normalizeBody('x'.repeat(Conv.MAX_BODY)).length, Conv.MAX_BODY);

  assert.strictEqual(Conv.normalizeClientId('c_abc12345'), 'c_abc12345');
  assert.strictEqual(Conv.normalizeClientId('short'), null);
  assert.strictEqual(Conv.normalizeClientId('bad id with spaces'), null);

  assert.strictEqual(Conv.buyerDisplayName({ firstName: 'Amina', lastName: 'kamga' }), 'Amina K.');
  assert.strictEqual(Conv.buyerDisplayName({ firstName: '', lastName: '' }), 'LOUMOO shopper');
  assert.strictEqual(Conv.initialsOf('Orca Electronics'), 'OE');

  // Postgres prints a variable number of fraction digits; the comparison is exact.
  assert.strictEqual(Conv.hasRead('2026-10-17T10:00:00.5+00:00', '2026-10-17T10:00:00.499999+00:00'), true);
  assert.strictEqual(Conv.hasRead('2026-10-17T10:00:00+00:00', '2026-10-17T10:00:00.000001+00:00'), false);
  assert.strictEqual(Conv.hasRead(null, '2026-10-17T10:00:00Z'), false);

  assert.strictEqual(payablePrice({ basePriceMinor: 208000, salePriceMinor: 187200 }), 187200, 'the lower of the pair is payable');
  assert.strictEqual(payablePrice({ basePriceMinor: 18000, salePriceMinor: null }), 18000);
}

async function testOpenFromListing() {
  const { service, repo } = world();
  const thread = await service.startConversation(BUYER, {
    listingId: 'lst_phone',
    // None of these may influence who the seller is.
    sellerId: STRANGER, buyerId: STRANGER, storeId: undefined
  });
  assert.strictEqual(thread.created, true);
  const stored = await repo.findConversation(thread.conversation.id);
  assert.strictEqual(stored.sellerId, OWNER, 'the seller is the store owner, not the member who listed the product');
  assert.strictEqual(stored.buyerId, BUYER);
  assert.strictEqual(thread.conversation.title, 'Orca Electronics');
  assert.strictEqual(thread.conversation.verified, true);
  assert.strictEqual(thread.conversation.storePhone, '+237690000001', 'a buyer may continue on WhatsApp');
  assert.strictEqual(thread.messages.length, 1);
  const card = thread.messages[0];
  assert.strictEqual(card.kind, 'product');
  assert.deepStrictEqual(card.metadata, { listingId: 'lst_phone', title: 'Tecno Camon 50', priceXaf: 187200, image: 'https://cdn.example/phone.jpg' });
  assert.strictEqual(card.mine, true);

  // Reopening about the same product adds nothing; another product adds its card.
  const again = await service.startConversation(BUYER, { listingId: 'lst_phone' });
  assert.strictEqual(again.created, false);
  assert.strictEqual(again.conversation.id, thread.conversation.id, 'one conversation per buyer and store');
  assert.strictEqual(again.messages.length, 1, 'no duplicate card');
  const other = await service.startConversation(BUYER, { listingId: 'lst_laptop', body: 'Is it still sealed?', clientId: 'c_first_0001' });
  assert.strictEqual(other.conversation.id, thread.conversation.id);
  assert.deepStrictEqual(other.messages.map((m) => m.kind), ['product', 'product', 'text']);
  assert.strictEqual(other.messages[2].body, 'Is it still sealed?');
  assert.strictEqual(other.conversation.lastMessagePreview, 'Is it still sealed?');

  // A curated product belongs to the house store, with its catalogue picture.
  const curated = await service.startConversation(BUYER, { listingId: 'cur_rice' });
  assert.strictEqual(curated.conversation.title, 'NanoAfrica');
  assert.strictEqual(curated.messages[0].metadata.image, './Assets/food/rice.jpg');
}

async function testRefusals() {
  const { service, repo } = world();
  await rejects(service.startConversation(OWNER, { listingId: 'lst_phone' }), 'ValidationError', /your own boutique/);
  await rejects(service.startConversation(BUYER, { listingId: 'lst_draft' }), 'NotFoundError');
  await rejects(service.startConversation(BUYER, { listingId: 'nope' }), 'NotFoundError');
  await rejects(service.startConversation(BUYER, { listingId: 'lst_closed' }), 'ValidationError', /not taking messages/);
  await rejects(service.startConversation(BUYER, { storeId: 'store_closed' }), 'ValidationError', /not taking messages/);
  await rejects(service.startConversation(BUYER, { storeId: 'store_missing' }), 'NotFoundError');
  await rejects(service.startConversation(BUYER, {}), 'ValidationError', /which product/);
  await rejects(service.startConversation(BUYER, { listingId: 'lst_phone', storeId: 'store_tech' }), 'ValidationError', /which product/);
  // A bad first message is refused BEFORE anything is created.
  await rejects(service.startConversation(BUYER, { storeId: 'store_tech', body: 'x'.repeat(2001) }), 'ValidationError', /2000/);
  assert.strictEqual(repo.conversations.size, 0, 'no empty conversation left behind');
}

async function testPrivacy() {
  const { service } = world();
  const { conversation } = await service.startConversation(BUYER, { storeId: 'store_tech', body: 'Hello' });
  for (const call of [
    () => service.getThread(STRANGER, conversation.id),
    () => service.sendMessage(STRANGER, conversation.id, { body: 'hi' }),
    () => service.markRead(STRANGER, conversation.id),
    () => service.getThread(BUYER, 'conv_does_not_exist'),
    () => service.getThread(BUYER, '../../etc'),
    () => service.getThread(BUYER, null)
  ]) {
    const err = await rejects(call(), 'NotFoundError');
    assert.strictEqual(err.message, 'Conversation was not found', 'the same answer whether it exists or not');
  }
  assert.deepStrictEqual(await service.listInbox(STRANGER), []);

  const sellerInbox = await service.listInbox(OWNER);
  assert.strictEqual(sellerInbox.length, 1);
  assert.strictEqual(sellerInbox[0].title, 'Amina K.', 'a seller sees the buyer by first name and initial');
  assert.strictEqual(sellerInbox[0].role, 'seller');
  assert.strictEqual(sellerInbox[0].storePhone, null, 'no phone number travels to the seller');
  assert.strictEqual(sellerInbox[0].storeName, 'Orca Electronics', 'the seller knows which boutique was messaged');
  const buyerInbox = await service.listInbox(BUYER);
  assert.strictEqual(buyerInbox[0].title, 'Orca Electronics');
  assert.strictEqual(buyerInbox[0].role, 'buyer');

  assert.strictEqual((await service.listInbox(OWNER, { role: 'buying' })).length, 0);
  assert.strictEqual((await service.listInbox(OWNER, { role: 'selling' })).length, 1);
  assert.strictEqual((await service.listInbox(BUYER, { role: 'selling' })).length, 0);
}

async function testUnreadReceiptsAndNotifications() {
  const { service, notifications } = world();
  const opened = await service.startConversation(BUYER, { storeId: 'store_tech', body: 'Hello, do you deliver to Bonanjo?' });
  const id = opened.conversation.id;
  assert.strictEqual(notifications.length, 1, 'the seller is told about the new conversation');
  assert.strictEqual(notifications[0].userId, OWNER);
  assert.strictEqual(notifications[0].title, 'New message from Amina K.');
  assert.deepStrictEqual(notifications[0].metadata.conversationId, id);
  assert.strictEqual(notifications[0].type, 'message');

  await service.sendMessage(BUYER, id, { body: 'Also, is it new?' });
  assert.strictEqual(notifications.length, 1, 'one notification per unread streak, not per message');
  assert.deepStrictEqual(await service.unreadCount(OWNER), { messages: 2, conversations: 1 });
  assert.deepStrictEqual(await service.unreadCount(BUYER), { messages: 0, conversations: 0 });

  // The buyer's own messages are "sent" until the seller reads the thread.
  let view = await service.getThread(BUYER, id);
  assert.deepStrictEqual(view.messages.map((m) => m.status), ['sent', 'sent']);
  assert.strictEqual((await service.listInbox(OWNER))[0].unread, 2);

  const read = await service.markRead(OWNER, id);
  assert.strictEqual(read.conversation.unread, 0);
  view = await service.getThread(BUYER, id);
  assert.deepStrictEqual(view.messages.map((m) => m.status), ['read', 'read'], 'read receipts after the seller opened it');
  assert.strictEqual(view.conversation.lastReadByPeer, true);

  // The seller replies: the buyer is told once, and the seller's own count stays 0.
  const reply = await service.sendMessage(OWNER, id, { body: 'Yes, delivery today with our rider.' });
  assert.strictEqual(reply.message.mine, true);
  assert.strictEqual(reply.message.status, 'sent');
  assert.strictEqual(notifications.length, 2);
  assert.strictEqual(notifications[1].userId, BUYER);
  assert.strictEqual(notifications[1].title, 'New message from Orca Electronics');
  await service.sendMessage(OWNER, id, { body: 'Brand new, sealed.' });
  assert.strictEqual(notifications.length, 2);
  assert.deepStrictEqual(await service.unreadCount(BUYER), { messages: 2, conversations: 1 });
  assert.deepStrictEqual(await service.unreadCount(OWNER), { messages: 0, conversations: 0 }, 'replying reads the thread');

  // The open thread polls with the cursor and gets only what is new.
  const last = view.messages[view.messages.length - 1].seq;
  const news = await service.getThread(BUYER, id, { after: String(last) });
  assert.deepStrictEqual(news.messages.map((m) => m.body), ['Yes, delivery today with our rider.', 'Brand new, sealed.']);
  assert.ok(news.messages.every((m) => m.mine === false && m.status === null));
  const nothing = await service.getThread(BUYER, id, { after: String(news.messages[1].seq) });
  assert.strictEqual(nothing.messages.length, 0);
  await rejects(service.getThread(BUYER, id, { after: '1; drop table' }), 'ValidationError', /cursor/);
}

async function testIdempotentSendAndPaging() {
  const { service, repo } = world();
  const { conversation } = await service.startConversation(BUYER, { storeId: 'store_tech' });
  assert.strictEqual(repo.messages.length, 0, 'opening a store conversation with no message adds nothing');
  assert.deepStrictEqual(await service.listInbox(BUYER), [], 'an empty conversation does not clutter the inbox');

  const a = await service.sendMessage(BUYER, conversation.id, { body: 'Retry me', clientId: 'c_retry_00001' });
  const b = await service.sendMessage(BUYER, conversation.id, { body: 'Retry me', clientId: 'c_retry_00001' });
  assert.strictEqual(a.message.id, b.message.id, 'a retried send is stored once');
  assert.strictEqual(repo.messages.length, 1);
  assert.strictEqual(a.message.clientId, 'c_retry_00001', 'the sender gets their clientId back to reconcile');

  for (let i = 0; i < 60; i++) await service.sendMessage(BUYER, conversation.id, { body: `m${i}` });
  const page = await service.getThread(BUYER, conversation.id, { limit: '20' });
  assert.strictEqual(page.messages.length, 20);
  assert.strictEqual(page.hasMore, true);
  assert.strictEqual(page.messages[19].body, 'm59', 'the newest page, oldest first');
  const older = await service.getThread(BUYER, conversation.id, { before: String(page.messages[0].seq), limit: '20' });
  assert.strictEqual(older.messages[19].body, 'm39');
  const huge = await service.getThread(BUYER, conversation.id, { limit: '100000' });
  assert.strictEqual(huge.messages.length, 61, 'limit is capped, not trusted');
}

async function testOrders() {
  const { service } = world();
  const fromBuyer = await service.startConversation(BUYER, { orderId: 'ord_1', body: 'When will it arrive?' });
  assert.strictEqual(fromBuyer.conversation.title, 'Orca Electronics');
  const card = fromBuyer.messages[0];
  assert.strictEqual(card.kind, 'order');
  assert.deepStrictEqual(card.metadata, {
    orderId: 'ord_1', orderNumber: 'LM-ABC123', title: 'MacBook Air M2', itemCount: 1, totalXaf: 750000, image: 'https://cdn.example/mac.jpg'
  });
  assert.strictEqual(fromBuyer.conversation.lastMessagePreview, 'When will it arrive?');

  // The seller can open the same thread from their side of the order.
  const fromSeller = await service.startConversation(OWNER, { orderId: 'ord_1' });
  assert.strictEqual(fromSeller.conversation.id, fromBuyer.conversation.id);
  assert.strictEqual(fromSeller.conversation.title, 'Amina K.');
  assert.strictEqual(fromSeller.messages.length, 2, 'the order card is not repeated');

  // An order without a store on its items falls back to the seller's store.
  const legacy = await service.startConversation(BUYER, { orderId: 'ord_legacy' });
  assert.strictEqual(legacy.conversation.id, fromBuyer.conversation.id);

  await rejects(service.startConversation(STRANGER, { orderId: 'ord_1' }), 'NotFoundError');
  await rejects(service.startConversation(BUYER, { orderId: 'ord_missing' }), 'NotFoundError');
}

async function run() {
  console.log('  Testing in-app messaging service...');
  await testDomainRules();
  await testOpenFromListing();
  await testRefusals();
  await testPrivacy();
  await testUnreadReceiptsAndNotifications();
  await testIdempotentSendAndPaging();
  await testOrders();
  console.log('    ✓ Messaging: seller authority, privacy, threads, unread, receipts, retries, orders.');
}

module.exports = { run };

if (require.main === module) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
