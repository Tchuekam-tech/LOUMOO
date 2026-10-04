# -*- coding: utf-8 -*-
"""
LOUMOO CURATED COLLECTIONS VIEWS
Category discovery, Best Picks editorial magazine, and Black FreeDay high-energy flash sale with Lucide SVG icons.
"""

from .search_shared import get_search_suggestions

def get_collections_view():
    return """
<!-- ══════════════════════════════════════════════════════════════════════════
     ALL CATEGORIES & MARKETPLACE DIRECTORY VIEW (is.category)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.category }}">
<div style="padding-bottom:64px">
  
  <!-- ══════════════════════════════════════════════════════════════════════════
       MODE 1: MASTER MARKETPLACE DIRECTORY (isCategoryDirectory)
       ══════════════════════════════════════════════════════════════════════ -->
  <sc-if value="{{ isCategoryDirectory }}">
    
    <!-- Top Sticky Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-surface);border-bottom:1px solid var(--color-divider);position:sticky;top:0;z-index:20">
      <div style="display:flex;align-items:center;gap:12px">
        <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text);cursor:pointer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div>
          <h4 style="margin:0;font-size:16px;font-weight:800">All Categories</h4>
          <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary)">Explore 1,200+ verified listings across Cameroon</div>
        </div>
      </div>
      <button onClick="{{ on.search }}" aria-label="Search all marketplace" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text);cursor:pointer">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>
      </button>
    </div>

    <!-- Editorial Hero Title & Search Header -->
    <div style="background:linear-gradient(180deg, var(--color-surface) 0%, var(--color-neutral-100) 100%);border-bottom:1px solid var(--color-divider);padding:28px 16px 20px">
      <div style="max-width:1200px;margin:0 auto">
        <span class="kicker" style="color:var(--color-accent)">CENTRAL COMMERCE DIRECTORY</span>
        <h1 style="font:800 clamp(22px, 3.5vw, 32px)/1.15 var(--font-heading);color:var(--color-text);margin:6px 0 8px;letter-spacing:-.02em">
          Explore everything on LOUMOO
        </h1>
        <p style="font:400 13.5px/1.5 var(--font-body);color:var(--color-text-secondary);max-width:680px;margin:0 0 18px">
          Discover products, physical stores, certified services, hotel bookings, VIP travel tickets, and real estate across Cameroon.
        </p>

        <!-- Smart Category Search Input -->
        <div style="position:relative;max-width:640px;display:flex;align-items:center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="position:absolute;left:14px;color:var(--color-text-muted)"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>
          <input type="text" class="input" placeholder="Search categories, products, stores or services…" value="{{ searchQuery }}" onInput="{{ handleCategoryGlobalSearch }}" onKeyDown="{{ handleSearchKey }}" style="padding-left:42px;padding-right:38px;height:46px;font-size:14px;border-radius:var(--radius-pill);box-shadow:var(--shadow-sm)" role="combobox" aria-autocomplete="list" aria-expanded="{{ searchExpanded }}" aria-controls="search-suggestions" aria-activedescendant="{{ searchActiveOption }}" onFocus="{{ searchFocus }}" onBlur="{{ searchBlur }}" onCompositionStart="{{ searchCompositionStart }}" onCompositionEnd="{{ searchCompositionEnd }}" maxlength="200">
""" + get_search_suggestions() + """
          <sc-if value="{{ categorySearchQuery }}">
            <button onClick="{{ clearCategorySearch }}" aria-label="Clear search" style="position:absolute;right:12px;background:var(--color-neutral-200);border:none;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-weight:800;font-size:13px;color:var(--color-text)">✕</button>
          </sc-if>
        </div>

        <!-- Popular Quick-Jump Chips -->
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:16px">
          <span style="font:700 11px/1 var(--font-heading);color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.05em;margin-right:4px">POPULAR:</span>
          <button onClick="{{ () => openCategory('electronics') }}" class="tag tag-neutral" style="cursor:pointer;font-size:11.5px">💻 Tech &amp; Laptops (410)</button>
          <button onClick="{{ () => openCategory('fashion') }}" class="tag tag-neutral" style="cursor:pointer;font-size:11.5px">👗 Fashion &amp; Shoes (320)</button>
          <button onClick="{{ () => openCategory('hotels') }}" class="tag tag-neutral" style="cursor:pointer;font-size:11.5px">🏨 Hotels &amp; Suites (142)</button>
          <button onClick="{{ () => openCategory('travel') }}" class="tag tag-neutral" style="cursor:pointer;font-size:11.5px">🚌 Intercity VIP Bus (64)</button>
          <button onClick="{{ () => openCategory('services') }}" class="tag tag-neutral" style="cursor:pointer;font-size:11.5px">🛠️ Phone Repairs (230)</button>
          <button onClick="{{ () => openCategory('automotive') }}" class="tag tag-neutral" style="cursor:pointer;font-size:11.5px">🚗 Cars &amp; Parts (115)</button>
        </div>
      </div>
    </div>

    <div style="max-width:1200px;margin:0 auto;padding:24px 16px;display:flex;flex-direction:column;gap:32px">

      <!-- Commerce Domain Filter Tabs -->
      <div class="hs" style="gap:10px;padding-bottom:4px;border-bottom:1px solid var(--color-divider);padding-bottom:12px">
        <button onClick="{{ () => selectCategoryDomain('all') }}" class="tag {{ isCategoryDomainAll ? 'tag-accent' : 'tag-neutral' }}" style="height:36px;padding:0 16px;font-size:12.5px;cursor:pointer">
          All Commerce Domains
        </button>
        <button onClick="{{ () => selectCategoryDomain('shop') }}" class="tag {{ isCategoryDomainShop ? 'tag-accent' : 'tag-neutral' }}" style="height:36px;padding:0 16px;font-size:12.5px;cursor:pointer">
          🛍️ Shop &amp; Retail
        </button>
        <button onClick="{{ () => selectCategoryDomain('services') }}" class="tag {{ isCategoryDomainServices ? 'tag-accent' : 'tag-neutral' }}" style="height:36px;padding:0 16px;font-size:12.5px;cursor:pointer">
          🛠️ Services &amp; Skills
        </button>
        <button onClick="{{ () => selectCategoryDomain('travel') }}" class="tag {{ isCategoryDomainTravel ? 'tag-accent' : 'tag-neutral' }}" style="height:36px;padding:0 16px;font-size:12.5px;cursor:pointer">
          ✈️ Travel &amp; Mobility
        </button>
        <button onClick="{{ () => selectCategoryDomain('business') }}" class="tag {{ isCategoryDomainBusiness ? 'tag-accent' : 'tag-neutral' }}" style="height:36px;padding:0 16px;font-size:12.5px;cursor:pointer">
          🏢 Business &amp; Finance
        </button>
      </div>

      <!-- ── DOMAIN 1: SHOP & RETAIL ── -->
      <sc-if value="{{ isCategoryDomainAll || isCategoryDomainShop }}">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">
            <div>
              <span class="kicker" style="color:var(--color-accent)">DOMAIN 01</span>
              <h2 style="margin:2px 0 0;font-size:20px;font-weight:800;letter-spacing:-.02em">Shop &amp; Physical Products</h2>
            </div>
            <span style="font:600 12px/1 var(--font-body);color:var(--color-text-secondary)">845 Verified Listings</span>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(270px, 1fr));gap:16px">
            
            <!-- Category Card 1: Electronics & Tech -->
            <sc-if value="{{ matchElectronics }}">
              <button onClick="{{ () => openCategory('electronics') }}" class="card-premium" style="text-align:left;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;gap:14px;border:1px solid var(--color-divider);transition:all 0.2s ease">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
                    <div style="width:44px;height:44px;border-radius:var(--radius-md);background:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;color:var(--color-accent);border:1px solid var(--color-divider)">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="18" height="12" x="3" y="4" rx="2"/><line x1="2" x2="22" y1="20" y2="20"/></svg>
                    </div>
                    <span class="tag tag-accent" style="font-size:10px;font-weight:800">410 LISTINGS</span>
                  </div>
                  <div style="font:800 16px/1.2 var(--font-heading);color:var(--color-text)">Electronics &amp; Technology</div>
                  <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary);margin-top:4px">
                    Smartphones, Apple M2/M3 laptops, pro audio &amp; GaN fast chargers.
                  </div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:10px;border-top:1px solid var(--color-divider)">
                  <span class="tag tag-neutral" style="font-size:10px">Smartphones (142)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Laptops (84)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Audio (96)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Power (88)</span>
                </div>
              </button>
            </sc-if>

            <!-- Category Card 2: Fashion & Luxury -->
            <sc-if value="{{ matchFashion }}">
              <button onClick="{{ () => openCategory('fashion') }}" class="card-premium" style="text-align:left;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;gap:14px;border:1px solid var(--color-divider);transition:all 0.2s ease">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
                    <div style="width:44px;height:44px;border-radius:var(--radius-md);background:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;color:var(--color-accent);border:1px solid var(--color-divider)">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>
                    </div>
                    <span class="tag tag-neutral" style="font-size:10px;font-weight:800">320 LISTINGS</span>
                  </div>
                  <div style="font:800 16px/1.2 var(--font-heading);color:var(--color-text)">Fashion &amp; Luxury</div>
                  <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary);margin-top:4px">
                    Designer footwear, authentic streetwear, tailored suits &amp; luxury watches.
                  </div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:10px;border-top:1px solid var(--color-divider)">
                  <span class="tag tag-neutral" style="font-size:10px">Footwear (185)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Apparel (95)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Watches (40)</span>
                </div>
              </button>
            </sc-if>

            <!-- Category Card 3: Home & Living -->
            <sc-if value="{{ matchHome }}">
              <button onClick="{{ () => openCategory('home') }}" class="card-premium" style="text-align:left;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;gap:14px;border:1px solid var(--color-divider);transition:all 0.2s ease">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
                    <div style="width:44px;height:44px;border-radius:var(--radius-md);background:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;color:var(--color-accent);border:1px solid var(--color-divider)">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                    </div>
                    <span class="tag tag-neutral" style="font-size:10px;font-weight:800">175 LISTINGS</span>
                  </div>
                  <div style="font:800 16px/1.2 var(--font-heading);color:var(--color-text)">Home &amp; Living</div>
                  <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary);margin-top:4px">
                    Office furniture, living sets, kitchen appliances &amp; lighting decor.
                  </div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:10px;border-top:1px solid var(--color-divider)">
                  <span class="tag tag-neutral" style="font-size:10px">Furniture (85)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Appliances (90)</span>
                </div>
              </button>
            </sc-if>

            <!-- Category Card 4: Vehicles & Automotive -->
            <sc-if value="{{ matchAutomotive }}">
              <button onClick="{{ () => openCategory('automotive') }}" class="card-premium" style="text-align:left;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;gap:14px;border:1px solid var(--color-divider);transition:all 0.2s ease">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
                    <div style="width:44px;height:44px;border-radius:var(--radius-md);background:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;color:var(--color-accent);border:1px solid var(--color-divider)">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>
                    </div>
                    <span class="tag tag-neutral" style="font-size:10px;font-weight:800">115 LISTINGS</span>
                  </div>
                  <div style="font:800 16px/1.2 var(--font-heading);color:var(--color-text)">Vehicles &amp; Automotive</div>
                  <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary);margin-top:4px">
                    Certified passenger cars, light SUVs, replacement parts &amp; tires.
                  </div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:10px;border-top:1px solid var(--color-divider)">
                  <span class="tag tag-neutral" style="font-size:10px">Cars &amp; SUVs (75)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Auto Parts (40)</span>
                </div>
              </button>
            </sc-if>

          </div>
        </div>
      </sc-if>

      <!-- ── DOMAIN 2: SERVICES & SKILLS ── -->
      <sc-if value="{{ isCategoryDomainAll || isCategoryDomainServices }}">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">
            <div>
              <span class="kicker" style="color:var(--color-accent)">DOMAIN 02</span>
              <h2 style="margin:2px 0 0;font-size:20px;font-weight:800;letter-spacing:-.02em">Services &amp; Professional Skills</h2>
            </div>
            <span style="font:600 12px/1 var(--font-body);color:var(--color-text-secondary)">230 Certified Experts</span>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(270px, 1fr));gap:16px">
            
            <!-- Service Card 1: Phone & Tech Repairs -->
            <sc-if value="{{ matchServices }}">
              <button onClick="{{ () => openCategory('services') }}" class="card-premium" style="text-align:left;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;gap:14px;border:1px solid var(--color-divider);transition:all 0.2s ease">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
                    <div style="width:44px;height:44px;border-radius:var(--radius-md);background:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;color:var(--color-accent);border:1px solid var(--color-divider)">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                    </div>
                    <span class="tag tag-accent" style="font-size:10px;font-weight:800">110 REPAIR SHOPS</span>
                  </div>
                  <div style="font:800 16px/1.2 var(--font-heading);color:var(--color-text)">Phone &amp; Tech Repairs</div>
                  <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary);margin-top:4px">
                    Original OLED screen replacements, battery swaps &amp; micro-soldering.
                  </div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:10px;border-top:1px solid var(--color-divider)">
                  <span class="tag tag-neutral" style="font-size:10px">Screens (55)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Batteries (35)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Diagnostics (20)</span>
                </div>
              </button>

              <!-- Service Card 2: Creative & Media -->
              <button onClick="{{ () => openCategory('services') }}" class="card-premium" style="text-align:left;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;gap:14px;border:1px solid var(--color-divider);transition:all 0.2s ease">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
                    <div style="width:44px;height:44px;border-radius:var(--radius-md);background:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;color:var(--color-accent);border:1px solid var(--color-divider)">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                    </div>
                    <span class="tag tag-neutral" style="font-size:10px;font-weight:800">65 STUDIOS</span>
                  </div>
                  <div style="font:800 16px/1.2 var(--font-heading);color:var(--color-text)">Creative Media &amp; Design</div>
                  <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary);margin-top:4px">
                    Event photography, brand cinematography &amp; UI/UX graphic design.
                  </div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:10px;border-top:1px solid var(--color-divider)">
                  <span class="tag tag-neutral" style="font-size:10px">Photo (30)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Video (20)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Branding (15)</span>
                </div>
              </button>

              <!-- Service Card 3: Education & Training -->
              <button onClick="{{ () => openCategory('services') }}" class="card-premium" style="text-align:left;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;gap:14px;border:1px solid var(--color-divider);transition:all 0.2s ease">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
                    <div style="width:44px;height:44px;border-radius:var(--radius-md);background:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;color:var(--color-accent);border:1px solid var(--color-divider)">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                    </div>
                    <span class="tag tag-neutral" style="font-size:10px;font-weight:800">55 INSTITUTES</span>
                  </div>
                  <div style="font:800 16px/1.2 var(--font-heading);color:var(--color-text)">Education &amp; Training</div>
                  <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary);margin-top:4px">
                    Software bootcamps, language certifications &amp; university programs.
                  </div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:10px;border-top:1px solid var(--color-divider)">
                  <span class="tag tag-neutral" style="font-size:10px">Coding (25)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Languages (18)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Higher Ed (12)</span>
                </div>
              </button>
            </sc-if>

          </div>
        </div>
      </sc-if>

      <!-- ── DOMAIN 3: TRAVEL & MOBILITY ── -->
      <sc-if value="{{ isCategoryDomainAll || isCategoryDomainTravel }}">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">
            <div>
              <span class="kicker" style="color:var(--color-accent)">DOMAIN 03</span>
              <h2 style="margin:2px 0 0;font-size:20px;font-weight:800;letter-spacing:-.02em">Travel &amp; Hospitality</h2>
            </div>
            <span style="font:600 12px/1 var(--font-body);color:var(--color-text-secondary)">206 Travel Options</span>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(270px, 1fr));gap:16px">
            
            <!-- Travel Card 1: Hotels & Stays -->
            <sc-if value="{{ matchHotels }}">
              <button onClick="{{ () => openCategory('hotels') }}" class="card-premium" style="text-align:left;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;gap:14px;border:1px solid var(--color-divider);transition:all 0.2s ease">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
                    <div style="width:44px;height:44px;border-radius:var(--radius-md);background:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;color:var(--color-accent);border:1px solid var(--color-divider)">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 22v-6.57"/><path d="M12 11h.01"/><path d="M12 7h.01"/><path d="M14 15.43V22"/><path d="M15 11h.01"/><path d="M15 7h.01"/><path d="M16 16h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/><path d="M18 22v-4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v4"/><path d="M8 22v-6.57"/><path d="M9 11h.01"/><path d="M9 7h.01"/></svg>
                    </div>
                    <span class="tag tag-accent" style="font-size:10px;font-weight:800">142 HOTELS &amp; SUITES</span>
                  </div>
                  <div style="font:800 16px/1.2 var(--font-heading);color:var(--color-text)">Hospitality &amp; Stays</div>
                  <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary);margin-top:4px">
                    5-star luxury hotels, furnished executive studios &amp; Kribi beach resorts.
                  </div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:10px;border-top:1px solid var(--color-divider)">
                  <span class="tag tag-neutral" style="font-size:10px">Suites (94)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Studios (48)</span>
                </div>
              </button>
            </sc-if>

            <!-- Travel Card 2: Intercity Mobility -->
            <sc-if value="{{ matchTravel }}">
              <button onClick="{{ () => openCategory('travel') }}" class="card-premium" style="text-align:left;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;gap:14px;border:1px solid var(--color-divider);transition:all 0.2s ease">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
                    <div style="width:44px;height:44px;border-radius:var(--radius-md);background:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;color:var(--color-accent);border:1px solid var(--color-divider)">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.3c.4-.2.6-.6.5-1.1z"/></svg>
                    </div>
                    <span class="tag tag-neutral" style="font-size:10px;font-weight:800">64 ROUTES</span>
                  </div>
                  <div style="font:800 16px/1.2 var(--font-heading);color:var(--color-text)">Travel &amp; Intercity Mobility</div>
                  <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary);margin-top:4px">
                    Finexs VIP, General Express, Camair-Co flights &amp; Camrail passenger trains.
                  </div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:10px;border-top:1px solid var(--color-divider)">
                  <span class="tag tag-neutral" style="font-size:10px">Buses (32)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Flights (20)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Trains (12)</span>
                </div>
              </button>
            </sc-if>

          </div>
        </div>
      </sc-if>

      <!-- ── DOMAIN 4: BUSINESS & FINANCE ── -->
      <sc-if value="{{ isCategoryDomainAll || isCategoryDomainBusiness }}">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">
            <div>
              <span class="kicker" style="color:var(--color-accent)">DOMAIN 04</span>
              <h2 style="margin:2px 0 0;font-size:20px;font-weight:800;letter-spacing:-.02em">Business &amp; Finance</h2>
            </div>
            <span style="font:600 12px/1 var(--font-body);color:var(--color-text-secondary)">211 Corporate Listings</span>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(270px, 1fr));gap:16px">
            
            <!-- Business Card 1: Real Estate -->
            <sc-if value="{{ matchRealEstate }}">
              <button onClick="{{ () => openCategory('real_estate') }}" class="card-premium" style="text-align:left;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;gap:14px;border:1px solid var(--color-divider);transition:all 0.2s ease">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
                    <div style="width:44px;height:44px;border-radius:var(--radius-md);background:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;color:var(--color-accent);border:1px solid var(--color-divider)">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>
                    </div>
                    <span class="tag tag-accent" style="font-size:10px;font-weight:800">88 PROPERTIES</span>
                  </div>
                  <div style="font:800 16px/1.2 var(--font-heading);color:var(--color-text)">Real Estate &amp; Property</div>
                  <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary);margin-top:4px">
                    Titled land plots, executive duplexes &amp; commercial office spaces in Akwa/Bastos.
                  </div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:10px;border-top:1px solid var(--color-divider)">
                  <span class="tag tag-neutral" style="font-size:10px">Residential (58)</span>
                  <span class="tag tag-neutral" style="font-size:10px">Commercial (30)</span>
                </div>
              </button>
            </sc-if>

            <!-- Business Card 2: Banks & Finance -->
            <sc-if value="{{ matchBanks }}">
              <button onClick="{{ () => openCategory('banks') }}" class="card-premium" style="text-align:left;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;gap:14px;border:1px solid var(--color-divider);transition:all 0.2s ease">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
                    <div style="width:44px;height:44px;border-radius:var(--radius-md);background:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;color:var(--color-accent);border:1px solid var(--color-divider)">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                    </div>
                    <span class="tag tag-neutral" style="font-size:10px;font-weight:800">28 AGENCIES</span>
                  </div>
                  <div style="font:800 16px/1.2 var(--font-heading);color:var(--color-text)">Banks &amp; Financial Services</div>
                  <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary);margin-top:4px">
                    Commercial bank branches, microfinance &amp; verified mobile money kiosks.
                  </div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:10px;border-top:1px solid var(--color-divider)">
                  <span class="tag tag-neutral" style="font-size:10px">Commercial (28)</span>
                </div>
              </button>
            </sc-if>

            <!-- Business Card 3: Digital Products -->
            <sc-if value="{{ matchDigital }}">
              <button onClick="{{ () => openCategory('digital') }}" class="card-premium" style="text-align:left;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;gap:14px;border:1px solid var(--color-divider);transition:all 0.2s ease">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
                    <div style="width:44px;height:44px;border-radius:var(--radius-md);background:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;color:var(--color-accent);border:1px solid var(--color-divider)">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                    </div>
                    <span class="tag tag-neutral" style="font-size:10px;font-weight:800">95 PRODUCTS</span>
                  </div>
                  <div style="font:800 16px/1.2 var(--font-heading);color:var(--color-text)">Digital Products &amp; Software</div>
                  <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary);margin-top:4px">
                    Software licenses, UI design kits, developer templates &amp; digital media.
                  </div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:10px;border-top:1px solid var(--color-divider)">
                  <span class="tag tag-neutral" style="font-size:10px">Licenses &amp; Templates (95)</span>
                </div>
              </button>
            </sc-if>

          </div>
        </div>
      </sc-if>

    </div>
  </sc-if>


  <!-- ══════════════════════════════════════════════════════════════════════════
       MODE 2: CATEGORY DRILL-DOWN VIEW (isCategoryDrilldown)
       ══════════════════════════════════════════════════════════════════════ -->
  <sc-if value="{{ isCategoryDrilldown }}">
    
    <!-- Sticky Navigation & Breadcrumb Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-surface);border-bottom:1px solid var(--color-divider);position:sticky;top:0;z-index:20">
      <div style="display:flex;align-items:center;gap:12px">
        <button onClick="{{ openAllCategories }}" aria-label="Back to all categories" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text);cursor:pointer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div>
          <div style="display:flex;align-items:center;gap:6px;font:700 11px/1 var(--font-heading);color:var(--color-text-muted);text-transform:uppercase">
            <button onClick="{{ openAllCategories }}" style="border:none;background:transparent;padding:0;color:var(--color-accent);cursor:pointer;font-weight:700">CATEGORIES</button>
            <span>›</span>
            <span>{{ isCategoryElectronics ? 'TECH' : (isCategoryFashion ? 'FASHION' : (isCategoryHotels ? 'HOTELS' : (isCategoryTravel ? 'TRAVEL' : (isCategoryServices ? 'SERVICES' : (isCategoryAutomotive ? 'AUTO' : (isCategoryRealEstate ? 'PROPERTY' : (isCategoryBanks ? 'FINANCE' : (isCategoryHome ? 'HOME' : 'COMMERCE')))))))) }}</span>
          </div>
          <h4 style="margin:3px 0 0;font-size:16px;font-weight:800">
            {{ isCategoryElectronics ? 'Electronics & Technology' : (isCategoryFashion ? 'Fashion & Luxury' : (isCategoryHotels ? 'Hospitality & Stays' : (isCategoryTravel ? 'Travel & Mobility' : (isCategoryServices ? 'Professional Services' : (isCategoryAutomotive ? 'Vehicles & Automotive' : (isCategoryRealEstate ? 'Real Estate & Property' : (isCategoryBanks ? 'Banks & Financial Services' : (isCategoryHome ? 'Home & Living' : 'Digital Products')))))))) }}
          </h4>
        </div>
      </div>
      
      <div style="display:flex;gap:8px;align-items:center">
        <button onClick="{{ on.filters }}" aria-label="Filter category" style="border:1px solid var(--color-divider);background:var(--color-surface);padding:0 12px;height:36px;border-radius:var(--radius-pill);display:flex;align-items:center;gap:6px;font:700 11.5px/1 var(--font-heading);color:var(--color-text);cursor:pointer">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/></svg>
          <span>Filters</span>
        </button>
      </div>
    </div>

    <div style="padding:16px;max-width:1300px;margin:0 auto;display:flex;flex-direction:column;gap:24px">
      
      <!-- Subcategory Filter Pills Scroller -->
      <div>
        <div style="font:800 11px/1 var(--font-heading);color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">SUBCATEGORIES:</div>
        
        <div class="hs" style="gap:8px;padding-bottom:4px">
          <button onClick="{{ () => selectSubcategory('all') }}" class="tag {{ isSubcatAll ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">
            All Listings ({{ isCategoryElectronics ? (electronicsTotalCount || 410) : (isCategoryFashion ? (fashionTotalCount || 320) : (isCategoryHome ? (homeTotalCount || 175) : (categoryTotalCount || 0))) }})
          </button>

          <sc-if value="{{ isCategoryElectronics }}">
            <button onClick="{{ () => selectSubcategory('smartphones') }}" class="tag {{ activeSubcategorySlug === 'smartphones' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">📱 Smartphones ({{ subcatSmartphonesCount || 142 }})</button>
            <button onClick="{{ () => selectSubcategory('power_accessories') }}" class="tag {{ activeSubcategorySlug === 'power_accessories' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">⚡ Power &amp; Accessories ({{ subcatPowerCount || 88 }})</button>
            <button onClick="{{ () => selectSubcategory('audio') }}" class="tag {{ activeSubcategorySlug === 'audio' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">🎧 Pro Audio &amp; ANC ({{ subcatAudioCount || 96 }})</button>
            <button onClick="{{ () => selectSubcategory('laptops') }}" class="tag {{ activeSubcategorySlug === 'laptops' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">💻 Laptops &amp; PC ({{ subcatLaptopsCount || 84 }})</button>
          </sc-if>

          <sc-if value="{{ isCategoryFashion }}">
            <button onClick="{{ () => selectSubcategory('footwear') }}" class="tag {{ activeSubcategorySlug === 'footwear' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">👟 Footwear &amp; Sneakers ({{ subcatFootwearCount || 185 }})</button>
            <button onClick="{{ () => selectSubcategory('clothing') }}" class="tag {{ activeSubcategorySlug === 'clothing' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">👗 Apparel &amp; Streetwear ({{ subcatClothingCount || 95 }})</button>
            <button onClick="{{ () => selectSubcategory('watches_jewelry') }}" class="tag {{ activeSubcategorySlug === 'watches_jewelry' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">💍 Joaillerie &amp; Montres ({{ subcatWatchesCount || 40 }})</button>
          </sc-if>

          <sc-if value="{{ isCategoryHome }}">
            <button onClick="{{ () => selectSubcategory('appliances') }}" class="tag {{ activeSubcategorySlug === 'appliances' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">⚡ Petit Électroménager ({{ subcatAppliancesCount || 50 }})</button>
            <button onClick="{{ () => selectSubcategory('cookware') }}" class="tag {{ activeSubcategorySlug === 'cookware' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">🍳 Casseroles &amp; Poêles ({{ subcatCookwareCount || 40 }})</button>
            <button onClick="{{ () => selectSubcategory('tableware') }}" class="tag {{ activeSubcategorySlug === 'tableware' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">🍽️ Vaisselle &amp; Services ({{ subcatTablewareCount || 50 }})</button>
            <button onClick="{{ () => selectSubcategory('home_care') }}" class="tag {{ activeSubcategorySlug === 'home_care' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">🧺 Entretien &amp; Rangement ({{ subcatHomeCareCount || 35 }})</button>
          </sc-if>

          <sc-if value="{{ isCategoryHotels }}">
            <button onClick="{{ () => selectSubcategory('hotel_rooms') }}" class="tag {{ activeSubcategorySlug === 'hotel_rooms' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">🏨 Luxury Hotel Suites (94)</button>
            <button onClick="{{ () => selectSubcategory('furnished_studios') }}" class="tag {{ activeSubcategorySlug === 'furnished_studios' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">🔑 Furnished Studios (48)</button>
          </sc-if>

          <sc-if value="{{ isCategoryTravel }}">
            <button onClick="{{ () => selectSubcategory('travel_bus') }}" class="tag {{ activeSubcategorySlug === 'travel_bus' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">🚌 Intercity VIP Buses (32)</button>
            <button onClick="{{ () => selectSubcategory('travel_flights') }}" class="tag {{ activeSubcategorySlug === 'travel_flights' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">✈️ Flights (20)</button>
            <button onClick="{{ () => selectSubcategory('travel_trains') }}" class="tag {{ activeSubcategorySlug === 'travel_trains' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">🚆 Camrail Trains (12)</button>
          </sc-if>

          <sc-if value="{{ isCategoryServices }}">
            <button onClick="{{ () => selectSubcategory('tech_repairs') }}" class="tag {{ activeSubcategorySlug === 'tech_repairs' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">🛠️ Screen &amp; Tech Repairs (110)</button>
            <button onClick="{{ () => selectSubcategory('creative_services') }}" class="tag {{ activeSubcategorySlug === 'creative_services' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">📸 Photography &amp; Design (65)</button>
            <button onClick="{{ () => selectSubcategory('education') }}" class="tag {{ activeSubcategorySlug === 'education' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">🎓 Education &amp; Coding (55)</button>
          </sc-if>

          <sc-if value="{{ isCategoryAutomotive }}">
            <button onClick="{{ () => selectSubcategory('cars') }}" class="tag {{ activeSubcategorySlug === 'cars' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">🚗 Cars &amp; SUVs (75)</button>
            <button onClick="{{ () => selectSubcategory('auto_parts') }}" class="tag {{ activeSubcategorySlug === 'auto_parts' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">⚙️ Spare Parts (40)</button>
          </sc-if>

          <sc-if value="{{ isCategoryRealEstate }}">
            <button onClick="{{ () => selectSubcategory('residential_property') }}" class="tag {{ activeSubcategorySlug === 'residential_property' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">🏡 Houses &amp; Duplexes (58)</button>
            <button onClick="{{ () => selectSubcategory('commercial_property') }}" class="tag {{ activeSubcategorySlug === 'commercial_property' ? 'tag-accent' : 'tag-neutral' }}" style="cursor:pointer">🏢 Offices &amp; Commercial (30)</button>
          </sc-if>
        </div>
      </div>

      <!-- Verified Retailers in this Category -->
      <sc-if value="{{ categoryHasPartnerStores }}">
      <div>
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px">
          <div style="font:800 14px/1 var(--font-heading);color:var(--color-text)">Authorized Stores &amp; Partners</div>
          <button onClick="{{ on.store }}" style="border:none;background:transparent;padding:0;font:800 11px/1 var(--font-heading);color:var(--color-accent);cursor:pointer">SEE ALL STORES →</button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px">
          
          <sc-if value="{{ isCategoryElectronics || isCategoryServices }}">
            <div class="card-premium" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px">
              <div style="display:flex;align-items:center;gap:12px">
                <div style="width:40px;height:40px;border-radius:var(--radius-sm);background:linear-gradient(135deg,var(--color-accent),#003d8a);color:#fff;display:flex;align-items:center;justify-content:center;font:800 16px/1 var(--font-heading)">O</div>
                <div>
                  <div style="font:700 13.5px/1 var(--font-heading)">Orca Electronics</div>
                  <div style="font:400 11px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Akwa, Douala · ★ 4.9 (1.2k)</div>
                </div>
              </div>
              <button onClick="{{ on.business }}" class="btn btn-secondary" style="height:32px;padding:0 12px;font-size:11px;font-weight:700">STOREFRONT →</button>
            </div>

            <div class="card-premium" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px">
              <div style="display:flex;align-items:center;gap:12px">
                <div style="width:40px;height:40px;border-radius:var(--radius-sm);background:linear-gradient(135deg,#111214,#2d313a);color:#fff;display:flex;align-items:center;justify-content:center;font:800 16px/1 var(--font-heading)">D</div>
                <div>
                  <div style="font:700 13.5px/1 var(--font-heading)">Digital Corner</div>
                  <div style="font:400 11px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Bonapriso, Douala · ★ 4.7 (890)</div>
                </div>
              </div>
              <button onClick="{{ on.business }}" class="btn btn-secondary" style="height:32px;padding:0 12px;font-size:11px;font-weight:700">STOREFRONT →</button>
            </div>
          </sc-if>

          <sc-if value="{{ isCategoryHotels }}">
            <div class="card-premium" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px">
              <div style="display:flex;align-items:center;gap:12px">
                <div style="width:40px;height:40px;border-radius:var(--radius-sm);background:linear-gradient(135deg,#007aff,#00c853);color:#fff;display:flex;align-items:center;justify-content:center;font:800 16px/1 var(--font-heading)">S</div>
                <div>
                  <div style="font:700 13.5px/1 var(--font-heading)">Sawa Luxury Hotel</div>
                  <div style="font:400 11px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Bonanjo, Douala · ★ 4.8 (2.1k)</div>
                </div>
              </div>
              <button onClick="{{ on.hotelDetail }}" class="btn btn-secondary" style="height:32px;padding:0 12px;font-size:11px;font-weight:700">BOOK ROOM →</button>
            </div>
          </sc-if>

          <sc-if value="{{ isCategoryTravel }}">
            <div class="card-premium" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px">
              <div style="display:flex;align-items:center;gap:12px">
                <div style="width:40px;height:40px;border-radius:var(--radius-sm);background:linear-gradient(135deg,#e11d48,#be123c);color:#fff;display:flex;align-items:center;justify-content:center;font:800 16px/1 var(--font-heading)">F</div>
                <div>
                  <div style="font:700 13.5px/1 var(--font-heading)">Finexs Voyages VIP</div>
                  <div style="font:400 11px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Akwa ⇄ Mvan · ★ 4.9 (4.8k)</div>
                </div>
              </div>
              <button onClick="{{ on.travelBus }}" class="btn btn-secondary" style="height:32px;padding:0 12px;font-size:11px;font-weight:700">SELECT SEAT →</button>
            </div>
          </sc-if>

        </div>
      </div>
      </sc-if>

      <!-- Live Category Products Grid -->
      <div>
        <sc-if value="{{ !categoryShowEmptyState }}">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px">
          <div style="font:800 14px/1 var(--font-heading);color:var(--color-text)">Featured Verified Listings</div>
          <span style="font:500 12px/1 var(--font-body);color:var(--color-text-secondary)">All covered by LOUMOO Escrow Protection</span>
        </div>
        </sc-if>

        <div class="home-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:20px;margin-top:16px">
          


          <!-- Hospitality / Hotels Listings (Scenario B: Lifestyle presentation) -->
          <sc-if value="{{ isCategoryHotels }}">
            <div onClick="{{ on.hotelDetail }}" class="loumoo-media-card" aria-label="View Krystal Palace Hotel Douala">
              <div class="loumoo-card-media-lifestyle">
                <span class="loumoo-card-badge badge-pill-sale">5-Star Luxury</span>
                <div class="loumoo-media-overlay"></div>
                <img src="./Assets/Travel%26Hotel/Krystal%20Palace%20Hotel%20Douala.jfif" alt="Krystal Palace Douala">
              </div>
              <div class="loumoo-card-body">
                <h4 class="loumoo-card-title">Krystal Palace Hotel Douala</h4>
                <div class="loumoo-card-tagline">Bonanjo / Akwa · Panoramic Port View Suite & Spa</div>
                <div class="loumoo-card-rating-row">
                  <span>★ 4.9</span>
                  <span class="loumoo-card-rating-text">(312 reviews) · Krystal Palace Official</span>
                </div>
                <div class="loumoo-card-bottom-row">
                  <div class="loumoo-card-pricing-block">
                    <span class="loumoo-card-price-prefix">Per night</span>
                    <div class="loumoo-card-price-main">
                      <span class="loumoo-card-price-val">145.000 FCFA</span>
                      <span class="loumoo-card-price-strike">165.000 FCFA</span>
                    </div>
                    <div class="loumoo-card-trust-pill">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                      <span>✓ Booking Ref: 165.000 FCFA</span>
                    </div>
                  </div>
                  <button class="loumoo-card-pill-btn" aria-label="Book Krystal Palace">Book now</button>
                </div>
              </div>
            </div>

            <div onClick="{{ on.hotelDetail }}" class="loumoo-media-card" aria-label="View Résidence Jully Kribi">
              <div class="loumoo-card-media-lifestyle">
                <span class="loumoo-card-badge badge-pill-new">Beachfront</span>
                <div class="loumoo-media-overlay"></div>
                <img src="./Assets/Travel%26Hotel/Residence%20JULLY%20Kribi.jfif" alt="Résidence Jully Kribi">
              </div>
              <div class="loumoo-card-body">
                <h4 class="loumoo-card-title">Résidence JULLY Kribi</h4>
                <div class="loumoo-card-tagline">Kribi Coast · Seaside Palm Grove Luxury Suites</div>
                <div class="loumoo-card-rating-row">
                  <span>★ 4.7</span>
                  <span class="loumoo-card-rating-text">(140 reviews) · Verified Host</span>
                </div>
                <div class="loumoo-card-bottom-row">
                  <div class="loumoo-card-pricing-block">
                    <span class="loumoo-card-price-prefix">Per night</span>
                    <div class="loumoo-card-price-main">
                      <span class="loumoo-card-price-val">38.000 FCFA</span>
                      <span class="loumoo-card-price-strike">48.000 FCFA</span>
                    </div>
                    <div class="loumoo-card-trust-pill">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                      <span>✓ Direct Escrow · Save 10k</span>
                    </div>
                  </div>
                  <button class="loumoo-card-pill-btn" aria-label="Book Résidence Jully">Book now</button>
                </div>
              </div>
            </div>
          </sc-if>

          <!-- Travel & Intercity Mobility Listings (Scenario B: Lifestyle presentation) -->
          <sc-if value="{{ isCategoryTravel }}">
            <div onClick="{{ on.travelBus }}" class="loumoo-media-card" aria-label="Book Finexs VIP Bus">
              <div class="loumoo-card-media-lifestyle">
                <span class="loumoo-card-badge badge-pill-new">VIP Class</span>
                <div class="loumoo-media-overlay"></div>
                <img src="./Assets/Travel%26Hotel/Cameroon%20(%20Cameroun%20)_%20A%20voyage%20to%20Cameroon%2C%20Africa%20-%20Douala%2C%20Yaound%C3%A9%2C%20Garoua%2C%20Maroua%2C%20Bafoussam%2C%20Bamenda%2C%20Ngaound%C3%A9r%C3%A9%2C%20%20Nkongsamba%2C%20Ka%C3%A9l%C3%A9%2C%20%20Kumba___.jfif" alt="Finexs VIP Bus">
              </div>
              <div class="loumoo-card-body">
                <h4 class="loumoo-card-title">Douala ⇄ Yaoundé VIP Express</h4>
                <div class="loumoo-card-tagline">Finexs Voyages · Akwa VIP Agency · Reclining Leather & WiFi</div>
                <div class="loumoo-card-rating-row">
                  <span>★ 4.9</span>
                  <span class="loumoo-card-rating-text">(512 reviews) · Guaranteed Seat</span>
                </div>
                <div class="loumoo-card-bottom-row">
                  <div class="loumoo-card-pricing-block">
                    <span class="loumoo-card-price-prefix">One way</span>
                    <div class="loumoo-card-price-main">
                      <span class="loumoo-card-price-val">10.000 FCFA</span>
                      <span class="loumoo-card-price-strike">12.000 FCFA</span>
                    </div>
                    <div class="loumoo-card-trust-pill">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                      <span>✓ Official Terminal Ticket</span>
                    </div>
                  </div>
                  <button class="loumoo-card-pill-btn" aria-label="Book Finexs Express">Reserve seat</button>
                </div>
              </div>
            </div>
          </sc-if>

          <!-- Services Listings -->
          <sc-if value="{{ isCategoryServices }}">
            <div onClick="{{ () => openProduct('iphone_15_pro') }}" class="loumoo-media-card" aria-label="Book Screen Replacement">
              <div class="loumoo-card-media-cutout">
                <span class="loumoo-card-badge badge-pill-sale">Same Day Repair</span>
                <img src="./Assets/_processed/logo_icons_lettering_service_screwdriver_and_wrench_45.png" alt="iPhone Screen Replacement">
              </div>
              <div class="loumoo-card-body">
                <h4 class="loumoo-card-title">Certified Smartphone & Tech Repairs</h4>
                <div class="loumoo-card-tagline">KamerFix Pro · Akwa Dropoff · 6-Month Warranty</div>
                <div class="loumoo-card-rating-row">
                  <span>★ 4.9</span>
                  <span class="loumoo-card-rating-text">(88 reviews) · Certified Tech</span>
                </div>
                <div class="loumoo-card-bottom-row">
                  <div class="loumoo-card-pricing-block">
                    <span class="loumoo-card-price-prefix">Fixed quote</span>
                    <div class="loumoo-card-price-main">
                      <span class="loumoo-card-price-val">25.000 FCFA</span>
                      <span class="loumoo-card-price-strike">30.000 FCFA</span>
                    </div>
                    <div class="loumoo-card-trust-pill">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                      <span>✓ Escrow Repair Guarantee</span>
                    </div>
                  </div>
                  <button class="loumoo-card-pill-btn" aria-label="Book Screen Repair">Book repair</button>
                </div>
              </div>
            </div>
          </sc-if>

          <!-- Universal data-driven grid: fills every category without a bespoke editorial block -->
          <sc-if value="{{ categoryUsesDataGrid }}">
            <sc-for list="{{ categoryProductCards }}" as="card">
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
          </sc-if>

        </div>

        <!-- Infinite Scroll Loading / End State -->
        <sc-if value="{{ !categoryShowEmptyState }}">
          <div style="margin:32px 0 24px;text-align:center">
            <sc-if value="{{ catalogLoading }}">
              <div style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:var(--radius-pill);background:var(--color-surface);border:1px solid var(--color-divider);color:var(--color-text-secondary);font:600 12px/1 var(--font-body)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                <span>Loading more products...</span>
              </div>
            </sc-if>
            <sc-if value="{{ !catalogLoading && !catalogHasMore }}">
              <div style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:var(--radius-pill);background:var(--color-surface);border:1px solid var(--color-divider);color:var(--color-text-secondary);font:600 12px/1 var(--font-body)">
                <span style="width:7px;height:7px;border-radius:50%;background:var(--color-success)"></span>
                <span>You've reached the end of this category</span>
              </div>
            </sc-if>
          </div>
        </sc-if>

        <!-- Honest, professional empty state for categories still onboarding sellers -->
        <sc-if value="{{ categoryShowEmptyState }}">
          <div class="card-premium" style="text-align:center;padding:48px 24px;display:flex;flex-direction:column;align-items:center;gap:14px">
            <div style="width:64px;height:64px;border-radius:50%;background:var(--color-surface-subtle);display:flex;align-items:center;justify-content:center;color:var(--color-accent)">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 7h-3V5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2H4a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a1 1 0 0 0-1-1Z"/><path d="M9 7V5h6v2"/></svg>
            </div>
            <h3 style="margin:0;font:800 18px/1.25 var(--font-heading);color:var(--color-text)">Verified {{ categoryDisplayName }} sellers are coming soon</h3>
            <p style="margin:0;max-width:440px;font:400 13.5px/1.6 var(--font-body);color:var(--color-text-secondary)">We're onboarding trusted merchants for this category. Every listing on LOUMOO is escrow-protected — you only pay when your order is delivered.</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:6px">
              <button onClick="{{ openAllCategories }}" class="btn btn-primary" style="height:44px;padding:0 20px;border-radius:var(--radius-pill)">Explore what's live →</button>
              <button onClick="{{ on.upload }}" class="btn btn-outline" style="height:44px;padding:0 20px;border-radius:var(--radius-pill)">Sell in this category</button>
            </div>
          </div>
        </sc-if>
      </div>

    </div>
  </sc-if>

</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     BEST PICKS EDITORIAL MAGAZINE (is.bestpicks)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.bestpicks }}">
<div style="padding-bottom:32px">
  
  <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--color-surface);border-bottom:1px solid var(--color-divider);position:sticky;top:0;z-index:20">
    <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
    </button>
    <div>
      <h4 style="margin:0;font-size:16px">Editor's Best Picks 2026</h4>
      <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary)">Curated tech &amp; lifestyle excellence</div>
    </div>
  </div>

  <div style="padding:16px;max-width:1100px;margin:0 auto">
    
    <!-- Hero Editorial Feature -->
    <div class="card-premium" style="background:linear-gradient(135deg, #111214 0%, #1e2330 100%);color:#fff;margin-bottom:24px;border:none">
      <span class="kicker" style="color:var(--color-accent-energy)">EDITOR'S CHOICE · LAPTOPS</span>
      <h2 style="color:#fff;margin:6px 0 10px;font-size:24px">MacBook Air M2: The Gold Standard</h2>
      <p style="color:rgba(255,255,255,0.75);font-size:13.5px;max-width:540px;margin-bottom:18px">
        Unanimously voted the most reliable machine for Cameroonian developers, creators, and students. Incredible 18-hour battery life and silent fanless operation.
      </p>
      <div style="display:flex;align-items:center;gap:14px">
        <button onClick="{{ on.product }}" class="btn btn-primary" style="height:42px">VIEW DETAILS · XAF 745 000</button>
        <button onClick="{{ on.vs }}" class="btn btn-secondary" style="height:42px;background:rgba(255,255,255,0.15);color:#fff;border-color:rgba(255,255,255,0.25)">COMPARE SELLERS</button>
      </div>
    </div>

    <!-- Editorial Cards Grid -->
    <div class="home-grid">
      <div class="card-premium">
        <span class="kicker">AUDIO EXCELLENCE</span>
        <div style="font:800 16px/1.2 var(--font-heading);color:var(--color-text);margin:4px 0 6px">Sony WH-1000XM5</div>
        <div style="font:400 12.5px/1.4 var(--font-body);color:var(--color-text-secondary);margin-bottom:12px">Industry-leading active noise cancellation. 30h battery.</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font:800 15px/1 var(--font-heading)">XAF 189 000</span>
          <button onClick="{{ on.product }}" class="btn btn-primary" style="height:34px;padding:0 14px;font-size:11.5px">BUY NOW</button>
        </div>
      </div>

      <div class="card-premium">
        <span class="kicker">LUXURY HOSPITALITY</span>
        <div style="font:800 16px/1.2 var(--font-heading);color:var(--color-text);margin:4px 0 6px">Sawa Luxury Hotel Douala</div>
        <div style="font:400 12.5px/1.4 var(--font-body);color:var(--color-text-secondary);margin-bottom:12px">Bonanjo business district, Olympic pool, sea view suites.</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font:800 15px/1 var(--font-heading)">XAF 65 000/night</span>
          <button onClick="{{ on.travel }}" class="btn btn-primary" style="height:34px;padding:0 14px;font-size:11.5px">RESERVE</button>
        </div>
      </div>
    </div>

  </div>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     BLACK FREEDAY FLASH SALE (is.freeday)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.freeday }}">
<div style="padding-bottom:32px">
  
  <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#111214;color:#fff;border-bottom:1px solid #23252a;position:sticky;top:0;z-index:20">
    <div style="display:flex;align-items:center;gap:12px">
      <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <div>
        <h4 style="margin:0;font-size:16px;color:#fff">Black FreeDay Flash Deals</h4>
        <div style="font:400 11.5px/1 var(--font-body);color:rgba(255,255,255,0.7)">Up to 50% Off · Verified Escrow Orders</div>
      </div>
    </div>
    
    <!-- Countdown Timer (Lucide Clock) -->
    <div style="display:flex;align-items:center;gap:6px;font:800 12px/1 var(--font-mono);background:rgba(255,59,48,0.2);color:var(--color-accent-sale);padding:6px 10px;border-radius:var(--radius-pill)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span>08h</span>:<span>24m</span>:<span>15s</span>
    </div>
  </div>

  <div style="padding:16px;max-width:1300px;margin:0 auto">
    
    <!-- Flash Deal Banner -->
    <div class="card-premium" style="background:linear-gradient(135deg,#ff3b30 0%,#990000 100%);color:#fff;border:none;margin-bottom:20px">
      <span class="badge-floating badge-hot" style="background:#ffd100;color:#111">EXTREME DISCOUNT</span>
      <div style="margin-top:14px">
        <h3 style="color:#fff;margin:0 0 6px;font-size:22px">Sony WH-1000XM5 Noise Cancelling</h3>
        <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px">
          <span style="font:800 24px/1 var(--font-heading)">XAF 189 000</span>
          <span style="font:500 14px/1 var(--font-body);text-decoration:line-through;color:rgba(255,255,255,0.7)">XAF 265 000</span>
          <span style="font:800 11px/1 var(--font-heading);background:#fff;color:#ff3b30;padding:2px 8px;border-radius:var(--radius-pill)">-28%</span>
        </div>
        
        <!-- Stock Claimed Bar -->
        <div style="max-width:320px;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">
            <span>84% Claimed</span>
            <span>Only 3 units left</span>
          </div>
          <div style="height:6px;background:rgba(255,255,255,0.3);border-radius:3px;overflow:hidden">
            <div style="width:84%;height:100%;background:#ffd100"></div>
          </div>
        </div>

        <button onClick="{{ on.product }}" class="btn btn-dark" style="background:#ffffff;color:#111214;font-weight:800;height:42px;padding:0 22px">
          CLAIM THIS DEAL NOW <span>→</span>
        </button>
      </div>
    </div>

    <!-- Merchant Enrollment Switch -->
    <div class="card-premium" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding:14px 18px">
      <div>
        <div style="font:700 13.5px/1 var(--font-heading);color:var(--color-text)">Merchant Flash Participation</div>
        <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">Feature your listings on the next Black FreeDay banner</div>
      </div>
      <button onClick="{{ toggleFreeday }}" aria-label="Toggle FreeDay participation" style="border:none;background:transparent;padding:0;cursor:pointer">
        <div style="display:flex;align-items:center;background:{{ fd.bg }};border-radius:14px;width:44px;height:24px;padding:2px;box-sizing:border-box;justify-content:{{ fd.pos }}">
          <div style="width:20px;height:20px;background:{{ fd.knob }};border-radius:50%;box-shadow:var(--shadow-sm)"></div>
        </div>
      </button>
    </div>

  </div>
</div>
</sc-if>
"""
