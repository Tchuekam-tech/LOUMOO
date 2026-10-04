# -*- coding: utf-8 -*-
"""
LOUMOO STORE & MERCHANT STUDIO VIEWS

Verified store directory, flagship brand storefront, seller analytics studio,
and the seller's own catalogue.

Publishing itself lives in `publishing_view.py`. My Listings renders the same
`publication_card` the studio previews and the buyer feed shows, so what a
seller sees in their catalogue is literally what a buyer sees in the feed.
"""

from src.views.publishing_view import publication_card


def get_merchant_view():
    return _TEMPLATE.replace(
        '__CARD__',
        publication_card('card', compact=True, show_status=True,
                         clickable='() => openPublication(card)')
    )


_TEMPLATE = """
<!-- ══════════════════════════════════════════════════════════════════════════
     STORE & BRAND DISCOVERY DIRECTORY (is.store)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.store }}">
<div class="store-page-wrap" style="padding-bottom:48px">
  
  <!-- Sticky Top Header -->
  <div class="page-head">
    <div class="page-head-main">
      <button onClick="{{ back }}" aria-label="Go back" class="icon-btn-round">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <div class="page-head-text">
        <h4 class="page-head-title">Verified Stores &amp; Official Brands</h4>
        <div class="page-head-sub">2,400+ trusted merchants across Douala, Yaoundé &amp; Cameroon</div>
      </div>
    </div>
    <div class="page-head-actions">
      <button onClick="{{ on.createStore }}" class="btn btn-primary" aria-label="Open your store" style="height:40px;padding:0 15px;font-size:12px;font-weight:700;gap:6px">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        <span>OPEN STORE</span>
      </button>
    </div>
  </div>

  <div class="page-body">

    <sc-if value="{{ storeDiscoveryLoading }}">
      <div class="pub-banner is-busy" role="status"><span class="pub-spinner" aria-hidden="true"></span><span>Loading live stores…</span></div>
    </sc-if>
    <sc-if value="{{ storeDiscoveryError }}">
      <div class="pub-banner is-error" role="alert"><span>{{ storeDiscoveryError }}</span><button class="pub-linkbtn" onClick="{{ reloadStoreDiscovery }}">Try again</button></div>
    </sc-if>
    <sc-if value="{{ storeDiscoveryCards.length }}">
      <div class="card-premium" style="padding:16px">
        <div class="section-head" style="margin-bottom:12px">
          <div class="section-head-text">
            <h3 class="section-head-title">Stores on LOUMOO</h3>
            <div class="section-head-sub">Live storefronts created by Cameroon merchants</div>
          </div>
          <span class="tag tag-accent">{{ storeDiscoveryTotal }} STORES</span>
        </div>
        <div class="entity-grid">
          <sc-for list="{{ storeDiscoveryCards }}" as="store">
            <article class="store-card">
              <div class="store-card-head">
                <div class="store-logo" style="background:var(--color-accent);color:#fff;overflow:hidden;display:flex;align-items:center;justify-content:center">
                  <sc-if value="{{ store.logoUrl }}">
                    <img src="{{ store.logoUrl }}" alt="{{ store.name }}" style="width:100%;height:100%;object-fit:cover">
                  </sc-if>
                  <sc-if value="{{ !store.logoUrl }}">
                    <span>{{ store.initial }}</span>
                  </sc-if>
                </div>
                <div class="store-id">
                  <div class="store-name-row">
                    <span class="store-name">{{ store.name }}</span>
                    <sc-if value="{{ store.isVerified }}"><span class="store-verified" aria-label="Verified">✓</span></sc-if>
                  </div>
                  <div class="store-desc">{{ store.description }}</div>
                  <div class="store-meta"><span class="store-meta-strong">★ {{ store.rating }}</span><span class="store-meta-dot">·</span><span>{{ store.city || 'Cameroon' }}</span></div>
                </div>
              </div>
              <button onClick="{{ () => openDiscoveredStore(store) }}" class="store-cta">Visit storefront <span aria-hidden="true">→</span></button>
            </article>
          </sc-for>
        </div>
      </div>
    </sc-if>
    
    <!-- ── SEARCH & FILTER HERO BAR ── -->
    <div class="card-premium" style="padding:16px;display:flex;flex-direction:column;gap:14px;background:var(--color-surface);border-radius:var(--radius-lg)">
      <div class="filter-bar">
        
        <!-- Search Input -->
        <div class="filter-grow" style="position:relative;display:flex;align-items:center">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="position:absolute;left:14px;color:var(--color-text-muted)"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>
          <input type="text" class="input" placeholder="Search stores, brands or locations…" value="{{ storeSearchQuery }}" onInput="{{ updateStoreSearch }}" onChange="{{ updateStoreSearch }}" style="padding-left:42px;padding-right:36px;height:44px;font-size:13.5px">
          <sc-if value="{{ storeSearchQuery }}">
            <button onClick="{{ clearStoreSearch }}" aria-label="Clear search" style="position:absolute;right:8px;background:var(--color-neutral-200);border:none;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--color-text-secondary)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          </sc-if>
        </div>

        <!-- City Selector -->
        <div class="filter-side">
          <select class="input" value="{{ storeCityFilter }}" onChange="{{ updateStoreCityFilter }}" style="height:44px;font-size:13px;font-weight:600;cursor:pointer">
            <option value="all">All Cities (Cameroon)</option>
            <option value="douala">Douala (Akwa, Bonapriso, Bonanjo)</option>
            <option value="yaounde">Yaoundé (Bastos, Centre)</option>
            <option value="kribi">Kribi (Beach &amp; Resorts)</option>
            <option value="bafoussam">Bafoussam</option>
          </select>
        </div>

        <!-- Quick Badges -->
        <div class="filter-side" style="display:flex;gap:8px;align-items:center">
          <button onClick="{{ toggleStoreVerifiedOnly }}" class="tag {{ storeVerifiedClass }}" aria-pressed="{{ storeVerifiedOnly }}" style="height:44px;padding:0 16px;cursor:pointer;font-size:12.5px;justify-content:center;width:100%">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            <span>Verified Only</span>
          </button>
        </div>
      </div>

      <!-- Category Filter Pills -->
      <div class="chip-row" role="group" aria-label="Filter stores by category">
        <button onClick="{{ () => setStoreCategory('all') }}" class="tag {{ storeCatAllClass }}" style="cursor:pointer">All Categories</button>
        <button onClick="{{ () => setStoreCategory('tech') }}" class="tag {{ storeCatTechClass }}" style="cursor:pointer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8"/></svg><span>Electronics &amp; Tech</span></button>
        <button onClick="{{ () => setStoreCategory('fashion') }}" class="tag {{ storeCatFashionClass }}" style="cursor:pointer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3 3 7l2 3 2-1v11h10V9l2 1 2-3-6-4a3 3 0 0 1-6 0Z"/></svg><span>Fashion &amp; Apparel</span></button>
        <button onClick="{{ () => setStoreCategory('hospitality') }}" class="tag {{ storeCatHospitalityClass }}" style="cursor:pointer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 20V9l9-5 9 5v11"/><path d="M9 20v-6h6v6"/></svg><span>Hospitality &amp; Hotels</span></button>
        <button onClick="{{ () => setStoreCategory('home') }}" class="tag {{ storeCatHomeClass }}" style="cursor:pointer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 18v-6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6"/><path d="M2 18h20M6 21v-3M18 21v-3"/></svg><span>Home &amp; Living</span></button>
        <button onClick="{{ () => setStoreCategory('services') }}" class="tag {{ storeCatServicesClass }}" style="cursor:pointer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 1 5.4-5.4l-2.6 2.6 1.6 1.6 2.6-2.6"/></svg><span>Professional Services</span></button>
      </div>
    </div>

    <!-- ── SECTION 1: FEATURED FLAGSHIP STORES (DESKTOP ELEVATED CAROUSEL/GRID) ── -->
    <div>
      <div class="section-head">
        <div class="section-head-text">
          <h3 class="section-head-title">Featured Flagship Stores</h3>
          <div class="section-head-sub">Verified authorized distributors &amp; top-rated merchants with warranty</div>
        </div>
        <span class="tag tag-accent section-head-aside" style="font-size:11px;font-weight:700">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>
          4.8+ TOP RATED
        </span>
      </div>

      <div class="entity-grid">

        <!-- Flagship Card 1: Orca Electronics -->
        <div class="store-card">
          <div class="store-card-head">
            <div class="store-logo" style="background:#0b0d14">O</div>
            <div class="store-id">
              <div class="store-name-row">
                <span class="store-name">Orca Electronics</span>
                <svg class="store-verified" width="15" height="15" viewBox="0 0 24 24" fill="var(--color-accent)" role="img" aria-label="Official partner"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.1 14.2-4-4L8.3 10.8l2.6 2.6 4.8-4.8 1.4 1.4z"/></svg>
              </div>
              <div class="store-desc">Certified Apple &amp; Dell reseller · Akwa, Douala</div>
              <div class="store-meta">
                <span class="store-meta-strong">★ 4.9</span>
                <span class="store-meta-dot">·</span>
                <span>318 products</span>
              </div>
            </div>
            <button onClick="{{ toggleFollow }}" class="store-follow {{ following ? 'is-following' : '' }}">{{ followLabel }}</button>
          </div>
          <button onClick="{{ on.business }}" class="store-cta">Visit storefront <span aria-hidden="true">→</span></button>
        </div>

        <!-- Flagship Card 2: Digital Corner -->
        <div class="store-card">
          <div class="store-card-head">
            <div class="store-logo" style="background:#1a1e28">D</div>
            <div class="store-id">
              <div class="store-name-row">
                <span class="store-name">Digital Corner</span>
                <svg class="store-verified" width="15" height="15" viewBox="0 0 24 24" fill="var(--color-text-muted)" role="img" aria-label="Verified seller"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.1 14.2-4-4L8.3 10.8l2.6 2.6 4.8-4.8 1.4 1.4z"/></svg>
              </div>
              <div class="store-desc">Pro audio, gaming &amp; mobile · Bonapriso, Douala</div>
              <div class="store-meta">
                <span class="store-meta-strong">★ 4.7</span>
                <span class="store-meta-dot">·</span>
                <span>154 products</span>
              </div>
            </div>
            <button onClick="{{ toggleFollow }}" class="store-follow">Follow</button>
          </div>
          <button onClick="{{ on.business }}" class="store-cta">Visit storefront <span aria-hidden="true">→</span></button>
        </div>

        <!-- Flagship Card 3: Sawa Luxury Hotel -->
        <div class="store-card">
          <div class="store-card-head">
            <div class="store-logo" style="background:#0b3d66">S</div>
            <div class="store-id">
              <div class="store-name-row">
                <span class="store-name">Sawa Luxury Hotel</span>
                <svg class="store-verified" width="15" height="15" viewBox="0 0 24 24" fill="var(--color-accent)" role="img" aria-label="5-star resort"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.1 14.2-4-4L8.3 10.8l2.6 2.6 4.8-4.8 1.4 1.4z"/></svg>
              </div>
              <div class="store-desc">Ocean-view suites &amp; pool · Bonanjo, Douala</div>
              <div class="store-meta">
                <span class="store-meta-strong">★ 4.8</span>
                <span class="store-meta-dot">·</span>
                <span>42 suites</span>
              </div>
            </div>
            <button onClick="{{ toggleFollow }}" class="store-follow">Follow</button>
          </div>
          <button onClick="{{ on.hotelDetail }}" class="store-cta">Explore rooms <span aria-hidden="true">→</span></button>
        </div>

      </div>
    </div>

    <!-- ── SECTION 2: TRENDING BRANDS DESTINATION HUB ── -->
    <div class="card-premium" style="background:linear-gradient(135deg, #111214 0%, #1a1e28 100%);color:#fff;border:none;padding:24px 28px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:12px">
        <div>
          <span class="kicker" style="color:var(--color-accent-energy)">OFFICIAL BRAND ECOSYSTEMS</span>
          <h3 style="color:#fff;margin:4px 0 0;font-size:20px">Official Brand Destinations</h3>
        </div>
        <div style="font:500 12px/1 var(--font-body);color:rgba(255,255,255,0.7)">
          Certified authentic products backed by official manufacturer warranties
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(190px, 1fr));gap:14px">
        
        <!-- Brand 1: Apple -->
        <button onClick="{{ () => openBrand('apple') }}" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);border-radius:var(--radius-md);padding:16px;text-align:left;color:#fff;cursor:pointer;transition:all 0.2s ease">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <span style="font:800 20px/1 var(--font-heading)"> Apple</span>
            <span style="font:800 9px/1 var(--font-heading);background:rgba(255,255,255,0.2);padding:3px 6px;border-radius:var(--radius-pill)">PARTNER</span>
          </div>
          <div style="font:400 11.5px/1.3 var(--font-body);color:rgba(255,255,255,0.75)">MacBook, iPhone, iPad &amp; Watch ecosystem</div>
          <div style="font:700 11px/1 var(--font-heading);color:var(--color-accent-400);margin-top:10px">84 Authorized Listings →</div>
        </button>

        <!-- Brand 2: Sony -->
        <button onClick="{{ () => openBrand('sony') }}" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);border-radius:var(--radius-md);padding:16px;text-align:left;color:#fff;cursor:pointer;transition:all 0.2s ease">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <span style="font:800 18px/1 var(--font-heading);letter-spacing:1px">SONY</span>
            <span style="font:800 9px/1 var(--font-heading);background:rgba(255,255,255,0.2);padding:3px 6px;border-radius:var(--radius-pill)">OFFICIAL</span>
          </div>
          <div style="font:400 11.5px/1.3 var(--font-body);color:rgba(255,255,255,0.75)">WH-1000XM5, PlayStation 5 &amp; Alpha Cameras</div>
          <div style="font:700 11px/1 var(--font-heading);color:var(--color-accent-400);margin-top:10px">62 Authorized Listings →</div>
        </button>

        <!-- Brand 3: Samsung -->
        <button onClick="{{ () => openBrand('samsung') }}" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);border-radius:var(--radius-md);padding:16px;text-align:left;color:#fff;cursor:pointer;transition:all 0.2s ease">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <span style="font:800 18px/1 var(--font-heading);letter-spacing:.5px">SAMSUNG</span>
            <span style="font:800 9px/1 var(--font-heading);background:rgba(255,255,255,0.2);padding:3px 6px;border-radius:var(--radius-pill)">CEMAC</span>
          </div>
          <div style="font:400 11.5px/1.3 var(--font-body);color:rgba(255,255,255,0.75)">Galaxy S-Series, QLED &amp; Smart Appliances</div>
          <div style="font:700 11px/1 var(--font-heading);color:var(--color-accent-400);margin-top:10px">118 Authorized Listings →</div>
        </button>

        <!-- Brand 4: Anker -->
        <button onClick="{{ () => openBrand('anker') }}" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);border-radius:var(--radius-md);padding:16px;text-align:left;color:#fff;cursor:pointer;transition:all 0.2s ease">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <span style="font:800 18px/1 var(--font-heading);letter-spacing:.5px">ANKER</span>
            <span style="font:800 9px/1 var(--font-heading);background:rgba(255,255,255,0.2);padding:3px 6px;border-radius:var(--radius-pill)">POWER</span>
          </div>
          <div style="font:400 11.5px/1.3 var(--font-body);color:rgba(255,255,255,0.75)">Fast GaN Chargers, 24k Banks &amp; Solar Stations</div>
          <div style="font:700 11px/1 var(--font-heading);color:var(--color-accent-400);margin-top:10px">45 Authorized Listings →</div>
        </button>

      </div>
    </div>

    <!-- ── SECTION 3: POPULAR IN YOUR AREA / STORE DIRECTORY GRID ── -->
    <div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px">
        <div>
          <h3 style="margin:0;font-size:18px;letter-spacing:-.02em">Popular Boutiques Near You</h3>
          <div style="font:400 12.5px/1.3 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Instant showroom pickup &amp; same-day delivery in your neighborhood</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:14px">
        
        <!-- Store Tile 1 -->
        <div class="card-premium" style="padding:16px;display:flex;flex-direction:column;justify-content:space-between;gap:12px">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:44px;height:44px;border-radius:var(--radius-sm);background:var(--color-accent-100);color:var(--color-accent);display:flex;align-items:center;justify-content:center;font:800 18px/1 var(--font-heading)">O</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font:700 15px/1.2 var(--font-heading);color:var(--color-text)">Orca Electronics</span>
                <span class="tag tag-accent" style="min-height:16px;padding:1px 5px;font-size:9px">PARTNER</span>
              </div>
              <div style="font:400 12px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Akwa, Douala · ★ 4.9</div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--color-divider);padding-top:10px">
            <span style="font:600 11.5px/1 var(--font-body);color:var(--color-success)">Pickup Ready (Akwa)</span>
            <button onClick="{{ on.business }}" class="btn btn-secondary" style="height:32px;padding:0 12px;font-size:11.5px">STOREFRONT →</button>
          </div>
        </div>

        <!-- Store Tile 2 -->
        <div class="card-premium" style="padding:16px;display:flex;flex-direction:column;justify-content:space-between;gap:12px">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:44px;height:44px;border-radius:var(--radius-sm);background:var(--color-neutral-200);color:var(--color-text);display:flex;align-items:center;justify-content:center;font:800 18px/1 var(--font-heading)">D</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font:700 15px/1.2 var(--font-heading);color:var(--color-text)">Digital Corner</span>
                <span class="tag tag-neutral" style="min-height:16px;padding:1px 5px;font-size:9px">VERIFIED</span>
              </div>
              <div style="font:400 12px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Bonapriso, Douala · ★ 4.7</div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--color-divider);padding-top:10px">
            <span style="font:600 11.5px/1 var(--font-body);color:var(--color-success)">Express Courier (Douala)</span>
            <button onClick="{{ on.business }}" class="btn btn-secondary" style="height:32px;padding:0 12px;font-size:11.5px">STOREFRONT →</button>
          </div>
        </div>

        <!-- Store Tile 3 -->
        <div class="card-premium" style="padding:16px;display:flex;flex-direction:column;justify-content:space-between;gap:12px">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:44px;height:44px;border-radius:var(--radius-sm);background:var(--color-accent-energy-100);color:var(--color-accent-energy-text);display:flex;align-items:center;justify-content:center;font:800 18px/1 var(--font-heading)">Y</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font:700 15px/1.2 var(--font-heading);color:var(--color-text)">Yaoundé Tech Hub</span>
                <span class="tag tag-accent" style="min-height:16px;padding:1px 5px;font-size:9px">VERIFIED</span>
              </div>
              <div style="font:400 12px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Bastos &amp; Centre, Yaoundé · ★ 4.6</div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--color-divider);padding-top:10px">
            <span style="font:600 11.5px/1 var(--font-body);color:var(--color-success)">Same-Day Yaoundé Delivery</span>
            <button onClick="{{ on.business }}" class="btn btn-secondary" style="height:32px;padding:0 12px;font-size:11.5px">STOREFRONT →</button>
          </div>
        </div>

        <!-- Store Tile 4 -->
        <div class="card-premium" style="padding:16px;display:flex;flex-direction:column;justify-content:space-between;gap:12px">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:44px;height:44px;border-radius:var(--radius-sm);background:var(--color-success-100);color:var(--color-success);display:flex;align-items:center;justify-content:center;font:800 18px/1 var(--font-heading)">S</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font:700 15px/1.2 var(--font-heading);color:var(--color-text)">Sawa Luxury Resort</span>
                <span class="tag tag-accent" style="min-height:16px;padding:1px 5px;font-size:9px">LUXURY</span>
              </div>
              <div style="font:400 12px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Bonanjo, Douala · ★ 4.8</div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--color-divider);padding-top:10px">
            <span style="font:600 11.5px/1 var(--font-body);color:var(--color-success)">Instant Booking &amp; Keycard</span>
            <button onClick="{{ on.hotelDetail }}" class="btn btn-secondary" style="height:32px;padding:0 12px;font-size:11.5px">SUITES →</button>
          </div>
        </div>

      </div>
    </div>

  </div>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     FLAGSHIP DIGITAL STOREFRONT (is.business)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.business }}">
<div class="storefront-page-wrap" style="padding-bottom:64px">
  <sc-if value="{{ businessStoreProfileLoading }}">
    <div class="pub-banner is-busy" role="status"><span class="pub-spinner" aria-hidden="true"></span><span>Loading storefront profile…</span></div>
  </sc-if>
  <sc-if value="{{ businessStoreProfileError }}">
    <div class="pub-banner is-error" role="alert"><span>{{ businessStoreProfileError }}</span><button class="pub-linkbtn" onClick="{{ reloadStoreProfile }}">Try again</button></div>
  </sc-if>
  
  <!-- ── STOREFRONT IDENTITY HEADER (minimal) ── -->
  <div style="background:var(--color-surface);border-bottom:1px solid var(--color-divider)">
    <div style="max-width:1040px;margin:0 auto;padding:20px 20px 28px;display:flex;flex-direction:column;gap:20px">
      <button onClick="{{ back }}" aria-label="Go back" style="align-self:flex-start;border:none;background:transparent;padding:0;display:flex;align-items:center;gap:6px;color:var(--color-text-secondary);font:500 13px/1 var(--font-body);cursor:pointer">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
        <span>Back</span>
      </button>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:24px">

        <div style="display:flex;align-items:center;gap:20px;min-width:0">
          <!-- Logo Avatar -->
          <div style="width:76px;height:76px;border-radius:20px;background:#0b0d14;color:#fff;display:flex;align-items:center;justify-content:center;font:600 30px/1 var(--font-heading);flex-shrink:0;overflow:hidden;box-shadow:var(--shadow-sm)">
            <sc-if value="{{ businessStoreLogoUrl }}">
              <img src="{{ businessStoreLogoUrl }}" alt="{{ businessStoreName }}" style="width:100%;height:100%;object-fit:cover">
            </sc-if>
            <sc-if value="{{ !businessStoreLogoUrl }}">
              <span>{{ businessStoreInitial }}</span>
            </sc-if>
          </div>

          <div style="min-width:0">
            <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
              <h1 style="color:var(--color-text);margin:0;font-size:clamp(22px, 3.2vw, 30px);font-weight:700;letter-spacing:-.03em">{{ businessStoreName }}</h1>
              <sc-if value="{{ businessStoreVerified }}"><svg width="19" height="19" viewBox="0 0 24 24" fill="var(--color-accent)" role="img" aria-label="Verified store"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.1 14.2-4-4L8.3 10.8l2.6 2.6 4.8-4.8 1.4 1.4z"/></svg></sc-if>
            </div>
            <p style="color:var(--color-text-secondary);margin:6px 0 12px;font-size:14px;max-width:560px;line-height:1.5">
              {{ businessStoreDescription }}
            </p>
            <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;font:500 13px/1 var(--font-body);color:var(--color-text-muted)">
              <span style="color:var(--color-text);font-weight:600">★ {{ businessStoreRating }}</span>
              <span style="opacity:.35">·</span>
              <span>1,240 followers</span>
              <span style="opacity:.35">·</span>
              <span>318 products</span>
              <span style="opacity:.35">·</span>
              <span style="color:var(--color-success);font-weight:600">Open now</span>
            </div>
          </div>
        </div>

        <!-- Direct Actions -->
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button onClick="{{ toggleFollow }}" class="btn {{ following ? 'btn-secondary' : 'btn-primary' }}" style="height:42px;padding:0 24px;font-weight:600;border-radius:var(--radius-pill)">
            {{ followLabel }}
          </button>
          <button onClick="{{ (e) => contactSellerWhatsApp({ sellerName: businessStoreName }) }}" class="btn btn-secondary" style="height:42px;padding:0 20px;font-weight:600;border-radius:var(--radius-pill);color:var(--color-wa-teal)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="margin-right:6px"><path d="M17.5 14.4c-.3-.15-1.7-.85-2-.95-.26-.1-.46-.15-.65.15-.2.3-.75.95-.9 1.15-.17.2-.34.22-.63.07-.3-.15-1.25-.46-2.4-1.47-.9-.8-1.5-1.77-1.67-2.07-.17-.3-.02-.46.13-.6.13-.14.3-.34.44-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.65-1.57-.9-2.15-.24-.57-.48-.5-.65-.5h-.56c-.2 0-.5.07-.77.37-.26.3-1 .98-1 2.4s1.03 2.78 1.17 2.98c.15.2 2.02 3.08 4.9 4.32.68.3 1.22.47 1.63.6.68.22 1.3.18 1.8.11.55-.08 1.7-.7 1.93-1.36.24-.67.24-1.24.17-1.36-.07-.12-.26-.2-.55-.34zM12 2C6.48 2 2 6.48 2 12c0 1.77.46 3.43 1.27 4.87L2 22l5.25-1.38A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z"/></svg>
            <span>Message</span>
          </button>
        </div>

      </div>

      <!-- ── TRUST LINE (minimal) ── -->
      <div style="display:flex;align-items:center;gap:22px;flex-wrap:wrap;padding-top:20px;border-top:1px solid var(--color-divider);font:500 12.5px/1 var(--font-body);color:var(--color-text-secondary)">
        <span style="display:flex;align-items:center;gap:7px">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span>Escrow protected</span>
        </span>
        <span style="display:flex;align-items:center;gap:7px">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
          <span>12-month warranty</span>
        </span>
        <span style="display:flex;align-items:center;gap:7px">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>2h Douala · 24h Yaoundé</span>
        </span>
        <span style="display:flex;align-items:center;gap:7px">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>{{ businessStoreCity }}</span>
        </span>
      </div>

    </div>
  </div>

  <!-- ── STOREFRONT NAVIGATION SUB-TABS ── -->
  <div class="storefront-tabs-bar" style="background:var(--color-surface);border-bottom:1px solid var(--color-divider);position:sticky;top:0;z-index:30">
    <div class="store-tabs" role="tablist">
      <button onClick="{{ back }}" aria-label="Go back" class="store-tab" style="padding:0 12px 0 0;display:inline-flex;align-items:center;gap:4px;color:var(--color-text-secondary);border-bottom-color:transparent" title="Go back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
        <span style="font-weight:600;font-size:13px">Back</span>
      </button>
      <button onClick="{{ () => setStoreActiveTab('home') }}" class="store-tab {{ storeTabHomeClass }}" style="border-bottom-color:{{ storeTabHomeBorder }}">Overview</button>
      <button onClick="{{ () => setStoreActiveTab('products') }}" class="store-tab {{ storeTabProductsClass }}" style="border-bottom-color:{{ storeTabProductsBorder }}">Products</button>
      <button onClick="{{ () => setStoreActiveTab('collections') }}" class="store-tab {{ storeTabCollectionsClass }}" style="border-bottom-color:{{ storeTabCollectionsBorder }}">Collections</button>
      <button onClick="{{ () => setStoreActiveTab('about') }}" class="store-tab {{ storeTabAboutClass }}" style="border-bottom-color:{{ storeTabAboutBorder }}">About</button>
      <button onClick="{{ () => setStoreActiveTab('reviews') }}" class="store-tab {{ storeTabReviewsClass }}" style="border-bottom-color:{{ storeTabReviewsBorder }}">Reviews</button>
    </div>
  </div>

  <div style="padding:32px 16px;max-width:1040px;margin:0 auto">

    <!-- ── SUB-TAB 1: STORE HOME ── -->
    <sc-if value="{{ storeTabIsHome }}">
      <div style="display:flex;flex-direction:column;gap:36px">

        <!-- Hero Featured Merchandising Card -->
        <div style="background:var(--color-neutral-100);border:1px solid var(--color-divider);border-radius:var(--radius-lg);padding:44px 36px;display:flex;flex-direction:column;gap:16px;align-items:center;text-align:center">
          <span style="font:600 12px/1 var(--font-heading);letter-spacing:.08em;text-transform:uppercase;color:var(--color-text-muted)">Featured · Apple Silicon</span>
          <h2 style="color:var(--color-text);margin:0;font-size:clamp(26px, 4vw, 40px);font-weight:700;letter-spacing:-.03em;line-height:1.05">MacBook Air &amp; Pro.<br>Studio power, sealed in box.</h2>
          <p style="color:var(--color-text-secondary);max-width:520px;margin:2px 0 4px;font-size:15px;line-height:1.5">
            M2 and M3 architecture with local Douala warranty and free express setup.
          </p>
          <div style="display:flex;gap:12px;margin-top:8px;align-items:center;flex-wrap:wrap;justify-content:center">
            <button onClick="{{ on.product }}" class="btn btn-primary" style="height:46px;padding:0 26px;font-weight:600;border-radius:var(--radius-pill)">
              Shop MacBook Air · XAF 745 000
            </button>
            <button onClick="{{ () => setStoreActiveTab('products') }}" style="border:none;background:transparent;color:var(--color-accent);font:600 14px/1 var(--font-heading);cursor:pointer">
              View all laptops →
            </button>
          </div>
        </div>

        <!-- Best Sellers Grid -->
        <div>
          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px">
            <h3 style="margin:0;font-size:18px;letter-spacing:-.02em">Best Selling Tech In Stock</h3>
            <button onClick="{{ () => setStoreActiveTab('products') }}" style="border:none;background:transparent;color:var(--color-accent);font:700 12px/1 var(--font-heading);cursor:pointer">
              VIEW ALL 318 ITEMS →
            </button>
          </div>

          <div class="home-grid">
            
            <!-- Item 1 -->
            <button onClick="{{ on.product }}" aria-label="View MacBook Air M2">
              <div class="ph" style="aspect-ratio:4/3">
                <span class="badge-floating badge-hot">BEST SELLER</span>
              </div>
              <div style="padding:10px 4px 4px">
                <div style="font:700 13.5px/1.2 var(--font-heading);color:var(--color-text)">Apple MacBook Air 13” (M2)</div>
                <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:4px">Space Grey · 8GB / 256GB SSD</div>
                <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:8px">
                  <span style="font:800 14px/1 var(--font-heading);color:var(--color-accent)">XAF 745 000</span>
                  <span style="font:700 11px/1 var(--font-heading);color:#eab308">★ 4.9 (218)</span>
                </div>
              </div>
            </button>

            <!-- Item 2 -->
            <button onClick="{{ on.product }}" aria-label="View Anker 737 Power Bank">
              <div class="ph" style="aspect-ratio:4/3">
                <span class="badge-floating badge-blue">POWER STATION</span>
              </div>
              <div style="padding:10px 4px 4px">
                <div style="font:700 13.5px/1.2 var(--font-heading);color:var(--color-text)">Anker 737 Power Bank (24k)</div>
                <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:4px">140W GaN Fast Charge Display</div>
                <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:8px">
                  <span style="font:800 14px/1 var(--font-heading);color:var(--color-accent)">XAF 62 000</span>
                  <span style="font:700 11px/1 var(--font-heading);color:#eab308">★ 4.8 (94)</span>
                </div>
              </div>
            </button>

            <!-- Item 3 -->
            <button onClick="{{ on.product }}" aria-label="View Sony WH-1000XM5">
              <div class="ph" style="aspect-ratio:4/3">
                <span class="badge-floating badge-sale">-28%</span>
              </div>
              <div style="padding:10px 4px 4px">
                <div style="font:700 13.5px/1.2 var(--font-heading);color:var(--color-text)">Sony WH-1000XM5 ANC</div>
                <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:4px">Industry Active Noise Cancelling</div>
                <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:8px">
                  <span style="font:800 14px/1 var(--font-heading);color:var(--color-accent)">XAF 189 000</span>
                  <span style="font:700 11px/1 var(--font-heading);color:#eab308">★ 4.9 (142)</span>
                </div>
              </div>
            </button>

            <!-- Item 4 -->
            <button onClick="{{ on.product }}" aria-label="View Samsung Galaxy A55">
              <div class="ph" style="aspect-ratio:4/3">
                <span class="badge-floating badge-new">NEW</span>
              </div>
              <div style="padding:10px 4px 4px">
                <div style="font:700 13.5px/1.2 var(--font-heading);color:var(--color-text)">Samsung Galaxy A55 5G</div>
                <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:4px">128GB Storage · Awesome Navy</div>
                <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:8px">
                  <span style="font:800 14px/1 var(--font-heading);color:var(--color-accent)">XAF 245 000</span>
                  <span style="font:700 11px/1 var(--font-heading);color:#eab308">★ 4.7 (76)</span>
                </div>
              </div>
            </button>

          </div>
        </div>

      </div>
    </sc-if>

    <!-- ── SUB-TAB 2: PRODUCTS CATALOG ── -->
    <sc-if value="{{ storeTabIsProducts }}">
      <div style="display:flex;flex-direction:column;gap:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
          <div>
            <h3 style="margin:0;font-size:18px">Store Product Catalog (318 Items)</h3>
            <div style="font:400 12px/1.3 var(--font-body);color:var(--color-text-secondary);margin-top:2px">All items verified in Douala showroom inventory</div>
          </div>
          <div class="hs" style="gap:8px">
            <button class="tag tag-accent">All (318)</button>
            <button class="tag tag-neutral">Laptops (84)</button>
            <button class="tag tag-neutral">Audio (62)</button>
            <button class="tag tag-neutral">Power &amp; Batteries (45)</button>
            <button class="tag tag-neutral">Smartphones (127)</button>
          </div>
        </div>

        <div class="home-grid">
          <button onClick="{{ on.product }}" aria-label="View MacBook Air M2">
            <div class="ph" style="aspect-ratio:4/3"></div>
            <div style="padding:10px 4px 4px">
              <div style="font:700 13px/1.2 var(--font-heading);color:var(--color-text)">MacBook Air M2 13”</div>
              <div style="font:800 14px/1 var(--font-heading);color:var(--color-accent);margin-top:4px">XAF 745 000</div>
            </div>
          </button>
          <button onClick="{{ on.product }}" aria-label="View Anker 737 Power Bank">
            <div class="ph" style="aspect-ratio:4/3"></div>
            <div style="padding:10px 4px 4px">
              <div style="font:700 13px/1.2 var(--font-heading);color:var(--color-text)">Anker 737 Bank</div>
              <div style="font:800 14px/1 var(--font-heading);color:var(--color-accent);margin-top:4px">XAF 62 000</div>
            </div>
          </button>
          <button onClick="{{ on.product }}" aria-label="View Sony WH-1000XM5">
            <div class="ph" style="aspect-ratio:4/3"></div>
            <div style="padding:10px 4px 4px">
              <div style="font:700 13px/1.2 var(--font-heading);color:var(--color-text)">Sony WH-1000XM5</div>
              <div style="font:800 14px/1 var(--font-heading);color:var(--color-accent);margin-top:4px">XAF 189 000</div>
            </div>
          </button>
          <button onClick="{{ on.product }}" aria-label="View Samsung Galaxy A55">
            <div class="ph" style="aspect-ratio:4/3"></div>
            <div style="padding:10px 4px 4px">
              <div style="font:700 13px/1.2 var(--font-heading);color:var(--color-text)">Samsung Galaxy A55</div>
              <div style="font:800 14px/1 var(--font-heading);color:var(--color-accent);margin-top:4px">XAF 245 000</div>
            </div>
          </button>
        </div>
      </div>
    </sc-if>

    <!-- ── SUB-TAB 3: COLLECTIONS & BUNDLES ── -->
    <sc-if value="{{ storeTabIsCollections }}">
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:16px">
        <div class="card-premium" style="display:flex;flex-direction:column;gap:12px">
          <div class="ph" style="aspect-ratio:16/9;border-radius:var(--radius-md)">
            <span>BUNDLE VISUAL</span>
          </div>
          <span class="kicker">CREATOR ECOSYSTEM</span>
          <h4 style="margin:0;font-size:16px">Developer Pro Workstation Bundle</h4>
          <p style="font-size:13px;color:var(--color-text-secondary);margin:0">
            MacBook Air M2 + Anker 737 GaN Fast Charger + Magic Mouse. Save 12% on complete workstation.
          </p>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
            <span style="font:800 16px/1 var(--font-heading);color:var(--color-accent)">XAF 820 000</span>
            <button onClick="{{ on.product }}" class="btn btn-primary" style="height:36px;font-size:12px">VIEW BUNDLE</button>
          </div>
        </div>

        <div class="card-premium" style="display:flex;flex-direction:column;gap:12px">
          <div class="ph" style="aspect-ratio:16/9;border-radius:var(--radius-md)">
            <span>STUDIO SOUND</span>
          </div>
          <span class="kicker">AUDIOPHILE LINEUP</span>
          <h4 style="margin:0;font-size:16px">Sony Acoustic Masters</h4>
          <p style="font-size:13px;color:var(--color-text-secondary);margin:0">
            Wireless noise cancelling headphones with LDAC high resolution codec and hard carry cases.
          </p>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
            <span style="font:800 16px/1 var(--font-heading);color:var(--color-accent)">From XAF 189 000</span>
            <button onClick="{{ on.product }}" class="btn btn-primary" style="height:36px;font-size:12px">VIEW BUNDLE</button>
          </div>
        </div>
      </div>
    </sc-if>

    <!-- ── SUB-TAB 4: ABOUT & LOCATION ── -->
    <sc-if value="{{ storeTabIsAbout }}">
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:20px">
        
        <div class="card-premium" style="display:flex;flex-direction:column;gap:14px">
          <h4 style="margin:0;font-size:16px">Storefront Identity &amp; Heritage</h4>
          <p style="font-size:13.5px;line-height:1.6;color:var(--color-text-secondary);margin:0">
            Orca Electronics has operated in Douala since 2018, providing certified consumer electronics, laptops, and mobile accessories. We hold authorized distribution licenses for Apple, Dell, and Anker hardware in Central Africa.
          </p>
          <div style="border-top:1px solid var(--color-divider);padding-top:12px;display:flex;flex-direction:column;gap:8px;font-size:13px">
            <div><strong>RCCM Number:</strong> RC/DLA/2023/B/1842</div>
            <div><strong>Tax ID (NIU):</strong> M052112345678A</div>
            <div><strong>Business Type:</strong> SARL Commercial Tech Distributor</div>
          </div>
        </div>

        <div class="card-premium" style="display:flex;flex-direction:column;gap:14px">
          <h4 style="margin:0;font-size:16px">Showroom Location &amp; Operating Hours</h4>
          <div style="font-size:13px;color:var(--color-text-secondary)">
            <div>📍 <strong>Address:</strong> Boulevard de la Liberté, Akwa Commercial Zone, Douala</div>
            <div style="margin-top:4px">🏢 <strong>Landmark:</strong> Next to Total Akwa Roundabout</div>
            <div style="margin-top:4px">📞 <strong>Direct Line:</strong> +237 690 12 34 56</div>
          </div>
          <div style="border-top:1px solid var(--color-divider);padding-top:12px">
            <div style="font:700 12px/1 var(--font-heading);color:var(--color-text);margin-bottom:6px">OPERATING SCHEDULE</div>
            <div style="font-size:12.5px;color:var(--color-text-secondary);display:flex;flex-direction:column;gap:4px">
              <div>Monday – Friday: 08:00 – 18:30</div>
              <div>Saturday: 08:30 – 17:00</div>
              <div>Sunday: Closed (Escrow Orders Processed Online)</div>
            </div>
          </div>
        </div>

      </div>
    </sc-if>

    <!-- ── SUB-TAB 5: REVIEWS & TRUST ── -->
    <sc-if value="{{ storeTabIsReviews }}">
      <div style="display:flex;flex-direction:column;gap:20px">
        
        <!-- Scorecard Summary -->
        <div class="card-premium" style="display:flex;align-items:center;gap:32px;flex-wrap:wrap;padding:24px">
          <div style="text-align:center;min-width:120px">
            <div style="font:800 36px/1 var(--font-heading);color:var(--color-text)">4.9</div>
            <div style="color:#eab308;font-size:16px;margin:6px 0">★★★★★</div>
            <div style="font:500 12px/1 var(--font-body);color:var(--color-text-secondary)">218 Verified Reviews</div>
          </div>

          <div style="flex:1;min-width:200px;display:flex;flex-direction:column;gap:6px;font-size:12px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="width:24px">5★</span>
              <div style="flex:1;height:8px;background:var(--color-neutral-200);border-radius:4px;overflow:hidden">
                <div style="width:88%;height:100%;background:var(--color-accent);border-radius:4px"></div>
              </div>
              <span style="width:36px;text-align:right">88%</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="width:24px">4★</span>
              <div style="flex:1;height:8px;background:var(--color-neutral-200);border-radius:4px;overflow:hidden">
                <div style="width:9%;height:100%;background:var(--color-accent);border-radius:4px"></div>
              </div>
              <span style="width:36px;text-align:right">9%</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="width:24px">3★</span>
              <div style="flex:1;height:8px;background:var(--color-neutral-200);border-radius:4px;overflow:hidden">
                <div style="width:2%;height:100%;background:var(--color-neutral-400);border-radius:4px"></div>
              </div>
              <span style="width:36px;text-align:right">2%</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="width:24px">2★</span>
              <div style="flex:1;height:8px;background:var(--color-neutral-200);border-radius:4px;overflow:hidden">
                <div style="width:1%;height:100%;background:var(--color-neutral-400);border-radius:4px"></div>
              </div>
              <span style="width:36px;text-align:right">1%</span>
            </div>
          </div>
        </div>

        <!-- Verified Reviews Items -->
        <div style="display:flex;flex-direction:column;gap:12px">
          
          <div class="card-premium" style="padding:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font:700 13.5px/1 var(--font-heading)">Emmanuel N. (Douala)</span>
                <span class="tag" style="background:var(--color-success-100);color:var(--color-success);font-size:9.5px;padding:1px 6px">VERIFIED PURCHASE</span>
              </div>
              <span style="color:#eab308;font-weight:800;font-size:12.5px">★ 5.0</span>
            </div>
            <div style="font:400 13px/1.5 var(--font-body);color:var(--color-text)">
              "Bought a MacBook Air M2. The box was sealed, original serial number verified on Apple's check coverage portal. Hand-delivered in Akwa within 2 hours. Escrow release was super smooth!"
            </div>
          </div>

          <div class="card-premium" style="padding:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font:700 13.5px/1 var(--font-heading)">Clarisse M. (Yaoundé Bastos)</span>
                <span class="tag" style="background:var(--color-success-100);color:var(--color-success);font-size:9.5px;padding:1px 6px">VERIFIED PURCHASE</span>
              </div>
              <span style="color:#eab308;font-weight:800;font-size:12.5px">★ 5.0</span>
            </div>
            <div style="font:400 13px/1.5 var(--font-body);color:var(--color-text)">
              "Fast shipping to Yaoundé via Finexs VIP parcel delivery. Product arrived in pristine condition with receipt and 12-month store warranty certificate."
            </div>
          </div>

        </div>

      </div>
    </sc-if>

  </div>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     OFFICIAL BRAND ECOSYSTEM DESTINATION (is.brand)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.brand }}">
<div class="brand-page-wrap" style="padding-bottom:64px">

  <!-- Sticky Top Navigation Bar -->
  <div class="page-head" style="justify-content:space-between">
    <div style="display:flex;align-items:center;gap:12px">
      <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text);cursor:pointer">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <div>
        <div style="font:800 15px/1.2 var(--font-heading);color:var(--color-text)">Official Brand Destination</div>
        <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary)">Certified hardware with authorized Cameroon warranties &amp; service</div>
      </div>
    </div>

    <!-- Quick Brand Actions -->
    <div style="display:flex;gap:8px;align-items:center">
      <button onClick="{{ shareBrand }}" class="btn btn-secondary" style="height:36px;font-size:12px;gap:6px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        <span>SHARE</span>
      </button>
      <button onClick="{{ toggleBrandFollow }}" class="btn {{ brandFollowed ? 'btn-secondary' : 'btn-primary' }}" style="height:36px;padding:0 16px;font-size:12px;font-weight:700">
        {{ brandFollowed ? 'FOLLOWING' : '+ FOLLOW BRAND' }}
      </button>
    </div>
  </div>

  <!-- ── EDITORIAL BRAND HERO BANNER ── -->
  <div style="background:linear-gradient(135deg, #0d1117 0%, #161b22 50%, #1f242c 100%);color:#fff;position:relative;overflow:hidden">
    <div style="position:absolute;inset:0;opacity:0.08;background-image:radial-gradient(#fff 1px, transparent 1px);background-size:24px 24px"></div>
    
    <div style="max-width:1300px;margin:0 auto;padding:40px 20px 32px;position:relative;z-index:2;display:flex;flex-direction:column;gap:20px">
      
      <!-- Interactive Brand Switcher Pills -->
      <div class="hs" style="gap:10px;padding-bottom:6px">
        <button onClick="{{ () => selectBrand('apple') }}" class="tag" style="height:38px;padding:0 16px;cursor:pointer;font-size:13px;font-weight:800;border-radius:var(--radius-pill);background:{{ isBrandApple ? '#ffffff' : 'rgba(255,255,255,0.1)' }};color:{{ isBrandApple ? '#000000' : '#ffffff' }};border:1px solid rgba(255,255,255,0.2)">
           Apple
        </button>
        <button onClick="{{ () => selectBrand('sony') }}" class="tag" style="height:38px;padding:0 16px;cursor:pointer;font-size:13px;font-weight:800;border-radius:var(--radius-pill);background:{{ isBrandSony ? '#ffffff' : 'rgba(255,255,255,0.1)' }};color:{{ isBrandSony ? '#000000' : '#ffffff' }};border:1px solid rgba(255,255,255,0.2)">
          SONY
        </button>
        <button onClick="{{ () => selectBrand('samsung') }}" class="tag" style="height:38px;padding:0 16px;cursor:pointer;font-size:13px;font-weight:800;border-radius:var(--radius-pill);background:{{ isBrandSamsung ? '#ffffff' : 'rgba(255,255,255,0.1)' }};color:{{ isBrandSamsung ? '#000000' : '#ffffff' }};border:1px solid rgba(255,255,255,0.2)">
          SAMSUNG
        </button>
        <button onClick="{{ () => selectBrand('anker') }}" class="tag" style="height:38px;padding:0 16px;cursor:pointer;font-size:13px;font-weight:800;border-radius:var(--radius-pill);background:{{ isBrandAnker ? '#ffffff' : 'rgba(255,255,255,0.1)' }};color:{{ isBrandAnker ? '#000000' : '#ffffff' }};border:1px solid rgba(255,255,255,0.2)">
          ANKER
        </button>
        <button onClick="{{ () => selectBrand('nike') }}" class="tag" style="height:38px;padding:0 16px;cursor:pointer;font-size:13px;font-weight:800;border-radius:var(--radius-pill);background:{{ isBrandNike ? '#ffffff' : 'rgba(255,255,255,0.1)' }};color:{{ isBrandNike ? '#000000' : '#ffffff' }};border:1px solid rgba(255,255,255,0.2)">
          NIKE
        </button>
      </div>

      <!-- Main Editorial Headline Block -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:20px">
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span class="kicker" style="color:var(--color-accent-energy)">OFFICIAL BRAND ECOSYSTEM</span>
            <span class="tag tag-accent" style="font-size:9.5px;padding:1px 7px;font-weight:800">100% CERTIFIED</span>
          </div>

          <sc-if value="{{ isBrandApple }}">
            <h1 style="color:#ffffff;margin:0 0 10px;font-size:clamp(26px, 3.8vw, 38px);font-weight:800;letter-spacing:-.03em">
              Apple Silicon &amp; Pro Ecosystem
            </h1>
            <p style="color:rgba(255,255,255,0.85);margin:0;font-size:14px;max-width:680px;line-height:1.6">
              Experience the power of M2 &amp; M3 MacBooks, iPhone 15 &amp; 16 Pro, iPad Studio, and Apple Watch Ultra. Sourced through authorized Cameroon distribution with local technical warranty support in Douala &amp; Yaoundé.
            </p>
          </sc-if>

          <sc-if value="{{ isBrandSony }}">
            <h1 style="color:#ffffff;margin:0 0 10px;font-size:clamp(26px, 3.8vw, 38px);font-weight:800;letter-spacing:-.03em">
              Sony Studio Audio &amp; Alpha Optics
            </h1>
            <p style="color:rgba(255,255,255,0.85);margin:0;font-size:14px;max-width:680px;line-height:1.6">
              Industry-leading active noise cancellation with WH-1000XM5, PlayStation 5 consoles, and Alpha mirrorless digital cinematography hardware.
            </p>
          </sc-if>

          <sc-if value="{{ isBrandSamsung }}">
            <h1 style="color:#ffffff;margin:0 0 10px;font-size:clamp(26px, 3.8vw, 38px);font-weight:800;letter-spacing:-.03em">
              Samsung Galaxy &amp; Smart Living
            </h1>
            <p style="color:rgba(255,255,255,0.85);margin:0;font-size:14px;max-width:680px;line-height:1.6">
              Next-generation Galaxy S-series flagships, Dynamic AMOLED 120Hz displays, and smart appliances backed by official CEMAC service networks.
            </p>
          </sc-if>

          <sc-if value="{{ isBrandAnker }}">
            <h1 style="color:#ffffff;margin:0 0 10px;font-size:clamp(26px, 3.8vw, 38px);font-weight:800;letter-spacing:-.03em">
              Anker GaN Fast Power &amp; Stations
            </h1>
            <p style="color:rgba(255,255,255,0.85);margin:0;font-size:14px;max-width:680px;line-height:1.6">
              High-efficiency GaN fast chargers, 24,000mAh portable display power banks, and heavy-duty battery backup stations for Cameroon creator setups.
            </p>
          </sc-if>

          <sc-if value="{{ isBrandNike }}">
            <h1 style="color:#ffffff;margin:0 0 10px;font-size:clamp(26px, 3.8vw, 38px);font-weight:800;letter-spacing:-.03em">
              Nike Sportswear &amp; Air Performance
            </h1>
            <p style="color:rgba(255,255,255,0.85);margin:0;font-size:14px;max-width:680px;line-height:1.6">
              Authentic Nike running shoes, athletic apparel, and training gear verified by authorized Central Africa retail partners.
            </p>
          </sc-if>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:var(--radius-md);padding:16px 20px;min-width:220px">
          <div style="font:700 11px/1 var(--font-heading);color:var(--color-accent-energy);text-transform:uppercase">OFFICIAL GUARANTEE</div>
          <div style="font-size:12.5px;color:#fff;display:flex;flex-direction:column;gap:6px;margin-top:2px">
            <div>✓ 1-Year Official Warranty</div>
            <div>✓ Serial Number Verified</div>
            <div>✓ Escrow Protected Delivery</div>
          </div>
        </div>

      </div>

    </div>
  </div>

  <div style="padding:24px 16px;max-width:1300px;margin:0 auto;display:flex;flex-direction:column;gap:32px">

    <!-- ── SECTION 1: AUTHORIZED CAMEROON RETAIL PARTNERS ── -->
    <div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px">
        <div>
          <h3 style="margin:0;font-size:18px;letter-spacing:-.02em">Authorized Retail Partners</h3>
          <div style="font:400 12.5px/1.3 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Certified physical boutiques carrying genuine inventory with manufacturer warranty</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:16px">
        
        <!-- Partner Card 1 -->
        <div class="card-premium" style="display:flex;flex-direction:column;justify-content:space-between;gap:14px">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:48px;height:48px;border-radius:var(--radius-md);background:linear-gradient(135deg,var(--color-accent),#003d8a);color:#fff;display:flex;align-items:center;justify-content:center;font:800 20px/1 var(--font-heading)">O</div>
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font:700 16px/1.2 var(--font-heading);color:var(--color-text)">Orca Electronics</span>
                <span class="tag tag-accent" style="min-height:16px;padding:1px 6px;font-size:9px">DIRECT PARTNER</span>
              </div>
              <div style="font:400 12px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Akwa Commercial Blvd, Douala · ★ 4.9 (1.2k)</div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--color-divider);padding-top:10px">
            <span style="font:600 12px/1 var(--font-body);color:var(--color-success)">84 Authorized Listings in stock</span>
            <button onClick="{{ on.business }}" class="btn btn-secondary" style="height:34px;padding:0 14px;font-size:11.5px;font-weight:700">STOREFRONT →</button>
          </div>
        </div>

        <!-- Partner Card 2 -->
        <div class="card-premium" style="display:flex;flex-direction:column;justify-content:space-between;gap:14px">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:48px;height:48px;border-radius:var(--radius-md);background:linear-gradient(135deg,#111214,#2d313a);color:#fff;display:flex;align-items:center;justify-content:center;font:800 20px/1 var(--font-heading)">D</div>
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font:700 16px/1.2 var(--font-heading);color:var(--color-text)">Digital Corner</span>
                <span class="tag tag-neutral" style="min-height:16px;padding:1px 6px;font-size:9px">VERIFIED RESELLER</span>
              </div>
              <div style="font:400 12px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Rue Joss, Bonapriso, Douala · ★ 4.7 (890)</div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--color-divider);padding-top:10px">
            <span style="font:600 12px/1 var(--font-body);color:var(--color-success)">62 Authorized Listings in stock</span>
            <button onClick="{{ on.business }}" class="btn btn-secondary" style="height:34px;padding:0 14px;font-size:11.5px;font-weight:700">STOREFRONT →</button>
          </div>
        </div>

      </div>
    </div>

    <!-- ── SECTION 2: OFFICIAL HARDWARE & ECOSYSTEM PRODUCTS ── -->
    <div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px">
        <div>
          <h3 style="margin:0;font-size:18px;letter-spacing:-.02em">Official Hardware Ecosystem</h3>
          <div style="font:400 12.5px/1.3 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Brand new sealed hardware with escrow checkout and express pickup</div>
        </div>
      </div>

      <div class="home-grid">
        
        <!-- Brand Product 1 -->
        <button onClick="{{ on.product }}" aria-label="View MacBook Air M2">
          <div class="ph" style="aspect-ratio:4/3">
            <span class="badge-floating badge-hot">OFFICIAL M2</span>
          </div>
          <div style="padding:10px 4px 4px">
            <div style="font:700 13.5px/1.2 var(--font-heading);color:var(--color-text)">Apple MacBook Air 13” (M2)</div>
            <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:4px">Space Grey · 8GB / 256GB SSD</div>
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:8px">
              <span style="font:800 14px/1 var(--font-heading);color:var(--color-accent)">XAF 745 000</span>
              <span style="font:700 11px/1 var(--font-heading);color:#eab308">★ 4.9</span>
            </div>
          </div>
        </button>

        <!-- Brand Product 2 -->
        <button onClick="{{ on.product }}" aria-label="View Anker 737 Bank">
          <div class="ph" style="aspect-ratio:4/3">
            <span class="badge-floating badge-blue">140W GaN</span>
          </div>
          <div style="padding:10px 4px 4px">
            <div style="font:700 13.5px/1.2 var(--font-heading);color:var(--color-text)">Anker 737 GaN 24k Bank</div>
            <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:4px">Smart Digital Display Output</div>
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:8px">
              <span style="font:800 14px/1 var(--font-heading);color:var(--color-accent)">XAF 62 000</span>
              <span style="font:700 11px/1 var(--font-heading);color:#eab308">★ 4.8</span>
            </div>
          </div>
        </button>

        <!-- Brand Product 3 -->
        <button onClick="{{ on.product }}" aria-label="View Sony WH-1000XM5">
          <div class="ph" style="aspect-ratio:4/3">
            <span class="badge-floating badge-sale">NOISE CANCEL</span>
          </div>
          <div style="padding:10px 4px 4px">
            <div style="font:700 13.5px/1.2 var(--font-heading);color:var(--color-text)">Sony WH-1000XM5 ANC</div>
            <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:4px">Hi-Res LDAC Wireless Studio</div>
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:8px">
              <span style="font:800 14px/1 var(--font-heading);color:var(--color-accent)">XAF 189 000</span>
              <span style="font:700 11px/1 var(--font-heading);color:#eab308">★ 4.9</span>
            </div>
          </div>
        </button>

        <!-- Brand Product 4 -->
        <button onClick="{{ on.product }}" aria-label="View Samsung Galaxy A55">
          <div class="ph" style="aspect-ratio:4/3">
            <span class="badge-floating badge-new">120Hz 5G</span>
          </div>
          <div style="padding:10px 4px 4px">
            <div style="font:700 13.5px/1.2 var(--font-heading);color:var(--color-text)">Samsung Galaxy A55 5G</div>
            <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:4px">128GB Storage · Awesome Navy</div>
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:8px">
              <span style="font:800 14px/1 var(--font-heading);color:var(--color-accent)">XAF 245 000</span>
              <span style="font:700 11px/1 var(--font-heading);color:#eab308">★ 4.7</span>
            </div>
          </div>
        </button>

      </div>
    </div>

  </div>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     SELLER STUDIO & DASHBOARD (is.seller)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.seller }}">
<div class="seller-page-wrap" style="padding-bottom:32px">
  
  <div class="page-head" style="justify-content:space-between">
    <div style="display:flex;align-items:center;gap:12px">
      <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text);cursor:pointer">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <div>
        <h4 style="margin:0;font-size:16px">{{ currentStoreName || 'Seller Studio' }}</h4>
        <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary)">{{ currentStoreCategoryLabel }} · Merchant Dashboard</div>
      </div>
    </div>
    <button onClick="{{ handleSellClick }}" class="btn btn-primary" style="height:36px;padding:0 14px;font-size:12px;cursor:pointer">+ POST LISTING</button>
  </div>

  <div style="padding:16px;max-width:960px;margin:0 auto;display:flex;flex-direction:column;gap:16px">

    <!-- Storefront Quick Link Bar -->
    <div style="background:var(--color-surface);border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div style="display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden">
        <span class="tag {{ sellerStatus === 'READY' ? 'tag-accent' : 'tag-neutral' }}" style="font-size:9.5px;font-weight:700;padding:2px 6px">
          {{ sellerStatus === 'READY' ? 'LIVE' : 'SETUP' }}
        </span>
        <span style="font:600 12px/1.2 var(--font-body);color:var(--color-text);text-overflow:ellipsis;white-space:nowrap;overflow:hidden">loumoo.cm/s/{{ currentStoreSlug || 'store' }}</span>
      </div>
      <button onClick="{{ openPublicStorefront }}" class="tag tag-accent" style="cursor:pointer;font-size:10.5px;font-weight:700;padding:3px 10px;flex-shrink:0">
        Preview Storefront ↗
      </button>
    </div>
    
    <!-- Revenue leads; the rest supports it. -->
    <div class="surface-raised" style="padding:20px 18px 18px">
      <div class="eyebrow">This month</div>
      <div class="metric-hero" style="margin-top:10px">
        <div class="metric-hero-row">
          <span class="metric-value">{{ sellerRevenue || 'XAF 0' }}</span>
          <sc-if value="{{ sellerRevenueDelta }}">
            <span class="delta delta-up">{{ sellerRevenueDelta }}</span>
          </sc-if>
        </div>
        <div class="metric-label">Revenue</div>
        <div class="metric-note">{{ sellerRevenueNote || 'No sales yet this month. Your first published listing starts the clock.' }}</div>
      </div>

      <div class="stat-grid" style="margin-top:18px">
        <div class="stat-tile">
          <div class="stat-tile-top">
            <span class="stat-tile-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
            </span>
          </div>
          <div class="metric-value-sm">{{ sellerActiveOrdersCount || 0 }}</div>
          <div class="stat-tile-label">Pending orders</div>
        </div>

        <div class="stat-tile">
          <div class="stat-tile-top">
            <span class="stat-tile-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            </span>
          </div>
          <div class="metric-value-sm">{{ sellerStoreViewsCount || 0 }}</div>
          <div class="stat-tile-label">Views</div>
        </div>

        <div class="stat-tile">
          <div class="stat-tile-top">
            <span class="stat-tile-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
            </span>
          </div>
          <div class="metric-value-sm">{{ sellerLiveCount || 0 }}</div>
          <div class="stat-tile-label">Live</div>
        </div>
      </div>
    </div>


    <!-- Home deliveries: opens the dispatch board (src/services/sellerDispatch.js)
         through [data-open-dispatch], a document-level delegate, so no DC binding. -->
    <button type="button" data-open-dispatch class="surface-raised" aria-label="Deliveries: assign riders and follow home deliveries"
      style="display:flex;align-items:center;gap:14px;width:100%;padding:16px;border:0;text-align:left;cursor:pointer;color:var(--color-text)">
      <span style="width:44px;height:44px;border-radius:12px;background:var(--color-accent-100);color:var(--color-accent);display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="17.5" r="2.5"/><circle cx="18.5" cy="17.5" r="2.5"/><path d="M8 17.5h7.5l-3-8H9"/><path d="M15 6h2.5l1 4.5"/><path d="M12.5 9.5H17"/></svg>
      </span>
      <span style="flex:1;min-width:0">
        <span style="display:block;font:700 15px/1.25 var(--font-heading)">Deliveries</span>
        <span style="display:block;margin-top:3px;font:400 13px/1.35 var(--font-body);color:var(--color-text-secondary)">Assign riders to home-delivery orders and follow them to the door.</span>
      </span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
    </button>

    <!-- Performance: store analytics + campaign reporting, together -->
    <div class="surface-raised" style="padding:18px 16px">
      <div class="section-head" style="margin-bottom:4px">
        <div class="section-head-text">
          <div class="eyebrow">Performance</div>
          <h4 class="section-head-title" style="font-size:16px;margin-top:6px">Reach &amp; results</h4>
        </div>
      </div>

      <button onClick="{{ on.storeAnalytics }}" class="quiet-row">
        <span class="quiet-row-label">Storefront analytics</span>
        <span class="quiet-row-value">
          Views, conversion, revenue
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        </span>
      </button>

      <button onClick="{{ on.announceCampaigns }}" class="quiet-row">
        <span class="quiet-row-label">Campaigns &amp; analytics</span>
        <span class="quiet-row-value">
          Broadcast reach &amp; spend
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        </span>
      </button>

      <button onClick="{{ openAnnounceStudioFromSell }}" class="quiet-row">
        <span class="quiet-row-label">Publishing studio</span>
        <span class="quiet-row-value">
          Draft a broadcast
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        </span>
      </button>
    </div>

    <!-- Inventory Quick Actions -->
    <div class="card-premium">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h4 style="margin:0;font-size:15px">Inventory &amp; Listings</h4>
        <button onClick="{{ on.myListings }}" style="border:none;background:transparent;font:700 12px/1 var(--font-heading);color:var(--color-accent);cursor:pointer">View all listings →</button>
      </div>

      <sc-if value="{{ sellerLiveCount > 0 }}">
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--color-surface-subtle);border-radius:var(--radius-sm);border:1px solid var(--color-divider)">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="tag tag-accent" style="min-height:20px;padding:2px 8px;font-size:10px;font-weight:700">ACTIVE</span>
              <span style="font:600 13px/1.2 var(--font-body);color:var(--color-text)">{{ sellerLiveCount }} published listing{{ sellerLiveCount > 1 ? 's' : '' }} in catalogue</span>
            </div>
            <button onClick="{{ on.myListings }}" class="tag tag-neutral" style="font-size:10.5px;cursor:pointer">Manage →</button>
          </div>
        </div>
      </sc-if>

      <sc-if value="{{ !sellerLiveCount }}">
        <div style="padding:24px 16px;text-align:center;background:var(--color-neutral-100);border-radius:var(--radius-md);border:1px dashed var(--color-divider)">
          <div style="font:700 14px/1.2 var(--font-heading);color:var(--color-text);margin-bottom:6px">No listings published yet</div>
          <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary);margin-bottom:14px">Publish your first product, service, or booking to start receiving customer orders across Cameroon.</div>
          <button onClick="{{ handleSellClick }}" class="btn btn-primary" style="height:36px;padding:0 16px;font-size:12px;cursor:pointer">+ POST YOUR FIRST LISTING</button>
        </div>
      </sc-if>
    </div>

  </div>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     MY LISTINGS (is.myListings)
     Real listings from GET /api/v1/listings/seller, rendered through the SAME
     publication card the studio previewed and the buyer feed uses.
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.myListings }}">
<div style="padding-bottom:48px">
  <div class="page-head" style="justify-content:space-between">
    <div style="display:flex;align-items:center;gap:12px;min-width:0">
      <button onClick="{{ back }}" aria-label="Go back" class="pub-iconbtn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <div class="page-head-text">
        <h4 class="page-head-title">What you have published</h4>
        <div class="page-head-sub">{{ currentStoreName }}</div>
      </div>
    </div>
    <button onClick="{{ handleSellClick }}" class="btn btn-primary" style="height:38px;padding:0 16px;font-size:12.5px;flex:none">+ Publish</button>
  </div>

  <div class="page-body" style="max-width:1100px">

    <div class="pub-tabs" role="tablist" aria-label="Publication status">
      <sc-for list="{{ sellerTabs }}" as="tab">
        <button class="pub-tab {{ tab.active ? 'is-active' : '' }}"
                onClick="{{ () => setSellerTab(tab.key) }}">
          <span>{{ tab.label }} ({{ tab.count }})</span>
        </button>
      </sc-for>
    </div>

    <sc-if value="{{ sellerListingsLoading }}">
      <div class="pub-banner is-busy" role="status">
        <span class="pub-spinner" aria-hidden="true"></span>
        <span>Loading what you have published…</span>
      </div>
    </sc-if>

    <sc-if value="{{ sellerListingsError }}">
      <div class="pub-banner is-error" role="alert">
        <span>{{ sellerListingsError }}</span>
        <button class="pub-linkbtn" onClick="{{ reloadSellerListings }}">Try again</button>
      </div>
    </sc-if>

    <sc-if value="{{ !sellerListingsLoading && !sellerListingCards.length }}">
      <div class="pub-empty">
        <div class="pub-empty-mark" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
        </div>
        <h4>{{ sellerEmptyTitle }}</h4>
        <p>{{ sellerEmptyBlurb }}</p>
        <button onClick="{{ handleSellClick }}" class="btn btn-primary">Publish something</button>
      </div>
    </sc-if>

    <div class="pub-grid">
      <sc-for list="{{ sellerListingCards }}" as="card">
        <div class="pub-manage">
          __CARD__
          <div class="pub-manage-actions">
            <button class="pub-manage-btn" onClick="{{ () => editListing(card.id) }}">Edit</button>
            <sc-if value="{{ card.canPublish }}">
              <button class="pub-manage-btn is-primary" onClick="{{ () => publishExisting(card.id) }}">Publish</button>
            </sc-if>
            <sc-if value="{{ card.canPause }}">
              <button class="pub-manage-btn" onClick="{{ () => pauseListing(card.id) }}">Pause</button>
            </sc-if>
            <sc-if value="{{ card.canResume }}">
              <button class="pub-manage-btn is-primary" onClick="{{ () => publishExisting(card.id) }}">Resume</button>
            </sc-if>
            <button class="pub-manage-btn" onClick="{{ () => shareListing(card.id, card.title) }}">Share</button>
            <button class="pub-manage-btn is-danger" onClick="{{ () => archiveListing(card.id, card.title) }}">Delete</button>
          </div>
        </div>
      </sc-for>
    </div>

  </div>
</div>
</sc-if>

"""
