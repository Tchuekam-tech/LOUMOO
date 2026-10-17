# -*- coding: utf-8 -*-
"""
LOUMOO CART, TELECOM CHECKOUT, PAYING ANIMATION, ORDERS & TRANSACTIONS VIEWS
Complete revenue-critical checkout funnel with Lucide SVG icons, optical alignment, and accessible ARIA attributes.
"""

def get_cart_view():
    return """
<!-- ══════════════════════════════════════════════════════════════════════════
     SHOPPING BAG VIEW (is.cart)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.cart }}">
<div style="padding-bottom:32px">
  
  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-surface);border-bottom:1px solid var(--color-divider);position:sticky;top:0;z-index:20">
    <div style="display:flex;align-items:center;gap:12px">
      <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <div>
        <h4 style="margin:0;font-size:16px">Review Your Bag</h4>
        <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary)">{{ cartLabel }}</div>
      </div>
    </div>
    <span style="font:800 13px/1 var(--font-heading);color:var(--color-accent)">{{ cartTotal }}</span>
  </div>

  <!-- Empty bag -->
  <sc-if value="{{ !cartHasItems }}">
    <div style="padding:72px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px">
      <div style="width:72px;height:72px;border-radius:50%;background:var(--color-surface-subtle);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted)">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
      </div>
      <div>
        <h3 style="margin:0 0 6px;font-size:18px">Your bag is empty</h3>
        <p style="font-size:13.5px;line-height:1.5;color:var(--color-text-secondary);max-width:300px;margin:0 auto">Add items from any product page and they'll show up here, ready to check out.</p>
      </div>
      <button onClick="{{ on.home }}" class="btn btn-primary" style="height:44px;padding:0 24px;font-size:13.5px;font-weight:700">Start shopping</button>
    </div>
  </sc-if>

  <!-- Bag with items -->
  <sc-if value="{{ cartHasItems }}">
  <div style="padding:16px 16px calc(96px + env(safe-area-inset-bottom, 16px));max-width:880px;margin:0 auto;display:flex;flex-direction:column;gap:16px">

    <!-- Delivery banner: says what the total below actually includes -->
    <div class="card-premium" style="background:var(--color-surface-subtle);border-color:var(--color-accent-200);padding:14px 18px">
      <div style="display:flex;align-items:center;gap:8px;font:700 12.5px/1.2 var(--font-heading);color:var(--color-accent);margin-bottom:{{ cartDeliveryIsFree ? '8px' : '0' }}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>
        <span>{{ cartDeliveryBanner }}</span>
      </div>
      <sc-if value="{{ cartDeliveryIsFree }}">
      <div style="height:5px;background:var(--color-neutral-200);border-radius:3px;overflow:hidden">
        <div style="width:100%;height:100%;background:var(--color-accent)"></div>
      </div>
      </sc-if>
    </div>

    <!-- Line items -->
    <sc-for list="{{ cartItemsList }}" as="item">
    <div class="card-premium">
      <div style="display:flex;gap:14px">
        <div onClick="{{ () => openProduct(item.id) }}" style="width:84px;height:84px;border-radius:var(--radius-sm);flex-shrink:0;overflow:hidden;background:var(--color-surface-subtle);cursor:pointer">
          <img src="{{ item.image }}" alt="{{ item.name }}" style="width:100%;height:100%;object-fit:cover">
        </div>
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
            <div onClick="{{ () => openProduct(item.id) }}" style="cursor:pointer">
              <div style="font:700 14.5px/1.2 var(--font-heading);color:var(--color-text)">{{ item.name }}</div>
              <div style="font:400 12px/1 var(--font-body);color:var(--color-text-secondary);margin-top:4px">Sold by {{ item.store }}</div>
            </div>
            <div style="font:800 16px/1 var(--font-heading);color:var(--color-text);white-space:nowrap">{{ item.lineLabel }}</div>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
            <div style="display:flex;align-items:center;gap:8px;background:var(--color-neutral-100);padding:3px 8px;border-radius:var(--radius-pill);border:1px solid var(--color-divider)">
              <button onClick="{{ () => decCartQty(item.id) }}" aria-label="Decrease quantity" class="stepper-btn" style="width:26px;height:26px;font-size:13px">−</button>
              <span style="font:800 13px/1 var(--font-heading);min-width:20px;text-align:center">{{ item.qty }}</span>
              <button onClick="{{ () => incCartQty(item.id) }}" aria-label="Increase quantity" class="stepper-btn" style="width:26px;height:26px;font-size:13px">+</button>
            </div>
            <button onClick="{{ () => removeCartItem(item.id) }}" aria-label="Remove item" style="border:none;background:transparent;color:var(--color-text-secondary);font:600 11.5px/1 var(--font-body);cursor:pointer">Remove</button>
          </div>
        </div>
      </div>
    </div>
    </sc-for>

    <!-- Order Summary Card -->
    <div class="card-premium">
      <h4 style="margin:0 0 14px;font-size:16px">Summary</h4>
      <div style="display:flex;flex-direction:column;gap:10px;font-size:13px">
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--color-text-secondary)">Items Subtotal</span>
          <span style="font-weight:700;color:var(--color-text)">{{ cartSubtotalLabel }}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--color-text-secondary)">{{ cartDeliveryRowLabel }}</span>
          <span style="font-weight:700;color:{{ cartDeliveryIsFree ? 'var(--color-success)' : 'var(--color-text)' }}">{{ cartDeliveryRowValue }}</span>
        </div>
        <div style="border-top:1px solid var(--color-divider);padding-top:10px;display:flex;justify-content:space-between;align-items:baseline">
          <span style="font:800 15px/1 var(--font-heading)">Total</span>
          <span style="font:800 20px/1 var(--font-heading);color:var(--color-accent)">{{ cartTotal }}</span>
        </div>
      </div>

      <button onClick="{{ on.checkout }}" class="btn btn-primary btn-block" style="height:50px;font-size:14.5px;margin-top:18px">
        <span>PROCEED TO SECURE CHECKOUT</span>
        <span>→</span>
      </button>
    </div>

  </div>
  </sc-if>
</div>
</sc-if>
"""

