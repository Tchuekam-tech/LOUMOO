/**
 * LOUMOO — In-app messaging, the view logic
 * ---------------------------------------------------------------------------
 * The pure part of the Messages screens: how a thread is merged as messages
 * arrive (server copies, unsent ones from this device, retries), how read
 * receipts follow the other side's read mark, and what the inbox rows and the
 * thread items look like. The shell (build_redesign.py) keeps the state and the
 * network calls and asks this module for everything else.
 *
 * A plain UMD module with no dependencies: `window.LoumooMessaging` in the
 * browser, `require('./messaging')` in Node (tests/unit/messaging_client.test.js).
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.LoumooMessaging = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var MAX_BODY = 2000;

  /** What to tell the person when a messaging request failed. */
  function errorText(err) {
    var status = err && err.status;
    if (status === 0 || (err && err.code === 'OFFLINE')) return "You're offline. Check your connection and try again.";
    if (status === 401) return 'Your session has ended. Sign in again to see your messages.';
    if (status === 404) return 'This conversation is not available.';
    if (status === 429) return "You're sending messages too quickly. Wait a moment and try again.";
    if (status === 503) return 'Messaging is being set up. Please try again in a little while.';
    if (status === 400 && err && err.message) return err.message;
    return "Couldn't reach LOUMOO. Try again.";
  }

  /**
   * Microseconds for an ISO timestamp. Postgres keeps microseconds and prints a
   * variable number of fraction digits, so read receipts compare exactly.
   */
  function micros(value) {
    if (!value) return null;
    var m = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/.exec(String(value));
    if (!m) {
      var t = Date.parse(value);
      return isFinite(t) ? t * 1000 : null;
    }
    var ms = Date.parse(m[1] + (m[3] || 'Z'));
    return isFinite(ms) ? ms * 1000 + Number(((m[2] || '') + '000000').slice(0, 6)) : null;
  }

  /**
   * One thread from what is on screen and what just arrived: the server's
   * messages in order (a later copy of a message replaces an earlier one), then
   * this device's unsent ones — unless the server already has them, which is
   * what a late answer or a retry that got through looks like.
   */
  function mergeMessages(existing, incoming) {
    var all = (existing || []).concat(incoming || []).filter(Boolean);
    var byId = {};
    var order = [];
    all.forEach(function (m) {
      if (!m.seq) return;
      if (!byId[m.id]) order.push(m.id);
      byId[m.id] = m;
    });
    var sent = order.map(function (id) { return byId[id]; }).sort(function (a, b) { return a.seq - b.seq; });
    var delivered = {};
    sent.forEach(function (m) { if (m.clientId) delivered[m.clientId] = true; });
    var seen = {};
    var unsent = all.filter(function (m) {
      if (m.seq || (m.clientId && delivered[m.clientId]) || seen[m.id]) return false;
      seen[m.id] = true;
      return true;
    });
    return sent.concat(unsent);
  }

  /** Ticks on my messages follow the other side's read mark. */
  function applyReceipts(list, conversation) {
    var read = micros(conversation && conversation.peerLastReadAt);
    return (list || []).map(function (m) {
      if (!m.mine || !m.seq) return m;
      var status = read != null && read >= micros(m.createdAt) ? 'read' : 'sent';
      if (status === m.status) return m;
      var copy = {};
      for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) copy[k] = m[k];
      copy.status = status;
      return copy;
    });
  }

  function daysAgo(iso, now) {
    var t = Date.parse(iso || '');
    if (!isFinite(t)) return null;
    var d = new Date(t);
    var n = now ? new Date(now) : new Date();
    var a = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    var b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return { date: d, days: Math.round((a - b) / 86400000) };
  }

  /** "14:05" today, "Yesterday", "Mon" this week, "12/10/26" before. */
  function timeLabel(iso, now) {
    var x = daysAgo(iso, now);
    if (!x) return '';
    if (x.days <= 0) return clock(iso);
    if (x.days === 1) return 'Yesterday';
    if (x.days < 7) return x.date.toLocaleDateString('en-GB', { weekday: 'short' });
    return x.date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  /** The separator above a day's messages: "Today", "Yesterday", "Monday", "12 October 2026". */
  function dayLabel(iso, now) {
    var x = daysAgo(iso, now);
    if (!x) return '';
    if (x.days <= 0) return 'Today';
    if (x.days === 1) return 'Yesterday';
    if (x.days < 7) return x.date.toLocaleDateString('en-GB', { weekday: 'long' });
    return x.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function clock(iso) {
    var t = Date.parse(iso || '');
    return isFinite(t) ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  }

  function price(xaf) {
    var n = Math.round(Number(xaf) || 0);
    return n > 0 ? 'XAF ' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '';
  }

  function matchesFilter(c, filter) {
    if (filter === 'unread') return c.unread > 0;
    if (filter === 'buying') return c.role === 'buyer';
    if (filter === 'selling') return c.role === 'seller';
    return true;
  }

  /**
   * The inbox rows the view shows: filtered by tab and search.
   * @param {object} s       { conversations, convFilter, convQuery, activeConversationId, threadOpen }
   * @param {function} open  (conversation) => void
   */
  function inboxRows(s, open, now) {
    var q = String(s.convQuery || '').trim().toLowerCase();
    return (s.conversations || [])
      .filter(function (c) { return matchesFilter(c, s.convFilter); })
      .filter(function (c) {
        if (!q) return true;
        return [c.title, c.storeName, c.lastMessagePreview].some(function (x) { return String(x || '').toLowerCase().indexOf(q) !== -1; });
      })
      .map(function (c) {
        var unread = c.unread || 0;
        return {
          id: c.id,
          title: c.title,
          initials: c.initials || '?',
          avatarUrl: c.avatarUrl || '',
          hasAvatar: Boolean(c.avatarUrl),
          verified: Boolean(c.verified),
          // A seller may run more than one boutique: say which one was messaged.
          context: c.role === 'seller' ? 'To ' + (c.storeName || 'your boutique') : '',
          preview: (c.lastFromMe ? 'You: ' : '') + (c.lastMessagePreview || ''),
          previewIsCard: c.lastMessageKind === 'product' || c.lastMessageKind === 'order',
          timeLabel: timeLabel(c.lastMessageAt, now),
          unread: unread,
          hasUnread: unread > 0,
          unreadLabel: unread > 99 ? '99+' : String(unread),
          showTick: Boolean(c.lastFromMe),
          tickRead: Boolean(c.lastReadByPeer),
          active: Boolean(s.threadOpen) && c.id === s.activeConversationId,
          ariaLabel: c.title + (unread ? ', ' + unread + ' unread' : '') + '. ' + (c.lastMessagePreview || ''),
          open: function () { open(c); }
        };
      });
  }

  /** The segmented filter. "Selling" only appears for someone who sells. */
  function filterTabs(s, select) {
    var list = s.conversations || [];
    var unread = list.filter(function (c) { return c.unread > 0; }).length;
    var tabs = [
      { key: 'all', label: 'All' },
      { key: 'unread', label: unread ? 'Unread · ' + unread : 'Unread' },
      { key: 'buying', label: 'Buying' }
    ];
    var sells = list.some(function (c) { return c.role === 'seller'; }) || (s.sellerStatus && s.sellerStatus !== 'NONE');
    if (sells) tabs.push({ key: 'selling', label: 'Selling' });
    return tabs.map(function (t) {
      return { key: t.key, label: t.label, active: s.convFilter === t.key, select: function () { select(t.key); } };
    });
  }

  /** The words of an empty inbox, for the tab and search in use. */
  function emptyCopy(s) {
    var q = String(s.convQuery || '').trim();
    if (q) return { title: 'No matches', text: 'No conversation mentions "' + q + '".', browse: false };
    if (s.convFilter === 'unread') return { title: "You're all caught up", text: 'New messages from boutiques and buyers will show up here.', browse: false };
    if (s.convFilter === 'selling') return { title: 'No buyer messages yet', text: 'When a buyer messages your boutique, the conversation appears here.', browse: false };
    return { title: 'No messages yet', text: 'Ask a boutique about a product from its page. Your conversations will appear here.', browse: true };
  }

  /**
   * The thread as the view shows it: day separators, bubbles grouped by sender
   * (only the last bubble of a run carries the time and the tail), cards.
   * @param {Array} list  messages
   * @param {object} on   { retry(m), discard(m), openCard(m) }
   */
  function threadItems(list, on, now) {
    list = list || [];
    var items = [];
    var lastDay = '';
    var days = list.map(function (m) { return dayLabel(m.createdAt, now); });
    list.forEach(function (m, i) {
      var day = days[i];
      if (day && day !== lastDay) {
        items.push({ key: 'day_' + m.id, isDay: true, dayLabel: day });
        lastDay = day;
      }
      var sameRun = function (x, j) { return x && x.kind === 'text' && m.kind === 'text' && Boolean(x.mine) === Boolean(m.mine) && days[j] === day; };
      var meta = m.metadata || {};
      var isOrder = m.kind === 'order';
      items.push({
        key: m.id,
        isDay: false,
        isText: m.kind === 'text',
        isCard: m.kind === 'product' || isOrder,
        mine: Boolean(m.mine),
        body: m.body || '',
        runStart: !sameRun(list[i - 1], i - 1),
        runEnd: !sameRun(list[i + 1], i + 1),
        timeLabel: m.pending ? 'Sending…' : clock(m.createdAt),
        pending: Boolean(m.pending),
        failed: Boolean(m.failed),
        errorText: m.error || 'Not sent.',
        read: m.status === 'read',
        showTick: Boolean(m.mine && m.seq),
        retry: function () { on.retry(m); },
        discard: function () { on.discard(m); },
        cardKicker: isOrder ? 'Order ' + (meta.orderNumber || '') : (m.mine ? 'You asked about' : 'About this product'),
        cardTitle: meta.title || (isOrder ? 'Your order' : 'A product'),
        cardMeta: isOrder
          ? [meta.itemCount ? meta.itemCount + (meta.itemCount === 1 ? ' item' : ' items') : '', price(meta.totalXaf)].filter(Boolean).join(' · ')
          : price(meta.priceXaf),
        cardImage: meta.image || '',
        hasCardImage: Boolean(meta.image),
        cardAction: isOrder ? 'View order' : 'View product',
        openCard: function () { on.openCard(m); }
      });
    });
    return items;
  }

  /** A unique id for a message this device is sending (the server's retry key). */
  function newClientId() {
    return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  return {
    MAX_BODY: MAX_BODY,
    errorText: errorText,
    micros: micros,
    mergeMessages: mergeMessages,
    applyReceipts: applyReceipts,
    timeLabel: timeLabel,
    dayLabel: dayLabel,
    clock: clock,
    price: price,
    inboxRows: inboxRows,
    filterTabs: filterTabs,
    emptyCopy: emptyCopy,
    threadItems: threadItems,
    newClientId: newClientId
  };
});
