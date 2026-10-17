# -*- coding: utf-8 -*-
"""
LOUMOO MESSAGING, PROFILE & SYSTEM VIEWS
In-app messages (inbox + conversations with boutiques), LOUMOO Combi assistant, notifications, upgraded user profile with onboarding entry point, saved items, settings, and skeleton states with Lucide SVG icons.
"""

from .search_shared import get_combi_view

def get_chat_and_profile_view():
    return """
<!-- ══════════════════════════════════════════════════════════════════════════
     MESSAGES — inbox (is.chat) and a conversation (is.threadSeller)
     Real buyer ↔ boutique conversations (/api/v1/conversations). One layout for
     both screens: on a phone the inbox and the thread are separate pages; from
     1024px wide they sit side by side, like Messages on a Mac.
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.chat || is.threadSeller }}">
<div class="msg-app {{ is.threadSeller ? 'is-thread' : 'is-inbox' }}">

  <!-- ── Inbox pane ── -->
  <section class="msg-inbox" aria-label="Conversations">
    <header class="msg-inbox-head">
      <div class="msg-inbox-bar">
        <button onClick="{{ back }}" class="msg-icon-btn msg-only-phone" aria-label="Go back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
      </div>
      <h1 class="msg-large-title">Messages</h1>
      <sc-if value="{{ convSignedIn && convHasAny }}">
        <label class="msg-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" value="{{ convQuery }}" onInput="{{ updateConvQuery }}" placeholder="Search" aria-label="Search conversations" autocomplete="off" maxlength="80" enterkeyhint="search">
          <sc-if value="{{ convQuery }}">
            <button onClick="{{ clearConvQuery }}" class="msg-search-clear" aria-label="Clear search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.54 12.12-1.42 1.42L12 13.41l-2.12 2.13-1.42-1.42L10.59 12 8.46 9.88l1.42-1.42L12 10.59l2.12-2.13 1.42 1.42L13.41 12Z"/></svg>
            </button>
          </sc-if>
        </label>
        <div class="msg-segments" role="tablist" aria-label="Filter conversations">
          <sc-for list="{{ convFilterTabs }}" as="tab">
            <button role="tab" aria-selected="{{ tab.active }}" onClick="{{ tab.select }}" class="msg-segment {{ tab.active ? 'is-active' : '' }}">{{ tab.label }}</button>
          </sc-for>
        </div>
      </sc-if>
    </header>

    <div class="msg-inbox-body">

      <!-- The assistant is always one tap away, above the conversations. -->
      <button onClick="{{ on.threadAi }}" class="msg-row msg-row-assistant" aria-label="Open LOUMOO Combi, the shopping assistant">
        <span class="msg-avatar msg-avatar-ai" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>
        </span>
        <span class="msg-row-main">
          <span class="msg-row-top">
            <span class="msg-row-name">LOUMOO Combi</span>
            <span class="msg-tag">Assistant</span>
          </span>
          <span class="msg-row-preview">Find products for your budget and city</span>
        </span>
      </button>

      <!-- Signed out -->
      <sc-if value="{{ !convSignedIn && !convAuthPending }}">
        <div class="msg-state">
          <span class="msg-state-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>
          </span>
          <h2 class="msg-state-title">Talk to boutiques directly</h2>
          <p class="msg-state-text">Sign in to ask about products, delivery and prices, and to answer your own buyers.</p>
          <div class="msg-state-actions">
            <button onClick="{{ signIn }}" class="msg-btn-primary">Sign in</button>
            <button onClick="{{ on.onboardWelcome }}" class="msg-btn-ghost">Create account</button>
          </div>
        </div>
      </sc-if>

      <!-- First load -->
      <sc-if value="{{ convLoadingFirst || convAuthPending }}">
        <div class="msg-skeleton" aria-busy="true" aria-label="Loading conversations">
          <div class="msg-skel-row"><span class="msg-skel-avatar"></span><span class="msg-skel-lines"><span></span><span></span></span></div>
          <div class="msg-skel-row"><span class="msg-skel-avatar"></span><span class="msg-skel-lines"><span></span><span></span></span></div>
          <div class="msg-skel-row"><span class="msg-skel-avatar"></span><span class="msg-skel-lines"><span></span><span></span></span></div>
        </div>
      </sc-if>

      <sc-if value="{{ convSignedIn && convError }}">
        <div class="msg-state msg-state-compact" role="alert">
          <p class="msg-state-text">{{ convError }}</p>
          <button onClick="{{ retryConversations }}" class="msg-btn-ghost">Try again</button>
        </div>
      </sc-if>

      <sc-if value="{{ convSignedIn && !convLoadingFirst && !convError }}">
        <sc-if value="{{ convHasRows }}">
          <ul class="msg-list">
            <sc-for list="{{ convRows }}" as="row">
              <li>
                <button onClick="{{ row.open }}" class="msg-row {{ row.active ? 'is-active' : '' }} {{ row.hasUnread ? 'is-unread' : '' }}" aria-label="{{ row.ariaLabel }}" aria-current="{{ row.active ? 'true' : 'false' }}">
                  <span class="msg-avatar" aria-hidden="true">
                    <sc-if value="{{ row.hasAvatar }}"><img src="{{ row.avatarUrl }}" alt="" loading="lazy"></sc-if>
                    <sc-if value="{{ !row.hasAvatar }}">{{ row.initials }}</sc-if>
                  </span>
                  <span class="msg-row-main">
                    <span class="msg-row-top">
                      <span class="msg-row-name">{{ row.title }}</span>
                      <sc-if value="{{ row.verified }}">
                        <svg class="msg-verified" width="15" height="15" viewBox="0 0 24 24" aria-label="Verified boutique" role="img"><path fill="currentColor" d="M12 1.5l2.6 1.9 3.2-.1 1 3 2.6 1.9-1 3.1 1 3.1-2.6 1.9-1 3-3.2-.1L12 22.5l-2.6-1.9-3.2.1-1-3-2.6-1.9 1-3.1-1-3.1 2.6-1.9 1-3 3.2.1z"/><path d="m8 12.2 2.7 2.6L16.2 9.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      </sc-if>
                      <span class="msg-row-time">{{ row.timeLabel }}</span>
                    </span>
                    <sc-if value="{{ row.context }}"><span class="msg-row-context">{{ row.context }}</span></sc-if>
                    <span class="msg-row-bottom">
                      <sc-if value="{{ row.showTick }}">
                        <svg class="msg-tick {{ row.tickRead ? 'is-read' : '' }}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="{{ row.tickRead ? 'Read' : 'Sent' }}" role="img"><path d="m2 12.5 4.5 4.5L15 8.5"/><sc-if value="{{ row.tickRead }}"><path d="m10 16.5.5.5L21 6.5"/></sc-if></svg>
                      </sc-if>
                      <span class="msg-row-preview {{ row.previewIsCard ? 'is-card' : '' }}">{{ row.preview }}</span>
                      <sc-if value="{{ row.hasUnread }}"><span class="msg-badge" aria-hidden="true">{{ row.unreadLabel }}</span></sc-if>
                    </span>
                  </span>
                </button>
              </li>
            </sc-for>
          </ul>
        </sc-if>
        <sc-if value="{{ !convHasRows }}">
          <div class="msg-state">
            <span class="msg-state-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M8.5 11.5h7M8.5 14.5h4"/></svg>
            </span>
            <h2 class="msg-state-title">{{ convEmptyTitle }}</h2>
            <p class="msg-state-text">{{ convEmptyText }}</p>
            <sc-if value="{{ convShowBrowse }}">
              <div class="msg-state-actions"><button onClick="{{ on.home }}" class="msg-btn-primary">Browse products</button></div>
            </sc-if>
          </div>
        </sc-if>
      </sc-if>
    </div>
  </section>

  <!-- ── Thread pane ── -->
  <section class="msg-thread" aria-label="Conversation">
    <sc-if value="{{ is.chat }}">
      <div class="msg-thread-placeholder msg-only-wide">
        <span class="msg-state-icon" aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>
        </span>
        <p class="msg-state-text">Choose a conversation to read it here.</p>
      </div>
    </sc-if>

    <sc-if value="{{ is.threadSeller }}">
      <header class="msg-thread-head">
        <button onClick="{{ closeThread }}" class="msg-icon-btn msg-back" aria-label="Back to messages">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          <sc-if value="{{ messagingHasUnread }}"><span class="msg-back-count">{{ messagingBadge }}</span></sc-if>
        </button>
        <span class="msg-avatar msg-avatar-sm" aria-hidden="true">
          <sc-if value="{{ threadHasAvatar }}"><img src="{{ threadAvatarUrl }}" alt=""></sc-if>
          <sc-if value="{{ !threadHasAvatar }}">{{ threadInitials }}</sc-if>
        </span>
        <div class="msg-thread-id">
          <h2 class="msg-thread-title" tabindex="-1" id="msgThreadTitle">
            <span>{{ threadTitle }}</span>
            <sc-if value="{{ threadVerified }}">
              <svg class="msg-verified" width="15" height="15" viewBox="0 0 24 24" aria-label="Verified boutique" role="img"><path fill="currentColor" d="M12 1.5l2.6 1.9 3.2-.1 1 3 2.6 1.9-1 3.1 1 3.1-2.6 1.9-1 3-3.2-.1L12 22.5l-2.6-1.9-3.2.1-1-3-2.6-1.9 1-3.1-1-3.1 2.6-1.9 1-3 3.2.1z"/><path d="m8 12.2 2.7 2.6L16.2 9.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </sc-if>
          </h2>
          <sc-if value="{{ threadSubtitle }}"><div class="msg-thread-sub">{{ threadSubtitle }}</div></sc-if>
        </div>
        <sc-if value="{{ threadIsBuyer && threadCanWhatsApp }}">
          <button onClick="{{ continueOnWhatsApp }}" class="msg-icon-btn msg-wa" aria-label="Continue on WhatsApp" title="Continue on WhatsApp">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2a9.9 9.9 0 0 0-8.5 15l-1.4 5 5.1-1.3A9.9 9.9 0 1 0 12.04 2Zm0 18.1a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3a8.2 8.2 0 1 1 6.9 3.8Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"/></svg>
          </button>
        </sc-if>
      </header>

      <div class="msg-scroll" ref="{{ setThreadScroller }}">
        <sc-if value="{{ threadHasMore }}">
          <div class="msg-older">
            <button onClick="{{ loadOlderMessages }}" class="msg-btn-text" disabled="{{ threadLoadingOlder }}">{{ threadLoadingOlder ? 'Loading…' : 'Load earlier messages' }}</button>
          </div>
        </sc-if>

        <sc-if value="{{ threadLoadingFirst }}">
          <div class="msg-thread-loading" aria-busy="true" aria-label="Loading messages">
            <span class="msg-skel-bubble"></span>
            <span class="msg-skel-bubble is-mine"></span>
            <span class="msg-skel-bubble is-short"></span>
          </div>
        </sc-if>

        <sc-if value="{{ threadErrorText }}">
          <div class="msg-state msg-state-compact" role="alert">
            <p class="msg-state-text">{{ threadErrorText }}</p>
            <button onClick="{{ retryThread }}" class="msg-btn-ghost">Try again</button>
          </div>
        </sc-if>

        <sc-if value="{{ threadEmpty }}">
          <div class="msg-thread-empty">
            <span class="msg-avatar msg-avatar-lg" aria-hidden="true">
              <sc-if value="{{ threadHasAvatar }}"><img src="{{ threadAvatarUrl }}" alt=""></sc-if>
              <sc-if value="{{ !threadHasAvatar }}">{{ threadInitials }}</sc-if>
            </span>
            <div class="msg-thread-empty-title">{{ threadTitle }}</div>
            <p class="msg-state-text">{{ threadEmptyText }}</p>
          </div>
        </sc-if>

        <ol class="msg-log" role="log" aria-live="polite" aria-relevant="additions" aria-label="Messages">
          <sc-for list="{{ threadItems }}" as="it">
            <sc-if value="{{ it.isDay }}">
              <li class="msg-day"><span>{{ it.dayLabel }}</span></li>
            </sc-if>
            <sc-if value="{{ !it.isDay }}">
              <li class="msg-item {{ it.mine ? 'is-mine' : 'is-theirs' }} {{ it.runStart ? 'run-start' : '' }} {{ it.runEnd ? 'run-end' : '' }} {{ it.pending ? 'is-pending' : '' }} {{ it.failed ? 'is-failed' : '' }}">
                <sc-if value="{{ it.isText }}">
                  <div class="msg-bubble">{{ it.body }}</div>
                </sc-if>
                <sc-if value="{{ it.isCard }}">
                  <button onClick="{{ it.openCard }}" class="msg-card" aria-label="{{ it.cardAction }}: {{ it.cardTitle }}">
                    <sc-if value="{{ it.hasCardImage }}"><img class="msg-card-img" src="{{ it.cardImage }}" alt="" loading="lazy"></sc-if>
                    <sc-if value="{{ !it.hasCardImage }}">
                      <span class="msg-card-img msg-card-img-empty" aria-hidden="true">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/></svg>
                      </span>
                    </sc-if>
                    <span class="msg-card-body">
                      <span class="msg-card-kicker">{{ it.cardKicker }}</span>
                      <span class="msg-card-title">{{ it.cardTitle }}</span>
                      <sc-if value="{{ it.cardMeta }}"><span class="msg-card-meta">{{ it.cardMeta }}</span></sc-if>
                      <span class="msg-card-link">{{ it.cardAction }}</span>
                    </span>
                  </button>
                </sc-if>
                <sc-if value="{{ it.failed }}">
                  <div class="msg-failed" role="alert">
                    <span>{{ it.errorText }}</span>
                    <button onClick="{{ it.retry }}" class="msg-btn-text">Retry</button>
                    <button onClick="{{ it.discard }}" class="msg-btn-text is-muted">Delete</button>
                  </div>
                </sc-if>
                <sc-if value="{{ it.runEnd && !it.failed }}">
                  <div class="msg-meta">
                    <span>{{ it.timeLabel }}</span>
                    <sc-if value="{{ it.showTick }}">
                      <svg class="msg-tick {{ it.read ? 'is-read' : '' }}" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="{{ it.read ? 'Read' : 'Sent' }}" role="img"><path d="m2 12.5 4.5 4.5L15 8.5"/><sc-if value="{{ it.read }}"><path d="m10 16.5.5.5L21 6.5"/></sc-if></svg>
                    </sc-if>
                  </div>
                </sc-if>
              </li>
            </sc-if>
          </sc-for>
        </ol>
      </div>

      <footer class="msg-composer">
        <div class="msg-composer-field">
          <textarea id="msgComposer" rows="1" value="{{ threadDraft }}" onInput="{{ updateThreadDraft }}" onKeyDown="{{ threadKeyDown }}" placeholder="Message" aria-label="Write a message" maxlength="2000" enterkeyhint="send"></textarea>
          <sc-if value="{{ threadDraftNearLimit }}"><span class="msg-count" aria-live="polite">{{ threadDraftCount }}</span></sc-if>
        </div>
        <button onClick="{{ sendThreadMessage }}" class="msg-send" disabled="{{ !threadCanSend }}" aria-label="Send message">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
        </button>
      </footer>
    </sc-if>
  </section>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     AI SHOPPING ASSISTANT (is.threadAi)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.threadAi }}">
""" + get_combi_view() + """
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     NOTIFICATIONS FEED (is.notifications)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.notifications }}">
<div style="padding-bottom:32px">
  <div class="page-head" style="display:flex;align-items:center;justify-content:space-between">
    <div style="display:flex;align-items:center;gap:12px">
      <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <h4 style="margin:0;font-size:16px">Notifications</h4>
    </div>
    <sc-if value="{{ notifHasUnread }}">
      <button onClick="{{ markNotifsRead }}" style="border:none;background:transparent;color:var(--color-accent);font:700 12px/1 var(--font-heading);cursor:pointer">Mark all read</button>
    </sc-if>
  </div>

  <sc-if value="{{ !notifHasItems }}">
    <div style="padding:72px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px">
      <div style="width:64px;height:64px;border-radius:50%;background:var(--color-surface-subtle);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted)">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
      </div>
      <h3 style="margin:0;font-size:17px">You're all caught up</h3>
      <p style="font-size:13px;color:var(--color-text-secondary);max-width:280px;margin:0">Updates about your orders, deliveries and trips will show up here.</p>
    </div>
  </sc-if>

  <sc-if value="{{ notifHasItems }}">
  <div style="padding:16px;max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:10px">
    <sc-for list="{{ notifList }}" as="ntf">
    <div class="card-premium" style="padding:14px 16px;display:flex;gap:12px;align-items:flex-start;{{ ntf.read ? 'opacity:0.68' : '' }}">
      <span style="width:8px;height:8px;border-radius:50%;margin-top:5px;flex-shrink:0;background:{{ ntf.read ? 'var(--color-neutral-300)' : ntf.toneColor }}"></span>
      <div style="flex:1;min-width:0">
        <div style="font:700 13px/1.2 var(--font-heading);color:{{ ntf.read ? 'var(--color-text)' : ntf.toneColor }}">{{ ntf.title }}</div>
        <div style="font:400 12px/1.35 var(--font-body);color:var(--color-text-secondary);margin-top:4px">{{ ntf.body }}</div>
        <div style="font:500 10px/1 var(--font-body);color:var(--color-text-muted);margin-top:6px">{{ ntf.dateLabel }}</div>
        <!-- A delivery or order notification opens the screen it is about, for
             whichever part you play in it: buyer, seller, rider or administrator. -->
        <sc-if value="{{ ntf.canOpen }}">
          <button onClick="{{ ntf.open }}" class="btn btn-secondary btn-sm" style="margin-top:10px;height:40px;padding:0 16px;font-size:12px;font-weight:700">{{ ntf.openLabel }}</button>
        </sc-if>
      </div>
    </div>
    </sc-for>
  </div>
  </sc-if>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     UPGRADED USER PROFILE PORTAL (is.profile)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.profile }}">
<div class="prof-page">

  <header class="prof-head">
    <button onClick="{{ back }}" aria-label="Go back" class="prof-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
    </button>
    <button onClick="{{ on.settings }}" aria-label="Open settings" class="prof-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    </button>
  </header>

  <div class="prof-body">

    <!-- Onboarding entry (unauthenticated) -->
    <sc-if value="{{ showGetStarted }}">
    <div class="prof-cta">
      <span class="prof-cta-kicker">Get started</span>
      <h2 class="prof-cta-title">Create your LOUMOO account.</h2>
      <p class="prof-cta-text">Escrow checkout, a verified storefront, real-time parcel tracking, and deals picked for you across Cameroon.</p>
      <div class="prof-cta-actions">
        <button onClick="{{ on.onboardWelcome }}" class="prof-btn-dark">Get started</button>
        <button onClick="{{ signIn }}" class="prof-btn-ghost">Sign in</button>
      </div>
    </div>
    </sc-if>

    <!-- Identity -->
    <section class="prof-identity">
      <button onClick="{{ pickAvatar }}" class="prof-avatar user-avatar" aria-label="Change profile photo">
        <sc-if value="{{ hasUserAvatar }}"><img src="{{ userAvatar }}" alt="Profile photo"></sc-if>
        <sc-if value="{{ !hasUserAvatar }}"><span class="prof-avatar-initials">{{ userInitials }}</span></sc-if>
        <span class="prof-avatar-cam" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3.2"/></svg>
        </span>
      </button>
      <sc-if value="{{ hasUserAvatar }}"><button onClick="{{ removeAvatar }}" class="prof-avatar-remove">Remove photo</button></sc-if>
      <div class="prof-name-row">
        <h1 class="prof-name">{{ userName }}</h1>
        <span class="prof-role">{{ profileRoleLabel }}</span>
      </div>
      <div class="prof-sub">{{ userPhoneCity }}</div>
      <button onClick="{{ openEditProfile }}" class="prof-edit">Edit profile</button>
      <div class="prof-complete">
        <div class="prof-complete-bar"><span style="width:{{ completionScore }}%"></span></div>
        <span class="prof-complete-label">{{ completionScore }}% complete</span>
      </div>
    </section>

    <!-- Dedicated Boutique / Storefront Card -->
    <sc-if value="{{ hasOwnStore }}">
    <div class="card-premium" style="margin-top:16px;padding:18px 20px;background:var(--color-surface);border:1px solid var(--color-divider);border-radius:var(--radius-lg);position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--color-accent),#008060)"></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px">
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font:800 11px/1 var(--font-heading);letter-spacing:0.06em;color:var(--color-accent);text-transform:uppercase">My Boutique Storefront</span>
            <span class="tag {{ sellerStatus === 'READY' ? 'tag-accent' : 'tag-neutral' }}" style="font-size:10px;font-weight:700;padding:2px 8px">
              {{ sellerStatus === 'READY' ? 'ACTIVE &amp; LIVE' : 'ONBOARDING' }}
            </span>
          </div>
          <h3 style="margin:6px 0 2px;font:800 18px/1.2 var(--font-heading);color:var(--color-text)">{{ currentStoreName }}</h3>
          <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary)">{{ currentStoreCategoryLabel }} · Verified Merchant</div>
        </div>
        <div style="width:44px;height:44px;border-radius:var(--radius-md);background:var(--color-surface-subtle);border:1px solid var(--color-divider);display:flex;align-items:center;justify-content:center;color:var(--color-accent);flex-shrink:0">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><circle cx="12" cy="12" r="2"/></svg>
        </div>
      </div>

      <!-- Public storefront link preview bar -->
      <div style="background:var(--color-surface-subtle);border:1px solid var(--color-divider);border-radius:var(--radius-sm);padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--color-text-muted);flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <span style="font:600 12px/1 var(--font-body);color:var(--color-text);text-overflow:ellipsis;white-space:nowrap;overflow:hidden">loumoo.cm/s/{{ currentStoreSlug || 'store' }}</span>
        </div>
        <button onClick="{{ openPublicStorefront }}" class="tag tag-accent" style="cursor:pointer;font-size:10.5px;font-weight:700;padding:3px 10px;flex-shrink:0">
          Preview ↗
        </button>
      </div>

      <!-- Store CTA buttons -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <button onClick="{{ on.seller }}" class="btn btn-primary" style="height:38px;font-size:12px;font-weight:700;gap:6px;cursor:pointer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>
          SELLER STUDIO →
        </button>
        <button onClick="{{ openStoreSettings }}" class="btn btn-secondary" style="height:38px;font-size:12px;font-weight:600;gap:6px;cursor:pointer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          Settings
        </button>
      </div>
    </div>
    </sc-if>

    <!-- Merchant Entry when user does NOT have a boutique -->
    <sc-if value="{{ !hasOwnStore }}">
    <div class="card-premium" style="margin-top:16px;padding:18px 20px;background:var(--color-surface);border:1px dashed var(--color-divider);border-radius:var(--radius-lg);display:flex;align-items:center;justify-content:space-between;gap:14px">
      <div style="flex:1;min-width:0">
        <div style="font:800 11px/1 var(--font-heading);letter-spacing:0.06em;color:var(--color-accent);text-transform:uppercase">Start Selling</div>
        <h3 style="margin:4px 0 4px;font:700 15px/1.3 var(--font-heading);color:var(--color-text)">Open Your LOUMOO Boutique</h3>
        <p style="margin:0;font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary)">Sell products, services or rooms across Cameroon with verified merchant status and escrow protection.</p>
      </div>
      <button onClick="{{ openCreateStore }}" class="btn btn-primary" style="height:38px;padding:0 16px;font-size:12px;font-weight:700;flex-shrink:0;cursor:pointer">
        + OPEN BOUTIQUE
      </button>
    </div>
    </sc-if>

    <!-- Quick tiles -->
    <div class="prof-tiles">
      <button onClick="{{ on.orders }}" aria-label="Go to My Orders" class="prof-tile">
        <span class="prof-tile-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
        </span>
        <span class="prof-tile-title">Orders</span>
        <span class="prof-tile-sub">{{ activeDeliveriesLabel }}</span>
      </button>

      <button onClick="{{ on.saved }}" aria-label="Go to Saved Items" class="prof-tile">
        <span class="prof-tile-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </span>
        <span class="prof-tile-title">Saved</span>
        <span class="prof-tile-sub">{{ savedItemsLabel }}</span>
      </button>

      <button onClick="{{ on.transactions }}" aria-label="Go to Escrow Ledger" class="prof-tile">
        <span class="prof-tile-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
        </span>
        <span class="prof-tile-title">Escrow</span>
        <span class="prof-tile-sub">Payments &amp; payouts</span>
      </button>

      <button onClick="{{ on.seller }}" aria-label="Go to Seller Studio" class="prof-tile">
        <span class="prof-tile-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>
        </span>
        <span class="prof-tile-title">Seller Studio</span>
        <span class="prof-tile-sub">Merchant workspace</span>
      </button>
    </div>

    <!-- Settings entry -->
    <button onClick="{{ on.settings }}" class="prof-row">
      <span class="prof-row-text">Settings &amp; preferences</span>
      <span class="prof-row-chevron" aria-hidden="true">→</span>
    </button>

  </div>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     SAVED WISHLIST (is.saved)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.saved }}">
<div style="padding-bottom:32px">
  <div class="page-head">
    <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
    </button>
    <h4 style="margin:0;font-size:16px">Saved Items</h4>
  </div>

  <!-- Empty state -->
  <sc-if value="{{ !wishlistHasItems }}">
    <div style="padding:72px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px">
      <div style="width:72px;height:72px;border-radius:50%;background:var(--color-surface-subtle);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted)">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      </div>
      <div>
        <h3 style="margin:0 0 6px;font-size:18px">No saved items yet</h3>
        <p style="font-size:13.5px;line-height:1.5;color:var(--color-text-secondary);max-width:300px;margin:0 auto">Tap the bookmark on any product and it will be kept here for later.</p>
      </div>
      <button onClick="{{ on.home }}" class="btn btn-primary" style="height:44px;padding:0 24px;font-size:13.5px;font-weight:700">Browse the marketplace</button>
    </div>
  </sc-if>

  <!-- Saved products -->
  <sc-if value="{{ wishlistHasItems }}">
  <div style="padding:16px;max-width:800px;margin:0 auto;display:flex;flex-direction:column;gap:12px">
    <div style="font:600 12px/1 var(--font-body);color:var(--color-text-secondary);padding:0 2px">{{ wishlistCountLabel }}</div>
    <sc-for list="{{ wishlistItems }}" as="item">
      <div class="card-premium" style="display:flex;align-items:center;gap:14px">
        <div onClick="{{ () => openProduct(item.id) }}" style="width:64px;height:64px;border-radius:var(--radius-sm);overflow:hidden;flex-shrink:0;background:var(--color-surface-subtle);cursor:pointer">
          <img src="{{ item.image }}" alt="{{ item.name }}" style="width:100%;height:100%;object-fit:cover">
        </div>
        <div onClick="{{ () => openProduct(item.id) }}" style="flex:1;cursor:pointer">
          <div style="font:700 13.5px/1.2 var(--font-heading);color:var(--color-text)">{{ item.name }}</div>
          <div style="font:800 14px/1 var(--font-heading);color:var(--color-accent);margin-top:3px">{{ item.price }}</div>
          <div style="font:400 11px/1 var(--font-body);color:var(--color-text-secondary);margin-top:4px">Sold by {{ item.store || 'LOUMOO seller' }}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button onClick="{{ () => openProduct(item.id) }}" class="btn btn-primary" style="height:34px;padding:0 14px;font-size:11px">VIEW</button>
          <button onClick="{{ () => toggleProductWishlist(item.id, item.name) }}" class="btn btn-secondary" style="height:28px;padding:0 8px;font-size:10px;color:var(--color-text-muted)">REMOVE</button>
        </div>
      </div>
    </sc-for>
  </div>
  </sc-if>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     SETTINGS & ACCOUNT CONTROL CENTER (is.settings) — PHASE C
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.settings }}">
<div style="padding-bottom:32px">
  <div class="page-head">
    <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text);cursor:pointer;flex-shrink:0">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
    </button>
    <h4 style="margin:0;font-size:16px;flex:1">Account Settings</h4>
  </div>

  <div style="padding:16px;max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:16px">

    <!-- 1. PROFILE SECTION -->
    <div class="card-premium" style="display:flex;flex-direction:column;padding:4px 16px">
      <div style="font:700 11px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-muted);text-transform:uppercase;padding:14px 0 6px">Profile &amp; Identity</div>
      <button onClick="{{ openEditProfile }}" style="border:none;border-bottom:1px solid var(--color-divider);background:transparent;text-align:left;padding:12px 0;display:flex;align-items:center;justify-content:space-between;cursor:pointer">
        <div>
          <div style="font:600 13.5px/1.2 var(--font-heading);color:var(--color-text)">Edit Personal Profile</div>
          <div style="font:400 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">{{ regFirstName }} {{ regLastName }} · {{ regCity }}</div>
        </div>
        <span style="color:var(--color-text-muted)">→</span>
      </button>
      <button onClick="{{ openAccountDashboard }}" style="border:none;background:transparent;text-align:left;padding:12px 0;display:flex;align-items:center;justify-content:space-between;cursor:pointer">
        <div>
          <div style="font:600 13.5px/1.2 var(--font-heading);color:var(--color-text)">Account Hub &amp; Verification</div>
          <div style="font:400 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Completion score, escrow status &amp; shortcuts</div>
        </div>
        <span style="color:var(--color-text-muted)">→</span>
      </button>
    </div>

    <!-- 2. COMMERCE & ORDERS SECTION -->
    <div class="card-premium" style="display:flex;flex-direction:column;padding:4px 16px">
      <div style="font:700 11px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-muted);text-transform:uppercase;padding:14px 0 6px">Commerce &amp; Activity</div>
      <button onClick="{{ openAddresses }}" style="border:none;border-bottom:1px solid var(--color-divider);background:transparent;text-align:left;padding:12px 0;display:flex;align-items:center;justify-content:space-between;cursor:pointer">
        <div>
          <div style="font:600 13.5px/1.2 var(--font-heading);color:var(--color-text)">Saved Delivery Addresses</div>
          <div style="font:400 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Manage Douala, Yaoundé &amp; regional destinations</div>
        </div>
        <span style="color:var(--color-text-muted)">→</span>
      </button>
      <button onClick="{{ openPurchases }}" style="border:none;border-bottom:1px solid var(--color-divider);background:transparent;text-align:left;padding:12px 0;display:flex;align-items:center;justify-content:space-between;cursor:pointer">
        <div>
          <div style="font:600 13.5px/1.2 var(--font-heading);color:var(--color-text)">Purchase History &amp; Orders</div>
          <div style="font:400 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Active shipments, receipts &amp; escrow tracking</div>
        </div>
        <span style="color:var(--color-text-muted)">→</span>
      </button>
      <button onClick="{{ openFollowedStores }}" style="border:none;border-bottom:1px solid var(--color-divider);background:transparent;text-align:left;padding:12px 0;display:flex;align-items:center;justify-content:space-between;cursor:pointer">
        <div>
          <div style="font:600 13.5px/1.2 var(--font-heading);color:var(--color-text)">Followed Boutiques</div>
          <div style="font:400 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Verified sellers &amp; flash product alerts</div>
        </div>
        <span style="color:var(--color-text-muted)">→</span>
      </button>
      <button onClick="{{ openActivity }}" style="border:none;background:transparent;text-align:left;padding:12px 0;display:flex;align-items:center;justify-content:space-between;cursor:pointer">
        <div>
          <div style="font:600 13.5px/1.2 var(--font-heading);color:var(--color-text)">Activity Log</div>
          <div style="font:400 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Timeline of your account operations</div>
        </div>
        <span style="color:var(--color-text-muted)">→</span>
      </button>
    </div>

    <!-- 3. PREFERENCES SECTION -->
    <div class="card-premium" style="display:flex;flex-direction:column;padding:4px 16px">
      <div style="font:700 11px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-muted);text-transform:uppercase;padding:14px 0 6px">Preferences</div>
      <button onClick="{{ openNotifPrefs }}" style="border:none;border-bottom:1px solid var(--color-divider);background:transparent;text-align:left;padding:12px 0;display:flex;align-items:center;justify-content:space-between;cursor:pointer">
        <div>
          <div style="font:600 13.5px/1.2 var(--font-heading);color:var(--color-text)">Notification Channels &amp; Events</div>
          <div style="font:400 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">In-app, SMS, email &amp; order updates</div>
        </div>
        <span style="color:var(--color-text-muted)">→</span>
      </button>
      <button onClick="{{ openPrivacy }}" style="border:none;border-bottom:1px solid var(--color-divider);background:transparent;text-align:left;padding:12px 0;display:flex;align-items:center;justify-content:space-between;cursor:pointer">
        <div>
          <div style="font:600 13.5px/1.2 var(--font-heading);color:var(--color-text)">Privacy &amp; Data Controls</div>
          <div style="font:400 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Personalization &amp; analytics consent</div>
        </div>
        <span style="color:var(--color-text-muted)">→</span>
      </button>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0">
        <div>
          <div style="font:600 13.5px/1 var(--font-heading);color:var(--color-text)">Dark Mode (Obsidian Tech)</div>
          <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">High contrast theme for OLED screens</div>
        </div>
        <button onClick="{{ toggleDark }}" aria-label="Toggle dark mode" style="border:none;background:transparent;padding:0;cursor:pointer">
          <div style="display:flex;align-items:center;background:var(--color-neutral-300);border-radius:14px;width:44px;height:24px;padding:2px;box-sizing:border-box">
            <div style="width:20px;height:20px;background:var(--color-bg);border-radius:50%;box-shadow:var(--shadow-sm);transform:translateX({{ darkMode ? '20px' : '0' }});transition:transform 0.2s"></div>
          </div>
        </button>
      </div>
    </div>

    <!-- 4. SECURITY SECTION -->
    <div class="card-premium" style="display:flex;flex-direction:column;padding:4px 16px">
      <div style="font:700 11px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-muted);text-transform:uppercase;padding:14px 0 6px">Security &amp; Access</div>
      <button onClick="{{ openSecurity }}" style="border:none;border-bottom:1px solid var(--color-divider);background:transparent;text-align:left;padding:12px 0;display:flex;align-items:center;justify-content:space-between;cursor:pointer">
        <div>
          <div style="font:600 13.5px/1.2 var(--font-heading);color:var(--color-text)">Active Sessions &amp; Devices</div>
          <div style="font:400 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Manage logged-in smartphones &amp; browsers</div>
        </div>
        <span style="color:var(--color-text-muted)">→</span>
      </button>
      <button onClick="{{ on.forgotPassword }}" style="border:none;background:transparent;text-align:left;padding:12px 0;display:flex;align-items:center;justify-content:space-between;cursor:pointer">
        <div>
          <div style="font:600 13.5px/1.2 var(--font-heading);color:var(--color-text)">Password &amp; Security Keys</div>
          <div style="font:400 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Update your LOUMOO password</div>
        </div>
        <span style="color:var(--color-text-muted)">→</span>
      </button>
    </div>

    <!-- 5. SUPPORT & HELP -->
    <div class="card-premium" style="display:flex;flex-direction:column;padding:4px 16px">
      <div style="font:700 11px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-muted);text-transform:uppercase;padding:14px 0 6px">Support &amp; Assistance</div>
      <button onClick="{{ on.threadAi }}" style="border:none;border-bottom:1px solid var(--color-divider);background:transparent;text-align:left;padding:12px 0;font:600 13px/1 var(--font-body);color:var(--color-text);display:flex;justify-content:space-between;cursor:pointer">
        <span>Ask LOUMOO Combi</span>
        <span style="color:var(--color-text-muted)">→</span>
      </button>
      <button onClick="{{ on.chat }}" style="border:none;background:transparent;text-align:left;padding:12px 0;font:600 13px/1 var(--font-body);color:var(--color-text);display:flex;justify-content:space-between;cursor:pointer">
        <span>WhatsApp Customer Care (Cameroon)</span>
        <span style="color:var(--color-text-muted)">→</span>
      </button>
    </div>

    <!-- 6. DANGER ZONE -->
    <div class="card-premium" style="display:flex;flex-direction:column;padding:4px 16px;border-color:var(--color-accent-sale)">
      <div style="font:700 11px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-accent-sale);text-transform:uppercase;padding:14px 0 6px">Danger Zone</div>
      <button onClick="{{ openDeleteAccount }}" style="border:none;background:transparent;text-align:left;padding:12px 0;display:flex;align-items:center;justify-content:space-between;cursor:pointer">
        <div>
          <div style="font:600 13.5px/1.2 var(--font-heading);color:var(--color-accent-sale)">Delete Account</div>
          <div style="font:400 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Permanently remove profile and credentials</div>
        </div>
        <span style="color:var(--color-accent-sale)">→</span>
      </button>
    </div>

    <!-- 7. SESSION SIGN OUT -->
    <button onClick="{{ signOut }}" class="btn btn-secondary btn-block" style="height:46px;color:var(--color-accent-sale);border-color:var(--color-accent-sale);cursor:pointer">
      SIGN OUT OF LOUMOO
    </button>

  </div>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     OFFLINE ERROR STATE (is.networkError)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.networkError }}">
<div style="padding:48px 16px;max-width:540px;margin:0 auto;text-align:center">
  <div style="width:64px;height:64px;border-radius:50%;background:var(--color-neutral-200);color:var(--color-text);display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m2 2 20 20M8.5 8.5c3.5-3.5 9-3.5 12.5 0M12 12c1.5-1.5 4-1.5 5.5 0M16 16c0-1.5-1-1.5-1.5-1.5M5 5c-1.5 1.5-2.5 3.5-2.5 5.5"/></svg>
  </div>
  <h3 style="margin:0 0 8px;font-size:22px">You're Offline</h3>
  <p style="font-size:13.5px;color:var(--color-text-secondary);margin:0 auto 20px">Check your mobile data or Wi-Fi connection and retry.</p>
  <button onClick="{{ back }}" class="btn btn-primary btn-block" style="height:44px">RETRY CONNECTION</button>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     SKELETON SHIMMER LOADING (is.loading)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.loading }}">
<div style="padding:16px;max-width:960px;margin:0 auto;display:flex;flex-direction:column;gap:16px">
  <div class="skel" style="height:44px;border-radius:var(--radius-pill)"></div>
  <div class="home-grid">
    <div class="skel skel-card"></div>
    <div class="skel skel-card"></div>
    <div class="skel skel-card"></div>
    <div class="skel skel-card"></div>
  </div>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     NO PAGE FOR THIS URL (is.notFound)
     Rendered by the URL router (src/services/appRouter.js, docs/ROUTING.md) in
     place of a blank or broken page: an address no route matches, a record that
     does not exist or is not yours, an area the account may not open, or a named
     area that has not been built yet. The visitor's address is left untouched.
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.notFound }}">
<div role="alert" data-testid="route-state" data-route-state="{{ notFoundKind }}" style="padding:56px 16px;max-width:540px;margin:0 auto;text-align:center">
  <div aria-hidden="true" style="width:64px;height:64px;border-radius:50%;background:var(--color-neutral-200);color:var(--color-text);display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M8.5 8.5l5 5M13.5 8.5l-5 5"/></svg>
  </div>
  <h3 data-testid="route-state-title" style="margin:0 0 8px;font-size:22px">{{ notFoundTitle }}</h3>
  <p data-testid="route-state-message" style="font-size:13.5px;color:var(--color-text-secondary);margin:0 auto 12px">{{ notFoundMessage }}</p>
  <sc-if value="{{ notFoundPath }}">
    <p style="font-size:12px;color:var(--color-text-secondary);margin:0 auto 20px;word-break:break-all"><code>{{ notFoundPath }}</code></p>
  </sc-if>
  <div style="display:flex;flex-direction:column;gap:10px;align-items:stretch">
    <sc-if value="{{ notFoundIsError }}">
      <button onClick="{{ on.notFoundReload }}" class="btn btn-primary btn-block" style="height:44px">TRY AGAIN</button>
    </sc-if>
    <sc-if value="{{ notFoundIsForbidden }}">
      <button onClick="{{ on.notFoundSignIn }}" class="btn btn-secondary btn-block" style="height:44px">SIGN IN WITH ANOTHER ACCOUNT</button>
    </sc-if>
    <button onClick="{{ on.notFoundMarketplace }}" class="btn btn-primary btn-block" style="height:44px">BROWSE THE MARKETPLACE</button>
    <button onClick="{{ on.notFoundHome }}" class="btn btn-secondary btn-block" style="height:44px">GO TO THE HOMEPAGE</button>
    <button onClick="{{ on.notFoundBack }}" style="border:none;background:transparent;padding:10px;font:700 12px/1 var(--font-heading);color:var(--color-text-secondary);cursor:pointer">Go back</button>
  </div>
</div>
</sc-if>
"""