def get_checkout_view():
    return """
<!-- ══════════════════════════════════════════════════════════════════════════
     LINEAR 3-STEP CHECKOUT (is.checkout)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.checkout }}">
<div style="padding-bottom:calc(96px + env(safe-area-inset-bottom, 16px))">
  
  <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-surface);border-bottom:1px solid var(--color-divider);position:sticky;top:0;z-index:20">
    <div style="display:flex;align-items:center;gap:12px">
      <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <div>
        <h4 style="margin:0;font-size:16px">Buyer-Protected Checkout</h4>
        <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary)">Step 2 of 3 · Payment &amp; Delivery</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:4px;color:var(--color-success);font:700 11.5px/1 var(--font-heading)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <span>256-Bit SSL</span>
    </div>
  </div>

  <div style="padding:16px;max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:16px">
    
    <!-- Delivery Address Card. Shows the REAL destination the order will use, or,
         when none is on file yet, an honest "add it" prompt — never an invented
         address the order would then reject. -->
    <div class="card-premium">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font:800 12px/1 var(--font-heading);letter-spacing:.06em;color:var(--color-text-secondary);text-transform:uppercase">1. DELIVERY DESTINATION</div>
        <sc-if value="{{ checkoutHasDestination }}">
          <button class="btn btn-secondary btn-sm" onClick="{{ changeDeliveryDestination }}">CHANGE</button>
        </sc-if>
      </div>
      <sc-if value="{{ checkoutHasDestination }}">
        <div style="font:700 14px/1.2 var(--font-heading);color:var(--color-text)">{{ checkoutRecipientName }} · +237 {{ checkoutRecipientPhone }}</div>
        <sc-if value="{{ checkoutIsPickup }}">
          <div style="font:400 12.5px/1.4 var(--font-body);color:var(--color-text-secondary);margin-top:4px">Pick up at the store — you'll be told when your order is ready to collect.</div>
        </sc-if>
        <sc-if value="{{ !checkoutIsPickup }}">
          <div style="font:400 12.5px/1.4 var(--font-body);color:var(--color-text-secondary);margin-top:4px">{{ checkoutDeliveryAddress }}</div>
        </sc-if>
      </sc-if>
      <sc-if value="{{ !checkoutHasDestination }}">
        <div style="font:400 12.5px/1.45 var(--font-body);color:var(--color-text-secondary);margin-bottom:12px">
          <sc-if value="{{ checkoutIsPickup }}">Add your name and a phone number so the store can reach you when your order is ready to collect.</sc-if>
          <sc-if value="{{ !checkoutIsPickup }}">No delivery address yet. Add where the rider should bring your order, so we know where to go and how to reach you.</sc-if>
        </div>
        <button onClick="{{ changeDeliveryDestination }}" class="btn btn-primary btn-sm" style="height:42px">ADD DELIVERY DETAILS</button>
      </sc-if>
    </div>

    <!-- Choose your delivery provider (home delivery only). Real providers from
         the quote endpoint; picking one is optional and sets the fee shown, which
         the server then charges. With none chosen the seller arranges a rider. -->
    <sc-if value="{{ checkoutShowProviders }}">
    <div class="card-premium">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div style="font:800 12px/1 var(--font-heading);letter-spacing:.06em;color:var(--color-text-secondary);text-transform:uppercase">2. CHOOSE YOUR DELIVERY</div>
        <span style="font:600 11px/1 var(--font-body);color:var(--color-text-secondary)">Optional</span>
      </div>
      <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary);margin-bottom:14px">Pick a rider or agency to carry your order, or leave it and the store will arrange one.</div>

      <sc-if value="{{ checkoutProvidersLoading }}">
        <div style="font:500 12.5px/1.4 var(--font-body);color:var(--color-text-secondary);padding:8px 0">Finding delivery providers near you…</div>
      </sc-if>

      <sc-if value="{{ checkoutProvidersError }}">
        <div style="display:flex;flex-direction:column;gap:10px;background:var(--color-surface-subtle);border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:12px 14px">
          <div style="font:500 12.5px/1.4 var(--font-body);color:var(--color-text)">{{ checkoutProvidersError }}</div>
          <button onClick="{{ retryProviders }}" class="btn btn-secondary btn-sm" style="align-self:flex-start;height:36px">TRY AGAIN</button>
        </div>
      </sc-if>

      <sc-if value="{{ checkoutProvidersEmpty }}">
        <div role="status" style="display:flex;flex-direction:column;gap:4px;background:var(--color-surface-subtle);border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:12px 14px">
          <div style="font:700 12.5px/1.3 var(--font-heading);color:var(--color-text)">No rider or agency is available in your area right now</div>
          <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary)">You can still place your order. The store is told straight away and will arrange delivery as soon as a rider is available; you will be notified and can follow it live.</div>
        </div>
      </sc-if>

      <div style="display:flex;flex-direction:column;gap:10px">
        <sc-for list="{{ checkoutProviders }}" as="prov">
          <div>
            <button onClick="{{ () => prov.select() }}" aria-label="Choose {{ prov.name }}" class="checkout-pay-method {{ prov.selected ? 'active' : '' }}">
              <div style="display:flex;align-items:center;gap:12px">
                <div style="width:40px;height:40px;border-radius:50%;background:var(--color-surface-subtle);border:1px solid var(--color-divider);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;font:800 15px/1 var(--font-heading);color:var(--color-text-secondary)">
                  <sc-if value="{{ prov.hasPhoto }}"><img src="{{ prov.photo }}" alt="" style="width:100%;height:100%;object-fit:cover" loading="lazy" decoding="async"></sc-if>
                  <sc-if value="{{ !prov.hasPhoto }}">{{ prov.initial }}</sc-if>
                </div>
                <div style="text-align:left">
                  <div style="font:700 14px/1.2 var(--font-heading);color:var(--color-text)">{{ prov.name }} · <span style="font:600 11px/1 var(--font-body);color:var(--color-text-secondary)">{{ prov.kindLabel }}</span></div>
                  <div style="font:400 11.5px/1.3 var(--font-body);color:var(--color-text-secondary);margin-top:2px">{{ prov.ratingLabel }} · {{ prov.completedLabel }}<sc-if value="{{ prov.vehicleLabel }}"> · {{ prov.vehicleLabel }}</sc-if></div>
                  <div style="font:800 12.5px/1 var(--font-heading);color:var(--color-text);margin-top:3px">{{ prov.feeLabel }}</div>
                </div>
              </div>
              <div class="pay-radio-dot {{ prov.selected ? 'selected' : '' }}"></div>
            </button>
            <!-- Sibling of the select button (never nested in it), so viewing the
                 profile cannot toggle the choice. Opens the provider overlay. -->
            <button type="button" data-open-provider data-provider-id="{{ prov.id }}" data-city="{{ prov.city }}" style="margin:2px 0 0;border:none;background:transparent;padding:4px 6px;font:600 11.5px/1 var(--font-heading);color:var(--color-accent);cursor:pointer">View profile &amp; reviews →</button>
          </div>
        </sc-for>
      </div>
    </div>
    </sc-if>

    <!-- Telecom Payment Selection -->
    <div class="card-premium">
      <div style="font:800 12px/1 var(--font-heading);letter-spacing:.06em;color:var(--color-text-secondary);text-transform:uppercase;margin-bottom:14px">3. SELECT PAYMENT METHOD</div>

      <div style="display:flex;flex-direction:column;gap:10px">
        
        <!-- MTN Mobile Money -->
        <button onClick="{{ pick.pay.mtn }}" aria-label="Pay with MTN Mobile Money" class="checkout-pay-method {{ st.pay.mtn.w === '2px' ? 'active' : '' }}">
          <div style="display:flex;align-items:center;gap:12px">
            <div class="pay-method-badge" style="background:#ffcc00;color:#111">MTN</div>
            <div style="text-align:left">
              <div style="font:700 14px/1.2 var(--font-heading);color:var(--color-text)">MTN Mobile Money (MoMo)</div>
              <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:2px">You pay on delivery with MTN Mobile Money</div>
            </div>
          </div>
          <div class="pay-radio-dot {{ st.pay.mtn.w === '2px' ? 'selected' : '' }}"></div>
        </button>

        <!-- Orange Money -->
        <button onClick="{{ pick.pay.om }}" aria-label="Pay with Orange Money" class="checkout-pay-method {{ st.pay.om.w === '2px' ? 'active' : '' }}">
          <div style="display:flex;align-items:center;gap:12px">
            <div class="pay-method-badge" style="background:#ff6600;color:#fff">OM</div>
            <div style="text-align:left">
              <div style="font:700 14px/1.2 var(--font-heading);color:var(--color-text)">Orange Money Cameroon</div>
              <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:2px">You pay on delivery with Orange Money</div>
            </div>
          </div>
          <div class="pay-radio-dot {{ st.pay.om.w === '2px' ? 'selected' : '' }}"></div>
        </button>

        <!-- Credit / Debit Card -->
        <button onClick="{{ pick.pay.card }}" aria-label="Pay with Visa or Mastercard" class="checkout-pay-method {{ st.pay.card.w === '2px' ? 'active' : '' }}">
          <div style="display:flex;align-items:center;gap:12px">
            <div class="pay-method-badge" style="background:var(--color-neutral-800);color:#fff">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
            </div>
            <div style="text-align:left">
              <div style="font:700 14px/1.2 var(--font-heading);color:var(--color-text)">Visa / Mastercard / UBA Africard</div>
              <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:2px">You pay on delivery by card</div>
            </div>
          </div>
          <div class="pay-radio-dot {{ st.pay.card.w === '2px' ? 'selected' : '' }}"></div>
        </button>

      </div>
    </div>

    <!-- Buyer-protection callout. The honest promise for pay-on-delivery: no money
         is held up front, so the protection is that the buyer pays only once the
         order is in their hands and confirmed with the delivery code. -->
    <div style="display:flex;gap:12px;background:var(--color-surface-subtle);border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:14px 18px;align-items:center">
      <div style="width:36px;height:36px;border-radius:50%;background:var(--color-success-100);color:var(--color-success);display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <div style="font:400 12px/1.4 var(--font-body);color:var(--color-text-secondary)">
        <strong style="color:var(--color-text)">LOUMOO Buyer Protection.</strong>
        You pay on delivery — nothing leaves your hands until the rider hands over your order and you confirm it with your delivery code. If it never arrives, you don't pay, and LOUMOO steps in.
      </div>
    </div>

    <!-- Why the order was not placed (the bag is kept) -->
    <sc-if value="{{ orderError }}">
    <div role="alert" style="display:flex;flex-direction:column;gap:10px;background:var(--color-danger-100);border:1px solid var(--color-danger);border-radius:var(--radius-md);padding:14px 16px">
      <div style="font:700 13.5px/1.3 var(--font-heading);color:var(--color-text)">We couldn't place your order</div>
      <div style="font:400 12.5px/1.45 var(--font-body);color:var(--color-text)">{{ orderError }}</div>
      <sc-if value="{{ orderErrorHasItems }}">
        <button onClick="{{ removeUnavailableItems }}" class="btn btn-secondary btn-sm" style="align-self:flex-start;height:40px">REMOVE THEM FROM MY BAG</button>
      </sc-if>
    </div>
    </sc-if>

    <!-- Place Order CTA — payment is collected on delivery for now. The order is
         created on the server (that is what tells the seller), so the button waits
         for the answer instead of pretending. -->
    <button onClick="{{ placeOrder }}" disabled="{{ placingOrder }}" class="btn btn-primary btn-block" style="height:52px;font-size:15px;letter-spacing:.02em;cursor:{{ placingOrder ? 'wait' : 'pointer' }};opacity:{{ placingOrder ? '0.7' : '1' }}">
      <span>{{ placeOrderLabel }}</span>
      <span>{{ placeOrderArrow }}</span>
    </button>
    <div style="text-align:center;font:500 11.5px/1.4 var(--font-body);color:var(--color-text-secondary);margin-top:-6px">
      No charge now — you'll pay <strong style="color:var(--color-text)">on delivery</strong> with your chosen method. The seller is told straight away and arranges a rider; you can follow it live.
    </div>

  </div>
</div>
</sc-if>
"""

