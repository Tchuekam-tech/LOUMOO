/**
 * LOUMOO — In-app messaging view logic (src/services/messaging.js)
 * ---------------------------------------------------------------------------
 * What the Messages screens do with the data, without a browser:
 *   1. MERGE. Server copies replace earlier ones and stay in seq order; an unsent
 *      message disappears once the server has it (same clientId), never twice.
 *   2. RECEIPTS. Ticks follow the other side's read mark, to the microsecond.
 *   3. ROWS. Filters, search, "You:" prefix, seller context, unread labels.
 *   4. ITEMS. Day separators; runs of bubbles from one side; cards break runs.
 *   5. COPY. Error texts per status; empty states per tab.
 */

require('../setup');
const assert = require('assert');
const M = require('../../src/services/messaging');

const NOW = new Date('2026-10-17T15:00:00Z');

function msg(seq, extra) {
  return Object.assign({ id: 'm' + seq, seq, kind: 'text', body: 'b' + seq, mine: false, createdAt: `2026-10-17T10:00:0${seq}.123456+00:00` }, extra || {});
}

function testMerge() {
  const local = { id: 'c_abcdefgh1', clientId: 'c_abcdefgh1', mine: true, kind: 'text', body: 'hi', pending: true };
  let list = M.mergeMessages([msg(1), msg(2)], []);
  list = M.mergeMessages(list, [local]);
  assert.deepStrictEqual(list.map((m) => m.id), ['m1', 'm2', 'c_abcdefgh1'], 'unsent messages come last');

  // The poll brings the server copy of the unsent message before the send answers.
  list = M.mergeMessages(list, [msg(3, { mine: true, clientId: 'c_abcdefgh1', body: 'hi' })]);
  assert.deepStrictEqual(list.map((m) => m.id), ['m1', 'm2', 'm3'], 'the local copy gives way to the server one');
  // ...and then the send answers with the same message: still once.
  list = M.mergeMessages(list, [msg(3, { mine: true, clientId: 'c_abcdefgh1', body: 'hi' })]);
  assert.strictEqual(list.length, 3);

  // Out-of-order arrivals are sorted; a newer copy replaces an older one.
  list = M.mergeMessages([msg(5), msg(4)], [msg(4, { body: 'edited' })]);
  assert.deepStrictEqual(list.map((m) => [m.id, m.body]), [['m4', 'edited'], ['m5', 'b5']]);
  // Older pages prepend without disturbing the rest.
  assert.deepStrictEqual(M.mergeMessages([msg(1)], [msg(2), msg(3)]).map((m) => m.seq), [1, 2, 3]);
}

function testReceipts() {
  const mine = msg(1, { mine: true, status: 'sent', createdAt: '2026-10-17T10:00:00.500001+00:00' });
  const theirs = msg(2);
  const notYet = M.applyReceipts([mine, theirs], { peerLastReadAt: '2026-10-17T10:00:00.5+00:00' });
  assert.strictEqual(notYet[0].status, 'sent', 'a read mark one microsecond early does not cover it');
  assert.strictEqual(notYet[0], mine, 'unchanged messages keep their identity');
  const read = M.applyReceipts([mine, theirs], { peerLastReadAt: '2026-10-17T10:00:01+00:00' });
  assert.strictEqual(read[0].status, 'read');
  assert.strictEqual(read[1].status, undefined, 'their messages carry no ticks');
  assert.strictEqual(M.applyReceipts([mine], { peerLastReadAt: null })[0].status, 'sent');
  const pending = { id: 'c_1', mine: true, pending: true };
  assert.strictEqual(M.applyReceipts([pending], { peerLastReadAt: '2030-01-01T00:00:00Z' })[0], pending, 'unsent messages are never "read"');
}

function testLabels() {
  assert.strictEqual(M.dayLabel('2026-10-17T09:00:00Z', NOW), 'Today');
  assert.strictEqual(M.dayLabel('2026-10-16T09:00:00Z', NOW), 'Yesterday');
  assert.strictEqual(M.timeLabel('2026-10-16T09:00:00Z', NOW), 'Yesterday');
  assert.ok(/^\d{2}\/\d{2}\/\d{2}$/.test(M.timeLabel('2026-09-01T09:00:00Z', NOW)), 'older than a week: a date');
  assert.strictEqual(M.timeLabel('not a date', NOW), '');
  assert.strictEqual(M.price(187200), 'XAF 187 200');
  assert.strictEqual(M.price(0), '');
  assert.ok(/^c_[a-z0-9]{8,}$/.test(M.newClientId()), 'client ids satisfy the server rule');
}

