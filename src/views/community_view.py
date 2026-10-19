# -*- coding: utf-8 -*-
"""
LOUMOO COMMUNITY & COMMERCIAL DISTRIBUTION VIEWS
Three dedicated Announce experiences (Commercial Feed, Publishing Studio, Campaigns & Analytics),
Conversion Detail View, and VS Side-by-Side Comparison Matrix with Lucide SVG Icons.
"""

from src.views.publishing_view import publication_card
from .search_shared import get_search_suggestions


def get_community_view():
    """The Announce feed and its analytics.

    Authoring moved to the publishing studio; what remains here is discovery
    and reporting. The feed card is  — the very component the
    studio renders as its live preview, so a seller who liked what they saw in
    the preview sees exactly that here.
    """
    return _TEMPLATE.replace(
        '__CARD__',
        publication_card('card', clickable='() => openAnnouncement(card.id)')
    )


_TEMPLATE = """
<!-- ══════════════════════════════════════════════════════════════════════════
     1. LOUMOO ANNOUNCE — COMMERCIAL DISCOVERY FEED (is.announce)
     Real broadcasts from GET /api/v1/announcements, rendered through the same
     publication card the publishing studio previews.
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.announce }}">
<div class="ann-page">

  <!-- ── Minimal header (mobile-first) ── -->
  <header class="ann-head">
    <div class="ann-head-inner">
      <button onClick="{{ back }}" aria-label="Go back" class="ann-back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <button onClick="{{ on.announceStudio }}" class="ann-broadcast" aria-label="Broadcast a new announcement">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        <span>Broadcast</span>
      </button>
    </div>
    <div class="ann-head-title-wrap">
      <h1 class="ann-title">Announce</h1>
      <p class="ann-subtitle">Promotions, drops, events, tenders &amp; jobs across Cameroon</p>
    </div>

    <!-- Search -->
    <div class="ann-search">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="search" placeholder="Search announcements" aria-label="Search announcements" value="{{ searchQuery }}" onInput="{{ handleAnnouncementGlobalSearch }}" onKeyDown="{{ handleSearchKey }}" onFocus="{{ searchFocus }}" onBlur="{{ searchBlur }}" role="combobox" aria-autocomplete="list" aria-expanded="{{ searchExpanded }}" aria-controls="search-suggestions" aria-activedescendant="{{ searchActiveOption }}" maxlength="200" autocomplete="off" enterkeyhint="search">
""" + get_search_suggestions() + """
      <button class="btn btn-secondary" onClick="{{ submitSearch }}">Search</button>
    </div>

    <!-- Filters -->
    <div class="ann-filters" role="tablist" aria-label="Announcement type">
      <sc-for list="{{ announceFilters }}" as="chip">
        <button class="ann-filter {{ chip.active ? 'is-active' : '' }}"
                onClick="{{ () => setAnnounceFilter(chip.key) }}">{{ chip.label }}</button>
      </sc-for>
    </div>
  </header>

  <div class="ann-body">

    <sc-if value="{{ announceLoading }}">
      <div class="pub-banner is-busy" role="status">
        <span class="pub-spinner" aria-hidden="true"></span>
        <span>Loading…</span>
      </div>
    </sc-if>

    <sc-if value="{{ announceError }}">
      <div class="pub-banner is-error" role="alert">
        <span>{{ announceError }}</span>
        <button class="pub-linkbtn" onClick="{{ reloadAnnouncements }}">Try again</button>
      </div>
    </sc-if>

    <sc-if value="{{ !announceLoading && !announceCards.length }}">
      <div class="ann-empty">
        <div class="ann-empty-mark" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m3 11 18-5v12L3 13v-2Z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
        </div>
        <h4>Nothing here yet</h4>
        <p>{{ announceEmptyBlurb }}</p>
        <button onClick="{{ on.announceStudio }}" class="ann-empty-cta">Publish a broadcast</button>
      </div>
    </sc-if>

    <!-- ── Feed ── -->
    <div class="ann-grid">
      <sc-for list="{{ announceCards }}" as="card">
        <article class="ann-card" onClick="{{ () => openAnnouncement(card.id) }}">
          <sc-if value="{{ card.hasMedia }}">
            <div class="ann-card-media">
              <img src="{{ card.coverUrl }}" alt="" loading="lazy">
              <sc-if value="{{ card.mediaType === 'video' || card.mediaStyle === 'video' }}">
                <span class="ann-card-play" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
              </sc-if>
              <sc-if value="{{ card.badge }}"><span class="ann-card-badge">{{ card.badge }}</span></sc-if>
            </div>
          </sc-if>

          <div class="ann-card-body">
            <sc-if value="{{ card.storeName }}">
              <div class="ann-card-store">
                <span class="ann-card-store-name">{{ card.storeName }}</span>
                <sc-if value="{{ card.storeVerified }}">
                  <svg class="ann-card-verified" width="13" height="13" viewBox="0 0 24 24" fill="var(--color-accent)" aria-label="Verified"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.1 14.2-4-4L8.3 10.8l2.6 2.6 4.8-4.8 1.4 1.4z"/></svg>
                </sc-if>
                <sc-if value="{{ !card.hasMedia && card.badge }}"><span class="ann-card-kind">{{ card.badge }}</span></sc-if>
              </div>
            </sc-if>

            <h3 class="ann-card-title {{ card.isPlaceholder ? 'is-placeholder' : '' }}">{{ card.title }}</h3>
            <sc-if value="{{ card.body }}"><p class="ann-card-text">{{ card.body }}</p></sc-if>

            <div class="ann-card-foot">
              <sc-if value="{{ card.priceLine }}"><span class="ann-card-price">{{ card.priceLine }}</span></sc-if>
              <span class="ann-card-cta">{{ card.ctaLabel }} <span aria-hidden="true">→</span></span>
            </div>
          </div>
        </article>
      </sc-for>
    </div>

    <sc-if value="{{ announceHasMore }}">
      <div class="ann-more">
        <button class="ann-more-btn" onClick="{{ loadMoreAnnouncements }}" disabled="{{ announceLoading }}">
          {{ announceLoading ? 'Loading…' : 'Load more' }}
        </button>
      </div>
    </sc-if>

    <sc-if value="{{ announceCards.length }}">
      <div class="ann-count">{{ announceCards.length }} of {{ announceTotal }} live</div>
    </sc-if>

  </div>
</div>
</sc-if>


<!-- ══════════════════════════════════════════════════════════════════════════
     3. LOUMOO ANNOUNCE — CAMPAIGNS & ANALYTICS (is.announceCampaigns)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.announceCampaigns }}">
<div style="padding-bottom:56px;background:var(--color-bg);min-height:100vh">

  <!-- Shared Contextual Announce Header -->
  <div class="page-head-block">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;max-width:1200px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px">
        <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text);cursor:pointer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div>
          <div style="display:flex;align-items:center;gap:6px">
            <h3 style="margin:0;font-size:17px;font-weight:800;letter-spacing:-0.3px">LOUMOO Announce</h3>
            <span class="tag tag-accent" style="min-height:18px;padding:1px 6px;font-size:9.5px;font-weight:800">CAMPAIGNS &amp; ANALYTICS</span>
          </div>
          <div style="font:400 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Commercial performance telemetry &amp; campaign intelligence</div>
        </div>
      </div>
      
      <div style="display:flex;align-items:center;gap:8px">
        <button onClick="{{ on.announceStudio }}" class="btn btn-primary" style="height:36px;padding:0 14px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>NEW CAMPAIGN</span>
        </button>
      </div>
    </div>

    <!-- 3-Experience Dedicated Navigation Bar -->
      <!-- Reached from Sell (studio) and Seller Studio (campaigns); no sibling tabs. -->
  </div>

  <!-- Analytics Dashboard Workspace -->
  <div style="padding:18px 16px;max-width:1200px;margin:0 auto">

    <!-- Workspace Subheader & Period Picker -->
    <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px">
      <div>
        <h3 style="margin:0;font-size:20px;font-weight:800">Commercial Distribution Performance</h3>
        <div style="font-size:12px;color:var(--color-text-secondary);margin-top:2px">Real-time telemetry tracking reach, CTR%, unique viewers and conversions</div>
      </div>
      
      <div style="display:flex;align-items:center;gap:6px;background:var(--color-surface);border:1px solid var(--color-divider);padding:4px;border-radius:var(--radius-sm)">
        <button onClick="{{ setAnnouncePeriodToday }}" class="btn {{ announcePeriod === 'today' ? 'btn-primary' : 'btn-outline' }}" style="height:28px;padding:0 10px;font-size:11px;font-weight:700{{ announcePeriod === 'today' ? '' : ';border:none' }}">Today</button>
        <button onClick="{{ setAnnouncePeriod7d }}" class="btn {{ announcePeriod === '7d' ? 'btn-primary' : 'btn-outline' }}" style="height:28px;padding:0 10px;font-size:11px;font-weight:700{{ announcePeriod === '7d' ? '' : ';border:none' }}">Last 7 Days</button>
        <button onClick="{{ setAnnouncePeriod30d }}" class="btn {{ announcePeriod === '30d' ? 'btn-primary' : 'btn-outline' }}" style="height:28px;padding:0 10px;font-size:11px;font-weight:700{{ announcePeriod === '30d' ? '' : ';border:none' }}">Last 30 Days</button>
      </div>
    </div>

    <!-- Zero Telemetry Notice Banner for New Stores -->
    <sc-if value="{{ !announceHasCampaigns }}">
      <div class="card-premium" style="padding:16px 20px;background:var(--color-surface-subtle);border:1px dashed var(--color-divider);border-radius:var(--radius-md);display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:12px;min-width:240px;flex:1">
          <div style="width:40px;height:40px;border-radius:50%;background:var(--color-surface);border:1px solid var(--color-divider);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--color-accent)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font:700 13px/1.2 var(--font-heading);color:var(--color-text)">Zero Telemetry Recorded · Storefront Baseline</span>
              <span class="tag tag-neutral" style="font-size:9.5px;font-weight:700;padding:2px 6px">HONEST METRICS</span>
            </div>
            <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary);margin-top:4px">
              LOUMOO never fabricates marketing numbers. Reach, unique viewers, and high-intent conversions activate in real-time once you publish your first commercial broadcast.
            </div>
          </div>
        </div>
        <button onClick="{{ on.announceStudio }}" class="btn btn-primary" style="height:34px;padding:0 14px;font-size:11.5px;font-weight:700;white-space:nowrap;cursor:pointer">
          + LAUNCH FIRST CAMPAIGN
        </button>
      </div>
    </sc-if>

    <!-- 6 KPI Metric Cards Grid -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:14px;margin-bottom:24px">
      
      <div class="card-premium">
        <div style="font-size:11.5px;color:var(--color-text-secondary);font-weight:700;margin-bottom:6px">TOTAL REACH (IMPRESSIONS)</div>
        <div style="font:800 24px/1 var(--font-heading);color:var(--color-text)">{{ announceTotalReach }}</div>
        <sc-if value="{{ announceHasCampaigns }}">
          <div style="font-size:11px;color:var(--color-success);margin-top:6px;display:flex;align-items:center;gap:3px">
            <span>Live verified reach</span>
          </div>
        </sc-if>
        <sc-if value="{{ !announceHasCampaigns }}">
          <div style="font-size:11px;color:var(--color-text-muted);margin-top:6px">0 verified impressions</div>
        </sc-if>
      </div>

      <div class="card-premium">
        <div style="font-size:11.5px;color:var(--color-text-secondary);font-weight:700;margin-bottom:6px">UNIQUE VIEWERS</div>
        <div style="font:800 24px/1 var(--font-heading);color:var(--color-text)">{{ announceUniqueViewers }}</div>
        <div style="font-size:11px;color:var(--color-text-muted);margin-top:6px">{{ announceUniqueRatio }} unique reach ratio</div>
      </div>

      <div class="card-premium">
        <div style="font-size:11.5px;color:var(--color-text-secondary);font-weight:700;margin-bottom:6px">CTA ACTION CLICKS</div>
        <div style="font:800 24px/1 var(--font-heading);color:var(--color-accent)">{{ announceActionClicks }}</div>
        <sc-if value="{{ announceHasCampaigns }}">
          <div style="font-size:11px;color:var(--color-success);margin-top:6px;display:flex;align-items:center;gap:3px">
            <span>High intent clicks</span>
          </div>
        </sc-if>
        <sc-if value="{{ !announceHasCampaigns }}">
          <div style="font-size:11px;color:var(--color-text-muted);margin-top:6px">0 buyer clicks</div>
        </sc-if>
      </div>

      <div class="card-premium">
        <div style="font-size:11.5px;color:var(--color-text-secondary);font-weight:700;margin-bottom:6px">AVERAGE CTR %</div>
        <div style="font:800 24px/1 var(--font-heading);color:var(--color-text)">{{ announceAverageCtr }}</div>
        <sc-if value="{{ announceHasCampaigns }}">
          <div style="font-size:11px;color:var(--color-success);margin-top:6px">Real-time clickthrough rate</div>
        </sc-if>
        <sc-if value="{{ !announceHasCampaigns }}">
          <div style="font-size:11px;color:var(--color-text-muted);margin-top:6px">Awaiting first broadcast</div>
        </sc-if>
      </div>

      <div class="card-premium">
        <div style="font-size:11.5px;color:var(--color-text-secondary);font-weight:700;margin-bottom:6px">WHATSAPP INQUIRIES</div>
        <div style="font:800 24px/1 var(--font-heading);color:var(--color-wa-teal)">{{ announceWhatsappInquiries }}</div>
        <div style="font-size:11px;color:var(--color-text-muted);margin-top:6px">Direct seller chats started</div>
      </div>

      <div class="card-premium">
        <div style="font-size:11.5px;color:var(--color-text-secondary);font-weight:700;margin-bottom:6px">PIPELINE VALUE</div>
        <div style="font:800 22px/1 var(--font-heading);color:var(--color-text)">{{ announcePipelineValue }}</div>
        <div style="font-size:11px;color:var(--color-text-muted);margin-top:6px">From linked product sales</div>
      </div>

    </div>

    <!-- Campaigns Performance Ledger Table -->
    <div class="card-premium" style="margin-bottom:24px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h4 style="margin:0;font-size:16px;font-weight:800">Active &amp; Historical Commercial Campaigns</h4>
        <span class="tag tag-accent" style="font-weight:700">{{ announceCampaignsCountLabel }}</span>
      </div>

      <!-- Live campaigns table when campaigns exist -->
      <sc-if value="{{ announceHasCampaigns }}">
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;text-align:left;font-size:12px">
            <thead>
              <tr style="border-bottom:1px solid var(--color-divider);color:var(--color-text-muted);font-weight:700;font-size:11px">
                <th style="padding:10px 8px">CAMPAIGN TITLE</th>
                <th style="padding:10px 8px">TYPE</th>
                <th style="padding:10px 8px">STATUS</th>
                <th style="padding:10px 8px">AUDIENCE</th>
                <th style="padding:10px 8px">IMPRESSIONS</th>
                <th style="padding:10px 8px">VIEWS</th>
                <th style="padding:10px 8px">CLICKS</th>
                <th style="padding:10px 8px">CTR %</th>
                <th style="padding:10px 8px;text-align:right">ACTION</th>
              </tr>
            </thead>
            <tbody>
              <sc-for list="{{ announceCampaignsList }}" as="camp">
                <tr style="border-bottom:1px solid var(--color-divider)">
                  <td style="padding:12px 8px;font-weight:700;color:var(--color-text)">{{ camp.title }}</td>
                  <td style="padding:12px 8px"><span class="tag tag-accent" style="font-size:10px">{{ camp.typeLabel }}</span></td>
                  <td style="padding:12px 8px">
                    <sc-if value="{{ camp.status === 'PUBLISHED' }}"><span style="color:var(--color-success);font-weight:800">● LIVE</span></sc-if>
                    <sc-if value="{{ camp.status === 'SCHEDULED' }}"><span style="color:var(--color-accent);font-weight:800">SCHEDULED</span></sc-if>
                    <sc-if value="{{ camp.status !== 'PUBLISHED' && camp.status !== 'SCHEDULED' }}"><span style="color:var(--color-text-muted);font-weight:800">{{ camp.status }}</span></sc-if>
                  </td>
                  <td style="padding:12px 8px;color:var(--color-text-secondary)">{{ camp.audience }}</td>
                  <td style="padding:12px 8px;font-weight:700">{{ camp.impressions }}</td>
                  <td style="padding:12px 8px">{{ camp.views }}</td>
                  <td style="padding:12px 8px;font-weight:700;color:var(--color-accent)">{{ camp.clicks }}</td>
                  <td style="padding:12px 8px;font-weight:700">{{ camp.ctr }}</td>
                  <td style="padding:12px 8px;text-align:right">
                    <button onClick="{{ () => openAnnounceDetail(camp.id) }}" class="btn btn-outline" style="height:28px;padding:0 8px;font-size:11px;font-weight:700">Details</button>
                  </td>
                </tr>
              </sc-for>
            </tbody>
          </table>
        </div>
      </sc-if>

      <!-- Zero Telemetry honest empty state for new stores -->
      <sc-if value="{{ !announceHasCampaigns }}">
        <div style="padding:36px 20px;text-align:center;background:var(--color-surface-subtle);border-radius:var(--radius-md);border:1px dashed var(--color-divider);margin:12px 0">
          <div style="width:48px;height:48px;border-radius:50%;background:var(--color-surface);border:1px solid var(--color-divider);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;color:var(--color-text-muted)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div style="font:700 15px/1.3 var(--font-heading);color:var(--color-text);margin-bottom:6px">No commercial broadcasts published yet</div>
          <div style="font:400 12.5px/1.4 var(--font-body);color:var(--color-text-secondary);max-width:440px;margin:0 auto 18px">
            Announce lets you broadcast flash sales, product drops, service launches, jobs and tenders to thousands of buyers in Douala, Yaoundé and nationwide with zero fake impressions.
          </div>
          <button onClick="{{ on.announceStudio }}" class="btn btn-primary" style="height:38px;padding:0 20px;font-size:12px;font-weight:700;cursor:pointer">
            + DRAFT FIRST BROADCAST IN STUDIO
          </button>
        </div>
      </sc-if>
    </div>

    <!-- Geographic Audience Distribution Breakdown -->
    <div class="card-premium">
      <h4 style="margin:0 0 12px;font-size:15px;font-weight:800">Audience Distribution Across Cameroon</h4>
      
      <sc-if value="{{ announceHasCampaigns }}">
        <div style="display:flex;flex-direction:column;gap:10px">
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
              <span style="font-weight:700;color:var(--color-text)">Douala (Akwa, Bonanjo, Bonapriso, Deido, Bepanda)</span>
              <span style="font-weight:800;color:var(--color-accent)">54% Reach</span>
            </div>
            <div style="height:8px;background:var(--color-divider);border-radius:4px;overflow:hidden">
              <div style="width:54%;height:100%;background:var(--color-accent);border-radius:4px"></div>
            </div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
              <span style="font-weight:700;color:var(--color-text)">Yaoundé (Bastos, Centre-Ville, Omnisports, Mendong)</span>
              <span style="font-weight:800;color:var(--color-accent)">31% Reach</span>
            </div>
            <div style="height:8px;background:var(--color-divider);border-radius:4px;overflow:hidden">
              <div style="width:31%;height:100%;background:var(--color-accent);border-radius:4px"></div>
            </div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
              <span style="font-weight:700;color:var(--color-text)">West &amp; South-West (Bafoussam, Kribi, Limbe, Buea)</span>
              <span style="font-weight:800;color:var(--color-accent)">15% Reach</span>
            </div>
            <div style="height:8px;background:var(--color-divider);border-radius:4px;overflow:hidden">
              <div style="width:15%;height:100%;background:var(--color-accent);border-radius:4px"></div>
            </div>
          </div>
        </div>
      </sc-if>

      <sc-if value="{{ !announceHasCampaigns }}">
        <div style="padding:22px 16px;text-align:center;background:var(--color-surface-subtle);border-radius:var(--radius-md);border:1px dashed var(--color-divider);font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary)">
          Regional distribution telemetry will map impressions and viewer hotspots across Douala, Yaoundé, Bafoussam and Kribi once your broadcasts go live.
        </div>
      </sc-if>
    </div>

  </div>
</div>
</sc-if>


<!-- ══════════════════════════════════════════════════════════════════════════
     4. ANNOUNCEMENT CONVERSION DETAIL SCREEN (is.announceDetail)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.announceDetail }}">
<div style="padding-bottom:calc(96px + env(safe-area-inset-bottom, 16px));background:var(--color-bg);min-height:100vh">

  <!-- Header with Back -->
  <div class="page-head-block">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;max-width:800px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px">
        <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text);cursor:pointer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div>
          <h3 style="margin:0;font-size:16px;font-weight:800">Commercial Broadcast Details</h3>
          <span style="font-size:11px;color:var(--color-text-secondary)">Ref: {{ activeAnnouncementCard.refCode || ('ANN-' + (activeAnnouncementId || '2026')) }}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button onClick="{{ shareAnnouncement }}" class="btn btn-outline" style="height:36px;padding:0 12px;font-size:12px;font-weight:700">Share</button>
      </div>
    </div>
  </div>

  <div style="padding:20px 16px;max-width:800px;margin:0 auto;display:flex;flex-direction:column;gap:18px">
    <sc-if value="{{ announceDetailLoading }}">
      <div class="pub-banner is-busy" role="status"><span class="pub-spinner" aria-hidden="true"></span><span>Loading broadcast…</span></div>
    </sc-if>

    <!-- The selected announcement—not a sample campaign—owns every buyer-facing field. -->
    <sc-if value="{{ hasActiveAnnouncement }}">
      <article class="card-premium" style="padding:0;overflow:hidden">
        <sc-if value="{{ activeAnnouncementCard.hasMedia }}">
          <img src="{{ activeAnnouncementCard.coverUrl }}" alt="{{ activeAnnouncementCard.title }}" style="width:100%;max-height:380px;display:block;object-fit:cover">
        </sc-if>
        <div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap"><span class="tag tag-accent" style="font-weight:800">{{ activeAnnouncementCard.badge || 'BROADCAST' }}</span><span style="font:600 11px/1 var(--font-body);color:var(--color-text-muted)">{{ activeAnnouncementCard.storeName || 'LOUMOO verified seller' }}</span></div>
          <h1 style="margin:0;font-size:clamp(24px,4vw,34px);line-height:1.12;letter-spacing:-.035em">{{ activeAnnouncementCard.title }}</h1>
          <sc-if value="{{ activeAnnouncementCard.body }}"><p style="margin:0;font:400 15px/1.65 var(--font-body);color:var(--color-text-secondary)">{{ activeAnnouncementCard.body }}</p></sc-if>
          <sc-if value="{{ activeAnnouncementCard.highlights && activeAnnouncementCard.highlights.length }}"><div style="display:flex;flex-wrap:wrap;gap:8px"><sc-for list="{{ activeAnnouncementCard.highlights }}" as="item"><span class="tag tag-neutral">✓ {{ item.label }}</span></sc-for></div></sc-if>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding-top:14px;border-top:1px solid var(--color-divider);flex-wrap:wrap"><sc-if value="{{ activeAnnouncementCard.priceLine }}"><span style="font:800 18px/1 var(--font-heading);color:var(--color-accent)">{{ activeAnnouncementCard.priceLine }}</span></sc-if><button onClick="{{ activateAnnouncementCta }}" class="btn btn-primary" style="height:42px;padding:0 18px;font-weight:700;display:inline-flex;align-items:center;gap:6px">{{ activeAnnouncementCard.ctaLabel || 'Contact seller' }} <span aria-hidden="true">→</span></button></div>
        </div>
      </article>
    </sc-if>

    <sc-if value="{{ !announceDetailLoading && !hasActiveAnnouncement }}">
      <div class="ann-empty" style="text-align:center;padding:48px 16px;background:var(--color-surface);border:1px dashed var(--color-divider);border-radius:var(--radius-md)">
        <h4 style="font-size:18px;margin-bottom:8px">Broadcast not found</h4>
        <p style="color:var(--color-text-secondary);font-size:13px;max-width:400px;margin:0 auto 16px">This commercial broadcast may have concluded or is no longer active.</p>
        <button onClick="{{ on.announce }}" class="btn btn-primary" style="height:38px;padding:0 16px;font-size:13px">Return to Announce feed</button>
      </div>
    </sc-if>


  </div>
</div>
</sc-if>


<!-- ══════════════════════════════════════════════════════════════════════════
     5. ELEVATED PRODUCT COMPARISON WORKSPACE (is.vs)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.vs }}">
<div class="cmp-page">

  <header class="cmp-head">
    <div class="cmp-head-row">
      <button onClick="{{ back }}" aria-label="Go back" class="cmp-back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <button onClick="{{ on.vsCompare }}" class="cmp-go">Compare <span aria-hidden="true">→</span></button>
    </div>
    <h1 class="cmp-title">Compare</h1>
    <p class="cmp-subtitle">Put products, stores, or stays head-to-head. See what actually separates them before you commit.</p>
  </header>

  <div class="cmp-body">

    <!-- 1. PRISTINE CLEAN EMPTY COMPARISON PAGE -->
    <sc-if value="{{ vsEmpty }}">
      <div class="cmp-empty-hero">
        <span class="cmp-kicker">LOUMOO Comparison Studio</span>
        <h2 class="cmp-empty-title">Nothing to compare yet</h2>
        <p class="cmp-empty-desc">Search the public catalog to compare products, stores or hotel stays. Check the listings for current prices and availability.</p>

        <!-- Live Universal Search & Filter -->
        <div class="cmp-search-bar">
          <div class="cmp-search-input-wrap">
            <span class="cmp-search-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </span>
            <input class="cmp-search-input" type="search" aria-label="Find items to compare" placeholder="Search products, stores or stays to compare…" value="{{ vsPickerQuery }}" onInput="{{ handleVsPickerInput }}" onFocus="{{ handleVsPickerFocus }}" maxlength="180" autocomplete="off" />
          </div>
          <div class="cmp-picker-pills" role="tablist">
            <button onClick="{{ () => setVsPickerCat('all') }}" class="cmp-picker-pill {{ vsPickerCat === 'all' ? 'is-active' : '' }}">All Entities</button>
            <button onClick="{{ () => setVsPickerCat('laptops') }}" class="cmp-picker-pill {{ vsPickerCat === 'laptops' ? 'is-active' : '' }}">Laptops</button>
            <button onClick="{{ () => setVsPickerCat('phones') }}" class="cmp-picker-pill {{ vsPickerCat === 'phones' ? 'is-active' : '' }}">Smartphones</button>
            <button onClick="{{ () => setVsPickerCat('stores') }}" class="cmp-picker-pill {{ vsPickerCat === 'stores' ? 'is-active' : '' }}">Verified Stores</button>
            <button onClick="{{ () => setVsPickerCat('hotels') }}" class="cmp-picker-pill {{ vsPickerCat === 'hotels' ? 'is-active' : '' }}">Hotels &amp; Stays</button>
          </div>
        </div>

        <!-- Live Search Candidates -->
        <sc-if value="{{ vsSearchLoading }}"><p role="status">Searching the catalog…</p></sc-if>
        <sc-if value="{{ vsSearchError }}"><p role="alert">{{ vsSearchError }}</p></sc-if>
        <sc-if value="{{ vsPickerHasResults }}">
          <div class="cmp-picker-results">
            <sc-for list="{{ vsPickerResults }}" as="cand">
              <div class="cmp-picker-card">
                <img class="cmp-picker-card-thumb" src="{{ cand.image }}" alt="{{ cand.title }}" />
                <div class="cmp-picker-card-info">
                  <div class="cmp-picker-card-title">{{ cand.title }}</div>
                  <div class="cmp-picker-card-meta">{{ cand.meta }}</div>
                </div>
                <button onClick="{{ () => addToCompare(cand.id) }}" class="cmp-picker-add-btn">+ Compare</button>
              </div>
            </sc-for>
          </div>
        </sc-if>

        <!-- Curated Starter Presets -->
        <div class="cmp-presets-wrap">
          <div class="cmp-presets-head">Or start with a curated benchmark</div>
          <div class="cmp-presets-grid">
            <div class="cmp-preset-card" onClick="{{ () => loadVsPreset('ultrabooks') }}">
              <div>
                <div class="cmp-preset-top">
                  <span class="cmp-preset-badge">Computing</span>
                  <span class="cmp-badge-tag">2 Laptops</span>
                </div>
                <h4 class="cmp-preset-title">Top Ultrabooks</h4>
                <p class="cmp-preset-desc">MacBook Air 13” M2 vs MacBook Pro 14” M3 Pro. Fanless silence vs studio power.</p>
              </div>
              <div class="cmp-preset-cta">Load comparison <span>→</span></div>
            </div>

            <div class="cmp-preset-card" onClick="{{ () => loadVsPreset('stores') }}">
              <div>
                <div class="cmp-preset-top">
                  <span class="cmp-preset-badge">Merchants</span>
                  <span class="cmp-badge-tag">2 Stores</span>
                </div>
                <h4 class="cmp-preset-title">Verified Tech Stores</h4>
                <p class="cmp-preset-desc">Orca Electronics (Akwa, Douala) vs KamerTech Direct (Bastos, Yaoundé).</p>
              </div>
              <div class="cmp-preset-cta">Load comparison <span>→</span></div>
            </div>

            <div class="cmp-preset-card" onClick="{{ () => loadVsPreset('stays') }}">
              <div>
                <div class="cmp-preset-top">
                  <span class="cmp-preset-badge">Hotels &amp; Stays</span>
                  <span class="cmp-badge-tag">2 Lodgings</span>
                </div>
                <h4 class="cmp-preset-title">Douala Luxury Stays</h4>
                <p class="cmp-preset-desc">Sawa Luxury Hotel (Bonanjo) vs Résidence Akwa Palm (Akwa). 5-star amenities &amp; rates.</p>
              </div>
              <div class="cmp-preset-cta">Load comparison <span>→</span></div>
            </div>

            <div class="cmp-preset-card" onClick="{{ () => loadVsPreset('smartphones') }}">
              <div>
                <div class="cmp-preset-top">
                  <span class="cmp-preset-badge">Smartphones</span>
                  <span class="cmp-badge-tag">2 Phones</span>
                </div>
                <h4 class="cmp-preset-title">Flagship Smartphones</h4>
                <p class="cmp-preset-desc">Tecno Camon 50 Pro 5G vs Google Pixel 8 Pro Unlocked. Cameras &amp; performance.</p>
              </div>
              <div class="cmp-preset-cta">Load comparison <span>→</span></div>
            </div>
          </div>
        </div>

        <!-- 3 Value Pillars -->
        <div class="cmp-pillars-grid">
          <div class="cmp-pillar-card">
            <div class="cmp-pillar-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1"/><path d="M18 8h4a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-4"/><circle cx="8" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>
            </div>
            <div class="cmp-pillar-title">Universal Comparison</div>
            <p class="cmp-pillar-text">Compare products, merchant stores, or hotel stays side-by-side without limits or category lock-in.</p>
          </div>

          <div class="cmp-pillar-card">
            <div class="cmp-pillar-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
            </div>
            <div class="cmp-pillar-title">Evidence, not opinion</div>
            <p class="cmp-pillar-text">Every recommendation cites the specs and prices behind it, and says so when the data is too thin to pick.</p>
          </div>

          <div class="cmp-pillar-card">
            <div class="cmp-pillar-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div class="cmp-pillar-title">LOUMOO Tier-1 Escrow</div>
            <p class="cmp-pillar-text">Funds remain in secure escrow until you receive and verify the item or complete your stay.</p>
          </div>
        </div>

        <div class="cmp-empty-actions" style="margin-top:24px">
          <button onClick="{{ resetVsDefaults }}" class="cmp-btn-dark">Restore Ultrabooks example</button>
          <button onClick="{{ on.search }}" class="cmp-btn-ghost">Browse catalog</button>
        </div>
      </div>
    </sc-if>

    <!-- 2. ACTIVE COMPARISON TRAY -->
    <sc-if value="{{ !vsEmpty }}">
      <div class="cmp-pick">
        <sc-for list="{{ vsTrayCards }}" as="card">
          <div class="cmp-pick-card">
            <button onClick="{{ () => removeFromCompare(card.id) }}" aria-label="{{ 'Remove ' + card.title }}" class="cmp-pick-remove">✕</button>
            <sc-if value="{{ card.image }}"><img class="cmp-pick-img" src="{{ card.image }}" alt="" loading="lazy" /></sc-if>
            <div class="cmp-pick-cat">{{ card.category }}</div>
            <h3 class="cmp-pick-name">{{ card.title }}</h3>
            <div class="cmp-pick-price">{{ card.price }}</div>
            <div class="cmp-pick-spec">{{ card.merchant }}</div>
          </div>
        </sc-for>

        <sc-if value="{{ vsCanAddMore }}">
        <button onClick="{{ () => setVsPickerCat('all') }}" class="cmp-pick-add" aria-label="Add a product or store to compare">
          <span class="cmp-pick-add-mark"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>
          <span class="cmp-pick-add-text">Add to compare</span>
        </button>
        </sc-if>
      </div>

      <!-- Quick Add Universal Search -->
      <div class="cmp-search-bar" style="margin-top: 18px;">
        <div class="cmp-search-input-wrap">
          <span class="cmp-search-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </span>
          <input class="cmp-search-input" type="search" aria-label="Add to this comparison" placeholder="Add a product, store or stay to this comparison…" value="{{ vsPickerQuery }}" onInput="{{ handleVsPickerInput }}" onFocus="{{ handleVsPickerFocus }}" maxlength="180" autocomplete="off" />
        </div>
      </div>

      <sc-if value="{{ vsSearchLoading }}"><p class="cmp-status" role="status">Searching the catalog…</p></sc-if>
      <sc-if value="{{ vsSearchError }}"><p class="cmp-status" role="alert">{{ vsSearchError }}</p></sc-if>
      <sc-if value="{{ vsPickerHasResults }}">
        <div class="cmp-picker-results">
          <sc-for list="{{ vsPickerResults }}" as="cand">
            <div class="cmp-picker-card">
              <img class="cmp-picker-card-thumb" src="{{ cand.image }}" alt="" loading="lazy" />
              <div class="cmp-picker-card-info">
                <div class="cmp-picker-card-title">{{ cand.title }}</div>
                <div class="cmp-picker-card-meta">{{ cand.meta }}</div>
              </div>
              <button onClick="{{ () => addToCompare(cand.id) }}" class="cmp-picker-add-btn">+ Add</button>
            </div>
          </sc-for>
        </div>
      </sc-if>

      <div style="display:flex;justify-content:center;margin-top:20px;">
        <button onClick="{{ clearVsAll }}" class="cmp-btn-ghost" style="font-size:12.5px;height:38px;">Clear comparison</button>
      </div>
    </sc-if>

  </div>

  <div class="cmp-sticky">
    <span class="cmp-sticky-text">{{ vsCount }} selected{{ vsCanCompare ? '' : ' · add at least 2' }}</span>
    <button onClick="{{ on.vsCompare }}" class="cmp-sticky-btn" disabled="{{ !vsCanCompare }}">Compare <span aria-hidden="true">→</span></button>
  </div>

</div>
</sc-if>



<sc-if value="{{ is.vsCompare }}">
<div class="cmp-page">

  <header class="cmp-head cmp-head-compact">
    <div class="cmp-head-row">
      <button onClick="{{ on.vs }}" aria-label="Back to the comparison tray" class="cmp-back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <div class="cmp-filter" role="tablist" aria-label="Which specifications to show">
        <button onClick="{{ setVsFilterAll }}" role="tab" aria-selected="{{ vsFilterAll ? 'true' : 'false' }}" class="cmp-filter-btn {{ vsFilterAll ? 'is-active' : '' }}">All specs</button>
        <button onClick="{{ setVsFilterDiff }}" role="tab" aria-selected="{{ vsFilterDiff ? 'true' : 'false' }}" class="cmp-filter-btn {{ vsFilterDiff ? 'is-active' : '' }}">Differences</button>
      </div>
    </div>
    <h1 class="cmp-title cmp-title-sm">{{ vsCompareTitle || 'Compare' }}</h1>
  </header>

  <div class="cmp-body">

    <sc-if value="{{ !vsCanCompare }}">
      <div class="cmp-status">
        Add at least two items to compare them.
        <div class="cmp-status-actions"><button onClick="{{ on.vs }}" class="cmp-btn-dark">Choose items</button></div>
      </div>
    </sc-if>

    <sc-if value="{{ vsCanCompare && vsView.loading && !vsView.hasResult }}">
      <div role="status" aria-label="Comparing">
        <div class="cmp-skeleton"></div><div class="cmp-skeleton"></div><div class="cmp-skeleton"></div>
      </div>
    </sc-if>

    <sc-if value="{{ vsCanCompare && vsView.error }}">
      <div class="cmp-status" role="alert">
        {{ vsView.error }}
        <div class="cmp-status-actions"><button onClick="{{ retryCompare }}" class="cmp-btn-dark">Try again</button></div>
      </div>
    </sc-if>

    <sc-if value="{{ vsCanCompare && vsView.hasResult }}">

      <!-- Head-to-head: one card per item, from the engine's own summary -->
      <div class="{{ 'cmp-hero ' + vsView.cols }}">
        <sc-for list="{{ vsView.heroCards }}" as="card">
          <div class="cmp-hero-card">
            <sc-if value="{{ card.hasImage }}"><img class="cmp-hero-img" src="{{ card.image }}" alt="" loading="lazy" /></sc-if>
            <div class="cmp-hero-key"><i class="{{ 'cmp-dot ' + card.dot }}"></i><span class="cmp-hero-cat">{{ card.kind }}</span></div>
            <h2 class="cmp-hero-name">{{ card.title }}</h2>
            <div class="cmp-hero-price">{{ card.price }}<sc-if value="{{ card.wasPrice }}"><span class="cmp-hero-was">{{ card.wasPrice }}</span></sc-if></div>
            <div class="cmp-hero-meta">{{ card.rating }}</div>
            <div class="cmp-hero-meta">{{ card.seller }}</div>
            <sc-if value="{{ card.availability }}"><div class="cmp-hero-avail">{{ card.availability }}</div></sc-if>
            <sc-if value="{{ card.score }}"><div class="cmp-hero-score">{{ card.score }}</div></sc-if>
            <sc-if value="{{ card.hasTags }}">
              <div class="cmp-hero-tags">
                <sc-for list="{{ card.tags }}" as="tag"><span class="{{ 'cmp-hero-tag ' + tag.cls }}">{{ tag.text }}</span></sc-for>
              </div>
            </sc-if>
          </div>
        </sc-for>
      </div>

      <sc-if value="{{ vsView.unresolvedText }}"><p class="cmp-status" role="status">{{ vsView.unresolvedText }}</p></sc-if>

      <!-- No recommendation: say why, plainly -->
      <sc-if value="{{ vsView.notice }}">
        <div class="cmp-notice" role="note">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          <span>{{ vsView.notice }}</span>
        </div>
      </sc-if>

      <!-- The verdict -->
      <sc-if value="{{ vsView.hasRecommendation }}">
        <section class="cmp-verdict" aria-label="Our recommendation">
          <div class="cmp-verdict-top">
            <span class="cmp-verdict-kicker">Our pick for you</span>
            <sc-if value="{{ vsView.decisiveText }}"><span class="cmp-verdict-pill">{{ vsView.decisiveText }}</span></sc-if>
          </div>
          <h2 class="cmp-verdict-name">{{ vsView.recommendTitle }}</h2>
          <div class="cmp-verdict-fit">{{ vsView.matchText }}</div>
          <sc-if value="{{ vsView.summary }}"><p class="cmp-verdict-summary">{{ vsView.summary }}</p></sc-if>
          <div class="cmp-verdict-rows">
            <sc-if value="{{ vsView.topReasons }}"><div class="cmp-verdict-row"><b>Why</b><span>{{ vsView.topReasons }}</span></div></sc-if>
            <sc-if value="{{ vsView.bestValueText }}"><div class="cmp-verdict-row"><b>Best value</b><span>{{ vsView.bestValueText }}</span></div></sc-if>
            <sc-if value="{{ vsView.bestFor.length }}">
              <div class="cmp-verdict-row"><b>Best for</b>
                <span class="cmp-bestfor"><sc-for list="{{ vsView.bestFor }}" as="bf"><span><i class="{{ 'cmp-dot ' + bf.dot }}"></i>{{ bf.text }}</span></sc-for></span>
              </div>
            </sc-if>
          </div>
        </section>

        <!-- What matters most: only priorities these items have data for -->
        <section class="cmp-priorities">
          <div class="cmp-section-title">What matters most to you?</div>
          <div class="cmp-pri-row" role="group" aria-label="Priority">
            <sc-for list="{{ vsView.priorityChips }}" as="chip">
              <button onClick="{{ () => setVsPriority(chip.key) }}" class="{{ chip.cls }}">{{ chip.label }}</button>
            </sc-for>
          </div>
          <sc-if value="{{ vsView.loading }}"><div class="cmp-pri-result" role="status"><span>Re-ranking for your priority…</span></div></sc-if>
        </section>
      </sc-if>

      <!-- Strengths and drawbacks per item -->
      <sc-if value="{{ vsView.reasons.length }}">
        <section class="{{ 'cmp-reasons ' + vsView.cols }}">
          <sc-for list="{{ vsView.reasons }}" as="col">
            <div class="cmp-reason-col">
              <div class="cmp-reason-head"><i class="{{ 'cmp-dot ' + col.dot }}"></i>{{ col.head }}</div>
              <sc-if value="{{ col.hasPros }}"><ul><sc-for list="{{ col.pros }}" as="p"><li>{{ p }}</li></sc-for></ul></sc-if>
              <sc-if value="{{ col.hasCons }}">
                <div class="cmp-reason-sub">Trade-offs</div>
                <ul><sc-for list="{{ col.cons }}" as="c"><li class="is-con">{{ c }}</li></sc-for></ul>
              </sc-if>
            </div>
          </sc-for>
        </section>
      </sc-if>

      <!-- Measured on the dimensions the ranking used -->
      <sc-if value="{{ vsView.bars.length }}">
        <section class="cmp-bars">
          <div class="cmp-section-title">How they measure up</div>
          <div class="cmp-legend">
            <sc-for list="{{ vsView.specHead }}" as="h"><span><i class="{{ 'cmp-dot ' + h.dot }}"></i>{{ h.title }}</span></sc-for>
          </div>
          <sc-for list="{{ vsView.bars }}" as="bar">
            <div class="cmp-bar-row">
              <div class="cmp-bar-label"><b class="cmp-bar-name">{{ bar.label }}</b><em class="cmp-bar-hint">{{ bar.hint }}</em></div>
              <div class="cmp-bar">
                <sc-for list="{{ bar.lines }}" as="ln">
                  <div class="cmp-bar-line"><span class="{{ ln.fill }}" style="{{ ln.width }}"></span><span class="{{ ln.num }}">{{ ln.text }}</span></div>
                </sc-for>
              </div>
            </div>
          </sc-for>
        </section>
      </sc-if>

      <!-- Full specifications -->
      <section class="{{ 'cmp-specs ' + vsView.cols }}">
        <div class="cmp-section-title">Specifications</div>
        <div class="cmp-spec-headrow">
          <span></span>
          <sc-for list="{{ vsView.specHead }}" as="h"><span class="cmp-spec-h"><i class="{{ 'cmp-dot ' + h.dot }}"></i>{{ h.title }}</span></sc-for>
        </div>
        <sc-for list="{{ vsView.specGroups }}" as="grp">
          <div class="cmp-spec-group">{{ grp.title }}</div>
          <sc-for list="{{ grp.rows }}" as="row">
            <div class="cmp-spec-row">
              <span class="cmp-spec-k">{{ row.label }}<sc-if value="{{ row.note }}"><span class="cmp-spec-note">{{ row.note }}</span></sc-if></span>
              <sc-for list="{{ row.cells }}" as="cell">
                <span class="{{ cell.cls }}">{{ cell.text }}<sc-if value="{{ cell.hasChip }}"><br /><span class="cmp-chip">{{ cell.chip }}</span></sc-if></span>
              </sc-for>
            </div>
          </sc-for>
        </sc-for>
      </section>

      <!-- How to read this -->
      <sc-if value="{{ vsView.dataNotes.length || vsView.marketNote }}">
        <ul class="cmp-notes" aria-label="About this comparison">
          <sc-if value="{{ vsView.marketNote }}"><li>{{ vsView.marketNote }}</li></sc-if>
          <sc-for list="{{ vsView.dataNotes }}" as="n"><li>{{ n }}</li></sc-for>
        </ul>
      </sc-if>

      <!-- Real offers -->
      <sc-if value="{{ vsView.hasBuyRows }}">
        <section class="cmp-buy">
          <div class="cmp-section-title">Where to buy</div>
          <sc-for list="{{ vsView.buyRows }}" as="row">
            <div class="cmp-buy-row">
              <div class="cmp-buy-info">
                <div class="cmp-buy-name"><i class="{{ 'cmp-dot ' + row.dot }}"></i>{{ row.seller }} <span class="cmp-buy-for">{{ row.forTitle }}</span></div>
                <div class="cmp-buy-meta">{{ row.meta }}</div>
              </div>
              <div class="cmp-buy-act">
                <span class="cmp-buy-price">{{ row.price }}</span>
                <sc-if value="{{ row.canBuy }}"><button onClick="{{ () => addToCart(row.productId) }}" class="cmp-buy-btn" aria-label="{{ 'Add ' + row.forTitle + ' to your bag' }}">Add</button></sc-if>
              </div>
            </div>
          </sc-for>
        </section>
      </sc-if>

    </sc-if>
  </div>

  <sc-if value="{{ vsView.stickyProductId }}">
    <div class="cmp-sticky">
      <span class="cmp-sticky-text">{{ vsView.stickyText }}</span>
      <button onClick="{{ () => addToCart(vsView.stickyProductId) }}" class="cmp-sticky-btn">Add to bag <span aria-hidden="true">→</span></button>
    </div>
  </sc-if>

</div>
</sc-if>

"""