def get_success_view():
    return """
<!-- ══════════════════════════════════════════════════════════════════════════
     ORDER CONFIRMED & TRACKING HUB (is.success)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.success }}">
<div style="padding:32px 16px 48px;max-width:680px;margin:0 auto;text-align:center">
  
  <div class="success-check-badge">
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"/></svg>
  </div>

  <h2 style="font-size:24px;margin:16px 0 6px">{{ lastOrdersTitle }}</h2>
  <div style="font:800 12px/1 var(--font-mono);color:var(--color-text-muted);letter-spacing:.08em;margin-bottom:20px">ORDER #{{ lastOrderNumber }}</div>

  <p style="font-size:13.5px;color:var(--color-text-secondary);line-height:1.5;max-width:480px;margin:0 auto 24px">
    Your order of <strong>{{ lastOrderTotal }}</strong> ({{ lastOrderItemsLabel }}) has been sent to <strong>{{ lastOrderSeller }}</strong>, who has been notified. You'll pay <strong>on delivery</strong> via {{ lastOrderPayMethod }} — no charge has been taken.
  </p>
  <sc-if value="{{ lastOrdersHasMore }}">
    <p style="font-size:12.5px;color:var(--color-text-secondary);line-height:1.5;max-width:480px;margin:-12px auto 24px">{{ lastOrdersMoreNote }}</p>
  </sc-if>

  <!-- The chosen delivery provider became unavailable between the quote and
       placing: the order went through at the standard city rate, said honestly
       rather than switched silently (integration spec item E). -->
  <sc-if value="{{ lastDeliveryNotice }}">
    <div style="display:flex;gap:10px;text-align:left;background:var(--color-warning-100, var(--color-surface-subtle));border:1px solid var(--color-warning, var(--color-divider));border-radius:var(--radius-md);padding:12px 14px;max-width:480px;margin:0 auto 24px">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning, #b45309)" stroke-width="2" style="flex-shrink:0;margin-top:1px"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
      <div style="font:500 12.5px/1.45 var(--font-body);color:var(--color-text)">{{ lastDeliveryNoticeText }}</div>
    </div>
  </sc-if>

  <!-- Where the order is, whose move it is, and your part in it. Fills itself
       from the delivery API (src/services/deliveryCircuit.js). -->
  <div class="card-premium" style="text-align:left;margin-bottom:24px">
    <h4 style="margin:0 0 14px;font-size:15px">Order status</h4>
    <div data-circuit-strip data-role="buyer" data-order-id="{{ lastOrderId }}"></div>
  </div>

  <div style="display:flex;flex-direction:column;gap:10px">
    <button onClick="{{ openLastOrder }}" class="btn btn-primary btn-block" style="height:48px">TRACK MY ORDER</button>
    <button onClick="{{ on.orders }}" class="btn btn-secondary btn-block" style="height:44px">VIEW MY ORDERS</button>
    <button onClick="{{ () => contactSellerWhatsApp({ sellerName: lastOrderSeller, phone: lastOrderSellerPhone, orderNumber: lastOrderNumber, price: lastOrderTotal }) }}" class="btn btn-secondary btn-block" style="height:44px;color:var(--color-wa-teal);font-weight:700">WHATSAPP MERCHANT</button>
    <button onClick="{{ on.home }}" style="border:none;background:transparent;padding:8px;font:700 12.5px/1 var(--font-heading);color:var(--color-text-secondary);cursor:pointer">Back to Marketplace</button>
  </div>

</div>
</sc-if>
"""