function testRows() {
  const conversations = [
    { id: 'a', role: 'buyer', title: 'Orca Electronics', storeName: 'Orca Electronics', initials: 'OE', verified: true, unread: 2, lastMessagePreview: 'Yes, today', lastMessageAt: '2026-10-17T14:00:00Z' },
    { id: 'b', role: 'seller', title: 'Amina K.', storeName: 'My Shop', initials: 'AK', unread: 0, lastFromMe: true, lastReadByPeer: true, lastMessagePreview: 'Thanks!', lastMessageAt: '2026-10-16T14:00:00Z' },
    { id: 'c', role: 'buyer', title: 'NanoAfrica', storeName: 'NanoAfrica', unread: 0, lastMessageKind: 'product', lastMessagePreview: 'Product · Rice', lastMessageAt: '2026-10-10T14:00:00Z' }
  ];
  const opened = [];
  const s = { conversations, convFilter: 'all', convQuery: '', activeConversationId: 'a', threadOpen: true };
  const rows = M.inboxRows(s, (c) => opened.push(c.id), NOW);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].active, true);
  assert.strictEqual(rows[0].unreadLabel, '2');
  assert.strictEqual(rows[0].context, '', 'a buyer row needs no context line');
  assert.strictEqual(rows[1].context, 'To My Shop', 'a seller sees which boutique was messaged');
  assert.strictEqual(rows[1].preview, 'You: Thanks!');
  assert.strictEqual(rows[1].tickRead, true);
  assert.strictEqual(rows[2].previewIsCard, true);
  rows[1].open();
  assert.deepStrictEqual(opened, ['b']);
  assert.strictEqual(M.inboxRows(Object.assign({}, s, { threadOpen: false }), () => {}, NOW)[0].active, false, 'nothing is highlighted on the inbox page');

  const only = (patch) => M.inboxRows(Object.assign({}, s, patch), () => {}, NOW).map((r) => r.id);
  assert.deepStrictEqual(only({ convFilter: 'unread' }), ['a']);
  assert.deepStrictEqual(only({ convFilter: 'buying' }), ['a', 'c']);
  assert.deepStrictEqual(only({ convFilter: 'selling' }), ['b']);
  assert.deepStrictEqual(only({ convQuery: 'rice' }), ['c'], 'search covers the preview');
  assert.deepStrictEqual(only({ convQuery: 'ORCA' }), ['a'], 'case-insensitive');

  const picked = [];
  const tabs = M.filterTabs(s, (k) => picked.push(k));
  assert.deepStrictEqual(tabs.map((t) => t.label), ['All', 'Unread · 1', 'Buying', 'Selling']);
  tabs[3].select();
  assert.deepStrictEqual(picked, ['selling']);
  const buyerOnly = M.filterTabs({ conversations: [conversations[0]], convFilter: 'all', sellerStatus: 'NONE' }, () => {});
  assert.deepStrictEqual(buyerOnly.map((t) => t.key), ['all', 'unread', 'buying'], 'no Selling tab for someone who does not sell');

  assert.strictEqual(M.emptyCopy({ convQuery: 'x' }).title, 'No matches');
  assert.strictEqual(M.emptyCopy({ convFilter: 'all' }).browse, true);
  assert.strictEqual(M.emptyCopy({ convFilter: 'selling' }).browse, false);
}

function testItems() {
  const list = [
    msg(1, { createdAt: '2026-10-16T10:00:00Z' }),
    msg(2, { createdAt: '2026-10-17T10:00:00Z', kind: 'product', mine: true, metadata: { listingId: 'l1', title: 'Tecno Camon 50', priceXaf: 187200, image: 'x.jpg' } }),
    msg(3, { createdAt: '2026-10-17T10:01:00Z', mine: true }),
    msg(4, { createdAt: '2026-10-17T10:02:00Z', mine: true, status: 'read' }),
    msg(5, { createdAt: '2026-10-17T10:03:00Z' }),
    { id: 'c_x', clientId: 'c_x', mine: true, kind: 'text', body: 'oops', failed: true, error: 'Not sent.', createdAt: '2026-10-17T10:04:00Z' }
  ];
  const calls = [];
  const items = M.threadItems(list, {
    retry: (m) => calls.push(['retry', m.id]),
    discard: (m) => calls.push(['discard', m.id]),
    openCard: (m) => calls.push(['open', m.id])
  }, NOW);
  assert.deepStrictEqual(items.filter((i) => i.isDay).map((i) => i.dayLabel), ['Yesterday', 'Today']);
  const byKey = {};
  items.forEach((i) => { byKey[i.key] = i; });
  assert.strictEqual(byKey.m2.isCard, true);
  assert.strictEqual(byKey.m2.cardMeta, 'XAF 187 200');
  assert.strictEqual(byKey.m2.cardKicker, 'You asked about');
  assert.deepStrictEqual([byKey.m3.runStart, byKey.m3.runEnd], [true, false], 'a card starts a new run');
  assert.deepStrictEqual([byKey.m4.runStart, byKey.m4.runEnd], [false, true]);
  assert.strictEqual(byKey.m4.read, true);
  assert.strictEqual(byKey.m4.showTick, true);
  assert.strictEqual(byKey.m5.showTick, false);
  assert.strictEqual(byKey.c_x.failed, true);
  assert.strictEqual(byKey.c_x.showTick, false, 'no tick on a message the server never got');
  byKey.c_x.retry();
  byKey.m2.openCard();
  assert.deepStrictEqual(calls, [['retry', 'c_x'], ['open', 'm2']]);
  const order = M.threadItems([msg(9, { kind: 'order', metadata: { orderNumber: 'LM-1', itemCount: 2, totalXaf: 5000 } })], { retry() {}, discard() {}, openCard() {} }, NOW)[1];
  assert.strictEqual(order.cardKicker, 'Order LM-1');
  assert.strictEqual(order.cardMeta, '2 items · XAF 5 000');
  assert.strictEqual(order.cardAction, 'View order');
}

function testErrors() {
  assert.ok(/offline/.test(M.errorText({ status: 0 })));
  assert.ok(/too quickly/.test(M.errorText({ status: 429 })));
  assert.ok(/being set up/.test(M.errorText({ status: 503 })));
  assert.strictEqual(M.errorText({ status: 400, message: 'Write a message before sending.' }), 'Write a message before sending.');
  assert.ok(/Try again/.test(M.errorText({ status: 500, message: 'stack trace here' })), 'server internals are never shown');
}

async function run() {
  console.log('  Testing in-app messaging view logic...');
  testMerge();
  testReceipts();
  testLabels();
  testRows();
  testItems();
  testErrors();
  console.log('    ✓ Messaging view logic: merge, receipts, labels, rows, items, errors.');
}

module.exports = { run };

if (require.main === module) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
