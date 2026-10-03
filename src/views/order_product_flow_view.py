# -*- coding: utf-8 -*-
"""
LOUMOO ORDER, REVIEW & SELLER FULFILLMENT VIEWS (PHASE D)

Views for full marketplace lifecycle completeness:
  is.orderDetail        Order detail with live carrier tracking & MoMo escrow timeline
  is.refundRequest      Escrow refund & return dispute claim
  is.writeReview        Verified-purchase star ratings and feedback
  is.sellerOrderDetail  Merchant fulfillment portal with shipping labels & status updates
  is.sellerPayouts      Merchant financial ledger & instant MoMo/OM withdrawal
"""


def get_order_product_flow_view():
    return """
<!-- ══════════════════════════════════════════════════════════════════════════
     ORDER DETAIL & LIVE TRACKING (is.orderDetail) — GET /api/v1/users/me/purchases/:id
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.orderDetail }}">
<div style="padding-bottom:32px">

  <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--color-surface);border-bottom:1px solid var(--color-divider);position:sticky;top:0;z-index:20">
    <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text);cursor:pointer;flex-shrink:0">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
    </button>
    <div style="flex:1;min-width:0">
      <h4 style="margin:0;font-size:16px">Order #{{ currentOrder.id || 'LM-94820' }}</h4>
      <div style="font:400 11px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Placed on {{ currentOrder.placedAt || '28 Aug 2026' }}</div>
    </div>
    <span class="tag tag-accent" style="min-height:22px;padding:2px 8px;font-size:10px">{{ currentOrder.statusLabel || 'IN TRANSIT' }}</span>
  </div>

  <div style="padding:16px;max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:14px">

    <!-- Escrow Protection Badge -->
    <div style="display:flex;align-items:center;gap:12px;background:var(--color-success-100);border:1px solid var(--color-success);border-radius:var(--radius-md);padding:14px 16px">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2" style="flex-shrink:0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <div>
        <div style="font:800 13.5px/1.2 var(--font-heading);color:var(--color-success)">Escrow Secured Payment</div>
        <div style="font:400 12px/1.35 var(--font-body);color:var(--color-text-secondary);margin-top:2px">
          Your XAF {{ currentOrder.totalFormatted || '748 000' }} is held safely in escrow. The merchant is only paid when you confirm receipt.
        </div>
      </div>
    </div>

    <!-- Live Carrier Timeline -->
    <div class="card-premium" style="display:flex;flex-direction:column;gap:14px">
      <div style="font:700 12px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-muted);text-transform:uppercase">Delivery Progress</div>

      <!-- Live delivery tracking (step 4). The button is handled by
           src/services/deliveryTrackingScreen.js via [data-track-delivery] (no DC
           event binding needed): it opens the live MapLibre map, the REAL status
           timeline and the buyer's handover code against /api/v1/deliveries, or a
           friendly notice if this order has no home delivery yet. The previous
           hard-coded carrier steps were placeholder mock-ups and were removed so
           nothing fabricated ships; the authoritative timeline is in the overlay. -->
      <button type="button" data-track-delivery data-order-id="{{ currentOrder.id }}"
        style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px 16px;border:none;border-radius:var(--radius-md);background:var(--color-accent);color:#fff;font:700 13.5px/1 var(--font-heading);cursor:pointer">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-6-5.686-6-10a6 6 0 1 1 12 0c0 4.314-6 10-6 10z"/><circle cx="12" cy="11" r="2"/></svg>
        Track live delivery
      </button>

      <div style="font:400 12px/1.45 var(--font-body);color:var(--color-text-secondary)">
        Follow your rider on a live map, watch each status update in real time, and
        read out your handover code on arrival. Available for home-delivery orders.
      </div>
    </div>

    <!-- Items in Order -->
    <div class="card-premium" style="display:flex;flex-direction:column;gap:12px">
      <div style="font:700 12px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-muted);text-transform:uppercase">Items Purchased</div>

      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:52px;height:52px;border-radius:var(--radius-sm);background:var(--color-neutral-200);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">
          📱
        </div>
        <div style="flex:1;min-width:0">
          <div style="font:700 13.5px/1.3 var(--font-heading);color:var(--color-text)">Apple iPhone 15 Pro Max 256GB</div>
          <div style="font:400 12px/1.3 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Natural Titanium · Qty: 1 · Orca Electronics</div>
        </div>
        <div style="font:800 14px/1 var(--font-heading);color:var(--color-text)">XAF 745 000</div>
      </div>

      <div style="border-top:1px solid var(--color-divider);padding-top:10px;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;font:400 12.5px/1 var(--font-body);color:var(--color-text-secondary)">
          <span>Subtotal</span>
          <span>XAF 745 000</span>
        </div>
        <div style="display:flex;justify-content:space-between;font:400 12.5px/1 var(--font-body);color:var(--color-text-secondary)">
          <span>Express Delivery (Douala)</span>
          <span>XAF 3 000</span>
        </div>
        <div style="display:flex;justify-content:space-between;font:800 14.5px/1 var(--font-heading);color:var(--color-text);padding-top:6px;border-top:1px solid var(--color-divider)">
          <span>Total Paid (MoMo)</span>
          <span>XAF 748 000</span>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div style="display:flex;gap:10px">
      <button onClick="{{ openWriteReview }}" class="btn btn-primary" style="flex:1;height:44px;font-size:13px;cursor:pointer">⭐ WRITE A REVIEW</button>
      <button onClick="{{ openRefundRequest }}" class="btn btn-secondary" style="flex:1;height:44px;font-size:13px;color:var(--color-accent-sale);cursor:pointer">REQUEST REFUND</button>
    </div>

  </div>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     REFUND / DISPUTE REQUEST (is.refundRequest)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.refundRequest }}">
<div style="padding-bottom:32px">

  <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--color-surface);border-bottom:1px solid var(--color-divider);position:sticky;top:0;z-index:20">
    <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text);cursor:pointer;flex-shrink:0">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
    </button>
    <h4 style="margin:0;font-size:16px">Request Escrow Refund</h4>
  </div>

  <div style="padding:16px;max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:14px">

    <div class="card-premium" style="display:flex;flex-direction:column;gap:14px">
      <div>
        <label style="font:700 11px/1 var(--font-heading);color:var(--color-text-secondary);margin-bottom:6px;display:block">REASON FOR REFUND</label>
        <select class="input" style="cursor:pointer" value="{{ refundReason }}" onChange="{{ updateRefundReason }}">
          <option value="damaged">Item arrived damaged / broken</option>
          <option value="not_as_described">Item defective or does not match description</option>
          <option value="wrong_item">Received wrong product or wrong color/size</option>
          <option value="never_arrived">Package never arrived</option>
          <option value="counterfeit">Item suspected non-genuine</option>
        </select>
      </div>

      <div>
        <label style="font:700 11px/1 var(--font-heading);color:var(--color-text-secondary);margin-bottom:6px;display:block">DETAILED EXPLANATION</label>
        <textarea class="input" style="height:90px;padding:10px;resize:none" value="{{ refundDetails }}" placeholder="Describe the issue in detail so our dispute mediation team can review..." onInput="{{ updateRefundDetails }}"></textarea>
      </div>

      <div>
        <label style="font:700 11px/1 var(--font-heading);color:var(--color-text-secondary);margin-bottom:6px;display:block">ATTACH PHOTOS / PROOF</label>
        <button onClick="{{ simulateRefundPhotoUpload }}" class="btn btn-secondary" style="height:40px;font-size:12px;cursor:pointer">
          📷 {{ refundPhotoAttached ? '✓ 2 PHOTOS ATTACHED' : 'CHOOSE PHOTO PROOF' }}
        </button>
      </div>
    </div>

    <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary);padding:0 4px">
      When you submit a refund claim, the seller's escrow payout is placed on legal hold while LOUMOO customer protection inspects the claim.
    </div>

    <button onClick="{{ submitRefundRequest }}" disabled="{{ refundBusy }}" class="btn btn-primary btn-block" style="height:48px;font-size:14px;cursor:pointer">
      <sc-if value="{{ refundBusy }}">
        <span class="spinner-inline" aria-hidden="true"></span>
        <span>SUBMITTING DISPUTE CLAIM…</span>
      </sc-if>
      <sc-if value="{{ !refundBusy }}">
        <span>SUBMIT ESCROW REFUND CLAIM</span>
      </sc-if>
    </button>

  </div>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     WRITE REVIEW & RATING (is.writeReview)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.writeReview }}">
<div style="padding-bottom:32px">

  <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--color-surface);border-bottom:1px solid var(--color-divider);position:sticky;top:0;z-index:20">
    <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text);cursor:pointer;flex-shrink:0">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
    </button>
    <h4 style="margin:0;font-size:16px">Write Verified Review</h4>
  </div>

  <div style="padding:16px;max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:16px">

    <div class="card-premium" style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;padding:24px 20px">
      <div style="font:800 16px/1.2 var(--font-heading);color:var(--color-text)">Rate Your Experience</div>
      <div style="font:400 12.5px/1.4 var(--font-body);color:var(--color-text-secondary)">{{ reviewTargetName }}</div>

      <!-- Star Selector -->
      <div style="display:flex;gap:10px;font-size:32px;cursor:pointer;margin:6px 0">
        <span onClick="{{ () => setReviewStars(1) }}" style="color:{{ reviewStars >= 1 ? '#ffcc00' : 'var(--color-neutral-300)' }}">★</span>
        <span onClick="{{ () => setReviewStars(2) }}" style="color:{{ reviewStars >= 2 ? '#ffcc00' : 'var(--color-neutral-300)' }}">★</span>
        <span onClick="{{ () => setReviewStars(3) }}" style="color:{{ reviewStars >= 3 ? '#ffcc00' : 'var(--color-neutral-300)' }}">★</span>
        <span onClick="{{ () => setReviewStars(4) }}" style="color:{{ reviewStars >= 4 ? '#ffcc00' : 'var(--color-neutral-300)' }}">★</span>
        <span onClick="{{ () => setReviewStars(5) }}" style="color:{{ reviewStars >= 5 ? '#ffcc00' : 'var(--color-neutral-300)' }}">★</span>
      </div>
      <div style="font:700 13px/1 var(--font-heading);color:var(--color-accent)">{{ reviewRatingLabel }}</div>
    </div>

    <div class="card-premium" style="display:flex;flex-direction:column;gap:14px">
      <div>
        <label style="font:700 11px/1 var(--font-heading);color:var(--color-text-secondary);margin-bottom:6px;display:block">REVIEW TITLE</label>
        <input type="text" class="input" value="{{ reviewTitle }}" placeholder="e.g. Excellent pristine condition, fast Douala delivery!" onInput="{{ updateReviewTitle }}">
      </div>

      <div>
        <label style="font:700 11px/1 var(--font-heading);color:var(--color-text-secondary);margin-bottom:6px;display:block">DETAILED FEEDBACK</label>
        <textarea class="input" style="height:100px;padding:10px;resize:none" value="{{ reviewBody }}" placeholder="Tell other buyers in Cameroon about the product quality, packaging, and merchant responsiveness..." onInput="{{ updateReviewBody }}"></textarea>
      </div>
    </div>

    <button onClick="{{ submitProductReview }}" class="btn btn-primary btn-block" style="height:48px;font-size:14px;cursor:pointer">
      PUBLISH VERIFIED REVIEW
    </button>

  </div>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     SELLER ORDER / FULFILLMENT DETAIL (is.sellerOrderDetail)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.sellerOrderDetail }}">
<div style="padding-bottom:32px">

  <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--color-surface);border-bottom:1px solid var(--color-divider);position:sticky;top:0;z-index:20">
    <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text);cursor:pointer;flex-shrink:0">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
    </button>
    <div style="flex:1;min-width:0">
      <h4 style="margin:0;font-size:16px">Fulfillment #LM-94820</h4>
      <div style="font:400 11px/1.2 var(--font-body);color:var(--color-text-secondary);margin-top:2px">Buyer: Samuel Etoo · Douala Bastos</div>
    </div>
    <span class="tag tag-accent" style="min-height:22px;padding:2px 8px;font-size:10px">READY TO PACK</span>
  </div>

  <div style="padding:16px;max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:14px">

    <div class="card-premium" style="display:flex;flex-direction:column;gap:10px">
      <div style="font:700 12px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-muted);text-transform:uppercase">Delivery Destination</div>
      <div style="font:700 14px/1.2 var(--font-heading);color:var(--color-text)">Samuel Etoo · +237 677 88 99 00</div>
      <div style="font:400 13px/1.4 var(--font-body);color:var(--color-text-secondary)">Rue des Cocotiers, Akwa, Douala, Cameroon</div>
    </div>

    <div class="card-premium" style="display:flex;flex-direction:column;gap:12px">
      <div style="font:700 12px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-muted);text-transform:uppercase">Order Items</div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font:600 13.5px/1.3 var(--font-body);color:var(--color-text)">1x Apple iPhone 15 Pro Max 256GB</span>
        <span style="font:800 14px/1 var(--font-heading);color:var(--color-text)">XAF 745 000</span>
      </div>
    </div>

    <!-- Fulfillment CTAs -->
    <div style="display:flex;flex-direction:column;gap:10px">
      <button onClick="{{ markOrderDispatched }}" class="btn btn-primary btn-block" style="height:48px;font-size:14px;cursor:pointer">
        📦 MARK AS DISPATCHED &amp; ASSIGN CARRIER
      </button>
      <button onClick="{{ printShippingLabel }}" class="btn btn-secondary btn-block" style="height:44px;font-size:13px;cursor:pointer">
        🖨️ PRINT WAYBILL &amp; SHIPPING LABEL
      </button>
    </div>

  </div>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     SELLER PAYOUTS & WITHDRAWALS (is.sellerPayouts)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.sellerPayouts }}">
<div style="padding-bottom:32px">

  <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--color-surface);border-bottom:1px solid var(--color-divider);position:sticky;top:0;z-index:20">
    <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text);cursor:pointer;flex-shrink:0">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
    </button>
    <h4 style="margin:0;font-size:16px">Seller Balance &amp; Payouts</h4>
  </div>

  <div style="padding:16px;max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:16px">

    <!-- Ledger Balances -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
      <div class="card-premium" style="padding:18px;border:2px solid var(--color-accent)">
        <div style="font:700 11.5px/1 var(--font-heading);color:var(--color-text-secondary)">AVAILABLE BALANCE</div>
        <div style="font:800 24px/1 var(--font-heading);color:var(--color-text);margin-top:6px">XAF 1 480 000</div>
        <div style="font:500 11px/1 var(--font-body);color:var(--color-success);margin-top:4px">Ready for instant withdrawal</div>
      </div>

      <div class="card-premium" style="padding:18px">
        <div style="font:700 11.5px/1 var(--font-heading);color:var(--color-text-secondary)">IN ESCROW (HOLD)</div>
        <div style="font:800 24px/1 var(--font-heading);color:var(--color-text-muted);margin-top:6px">XAF 748 000</div>
        <div style="font:500 11px/1 var(--font-body);color:var(--color-text-secondary);margin-top:4px">Awaiting delivery confirmations</div>
      </div>
    </div>

    <!-- Instant Withdrawal Form -->
    <div class="card-premium" style="display:flex;flex-direction:column;gap:14px">
      <div style="font:700 12px/1 var(--font-heading);letter-spacing:.08em;color:var(--color-text-muted);text-transform:uppercase">Withdraw Funds (MTN MoMo / Orange Money)</div>

      <div>
        <label style="font:700 11px/1 var(--font-heading);color:var(--color-text-secondary);margin-bottom:6px;display:block">PAYOUT METHOD</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <button onClick="{{ () => setPayoutMethod('mtn') }}" class="card-premium" style="padding:12px;text-align:center;cursor:pointer;border:{{ payoutMethod === 'mtn' ? '2px solid var(--color-momo-yellow)' : '1px solid var(--color-divider)' }};background:{{ payoutMethod === 'mtn' ? '#fffbe6' : 'var(--color-surface)' }}">
            <span style="font:800 13px/1 var(--font-heading)">🟡 MTN MoMo</span>
          </button>
          <button onClick="{{ () => setPayoutMethod('om') }}" class="card-premium" style="padding:12px;text-align:center;cursor:pointer;border:{{ payoutMethod === 'om' ? '2px solid var(--color-om-orange)' : '1px solid var(--color-divider)' }};background:{{ payoutMethod === 'om' ? '#fff0e6' : 'var(--color-surface)' }}">
            <span style="font:800 13px/1 var(--font-heading)">🟠 Orange Money</span>
          </button>
        </div>
      </div>

      <div>
        <label style="font:700 11px/1 var(--font-heading);color:var(--color-text-secondary);margin-bottom:6px;display:block">PHONE NUMBER FOR PAYOUT</label>
        <input type="tel" class="input" value="{{ payoutPhone }}" placeholder="690 12 34 56" onInput="{{ updatePayoutPhone }}">
      </div>

      <div>
        <label style="font:700 11px/1 var(--font-heading);color:var(--color-text-secondary);margin-bottom:6px;display:block">AMOUNT (XAF)</label>
        <input type="number" class="input" value="{{ payoutAmount }}" placeholder="500 000" onInput="{{ updatePayoutAmount }}">
      </div>

      <button onClick="{{ submitPayoutRequest }}" class="btn btn-primary btn-block" style="height:48px;font-size:14px;cursor:pointer">
        REQUEST INSTANT WITHDRAWAL
      </button>
    </div>

  </div>
</div>
</sc-if>
"""