def get_orders_and_transactions_view():
    return """
<!-- ══════════════════════════════════════════════════════════════════════════
     MY ORDERS (is.orders)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.orders }}">
<div style="padding-bottom:32px">
  
  <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-surface);border-bottom:1px solid var(--color-divider);position:sticky;top:0;z-index:20">
    <div style="display:flex;align-items:center;gap:12px">
      <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <div>
        <h4 style="margin:0;font-size:16px">My Orders</h4>
        <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary)">Manage parcel deliveries &amp; bookings</div>
      </div>
    </div>
  </div>

  <!-- Empty state -->
  <sc-if value="{{ !ordersHasItems }}">
    <div style="padding:72px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px">
      <div style="width:72px;height:72px;border-radius:50%;background:var(--color-surface-subtle);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted)">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
      </div>
      <div>
        <h3 style="margin:0 0 6px;font-size:18px">No orders yet</h3>
        <p style="font-size:13.5px;line-height:1.5;color:var(--color-text-secondary);max-width:300px;margin:0 auto">When you place an order it will appear here so you can track it.</p>
      </div>
      <button onClick="{{ on.home }}" class="btn btn-primary" style="height:44px;padding:0 24px;font-size:13.5px;font-weight:700">Start shopping</button>
    </div>
  </sc-if>

  <!-- Orders list -->
  <sc-if value="{{ ordersHasItems }}">
  <div style="padding:16px;max-width:860px;margin:0 auto;display:flex;flex-direction:column;gap:14px">
    <sc-for list="{{ ordersList }}" as="order">
    <div class="card-premium">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--color-divider);padding-bottom:12px;margin-bottom:12px">
        <div>
          <span style="font:800 12px/1 var(--font-mono);color:var(--color-accent)">#{{ order.orderNumber }}</span>
          <div style="font:400 11px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">{{ order.dateLabel }} · {{ order.itemCountLabel }}</div>
        </div>
        <span class="tag tag-accent" style="min-height:22px;padding:2px 8px;font-size:10px">{{ order.statusLabel }}</span>
      </div>

      <div style="display:flex;gap:12px;align-items:center">
        <div style="width:64px;height:64px;border-radius:var(--radius-sm);flex-shrink:0;overflow:hidden;background:var(--color-surface-subtle)">
          <img src="{{ order.firstImage }}" alt="{{ order.itemsSummary }}" style="width:100%;height:100%;object-fit:cover">
        </div>
        <div style="flex:1;min-width:0">
          <div style="font:700 14px/1.3 var(--font-heading);color:var(--color-text)">{{ order.itemsSummary }}</div>
          <div style="font:800 14.5px/1 var(--font-heading);color:var(--color-text);margin-top:4px">{{ order.totalLabel }}</div>
          <div style="font:500 11px/1 var(--font-body);color:var(--color-text-secondary);margin-top:4px">{{ order.payLabel }}</div>
        </div>
      </div>

      <sc-if value="{{ order.notSent }}">
        <div style="margin-top:12px;font:500 12px/1.45 var(--font-body);color:var(--color-text);background:var(--color-warning-100, var(--color-surface-subtle));border-radius:var(--radius-sm);padding:10px 12px">
          This order was saved on this device only, so the seller never received it. Add the items to your bag again to place it.
        </div>
      </sc-if>

      <div style="display:flex;gap:10px;margin-top:14px;border-top:1px solid var(--color-divider);padding-top:12px">
        <sc-if value="{{ order.canOpen }}">
          <button onClick="{{ () => openOrderById(order.id) }}" class="btn btn-primary btn-block" style="height:38px;font-size:12px;font-weight:700">VIEW &amp; TRACK</button>
        </sc-if>
        <button onClick="{{ () => order.canOpen ? messageSeller({ orderId: order.id }) : contactSellerWhatsApp({ sellerName: order.seller, phone: order.sellerPhone || order.sellerWhatsapp, orderNumber: order.orderNumber, productTitle: order.itemsSummary, price: order.totalLabel }) }}" class="btn btn-secondary btn-block" style="height:38px;font-size:12px;font-weight:700" disabled="{{ convStarting }}">MESSAGE SELLER</button>
      </div>
    </div>
    </sc-for>
  </div>
  </sc-if>
</div>
</sc-if>

<!-- ══════════════════════════════════════════════════════════════════════════
     ESCROW TRANSACTION LEDGER (is.transactions)
     ══════════════════════════════════════════════════════════════════════ -->
<sc-if value="{{ is.transactions }}">
<div style="padding-bottom:32px">
  
  <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--color-surface);border-bottom:1px solid var(--color-divider);position:sticky;top:0;z-index:20">
    <button onClick="{{ back }}" aria-label="Go back" style="border:1px solid var(--color-divider);background:var(--color-surface);width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--color-text)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 18-6-6 6-6"/></svg>
    </button>
    <div>
      <h4 style="margin:0;font-size:16px">Escrow Transaction Ledger</h4>
      <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary)">Financial records &amp; release receipts</div>
    </div>
  </div>

  <sc-if value="{{ !ordersHasItems }}">
    <div style="padding:64px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px">
      <div style="width:64px;height:64px;border-radius:50%;background:var(--color-surface-subtle);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted)">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
      </div>
      <h3 style="margin:0;font-size:17px">No transactions yet</h3>
      <p style="font-size:13px;color:var(--color-text-secondary);max-width:300px;margin:0">Your payment records will appear here once online payment goes live.</p>
    </div>
  </sc-if>

  <sc-if value="{{ ordersHasItems }}">
  <div style="padding:16px;max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:12px">
    <sc-for list="{{ ordersList }}" as="order">
    <div class="card-premium" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font:700 13.5px/1.2 var(--font-heading);color:var(--color-text)">Order #{{ order.orderNumber }}</div>
        <div style="font:400 11.5px/1 var(--font-body);color:var(--color-text-secondary);margin-top:3px">{{ order.payLabel }}</div>
      </div>
      <div style="text-align:right">
        <div style="font:800 15px/1 var(--font-heading);color:var(--color-text)">{{ order.totalLabel }}</div>
        <span style="font:600 10.5px/1 var(--font-body);color:var(--color-accent)">Pending</span>
      </div>
    </div>
    </sc-for>
  </div>
  </sc-if>
</div>
</sc-if>
"""
