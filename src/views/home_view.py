# -*- coding: utf-8 -*-
"""
LOUMOO MASTER HOME MARKETPLACE HUB (is.home)
World-class mobile-first discovery and infinite commerce hub combining Apple spatial precision with Insta360 visual storytelling.
"""

from .search_shared import get_search_suggestions

def get_home_view():
    return """
<!-- ══════════════════════════════════════════════════════════════════════════
     LOUMOO MASTER HOME MARKETPLACE HUB (is.home)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.home }}" hint-placeholder-val="{{ true }}">
<div class="home-hub-container" style="padding:12px 0 48px">

  <!-- ── 01: MOBILE TOP HEADER & UNIVERSAL SEARCH BAR ── -->
  <div style="padding:0 16px 14px">
    <!-- User Context Bar (Mobile-Responsive Header) -->
    <div class="home-user-context-bar">
      <sc-if value="{{ isLoggedIn }}">
        <div class="home-user-context-left">
          <button onClick="{{ on.profile }}" aria-label="Open profile" class="user-avatar" style="width:40px;height:40px;border:2px solid var(--color-text);border-radius:var(--radius-sm);background:var(--color-surface);display:flex;align-items:center;justify-content:center;font:800 14px/1 var(--font-heading);letter-spacing:-.02em;padding:0;color:var(--color-text);box-shadow:var(--shadow-xs);cursor:pointer;flex-shrink:0"><sc-if value="{{ hasUserAvatar }}"><img src="{{ userAvatar }}" alt=""></sc-if><sc-if value="{{ !hasUserAvatar }}">{{ userInitials }}</sc-if></button>
          <div class="home-user-context-greeting">
            <div style="font:700 8.5px/1 var(--font-heading);letter-spacing:.14em;color:var(--color-text-muted);text-transform:uppercase">WELCOME BACK</div>
            <div class="home-user-context-name">{{ userName }}</div>
          </div>
        </div>
      </sc-if>
      <sc-if value="{{ !isLoggedIn }}">
        <div class="home-user-context-left">
          <div style="width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,var(--color-accent),#003d8a);color:#fff;display:flex;align-items:center;justify-content:center;font:800 14px/1 var(--font-heading);letter-spacing:-.02em;flex-shrink:0">LM</div>
          <div class="home-user-context-greeting">
            <div style="font:700 8.5px/1 var(--font-heading);letter-spacing:.14em;color:var(--color-accent);text-transform:uppercase">LOUMOO</div>
            <div class="home-user-context-name" style="font-size:16px">Marketplace Hub</div>
          </div>
          <button onClick="{{ on.signIn }}" class="btn btn-secondary" style="height:30px;padding:0 10px;font-size:10.5px;font-weight:800;border-radius:var(--radius-pill);cursor:pointer;flex-shrink:0">SIGN IN</button>
        </div>
      </sc-if>
      <div class="home-user-context-actions">
        <button onClick="{{ toggleDark }}" aria-label="Toggle dark and light mode" title="{{ darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode' }}" class="home-header-btn">
          <sc-if value="{{ darkMode }}">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          </sc-if>
          <sc-if value="{{ !darkMode }}">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          </sc-if>
        </button>
        <button onClick="{{ on.saved }}" aria-label="Open saved wishlist" title="Wishlist" class="home-header-btn" style="color:{{ wishlistHasItems ? 'var(--color-accent-sale)' : 'var(--color-text)' }}">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="{{ wishlistHasItems ? 'currentColor' : 'none' }}" stroke="currentColor" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          <sc-if value="{{ wishlistHasItems }}"><span style="position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--color-accent-sale);color:#fff;font:800 9.5px/16px var(--font-heading);text-align:center">{{ wishlistCount }}</span></sc-if>
        </button>
        <button onClick="{{ on.cart }}" aria-label="Open bag" class="home-header-btn">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
          <span style="position:absolute;top:-2px;right:-2px;min-width:16px;height:16px;border-radius:8px;background:var(--color-accent);color:#fff;font:800 9.5px/16px var(--font-heading);text-align:center;padding:0 3px">{{ cartCount }}</span>
        </button>
        <button onClick="{{ on.notifications }}" aria-label="Open notifications" class="home-header-btn">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
          <sc-if value="{{ notifHasUnread }}"><span style="position:absolute;top:1px;right:1px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;background:var(--color-accent-sale);color:#fff;font:800 9px/15px var(--font-heading);text-align:center">{{ notifBadgeLabel }}</span></sc-if>
        </button>
      </div>
    </div>

    <!-- ── LIQUID-GLASS REFINED SEARCH BAR CAPSULE (Reference Design) ── -->
    <div class="liquid-search-bar" role="search">
      <!-- 1. [Scan] Button -->
      <button onClick="{{ on.visual }}" aria-label="Visual camera search" title="Visual Camera Search" class="lsb-scan-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 8V5a1 1 0 0 1 1-1h3"/>
          <path d="M16 4h3a1 1 0 0 1 1 1v3"/>
          <path d="M4 16v3a1 1 0 0 0 1 1h3"/>
          <path d="M16 20h3a1 1 0 0 0 1-1v-3"/>
          <line x1="8" y1="12" x2="16" y2="12" stroke-width="2.2"/>
        </svg>
      </button>

      <!-- 2. [Filter] Button -->
      <button onClick="{{ on.filters }}" aria-label="Search filters" title="Filters" class="lsb-filter-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="7" x2="20" y2="7"/>
          <line x1="4" y1="12" x2="20" y2="12"/>
          <line x1="4" y1="17" x2="14" y2="17"/>
          <circle cx="17" cy="17" r="2" fill="currentColor"/>
        </svg>
        <svg class="lsb-filter-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.75"><path d="m6 9 6 6 6-6"/></svg>
      </button>

      <!-- 3. [Search input + search icon] (Dominant Center Element) -->
      <div class="lsb-search-wrap">
        <input type="search" class="lsb-search-input" value="{{ searchQuery }}" onInput="{{ handleSearchInput }}" onKeyDown="{{ handleHubSearchKey }}" placeholder="Search anything..." aria-label="Search products, stores, services" enterkeyhint="search" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="{{ searchExpanded }}" aria-controls="search-suggestions" aria-activedescendant="{{ searchActiveOption }}" onFocus="{{ searchFocus }}" onBlur="{{ searchBlur }}" onCompositionStart="{{ searchCompositionStart }}" onCompositionEnd="{{ searchCompositionEnd }}" maxlength="200">
        <button onClick="{{ submitSearch }}" class="lsb-search-icon" aria-label="Search" title="Search">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>
        </button>
""" + get_search_suggestions() + """
      </div>

      <!-- 4. [Microphone] Button -->
      <button onClick="{{ on.voice }}" aria-label="Voice search mode" title="Voice Search" class="lsb-mic-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
        </svg>
      </button>

      <!-- 5. [Chat] Button -->
      <button onClick="{{ on.chat }}" aria-label="Open AI and seller chat" title="Chat" class="lsb-chat-btn">
        <span>Chat</span>
      </button>
    </div>
  </div>

  <div style="padding:0 16px">

    <!-- ── 02: CINEMATIC HERO / FEATURED PRODUCT SHOWCASE ── -->
    <div class="hero-cinematic-banner">
      <!-- Background Ambient Glow & Cinematic Scene Elements -->
      <div style="position:absolute;top:-40px;right:-40px;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle, rgba(0,122,255,0.08) 0%, transparent 70%);pointer-events:none"></div>
      <div style="position:absolute;bottom:-60px;left:10%;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle, rgba(255,209,0,0.06) 0%, transparent 70%);pointer-events:none"></div>

      <!-- Slide 0: Samsung Galaxy S24 Ultra (Video) -->
      <sc-if value="{{ isHeroSlide0 }}" hint-placeholder-val="{{ true }}">
        <div class="hero-slide-pane" style="background:#f4f4f6" data-hero-slide="0">
          <div class="hero-grid-layout">
            <div class="hero-text-wrap">
              <div style="font:800 13px/1 var(--font-heading);letter-spacing:0.06em;text-transform:uppercase;color:#007aff;margin-bottom:8px">Samsung Galaxy Flagship</div>
              <h1 style="margin:0 0 10px;font-size:clamp(28px, 4.2vw, 44px);font-weight:800;letter-spacing:-.035em;line-height:1.06;color:#111214">Galaxy S24 Ultra.</h1>
              <div style="font:500 clamp(13px, 1.8vw, 15.5px)/1.45 var(--font-body);color:#475569;margin-bottom:22px;max-width:400px">Titanium elegance. 200MP Quad Telephoto and built-in Galaxy AI. Peak mobile performance in Cameroon.</div>
              <div class="hero-actions-row">
                <button onClick="{{ () => openProduct('samsung_s24_ultra') }}" class="hero-btn-pill" style="background:#111214;color:#fff">Explore Galaxy S24 →</button>
                <button onClick="{{ on.store }}" class="hero-btn-subtle" style="border:1px solid rgba(0,0,0,0.15);color:#111214">Official Store</button>
              </div>
            </div>

            <div class="hero-media-wrap" style="background:transparent">
              <video src="./Assets/LOUMOO%20VIDEOS/HeroBanner/From%20Klickpin.com-%20Aesthetic%20Stretching%20Routine%20Ideas%20for%20This%20Year-pin-id-958000151963779036.mp4" poster="./Assets/_processed/herobanner_stretching.jpg" autoplay muted="true" defaultMuted="true" playsinline preload="metadata"></video>
            </div>
          </div>
          <div class="hero-dots-row">
            <button onClick="{{ setHeroSlide0 }}" class="hero-dot active" aria-label="Slide 1 — Galaxy S24 Ultra"></button>
            <button onClick="{{ setHeroSlide1 }}" class="hero-dot" aria-label="Slide 2 — Royal Gele Couture"></button>
            <button onClick="{{ setHeroSlide2 }}" class="hero-dot" aria-label="Slide 3 — Botanical Radiance Serum"></button>
            <button onClick="{{ setHeroSlide3 }}" class="hero-dot" aria-label="Slide 4 — Urban Striker Kit"></button>
            <button onClick="{{ setHeroSlide4 }}" class="hero-dot" aria-label="Slide 5 — Heavyweight Cotton Tee"></button>
            <button onClick="{{ setHeroSlide5 }}" class="hero-dot" aria-label="Slide 6 — Titanium Minimalist Watch"></button>
            <button onClick="{{ setHeroSlide6 }}" class="hero-dot" aria-label="Slide 7 — MateBook Pro Ultrathin"></button>
            <button onClick="{{ setHeroSlide7 }}" class="hero-dot" aria-label="Slide 8 — DIVINY Noble Fragrance"></button>
            <button onClick="{{ setHeroSlide8 }}" class="hero-dot" aria-label="Slide 9 — SoundPulse 360° Studio"></button>
            <button onClick="{{ setHeroSlide9 }}" class="hero-dot" aria-label="Slide 10 — Ivory Structured Handbag"></button>
          </div>
        </div>
      </sc-if>

      <!-- Slide 1: Royal Gele & Silk Couture (Image) -->
      <sc-if value="{{ isHeroSlide1 }}">
        <div class="hero-slide-pane" style="background:#161113" data-hero-slide="1">
          <div class="hero-grid-layout">
            <div class="hero-text-wrap">
              <div style="font:800 13px/1 var(--font-heading);letter-spacing:0.06em;text-transform:uppercase;color:#e5a93c;margin-bottom:8px">Haute Couture Cameroun</div>
              <h1 style="margin:0 0 10px;font-size:clamp(28px, 4.2vw, 44px);font-weight:800;letter-spacing:-.035em;line-height:1.06;color:#ffffff">Royal Gele & Silk.</h1>
              <div style="font:500 clamp(13px, 1.8vw, 15.5px)/1.45 var(--font-body);color:rgba(255,255,255,0.82);margin-bottom:22px;max-width:400px">Bespoke ceremonial Gele headwear and celebratory silk attire handcrafted by Douala master artisans.</div>
              <div class="hero-actions-row">
                <button onClick="{{ () => openCategory('fashion') }}" class="hero-btn-pill" style="background:#ffffff;color:#111214">Discover Collection →</button>
                <button onClick="{{ () => openCategory('fashion') }}" class="hero-btn-subtle" style="border:1px solid rgba(255,255,255,0.3);color:#ffffff">Bespoke Designers</button>
              </div>
            </div>

            <div class="hero-media-wrap" style="background:transparent">
              <img src="./Assets/LOUMOO%20VIDEOS/HeroBanner/316377942597787941.jfif" alt="Royal African Gele & Silk Couture" loading="lazy" />
            </div>
          </div>
          <div class="hero-dots-row hero-dots-light">
            <button onClick="{{ setHeroSlide0 }}" class="hero-dot" aria-label="Slide 1 — Galaxy S24 Ultra"></button>
            <button onClick="{{ setHeroSlide1 }}" class="hero-dot active" aria-label="Slide 2 — Royal Gele Couture"></button>
            <button onClick="{{ setHeroSlide2 }}" class="hero-dot" aria-label="Slide 3 — Botanical Radiance Serum"></button>
            <button onClick="{{ setHeroSlide3 }}" class="hero-dot" aria-label="Slide 4 — Urban Striker Kit"></button>
            <button onClick="{{ setHeroSlide4 }}" class="hero-dot" aria-label="Slide 5 — Heavyweight Cotton Tee"></button>
            <button onClick="{{ setHeroSlide5 }}" class="hero-dot" aria-label="Slide 6 — Titanium Minimalist Watch"></button>
            <button onClick="{{ setHeroSlide6 }}" class="hero-dot" aria-label="Slide 7 — MateBook Pro Ultrathin"></button>
            <button onClick="{{ setHeroSlide7 }}" class="hero-dot" aria-label="Slide 8 — DIVINY Noble Fragrance"></button>
            <button onClick="{{ setHeroSlide8 }}" class="hero-dot" aria-label="Slide 9 — SoundPulse 360° Studio"></button>
            <button onClick="{{ setHeroSlide9 }}" class="hero-dot" aria-label="Slide 10 — Ivory Structured Handbag"></button>
          </div>
        </div>
      </sc-if>

      <!-- Slide 2: Botanical Radiance Skincare Serum (Video) -->
      <sc-if value="{{ isHeroSlide2 }}">
        <div class="hero-slide-pane" style="background:#c5bbae" data-hero-slide="2">
          <div class="hero-grid-layout">
            <div class="hero-text-wrap">
              <div style="font:800 13px/1 var(--font-heading);letter-spacing:0.06em;text-transform:uppercase;color:#5c432d;margin-bottom:8px">Glow & Botanical Wellness</div>
              <h1 style="margin:0 0 10px;font-size:clamp(28px, 4.2vw, 44px);font-weight:800;letter-spacing:-.035em;line-height:1.06;color:#231812">Botanical Radiance.</h1>
              <div style="font:500 clamp(13px, 1.8vw, 15.5px)/1.45 var(--font-body);color:#524338;margin-bottom:22px;max-width:400px">Cold-pressed organic elixir with pure active botanicals. Deep cellular hydration and natural luminous glow.</div>
              <div class="hero-actions-row">
                <button onClick="{{ () => openCategory('supermarket') }}" class="hero-btn-pill" style="background:#231812;color:#ffffff">Shop Beauty Elixir →</button>
                <button onClick="{{ () => openCategory('supermarket') }}" class="hero-btn-subtle" style="border:1px solid rgba(35,24,18,0.25);color:#231812">Organic Routine</button>
              </div>
            </div>

            <div class="hero-media-wrap" style="background:transparent">
              <video src="./Assets/LOUMOO%20VIDEOS/HeroBanner/From%20Klickpin.com-%2093%20Trending%20Passive%20Income%20Ideas%20for%20Right%20Now-pin-id-1142084786777854743.mp4" poster="./Assets/_processed/herobanner_passive_income.jpg" autoplay muted="true" defaultMuted="true" playsinline preload="metadata"></video>
            </div>
          </div>
          <div class="hero-dots-row">
            <button onClick="{{ setHeroSlide0 }}" class="hero-dot" aria-label="Slide 1 — Galaxy S24 Ultra"></button>
            <button onClick="{{ setHeroSlide1 }}" class="hero-dot" aria-label="Slide 2 — Royal Gele Couture"></button>
            <button onClick="{{ setHeroSlide2 }}" class="hero-dot active" aria-label="Slide 3 — Botanical Radiance Serum"></button>
            <button onClick="{{ setHeroSlide3 }}" class="hero-dot" aria-label="Slide 4 — Urban Striker Kit"></button>
            <button onClick="{{ setHeroSlide4 }}" class="hero-dot" aria-label="Slide 5 — Heavyweight Cotton Tee"></button>
            <button onClick="{{ setHeroSlide5 }}" class="hero-dot" aria-label="Slide 6 — Titanium Minimalist Watch"></button>
            <button onClick="{{ setHeroSlide6 }}" class="hero-dot" aria-label="Slide 7 — MateBook Pro Ultrathin"></button>
            <button onClick="{{ setHeroSlide7 }}" class="hero-dot" aria-label="Slide 8 — DIVINY Noble Fragrance"></button>
            <button onClick="{{ setHeroSlide8 }}" class="hero-dot" aria-label="Slide 9 — SoundPulse 360° Studio"></button>
            <button onClick="{{ setHeroSlide9 }}" class="hero-dot" aria-label="Slide 10 — Ivory Structured Handbag"></button>
          </div>
        </div>
      </sc-if>

      <!-- Slide 3: Urban Striker Jersey & Retro Shades (Image) -->
      <sc-if value="{{ isHeroSlide3 }}">
        <div class="hero-slide-pane" style="background:#4a5258" data-hero-slide="3">
          <div class="hero-grid-layout">
            <div class="hero-text-wrap">
              <div style="font:800 13px/1 var(--font-heading);letter-spacing:0.06em;text-transform:uppercase;color:#fbbf24;margin-bottom:8px">Streetwear Culture Drop</div>
              <h1 style="margin:0 0 10px;font-size:clamp(28px, 4.2vw, 44px);font-weight:800;letter-spacing:-.035em;line-height:1.06;color:#ffffff">Urban Striker Kit.</h1>
              <div style="font:500 clamp(13px, 1.8vw, 15.5px)/1.45 var(--font-body);color:rgba(255,255,255,0.88);margin-bottom:22px;max-width:400px">Limited-edition striped heritage football jersey paired with tinted retro frames. Street-ready statement piece.</div>
              <div class="hero-actions-row">
                <button onClick="{{ () => openCategory('fashion') }}" class="hero-btn-pill" style="background:#ffffff;color:#111214">Shop Streetwear Drop →</button>
                <button onClick="{{ () => openCategory('fashion') }}" class="hero-btn-subtle" style="border:1px solid rgba(255,255,255,0.3);color:#ffffff">View Lookbook</button>
              </div>
            </div>

            <div class="hero-media-wrap" style="background:transparent">
              <img src="./Assets/LOUMOO%20VIDEOS/HeroBanner/593278950954729077.jfif" alt="Urban Striker Jersey & Retro Shades" loading="lazy" />
            </div>
          </div>
          <div class="hero-dots-row hero-dots-light">
            <button onClick="{{ setHeroSlide0 }}" class="hero-dot" aria-label="Slide 1 — Galaxy S24 Ultra"></button>
            <button onClick="{{ setHeroSlide1 }}" class="hero-dot" aria-label="Slide 2 — Royal Gele Couture"></button>
            <button onClick="{{ setHeroSlide2 }}" class="hero-dot" aria-label="Slide 3 — Botanical Radiance Serum"></button>
            <button onClick="{{ setHeroSlide3 }}" class="hero-dot active" aria-label="Slide 4 — Urban Striker Kit"></button>
            <button onClick="{{ setHeroSlide4 }}" class="hero-dot" aria-label="Slide 5 — Heavyweight Cotton Tee"></button>
            <button onClick="{{ setHeroSlide5 }}" class="hero-dot" aria-label="Slide 6 — Titanium Minimalist Watch"></button>
            <button onClick="{{ setHeroSlide6 }}" class="hero-dot" aria-label="Slide 7 — MateBook Pro Ultrathin"></button>
            <button onClick="{{ setHeroSlide7 }}" class="hero-dot" aria-label="Slide 8 — DIVINY Noble Fragrance"></button>
            <button onClick="{{ setHeroSlide8 }}" class="hero-dot" aria-label="Slide 9 — SoundPulse 360° Studio"></button>
            <button onClick="{{ setHeroSlide9 }}" class="hero-dot" aria-label="Slide 10 — Ivory Structured Handbag"></button>
          </div>
        </div>
      </sc-if>

      <!-- Slide 4: Heavyweight Minimalist Cotton Tee (Video) -->
      <sc-if value="{{ isHeroSlide4 }}">
        <div class="hero-slide-pane" style="background:#eeedec" data-hero-slide="4">
          <div class="hero-grid-layout">
            <div class="hero-text-wrap">
              <div style="font:800 13px/1 var(--font-heading);letter-spacing:0.06em;text-transform:uppercase;color:#059669;margin-bottom:8px">Minimalist Essentials</div>
              <h1 style="margin:0 0 10px;font-size:clamp(28px, 4.2vw, 44px);font-weight:800;letter-spacing:-.035em;line-height:1.06;color:#111214">Heavyweight Cotton Tee.</h1>
              <div style="font:500 clamp(13px, 1.8vw, 15.5px)/1.45 var(--font-body);color:#475569;margin-bottom:22px;max-width:400px">300 GSM combed organic cotton. Impeccable drape, reinforced neckline, and breathable softness for everyday luxury.</div>
              <div class="hero-actions-row">
                <button onClick="{{ () => openCategory('fashion') }}" class="hero-btn-pill" style="background:#111214;color:#ffffff">Explore Essentials →</button>
                <button onClick="{{ () => openCategory('fashion') }}" class="hero-btn-subtle" style="border:1px solid rgba(0,0,0,0.15);color:#111214">Size & Fit Guide</button>
              </div>
            </div>

            <div class="hero-media-wrap" style="background:transparent">
              <video src="./Assets/LOUMOO%20VIDEOS/HeroBanner/From%20Klickpin.com-%20Discover%20Unique%20rustic%20wedding%20decor%20for%20your%20next%20Pinterest%20save%20built%20around%20ideas%20that%20are%20easy%20to%20save%20and%20revisit%20later-pi.mp4" poster="./Assets/_processed/herobanner_rustic_wedding.jpg" autoplay muted="true" defaultMuted="true" playsinline preload="metadata"></video>
            </div>
          </div>
          <div class="hero-dots-row">
            <button onClick="{{ setHeroSlide0 }}" class="hero-dot" aria-label="Slide 1 — Galaxy S24 Ultra"></button>
            <button onClick="{{ setHeroSlide1 }}" class="hero-dot" aria-label="Slide 2 — Royal Gele Couture"></button>
            <button onClick="{{ setHeroSlide2 }}" class="hero-dot" aria-label="Slide 3 — Botanical Radiance Serum"></button>
            <button onClick="{{ setHeroSlide3 }}" class="hero-dot" aria-label="Slide 4 — Urban Striker Kit"></button>
            <button onClick="{{ setHeroSlide4 }}" class="hero-dot active" aria-label="Slide 5 — Heavyweight Cotton Tee"></button>
            <button onClick="{{ setHeroSlide5 }}" class="hero-dot" aria-label="Slide 6 — Titanium Minimalist Watch"></button>
            <button onClick="{{ setHeroSlide6 }}" class="hero-dot" aria-label="Slide 7 — MateBook Pro Ultrathin"></button>
            <button onClick="{{ setHeroSlide7 }}" class="hero-dot" aria-label="Slide 8 — DIVINY Noble Fragrance"></button>
            <button onClick="{{ setHeroSlide8 }}" class="hero-dot" aria-label="Slide 9 — SoundPulse 360° Studio"></button>
            <button onClick="{{ setHeroSlide9 }}" class="hero-dot" aria-label="Slide 10 — Ivory Structured Handbag"></button>
          </div>
        </div>
      </sc-if>

      <!-- Slide 5: Minimalist Titanium Chronometer (Image) -->
      <sc-if value="{{ isHeroSlide5 }}">
        <div class="hero-slide-pane" style="background:#2b2b2c" data-hero-slide="5">
          <div class="hero-grid-layout">
            <div class="hero-text-wrap">
              <div style="font:800 13px/1 var(--font-heading);letter-spacing:0.06em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px">Swiss Automatic Horology</div>
              <h1 style="margin:0 0 10px;font-size:clamp(28px, 4.2vw, 44px);font-weight:800;letter-spacing:-.035em;line-height:1.06;color:#ffffff">Titanium Minimalist.</h1>
              <div style="font:500 clamp(13px, 1.8vw, 15.5px)/1.45 var(--font-body);color:rgba(255,255,255,0.85);margin-bottom:22px;max-width:400px">Aeronautical-grade brushed titanium case, sapphire crystal glass, and self-winding automatic movement. Timeless precision engineering.</div>
              <div class="hero-actions-row">
                <button onClick="{{ () => openCategory('fashion') }}" class="hero-btn-pill" style="background:#ffffff;color:#111214">Explore Horology →</button>
                <button onClick="{{ () => openCategory('fashion') }}" class="hero-btn-subtle" style="border:1px solid rgba(255,255,255,0.3);color:#ffffff">Automatic Caliber</button>
              </div>
            </div>

            <div class="hero-media-wrap" style="background:transparent">
              <img src="./Assets/LOUMOO%20VIDEOS/HeroBanner/hero_luxury_watch.jpg" alt="Titanium Minimalist Automatic Timepiece" loading="lazy" />
            </div>
          </div>
          <div class="hero-dots-row hero-dots-light">
            <button onClick="{{ setHeroSlide0 }}" class="hero-dot" aria-label="Slide 1 — Galaxy S24 Ultra"></button>
            <button onClick="{{ setHeroSlide1 }}" class="hero-dot" aria-label="Slide 2 — Royal Gele Couture"></button>
            <button onClick="{{ setHeroSlide2 }}" class="hero-dot" aria-label="Slide 3 — Botanical Radiance Serum"></button>
            <button onClick="{{ setHeroSlide3 }}" class="hero-dot" aria-label="Slide 4 — Urban Striker Kit"></button>
            <button onClick="{{ setHeroSlide4 }}" class="hero-dot" aria-label="Slide 5 — Heavyweight Cotton Tee"></button>
            <button onClick="{{ setHeroSlide5 }}" class="hero-dot active" aria-label="Slide 6 — Titanium Minimalist Watch"></button>
            <button onClick="{{ setHeroSlide6 }}" class="hero-dot" aria-label="Slide 7 — MateBook Pro Ultrathin"></button>
            <button onClick="{{ setHeroSlide7 }}" class="hero-dot" aria-label="Slide 8 — DIVINY Noble Fragrance"></button>
            <button onClick="{{ setHeroSlide8 }}" class="hero-dot" aria-label="Slide 9 — SoundPulse 360° Studio"></button>
            <button onClick="{{ setHeroSlide9 }}" class="hero-dot" aria-label="Slide 10 — Ivory Structured Handbag"></button>
          </div>
        </div>
      </sc-if>

      <!-- Slide 6: MateBook Pro Ultrathin (Image) -->
      <sc-if value="{{ isHeroSlide6 }}">
        <div class="hero-slide-pane" style="background:#cbdfee" data-hero-slide="6">
          <div class="hero-grid-layout">
            <div class="hero-text-wrap">
              <div style="font:800 13px/1 var(--font-heading);letter-spacing:0.06em;text-transform:uppercase;color:#0284c7;margin-bottom:8px">Ultra-Portable Workstations</div>
              <h1 style="margin:0 0 10px;font-size:clamp(28px, 4.2vw, 44px);font-weight:800;letter-spacing:-.035em;line-height:1.06;color:#0f172a">MateBook Pro Ultrathin.</h1>
              <div style="font:500 clamp(13px, 1.8vw, 15.5px)/1.45 var(--font-body);color:#334155;margin-bottom:22px;max-width:400px">3.1K OLED Real Color Touch Display, Intel Core Ultra computing, and 18-hour battery in a featherlight 980g magnesium chassis.</div>
              <div class="hero-actions-row">
                <button onClick="{{ () => openCategory('electronics') }}" class="hero-btn-pill" style="background:#0f172a;color:#ffffff">Explore MateBook →</button>
                <button onClick="{{ () => openCategory('electronics') }}" class="hero-btn-subtle" style="border:1px solid rgba(15,23,42,0.25);color:#0f172a">Intel Core Ultra</button>
              </div>
            </div>

            <div class="hero-media-wrap" style="background:transparent">
              <img src="./Assets/LOUMOO%20VIDEOS/HeroBanner/hero_ultrabook_laptops.jpg" alt="MateBook Pro Ultrathin Laptops" loading="lazy" />
            </div>
          </div>
          <div class="hero-dots-row">
            <button onClick="{{ setHeroSlide0 }}" class="hero-dot" aria-label="Slide 1 — Galaxy S24 Ultra"></button>
            <button onClick="{{ setHeroSlide1 }}" class="hero-dot" aria-label="Slide 2 — Royal Gele Couture"></button>
            <button onClick="{{ setHeroSlide2 }}" class="hero-dot" aria-label="Slide 3 — Botanical Radiance Serum"></button>
            <button onClick="{{ setHeroSlide3 }}" class="hero-dot" aria-label="Slide 4 — Urban Striker Kit"></button>
            <button onClick="{{ setHeroSlide4 }}" class="hero-dot" aria-label="Slide 5 — Heavyweight Cotton Tee"></button>
            <button onClick="{{ setHeroSlide5 }}" class="hero-dot" aria-label="Slide 6 — Titanium Minimalist Watch"></button>
            <button onClick="{{ setHeroSlide6 }}" class="hero-dot active" aria-label="Slide 7 — MateBook Pro Ultrathin"></button>
            <button onClick="{{ setHeroSlide7 }}" class="hero-dot" aria-label="Slide 8 — DIVINY Noble Fragrance"></button>
            <button onClick="{{ setHeroSlide8 }}" class="hero-dot" aria-label="Slide 9 — SoundPulse 360° Studio"></button>
            <button onClick="{{ setHeroSlide9 }}" class="hero-dot" aria-label="Slide 10 — Ivory Structured Handbag"></button>
          </div>
        </div>
      </sc-if>

      <!-- Slide 7: DIVINY Noble Presence Luxury Perfume (Image) -->
      <sc-if value="{{ isHeroSlide7 }}">
        <div class="hero-slide-pane" style="background:#180102" data-hero-slide="7">
          <div class="hero-grid-layout">
            <div class="hero-text-wrap">
              <div style="font:800 13px/1 var(--font-heading);letter-spacing:0.06em;text-transform:uppercase;color:#f43f5e;margin-bottom:8px">Haute Parfumerie Edition</div>
              <h1 style="margin:0 0 10px;font-size:clamp(28px, 4.2vw, 44px);font-weight:800;letter-spacing:-.035em;line-height:1.06;color:#ffffff">DIVINY Noble Presence.</h1>
              <div style="font:500 clamp(13px, 1.8vw, 15.5px)/1.45 var(--font-body);color:rgba(255,255,255,0.85);margin-bottom:22px;max-width:400px">Rare saffron, smoky Atlas cedarwood, and rich Bourbon vanilla in an artisan crystal flacon. An enduring signature of nobility.</div>
              <div class="hero-actions-row">
                <button onClick="{{ () => openCategory('supermarket') }}" class="hero-btn-pill" style="background:#ffffff;color:#111214">Shop Divine Fragrance →</button>
                <button onClick="{{ () => openCategory('supermarket') }}" class="hero-btn-subtle" style="border:1px solid rgba(255,255,255,0.3);color:#ffffff">Artisan Notes</button>
              </div>
            </div>

            <div class="hero-media-wrap" style="background:transparent">
              <img src="./Assets/LOUMOO%20VIDEOS/HeroBanner/hero_diviny_perfume.jpg" alt="DIVINY Noble Presence Luxury Perfume" loading="lazy" />
            </div>
          </div>
          <div class="hero-dots-row hero-dots-light">
            <button onClick="{{ setHeroSlide0 }}" class="hero-dot" aria-label="Slide 1 — Galaxy S24 Ultra"></button>
            <button onClick="{{ setHeroSlide1 }}" class="hero-dot" aria-label="Slide 2 — Royal Gele Couture"></button>
            <button onClick="{{ setHeroSlide2 }}" class="hero-dot" aria-label="Slide 3 — Botanical Radiance Serum"></button>
            <button onClick="{{ setHeroSlide3 }}" class="hero-dot" aria-label="Slide 4 — Urban Striker Kit"></button>
            <button onClick="{{ setHeroSlide4 }}" class="hero-dot" aria-label="Slide 5 — Heavyweight Cotton Tee"></button>
            <button onClick="{{ setHeroSlide5 }}" class="hero-dot" aria-label="Slide 6 — Titanium Minimalist Watch"></button>
            <button onClick="{{ setHeroSlide6 }}" class="hero-dot" aria-label="Slide 7 — MateBook Pro Ultrathin"></button>
            <button onClick="{{ setHeroSlide7 }}" class="hero-dot active" aria-label="Slide 8 — DIVINY Noble Fragrance"></button>
            <button onClick="{{ setHeroSlide8 }}" class="hero-dot" aria-label="Slide 9 — SoundPulse 360° Studio"></button>
            <button onClick="{{ setHeroSlide9 }}" class="hero-dot" aria-label="Slide 10 — Ivory Structured Handbag"></button>
          </div>
        </div>
      </sc-if>

      <!-- Slide 8: SoundPulse 360° Studio Speaker (Image) -->
      <sc-if value="{{ isHeroSlide8 }}">
        <div class="hero-slide-pane" style="background:#26304d" data-hero-slide="8">
          <div class="hero-grid-layout">
            <div class="hero-text-wrap">
              <div style="font:800 13px/1 var(--font-heading);letter-spacing:0.06em;text-transform:uppercase;color:#38bdf8;margin-bottom:8px">Immersive 360° Wireless Audio</div>
              <h1 style="margin:0 0 10px;font-size:clamp(28px, 4.2vw, 44px);font-weight:800;letter-spacing:-.035em;line-height:1.06;color:#ffffff">SoundPulse 360° Studio.</h1>
              <div style="font:500 clamp(13px, 1.8vw, 15.5px)/1.45 var(--font-body);color:rgba(255,255,255,0.85);margin-bottom:22px;max-width:400px">40W dual stereo drivers, deep pulsating bass radiators, and ambient LED halo. IPX7 waterproof with 24-hour playtime anywhere in Cameroon.</div>
              <div class="hero-actions-row">
                <button onClick="{{ () => openCategory('electronics') }}" class="hero-btn-pill" style="background:#ffffff;color:#111214">Shop SoundPulse 360° →</button>
                <button onClick="{{ () => openCategory('electronics') }}" class="hero-btn-subtle" style="border:1px solid rgba(255,255,255,0.3);color:#ffffff">IPX7 Waterproof</button>
              </div>
            </div>

            <div class="hero-media-wrap" style="background:transparent">
              <img src="./Assets/LOUMOO%20VIDEOS/HeroBanner/hero_bluetooth_speaker.jpg" alt="SoundPulse 360 Studio Waterproof Speaker" loading="lazy" />
            </div>
          </div>
          <div class="hero-dots-row hero-dots-light">
            <button onClick="{{ setHeroSlide0 }}" class="hero-dot" aria-label="Slide 1 — Galaxy S24 Ultra"></button>
            <button onClick="{{ setHeroSlide1 }}" class="hero-dot" aria-label="Slide 2 — Royal Gele Couture"></button>
            <button onClick="{{ setHeroSlide2 }}" class="hero-dot" aria-label="Slide 3 — Botanical Radiance Serum"></button>
            <button onClick="{{ setHeroSlide3 }}" class="hero-dot" aria-label="Slide 4 — Urban Striker Kit"></button>
            <button onClick="{{ setHeroSlide4 }}" class="hero-dot" aria-label="Slide 5 — Heavyweight Cotton Tee"></button>
            <button onClick="{{ setHeroSlide5 }}" class="hero-dot" aria-label="Slide 6 — Titanium Minimalist Watch"></button>
            <button onClick="{{ setHeroSlide6 }}" class="hero-dot" aria-label="Slide 7 — MateBook Pro Ultrathin"></button>
            <button onClick="{{ setHeroSlide7 }}" class="hero-dot" aria-label="Slide 8 — DIVINY Noble Fragrance"></button>
            <button onClick="{{ setHeroSlide8 }}" class="hero-dot active" aria-label="Slide 9 — SoundPulse 360° Studio"></button>
            <button onClick="{{ setHeroSlide9 }}" class="hero-dot" aria-label="Slide 10 — Ivory Structured Handbag"></button>
          </div>
        </div>
      </sc-if>

      <!-- Slide 9: Ivory Structured Top-Handle Handbag (Image) -->
      <sc-if value="{{ isHeroSlide9 }}">
        <div class="hero-slide-pane" style="background:#30030d" data-hero-slide="9">
          <div class="hero-grid-layout">
            <div class="hero-text-wrap">
              <div style="font:800 13px/1 var(--font-heading);letter-spacing:0.06em;text-transform:uppercase;color:#fb7185;margin-bottom:8px">Maison Luxury Leather</div>
              <h1 style="margin:0 0 10px;font-size:clamp(28px, 4.2vw, 44px);font-weight:800;letter-spacing:-.035em;line-height:1.06;color:#ffffff">Ivory Structured Tote.</h1>
              <div style="font:500 clamp(13px, 1.8vw, 15.5px)/1.45 var(--font-body);color:rgba(255,255,255,0.85);margin-bottom:22px;max-width:400px">Full-grain Italian calfskin leather accented by polished 24K gold-plated padlock charm. Sculptural dual-compartment luxury for modern living.</div>
              <div class="hero-actions-row">
                <button onClick="{{ () => openCategory('fashion') }}" class="hero-btn-pill" style="background:#ffffff;color:#111214">Discover Leathercraft →</button>
                <button onClick="{{ () => openCategory('fashion') }}" class="hero-btn-subtle" style="border:1px solid rgba(255,255,255,0.3);color:#ffffff">Calfskin Collection</button>
              </div>
            </div>

            <div class="hero-media-wrap" style="background:transparent">
              <img src="./Assets/LOUMOO%20VIDEOS/HeroBanner/hero_luxury_handbag.jpg" alt="Ivory Structured Top Handle Handbag" loading="lazy" />
            </div>
          </div>
          <div class="hero-dots-row hero-dots-light">
            <button onClick="{{ setHeroSlide0 }}" class="hero-dot" aria-label="Slide 1 — Galaxy S24 Ultra"></button>
            <button onClick="{{ setHeroSlide1 }}" class="hero-dot" aria-label="Slide 2 — Royal Gele Couture"></button>
            <button onClick="{{ setHeroSlide2 }}" class="hero-dot" aria-label="Slide 3 — Botanical Radiance Serum"></button>
            <button onClick="{{ setHeroSlide3 }}" class="hero-dot" aria-label="Slide 4 — Urban Striker Kit"></button>
            <button onClick="{{ setHeroSlide4 }}" class="hero-dot" aria-label="Slide 5 — Heavyweight Cotton Tee"></button>
            <button onClick="{{ setHeroSlide5 }}" class="hero-dot" aria-label="Slide 6 — Titanium Minimalist Watch"></button>
            <button onClick="{{ setHeroSlide6 }}" class="hero-dot" aria-label="Slide 7 — MateBook Pro Ultrathin"></button>
            <button onClick="{{ setHeroSlide7 }}" class="hero-dot" aria-label="Slide 8 — DIVINY Noble Fragrance"></button>
            <button onClick="{{ setHeroSlide8 }}" class="hero-dot" aria-label="Slide 9 — SoundPulse 360° Studio"></button>
            <button onClick="{{ setHeroSlide9 }}" class="hero-dot active" aria-label="Slide 10 — Ivory Structured Handbag"></button>
          </div>
        </div>
      </sc-if>
    </div>

    <!-- ── 03: CATEGORY QUICK-DISCOVERY LAYER (Apple-Style Squircles) ── -->
    <div class="cat-discovery-rail">
      <!-- 1. Hotels -->
      <button onClick="{{ openHotelSearch }}" class="cat-squircle-card" aria-label="Category Hotels & Accommodations">
        <div class="cat-squircle-icon-wrap" style="background:#fff;border:1px solid rgba(0,0,0,0.06);overflow:hidden;padding:2px">
          <img src="./Assets/Travel&Hotel/Krystal%20Palace%20Hotel%20Douala.jfif" alt="Hotels" style="width:100%;height:100%;object-fit:cover;border-radius:12px" loading="lazy" decoding="async" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';">
          <svg style="display:none" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 22v-6.57"/><path d="M12 11h.01"/><path d="M12 7h.01"/><path d="M14 15.43V22"/><path d="M15 11h.01"/><path d="M15 7h.01"/><path d="M16 16h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/><path d="M18 22v-4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v4"/><path d="M8 22v-6.57"/><path d="M9 11h.01"/><path d="M9 7h.01"/></svg>
        </div>
        <span class="cat-squircle-label">Hotels</span>
      </button>

      <!-- 2. Banks / Finance -->
      <button onClick="{{ () => openCategory('banks') }}" class="cat-squircle-card" aria-label="Category Banks & Real Estate">
        <div class="cat-squircle-icon-wrap" style="background:#fff;border:1px solid rgba(0,0,0,0.06);overflow:hidden;padding:4px">
          <img src="./Assets/_processed/logo_icons_bank_icon_stock_vector_illustration_of_s_27.png" alt="Banks" style="width:100%;height:100%;object-fit:contain" loading="lazy" decoding="async" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';">
          <svg style="display:none" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/><path d="M6 14h2"/><path d="M12 14h6"/></svg>
        </div>
        <span class="cat-squircle-label">Banks</span>
      </button>

      <!-- 3. Fashion -->
      <button onClick="{{ () => openCategory('fashion') }}" class="cat-squircle-card" aria-label="Category Fashion & Luxury">
        <div class="cat-squircle-icon-wrap" style="background:#fff;border:1px solid rgba(0,0,0,0.06);overflow:hidden;padding:4px">
          <img src="./Assets/_processed/logo_icons_fashion.png" alt="Fashion" style="width:100%;height:100%;object-fit:contain" loading="lazy" decoding="async" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';">
          <svg style="display:none" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>
        </div>
        <span class="cat-squircle-label">Fashion</span>
      </button>

      <!-- 4. Shoes -->
      <button onClick="{{ () => openCategory('fashion') }}" class="cat-squircle-card" aria-label="Category Shoes & Sneakers">
        <div class="cat-squircle-icon-wrap" style="background:#fff;border:1px solid rgba(0,0,0,0.06);overflow:hidden;padding:4px">
          <img src="./Assets/_processed/logo_icons_men_s_shoes_logo_icon_design_illustratio_49.png" alt="Shoes" style="width:100%;height:100%;object-fit:contain" loading="lazy" decoding="async" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';">
          <svg style="display:none" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 17h20v2H2zM4 17l2-6 5-1 4 4 5-1 2 4"/></svg>
        </div>
        <span class="cat-squircle-label">Shoes</span>
      </button>

      <!-- 5. Tech -->
      <button onClick="{{ () => openCategory('electronics') }}" class="cat-squircle-card" aria-label="Category Technology & Gadgets">
        <div class="cat-squircle-icon-wrap" style="background:#fff;border:1px solid rgba(0,0,0,0.06);overflow:hidden;padding:4px">
          <img src="./Assets/_processed/logo_icons_itel_42.png" alt="Tech" style="width:100%;height:100%;object-fit:contain" loading="lazy" decoding="async" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';">
          <svg style="display:none" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="18" height="12" x="3" y="4" rx="2"/><line x1="2" x2="22" y1="20" y2="20"/></svg>
        </div>
        <span class="cat-squircle-label">Tech</span>
      </button>

      <!-- 6. Markets -->
      <button onClick="{{ () => openCategory('store') }}" class="cat-squircle-card" aria-label="Category Markets & Stores">
        <div class="cat-squircle-icon-wrap" style="background:#fff;border:1px solid rgba(0,0,0,0.06);overflow:hidden;padding:4px">
          <img src="./Assets/_processed/logo_icons_market_logo_design_logo_logodesigner_mar_47.png" alt="Markets" style="width:100%;height:100%;object-fit:contain" loading="lazy" decoding="async" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';">
          <svg style="display:none" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
        </div>
        <span class="cat-squircle-label">Markets</span>
      </button>

      <!-- 7. Travel -->
      <button onClick="{{ on.travel }}" class="cat-squircle-card" aria-label="Category Travel & Flights">
        <div class="cat-squircle-icon-wrap" style="background:#fff;border:1px solid rgba(0,0,0,0.06);overflow:hidden;padding:4px">
          <img src="./Assets/_processed/logo_icons_travel_logo_image_premium_vector_62.png" alt="Travel" style="width:100%;height:100%;object-fit:contain" loading="lazy" decoding="async" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';">
          <svg style="display:none" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.3c.4-.2.6-.6.5-1.1z"/></svg>
        </div>
        <span class="cat-squircle-label">Travel</span>
      </button>

      <!-- 8. Services -->
      <button onClick="{{ () => openCategory('services') }}" class="cat-squircle-card" aria-label="Category Professional Services">
        <div class="cat-squircle-icon-wrap" style="background:#fff;border:1px solid rgba(0,0,0,0.06);overflow:hidden;padding:4px">
          <img src="./Assets/_processed/logo_icons_lettering_service_screwdriver_and_wrench_45.png" alt="Services" style="width:100%;height:100%;object-fit:contain" loading="lazy" decoding="async" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';">
          <svg style="display:none" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
        </div>
        <span class="cat-squircle-label">Services</span>
      </button>

      <!-- 9. Explore All -->
      <button onClick="{{ openAllCategories }}" class="cat-squircle-card" aria-label="View All Categories">
        <div class="cat-squircle-icon-wrap" style="background:#f1f5f9;color:#475569">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
        </div>
        <span class="cat-squircle-label" style="line-height:1.1">Explore All<br>Categories</span>
      </button>
    </div>

    <!-- ── 04: NEW ARRIVALS PRODUCT RAIL (Single Line Horizontal Scroll) ── -->
    <div class="editorial-section-header" style="display:flex;align-items:center;justify-content:space-between;padding:16px 0 12px">
      <div>
        <h2 class="editorial-section-title">New Arrivals</h2>
        <div style="font:500 13px/1.3 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Freshly dropped tech, luxury & lifestyle directly from verified Cameroonian sellers</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button onClick="{{ on.bestpicks }}" class="editorial-see-all">See all →</button>
        <button onClick="{{ () => scrollRail('newArrivalsRail', -320) }}" class="loumoo-rail-nav-btn" aria-label="Previous items">‹</button>
        <button onClick="{{ () => scrollRail('newArrivalsRail', 320) }}" class="loumoo-rail-nav-btn" aria-label="Next items">›</button>
      </div>
    </div>

    <div id="newArrivalsRail" class="new-arrivals-rail" style="display:flex;flex-direction:row;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;gap:18px;margin-bottom:32px;padding:4px 4px 16px 4px">
      <!-- Item 1: Armonía Double-Monk Shoes -->
      <div onClick="{{ () => openProduct('na_double_monk_01') }}" class="loumoo-media-card na-card" aria-label="View Armonía Glossy Black Double-Monk Shoes">
        <div class="na-card-media-wrap">
          <span class="loumoo-card-badge badge-pill-sale">Save 30.000 FCFA</span>
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('na_double_monk_01', 'Armonía Double-Monk Shoes'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save to wishlist">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('na_double_monk_01') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('na_double_monk_01') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/_processed/new_arrivals_01.jpg" alt="Armonía Glossy Black Double-Monk Shoes" loading="lazy" class="na-card-img">
          <div class="na-card-transition-fade"></div>
        </div>
        <div class="na-card-transition-line"></div>
        <div class="loumoo-card-body na-card-body">
          <div class="na-card-brand-row">
            <span class="na-card-rating">★ 4.9</span>
            <span class="na-card-store-label">Armonía Milano · Bonapriso</span>
          </div>
          <h3 class="loumoo-card-title na-card-title">Armonía Double-Monk Shoes</h3>
          <div class="loumoo-card-tagline na-card-tagline">Glossy Italian box calfskin · Gold buckle accents.</div>
          <div class="loumoo-card-bottom-row">
            <div class="loumoo-card-pricing-block">
              <span class="loumoo-card-price-prefix">From</span>
              <div class="loumoo-card-price-main">
                <span class="loumoo-card-price-val">85.000 FCFA</span>
                <span class="loumoo-card-price-strike">115.000 FCFA</span>
              </div>
              <div class="loumoo-card-trust-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>✓ City Sport: 110.000 FCFA</span>
              </div>
            </div>
            <button class="loumoo-card-pill-btn" aria-label="Buy Armonía Double-Monk Shoes">Buy now</button>
          </div>
        </div>
      </div>

      <!-- Item 2: Danbaoly Crimson Bow-Tie Handbag -->
      <div onClick="{{ () => openProduct('na_danbaoly_bag_02') }}" class="loumoo-media-card na-card" aria-label="View Danbaoly Crimson Red Handbag">
        <div class="na-card-media-wrap">
          <span class="loumoo-card-badge badge-pill-new">Trending · Gold Charm</span>
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('na_danbaoly_bag_02', 'Danbaoly Crimson Tote'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save to wishlist">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('na_danbaoly_bag_02') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('na_danbaoly_bag_02') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/_processed/new_arrivals_02.jpg" alt="Danbaoly Crimson Red Handbag" loading="lazy" class="na-card-img">
          <div class="na-card-transition-fade"></div>
        </div>
        <div class="na-card-transition-line"></div>
        <div class="loumoo-card-body na-card-body">
          <div class="na-card-brand-row">
            <span class="na-card-rating">★ 4.8</span>
            <span class="na-card-store-label">Maison Danbaoly · Akwa</span>
          </div>
          <h3 class="loumoo-card-title na-card-title">Danbaoly Crimson Tote</h3>
          <div class="loumoo-card-tagline na-card-tagline">Textured calfskin with bow tie & star charm.</div>
          <div class="loumoo-card-bottom-row">
            <div class="loumoo-card-pricing-block">
              <span class="loumoo-card-price-prefix">From</span>
              <div class="loumoo-card-price-main">
                <span class="loumoo-card-price-val">42.000 FCFA</span>
                <span class="loumoo-card-price-strike">58.000 FCFA</span>
              </div>
              <div class="loumoo-card-trust-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>✓ Jumia CM: 55.000 FCFA</span>
              </div>
            </div>
            <button class="loumoo-card-pill-btn" aria-label="Buy Danbaoly Crimson Tote">Buy now</button>
          </div>
        </div>
      </div>

      <!-- Item 3: Pedro Tri-Tone Urban Commuter Rucksack -->
      <div onClick="{{ () => openProduct('na_pedro_backpack_03') }}" class="loumoo-media-card na-card" aria-label="View Pedro Tri-Tone Heritage Rucksack">
        <div class="na-card-media-wrap">
          <span class="loumoo-card-badge badge-pill-sale">Save 20.000 FCFA</span>
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('na_pedro_backpack_03', 'Pedro Heritage Rucksack'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save to wishlist">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('na_pedro_backpack_03') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('na_pedro_backpack_03') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/_processed/new_arrivals_03.jpg" alt="Pedro Tri-Tone Heritage Rucksack" loading="lazy" class="na-card-img">
          <div class="na-card-transition-fade"></div>
        </div>
        <div class="na-card-transition-line"></div>
        <div class="loumoo-card-body na-card-body">
          <div class="na-card-brand-row">
            <span class="na-card-rating">★ 4.9</span>
            <span class="na-card-store-label">Pedro Flagship · Yaoundé</span>
          </div>
          <h3 class="loumoo-card-title na-card-title">Pedro Heritage Rucksack</h3>
          <div class="loumoo-card-tagline na-card-tagline">Ivory, cognac tan & sky blue commuter pack.</div>
          <div class="loumoo-card-bottom-row">
            <div class="loumoo-card-pricing-block">
              <span class="loumoo-card-price-prefix">From</span>
              <div class="loumoo-card-price-main">
                <span class="loumoo-card-price-val">68.000 FCFA</span>
                <span class="loumoo-card-price-strike">88.000 FCFA</span>
              </div>
              <div class="loumoo-card-trust-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>✓ Pedro Import: 85.000 FCFA</span>
              </div>
            </div>
            <button class="loumoo-card-pill-btn" aria-label="Buy Pedro Heritage Rucksack">Buy now</button>
          </div>
        </div>
      </div>

      <!-- Item 4: boAt Stone 1400 Crimson Rugged Speaker -->
      <div onClick="{{ () => openProduct('na_boat_speaker_04') }}" class="loumoo-media-card na-card" aria-label="View boAt Stone 1400 Crimson Speaker">
        <div class="na-card-media-wrap">
          <span class="loumoo-card-badge badge-pill-new">70W Stereo · IPX7</span>
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('na_boat_speaker_04', 'boAt Stone 1400 Crimson'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save to wishlist">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('na_boat_speaker_04') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('na_boat_speaker_04') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/_processed/new_arrivals_04.jpg" alt="boAt Stone 1400 Crimson Speaker" loading="lazy" class="na-card-img">
          <div class="na-card-transition-fade"></div>
        </div>
        <div class="na-card-transition-line"></div>
        <div class="loumoo-card-body na-card-body">
          <div class="na-card-brand-row">
            <span class="na-card-rating">★ 4.9</span>
            <span class="na-card-store-label">SoundWave · Douala Grand Mall</span>
          </div>
          <h3 class="loumoo-card-title na-card-title">boAt Stone 1400 Crimson</h3>
          <div class="loumoo-card-tagline na-card-tagline">70W dynamic stereo audio · RGB bass radiator.</div>
          <div class="loumoo-card-bottom-row">
            <div class="loumoo-card-pricing-block">
              <span class="loumoo-card-price-prefix">From</span>
              <div class="loumoo-card-price-main">
                <span class="loumoo-card-price-val">45.000 FCFA</span>
                <span class="loumoo-card-price-strike">60.000 FCFA</span>
              </div>
              <div class="loumoo-card-trust-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>✓ Glotelho: 58.000 FCFA</span>
              </div>
            </div>
            <button class="loumoo-card-pill-btn" aria-label="Buy boAt Stone 1400 Crimson">Buy now</button>
          </div>
        </div>
      </div>

      <!-- Item 5: Google Pixel 10 Pro Titanium -->
      <div onClick="{{ () => openProduct('na_pixel_10_pro_05') }}" class="loumoo-media-card na-card" aria-label="View Google Pixel 10 Pro Titanium">
        <div class="na-card-media-wrap">
          <span class="loumoo-card-badge badge-pill-new">Tensor G5 · 256GB</span>
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('na_pixel_10_pro_05', 'Google Pixel 10 Pro'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save to wishlist">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('na_pixel_10_pro_05') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('na_pixel_10_pro_05') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/_processed/new_arrivals_05.jpg" alt="Google Pixel 10 Pro Titanium Grey" loading="lazy" class="na-card-img">
          <div class="na-card-transition-fade"></div>
        </div>
        <div class="na-card-transition-line"></div>
        <div class="loumoo-card-body na-card-body">
          <div class="na-card-brand-row">
            <span class="na-card-rating">★ 5.0</span>
            <span class="na-card-store-label">Pixel Hub Cameroon · Akwa</span>
          </div>
          <h3 class="loumoo-card-title na-card-title">Google Pixel 10 Pro 5G</h3>
          <div class="loumoo-card-tagline na-card-tagline">Tensor G5 Silicon · Studio AI Triple Camera.</div>
          <div class="loumoo-card-bottom-row">
            <div class="loumoo-card-pricing-block">
              <span class="loumoo-card-price-prefix">From</span>
              <div class="loumoo-card-price-main">
                <span class="loumoo-card-price-val">650.000 FCFA</span>
                <span class="loumoo-card-price-strike">740.000 FCFA</span>
              </div>
              <div class="loumoo-card-trust-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>✓ Glotelho Tech: 735.000 FCFA</span>
              </div>
            </div>
            <button class="loumoo-card-pill-btn" aria-label="Buy Google Pixel 10 Pro">Buy now</button>
          </div>
        </div>
      </div>

      <!-- Item 6: Amina Muaddi Crystal Sunburst Pumps & Quilted Bag Set -->
      <div onClick="{{ () => openProduct('na_amina_muaddi_06') }}" class="loumoo-media-card na-card" aria-label="View Amina Muaddi Sunburst Duo">
        <div class="na-card-media-wrap">
          <span class="loumoo-card-badge badge-pill-sale">Save 40.000 FCFA</span>
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('na_amina_muaddi_06', 'Amina Muaddi Sunburst Duo'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save to wishlist">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('na_amina_muaddi_06') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('na_amina_muaddi_06') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/_processed/new_arrivals_06.jpg" alt="Amina Muaddi Sunburst Orange Pumps & Bag" loading="lazy" class="na-card-img">
          <div class="na-card-transition-fade"></div>
        </div>
        <div class="na-card-transition-line"></div>
        <div class="loumoo-card-body na-card-body">
          <div class="na-card-brand-row">
            <span class="na-card-rating">★ 5.0</span>
            <span class="na-card-store-label">Bella Donna Boutique · Bonanjo</span>
          </div>
          <h3 class="loumoo-card-title na-card-title">Amina Muaddi Sunburst Duo</h3>
          <div class="loumoo-card-tagline na-card-tagline">Orange satin crystal pumps with matching quilted bag.</div>
          <div class="loumoo-card-bottom-row">
            <div class="loumoo-card-pricing-block">
              <span class="loumoo-card-price-prefix">From</span>
              <div class="loumoo-card-price-main">
                <span class="loumoo-card-price-val">125.000 FCFA</span>
                <span class="loumoo-card-price-strike">165.000 FCFA</span>
              </div>
              <div class="loumoo-card-trust-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>✓ VIP Chic Douala: 160.000 FCFA</span>
              </div>
            </div>
            <button class="loumoo-card-pill-btn" aria-label="Buy Amina Muaddi Sunburst Duo">Buy now</button>
          </div>
        </div>
      </div>

      <!-- Item 7: NOIRE Matte Crocodile Birkin Luxury Handbag -->
      <div onClick="{{ () => openProduct('na_noire_birkin_07') }}" class="loumoo-media-card na-card" aria-label="View NOIRE Alligator Birkin Luxury Handbag">
        <div class="na-card-media-wrap">
          <span class="loumoo-card-badge badge-pill-new">Atelier Edition · 24K Gold</span>
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('na_noire_birkin_07', 'NOIRE Alligator Birkin'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save to wishlist">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('na_noire_birkin_07') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('na_noire_birkin_07') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/_processed/new_arrivals_07.jpg" alt="NOIRE Alligator Birkin Handbag with Cheetah" loading="lazy" class="na-card-img">
          <div class="na-card-transition-fade"></div>
        </div>
        <div class="na-card-transition-line"></div>
        <div class="loumoo-card-body na-card-body">
          <div class="na-card-brand-row">
            <span class="na-card-rating">★ 5.0</span>
            <span class="na-card-store-label">NOIRE Atelier · Bastos, Yaoundé</span>
          </div>
          <h3 class="loumoo-card-title na-card-title">NOIRE Alligator Birkin</h3>
          <div class="loumoo-card-tagline na-card-tagline">Crocodile-embossed leather with 24K gold lock.</div>
          <div class="loumoo-card-bottom-row">
            <div class="loumoo-card-pricing-block">
              <span class="loumoo-card-price-prefix">From</span>
              <div class="loumoo-card-price-main">
                <span class="loumoo-card-price-val">195.000 FCFA</span>
                <span class="loumoo-card-price-strike">260.000 FCFA</span>
              </div>
              <div class="loumoo-card-trust-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>✓ Luxury Closet CM: 250.000 FCFA</span>
              </div>
            </div>
            <button class="loumoo-card-pill-btn" aria-label="Buy NOIRE Alligator Birkin">Buy now</button>
          </div>
        </div>
      </div>

      <!-- Item 8: Bigtree 10cm Emerald Alligator Patent Pumps -->
      <div onClick="{{ () => openProduct('na_bigtree_heels_08') }}" class="loumoo-media-card na-card" aria-label="View Bigtree Emerald Stiletto Pumps">
        <div class="na-card-media-wrap">
          <span class="loumoo-card-badge badge-pill-sale">Save 14.000 FCFA</span>
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('na_bigtree_heels_08', 'Bigtree Emerald Stilettos'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save to wishlist">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('na_bigtree_heels_08') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('na_bigtree_heels_08') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/_processed/new_arrivals_08.jpg" alt="Bigtree Emerald Alligator Stiletto Pumps" loading="lazy" class="na-card-img">
          <div class="na-card-transition-fade"></div>
        </div>
        <div class="na-card-transition-line"></div>
        <div class="loumoo-card-body na-card-body">
          <div class="na-card-brand-row">
            <span class="na-card-rating">★ 4.8</span>
            <span class="na-card-store-label">Glamour Steps · Douala Grand Mall</span>
          </div>
          <h3 class="loumoo-card-title na-card-title">Bigtree Emerald Stilettos</h3>
          <div class="loumoo-card-tagline na-card-tagline">10cm crocodile patent stiletto with gold buckle.</div>
          <div class="loumoo-card-bottom-row">
            <div class="loumoo-card-pricing-block">
              <span class="loumoo-card-price-prefix">From</span>
              <div class="loumoo-card-price-main">
                <span class="loumoo-card-price-val">38.000 FCFA</span>
                <span class="loumoo-card-price-strike">52.000 FCFA</span>
              </div>
              <div class="loumoo-card-trust-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>✓ Jumia CM: 49.000 FCFA</span>
              </div>
            </div>
            <button class="loumoo-card-pill-btn" aria-label="Buy Bigtree Emerald Stilettos">Buy now</button>
          </div>
        </div>
      </div>

      <!-- Item 9: Artisan Lug-Sole Chunky Brogue Derby Shoes -->
      <div onClick="{{ () => openProduct('na_artisan_brogue_09') }}" class="loumoo-media-card na-card" aria-label="View Artisan Lug-Sole Chunky Brogues">
        <div class="na-card-media-wrap">
          <span class="loumoo-card-badge badge-pill-new">Vibram Lug Sole</span>
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('na_artisan_brogue_09', 'Artisan Chunky Brogues'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save to wishlist">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('na_artisan_brogue_09') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('na_artisan_brogue_09') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/_processed/new_arrivals_09.jpg" alt="Artisan Lug-Sole Wingtip Brogue Shoes" loading="lazy" class="na-card-img">
          <div class="na-card-transition-fade"></div>
        </div>
        <div class="na-card-transition-line"></div>
        <div class="loumoo-card-body na-card-body">
          <div class="na-card-brand-row">
            <span class="na-card-rating">★ 4.9</span>
            <span class="na-card-store-label">Sartorial Douala · Bali</span>
          </div>
          <h3 class="loumoo-card-title na-card-title">Artisan Chunky Brogues</h3>
          <div class="loumoo-card-tagline na-card-tagline">Full-grain box calfskin with commando lug sole.</div>
          <div class="loumoo-card-bottom-row">
            <div class="loumoo-card-pricing-block">
              <span class="loumoo-card-price-prefix">From</span>
              <div class="loumoo-card-price-main">
                <span class="loumoo-card-price-val">75.000 FCFA</span>
                <span class="loumoo-card-price-strike">98.000 FCFA</span>
              </div>
              <div class="loumoo-card-trust-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>✓ Bata Heritage: 95.000 FCFA</span>
              </div>
            </div>
            <button class="loumoo-card-pill-btn" aria-label="Buy Artisan Chunky Brogues">Buy now</button>
          </div>
        </div>
      </div>

      <!-- Item 10: Tobacco Vanille Artisanal Extrait De Parfum (30ml) -->
      <div onClick="{{ () => openProduct('na_tobacco_vanille_10') }}" class="loumoo-media-card na-card" aria-label="View Tobacco Vanille Extrait De Parfum">
        <div class="na-card-media-wrap">
          <span class="loumoo-card-badge badge-pill-sale">Save 13.000 FCFA</span>
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('na_tobacco_vanille_10', 'Tobacco Vanille 30ml'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save to wishlist">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('na_tobacco_vanille_10') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('na_tobacco_vanille_10') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/_processed/new_arrivals_10.jpg" alt="Tobacco Vanille Artisanal Extrait De Parfum" loading="lazy" class="na-card-img">
          <div class="na-card-transition-fade"></div>
        </div>
        <div class="na-card-transition-line"></div>
        <div class="loumoo-card-body na-card-body">
          <div class="na-card-brand-row">
            <span class="na-card-rating">★ 5.0</span>
            <span class="na-card-store-label">L’Artisan Parfumeur · Yaoundé</span>
          </div>
          <h3 class="loumoo-card-title na-card-title">Tobacco Vanille 30ml</h3>
          <div class="loumoo-card-tagline na-card-tagline">Madagascar vanilla blossoms, cedar & star anise.</div>
          <div class="loumoo-card-bottom-row">
            <div class="loumoo-card-pricing-block">
              <span class="loumoo-card-price-prefix">From</span>
              <div class="loumoo-card-price-main">
                <span class="loumoo-card-price-val">35.000 FCFA</span>
                <span class="loumoo-card-price-strike">48.000 FCFA</span>
              </div>
              <div class="loumoo-card-trust-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>✓ Bastos Parfums: 46.000 FCFA</span>
              </div>
            </div>
            <button class="loumoo-card-pill-btn" aria-label="Buy Tobacco Vanille 30ml">Buy now</button>
          </div>
        </div>
      </div>

      <!-- Item 11: Swarovski Crystal Infinity Teardrop Jewelry Set -->
      <div onClick="{{ () => openProduct('na_infinity_necklace_11') }}" class="loumoo-media-card na-card" aria-label="View Crystal Infinity Parure Set">
        <div class="na-card-media-wrap">
          <span class="loumoo-card-badge badge-pill-new">Bridal Parure · CZ</span>
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('na_infinity_necklace_11', 'Crystal Infinity Parure'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save to wishlist">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('na_infinity_necklace_11') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('na_infinity_necklace_11') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/_processed/new_arrivals_11.jpg" alt="Swarovski Crystal Infinity Teardrop Jewelry Set" loading="lazy" class="na-card-img">
          <div class="na-card-transition-fade"></div>
        </div>
        <div class="na-card-transition-line"></div>
        <div class="loumoo-card-body na-card-body">
          <div class="na-card-brand-row">
            <span class="na-card-rating">★ 4.9</span>
            <span class="na-card-store-label">Prestige Bijoux · Bonapriso</span>
          </div>
          <h3 class="loumoo-card-title na-card-title">Crystal Infinity Parure</h3>
          <div class="loumoo-card-tagline na-card-tagline">Rhodium-plated infinity necklace & drop earrings.</div>
          <div class="loumoo-card-bottom-row">
            <div class="loumoo-card-pricing-block">
              <span class="loumoo-card-price-prefix">From</span>
              <div class="loumoo-card-price-main">
                <span class="loumoo-card-price-val">55.000 FCFA</span>
                <span class="loumoo-card-price-strike">75.000 FCFA</span>
              </div>
              <div class="loumoo-card-trust-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>✓ Bijouterie Douala: 72.000 FCFA</span>
              </div>
            </div>
            <button class="loumoo-card-pill-btn" aria-label="Buy Crystal Infinity Parure">Buy now</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 05: EDITORIAL & VIDEO STORYTELLING (Insta360. Think bold.) ── -->
    <!-- ── 05: EDITORIAL & VIDEO STORYTELLING (Official Insta360 Bento Showcase Rail) ── -->
    <div class="loumoo-rail-header">
      <div class="loumoo-rail-title-wrap">
        <span class="loumoo-rail-kicker">INSTA360 OFFICIAL SHOWCASE</span>
        <h2 class="loumoo-rail-title">Insta360. Think bold.</h2>
        <p class="loumoo-rail-subtitle">Curated 8K 360° and action creator moments</p>
      </div>
      <div class="loumoo-rail-controls">
        <button onClick="{{ () => openVideoModal('Insta360 Creator Showcase', 'All 8K 360° and Action Video Stories', 'INSTA360 ALL') }}" class="loumoo-rail-action-link">Watch all →</button>
        <button onClick="{{ () => scrollRail('instaVideoBentoRail', -340) }}" class="loumoo-rail-nav-btn" aria-label="Previous slide">‹</button>
        <button onClick="{{ () => scrollRail('instaVideoBentoRail', 340) }}" class="loumoo-rail-nav-btn" aria-label="Next slide">›</button>
      </div>
    </div>

    <!-- Official Insta360 5-Card Bento Showcase Grid (Media-First Hover-to-Play Standard) -->
    <div class="insta360-bento-video-grid" id="instaVideoBentoRail">
      <!-- 1. Left Tall Card: Samsung Galaxy S25 Ultra (Vertical) -->
      <div onClick="{{ () => openVideoModal('Galaxy S25 Ultra Titanium', 'Next-Gen Flagship Smartphone Design · 200MP Pro Visuals', 'SAMSUNG GALAXY', './Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/From%20Klickpin.com-%201067142074219304497-pin-id-1067142074219304497.mp4') }}" class="insta-video-card-tall" data-hover-video="true" style="position:relative;overflow:hidden;border-radius:var(--radius-lg);cursor:pointer;background:#0b0d14" aria-label="Explore Galaxy S25 Ultra Titanium">
        <video src="./Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/From%20Klickpin.com-%201067142074219304497-pin-id-1067142074219304497.mp4" poster="./Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/poster_1.jpg" autoplay muted loop playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
        <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.2) 60%, rgba(0,0,0,0.85) 100%);pointer-events:none"></div>

        <div class="loumoo-card-video-pill" style="top:12px;left:12px"><span class="live-dot"></span>FLAGSHIP 4K</div>

        <!-- Bottom Metadata Bar -->
        <div class="insta-card-bottom-bar" style="position:relative;z-index:2">
          <div class="insta-card-meta-left">
            <span class="insta-card-title">Galaxy S25 Ultra</span>
            <span class="insta-card-author">Titanium Silver · 200MP Pro</span>
          </div>
          <div class="insta-device-pill">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="5" y="2" width="14" height="20" rx="3"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
            <span>Galaxy AI</span>
          </div>
        </div>
      </div>

      <!-- 2. Middle Column: Split Top Wide + Bottom Duo -->
      <div class="insta-video-middle-col">
        <!-- Top Wide Card: Smart Spa & Wellness (Horizontal 1280x720 Widescreen) -->
        <div onClick="{{ () => openVideoModal('Smart Spa Night & Wellness', 'Effortless Relaxation · Aromatherapy & Self-Care Sanctuary', 'WELLNESS & SPA', './Assets/LOUMOO%20VIDEOS/From%20Klickpin.com-%20Bookmark%20this%20smart%20spa%20night%20roundup%20everyone%20will%20ask%20you%20about%20for%20a%20stylish%20result%20that%20still%20feels%20effortless%20and%20make%20you.mp4') }}" class="insta-video-card-wide" data-hover-video="true" style="position:relative;overflow:hidden;border-radius:var(--radius-lg);cursor:pointer;background:#0b0d14" aria-label="Explore Smart Spa Night & Wellness">
          <video src="./Assets/LOUMOO%20VIDEOS/From%20Klickpin.com-%20Bookmark%20this%20smart%20spa%20night%20roundup%20everyone%20will%20ask%20you%20about%20for%20a%20stylish%20result%20that%20still%20feels%20effortless%20and%20make%20you.mp4" poster="./Assets/_processed/spa_night_poster.jpg" autoplay muted loop playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.2) 60%, rgba(0,0,0,0.85) 100%);pointer-events:none"></div>

          <div class="loumoo-card-video-pill" style="top:12px;left:12px"><span class="live-dot"></span>WELLNESS & SPA</div>

          <!-- Bottom Metadata Bar -->
          <div class="insta-card-bottom-bar" style="position:relative;z-index:2">
            <div class="insta-card-meta-left">
              <span class="insta-card-title">Smart Spa Night</span>
              <span class="insta-card-author">Aromatherapy · Self-Care Sanctuary</span>
            </div>
            <div class="insta-device-pill">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
              <span>Smart Care</span>
            </div>
          </div>
        </div>

        <!-- Bottom Duo Row -->
        <div class="insta-video-middle-bottom-row">
          <!-- 3. Middle Bottom-Left: Cozy Workspace (Desk Styling) -->
          <div onClick="{{ () => openVideoModal('Cozy Workspace Desk Styling', 'Minimalist Office Desk Setup & Productivity Tech', 'WORKSPACE', './Assets/LOUMOO%20VIDEOS/phoneBrands.videos/From%20Klickpin.com-%20Discover%20Cozy%20office%20desk%20styling%20for%20a%20polished%20look%20people%20will%20notice%20with%20simple%20details%20that%20elevate%20the%20final%20look-pin-id.mp4') }}" class="insta-video-card-compact" data-hover-video="true" style="position:relative;overflow:hidden;border-radius:var(--radius-lg);cursor:pointer;background:#0b0d14" aria-label="Explore Cozy Workspace Desk Styling">
            <video src="./Assets/LOUMOO%20VIDEOS/phoneBrands.videos/From%20Klickpin.com-%20Discover%20Cozy%20office%20desk%20styling%20for%20a%20polished%20look%20people%20will%20notice%20with%20simple%20details%20that%20elevate%20the%20final%20look-pin-id.mp4" poster="./Assets/_processed/desk_styling_tall_poster.jpg" autoplay muted loop playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
            <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.2) 60%, rgba(0,0,0,0.85) 100%);pointer-events:none"></div>

            <div class="loumoo-card-video-pill" style="top:9px;left:9px;padding:3px 6px;font-size:9.5px"><span class="live-dot"></span>WORKSPACE</div>

            <!-- Bottom Metadata Bar -->
            <div class="insta-card-bottom-bar" style="position:relative;z-index:2;padding:14px 12px 10px">
              <div class="insta-card-meta-left">
                <span class="insta-card-title" style="font-size:14px">Cozy Desk Setup</span>
                <span class="insta-card-author" style="font-size:11px">Minimalist Workspace</span>
              </div>
              <div class="insta-device-pill" style="padding:3px 8px;font-size:10px">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                <span>Productivity</span>
              </div>
            </div>
          </div>

          <!-- 4. Middle Bottom-Right: City Break Travel (Travel Lifestyle) -->
          <div onClick="{{ () => openVideoModal('City Break Travel', 'Weekend Itinerary & Urban Explorer Essentials · Loumoo Lifestyle', 'TRAVEL', './Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/From%20Klickpin.com-%2085%20City%20Break%20Itinerary%20Ideas%20for%20Men-pin-id-512073420150638463.mp4') }}" class="insta-video-card-compact" data-hover-video="true" style="position:relative;overflow:hidden;border-radius:var(--radius-lg);cursor:pointer;background:#0b0d14" aria-label="Explore City Break Travel">
            <video src="./Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/From%20Klickpin.com-%2085%20City%20Break%20Itinerary%20Ideas%20for%20Men-pin-id-512073420150638463.mp4" poster="./Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/poster_4.jpg" autoplay muted loop playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
            <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.2) 60%, rgba(0,0,0,0.85) 100%);pointer-events:none"></div>

            <div class="loumoo-card-video-pill" style="top:9px;left:9px;padding:3px 6px;font-size:9.5px"><span class="live-dot"></span>TRAVEL</div>

            <!-- Bottom Metadata Bar -->
            <div class="insta-card-bottom-bar" style="position:relative;z-index:2;padding:14px 12px 10px">
              <div class="insta-card-meta-left">
                <span class="insta-card-title" style="font-size:14px">City Break</span>
                <span class="insta-card-author" style="font-size:11px">Weekend Itinerary</span>
              </div>
              <div class="insta-device-pill" style="padding:3px 8px;font-size:10px">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                <span>Explorer</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 5. Right Tall Card: Apple iPhone 16 Pro Max (Vertical) -->
      <div onClick="{{ () => openVideoModal('iPhone 16 Pro Max Titanium', 'Natural Titanium Frame & A18 Pro Silicon · Apple Showcase', 'APPLE FLAGSHIP', './Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/From%20Klickpin.com-%201072490098914829145-pin-id-1072490098914829145.mp4') }}" class="insta-video-card-tall" data-hover-video="true" style="position:relative;overflow:hidden;border-radius:var(--radius-lg);cursor:pointer;background:#0b0d14" aria-label="Explore iPhone 16 Pro Max Titanium">
        <video src="./Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/From%20Klickpin.com-%201072490098914829145-pin-id-1072490098914829145.mp4" poster="./Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/poster_2.jpg" autoplay muted loop playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
        <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.2) 60%, rgba(0,0,0,0.85) 100%);pointer-events:none"></div>

        <div class="loumoo-card-video-pill" style="top:12px;left:12px"><span class="live-dot"></span>TITANIUM PRO</div>

        <!-- Bottom Metadata Bar -->
        <div class="insta-card-bottom-bar" style="position:relative;z-index:2">
          <div class="insta-card-meta-left">
            <span class="insta-card-title">iPhone 16 Pro Max</span>
            <span class="insta-card-author">Natural Titanium · A18 Pro</span>
          </div>
          <div class="insta-device-pill">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="5" y="2" width="14" height="20" rx="3"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
            <span>Apple A18</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ── 06: SHOP BY CATEGORY / APPLE-GRADE DUAL CARDS ── -->
    <div class="editorial-section-header">
      <h2 class="editorial-section-title">Shop by category</h2>
      <button onClick="{{ openAllCategories }}" class="editorial-see-all">See all →</button>
    </div>

    <div class="shop-by-cat-grid">
      <!-- 1. iPhone -->
      <button onClick="{{ () => openCategory('electronics') }}" class="shop-cat-card-apple" aria-label="Shop iPhone Category">
        <div>
          <div style="font:800 17px/1 var(--font-heading);color:var(--color-text)">iPhone</div>
          <div style="font:500 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:4px">Latest models.</div>
          <div style="font:700 11.5px/1 var(--font-heading);color:var(--color-accent);margin-top:16px">Shop now →</div>
        </div>
        <div style="display:flex;justify-content:center;align-items:center">
          <svg width="56" height="70" viewBox="0 0 56 70" fill="none">
            <rect x="8" y="2" width="40" height="66" rx="8" fill="#292e38" stroke="#64748b" stroke-width="1.2"/>
            <circle cx="28" cy="8" r="2" fill="#0f172a"/>
          </svg>
        </div>
      </button>

      <!-- 2. Mac -->
      <button onClick="{{ () => openCategory('electronics') }}" class="shop-cat-card-apple" aria-label="Shop Mac Category">
        <div>
          <div style="font:800 17px/1 var(--font-heading);color:var(--color-text)">Mac</div>
          <div style="font:500 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:4px">Power to create.</div>
          <div style="font:700 11.5px/1 var(--font-heading);color:var(--color-accent);margin-top:16px">Shop now →</div>
        </div>
        <div style="display:flex;justify-content:center;align-items:center">
          <svg width="68" height="52" viewBox="0 0 68 52" fill="none">
            <rect x="8" y="6" width="52" height="34" rx="4" fill="#1e232d" stroke="#64748b" stroke-width="1.2"/>
            <rect x="11" y="9" width="46" height="28" fill="#0284c7" opacity="0.8"/>
            <path d="M2 44 H66 L64 48 H4 Z" fill="#94a3b8"/>
          </svg>
        </div>
      </button>

      <!-- 3. Watch -->
      <button onClick="{{ () => openCategory('electronics') }}" class="shop-cat-card-apple" aria-label="Shop Watch Category">
        <div>
          <div style="font:800 17px/1 var(--font-heading);color:var(--color-text)">Watch</div>
          <div style="font:500 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:4px">On your wrist. In your world.</div>
          <div style="font:700 11.5px/1 var(--font-heading);color:var(--color-accent);margin-top:16px">Shop now →</div>
        </div>
        <div style="display:flex;justify-content:center;align-items:center">
          <svg width="48" height="64" viewBox="0 0 48 64" fill="none">
            <rect x="18" y="2" width="12" height="60" rx="3" fill="#475569"/>
            <rect x="10" y="16" width="28" height="32" rx="7" fill="#0f172a" stroke="#64748b" stroke-width="1.2"/>
          </svg>
        </div>
      </button>

      <!-- 4. AirPods -->
      <button onClick="{{ () => openCategory('electronics') }}" class="shop-cat-card-apple" aria-label="Shop AirPods Category">
        <div>
          <div style="font:800 17px/1 var(--font-heading);color:var(--color-text)">AirPods</div>
          <div style="font:500 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:4px">Sound that moves you.</div>
          <div style="font:700 11.5px/1 var(--font-heading);color:var(--color-accent);margin-top:16px">Shop now →</div>
        </div>
        <div style="display:flex;justify-content:center;align-items:center">
          <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
            <rect x="10" y="12" width="32" height="30" rx="8" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>
            <circle cx="26" cy="24" r="2" fill="#22c55e"/>
          </svg>
        </div>
      </button>

      <!-- 5. Accessories -->
      <button onClick="{{ () => openCategory('electronics') }}" class="shop-cat-card-apple" aria-label="Shop Accessories Category">
        <div>
          <div style="font:800 17px/1 var(--font-heading);color:var(--color-text)">Accessories</div>
          <div style="font:500 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:4px">Essentials that complete.</div>
          <div style="font:700 11.5px/1 var(--font-heading);color:var(--color-accent);margin-top:16px">Shop now →</div>
        </div>
        <div style="display:flex;justify-content:center;align-items:center">
          <svg width="48" height="60" viewBox="0 0 48 60" fill="none">
            <rect x="10" y="4" width="28" height="52" rx="6" fill="#334155" stroke="#64748b" stroke-width="1.2"/>
            <circle cx="24" cy="28" r="8" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="3 2"/>
          </svg>
        </div>
      </button>
    </div>

    <!-- ── 07: FEATURED STORES & BRANDS ── -->
    <div class="editorial-section-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div>
        <h2 class="editorial-section-title">Featured stores</h2>
        <div style="font:500 12px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Verified brand flagships & official retail partners</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button onClick="{{ on.store }}" class="editorial-see-all">See all →</button>
        <button onClick="{{ () => scrollRail('featuredStoresRail', -260) }}" class="loumoo-rail-nav-btn" aria-label="Previous stores">‹</button>
        <button onClick="{{ () => scrollRail('featuredStoresRail', 260) }}" class="loumoo-rail-nav-btn" aria-label="Next stores">›</button>
      </div>
    </div>

    <div id="featuredStoresRail" class="featured-stores-rail">
      <!-- 1. Apple -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Apple Official Store">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_apple.png" alt="Apple" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Apple</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Official Store</div>
        </div>
      </button>

      <!-- 2. Amazon -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Amazon Global Store">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_amazon_modifie_son_logo_apr_s_des_compar_25.png" alt="Amazon" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Amazon</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Global Store</div>
        </div>
      </button>

      <!-- 3. MTN -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit MTN Official Store">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_mtn_logo_52.png" alt="MTN" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">MTN</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">MoMo & Telco</div>
        </div>
      </button>

      <!-- 4. HP -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit HP Official Store">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_hp_39.png" alt="HP" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">HP</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Laptops & PC</div>
        </div>
      </button>

      <!-- 5. LG -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit LG Official Store">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_lg_logo_2_46.png" alt="LG" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">LG</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Electronics</div>
        </div>
      </button>

      <!-- 6. itel -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit itel Official Store">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_itel_42.png" alt="itel" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">itel</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Smart Mobile</div>
        </div>
      </button>

      <!-- 7. Shopify -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Shopify Verified Brands">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_shopify_bag_icon_symbol_logo_56.png" alt="Shopify" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Shopify</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Partner Stores</div>
        </div>
      </button>

      <!-- 8. McDonald's -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit McDonald's Store">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_mcdonalds.png" alt="McDonald's" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">McDonald's</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Fast Food & Café</div>
        </div>
      </button>

      <!-- 9. KFC -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit KFC Official Store">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_kfc_43.png" alt="KFC" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">KFC</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Crispy Chicken</div>
        </div>
      </button>

      <!-- 10. Burger King -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Burger King Store">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_burger_king_change_de_logo_pour_revenir__28.png" alt="Burger King" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Burger King</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Flame Grilled</div>
        </div>
      </button>

      <!-- 11. Starbucks -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Starbucks Store">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_starbucks_60.png" alt="Starbucks" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Starbucks</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Coffee & Tea</div>
        </div>
      </button>

      <!-- 12. Coca-Cola -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Coca-Cola Official Store">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_ik_heb_dit_logo_gekozen_omdat_ik_cola_le_40.png" alt="Coca-Cola" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Coca-Cola</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Beverages</div>
        </div>
      </button>

      <!-- 13. Mastercard -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Mastercard Store">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_discover_the_new_mastercard_logo_31.png" alt="Mastercard" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Mastercard</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Verified Pay</div>
        </div>
      </button>

      <!-- 14. Toyota -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Toyota Official Store">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_la_toyota_es_considerada_como_una_de_la__44.png" alt="Toyota" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Toyota</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Auto & Fleet</div>
        </div>
      </button>

      <!-- 15. Jeep -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Jeep Store">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_jeep_0.png" alt="Jeep" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Jeep</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">4x4 & Offroad</div>
        </div>
      </button>

      <!-- 16. Men's Kicks -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Footwear Vault">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_men_s_shoes_logo_icon_design_illustratio_49.png" alt="Kicks & Shoes" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Sneakers Vault</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Footwear & Kicks</div>
        </div>
      </button>

      <!-- 17. Supermarché -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Supermarket Store">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_shopping_and_buying_products_at_grocery__57.png" alt="Supermarket" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Supermarché</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Fresh Groceries</div>
        </div>
      </button>

      <!-- 18. Smart Electronics -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Smart Electronics">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_smartphone_logo_modern_electronics_vecto_59.png" alt="Smart Tech" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Smart Tech</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Gadgets & Audio</div>
        </div>
      </button>

      <!-- 19. Tech Repair -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Tech Service">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_service_gear_icon_design_template_downlo_55.png" alt="Tech Repair" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Tech Repair</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Certified Care</div>
        </div>
      </button>

      <!-- 20. Marché Douala -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Marché Douala">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_market_logo_design_logo_logodesigner_mar_47.png" alt="Marché Douala" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Marché Douala</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Wholesale Hub</div>
        </div>
      </button>

      <!-- 21. Swift Express -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Swift Express">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_delivery_motorcycle_stock_photos_picture_30.png" alt="Swift Express" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Swift Moto</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Express Delivery</div>
        </div>
      </button>

      <!-- 22. Laptop Depot -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Laptop Depot">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_noutbook_icon_53.png" alt="Laptop Depot" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Laptop Depot</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">PC & Workstations</div>
        </div>
      </button>

      <!-- 23. Loumoo Pay -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Loumoo Pay">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_bank_icon_stock_vector_illustration_of_s_27.png" alt="Loumoo Pay" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Loumoo Pay</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Escrow Banking</div>
        </div>
      </button>

      <!-- 24. Alfred Concierge -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit Alfred Concierge">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_alfred_logo_24.png" alt="Alfred" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">Alfred</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">VIP Concierge</div>
        </div>
      </button>

      <!-- 25. HashiCorp -->
      <button onClick="{{ on.store }}" class="brand-circle-btn" aria-label="Visit HashiCorp">
        <div class="brand-circle-logo-wrap">
          <img src="./Assets/_processed/logo_icons_hashicorp_logo_united_states_38.png" alt="HashiCorp" loading="lazy" />
        </div>
        <div>
          <div style="font:800 12px/1.1 var(--font-heading);color:var(--color-text)">HashiCorp</div>
          <div style="font:500 9.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Dev & Cloud</div>
        </div>
      </button>
    </div>

    <!-- ── 08: LIFE CAPTURED. EVERY ANGLE. (16:9 Lifestyle Video Grid) ── -->
    <div class="editorial-section-header">
      <h2 class="editorial-section-title">Life captured. Every angle.</h2>
      <button onClick="{{ () => openVideoModal('Life on Loumoo Showcase', 'Everyday Creators and Stories in Cameroon', 'COMMUNITY 360') }}" class="editorial-see-all">See more →</button>
    </div>

    <div class="lifestyle-video-grid">
      <!-- 1. Party Decor Ideas (Horizontal) -->
      <div onClick="{{ () => openVideoModal('Party Decor & Vibes', 'Polished birthday and celebration decor ideas for lifestyle creators', 'EVENT DECOR', './Assets/LOUMOO%20VIDEOS/CaptureLIFE/From%20Klickpin.com-%2010%20Beautiful%20birthday%20party%20decor%20ideas%20that%20help%20you%20create%20a%20polished%20look%20with%20very%20simple%20and%20affordable%20details%20for%20creato.mp4') }}" class="lifestyle-card" data-hover-video="true" aria-label="Play Party Decor & Vibes video" style="position:relative;overflow:hidden;border-radius:var(--radius-lg);cursor:pointer;background:#0b0d14">
        <video src="./Assets/LOUMOO%20VIDEOS/CaptureLIFE/From%20Klickpin.com-%2010%20Beautiful%20birthday%20party%20decor%20ideas%20that%20help%20you%20create%20a%20polished%20look%20with%20very%20simple%20and%20affordable%20details%20for%20creato.mp4" poster="./Assets/_processed/capturelife_party_decor_poster.jpg" autoplay muted loop playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;transition:transform 0.4s ease"></video>
        <div class="lifestyle-card-scrim" style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.05) 45%, rgba(0,0,0,0.85) 100%);pointer-events:none;z-index:1"></div>
        <div class="lifestyle-card-pill" style="position:relative;z-index:2;display:flex;justify-content:flex-start">
          <span style="font:700 9.5px/1 var(--font-heading);background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.25);color:#fff;padding:3px 8px;border-radius:var(--radius-pill);letter-spacing:0.04em">EVENT DECOR</span>
        </div>
        <div class="lifestyle-card-meta" style="position:relative;z-index:2">
          <div style="font:800 13.5px/1.2 var(--font-heading);color:#ffffff;text-shadow:0 1px 4px rgba(0,0,0,0.8)">Party Decor Ideas</div>
          <div style="font:500 11px/1 var(--font-body);color:rgba(255,255,255,0.85);margin-top:3px;text-shadow:0 1px 3px rgba(0,0,0,0.8)">Polished celebration details</div>
        </div>
      </div>

      <!-- 2. Dreamy Hair Care (Horizontal) -->
      <div onClick="{{ () => openVideoModal('Dreamy Hair Care', 'Natural curls and intentional hair care routines for everyday beauty', 'GLOW & BEAUTY', './Assets/LOUMOO%20VIDEOS/CaptureLIFE/From%20Klickpin.com-%20Explore%20Dreamy%20curly%20hair%20care%20ideas%20for%20your%20next%20inspiration%20board%20designed%20for%20people%20who%20want%20results%20that%20look%20intentional.mp4') }}" class="lifestyle-card" data-hover-video="true" aria-label="Play Dreamy Hair Care video" style="position:relative;overflow:hidden;border-radius:var(--radius-lg);cursor:pointer;background:#0b0d14">
        <video src="./Assets/LOUMOO%20VIDEOS/CaptureLIFE/From%20Klickpin.com-%20Explore%20Dreamy%20curly%20hair%20care%20ideas%20for%20your%20next%20inspiration%20board%20designed%20for%20people%20who%20want%20results%20that%20look%20intentional.mp4" poster="./Assets/_processed/capturelife_hair_care_poster.jpg" autoplay muted loop playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;transition:transform 0.4s ease"></video>
        <div class="lifestyle-card-scrim" style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.05) 45%, rgba(0,0,0,0.85) 100%);pointer-events:none;z-index:1"></div>
        <div class="lifestyle-card-pill" style="position:relative;z-index:2;display:flex;justify-content:flex-start">
          <span style="font:700 9.5px/1 var(--font-heading);background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.25);color:#fff;padding:3px 8px;border-radius:var(--radius-pill);letter-spacing:0.04em">GLOW & BEAUTY</span>
        </div>
        <div class="lifestyle-card-meta" style="position:relative;z-index:2">
          <div style="font:800 13.5px/1.2 var(--font-heading);color:#ffffff;text-shadow:0 1px 4px rgba(0,0,0,0.8)">Dreamy Hair Care</div>
          <div style="font:500 11px/1 var(--font-body);color:rgba(255,255,255,0.85);margin-top:3px;text-shadow:0 1px 3px rgba(0,0,0,0.8)">Intentional curls & glow</div>
        </div>
      </div>

      <!-- 3. Daily Inspiration Notes (Horizontal) -->
      <div onClick="{{ () => openVideoModal('Daily Inspiration Notes', 'Fresh mindful notes and journaling ideas to keep things grounded', 'CREATIVE NOTES', './Assets/LOUMOO%20VIDEOS/CaptureLIFE/From%20Klickpin.com-%20Fresh%20democracy%20notes%20with%20charm%20and%20useful%20ideas%20for%20daily%20inspiration%20that%20keep%20things%20grounded-pin-id-857654322816019216.mp4') }}" class="lifestyle-card" data-hover-video="true" aria-label="Play Daily Inspiration Notes video" style="position:relative;overflow:hidden;border-radius:var(--radius-lg);cursor:pointer;background:#0b0d14">
        <video src="./Assets/LOUMOO%20VIDEOS/CaptureLIFE/From%20Klickpin.com-%20Fresh%20democracy%20notes%20with%20charm%20and%20useful%20ideas%20for%20daily%20inspiration%20that%20keep%20things%20grounded-pin-id-857654322816019216.mp4" poster="./Assets/_processed/capturelife_creative_notes_poster.jpg" autoplay muted loop playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;transition:transform 0.4s ease"></video>
        <div class="lifestyle-card-scrim" style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.05) 45%, rgba(0,0,0,0.85) 100%);pointer-events:none;z-index:1"></div>
        <div class="lifestyle-card-pill" style="position:relative;z-index:2;display:flex;justify-content:flex-start">
          <span style="font:700 9.5px/1 var(--font-heading);background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.25);color:#fff;padding:3px 8px;border-radius:var(--radius-pill);letter-spacing:0.04em">CREATIVE NOTES</span>
        </div>
        <div class="lifestyle-card-meta" style="position:relative;z-index:2">
          <div style="font:800 13.5px/1.2 var(--font-heading);color:#ffffff;text-shadow:0 1px 4px rgba(0,0,0,0.8)">Daily Inspiration Notes</div>
          <div style="font:500 11px/1 var(--font-body);color:rgba(255,255,255,0.85);margin-top:3px;text-shadow:0 1px 3px rgba(0,0,0,0.8)">Mindful journaling & ideas</div>
        </div>
      </div>

      <!-- 4. Budget Desk Setup (Horizontal) -->
      <div onClick="{{ () => openVideoModal('Budget Desk Setup', 'Budget-friendly office desk styling ideas and workspace inspiration', 'DESK STYLING', './Assets/LOUMOO%20VIDEOS/CaptureLIFE/From%20Klickpin.com-%20Try%20Budget-friendly%20office%20desk%20styling%20for%20your%20next%20Pinterest%20save%20built%20around%20ideas%20that%20are%20easy%20to%20save%20and%20revisit%20later.mp4') }}" class="lifestyle-card" data-hover-video="true" aria-label="Play Budget Desk Setup video" style="position:relative;overflow:hidden;border-radius:var(--radius-lg);cursor:pointer;background:#0b0d14">
        <video src="./Assets/LOUMOO%20VIDEOS/CaptureLIFE/From%20Klickpin.com-%20Try%20Budget-friendly%20office%20desk%20styling%20for%20your%20next%20Pinterest%20save%20built%20around%20ideas%20that%20are%20easy%20to%20save%20and%20revisit%20later.mp4" poster="./Assets/_processed/capturelife_desk_styling_poster.jpg" autoplay muted loop playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;transition:transform 0.4s ease"></video>
        <div class="lifestyle-card-scrim" style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.05) 45%, rgba(0,0,0,0.85) 100%);pointer-events:none;z-index:1"></div>
        <div class="lifestyle-card-pill" style="position:relative;z-index:2;display:flex;justify-content:flex-start">
          <span style="font:700 9.5px/1 var(--font-heading);background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.25);color:#fff;padding:3px 8px;border-radius:var(--radius-pill);letter-spacing:0.04em">DESK STYLING</span>
        </div>
        <div class="lifestyle-card-meta" style="position:relative;z-index:2">
          <div style="font:800 13.5px/1.2 var(--font-heading);color:#ffffff;text-shadow:0 1px 4px rgba(0,0,0,0.8)">Budget Desk Setup</div>
          <div style="font:500 11px/1 var(--font-body);color:rgba(255,255,255,0.85);margin-top:3px;text-shadow:0 1px 3px rgba(0,0,0,0.8)">Smart modern workspace</div>
        </div>
      </div>
    </div>

    <!-- ── 09: BLACK FRIDAY EXPERIENCE (Preserved & Elevated) ── -->
    <div style="margin:8px 0 32px">
      <button onClick="{{ on.freeday }}" aria-label="View Black FreeDay flash sale" style="width:100%;border:1px solid rgba(255,209,0,0.35);border-radius:22px;background:linear-gradient(135deg, #090a0d 0%, #151821 60%, #1e222f 100%);color:#fff;padding:20px 24px;display:flex;align-items:center;justify-content:space-between;text-align:left;box-shadow:0 8px 30px rgba(0,0,0,0.3);cursor:pointer;position:relative;overflow:hidden">
        <!-- Ambient Gold Glow -->
        <div style="position:absolute;top:-20px;right:-20px;width:140px;height:140px;border-radius:50%;background:radial-gradient(circle, rgba(255,209,0,0.22) 0%, transparent 70%);pointer-events:none"></div>
        <div style="position:relative;z-index:2">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font:800 18px/1 var(--font-heading);letter-spacing:-.01em">BLACK <span style="color:var(--color-accent-energy)">FREEDAY</span></span>
            <span style="background:var(--color-accent-energy);color:#111214;font:800 9.5px/1 var(--font-heading);padding:3px 8px;border-radius:var(--radius-pill)">LIVE DEALS</span>
          </div>
          <div style="font:700 11px/1 var(--font-heading);letter-spacing:.08em;margin-top:6px;color:rgba(255,255,255,0.75)">FREE GIFTS · ESCROW PROTECTION · ENDS IN 06:12:44</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;position:relative;z-index:2">
          <span style="font:800 12px/1 var(--font-heading);color:var(--color-accent-energy)">EXPLORE DEALS</span>
          <span style="font:800 18px/1 var(--font-heading);color:var(--color-accent-energy)">→</span>
        </div>
      </button>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════════════
         POST-BLACK FRIDAY: MOBILE-FIRST MARKETPLACE DISCOVERY ENGINE (V2)
         ══════════════════════════════════════════════════════════════════════ -->

    <!-- ── SECTION A: NEW ARRIVALS & LATEST FLAGSHIP DROPS (Horizontal Native Content Rail) ── -->
    <div class="loumoo-rail-section">
      <div class="loumoo-rail-header">
        <div class="loumoo-rail-title-wrap">
          <span class="loumoo-rail-kicker">NEW ARRIVALS & TRENDING</span>
          <h2 class="loumoo-rail-title">Latest Flagship Drops</h2>
          <p class="loumoo-rail-subtitle">Verified devices, audio & fashion arrivals with escrow protection</p>
        </div>
        <div class="loumoo-rail-controls">
          <button onClick="{{ () => openCategory('electronics') }}" class="loumoo-rail-action-link">View all →</button>
          <button onClick="{{ () => scrollRail('newArrivalsRail', -300) }}" class="loumoo-rail-nav-btn" aria-label="Previous products">‹</button>
          <button onClick="{{ () => scrollRail('newArrivalsRail', 300) }}" class="loumoo-rail-nav-btn" aria-label="Next products">›</button>
        </div>
      </div>

      <div class="loumoo-rail-track" id="newArrivalsRail">
        <!-- 1. Apple AirPods Max -->
        <div class="loumoo-media-card" onClick="{{ () => openProduct('airpods_max') }}" aria-label="View Apple AirPods Max">
          <div class="loumoo-card-media-cutout">
            <span class="loumoo-card-badge badge-pill-sale">Save 60.000 FCFA</span>
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('airpods_max', 'Apple AirPods Max'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save Apple AirPods Max to wishlist">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('airpods_max') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('airpods_max') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <img src="./Assets/_processed/acessories_gadgets_apple_air_pod_max_airpodmax_apple_keysho_16.png" alt="Apple AirPods Max" loading="lazy">
          </div>
          <div class="loumoo-card-body">
            <h3 class="loumoo-card-title">Apple AirPods Max</h3>
            <div class="loumoo-card-tagline">High-fidelity over-ear with Active Noise Cancellation &amp; Spatial Audio.</div>
            <div class="loumoo-card-rating-row">
              <span>★ 4.8</span>
              <span class="loumoo-card-rating-text">(87) · iStore Cameroon</span>
            </div>
            <div class="loumoo-card-bottom-row">
              <div class="loumoo-card-pricing-block">
                <span class="loumoo-card-price-prefix">From</span>
                <div class="loumoo-card-price-main">
                  <span class="loumoo-card-price-val">230.000 FCFA</span>
                  <span class="loumoo-card-price-strike">290.000 FCFA</span>
                </div>
                <div class="loumoo-card-trust-pill">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <span>✓ Escrow options available</span>
                </div>
              </div>
              <button class="loumoo-card-pill-btn" aria-label="Buy Apple AirPods Max">Buy now</button>
            </div>
          </div>
        </div>

        <!-- 2. Nike Air Force 1 &#x27;07 -->
        <div class="loumoo-media-card" onClick="{{ () => openProduct('nike_air_force_1') }}" aria-label="View Nike Air Force 1 &#x27;07">
          <div class="loumoo-card-media-cutout">
            <span class="loumoo-card-badge badge-pill-new">New Release</span>
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('nike_air_force_1', 'Nike Air Force 1 &#x27;07'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save Nike Air Force 1 &#x27;07 to wishlist">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('nike_air_force_1') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('nike_air_force_1') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <img src="./Assets/fashion/shoes/Look%20at%20this%20new%20Nike%20Air%20Force.jfif" alt="Nike Air Force 1 &#x27;07" loading="lazy">
          </div>
          <div class="loumoo-card-body">
            <h3 class="loumoo-card-title">Nike Air Force 1 &#x27;07</h3>
            <div class="loumoo-card-tagline">Triple White &#x27;07. The iconic AF1 leather silhouette.</div>
            <div class="loumoo-card-rating-row">
              <span>★ 4.8</span>
              <span class="loumoo-card-rating-text">(240) · Urban Kicks Bonamoussadi</span>
            </div>
            <div class="loumoo-card-bottom-row">
              <div class="loumoo-card-pricing-block">
                <span class="loumoo-card-price-prefix">From</span>
                <div class="loumoo-card-price-main">
                  <span class="loumoo-card-price-val">65.000 FCFA</span>
                  <span class="loumoo-card-price-strike">75.000 FCFA</span>
                </div>
                <div class="loumoo-card-trust-pill">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <span>✓ Escrow options available</span>
                </div>
              </div>
              <button class="loumoo-card-pill-btn" aria-label="Buy Nike Air Force 1 &#x27;07">Buy now</button>
            </div>
          </div>
        </div>

        <!-- 3. DJI Osmo Pocket 3 -->
        <div class="loumoo-media-card" onClick="{{ () => openProduct('dji_osmo_pocket3') }}" aria-label="View DJI Osmo Pocket 3">
          <div class="loumoo-card-media-cutout">
            <span class="loumoo-card-badge badge-pill-sale">Save 130.000 FCFA</span>
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('dji_osmo_pocket3', 'DJI Osmo Pocket 3'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save DJI Osmo Pocket 3 to wishlist">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('dji_osmo_pocket3') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('dji_osmo_pocket3') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <img src="./Assets/acessories&gadgets/DJI%20Osmo%20Pocket%203.jfif" alt="DJI Osmo Pocket 3" loading="lazy">
          </div>
          <div class="loumoo-card-body">
            <h3 class="loumoo-card-title">DJI Osmo Pocket 3</h3>
            <div class="loumoo-card-tagline">1-inch sensor. 4K/120fps. 3-axis gimbal stabilisation.</div>
            <div class="loumoo-card-rating-row">
              <span>★ 4.9</span>
              <span class="loumoo-card-rating-text">(88) · Orca Electronics</span>
            </div>
            <div class="loumoo-card-bottom-row">
              <div class="loumoo-card-pricing-block">
                <span class="loumoo-card-price-prefix">From</span>
                <div class="loumoo-card-price-main">
                  <span class="loumoo-card-price-val">350.000 FCFA</span>
                  <span class="loumoo-card-price-strike">480.000 FCFA</span>
                </div>
                <div class="loumoo-card-trust-pill">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <span>✓ Escrow options available</span>
                </div>
              </div>
              <button class="loumoo-card-pill-btn" aria-label="Buy DJI Osmo Pocket 3">Buy now</button>
            </div>
          </div>
        </div>

        <!-- 4. Galaxy S26 Ultra -->
        <div class="loumoo-media-card" onClick="{{ () => openProduct('galaxy_s26_ultra') }}" aria-label="View Galaxy S26 Ultra">
          <div class="loumoo-card-media-cutout">
            <span class="loumoo-card-badge badge-pill-new">Galaxy AI Inside</span>
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('galaxy_s26_ultra', 'Galaxy S26 Ultra'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save Galaxy S26 Ultra to wishlist">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('galaxy_s26_ultra') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('galaxy_s26_ultra') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <img src="./Assets/telephone&PC/phoneBrands.image/Samsung%20Galaxy%20S26%20Ultra%2C.jfif" alt="Galaxy S26 Ultra" loading="lazy">
          </div>
          <div class="loumoo-card-body">
            <h3 class="loumoo-card-title">Galaxy S26 Ultra</h3>
            <div class="loumoo-card-tagline">256GB Titanium · 200MP Galaxy AI camera &amp; built-in S Pen.</div>
            <div class="loumoo-card-rating-row">
              <span>★ 4.9</span>
              <span class="loumoo-card-rating-text">(118) · Samsung Experience Store</span>
            </div>
            <div class="loumoo-card-bottom-row">
              <div class="loumoo-card-pricing-block">
                <span class="loumoo-card-price-prefix">From</span>
                <div class="loumoo-card-price-main">
                  <span class="loumoo-card-price-val">899.000 FCFA</span>
                  <span class="loumoo-card-price-strike">1.050.000 FCFA</span>
                </div>
                <div class="loumoo-card-trust-pill">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <span>✓ Escrow options available</span>
                </div>
              </div>
              <button class="loumoo-card-pill-btn" aria-label="Buy Galaxy S26 Ultra">Buy now</button>
            </div>
          </div>
        </div>

        <!-- 5. MacBook Air 13” M2 -->
        <div class="loumoo-media-card" onClick="{{ () => openProduct('macbook_m2') }}" aria-label="View MacBook Air 13” M2">
          <div class="loumoo-card-media-cutout">
            <span class="loumoo-card-badge badge-pill-sale">Save 75.000 FCFA</span>
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('macbook_m2', 'MacBook Air 13” M2'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save MacBook Air 13” M2 to wishlist">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('macbook_m2') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('macbook_m2') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <img src="./Assets/telephone&PC/Macbook.jfif" alt="MacBook Air 13” M2" loading="lazy">
          </div>
          <div class="loumoo-card-body">
            <h3 class="loumoo-card-title">MacBook Air 13” M2</h3>
            <div class="loumoo-card-tagline">Apple Silicon M2 · 8GB / 256GB SSD · Space Grey.</div>
            <div class="loumoo-card-rating-row">
              <span>★ 4.9</span>
              <span class="loumoo-card-rating-text">(94) · Orca Electronics Douala</span>
            </div>
            <div class="loumoo-card-bottom-row">
              <div class="loumoo-card-pricing-block">
                <span class="loumoo-card-price-prefix">From</span>
                <div class="loumoo-card-price-main">
                  <span class="loumoo-card-price-val">745.000 FCFA</span>
                  <span class="loumoo-card-price-strike">820.000 FCFA</span>
                </div>
                <div class="loumoo-card-trust-pill">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <span>✓ Escrow options available</span>
                </div>
              </div>
              <button class="loumoo-card-pill-btn" aria-label="Buy MacBook Air 13” M2">Buy now</button>
            </div>
          </div>
        </div>

        <!-- 6. iPhone 17 Pro Max -->
        <div class="loumoo-media-card" onClick="{{ () => openProduct('iphone_17_pro_max') }}" aria-label="View iPhone 17 Pro Max">
          <div class="loumoo-card-media-cutout">
            <span class="loumoo-card-badge badge-pill-new">New Flagship</span>
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('iphone_17_pro_max', 'iPhone 17 Pro Max'); } }}" class="loumoo-card-wishlist-btn" aria-label="Save iPhone 17 Pro Max to wishlist">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted('iphone_17_pro_max') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('iphone_17_pro_max') ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <img src="./Assets/telephone&PC/phoneBrands.image/iPhone%2017%20Pro%20Max%20Colors%20%E2%80%93%20Every%20Stunning%20Finish%20in%20One%20Premium%20Look%20%F0%9F%93%B1%E2%9C%A8.jfif" alt="iPhone 17 Pro Max" loading="lazy">
          </div>
          <div class="loumoo-card-body">
            <h3 class="loumoo-card-title">iPhone 17 Pro Max</h3>
            <div class="loumoo-card-tagline">A19 Pro · 6.9-inch ProMotion · 48MP Pro triple camera.</div>
            <div class="loumoo-card-rating-row">
              <span>★ 4.9</span>
              <span class="loumoo-card-rating-text">(134) · iStore Cameroon</span>
            </div>
            <div class="loumoo-card-bottom-row">
              <div class="loumoo-card-pricing-block">
                <span class="loumoo-card-price-prefix">From</span>
                <div class="loumoo-card-price-main">
                  <span class="loumoo-card-price-val">925.000 FCFA</span>
                  <span class="loumoo-card-price-strike">1.150.000 FCFA</span>
                </div>
                <div class="loumoo-card-trust-pill">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <span>✓ Escrow options available</span>
                </div>
              </div>
              <button class="loumoo-card-pill-btn" aria-label="Buy iPhone 17 Pro Max">Buy now</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 06: LIFE IN MOTION — STORIES REEL (Horizontal Native Content Rail) ── -->
    <div class="loumoo-rail-section">
      <div class="loumoo-rail-header">
        <div class="loumoo-rail-title-wrap">
          <span class="loumoo-rail-kicker">STORIES IN MOTION</span>
          <h2 class="loumoo-rail-title">Life in motion</h2>
          <p class="loumoo-rail-subtitle">Real action clips and creator moments across Cameroon and beyond</p>
        </div>
        <div class="loumoo-rail-controls">
          <button onClick="{{ () => openVideoModal('Life in Motion Stories', 'Curated Video Showcase', 'STORIES') }}" class="loumoo-rail-action-link">Watch all →</button>
          <button onClick="{{ () => scrollRail('storiesMotionRail', -260) }}" class="loumoo-rail-nav-btn" aria-label="Previous stories">‹</button>
          <button onClick="{{ () => scrollRail('storiesMotionRail', 260) }}" class="loumoo-rail-nav-btn" aria-label="Next stories">›</button>
        </div>
      </div>

      <div class="loumoo-rail-track" id="storiesMotionRail">
        <!-- Story 1: Sleep & Wellness Routine -->
        <div class="loumoo-rail-card-story" data-hover-video="true" onClick="{{ () => openVideoModal('Sleep & Wellness Routine', 'Night Routine & Wearables · Wellness Tech', 'WELLNESS', './Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/From%20Klickpin.com-%2083%20Fresh%20Sleep%20Routine%20Tips%20for%20Weekend-pin-id-884253708081290479.mp4') }}" style="position:relative;border-radius:var(--radius-lg);overflow:hidden;cursor:pointer;box-shadow:var(--shadow-sm);transition:transform 0.3s ease;background:#0b0d14" aria-label="Play Sleep Routine story">
          <video src="./Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/From%20Klickpin.com-%2083%20Fresh%20Sleep%20Routine%20Tips%20for%20Weekend-pin-id-884253708081290479.mp4" poster="./Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/poster_3.jpg" autoplay muted loop playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 100%);pointer-events:none"></div>
          <div style="position:absolute;top:12px;left:12px;background:rgba(99,102,241,0.9);color:#fff;font:700 10px var(--font-heading);padding:4px 8px;border-radius:100px;letter-spacing:0.05em">WELLNESS</div>
          <div style="position:absolute;bottom:12px;left:12px;right:12px;pointer-events:none">
            <div style="font:700 14px/1.2 var(--font-heading);color:#fff">Sleep Routine</div>
            <div style="font:400 11px var(--font-body);color:rgba(255,255,255,0.8);margin-top:2px">Rest & Recharge</div>
          </div>
        </div>

        <!-- Story 2: Holiday Air Fryer Inspiration -->
        <div class="loumoo-rail-card-story" data-hover-video="true" onClick="{{ () => openVideoModal('Holiday Air Fryer Recipes', 'Crispy Gourmet Cooking & Modern Kitchen Appliances', 'KITCHEN TECH', './Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/From%20Klickpin.com-%20Air%20Fryer%20Recipes%20Inspiration%20for%20Holiday-pin-id-884253708081290479.mp4') }}" style="position:relative;border-radius:var(--radius-lg);overflow:hidden;cursor:pointer;box-shadow:var(--shadow-sm);transition:transform 0.3s ease;background:#0b0d14" aria-label="Play Air Fryer story">
          <video src="./Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/From%20Klickpin.com-%20Air%20Fryer%20Recipes%20Inspiration%20for%20Holiday-pin-id-884253708081290479.mp4" poster="./Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/poster_6.jpg" autoplay muted loop playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 100%);pointer-events:none"></div>
          <div style="position:absolute;top:12px;left:12px;background:rgba(239,68,68,0.9);color:#fff;font:700 10px var(--font-heading);padding:4px 8px;border-radius:100px;letter-spacing:0.05em">KITCHEN</div>
          <div style="position:absolute;bottom:12px;left:12px;right:12px;pointer-events:none">
            <div style="font:700 14px/1.2 var(--font-heading);color:#fff">Air Fryer Master</div>
            <div style="font:400 11px var(--font-body);color:rgba(255,255,255,0.8);margin-top:2px">Crispy Recipes</div>
          </div>
        </div>

        <!-- Story 3: Summer Outfit Ideas -->
        <div class="loumoo-rail-card-story" data-hover-video="true" onClick="{{ () => openVideoModal('Summer Outfit Ideas', 'Chic Minimalist Wardrobe & Put Together Looks', 'FASHION', './Assets/LOUMOO%20VIDEOS/phoneBrands.videos/From%20Klickpin.com-%20Summer%20Outfit%20Ideas%20That%20Feel%20So%20Put%20Together%2059525-pin-id-222857881555742085.mp4') }}" style="position:relative;border-radius:var(--radius-lg);overflow:hidden;cursor:pointer;box-shadow:var(--shadow-sm);transition:transform 0.3s ease;background:#0b0d14" aria-label="Play Summer Outfits story">
          <video src="./Assets/LOUMOO%20VIDEOS/phoneBrands.videos/From%20Klickpin.com-%20Summer%20Outfit%20Ideas%20That%20Feel%20So%20Put%20Together%2059525-pin-id-222857881555742085.mp4" poster="./Assets/_processed/summer_outfits_poster.jpg" autoplay muted loop playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 100%);pointer-events:none"></div>
          <div style="position:absolute;top:12px;left:12px;background:rgba(245,158,11,0.9);color:#fff;font:700 10px var(--font-heading);padding:4px 8px;border-radius:100px;letter-spacing:0.05em">FASHION</div>
          <div style="position:absolute;bottom:12px;left:12px;right:12px;pointer-events:none">
            <div style="font:700 14px/1.2 var(--font-heading);color:#fff">Summer Outfits</div>
            <div style="font:400 11px var(--font-body);color:rgba(255,255,255,0.8);margin-top:2px">Put Together Chic</div>
          </div>
        </div>

        <!-- Story 4: Clean Girl Makeup -->
        <div class="loumoo-rail-card-story" data-hover-video="true" onClick="{{ () => openVideoModal('Clean Girl Makeup', 'Trending Natural Glow & Fresh Skincare Routine', 'BEAUTY', './Assets/LOUMOO%20VIDEOS/phoneBrands.videos/From%20Klickpin.com-%20Try%20Easy%20clean%20girl%20makeup%20looks%20that%20are%20trending%20right%20now%20across%20Pinterest%20boards%20for%20a%20polished%20look%20people%20will%20notice-pin.mp4') }}" style="position:relative;border-radius:var(--radius-lg);overflow:hidden;cursor:pointer;box-shadow:var(--shadow-sm);transition:transform 0.3s ease;background:#0b0d14" aria-label="Play Clean Girl Makeup story">
          <video src="./Assets/LOUMOO%20VIDEOS/phoneBrands.videos/From%20Klickpin.com-%20Try%20Easy%20clean%20girl%20makeup%20looks%20that%20are%20trending%20right%20now%20across%20Pinterest%20boards%20for%20a%20polished%20look%20people%20will%20notice-pin.mp4" poster="./Assets/_processed/clean_girl_makeup_poster.jpg" autoplay muted loop playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 100%);pointer-events:none"></div>
          <div style="position:absolute;top:12px;left:12px;background:rgba(236,72,153,0.9);color:#fff;font:700 10px var(--font-heading);padding:4px 8px;border-radius:100px;letter-spacing:0.05em">BEAUTY</div>
          <div style="position:absolute;bottom:12px;left:12px;right:12px;pointer-events:none">
            <div style="font:700 14px/1.2 var(--font-heading);color:#fff">Clean Girl Glow</div>
            <div style="font:400 11px var(--font-body);color:rgba(255,255,255,0.8);margin-top:2px">Fresh Minimalist</div>
          </div>
        </div>

        <!-- Story 5: Road Trip Essentials -->
        <div class="loumoo-rail-card-story" data-hover-video="true" onClick="{{ () => openVideoModal('Road Trip Essentials', 'Explore Must-Have Travel Gear & Scenic Road Trips', 'TRAVEL GEAR', './Assets/LOUMOO%20VIDEOS/phoneBrands.videos/From%20Klickpin.com-%20Explore%20Fresh%20road%20trip%20essentials%20that%20are%20trending%20right%20now%20across%20Pinterest%20boards%20for%20ideas%20worth%20saving%20right%20now-pin-id-.mp4') }}" style="position:relative;border-radius:var(--radius-lg);overflow:hidden;cursor:pointer;box-shadow:var(--shadow-sm);transition:transform 0.3s ease;background:#0b0d14" aria-label="Play Road Trip Essentials story">
          <video src="./Assets/LOUMOO%20VIDEOS/phoneBrands.videos/From%20Klickpin.com-%20Explore%20Fresh%20road%20trip%20essentials%20that%20are%20trending%20right%20now%20across%20Pinterest%20boards%20for%20ideas%20worth%20saving%20right%20now-pin-id-.mp4" poster="./Assets/_processed/road_trip_poster.jpg" autoplay muted loop playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 100%);pointer-events:none"></div>
          <div style="position:absolute;top:12px;left:12px;background:rgba(16,185,129,0.9);color:#fff;font:700 10px var(--font-heading);padding:4px 8px;border-radius:100px;letter-spacing:0.05em">ROAD TRIP</div>
          <div style="position:absolute;bottom:12px;left:12px;right:12px;pointer-events:none">
            <div style="font:700 14px/1.2 var(--font-heading);color:#fff">Road Trip Gear</div>
            <div style="font:400 11px var(--font-body);color:rgba(255,255,255,0.8);margin-top:2px">Adventure Ready</div>
          </div>
        </div>

        <!-- Story 6: Mindful Lifestyle & Tech -->
        <div class="loumoo-rail-card-story" data-hover-video="true" onClick="{{ () => openVideoModal('Mindful Lifestyle & Tech', 'Everyday Inspiration & Calm Aesthetics', 'INSPIRATION', './Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/From%20Klickpin.com-%20Thoughtful%20peaceful%20sayings%20that%20fit%20modern%20everyday%20life%20for%20beginners%20for%20modern%20quote%20boards-pin-id-1061090362211983112.mp4') }}" style="position:relative;border-radius:var(--radius-lg);overflow:hidden;cursor:pointer;box-shadow:var(--shadow-sm);transition:transform 0.3s ease;background:#0b0d14" aria-label="Play Mindful Inspiration story">
          <video src="./Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/From%20Klickpin.com-%20Thoughtful%20peaceful%20sayings%20that%20fit%20modern%20everyday%20life%20for%20beginners%20for%20modern%20quote%20boards-pin-id-1061090362211983112.mp4" poster="./Assets/LOUMOO%20VIDEOS/phoneBrands.videos/phone/poster_10.jpg" autoplay muted loop playsinline preload="metadata" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 100%);pointer-events:none"></div>
          <div style="position:absolute;top:12px;left:12px;background:rgba(139,92,246,0.9);color:#fff;font:700 10px var(--font-heading);padding:4px 8px;border-radius:100px;letter-spacing:0.05em">LIFESTYLE</div>
          <div style="position:absolute;bottom:12px;left:12px;right:12px;pointer-events:none">
            <div style="font:700 14px/1.2 var(--font-heading);color:#fff">Mindful Notes</div>
            <div style="font:400 11px var(--font-body);color:rgba(255,255,255,0.8);margin-top:2px">Everyday Calm</div>
          </div>
        </div>
      </div>
    </div>

  <!-- ── SECTION C: COLLECTIONS FOR YOU (Horizontal Native Content Rail) ── -->
    <div class="loumoo-rail-section">
      <div class="loumoo-rail-header">
        <div class="loumoo-rail-title-wrap">
          <span class="loumoo-rail-kicker">CURATED THEMES</span>
          <h2 class="loumoo-rail-title">Collections for you</h2>
          <p class="loumoo-rail-subtitle">Editor-picked essentials and thematic shopping experiences</p>
        </div>
        <div class="loumoo-rail-controls">
          <button onClick="{{ on.bestpicks }}" class="loumoo-rail-action-link">See all →</button>
          <button onClick="{{ () => scrollRail('collectionsForYouRail', -240) }}" class="loumoo-rail-nav-btn" aria-label="Previous collections">‹</button>
          <button onClick="{{ () => scrollRail('collectionsForYouRail', 240) }}" class="loumoo-rail-nav-btn" aria-label="Next collections">›</button>
        </div>
      </div>

      <div class="loumoo-rail-track" id="collectionsForYouRail">
        <!-- 1. Luxury Weekend Getaways -->
        <div onClick="{{ on.bestpicks }}" class="collection-v2-card" style="background:#734738" aria-label="Explore Luxury Weekend Getaways Collection">
          <video src="./Assets/LOUMOO%20VIDEOS/Collection/From%20Klickpin.com-%20Luxury%20weekend%20getaway%20ideas%20that%20are%20trending%20right%20now%20and%20still%20timeless%20enough%20to%20save%20for%20later%20for%20anyone%20planning%20a%20beau.mp4" data-ambient="true" muted loop playsinline preload="none" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 100%);pointer-events:none"></div>
          <div class="coll-card-content" style="position:relative;z-index:1">
            <div class="coll-card-title">Luxury Weekend<br><span style="font-weight:500;font-size:12px;opacity:0.9">Getaway Ideas</span></div>
          </div>
        </div>

        <!-- 2. Back to School Ideas -->
        <div onClick="{{ on.bestpicks }}" class="collection-v2-card" style="background:#b0acab" aria-label="Explore Back to School Ideas Collection">
          <video src="./Assets/LOUMOO%20VIDEOS/Collection/From%20Klickpin.com-%20Recreate%20this%20guide%20to%20clever%20back-to-school%20ideas%20that%20look%20high-end%20but%20stay%20practical%20with%20smart%20steps%20cute%20details%20and%20cozy.mp4" data-ambient="true" muted loop playsinline preload="none" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 100%);pointer-events:none"></div>
          <div class="coll-card-content" style="position:relative;z-index:1">
            <div class="coll-card-title">Back to School<br><span style="font-weight:500;font-size:12px;opacity:0.9">Clever &amp; Cozy</span></div>
          </div>
        </div>

        <!-- 3. Modern Healthy Lifestyle -->
        <div onClick="{{ on.bestpicks }}" class="collection-v2-card" style="background:#4a4549" aria-label="Explore Modern Healthy Lifestyle Collection">
          <video src="./Assets/LOUMOO%20VIDEOS/Collection/From%20Klickpin.com-%20Modern%20Healthy%20Lifestyle%20Tips%20Worth%20Trying-pin-id-1042020432508729854.mp4" data-ambient="true" muted loop playsinline preload="none" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 100%);pointer-events:none"></div>
          <div class="coll-card-content" style="position:relative;z-index:1">
            <div class="coll-card-title">Healthy Lifestyle<br><span style="font-weight:500;font-size:12px;opacity:0.9">Wellness Tips</span></div>
          </div>
        </div>

        <!-- 4. Fall Jacket Styling -->
        <div onClick="{{ on.bestpicks }}" class="collection-v2-card" style="background:#9d8563" aria-label="Explore Fall Jacket Styling Collection">
          <video src="./Assets/LOUMOO%20VIDEOS/Collection/From%20Klickpin.com-%20Need%20fresh%20inspiration%20Style%20these%20easy%20fall%20jacket%20ideas%20that%20turn%20ordinary%20ideas%20into%20scroll-stopping%20inspiration%20with%20realis%20%281%29.mp4" data-ambient="true" muted loop playsinline preload="none" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 100%);pointer-events:none"></div>
          <div class="coll-card-content" style="position:relative;z-index:1">
            <div class="coll-card-title">Fall Jacket Style<br><span style="font-weight:500;font-size:12px;opacity:0.9">Easy Autumn Looks</span></div>
          </div>
        </div>

        <!-- 5. Elegant Spring Garden -->
        <div onClick="{{ on.bestpicks }}" class="collection-v2-card" style="background:#858992" aria-label="Explore Elegant Spring Garden Collection">
          <video src="./Assets/LOUMOO%20VIDEOS/Collection/From%20Klickpin.com-%20Recreate%20this%20elegant%20spring%20garden%20roundup%20perfect%20for%20saving%20sharing%20and%20recreating%20later%20with%20beginner-friendly%20tips%20and%20eas.mp4" data-ambient="true" muted loop playsinline preload="none" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 100%);pointer-events:none"></div>
          <div class="coll-card-content" style="position:relative;z-index:1">
            <div class="coll-card-title">Spring Garden<br><span style="font-weight:500;font-size:12px;opacity:0.9">Elegant Roundup</span></div>
          </div>
        </div>

        <!-- 6. Trending Now -->
        <div onClick="{{ on.bestpicks }}" class="collection-v2-card" style="background:#55595e" aria-label="Explore Trending Now Collection">
          <video src="./Assets/LOUMOO%20VIDEOS/Collection/From%20Klickpin.com-%20962714857851057920-pin-id-962714857851057920.mp4" data-ambient="true" muted loop playsinline preload="none" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
          <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 100%);pointer-events:none"></div>
          <div class="coll-card-content" style="position:relative;z-index:1">
            <div class="coll-card-title">Trending Now<br><span style="font-weight:500;font-size:12px;opacity:0.9">Fresh Daily Drops</span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── SECTION D: BEST OF FASHION (Horizontal Native Content Rail) ── -->
    <div class="loumoo-rail-section">
      <div class="loumoo-rail-header">
        <div class="loumoo-rail-title-wrap">
          <span class="loumoo-rail-kicker">STREETWEAR & LUXURY</span>
          <h2 class="loumoo-rail-title">Best of fashion</h2>
          <p class="loumoo-rail-subtitle">Trending streetwear, heritage tailoring and luxury accessories</p>
        </div>
        <div class="loumoo-rail-controls">
          <button onClick="{{ () => openCategory('fashion') }}" class="loumoo-rail-action-link">See all →</button>
          <button onClick="{{ () => scrollRail('fashionRail', -285) }}" class="loumoo-rail-nav-btn" aria-label="Previous fashion items">‹</button>
          <button onClick="{{ () => scrollRail('fashionRail', 285) }}" class="loumoo-rail-nav-btn" aria-label="Next fashion items">›</button>
        </div>
      </div>

      <div class="loumoo-rail-track" id="fashionRail">
        <div class="discovery-product-card" onClick="{{ () => openProduct('nike_air_force_1') }}" style="cursor:pointer">
          <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('nike_air_force_1', 'Nike Air Force 1'); } }}" class="wishlist-float-btn" aria-label="Save Nike Air Force 1 to wishlist">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('nike_air_force_1') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('nike_air_force_1') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <img src="./Assets/fashion/shoes/Look%20at%20this%20new%20Nike%20Air%20Force.jfif" alt="Nike Air Force 1 &#x27;07" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
          </div>
          <div class="disc-card-body">
            <div class="disc-card-name">Nike Air Force 1</div>
            <div class="disc-card-sub">Triple White &#x27;07</div>
            <div class="disc-card-price">65.000 FCFA</div>
          </div>
        </div>

        <div class="discovery-product-card" onClick="{{ () => openProduct('chelsea_boots') }}" style="cursor:pointer">
          <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('chelsea_boots', 'Chelsea Boots'); } }}" class="wishlist-float-btn" aria-label="Save Chelsea Boots to wishlist">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('chelsea_boots') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('chelsea_boots') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <img src="./Assets/fashion/shoes/Kraasa%20Men%27s%20Slip%20On%20Fashion%20Chelsea%20Boots.jfif" alt="Kraasa Suede Chelsea Ankle Boots" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
          </div>
          <div class="disc-card-body">
            <div class="disc-card-name">Chelsea Boots</div>
            <div class="disc-card-sub">Suede Slip-On</div>
            <div class="disc-card-price">42.000 FCFA</div>
          </div>
        </div>

        <div class="discovery-product-card" onClick="{{ () => openProduct('dress_loafers') }}" style="cursor:pointer">
          <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('dress_loafers', 'Dress Loafers'); } }}" class="wishlist-float-btn" aria-label="Save Dress Loafers to wishlist">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('dress_loafers') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('dress_loafers') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <img src="./Assets/fashion/shoes/Timeless%20Elegance%20Luxury%20Black%20&%20White%20Dress%20Loafers.jfif" alt="Timeless Black &amp; White Dress Loafers" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
          </div>
          <div class="disc-card-body">
            <div class="disc-card-name">Dress Loafers</div>
            <div class="disc-card-sub">Black &amp; White Spectator</div>
            <div class="disc-card-price">48.000 FCFA</div>
          </div>
        </div>

        <div class="discovery-product-card" onClick="{{ () => openProduct('leather_satchel') }}" style="cursor:pointer">
          <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('leather_satchel', 'Leather Satchel'); } }}" class="wishlist-float-btn" aria-label="Save Leather Satchel to wishlist">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('leather_satchel') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('leather_satchel') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <img src="./Assets/fashion/handbag/Luxury%20Designer%20Leather%20Satchels%20&%20Monogram%20Clutches%20_%20Handbag%20Collection.jfif" alt="Designer Monogram Leather Satchel" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
          </div>
          <div class="disc-card-body">
            <div class="disc-card-name">Leather Satchel</div>
            <div class="disc-card-sub">Monogram Structured</div>
            <div class="disc-card-price">55.000 FCFA</div>
          </div>
        </div>

        <div class="discovery-product-card" onClick="{{ () => openProduct('stiletto_heels') }}" style="cursor:pointer">
          <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('stiletto_heels', 'Banquet Stilettos'); } }}" class="wishlist-float-btn" aria-label="Save Banquet Stilettos to wishlist">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('stiletto_heels') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('stiletto_heels') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <img src="./Assets/fashion/shoes/Shoes%20Women%2010%20Cm%20Metal%20Buckle%20Ladies%20Pumps%20Luxury%20Womens%20Banquet%20Shoes%20Stilettos%20High%20Heels%20Women%20Sexy%20Party%20Shoes.jfif" alt="Metal-Buckle Banquet Stiletto Heels" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
          </div>
          <div class="disc-card-body">
            <div class="disc-card-name">Banquet Stilettos</div>
            <div class="disc-card-sub">10cm Metal Buckle</div>
            <div class="disc-card-price">38.000 FCFA</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── SECTION E: TECH YOU'LL LOVE (Horizontal Native Content Rail) ── -->
    <div class="loumoo-rail-section">
      <div class="loumoo-rail-header">
        <div class="loumoo-rail-title-wrap">
          <span class="loumoo-rail-kicker">SMART HARDWARE</span>
          <h2 class="loumoo-rail-title">Tech you'll love</h2>
          <p class="loumoo-rail-subtitle">High-performance tablets, chargers, and studio audio gear</p>
        </div>
        <div class="loumoo-rail-controls">
          <button onClick="{{ () => openCategory('electronics') }}" class="loumoo-rail-action-link">See all →</button>
          <button onClick="{{ () => scrollRail('techRail', -285) }}" class="loumoo-rail-nav-btn" aria-label="Previous tech items">‹</button>
          <button onClick="{{ () => scrollRail('techRail', 285) }}" class="loumoo-rail-nav-btn" aria-label="Next tech items">›</button>
        </div>
      </div>

      <div class="loumoo-rail-track" id="techRail">
        <div class="discovery-product-card" onClick="{{ () => openProduct('iphone_17_pro_max') }}" style="cursor:pointer">
          <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('iphone_17_pro_max', 'iPhone 17 Pro Max'); } }}" class="wishlist-float-btn" aria-label="Save iPhone 17 Pro Max to wishlist">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('iphone_17_pro_max') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('iphone_17_pro_max') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <img src="./Assets/telephone&PC/phoneBrands.image/iPhone%2017%20Pro%20Max%20Colors%20%E2%80%93%20Every%20Stunning%20Finish%20in%20One%20Premium%20Look%20%F0%9F%93%B1%E2%9C%A8.jfif" alt="Apple iPhone 17 Pro Max 256GB" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
          </div>
          <div class="disc-card-body">
            <div class="disc-card-name">iPhone 17 Pro Max</div>
            <div class="disc-card-sub">256GB · Titanium</div>
            <div class="disc-card-price">925.000 FCFA</div>
          </div>
        </div>

        <div class="discovery-product-card" onClick="{{ () => openProduct('na_pixel_10_pro_05') }}" style="cursor:pointer">
          <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('na_pixel_10_pro_05', 'Pixel 10 Pro XL'); } }}" class="wishlist-float-btn" aria-label="Save Pixel 10 Pro XL to wishlist">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('na_pixel_10_pro_05') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('na_pixel_10_pro_05') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <img src="./Assets/telephone&PC/phoneBrands.image/Google%20Pixel%2010%20Pro%20XL%20_%20Latest%20Google%20Smartphone%20with%20Advanced%20Camera%20&%20AI%20Features.jfif" alt="Google Pixel 10 Pro XL" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
          </div>
          <div class="disc-card-body">
            <div class="disc-card-name">Pixel 10 Pro XL</div>
            <div class="disc-card-sub">256GB Google AI</div>
            <div class="disc-card-price">650.000 FCFA</div>
          </div>
        </div>

        <div class="discovery-product-card" onClick="{{ () => openProduct('surface_laptop') }}" style="cursor:pointer">
          <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('surface_laptop', 'Surface Laptop'); } }}" class="wishlist-float-btn" aria-label="Save Surface Laptop to wishlist">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('surface_laptop') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('surface_laptop') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <img src="./Assets/telephone&PC/Microsoft%20Surface%20Laptop_%20Overview.jfif" alt="Microsoft Surface Laptop 13.8&quot;" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
          </div>
          <div class="disc-card-body">
            <div class="disc-card-name">Surface Laptop</div>
            <div class="disc-card-sub">13.8” Touch 512GB</div>
            <div class="disc-card-price">685.000 FCFA</div>
          </div>
        </div>

        <div class="discovery-product-card" onClick="{{ () => openProduct('alexa_speaker') }}" style="cursor:pointer">
          <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('alexa_speaker', 'Alexa Smart Speaker'); } }}" class="wishlist-float-btn" aria-label="Save Alexa Smart Speaker to wishlist">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('alexa_speaker') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('alexa_speaker') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <img src="./Assets/acessories&gadgets/Alexa%20Smart%20Speaker%20with%20LED%20Light%20Ring%20%E2%80%93%20Compact%20Voice%20Assistant.jfif" alt="Alexa Smart Speaker with LED Ring" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
          </div>
          <div class="disc-card-body">
            <div class="disc-card-name">Alexa Smart Speaker</div>
            <div class="disc-card-sub">LED Voice Assistant</div>
            <div class="disc-card-price">32.000 FCFA</div>
          </div>
        </div>

        <div class="discovery-product-card" onClick="{{ () => openProduct('apple_airtag') }}" style="cursor:pointer">
          <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('apple_airtag', 'Apple AirTag'); } }}" class="wishlist-float-btn" aria-label="Save Apple AirTag to wishlist">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('apple_airtag') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('apple_airtag') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <img src="./Assets/telephone&PC/Best%20Selling%20Apple%20AirTag%21.jfif" alt="Apple AirTag Item Tracker" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
          </div>
          <div class="disc-card-body">
            <div class="disc-card-name">Apple AirTag</div>
            <div class="disc-card-sub">Find My Tracker</div>
            <div class="disc-card-price">18.000 FCFA</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── SECTION F: TRAVEL THE WORLD (Horizontal Native Content Rail) ── -->
    <div class="loumoo-rail-section">
      <div class="loumoo-rail-header">
        <div class="loumoo-rail-title-wrap">
          <span class="loumoo-rail-kicker">MOBILITY & STAYS</span>
          <h2 class="loumoo-rail-title">Travel the world</h2>
          <p class="loumoo-rail-subtitle">Instant bookings for VIP intercity buses, luxury hotel suites, and flights</p>
        </div>
        <div class="loumoo-rail-controls">
          <button onClick="{{ on.travel }}" class="loumoo-rail-action-link">See all →</button>
          <button onClick="{{ () => scrollRail('travelWorldRail', -200) }}" class="loumoo-rail-nav-btn" aria-label="Previous mobility options">‹</button>
          <button onClick="{{ () => scrollRail('travelWorldRail', 200) }}" class="loumoo-rail-nav-btn" aria-label="Next mobility options">›</button>
        </div>
      </div>

      <div class="loumoo-rail-track" id="travelWorldRail" style="gap:24px;padding:8px 4px 14px 4px">
        <!-- 1. Hotels -->
        <button onClick="{{ () => openCategory('hotels') }}" class="travel-squircle-card" aria-label="Travel Hotels">
          <div class="travel-squircle-icon-wrap">
            <img src="./Assets/_processed/logo_icons_tourist_icon_flat_style_isolated_on_whit_61.png" alt="Hotels">
          </div>
          <span class="travel-squircle-label">Hotels</span>
        </button>

        <!-- 2. Flights -->
        <button onClick="{{ () => { setTravelTabFlight(); on.travel(); } }}" class="travel-squircle-card" aria-label="Travel Flights">
          <div class="travel-squircle-icon-wrap">
            <img src="./Assets/_processed/logo_icons_travel_logo_png_images_travel_icons_logo_63.png" alt="Flights">
          </div>
          <span class="travel-squircle-label">Flights</span>
        </button>

        <!-- 3. Buses -->
        <button onClick="{{ () => { setTravelTabBus(); on.travel(); } }}" class="travel-squircle-card" aria-label="Travel Buses">
          <div class="travel-squircle-icon-wrap">
            <img src="./Assets/_processed/logo_icons_travel_bus.png" alt="Buses">
          </div>
          <span class="travel-squircle-label">Buses</span>
        </button>

        <!-- 4. Trains -->
        <button onClick="{{ () => { setTravelTabTrain(); on.travel(); } }}" class="travel-squircle-card" aria-label="Travel Trains">
          <div class="travel-squircle-icon-wrap">
            <img src="./Assets/_processed/logo_icons_travel_logo_image_premium_vector_62.png" alt="Trains">
          </div>
          <span class="travel-squircle-label">Trains</span>
        </button>

        <!-- 5. Taxi -->
        <button onClick="{{ () => { setTravelTabTaxi(); on.travel(); } }}" class="travel-squircle-card" aria-label="Travel Taxi">
          <div class="travel-squircle-icon-wrap">
            <img src="./Assets/_processed/logo_icons_la_toyota_es_considerada_como_una_de_la__44.png" alt="Taxi">
          </div>
          <span class="travel-squircle-label">Taxi</span>
        </button>

        <!-- 6. Car Rental -->
        <button onClick="{{ on.travel }}" class="travel-squircle-card" aria-label="Travel Car Rental">
          <div class="travel-squircle-icon-wrap">
            <img src="./Assets/_processed/logo_icons_jeep_0.png" alt="Car Rental">
          </div>
          <span class="travel-squircle-label">Car Rental</span>
        </button>
      </div>
    </div>

    <!-- ── SECTION G: EDITORIAL BANNER (LOUMOO Marketplace for Africa) ── -->
    <div class="marketplace-africa-banner">
      <div class="africa-banner-left">
        <div class="africa-banner-eyebrow">LOUMOO</div>
        <h3 class="africa-banner-heading">Marketplace for Africa.</h3>
        <p class="africa-banner-sub">Discover authentic African fashion, cutting-edge tech, luxury stays & travel across CEMAC and beyond.</p>
        <button onClick="{{ openAllCategories }}" class="africa-banner-btn">Start exploring →</button>
      </div>
      <div class="africa-banner-right">
        <div class="africa-banner-img-frame" style="position:relative;width:100%;max-width:380px;height:250px;border-radius:20px;overflow:hidden;background:#f1ebef;margin-left:auto">
          <img src="./Assets/fashion/EnsembleModel/THE%20UNPUNISHABLE%20WOMAN.jfif" alt="THE UNPUNISHABLE WOMAN — LOUMOO African Fashion" style="width:100%;height:100%;object-fit:cover;object-position:center 20%;display:block;transition:transform 0.4s ease">
          <div style="position:absolute;bottom:12px;left:14px;display:flex;align-items:center;gap:6px">
            <span style="background:rgba(26,21,35,0.75);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#ffffff;font:800 11px/1 var(--font-heading);padding:5px 12px;border-radius:9999px;letter-spacing:0.04em;text-transform:uppercase">The Unpunishable Woman</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── SECTION H: RECENTLY VIEWED (2-col mobile / 4-col desktop) ── -->
    <div class="editorial-section-header">
      <h2 class="editorial-section-title">Recently viewed</h2>
      <button onClick="{{ on.orders }}" class="editorial-see-all">See all →</button>
    </div>

    <div class="discovery-product-grid">
      <div class="discovery-product-card" onClick="{{ () => openProduct('macbook_m2') }}" style="cursor:pointer">
        <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('macbook_m2', 'MacBook Air M2'); } }}" class="wishlist-float-btn" aria-label="Save MacBook Air M2 to wishlist">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('macbook_m2') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('macbook_m2') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/telephone&PC/Macbook.jfif" alt="Apple MacBook Air M2" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
        </div>
        <div class="disc-card-body">
          <div class="disc-card-name">MacBook Air M2</div>
          <div class="disc-card-sub">13-inch Midnight</div>
          <div class="disc-card-price">745.000 FCFA</div>
        </div>
      </div>

      <div class="discovery-product-card" onClick="{{ () => openProduct('ps5_slim') }}" style="cursor:pointer">
        <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('ps5_slim', 'PlayStation 5'); } }}" class="wishlist-float-btn" aria-label="Save PlayStation 5 to wishlist">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('ps5_slim') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('ps5_slim') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/telephone&PC/phoneBrands.image/316800155055565523.jfif" alt="Sony PlayStation 5 Slim" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
        </div>
        <div class="disc-card-body">
          <div class="disc-card-name">PlayStation 5</div>
          <div class="disc-card-sub">Slim Edition 1TB</div>
          <div class="disc-card-price">380.000 FCFA</div>
        </div>
      </div>

      <div class="discovery-product-card" onClick="{{ () => openProduct('airpods_4') }}" style="cursor:pointer">
        <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('airpods_4', 'AirPods 4'); } }}" class="wishlist-float-btn" aria-label="Save AirPods 4 to wishlist">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('airpods_4') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('airpods_4') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/acessories&gadgets/Apple%20AirPods%204%20%F0%9F%8E%A7%20Active%20Noise%20Cancellation%20_%20Premium%20Sound%20for%20Less%21%20%F0%9F%8D%8E.jfif" alt="Apple AirPods 4 (ANC)" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
        </div>
        <div class="disc-card-body">
          <div class="disc-card-name">AirPods 4</div>
          <div class="disc-card-sub">Active Noise Cancelling</div>
          <div class="disc-card-price">95.000 FCFA</div>
        </div>
      </div>

      <div class="discovery-product-card" onClick="{{ () => openProduct('galaxy_s26_ultra') }}" style="cursor:pointer">
        <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('galaxy_s26_ultra', 'Galaxy S26 Ultra'); } }}" class="wishlist-float-btn" aria-label="Save Galaxy S26 Ultra to wishlist">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('galaxy_s26_ultra') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('galaxy_s26_ultra') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/telephone&PC/phoneBrands.image/Samsung%20Galaxy%20S26%20Ultra%2C.jfif" alt="Samsung Galaxy S26 Ultra 256GB" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
        </div>
        <div class="disc-card-body">
          <div class="disc-card-name">Galaxy S26 Ultra</div>
          <div class="disc-card-sub">256GB · Titanium</div>
          <div class="disc-card-price">899.000 FCFA</div>
        </div>
      </div>
    </div>

    <!-- ── SECTION I: MORE TO EXPLORE (Category Editorial Tiles) ── -->
    <div class="editorial-section-header">
      <h2 class="editorial-section-title">More to explore</h2>
      <button onClick="{{ openAllCategories }}" class="editorial-see-all">See all →</button>
    </div>

    <div class="more-explore-grid">
      <!-- 1. Home (Make it yours) -->
      <div onClick="{{ () => openCategory('home') }}" class="more-explore-card" aria-label="Explore Home Category">
        <img class="more-explore-bg" src="./Assets/ElectroMenage/Make%20Great%20Coffee%20at%20Home.jfif" alt="Home and Living Collection" loading="lazy">
        <div class="more-explore-overlay"></div>
        <div class="more-explore-top-bar">
          <span class="more-explore-badge">✦ 47+ Curated</span>
          <div class="more-explore-play" title="Explore Home & Living">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
        <div class="more-explore-bottom-content">
          <div class="more-explore-text">
            <div class="more-explore-title">Home</div>
            <div class="more-explore-sub">Make it yours</div>
          </div>
          <div class="more-explore-product-pill" onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); openProduct('home_station_expresso_infusion_barista_maison'); } }}" title="View best product: Station Expresso Barista">
            <img class="more-explore-product-thumb" src="./Assets/ElectroMenage/Make%20Great%20Coffee%20at%20Home.jfif" alt="Station Expresso Barista" loading="lazy">
            <div class="more-explore-product-info">
              <span class="more-explore-product-name">Station Expresso Barista</span>
              <div class="more-explore-product-price-box">
                <span class="more-explore-product-price">XAF 68.000</span>
                <span class="more-explore-product-orig">XAF 85.000</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Beauty (Glow Everyday) -->
      <div onClick="{{ () => openCategory('beauty') }}" class="more-explore-card" aria-label="Explore Beauty Category">
        <img class="more-explore-bg" src="./Assets/perfume&lotion/Boss%20Bottled%20Night%20by%20Hugo%20Boss%20_%20100ml%20EDT%20_%20Woody%20Aromatic%20Fragrance%20_%20Gift%20for%20him,%20Fathers%20day.jfif" alt="Beauty and Wellness Collection" loading="lazy">
        <div class="more-explore-overlay"></div>
        <div class="more-explore-top-bar">
          <span class="more-explore-badge">✦ Luxury Scents</span>
          <div class="more-explore-play" title="Explore Beauty & Wellness">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
        <div class="more-explore-bottom-content">
          <div class="more-explore-text">
            <div class="more-explore-title">Beauty</div>
            <div class="more-explore-sub">Glow Everyday</div>
          </div>
          <div class="more-explore-product-pill" onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); openProduct('beauty_boss_bottled_night_100ml_edt'); } }}" title="View best product: Hugo Boss Bottled Night 100ml">
            <img class="more-explore-product-thumb" src="./Assets/perfume&lotion/Boss%20Bottled%20Night%20by%20Hugo%20Boss%20_%20100ml%20EDT%20_%20Woody%20Aromatic%20Fragrance%20_%20Gift%20for%20him,%20Fathers%20day.jfif" alt="Hugo Boss Bottled Night 100ml" loading="lazy">
            <div class="more-explore-product-info">
              <span class="more-explore-product-name">Boss Bottled Night 100ml</span>
              <div class="more-explore-product-price-box">
                <span class="more-explore-product-price">XAF 42.000</span>
                <span class="more-explore-product-orig">XAF 55.000</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Sports (Push Limits) -->
      <div onClick="{{ () => openCategory('sports') }}" class="more-explore-card" aria-label="Explore Sports Category">
        <img class="more-explore-bg" src="./Assets/_processed/sports_editorial_banner.jpg" alt="Sports and Active Gear Collection" loading="lazy">
        <div class="more-explore-overlay"></div>
        <div class="more-explore-top-bar">
          <span class="more-explore-badge">✦ Top Gear</span>
          <div class="more-explore-play" title="Explore Sports & Gear">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
        <div class="more-explore-bottom-content">
          <div class="more-explore-text">
            <div class="more-explore-title">Sports</div>
            <div class="more-explore-sub">Push Limits</div>
          </div>
          <div class="more-explore-product-pill" onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); openProduct('sport_nike_joyride_running_cushion_sneakers'); } }}" title="View best product: Nike Joyride Dual Run">
            <img class="more-explore-product-thumb" src="./Assets/fashion/shoes/Nike%27s%20Joyride%20Collection%20Is%20Designed%20to%20Make%20Your%20Running%20Routine%20Easier%20Than%20Ever.jfif" alt="Nike Joyride Dual Run" loading="lazy">
            <div class="more-explore-product-info">
              <span class="more-explore-product-name">Nike Joyride Dual Run</span>
              <div class="more-explore-product-price-box">
                <span class="more-explore-product-price">XAF 44.500</span>
                <span class="more-explore-product-orig">XAF 58.000</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 4. Groceries (Daily Needs) -->
      <div onClick="{{ () => openCategory('groceries') }}" class="more-explore-card" aria-label="Explore Groceries Category">
        <img class="more-explore-bg" src="./Assets/_processed/groceries_editorial_banner.jpg" alt="Groceries and Daily Essentials Collection" loading="lazy">
        <div class="more-explore-overlay"></div>
        <div class="more-explore-top-bar">
          <span class="more-explore-badge">✦ Fresh Daily</span>
          <div class="more-explore-play" title="Explore Groceries & Food">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
        <div class="more-explore-bottom-content">
          <div class="more-explore-text">
            <div class="more-explore-title">Groceries</div>
            <div class="more-explore-sub">Daily Needs</div>
          </div>
          <div class="more-explore-product-pill" onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); openProduct('groc_panier_recolte_bio_maraicher'); } }}" title="View best product: Panier Bio Récolte 10kg">
            <img class="more-explore-product-thumb" src="./Assets/_processed/groceries_editorial_banner.jpg" alt="Panier Récolte Bio 10kg" loading="lazy">
            <div class="more-explore-product-info">
              <span class="more-explore-product-name">Panier Bio Récolte 10kg</span>
              <div class="more-explore-product-price-box">
                <span class="more-explore-product-price">XAF 14.500</span>
                <span class="more-explore-product-orig">XAF 18.500</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── SECTION J: POPULAR RIGHT NOW (2-col mobile / 4-col desktop) ── -->
    <div class="editorial-section-header">
      <h2 class="editorial-section-title">Popular right now</h2>
      <button onClick="{{ on.bestpicks }}" class="editorial-see-all">See all →</button>
    </div>

    <div class="discovery-product-grid">
      <div class="discovery-product-card" onClick="{{ () => openProduct('dji_osmo_pocket3') }}" style="cursor:pointer">
        <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('dji_osmo_pocket3', 'DJI Osmo Pocket 3'); } }}" class="wishlist-float-btn" aria-label="Save DJI Osmo Pocket 3 to wishlist">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('dji_osmo_pocket3') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('dji_osmo_pocket3') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/acessories&gadgets/DJI%20Osmo%20Pocket%203.jfif" alt="DJI Osmo Pocket 3 Creator Combo" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
        </div>
        <div class="disc-card-body">
          <div class="disc-card-name">DJI Osmo Pocket 3</div>
          <div class="disc-card-sub">1” 4K Gimbal Cam</div>
          <div class="disc-card-price">350.000 FCFA</div>
        </div>
      </div>

      <div class="discovery-product-card" onClick="{{ () => openProduct('jbl_flip6') }}" style="cursor:pointer">
        <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('jbl_flip6', 'JBL Flip 6'); } }}" class="wishlist-float-btn" aria-label="Save JBL Flip 6 to wishlist">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('jbl_flip6') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('jbl_flip6') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/acessories&gadgets/JBL%20Flip%206%20-%20F%C4%B1rat%20T%C3%BCz%C3%BCnkan.jfif" alt="JBL Flip 6 Portable Speaker" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
        </div>
        <div class="disc-card-body">
          <div class="disc-card-name">JBL Flip 6</div>
          <div class="disc-card-sub">30W IP67 Waterproof</div>
          <div class="disc-card-price">89.000 FCFA</div>
        </div>
      </div>

      <div class="discovery-product-card" onClick="{{ () => openProduct('tecno_camon40') }}" style="cursor:pointer">
        <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('tecno_camon40', 'TECNO Camon 40'); } }}" class="wishlist-float-btn" aria-label="Save TECNO Camon 40 to wishlist">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('tecno_camon40') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('tecno_camon40') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/telephone&PC/phoneBrands.image/TECNO%20CAMON%2040%20Series_%20Redefining%20Imagery%20with%C2%A0TECNO%C2%A0AI.jfif" alt="TECNO Camon 40 Series 256GB" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
        </div>
        <div class="disc-card-body">
          <div class="disc-card-name">TECNO Camon 40</div>
          <div class="disc-card-sub">AI Camera 256GB</div>
          <div class="disc-card-price">155.000 FCFA</div>
        </div>
      </div>

      <div class="discovery-product-card" onClick="{{ () => openProduct('na_pixel_10_pro_05') }}" style="cursor:pointer">
        <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('na_pixel_10_pro_05', 'Pixel 10 Pro XL'); } }}" class="wishlist-float-btn" aria-label="Save Pixel 10 Pro XL to wishlist">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('na_pixel_10_pro_05') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('na_pixel_10_pro_05') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="./Assets/telephone&PC/phoneBrands.image/Google%20Pixel%2010%20Pro%20XL%20_%20Latest%20Google%20Smartphone%20with%20Advanced%20Camera%20&%20AI%20Features.jfif" alt="Google Pixel 10 Pro XL" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
        </div>
        <div class="disc-card-body">
          <div class="disc-card-name">Pixel 10 Pro XL</div>
          <div class="disc-card-sub">256GB Google AI</div>
          <div class="disc-card-price">650.000 FCFA</div>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════════════
         INFINITE COMMERCE FEED: DYNAMIC CONTENT ORCHESTRATION BATCHES
         ══════════════════════════════════════════════════════════════════════ -->

    <!-- ── INFINITE BATCH 1: AFRICAN HERITAGE & MODERN CREATORS ── -->
    <sc-if value="{{ infiniteFeedBatch >= 1 }}">
      <div style="margin-top:40px;padding-top:20px;border-top:1px solid var(--color-divider)">
        <div class="editorial-section-header">
          <h2 class="editorial-section-title">African brands & heritage</h2>
          <button onClick="{{ () => openCategory('fashion') }}" class="editorial-see-all">See all →</button>
        </div>

        <div class="discovery-product-grid">
          <div class="discovery-product-card" onClick="{{ () => openProduct('ankara_palazzo') }}" style="cursor:pointer">
            <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
              <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('ankara_palazzo', 'Ankara Palazzo'); } }}" class="wishlist-float-btn" aria-label="Save Ankara Palazzo to wishlist">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('ankara_palazzo') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('ankara_palazzo') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              </button>
              <img src="./Assets/fashion/EnsembleModel/100%25%20Cotton%20Ankara%20Palazzo%20Pants.jfif" alt="100% Cotton Ankara Palazzo Trousers" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
            </div>
            <div class="disc-card-body">
              <div class="disc-card-name">Ankara Palazzo</div>
              <div class="disc-card-sub">100% Cotton Wax Print</div>
              <div class="disc-card-price">22.000 FCFA</div>
            </div>
          </div>

          <div class="discovery-product-card" onClick="{{ () => openProduct('artisan_sandals') }}" style="cursor:pointer">
            <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
              <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('artisan_sandals', 'Woven Sandals'); } }}" class="wishlist-float-btn" aria-label="Save Woven Sandals to wishlist">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('artisan_sandals') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('artisan_sandals') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              </button>
              <img src="./Assets/fashion/shoes/Men%20brown%20leather%20strap%20sandal%20handmade%20barefoot%20woven%20band%20summer%20footwear%20casual%20everyday%20comfort%20Arabian%20style%20Middle%20East%20men%20sandal.jfif" alt="Handmade Woven Leather Sandals" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
            </div>
            <div class="disc-card-body">
              <div class="disc-card-name">Woven Sandals</div>
              <div class="disc-card-sub">Handmade Leather</div>
              <div class="disc-card-price">15.000 FCFA</div>
            </div>
          </div>

          <div class="discovery-product-card" onClick="{{ () => openProduct('beaded_bracelet') }}" style="cursor:pointer">
            <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
              <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('beaded_bracelet', 'Beaded Bracelet'); } }}" class="wishlist-float-btn" aria-label="Save Beaded Bracelet to wishlist">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('beaded_bracelet') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('beaded_bracelet') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              </button>
              <img src="./Assets/jelweries/bracelet/Men%20Charm%20Black%20Spartan%20Helmet%20Beaded%20Natural%20Stone%20Adjustable%20Macrame%20Bracelets%20_%20eBay.jfif" alt="Natural Stone Beaded Warrior Bracelet" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
            </div>
            <div class="disc-card-body">
              <div class="disc-card-name">Beaded Bracelet</div>
              <div class="disc-card-sub">Natural Stone &amp; Charm</div>
              <div class="disc-card-price">12.000 FCFA</div>
            </div>
          </div>

          <div class="discovery-product-card" onClick="{{ () => openProduct('shea_lotion') }}" style="cursor:pointer">
            <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
              <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('shea_lotion', 'Shea Body Lotion'); } }}" class="wishlist-float-btn" aria-label="Save Shea Body Lotion to wishlist">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('shea_lotion') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('shea_lotion') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              </button>
              <img src="./Assets/perfume&lotion/MEET%20THE%204%20AFRICAN-OWNED%20BRANDS%20BRIDGING%20THE%20GAP%20IN%20THE%20SKINCARE%20MARKET%20FOR%20DARKER%20CONSUMERS.jfif" alt="Shea &amp; Baobab Nourishing Body Lotion" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
            </div>
            <div class="disc-card-body">
              <div class="disc-card-name">Shea Body Lotion</div>
              <div class="disc-card-sub">Shea &amp; Baobab</div>
              <div class="disc-card-price">9.500 FCFA</div>
            </div>
          </div>
        </div>
      </div>
    </sc-if>

    <!-- ── INFINITE BATCH 2: VERIFIED LOCAL STORES & OUTDOOR GEAR ── -->
    <sc-if value="{{ infiniteFeedBatch >= 2 }}">
      <div style="margin-top:40px;padding-top:20px;border-top:1px solid var(--color-divider)">
        <div class="editorial-section-header">
          <h2 class="editorial-section-title">Outdoor & adventure gear</h2>
          <button onClick="{{ () => openCategory('sports') }}" class="editorial-see-all">See all →</button>
        </div>

        <div class="discovery-product-grid">
          <div class="discovery-product-card" onClick="{{ () => openProduct('power_bank') }}" style="cursor:pointer">
            <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
              <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('power_bank', 'Solar Power Bank 30K'); } }}" class="wishlist-float-btn" aria-label="Save Solar Power Bank 30K to wishlist">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('power_bank') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('power_bank') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              </button>
              <img src="./Assets/acessories&gadgets/pawer%20bank%20with%204%20Data%20cables%20best%20power%20bank.jfif" alt="30000mAh Solar Power Bank + Cables" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
            </div>
            <div class="disc-card-body">
              <div class="disc-card-name">Solar Power Bank 30K</div>
              <div class="disc-card-sub">4 Cables · Solar</div>
              <div class="disc-card-price">22.000 FCFA</div>
            </div>
          </div>

          <div class="discovery-product-card" onClick="{{ () => openProduct('action_cam') }}" style="cursor:pointer">
            <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
              <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('action_cam', '4K POV Action Cam'); } }}" class="wishlist-float-btn" aria-label="Save 4K POV Action Cam to wishlist">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('action_cam') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('action_cam') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              </button>
              <img src="./Assets/acessories&gadgets/Ordro%20EP7%20YouTube%20Video%20Vlog%20Camera%204K%2060fps%20Head%20Wearable%20WiFi%20POV%20Digital%20Action%20Camcorder.jfif" alt="Ordro EP7 4K Wearable Action Camera" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
            </div>
            <div class="disc-card-body">
              <div class="disc-card-name">4K POV Action Cam</div>
              <div class="disc-card-sub">Ordro EP7 Wearable</div>
              <div class="disc-card-price">85.000 FCFA</div>
            </div>
          </div>

          <div class="discovery-product-card" onClick="{{ () => openProduct('lapel_mic') }}" style="cursor:pointer">
            <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
              <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('lapel_mic', 'Wireless Lapel Mic'); } }}" class="wishlist-float-btn" aria-label="Save Wireless Lapel Mic to wishlist">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('lapel_mic') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('lapel_mic') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              </button>
              <img src="./Assets/acessories&gadgets/Microfone%20Lapela%20Sem%20Fio%20Profissional%20para%20Smartphone%2C%20Microfone%20Sem%20Fio%20Plug%20and%20Play%2C%20Microfone___.jfif" alt="Wireless Lapel Microphone (Plug &amp; Play)" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
            </div>
            <div class="disc-card-body">
              <div class="disc-card-name">Wireless Lapel Mic</div>
              <div class="disc-card-sub">Plug &amp; Play Dual</div>
              <div class="disc-card-price">18.000 FCFA</div>
            </div>
          </div>

          <div class="discovery-product-card" onClick="{{ () => openProduct('mifa_a90') }}" style="cursor:pointer">
            <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
              <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('mifa_a90', 'Mifa A90 Speaker'); } }}" class="wishlist-float-btn" aria-label="Save Mifa A90 Speaker to wishlist">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('mifa_a90') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('mifa_a90') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              </button>
              <img src="./Assets/acessories&gadgets/mifa%20A90%20Bluetooth%20Speaker%2060W%20Output%20Power%20Bluetooth%20Speaker%20with%20Class%20D%20Amplifier%20Excellent%20Bass.jfif" alt="Mifa A90 60W Rugged Bluetooth Speaker" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
            </div>
            <div class="disc-card-body">
              <div class="disc-card-name">Mifa A90 Speaker</div>
              <div class="disc-card-sub">60W Rugged Bass</div>
              <div class="disc-card-price">45.000 FCFA</div>
            </div>
          </div>
        </div>
      </div>
    </sc-if>

    <!-- ── INFINITE BATCH 3: PRO AUDIO STUDIO & SMART LIVING ── -->
    <sc-if value="{{ infiniteFeedBatch >= 3 }}">
      <div style="margin-top:40px;padding-top:20px;border-top:1px solid var(--color-divider)">
        <div class="editorial-section-header">
          <h2 class="editorial-section-title">Audio studio & smart living</h2>
          <button onClick="{{ () => openCategory('electronics') }}" class="editorial-see-all">See all →</button>
        </div>

        <div class="discovery-product-grid">
          <div class="discovery-product-card" onClick="{{ () => openProduct('airpods_max') }}" style="cursor:pointer">
            <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
              <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('airpods_max', 'AirPods Max'); } }}" class="wishlist-float-btn" aria-label="Save AirPods Max to wishlist">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('airpods_max') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('airpods_max') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              </button>
              <img src="./Assets/_processed/acessories_gadgets_apple_air_pod_max_airpodmax_apple_keysho_16.png" alt="Apple AirPods Max Over-Ear" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
            </div>
            <div class="disc-card-body">
              <div class="disc-card-name">AirPods Max</div>
              <div class="disc-card-sub">Over-Ear ANC</div>
              <div class="disc-card-price">230.000 FCFA</div>
            </div>
          </div>

          <div class="discovery-product-card" onClick="{{ () => openProduct('oraimo_airfryer') }}" style="cursor:pointer">
            <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
              <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('oraimo_airfryer', 'Oraimo Air Fryer'); } }}" class="wishlist-float-btn" aria-label="Save Oraimo Air Fryer to wishlist">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('oraimo_airfryer') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('oraimo_airfryer') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              </button>
              <img src="./Assets/acessories&gadgets/Oraimo%20Oraimo%20Smart%20Air%20Fryer%20OH-AF210N%201500W%205%20Liters%205%20L%201500%20W%20OH-AF210N%20Black%20_%20Best%20Price%20Egypt%20_%20Cairo%2C%20Giza.jfif" alt="Oraimo Smart Air Fryer 5L" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
            </div>
            <div class="disc-card-body">
              <div class="disc-card-name">Oraimo Air Fryer</div>
              <div class="disc-card-sub">5L Smart 1500W</div>
              <div class="disc-card-price">62.000 FCFA</div>
            </div>
          </div>

          <div class="discovery-product-card" onClick="{{ () => openProduct('cold_press_juicer') }}" style="cursor:pointer">
            <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
              <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('cold_press_juicer', 'Cold-Press Juicer'); } }}" class="wishlist-float-btn" aria-label="Save Cold-Press Juicer to wishlist">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('cold_press_juicer') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('cold_press_juicer') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              </button>
              <img src="./Assets/ElectroMenage/Cold%20Press%20Juicer%20Machine%20for%20Fresh%20Juice%20and%20Modern%20Kitchen%20Countertops.jfif" alt="Slow Cold-Press Juicer Extractor" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
            </div>
            <div class="disc-card-body">
              <div class="disc-card-name">Cold-Press Juicer</div>
              <div class="disc-card-sub">Slow Masticating</div>
              <div class="disc-card-price">48.000 FCFA</div>
            </div>
          </div>

          <div class="discovery-product-card" onClick="{{ () => openProduct('espresso_maker') }}" style="cursor:pointer">
            <div class="disc-card-img-box" style="position:relative;width:100%;aspect-ratio:1;border-radius:var(--radius-md);overflow:hidden;background:#f8fafc">
              <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist('espresso_maker', 'Espresso Machine'); } }}" class="wishlist-float-btn" aria-label="Save Espresso Machine to wishlist">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="{{ isWishlisted('espresso_maker') ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted('espresso_maker') ? 'var(--color-accent-sale)' : 'var(--color-text-secondary)' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              </button>
              <img src="./Assets/ElectroMenage/Make%20Great%20Coffee%20at%20Home.jfif" alt="15-Bar Espresso Coffee Machine" loading="lazy" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s ease">
            </div>
            <div class="disc-card-body">
              <div class="disc-card-name">Espresso Machine</div>
              <div class="disc-card-sub">15-Bar Barista</div>
              <div class="disc-card-price">95.000 FCFA</div>
            </div>
          </div>
        </div>
      </div>
    </sc-if>

    <!-- ── 09.4: CONTINUOUS INFINITE MARKETPLACE FEED ── -->
    <sc-if value="{{ hasHomeFeedCards }}">
      <div style="margin-top:40px;padding-top:24px;border-top:1px solid var(--color-divider)">
        <div class="editorial-section-header" style="margin-bottom:18px">
          <div>
            <div style="font:800 11px/1 var(--font-heading);letter-spacing:.12em;color:var(--color-accent);text-transform:uppercase">MARKETPLACE FEED</div>
            <h2 class="editorial-section-title" style="margin-top:4px">Discover More Listings</h2>
          </div>
          <div style="font:500 13px/1.3 var(--font-body);color:var(--color-text-secondary)">Explore verified products from trusted merchants across Cameroon</div>
        </div>

        <div class="home-grid">
          <sc-for list="{{ homeFeedCards }}" as="card">
            <div onClick="{{ () => openProduct(card.id) }}" class="loumoo-media-card" aria-label="{{ card.title }}">
              <div class="loumoo-card-media-cutout">
                <sc-if value="{{ card.badge }}"><span class="loumoo-card-badge">{{ card.badge }}</span></sc-if>
                <sc-if value="{{ !card.badge && card.verified }}"><span class="loumoo-card-badge">✓ Verified</span></sc-if>
                <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist(card.id, card.title); } }}" class="loumoo-card-wishlist-btn" aria-label="Save to wishlist">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted(card.id) ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted(card.id) ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                </button>
                <img src="{{ card.imageUrl }}" alt="{{ card.title }}" loading="lazy">
              </div>
              <div class="loumoo-card-body">
                <h4 class="loumoo-card-title">{{ card.title }}</h4>
                <div class="loumoo-card-tagline">{{ card.storeLabel }}</div>
                <div class="loumoo-card-rating-row"><span>{{ card.ratingLabel }}</span></div>
                <div class="loumoo-card-bottom-row">
                  <div class="loumoo-card-pricing-block">
                    <div class="loumoo-card-price-main">
                      <span class="loumoo-card-price-val">{{ card.priceLabel }}</span>
                      <sc-if value="{{ card.strikeLabel }}"><span class="loumoo-card-price-strike">{{ card.strikeLabel }}</span></sc-if>
                    </div>
                  </div>
                  <button class="loumoo-card-pill-btn" aria-label="Buy {{ card.title }}">Buy now</button>
                </div>
              </div>
            </div>
          </sc-for>
        </div>

        <!-- Dynamic Infinite Scroll Loading / End Sentinel -->
        <div style="margin:28px 0 20px;text-align:center">
          <sc-if value="{{ catalogLoading }}">
            <div style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:var(--radius-pill);background:var(--color-surface);border:1px solid var(--color-divider);color:var(--color-text-secondary);font:600 12px/1 var(--font-body)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              <span>Loading more marketplace listings...</span>
            </div>
          </sc-if>
          <sc-if value="{{ !catalogLoading && !catalogHasMore }}">
            <div style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:var(--radius-pill);background:var(--color-surface);border:1px solid var(--color-divider);color:var(--color-text-secondary);font:600 12px/1 var(--font-body)">
              <span style="width:7px;height:7px;border-radius:50%;background:var(--color-success)"></span>
              <span>You've explored all current marketplace listings</span>
            </div>
          </sc-if>
        </div>
      </div>
    </sc-if>

    <!-- ── 09.5: LIVE ON LOUMOO MARKETPLACE RAIL (BOTTOM OF PAGE) ── -->
    <sc-if value="{{ catalogHasCards }}">
    <div class="editorial-section-header" style="display:flex;align-items:center;justify-content:space-between;padding:24px 0 12px;margin-top:28px">
      <div>
        <h2 class="editorial-section-title">Live on LOUMOO</h2>
        <div style="font:500 13px/1.3 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Straight from the marketplace catalogue — verified Cameroonian sellers</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button onClick="{{ () => scrollRail('liveCatalogueRail', -320) }}" class="loumoo-rail-nav-btn" aria-label="Previous items">‹</button>
        <button onClick="{{ () => scrollRail('liveCatalogueRail', 320) }}" class="loumoo-rail-nav-btn" aria-label="Next items">›</button>
      </div>
    </div>
    <div id="liveCatalogueRail" class="new-arrivals-rail" style="display:flex;flex-direction:row;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;gap:18px;margin-bottom:32px;padding:4px 4px 16px 4px">
      <sc-for list="{{ catalogCards }}" as="prod">
      <sc-if value="{{ prod && prod.title }}">
      <div onClick="{{ () => openProduct(prod.id) }}" class="loumoo-media-card na-card" style="cursor:pointer" aria-label="View product">
        <div class="na-card-media-wrap">
          <sc-if value="{{ prod.badge }}"><span class="loumoo-card-badge badge-pill-sale">{{ prod.badge }}</span></sc-if>
          <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); toggleProductWishlist(prod.id, prod.title); } }}" class="loumoo-card-wishlist-btn" aria-label="Save to wishlist">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="{{ isWishlisted(prod.id) ? 'var(--color-accent-sale)' : 'none' }}" stroke="{{ isWishlisted(prod.id) ? 'var(--color-accent-sale)' : 'currentColor' }}" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
          <img src="{{ prod.imageUrl }}" alt="{{ prod.title }}" loading="lazy" class="na-card-img">
          <div class="na-card-transition-fade"></div>
        </div>
        <div class="na-card-transition-line"></div>
        <div class="loumoo-card-body na-card-body">
          <div class="na-card-brand-row">
            <span class="na-card-rating">{{ prod.ratingLabel }}</span>
            <span class="na-card-store-label">{{ prod.storeLabel }}</span>
          </div>
          <h3 class="loumoo-card-title na-card-title">{{ prod.title }}</h3>
          <div class="loumoo-card-tagline na-card-tagline">{{ prod.tagline }}</div>
          <div class="loumoo-card-bottom-row" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px">
            <span class="loumoo-card-price-val" style="font:800 15px/1 var(--font-heading);color:var(--color-text)">{{ prod.priceLabel }}</span>
            <button onClick="{{ (e) => { e && e.stopPropagation && e.stopPropagation(); addToCart(prod.id); } }}" class="btn btn-primary" style="height:32px;padding:0 12px;font-size:11.5px;font-weight:700;flex-shrink:0" aria-label="Add to bag">+ Bag</button>
          </div>
        </div>
      </div>
      </sc-if>
      </sc-for>
    </div>
    </sc-if>

    <!-- ── 10: LOUMOO UNIVERSAL ECOSYSTEM PANORAMA (BOTTOM DISCOVERY HUB) ── -->
    <div style="margin:40px 0 20px;background:var(--color-surface);border:1px solid var(--color-divider);border-radius:var(--radius-lg);padding:24px 20px;box-shadow:var(--shadow-sm)">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
        <div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font:800 11px/1 var(--font-heading);letter-spacing:.12em;color:var(--color-accent);text-transform:uppercase">UNIVERSAL ECOSYSTEM</span>
            <span class="tag tag-accent" style="min-height:16px;padding:1px 6px;font-size:9px;font-weight:800">CAMEROON &amp; CEMAC</span>
          </div>
          <h2 style="margin:4px 0 0;font-size:clamp(18px, 2.4vw, 24px);font-weight:800;letter-spacing:-.025em;color:var(--color-text)">One Platform. Specialized Experiences.</h2>
        </div>
        <div style="display:flex;align-items:center;gap:8px;font:700 11px/1 var(--font-body);color:var(--color-success);background:var(--color-success-100);padding:6px 12px;border-radius:var(--radius-pill)">
          <span style="width:6px;height:6px;border-radius:50%;background:var(--color-success)"></span>
          <span>2,400+ Verified Merchants · Tier-1 Escrow</span>
        </div>
      </div>

      <!-- 6 Gateways Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:12px">
        <!-- 1. Commerce -->
        <button onClick="{{ on.bestpicks }}" class="card-premium" style="padding:14px;display:flex;flex-direction:column;gap:6px;text-align:left;cursor:pointer;border-color:var(--color-accent-200);background:linear-gradient(135deg,#ffffff,#f0f7ff)">
          <div style="width:34px;height:34px;border-radius:8px;background:var(--color-accent-100);color:var(--color-accent);display:flex;align-items:center;justify-content:center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
          </div>
          <div style="font:800 13.5px/1.2 var(--font-heading);color:var(--color-text);margin-top:2px">Commerce</div>
          <div style="font:400 11px/1.2 var(--font-body);color:var(--color-text-secondary)">Discover &amp; buy authentic hardware</div>
        </button>

        <!-- 2. Verified Stores -->
        <button onClick="{{ on.store }}" class="card-premium" style="padding:14px;display:flex;flex-direction:column;gap:6px;text-align:left;cursor:pointer">
          <div style="width:34px;height:34px;border-radius:8px;background:#fef3c7;color:#d97706;display:flex;align-items:center;justify-content:center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h20l-2 10H4L2 3z"/><path d="M6 13v7a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7"/></svg>
          </div>
          <div style="font:800 13.5px/1.2 var(--font-heading);color:var(--color-text);margin-top:2px">Stores &amp; Brands</div>
          <div style="font:400 11px/1.2 var(--font-body);color:var(--color-text-secondary)">Official boutiques &amp; local shops</div>
        </button>

        <!-- 3. Travel & Mobility -->
        <button onClick="{{ on.travel }}" class="card-premium" style="padding:14px;display:flex;flex-direction:column;gap:6px;text-align:left;cursor:pointer">
          <div style="width:34px;height:34px;border-radius:8px;background:#dbeafe;color:#2563eb;display:flex;align-items:center;justify-content:center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.3c.4-.2.6-.6.5-1.1z"/></svg>
          </div>
          <div style="font:800 13.5px/1.2 var(--font-heading);color:var(--color-text);margin-top:2px">Travel &amp; Flights</div>
          <div style="font:400 11px/1.2 var(--font-body);color:var(--color-text-secondary)">Buses, Trains, Flights &amp; Taxis</div>
        </button>

        <!-- 4. Announce & Tenders -->
        <button onClick="{{ on.announce }}" class="card-premium" style="padding:14px;display:flex;flex-direction:column;gap:6px;text-align:left;cursor:pointer">
          <div style="width:34px;height:34px;border-radius:8px;background:#fae8ff;color:#a855f7;display:flex;align-items:center;justify-content:center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
          </div>
          <div style="font:800 13.5px/1.2 var(--font-heading);color:var(--color-text);margin-top:2px">Announce Feed</div>
          <div style="font:400 11px/1.2 var(--font-body);color:var(--color-text-secondary)">Flash drops, tenders &amp; jobs</div>
        </button>

        <!-- 5. VS Comparison Matrix -->
        <button onClick="{{ on.vs }}" class="card-premium" style="padding:14px;display:flex;flex-direction:column;gap:6px;text-align:left;cursor:pointer">
          <div style="width:34px;height:34px;border-radius:8px;background:#e0e7ff;color:#4f46e5;display:flex;align-items:center;justify-content:center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>
          </div>
          <div style="font:800 13.5px/1.2 var(--font-heading);color:var(--color-text);margin-top:2px">VS Matrix</div>
          <div style="font:400 11px/1.2 var(--font-body);color:var(--color-text-secondary)">Head-to-head decision engine</div>
        </button>

        <!-- 6. Spatial AI Lens -->
        <button onClick="{{ on.visual }}" class="card-premium" style="padding:14px;display:flex;flex-direction:column;gap:6px;text-align:left;cursor:pointer">
          <div style="width:34px;height:34px;border-radius:8px;background:#ecfdf5;color:#059669;display:flex;align-items:center;justify-content:center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
          </div>
          <div style="font:800 13.5px/1.2 var(--font-heading);color:var(--color-text);margin-top:2px">Spatial AI Lens</div>
          <div style="font:400 11px/1.2 var(--font-body);color:var(--color-text-secondary)">Visual search &amp; model match</div>
        </button>
      </div>

      <!-- Real-time Trust Bar (Mobile Money & CEMAC Delivery) -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid var(--color-divider);font-size:12px;color:var(--color-text-secondary)">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="display:flex;align-items:center;gap:4px"><strong style="color:var(--color-text)">Payment:</strong> <span style="background:var(--color-momo-yellow);color:#111;font-weight:800;padding:2px 7px;border-radius:4px;font-size:10.5px">MTN MoMo</span> <span style="background:var(--color-om-orange);color:#fff;font-weight:800;padding:2px 7px;border-radius:4px;font-size:10.5px">Orange Money</span></span>
          <span>·</span>
          <span><strong style="color:var(--color-text)">Express Courier:</strong> Douala (Same-day) · Yaoundé (24h)</span>
        </div>
        <div style="display:flex;align-items:center;gap:5px;color:var(--color-accent);font-weight:700">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span>Tier-1 Escrow Guarantee</span>
        </div>
      </div>
    </div>

  </div>
</sc-if>
"""
