# -*- coding: utf-8 -*-
"""
LOUMOO MESSAGING, PROFILE & SYSTEM VIEWS
WhatsApp messaging engine, voice note waveform player, LOUMOO Combi assistant, notifications, upgraded user profile with onboarding entry point, saved items, settings, and skeleton states with Lucide SVG icons.
"""

from .search_shared import get_combi_view

def get_chat_and_profile_view():
    return """
<!-- ══════════════════════════════════════════════════════════════════════════
     WHATSAPP DISCUSSIONS HUB (is.chat)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.chat }}">
<div style="padding-bottom:32px">
  
  <div class="page-head" style="justify-content:space-between">
    <div style="display:flex;align-items:center;gap:12px">
      <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <div>
        <h4 style="margin:0;font-size:16px">Discussions</h4>
        <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary)">WhatsApp-verified merchant &amp; AI chats</div>
      </div>
    </div>
  </div>

  <div style="padding:16px;max-width:800px;margin:0 auto">
    
    <!-- Filter Tabs -->
    <div class="hs" style="gap:8px;margin-bottom:16px">
      <button class="tag tag-accent">All (4)</button>
      <button class="tag tag-neutral">Buying (2)</button>
      <button class="tag tag-neutral">Selling (1)</button>
      <button class="tag tag-neutral">Support</button>
    </div>

    <!-- Chat Threads List -->
    <div style="display:flex;flex-direction:column;gap:8px">
      
      <!-- Thread 1: Mr Toukam / Orca Electronics -->
      <button onClick="{{ on.threadSeller }}" aria-label="Open conversation with Mr Toukam" class="card-premium" style="display:flex;align-items:center;gap:14px;padding:14px 16px;text-align:left;cursor:pointer">
        <div style="width:46px;height:46px;border-radius:50%;background:var(--color-wa-teal);color:#fff;display:flex;align-items:center;justify-content:center;font:800 16px/1 var(--font-heading);flex-shrink:0">T</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font:800 14.5px/1.2 var(--font-heading);color:var(--color-text)">Mr Toukam (Orca Electronics)</span>
            <span style="font:500 11px/1 var(--font-body);color:var(--color-accent)">11:46</span>
          </div>
          <div style="font:400 12.5px/1.4 var(--font-body);color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px;display:flex;align-items:center;gap:4px">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
            <span>Voice message (0:05) · "The unit is ready for delivery..."</span>
          </div>
        </div>
        <span style="width:18px;height:18px;border-radius:50%;background:var(--color-wa-green);color:#fff;display:flex;align-items:center;justify-content:center;font:800 10px/1 var(--font-heading);flex-shrink:0">2</span>
      </button>

      <!-- Thread 2: LOUMOO Combi Assistant -->
      <button onClick="{{ on.threadAi }}" aria-label="Open conversation with LOUMOO Combi" class="card-premium" style="display:flex;align-items:center;gap:14px;padding:14px 16px;text-align:left;cursor:pointer">
        <div style="width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,var(--color-accent),#003d8a);color:#fff;display:flex;align-items:center;justify-content:center;font:800 14px/1 var(--font-heading);flex-shrink:0">AI</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font:800 14.5px/1.2 var(--font-heading);color:var(--color-text)">LOUMOO Combi</span>
            <span style="font:500 11px/1 var(--font-body);color:var(--color-text-muted)">11:41</span>
          </div>
          <div style="font:400 12.5px/1.4 var(--font-body);color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px">
            Ask a question or find options for your budget and city.
          </div>
        </div>
      </button>

    </div>

  </div>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     WHATSAPP CONVERSATION THREAD (is.threadSeller)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.threadSeller }}">
<div class="wa-chat-container">
  
  <!-- WhatsApp Top Header -->
  <div class="wa-chat-header">
    <div style="display:flex;align-items:center;gap:10px">
      <button onClick="{{ on.chat }}" aria-label="Return to chat list" style="border:none;background:transparent;padding:4px;color:var(--color-text);cursor:pointer">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <div style="width:38px;height:38px;border-radius:50%;background:#607d8b;color:#fff;display:flex;align-items:center;justify-content:center;font:800 14px/1 var(--font-heading)">T</div>
      <div>
        <div style="font:700 14px/1.1 var(--font-heading);color:var(--color-text)">Mr Toukam · Orca</div>
        <div style="font:400 10.5px/1 var(--font-body);color:var(--color-wa-teal);margin-top:2px">online</div>
      </div>
    </div>
    <button onClick="{{ on.product }}" class="btn btn-secondary" style="height:32px;padding:0 12px;font-size:11px;border-radius:var(--radius-pill)">VIEW PRODUCT</button>
  </div>

  <!-- Messages Body -->
  <div class="wa-chat-body">
    
    <div style="align-self:center;background:rgba(255,255,255,0.9);box-shadow:0 1px 2px rgba(0,0,0,0.08);border-radius:6px;padding:4px 12px;font-size:11px;color:#54656f">
      TODAY
    </div>

    <!-- Message 1 (User) -->
    <div style="display:flex;justify-content:flex-end">
      <div class="wa-bubble-sent">
        Hello Mr Toukam, is the MacBook Air M2 13” 256GB sealed in box and ready for delivery to Bonanjo?
        <div style="font-size:9.5px;color:#667781;float:right;margin-left:8px;margin-top:4px">11:42 ✓✓</div>
      </div>
    </div>

    <!-- Message 2 (Seller Voice Note) -->
    <div style="display:flex;justify-content:flex-start">
      <div class="wa-audio-card">
        <button aria-label="Play voice note" style="border:none;background:transparent;padding:0;color:var(--color-text);cursor:pointer">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
        <div style="flex:1">
          <div class="wa-waveform-container">
            <span class="wa-bar played" style="height:8px"></span>
            <span class="wa-bar played" style="height:14px"></span>
            <span class="wa-bar played" style="height:18px"></span>
            <span class="wa-bar played" style="height:12px"></span>
            <span class="wa-audio-dot"></span>
            <span class="wa-bar" style="height:16px"></span>
            <span class="wa-bar" style="height:20px"></span>
            <span class="wa-bar" style="height:14px"></span>
            <span class="wa-bar" style="height:10px"></span>
            <span class="wa-bar" style="height:16px"></span>
            <span class="wa-bar" style="height:18px"></span>
            <span class="wa-bar" style="height:12px"></span>
            <span class="wa-bar" style="height:8px"></span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:#667781;margin-top:2px">
            <span>0:05</span>
            <span>11:44</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Message 3 (Seller Text) -->
    <div style="display:flex;justify-content:flex-start">
      <div class="wa-bubble-received">
        Yes brother, 100% sealed Apple official warranty. You can order via escrow and we dispatch with our rider right now!
        <div style="font-size:9.5px;color:#667781;float:right;margin-left:8px;margin-top:4px">11:45</div>
      </div>
    </div>

  </div>

  <!-- WhatsApp Bottom Input Bar -->
  <div class="wa-input-bar">
    <input type="text" class="wa-input-box" placeholder="Type a message or question…">
    <button aria-label="Send message" style="width:38px;height:38px;border-radius:50%;border:none;background:var(--color-wa-teal);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
    </button>
  </div>

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
"""
