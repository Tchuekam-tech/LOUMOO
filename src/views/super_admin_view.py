# -*- coding: utf-8 -*-
"""
LOUMOO SUPERADMIN CONTROL CENTER (is.superAdmin)
---------------------------------------------------------------------------
Executive-grade operational command center for platform governance, merchant KYC,
catalog moderation, escrow dispute arbitration, and zero-code dynamic settings.
Reuses LOUMOO luxury visual tokens (Electric Blue, Plus Jakarta Sans, glassmorphism).
"""


def get_super_admin_view():
    return """
<!-- ══════════════════════════════════════════════════════════════════════════
     LOUMOO SUPERADMIN CONTROL CENTER (is.superAdmin)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.superAdmin }}">
<div style="min-height:100vh;background:var(--color-background);padding-bottom:80px">

  <!-- ── 01. EXECUTIVE CONSOLE HEADER ── -->
  <div style="background:var(--color-surface);border-bottom:1px solid var(--color-divider);position:sticky;top:0;z-index:30;box-shadow:var(--shadow-xs);backdrop-filter:blur(12px)">
    <div style="max-width:1320px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">

      <!-- Left: Identity & Live Status -->
      <div style="display:flex;align-items:center;gap:14px">
        <button onClick="{{ on.home }}" aria-label="Retour au site" title="Retourner sur LOUMOO" style="border:1px solid var(--color-divider);background:var(--color-surface);width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--color-text);cursor:pointer;flex-shrink:0;transition:all .15s ease">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 18-6-6 6-6"/></svg>
        </button>

        <div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--color-accent,#007aff) 0%,#003d8a 100%);color:#fff;display:flex;align-items:center;justify-content:center;font:800 15px/1 var(--font-heading);letter-spacing:-.02em;box-shadow:0 4px 14px rgba(0,122,255,0.25);flex-shrink:0">
          SA
        </div>

        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font:800 16px/1.2 var(--font-heading);color:var(--color-text);letter-spacing:-.02em">LOUMOO SUPERADMIN</span>
            <span style="display:inline-flex;align-items:center;gap:5px;background:#ecfdf5;border:1px solid #10b981;color:#065f46;padding:2px 8px;border-radius:var(--radius-pill);font:700 9.5px/1 var(--font-heading);letter-spacing:.06em;text-transform:uppercase">
              <span style="width:6px;height:6px;border-radius:50%;background:#10b981;display:inline-block"></span>
              EN DIRECT
            </span>
          </div>
          <div style="font:500 11.5px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">
            Console Centrale de Gouvernance • <span style="color:var(--color-accent)">admin@loumoo.cm</span> • Douala (UTC+1)
          </div>
        </div>
      </div>

      <!-- Right: Quick Executive Actions -->
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <button onClick="{{ toggleDark }}" aria-label="Basculer mode sombre" class="btn" style="height:34px;padding:0 12px;font-size:11.5px;font-weight:700;border:1px solid var(--color-divider);background:var(--color-surface);border-radius:var(--radius-pill);color:var(--color-text);cursor:pointer;display:inline-flex;align-items:center;gap:6px">
          <sc-if value="{{ darkMode }}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            Mode Clair
          </sc-if>
          <sc-if value="{{ !darkMode }}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            Mode Sombre
          </sc-if>
        </button>

        <button onClick="{{ on.adminRefreshData }}" aria-label="Actualiser les données" class="btn btn-secondary" style="height:34px;padding:0 14px;font-size:11.5px;font-weight:700;border-radius:var(--radius-pill);cursor:pointer;display:inline-flex;align-items:center;gap:6px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          Actualiser
        </button>

        <button onClick="{{ on.home }}" aria-label="Retour au Marketplace" class="btn btn-primary" style="height:34px;padding:0 14px;font-size:11.5px;font-weight:800;border-radius:var(--radius-pill);cursor:pointer;display:inline-flex;align-items:center;gap:6px">
          Boutique Client
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </div>

    </div>
  </div>

  <div style="max-width:1320px;margin:0 auto;padding:18px 16px">

    <!-- ── 02. SEGMENTED TAB NAVIGATION BAR ── -->
    <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:12px;margin-bottom:20px;scrollbar-width:none;-webkit-overflow-scrolling:touch">
      <button onClick="{{ on.adminSetTabOverview }}" style="padding:8px 16px;border-radius:var(--radius-pill);font:700 12.5px/1 var(--font-heading);cursor:pointer;white-space:nowrap;border:1px solid {{ adminTabIsOverview ? 'var(--color-accent)' : 'var(--color-divider)' }};background:{{ adminTabIsOverview ? 'var(--color-accent)' : 'var(--color-surface)' }};color:{{ adminTabIsOverview ? '#fff' : 'var(--color-text)' }};box-shadow:{{ adminTabIsOverview ? '0 4px 12px rgba(0,122,255,0.22)' : 'none' }};transition:all .15s ease">
        📊 Vue d'Ensemble
      </button>

      <button onClick="{{ on.adminSetTabStores }}" style="padding:8px 16px;border-radius:var(--radius-pill);font:700 12.5px/1 var(--font-heading);cursor:pointer;white-space:nowrap;border:1px solid {{ adminTabIsStores ? 'var(--color-accent)' : 'var(--color-divider)' }};background:{{ adminTabIsStores ? 'var(--color-accent)' : 'var(--color-surface)' }};color:{{ adminTabIsStores ? '#fff' : 'var(--color-text)' }};box-shadow:{{ adminTabIsStores ? '0 4px 12px rgba(0,122,255,0.22)' : 'none' }};transition:all .15s ease">
        🏬 Boutiques & KYC ({{ adminStats.pendingKycCount || 3 }})
      </button>

      <button onClick="{{ on.adminSetTabListings }}" style="padding:8px 16px;border-radius:var(--radius-pill);font:700 12.5px/1 var(--font-heading);cursor:pointer;white-space:nowrap;border:1px solid {{ adminTabIsListings ? 'var(--color-accent)' : 'var(--color-divider)' }};background:{{ adminTabIsListings ? 'var(--color-accent)' : 'var(--color-surface)' }};color:{{ adminTabIsListings ? '#fff' : 'var(--color-text)' }};box-shadow:{{ adminTabIsListings ? '0 4px 12px rgba(0,122,255,0.22)' : 'none' }};transition:all .15s ease">
        📦 Modération Catalogue
      </button>

      <button onClick="{{ on.adminSetTabUsers }}" style="padding:8px 16px;border-radius:var(--radius-pill);font:700 12.5px/1 var(--font-heading);cursor:pointer;white-space:nowrap;border:1px solid {{ adminTabIsUsers ? 'var(--color-accent)' : 'var(--color-divider)' }};background:{{ adminTabIsUsers ? 'var(--color-accent)' : 'var(--color-surface)' }};color:{{ adminTabIsUsers ? '#fff' : 'var(--color-text)' }};box-shadow:{{ adminTabIsUsers ? '0 4px 12px rgba(0,122,255,0.22)' : 'none' }};transition:all .15s ease">
        👥 Utilisateurs & RBAC
      </button>

      <button onClick="{{ on.adminSetTabOrders }}" style="padding:8px 16px;border-radius:var(--radius-pill);font:700 12.5px/1 var(--font-heading);cursor:pointer;white-space:nowrap;border:1px solid {{ adminTabIsOrders ? 'var(--color-accent)' : 'var(--color-divider)' }};background:{{ adminTabIsOrders ? 'var(--color-accent)' : 'var(--color-surface)' }};color:{{ adminTabIsOrders ? '#fff' : 'var(--color-text)' }};box-shadow:{{ adminTabIsOrders ? '0 4px 12px rgba(0,122,255,0.22)' : 'none' }};transition:all .15s ease">
        💳 Commandes & Séquestre
      </button>

      <button onClick="{{ on.adminSetTabSettings }}" style="padding:8px 16px;border-radius:var(--radius-pill);font:700 12.5px/1 var(--font-heading);cursor:pointer;white-space:nowrap;border:1px solid {{ adminTabIsSettings ? 'var(--color-accent)' : 'var(--color-divider)' }};background:{{ adminTabIsSettings ? 'var(--color-accent)' : 'var(--color-surface)' }};color:{{ adminTabIsSettings ? '#fff' : 'var(--color-text)' }};box-shadow:{{ adminTabIsSettings ? '0 4px 12px rgba(0,122,255,0.22)' : 'none' }};transition:all .15s ease">
        ⚙️ Paramètres Zéro-Code
      </button>

      <button onClick="{{ on.adminSetTabAudit }}" style="padding:8px 16px;border-radius:var(--radius-pill);font:700 12.5px/1 var(--font-heading);cursor:pointer;white-space:nowrap;border:1px solid {{ adminTabIsAudit ? 'var(--color-accent)' : 'var(--color-divider)' }};background:{{ adminTabIsAudit ? 'var(--color-accent)' : 'var(--color-surface)' }};color:{{ adminTabIsAudit ? '#fff' : 'var(--color-text)' }};box-shadow:{{ adminTabIsAudit ? '0 4px 12px rgba(0,122,255,0.22)' : 'none' }};transition:all .15s ease">
        🛡️ Journal d'Audit Immuable
      </button>

      <!-- Rider roster (src/services/ridersAdmin.js), opened through
           [data-open-riders-admin], a document-level delegate, so no DC tab state. -->
      <button type="button" data-open-riders-admin style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:var(--radius-pill);font:700 12.5px/1 var(--font-heading);cursor:pointer;white-space:nowrap;border:1px solid var(--color-divider);background:var(--color-surface);color:var(--color-text);transition:all .15s ease">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="17.5" r="2.5"/><circle cx="18.5" cy="17.5" r="2.5"/><path d="M8 17.5h7.5l-3-8H9"/><path d="M15 6h2.5l1 4.5"/><path d="M12.5 9.5H17"/></svg>
        Livreurs
      </button>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════════════
         TAB 1: OVERVIEW & REAL-TIME PLATFORM METRICS
         ══════════════════════════════════════════════════════════════════════ -->
    <sc-if value="{{ adminTabIsOverview }}">
      <div style="display:flex;flex-direction:column;gap:20px">

        <!-- Executive Bento Grid -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:16px">

          <!-- KPI 1: GMV -->
          <div class="card-premium" style="position:relative;overflow:hidden;padding:20px">
            <div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--color-accent,#007aff),#00c6ff)"></div>
            <div style="display:flex;align-items:center;justify-content:space-between">
              <div style="font:700 11px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-secondary);text-transform:uppercase">VOLUME GLOBAL (GMV)</div>
              <span style="font:700 11px/1 var(--font-heading);color:#10b981;background:#ecfdf5;padding:2px 6px;border-radius:4px">+18.4%</span>
            </div>
            <div style="font:800 24px/1.2 var(--font-heading);color:var(--color-text);margin-top:10px;letter-spacing:-.02em">
              {{ adminStats.gmvFormatted || '14 850 000 XAF' }}
            </div>
            <div style="font:500 12px/1 var(--font-body);color:var(--color-text-secondary);margin-top:6px">
              {{ adminStats.totalOrders || 86 }} transactions marchandes finalisées
            </div>
          </div>

          <!-- KPI 2: Escrow In-Flight -->
          <div class="card-premium" style="position:relative;overflow:hidden;padding:20px">
            <div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#ffd100,#f59e0b)"></div>
            <div style="display:flex;align-items:center;justify-content:space-between">
              <div style="font:700 11px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-secondary);text-transform:uppercase">SÉQUESTRE EN TRANSIT</div>
              <span style="font:700 11px/1 var(--font-heading);color:#b45309;background:#fef3c7;padding:2px 6px;border-radius:4px">CONTRAT ACTIF</span>
            </div>
            <div style="font:800 24px/1.2 var(--font-heading);color:var(--color-text);margin-top:10px;letter-spacing:-.02em">
              {{ adminStats.escrowInFlightFormatted || '2 340 000 XAF' }}
            </div>
            <div style="font:500 12px/1 var(--font-body);color:var(--color-text-secondary);margin-top:6px">
              Fonds protégés jusqu'à confirmation de livraison
            </div>
          </div>

          <!-- KPI 3: Boutiques & KYC Queue -->
          <div class="card-premium" style="position:relative;overflow:hidden;padding:20px">
            <div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#10b981,#059669)"></div>
            <div style="display:flex;align-items:center;justify-content:space-between">
              <div style="font:700 11px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-secondary);text-transform:uppercase">BOUTIQUES ENREGISTRÉES</div>
              <span style="font:700 11px/1 var(--font-heading);color:#dc2626;background:#fee2e2;padding:2px 6px;border-radius:4px">{{ adminStats.pendingKycCount || 3 }} KYC EN ATTENTE</span>
            </div>
            <div style="font:800 24px/1.2 var(--font-heading);color:var(--color-text);margin-top:10px;letter-spacing:-.02em">
              {{ adminStats.activeStores || 18 }} Boutiques
            </div>
            <div style="font:500 12px/1 var(--font-body);color:var(--color-text-secondary);margin-top:6px">
              Couverture Douala, Yaoundé, Bafoussam
            </div>
          </div>

          <!-- KPI 4: Taux de Commission -->
          <div class="card-premium" style="position:relative;overflow:hidden;padding:20px">
            <div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#8b5cf6,#6366f1)"></div>
            <div style="display:flex;align-items:center;justify-content:space-between">
              <div style="font:700 11px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-secondary);text-transform:uppercase">COMMISSION PLATEFORME</div>
              <span style="font:700 11px/1 var(--font-heading);color:#6d28d9;background:#ede9fe;padding:2px 6px;border-radius:4px">DYNAMIQUE</span>
            </div>
            <div style="font:800 24px/1.2 var(--font-heading);color:var(--color-text);margin-top:10px;letter-spacing:-.02em">
              {{ adminSettings.platform_commission_rate.rate_percent || 5 }}%
            </div>
            <div style="font:500 12px/1 var(--font-body);color:var(--color-text-secondary);margin-top:6px">
              Modifiable sans redémarrage de code
            </div>
          </div>

        </div>

        <!-- Quick Access Banners -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:16px">

          <div class="card-premium" style="padding:20px;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="width:10px;height:10px;border-radius:50%;background:#ef4444"></span>
                <span style="font:700 13px/1 var(--font-heading);color:var(--color-text)">File d'Attente de Vérification Marchand</span>
              </div>
              <p style="font:400 12.5px/1.5 var(--font-body);color:var(--color-text-secondary);margin:10px 0 16px">
                {{ adminStats.pendingKycCount || 3 }} boutiques attendent la validation de leur Registre de Commerce (RCCM) et CNI pour publier leurs catalogues.
              </p>
            </div>
            <button onClick="{{ on.adminSetTabStores }}" class="btn btn-secondary" style="height:36px;font-size:12px;font-weight:700;border-radius:var(--radius-pill);cursor:pointer">
              Examiner les Dossiers Marchands →
            </button>
          </div>

          <div class="card-premium" style="padding:20px;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="width:10px;height:10px;border-radius:50%;background:#f59e0b"></span>
                <span style="font:700 13px/1 var(--font-heading);color:var(--color-text)">Arbitrage des Paiements Séquestrés</span>
              </div>
              <p style="font:400 12.5px/1.5 var(--font-body);color:var(--color-text-secondary);margin:10px 0 16px">
                {{ adminStats.disputeCount || 2 }} litiges en attente de médiation avec séquestre bloqué. Libérez ou remboursez en 1 clic.
              </p>
            </div>
            <button onClick="{{ on.adminSetTabOrders }}" class="btn btn-secondary" style="height:36px;font-size:12px;font-weight:700;border-radius:var(--radius-pill);cursor:pointer">
              Arbitrer les Séquestres →
            </button>
          </div>

        </div>

      </div>
    </sc-if>

    <!-- ══════════════════════════════════════════════════════════════════════════
         TAB 2: STORES & MERCHANT KYC QUEUE
         ══════════════════════════════════════════════════════════════════════ -->
    <sc-if value="{{ adminTabIsStores }}">
      <div style="display:flex;flex-direction:column;gap:16px">

        <!-- Store Filters & Search -->
        <div class="card-premium" style="padding:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:8px;overflow-x:auto">
            <button onClick="{{ on.adminFilterStoresAll }}" style="padding:6px 12px;border-radius:var(--radius-pill);font:700 11.5px/1 var(--font-heading);cursor:pointer;border:1px solid var(--color-divider);background:{{ adminStoreFilter === 'ALL' || !adminStoreFilter ? 'var(--color-accent)' : 'var(--color-surface)' }};color:{{ adminStoreFilter === 'ALL' || !adminStoreFilter ? '#fff' : 'var(--color-text)' }}">
              Toutes ({{ adminStoresList.length || 4 }})
            </button>
            <button onClick="{{ on.adminFilterStoresPending }}" style="padding:6px 12px;border-radius:var(--radius-pill);font:700 11.5px/1 var(--font-heading);cursor:pointer;border:1px solid var(--color-divider);background:{{ adminStoreFilter === 'PENDING_VERIFICATION' ? 'var(--color-accent)' : 'var(--color-surface)' }};color:{{ adminStoreFilter === 'PENDING_VERIFICATION' ? '#fff' : 'var(--color-text)' }}">
              ⏱ En Attente KYC
            </button>
            <button onClick="{{ on.adminFilterStoresActive }}" style="padding:6px 12px;border-radius:var(--radius-pill);font:700 11.5px/1 var(--font-heading);cursor:pointer;border:1px solid var(--color-divider);background:{{ adminStoreFilter === 'ACTIVE' ? 'var(--color-accent)' : 'var(--color-surface)' }};color:{{ adminStoreFilter === 'ACTIVE' ? '#fff' : 'var(--color-text)' }}">
              ● Actives
            </button>
            <button onClick="{{ on.adminFilterStoresSuspended }}" style="padding:6px 12px;border-radius:var(--radius-pill);font:700 11.5px/1 var(--font-heading);cursor:pointer;border:1px solid var(--color-divider);background:{{ adminStoreFilter === 'SUSPENDED' ? 'var(--color-accent)' : 'var(--color-surface)' }};color:{{ adminStoreFilter === 'SUSPENDED' ? '#fff' : 'var(--color-text)' }}">
              ✕ Suspendues
            </button>
          </div>

          <div style="font:600 12px/1 var(--font-heading);color:var(--color-text-secondary)">
            {{ adminStoresList.length }} boutiques répertoriées
          </div>
        </div>

        <!-- Stores Card Stream -->
        <div style="display:flex;flex-direction:column;gap:12px">
          <sc-for list="{{ filteredAdminStoresList || adminStoresList }}" as="store">
            <div class="card-premium" style="padding:16px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">

              <!-- Left Identity -->
              <div style="display:flex;align-items:center;gap:14px;min-width:240px">
                <div style="width:48px;height:48px;border-radius:12px;background:var(--color-surface-subtle);border:1px solid var(--color-divider);display:flex;align-items:center;justify-content:center;font:800 16px/1 var(--font-heading);color:var(--color-accent);flex-shrink:0">
                  🏬
                </div>
                <div>
                  <div style="display:flex;align-items:center;gap:6px">
                    <span style="font:700 14.5px/1.2 var(--font-heading);color:var(--color-text)">{{ store.name }}</span>
                    <span style="font:700 9.5px/1 var(--font-heading);padding:2px 6px;border-radius:4px;background:{{ store.status === 'ACTIVE' ? '#ecfdf5' : store.status === 'PENDING_VERIFICATION' ? '#fef3c7' : '#fee2e2' }};color:{{ store.status === 'ACTIVE' ? '#065f46' : store.status === 'PENDING_VERIFICATION' ? '#b45309' : '#991b1b' }}">
                      {{ store.status }}
                    </span>
                    <span style="font:700 9.5px/1 var(--font-heading);padding:2px 6px;border-radius:4px;background:#e0f2fe;color:#0369a1;text-transform:uppercase">
                      {{ store.verification_tier || 'unverified' }}
                    </span>
                  </div>
                  <div style="font:400 12px/1.3 var(--font-body);color:var(--color-text-secondary);margin-top:3px">
                    {{ store.category || 'Commerce Général' }} • {{ store.city || 'Cameroun' }} • WhatsApp: {{ store.phone_number }}
                  </div>
                  <div style="font:500 11px/1.2 var(--font-body);color:var(--color-text-muted);margin-top:2px">
                    Titulaire: {{ store.owner ? store.owner.full_name : 'Marchand Indépendant' }} (KYC: {{ store.owner ? store.owner.kyc_status : 'unverified' }})
                  </div>
                </div>
              </div>

              <!-- Right Actions -->
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <button data-id="{{ store.id }}" onClick="{{ on.adminVerifyStorePro }}" style="height:32px;padding:0 12px;border-radius:var(--radius-pill);border:none;background:#10b981;color:#fff;font:700 11.5px/1 var(--font-heading);cursor:pointer;display:inline-flex;align-items:center;gap:5px">
                  ✓ Valider KYC (Pro)
                </button>
                <button data-id="{{ store.id }}" onClick="{{ on.adminVerifyStoreBrand }}" style="height:32px;padding:0 12px;border-radius:var(--radius-pill);border:1px solid #ffd100;background:#fffbeb;color:#b45309;font:700 11.5px/1 var(--font-heading);cursor:pointer;display:inline-flex;align-items:center;gap:5px">
                  ★ Marque Officielle
                </button>
                <button data-id="{{ store.id }}" onClick="{{ on.adminRejectStoreKyc }}" style="height:32px;padding:0 10px;border-radius:var(--radius-pill);border:1px solid #ef4444;background:#fff;color:#ef4444;font:700 11.5px/1 var(--font-heading);cursor:pointer">
                  ✕ Rejeter
                </button>
                <button data-id="{{ store.id }}" onClick="{{ on.adminToggleStoreSuspend }}" style="height:32px;padding:0 10px;border-radius:var(--radius-pill);border:1px solid var(--color-divider);background:var(--color-surface);color:var(--color-text);font:700 11.5px/1 var(--font-heading);cursor:pointer">
                  {{ store.status === 'SUSPENDED' ? 'Réactiver' : 'Suspendre' }}
                </button>
              </div>

            </div>
          </sc-for>
        </div>

      </div>
    </sc-if>

    <!-- ══════════════════════════════════════════════════════════════════════════
         TAB 3: CATALOG & PRODUCT MODERATION
         ══════════════════════════════════════════════════════════════════════ -->
    <sc-if value="{{ adminTabIsListings }}">
      <div style="display:flex;flex-direction:column;gap:16px">

        <div class="card-premium" style="padding:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font:700 14px/1 var(--font-heading);color:var(--color-text)">Catalogue Marchand & Conformité des Prix</span>
          </div>
          <span style="font:600 12px/1 var(--font-heading);color:var(--color-text-secondary)">
            {{ adminListingsList.length }} articles en modération
          </span>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:16px">
          <sc-for list="{{ adminListingsList }}" as="item">
            <div class="card-premium" style="padding:16px;display:flex;flex-direction:column;justify-content:space-between;gap:14px">
              <div>
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
                  <div>
                    <span style="font:700 9.5px/1 var(--font-heading);color:var(--color-accent);text-transform:uppercase;letter-spacing:.06em">{{ item.category_id || 'PRODUIT' }}</span>
                    <h5 style="margin:4px 0 0;font:700 14px/1.3 var(--font-heading);color:var(--color-text)">{{ item.title }}</h5>
                  </div>
                  <span style="font:700 10px/1 var(--font-heading);padding:3px 7px;border-radius:4px;background:{{ item.status === 'ACTIVE' ? '#ecfdf5' : '#fee2e2' }};color:{{ item.status === 'ACTIVE' ? '#065f46' : '#991b1b' }}">
                    {{ item.status }}
                  </span>
                </div>
                <div style="font:800 16px/1.2 var(--font-heading);color:var(--color-accent);margin-top:8px">
                  {{ item.base_price }} {{ item.currency || 'XAF' }}
                </div>
                <div style="font:400 12px/1.3 var(--font-body);color:var(--color-text-secondary);margin-top:4px">
                  Boutique: {{ item.store_name }} • Stock: {{ item.stock_quantity }}
                  <sc-if value="{{ item.is_featured }}">
                    <span style="margin-left:6px;font:700 9.5px/1 var(--font-heading);color:#b45309;background:#fef3c7;padding:2px 6px;border-radius:4px">★ VEDETTE</span>
                  </sc-if>
                </div>
              </div>

              <div style="display:flex;align-items:center;gap:8px;padding-top:10px;border-top:1px solid var(--color-divider);flex-wrap:wrap">
                <button data-id="{{ item.id }}" onClick="{{ on.adminApproveListing }}" style="flex:1;height:32px;border-radius:var(--radius-pill);border:none;background:#10b981;color:#fff;font:700 11px/1 var(--font-heading);cursor:pointer">
                  ✓ Approuver
                </button>
                <button data-id="{{ item.id }}" onClick="{{ on.adminFeatureListing }}" style="flex:1;height:32px;border-radius:var(--radius-pill);border:1px solid #ffd100;background:{{ item.is_featured ? '#ffd100' : '#fffbeb' }};color:{{ item.is_featured ? '#000' : '#b45309' }};font:700 11px/1 var(--font-heading);cursor:pointer">
                  ★ {{ item.is_featured ? 'Retirer Vedette' : 'Vedette Accueil' }}
                </button>
                <button data-id="{{ item.id }}" onClick="{{ on.adminSuspendListing }}" style="flex:1;height:32px;border-radius:var(--radius-pill);border:1px solid #ef4444;background:#fff;color:#ef4444;font:700 11px/1 var(--font-heading);cursor:pointer">
                  ✕ Suspendre
                </button>
              </div>
            </div>
          </sc-for>
        </div>

      </div>
    </sc-if>

    <!-- ══════════════════════════════════════════════════════════════════════════
         TAB 4: USERS & IDENTITY RBAC
         ══════════════════════════════════════════════════════════════════════ -->
    <sc-if value="{{ adminTabIsUsers }}">
      <div style="display:flex;flex-direction:column;gap:16px">

        <div class="card-premium" style="padding:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="font:700 14px/1 var(--font-heading);color:var(--color-text)">Annuaire des Utilisateurs & Privilèges RBAC</div>
          <span style="font:600 12px/1 var(--font-heading);color:var(--color-text-secondary)">
            {{ adminUsersList.length }} profils vérifiés
          </span>
        </div>

        <div style="display:flex;flex-direction:column;gap:12px">
          <sc-for list="{{ adminUsersList }}" as="u">
            <div class="card-premium" style="padding:16px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">

              <div style="display:flex;align-items:center;gap:14px;min-width:240px">
                <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--color-accent,#007aff),#003d8a);color:#fff;display:flex;align-items:center;justify-content:center;font:800 15px/1 var(--font-heading);flex-shrink:0">
                  {{ u.full_name ? u.full_name.charAt(0) : 'U' }}
                </div>
                <div>
                  <div style="display:flex;align-items:center;gap:6px">
                    <span style="font:700 14.5px/1.2 var(--font-heading);color:var(--color-text)">{{ u.full_name }}</span>
                    <span style="font:700 9.5px/1 var(--font-heading);padding:2px 6px;border-radius:4px;background:#ede9fe;color:#6d28d9;text-transform:uppercase">
                      {{ u.primary_role }}
                    </span>
                    <span style="font:700 9.5px/1 var(--font-heading);padding:2px 6px;border-radius:4px;background:{{ u.kyc_status === 'verified' ? '#ecfdf5' : '#fef3c7' }};color:{{ u.kyc_status === 'verified' ? '#065f46' : '#b45309' }}">
                      KYC: {{ u.kyc_status }}
                    </span>
                  </div>
                  <div style="font:400 12px/1.3 var(--font-body);color:var(--color-text-secondary);margin-top:3px">
                    {{ u.email }} • Tél: {{ u.phone_number }} • Ville: {{ u.city || 'Cameroun' }}
                  </div>
                </div>
              </div>

              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <button data-id="{{ u.id }}" onClick="{{ on.adminPromoteModerator }}" style="height:32px;padding:0 10px;border-radius:var(--radius-pill);border:1px solid var(--color-divider);background:var(--color-surface);font:700 11px/1 var(--font-heading);cursor:pointer">
                  Élever Modérateur
                </button>
                <button data-id="{{ u.id }}" onClick="{{ on.adminPromoteSeller }}" style="height:32px;padding:0 10px;border-radius:var(--radius-pill);border:1px solid var(--color-divider);background:var(--color-surface);font:700 11px/1 var(--font-heading);cursor:pointer">
                  Attribuer Rôle Vendeur
                </button>
                <button data-id="{{ u.id }}" onClick="{{ on.adminVerifyUserKyc }}" style="height:32px;padding:0 10px;border-radius:var(--radius-pill);border:none;background:#10b981;color:#fff;font:700 11px/1 var(--font-heading);cursor:pointer">
                  ✓ Valider KYC
                </button>
              </div>

            </div>
          </sc-for>
        </div>

      </div>
    </sc-if>

    <!-- ══════════════════════════════════════════════════════════════════════════
         TAB 5: ORDERS & ESCROW ARBITRATION
         ══════════════════════════════════════════════════════════════════════ -->
    <sc-if value="{{ adminTabIsOrders }}">
      <div style="display:flex;flex-direction:column;gap:16px">

        <div class="card-premium" style="padding:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="font:700 14px/1 var(--font-heading);color:var(--color-text)">Arbitrage des Commandes & Contrats Séquestrés</div>
          <span style="font:600 12px/1 var(--font-heading);color:var(--color-text-secondary)">
            {{ adminOrdersList.length }} commandes récentes
          </span>
        </div>

        <div style="display:flex;flex-direction:column;gap:12px">
          <sc-for list="{{ adminOrdersList }}" as="o">
            <div class="card-premium" style="padding:16px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">

              <div>
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font:800 13px/1 var(--font-heading);color:var(--color-accent)">{{ o.order_number || o.id }}</span>
                  <span style="font:700 9.5px/1 var(--font-heading);padding:2px 6px;border-radius:4px;background:#fef3c7;color:#b45309">
                    SÉQUESTRE: {{ o.escrow_status }}
                  </span>
                  <span style="font:700 9.5px/1 var(--font-heading);padding:2px 6px;border-radius:4px;background:#ecfdf5;color:#065f46">
                    STATUT: {{ o.status }}
                  </span>
                </div>
                <div style="font:800 18px/1.2 var(--font-heading);color:var(--color-text);margin-top:6px">
                  {{ o.total_amount }} {{ o.currency || 'XAF' }}
                </div>
                <div style="font:400 12px/1.3 var(--font-body);color:var(--color-text-secondary);margin-top:3px">
                  Acheteur: {{ o.customer_name }} • Boutique: {{ o.store_name }}
                </div>
              </div>

              <!-- Dispute Arbitration Buttons -->
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <button data-id="{{ o.id }}" onClick="{{ on.adminReleaseEscrow }}" style="height:32px;padding:0 12px;border-radius:var(--radius-pill);border:none;background:#10b981;color:#fff;font:700 11.5px/1 var(--font-heading);cursor:pointer;display:inline-flex;align-items:center;gap:5px">
                  💸 Libérer au Vendeur
                </button>
                <button data-id="{{ o.id }}" onClick="{{ on.adminRefundEscrow }}" style="height:32px;padding:0 12px;border-radius:var(--radius-pill);border:1px solid #ef4444;background:#fee2e2;color:#991b1b;font:700 11.5px/1 var(--font-heading);cursor:pointer;display:inline-flex;align-items:center;gap:5px">
                  ↩ Rembourser l'Acheteur
                </button>
                <button data-id="{{ o.id }}" onClick="{{ on.adminHoldEscrow }}" style="height:32px;padding:0 10px;border-radius:var(--radius-pill);border:1px solid var(--color-divider);background:var(--color-surface);color:var(--color-text);font:700 11px/1 var(--font-heading);cursor:pointer">
                  🔒 Geler
                </button>
              </div>

            </div>
          </sc-for>
        </div>

      </div>
    </sc-if>

    <!-- ══════════════════════════════════════════════════════════════════════════
         TAB 6: DYNAMIC ZERO-CODE PLATFORM SETTINGS
         ══════════════════════════════════════════════════════════════════════ -->
    <sc-if value="{{ adminTabIsSettings }}">
      <div style="display:flex;flex-direction:column;gap:18px">

        <div class="card-premium" style="padding:20px;display:flex;flex-direction:column;gap:16px">
          <div>
            <h4 style="margin:0;font:800 18px/1.2 var(--font-heading);color:var(--color-text)">Contrôle Zéro-Code de la Plateforme</h4>
            <p style="margin:6px 0 0;font:400 12.5px/1.5 var(--font-body);color:var(--color-text-secondary)">
              Toutes les modifications saisies ici sont directement persistées dans la base de données (<span style="font-family:monospace;color:var(--color-accent)">iam.system_settings</span>) et répercutées instantanément sans recompiler ni toucher au code.
            </p>
          </div>

          <!-- Commission Rate -->
          <div style="display:flex;flex-direction:column;gap:6px">
            <label style="font:700 11px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-secondary);text-transform:uppercase">
              TAUX DE COMMISSION MARCHÉ (%) *
            </label>
            <input type="number" step="0.1" min="0" max="50" class="input" style="max-width:240px;height:40px;font-weight:700" value="{{ adminSettings.platform_commission_rate.rate_percent }}" onInput="{{ on.adminUpdateCommissionRate }}">
            <span style="font:400 11px/1.2 var(--font-body);color:var(--color-text-muted)">
              Commission prélevée automatiquement sur chaque transaction validée par séquestre.
            </span>
          </div>

          <!-- WhatsApp Fallback Hotline -->
          <div style="display:flex;flex-direction:column;gap:6px">
            <label style="font:700 11px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-secondary);text-transform:uppercase">
              LIGNE WHATSAPP OFFICIELLE / VENDEUR PAR DÉFAUT *
            </label>
            <input type="text" class="input" style="max-width:320px;height:40px;font-weight:700" value="{{ adminSettings.seller_whatsapp_default.number }}" onInput="{{ on.adminUpdateWhatsAppNumber }}">
            <span style="font:400 11px/1.2 var(--font-body);color:var(--color-text-muted)">
              Numéro au format international (ex: 237690123456). Utilisé si une boutique n'a pas encore configuré sa ligne.
            </span>
          </div>

          <!-- Announcement Banner -->
          <div style="display:flex;flex-direction:column;gap:6px">
            <label style="font:700 11px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-secondary);text-transform:uppercase">
              BANNIÈRE DE DIFFUSION PUBLIQUE (TOP BAR)
            </label>
            <input type="text" class="input" style="width:100%;height:40px;font-weight:500" value="{{ adminSettings.announcement_banner.text_fr }}" onInput="{{ on.adminUpdateBannerText }}">
          </div>

          <!-- Maintenance Mode Toggle -->
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:var(--color-surface-subtle);border-radius:var(--radius-md);border:1px solid var(--color-divider)">
            <div>
              <div style="font:700 12.5px/1.2 var(--font-heading);color:var(--color-text)">Mode Maintenance Global</div>
              <div style="font:400 11px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Met l'application en pause pour les utilisateurs externes en cas d'intervention technique.</div>
            </div>
            <button onClick="{{ on.adminToggleMaintenance }}" class="btn" style="height:32px;padding:0 14px;border-radius:var(--radius-pill);font:700 11.5px/1 var(--font-heading);cursor:pointer;background:{{ adminSettings.maintenance_mode.enabled ? '#ef4444' : 'var(--color-surface)' }};color:{{ adminSettings.maintenance_mode.enabled ? '#fff' : 'var(--color-text)' }};border:1px solid var(--color-divider)">
              {{ adminSettings.maintenance_mode.enabled ? 'ACTIF (EN PAUSE)' : 'DÉSACTIVÉ' }}
            </button>
          </div>

          <!-- Save Button -->
          <div style="padding-top:10px;border-top:1px solid var(--color-divider);display:flex;align-items:center;gap:12px">
            <button onClick="{{ on.adminSaveSettings }}" class="btn btn-primary" style="height:42px;padding:0 24px;border-radius:var(--radius-pill);font:800 13px/1 var(--font-heading);letter-spacing:.04em;cursor:pointer;box-shadow:0 4px 14px rgba(0,122,255,0.3)">
              💾 Enregistrer les Paramètres en Base de Données
            </button>
            <sc-if value="{{ adminSettingsSaveSuccess }}">
              <span style="font:700 12px/1 var(--font-heading);color:#10b981">
                ✓ Paramètres enregistrés et synchronisés avec succès !
              </span>
            </sc-if>
          </div>

        </div>

      </div>
    </sc-if>

    <!-- ══════════════════════════════════════════════════════════════════════════
         TAB 7: IMMUTABLE AUDIT TRAIL LOG
         ══════════════════════════════════════════════════════════════════════ -->
    <sc-if value="{{ adminTabIsAudit }}">
      <div style="display:flex;flex-direction:column;gap:16px">

        <div class="card-premium" style="padding:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="font:700 14px/1 var(--font-heading);color:var(--color-text)">Journal d'Audit Tamper-Evident (<span style="font-family:monospace;color:var(--color-accent)">iam.audit_logs</span>)</div>
          <span style="font:600 12px/1 var(--font-heading);color:var(--color-text-secondary)">
            {{ adminAuditLogsList.length }} enregistrements légaux immuables
          </span>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px">
          <sc-for list="{{ adminAuditLogsList }}" as="log">
            <div class="card-premium" style="padding:14px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">

              <div style="display:flex;align-items:center;gap:12px">
                <div style="width:36px;height:36px;border-radius:10px;background:var(--color-surface-subtle);border:1px solid var(--color-divider);display:flex;align-items:center;justify-content:center;font:700 12px/1 var(--font-heading);color:var(--color-text)">
                  🛡️
                </div>
                <div>
                  <div style="display:flex;align-items:center;gap:6px">
                    <span style="font:700 13px/1.2 var(--font-heading);color:var(--color-text)">{{ log.action }}</span>
                    <span style="font:700 9.5px/1 var(--font-heading);padding:2px 6px;border-radius:4px;background:var(--color-surface-subtle);color:var(--color-text-secondary)">
                      {{ log.resource_type }} : {{ log.resource_id }}
                    </span>
                  </div>
                  <div style="font:400 11.5px/1.3 var(--font-body);color:var(--color-text-secondary);margin-top:2px">
                    Opérateur: <strong style="color:var(--color-accent)">{{ log.admin_id }}</strong> • Motif: {{ log.reason || 'Intervention administrative' }}
                  </div>
                </div>
              </div>

              <div style="font:500 11px/1.2 var(--font-body);color:var(--color-text-muted);text-align:right">
                {{ log.created_at }}
                <div style="font:700 9.5px/1 var(--font-heading);color:#10b981;margin-top:2px">✓ CONFORME BD</div>
              </div>

            </div>
          </sc-for>
        </div>

      </div>
    </sc-if>

  </div>

</div>
</sc-if>
"""
