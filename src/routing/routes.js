/**
 * LOUMOO — canonical route registry
 * ---------------------------------------------------------------------------
 * THE single source of truth for the frontend's URLs. Everything that needs to
 * know "which URLs exist, what do they open, and who may open them" reads this
 * file and nothing else:
 *
 *   - the browser router        src/services/appRouter.js
 *   - the Express gateway       server/index.js            (shell, 404, redirects)
 *   - the hosting config        vercel.json  (generated from here by
 *                                                           scripts/sync_route_config.js)
 *   - the tests                 tests/unit/routing_*.test.js, tests/routing/*
 *   - the documentation         docs/ROUTING.md
 *
 * It is a plain UMD module with no dependencies: `window.LoumooRoutes` in the
 * browser, `require('./routes')` in Node.
 *
 * WHAT A ROUTE IS HERE
 *   The application is a single-document app (Commerce App.dc.html) whose
 *   screens are chosen by an in-memory `state.screen`. A route binds a URL to
 *   one of four things:
 *
 *     kind 'screen'      a shell screen (state.screen), optionally with route
 *                        parameters bound to shell state (`bind`) and a loader
 *                        method to run on entry (`enter`)
 *     kind 'overlay'     a full-window tool opened by one of the service
 *                        modules (rider hub, seller dispatch, delivery tracking…)
 *     kind 'page'        a separate HTML document served by the gateway (the
 *                        SuperAdmin control center); the router does a real
 *                        navigation to it
 *     kind 'content'     a public, server-rendered French document (the guides and
 *                        the About page: server/modules/system/seo/content). Built into
 *                        a static file for the CDN and rendered on demand by the
 *                        gateway; the router does a real navigation to it
 *     kind 'unavailable' a named product area that has NO implementation yet.
 *                        Documented, never faked: it renders an honest
 *                        "not available" state with HTTP 404.
 *
 * ACCESS
 *   `access` is what the CLIENT does before showing the route. It is a
 *   convenience that spares a pointless round trip and a confusing error. It is
 *   NOT a security boundary: every protected operation is authorized again by
 *   the backend (docs/ROUTING.md, "Security model").
 *
 *     { kind: 'public' }                      anyone
 *     { kind: 'capability', capability }      a signed-in account whose
 *                                             /api/v1/me/state capabilities include it
 *     { kind: 'seller' }                      the "Sell" decision tree: sign in,
 *                                             create a boutique, finish activating it
 *     { kind: 'role', roles: [...] }          a signed-in account with one of the
 *                                             roles (me/state -> user.primaryRole)
 *
 * DIRECT ENTRY
 *   Some screens are steps of an in-memory flow (checkout success, a half-filled
 *   booking…). Opening or refreshing their URL cannot rebuild that context, so
 *   `direct: 'redirect'` + `fallback` sends the visitor to the route that can.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.LoumooRoutes = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // The canonical public origin: every canonical tag, og:url, sitemap <loc> and the
  // robots.txt Sitemap line is built on it (server, build and browser). It must be
  // the host that ANSWERS 200, not one that redirects: the live apex
  // (https://loumoo.store) 308-redirects to www (a Vercel Domains setting outside
  // this repository; docs/ROUTING.md "Canonical host"), so the canonical is www.
  // A deployment overrides it with PUBLIC_SITE_URL; the browser follows the origin
  // the server wrote into the page (src/services/appRouter.js siteOrigin()).
  var ORIGIN = 'https://www.loumoo.store';

  /* ------------------------------------------------------------------ access */
  var PUBLIC = Object.freeze({ kind: 'public' });
  var SELLER = Object.freeze({ kind: 'seller' });
  function cap(name) { return Object.freeze({ kind: 'capability', capability: name }); }
  function role() { return Object.freeze({ kind: 'role', roles: Object.freeze([].slice.call(arguments)) }); }

  // A path parameter is one URL segment of letters, digits, '_' or '-'. No dots:
  // a dotted last segment is a FILE (see isFileLike), never an application route.
  var PARAM_RE = '[A-Za-z0-9_-]{1,128}';

  /* ------------------------------------------------------------------ routes */
  var DEFS = [];
  /**
   * @param {string} id
   * @param {string} path           '/store/:slug'
   * @param {object} o
   *   kind, screen, overlay, overlayArgs, access, title, bind, fixed, enter,
   *   direct, fallback, aliases, parent, guestOnly, notes, status
   */
  function def(id, path, o) {
    o = o || {};
    DEFS.push({
      id: id,
      path: path,
      kind: o.kind || (o.overlay ? 'overlay' : (o.content ? 'content' : (o.page ? 'page' : 'screen'))),
      screen: o.screen || null,
      overlay: o.overlay || null,
      overlayArgs: o.overlayArgs || null,
      page: o.page || null,
      access: o.access || PUBLIC,
      title: o.title || 'LOUMOO',
      bind: o.bind || null,
      fixed: o.fixed || null,
      enter: o.enter || null,
      direct: o.direct || 'allow',
      fallback: o.fallback || null,
      parent: o.parent || null,
      guestOnly: Boolean(o.guestOnly),
      noSync: Boolean(o.noSync),
      status: o.status || 'implemented',
      notes: o.notes || ''
    });
  }

  /* -- public marketplace -------------------------------------------------- */
  def('home',          '/',                          { screen: 'home', title: 'LOUMOO — Marketplace for Cameroon' });
  def('marketplace',   '/marketplace',               { screen: 'search', title: 'Marketplace — discover products and services', parent: 'home' });
  def('filters',       '/marketplace/filters',       { screen: 'filters', title: 'Filters', direct: 'redirect', fallback: 'marketplace', parent: 'marketplace' });
  def('voice',         '/marketplace/voice',         { screen: 'voice', title: 'Voice search', direct: 'redirect', fallback: 'marketplace', parent: 'marketplace' });
  def('visual',        '/marketplace/visual',        { screen: 'visual', title: 'Visual search', parent: 'marketplace' });
  def('visualScan',    '/marketplace/visual/scan',   { screen: 'visualScan', title: 'Visual search — scan', direct: 'redirect', fallback: 'visual', parent: 'visual' });
  def('visualResults', '/marketplace/visual/results', { screen: 'visualResults', title: 'Visual search — results', direct: 'redirect', fallback: 'visual', parent: 'visual' });
  def('categories',    '/marketplace/categories',    { screen: 'category', fixed: { activeCategorySlug: 'all' }, title: 'Categories', parent: 'marketplace' });
  def('category',      '/marketplace/category/:category', { screen: 'category', bind: { category: 'activeCategorySlug' }, title: 'Category', parent: 'categories' });
  def('bestpicks',     '/marketplace/best-picks',    { screen: 'bestpicks', title: 'Best picks', parent: 'marketplace' });
  def('freeday',       '/marketplace/free-day',      { screen: 'freeday', title: 'Free delivery day', parent: 'marketplace' });
  def('compare',       '/compare',                   { screen: 'vs', enter: '_enterCompare', title: 'Compare products', parent: 'marketplace' });
  def('compareResults', '/compare/results',          { screen: 'vsCompare', enter: '_enterCompare', title: 'Comparison', direct: 'redirect', fallback: 'compare', parent: 'compare' });
  def('product',       '/product/:id',               { screen: 'product', bind: { id: 'currentProductId' }, enter: 'loadProductDetails', title: 'Product', parent: 'marketplace' });
  def('stores',        '/stores',                    { screen: 'store', title: 'Verified stores', parent: 'marketplace' });
  def('brand',         '/brand',                     { screen: 'brand', title: 'Official brands', parent: 'stores' });
  def('storefront',    '/store/:slug',               { screen: 'business', bind: { slug: 'currentStoreId' }, enter: '_enterStorefront', title: 'Store', parent: 'stores' });
  /* -- guides and brand pages: standalone French documents (kind 'content') ---- */
  // Each needs an entry in server/modules/system/seo/content/pages.js with the same
  // routeId (tests/unit/seo_search_dominance.test.js enforces both directions). `page` is
  // where the build writes the static file the CDN serves at the route's path.
  def('guideMarketplace', '/marketplace-cameroun',       { content: true, page: '/pages/marketplace-cameroun.html', title: 'Marketplace et plateforme e-commerce au Cameroun', parent: 'home' });
  def('guideBuy',      '/acheter-en-ligne-cameroun',     { content: true, page: '/pages/acheter-en-ligne-cameroun.html', title: 'Acheter en ligne au Cameroun', parent: 'guideMarketplace' });
  def('guideSell',     '/vendre-en-ligne-cameroun',      { content: true, page: '/pages/vendre-en-ligne-cameroun.html', title: 'Vendre en ligne au Cameroun', parent: 'guideMarketplace' });
  def('about',         '/a-propos',                      { content: true, page: '/pages/a-propos.html', title: 'À propos de LOUMOO', parent: 'home' });

  def('announcements', '/announcements',             { screen: 'announce', title: 'Announcements', parent: 'marketplace' });
  def('announceCampaigns', '/announcements/campaigns', { screen: 'announceCampaigns', access: SELLER, title: 'Announcement campaigns', parent: 'announcements' });
  def('announcement',  '/announcements/:id',         { screen: 'announceDetail', bind: { id: 'activeAnnouncementId' }, enter: 'openAnnouncement', title: 'Announcement', parent: 'announcements' });

  /* -- travel & hotels ------------------------------------------------------ */
  def('travel',        '/travel',                    { screen: 'travel', title: 'Travel — flights, bus, packages and visas', parent: 'home' });
  def('travelBus',     '/travel/bus',                { screen: 'travelBus', title: 'Bus travel', parent: 'travel' });
  def('travelPackages', '/travel/packages',          { screen: 'travelPackages', title: 'Travel packages', parent: 'travel' });
  def('travelVisa',    '/travel/visa',               { screen: 'travelVisa', title: 'Visa assistance', parent: 'travel' });
  def('travelResults', '/travel/results',            { screen: 'travelResults', title: 'Travel results', direct: 'redirect', fallback: 'travel', parent: 'travel' });
  def('travelDetail',  '/travel/details',            { screen: 'travelDetail', title: 'Trip details', direct: 'redirect', fallback: 'travel', parent: 'travel' });
  def('travelPassenger', '/travel/passenger',        { screen: 'travelPassenger', access: cap('canPurchase'), title: 'Passenger details', direct: 'redirect', fallback: 'travel', parent: 'travel' });
  def('travelTickets', '/travel/tickets',            { screen: 'travelTicket', access: cap('canPurchase'), title: 'My tickets', parent: 'travel' });
  def('hotels',        '/hotels',                    { screen: 'hotelSearch', title: 'Hotels', parent: 'travel' });
  def('hotelVoucher',  '/hotels/voucher',            { screen: 'hotelVoucher', access: cap('canPurchase'), title: 'Hotel voucher', direct: 'redirect', fallback: 'hotels', parent: 'hotels' });
  def('hotel',         '/hotels/:id',                { screen: 'hotelDetail', bind: { id: 'hotelSelectedId' }, enter: 'loadHotelDetail', title: 'Hotel', parent: 'hotels' });
  def('hotelBooking',  '/hotels/:id/book',           { screen: 'hotelBooking', bind: { id: 'hotelSelectedId' }, access: cap('canPurchase'), title: 'Book a room', direct: 'redirect', fallback: 'hotel', parent: 'hotel' });

  /* -- buying --------------------------------------------------------------- */
  def('cart',          '/cart',                      { screen: 'cart', title: 'Your bag', parent: 'marketplace' });
  def('checkout',      '/checkout',                  { screen: 'checkout', title: 'Checkout', parent: 'cart',
                                                       notes: 'Public at route level: the sign-in gate is at "Place order", as before.' });
  def('checkoutSuccess', '/checkout/success',        { screen: 'success', access: cap('canPurchase'), title: 'Order placed', direct: 'redirect', fallback: 'orders', parent: 'orders' });
  def('orders',        '/orders',                    { screen: 'orders', access: cap('canPurchase'), title: 'Your orders', enter: 'loadServerOrders', parent: 'account' });
  def('orderRefund',   '/orders/:id/refund',         { screen: 'refundRequest', bind: { id: 'currentOrder.id' }, enter: '_enterOrder', access: cap('canPurchase'), title: 'Request a refund', parent: 'order' });
  def('orderReview',   '/orders/:id/review',         { screen: 'writeReview', bind: { id: 'currentOrder.id' }, enter: '_enterOrder', access: cap('canPurchase'), title: 'Write a review', parent: 'order' });
  def('orderTracking', '/orders/:id/tracking',       { overlay: 'tracking', overlayArgs: { param: 'id', as: 'orderId' }, access: cap('canPurchase'), title: 'Track your delivery', parent: 'order' });
  def('order',         '/orders/:id',                { screen: 'orderDetail', bind: { id: 'currentOrder.id' }, enter: '_enterOrder', access: cap('canPurchase'), title: 'Order', parent: 'orders' });

  /* -- messages ------------------------------------------------------------- */
  def('chat',          '/chat',                      { screen: 'chat', access: cap('canPurchase'), title: 'Messages', parent: 'home' });
  def('chatAssistant', '/chat/assistant',            { screen: 'threadAi', access: cap('canPurchase'), title: 'LOUMOO assistant', direct: 'redirect', fallback: 'chat', parent: 'chat' });
  // A conversation with a boutique (or, for a seller, with a buyer). The thread is
  // fetched by its id, so a refresh or a link opened on another device lands on it;
  // the server answers 404 to anyone who is not one of its two participants.
  def('chatThread',    '/chat/:id',                  { screen: 'threadSeller', bind: { id: 'activeConversationId' }, enter: '_enterConversation', access: cap('canPurchase'), title: 'Conversation', parent: 'chat' });
  def('notifications', '/notifications',             { screen: 'notifications', access: cap('canPurchase'), title: 'Notifications', parent: 'home' });

  /* -- account -------------------------------------------------------------- */
  def('account',       '/account',                   { screen: 'accountDashboard', access: cap('canManageProfile'), title: 'Your account', parent: 'home' });
  def('profile',       '/account/profile',           { screen: 'profile', access: cap('canManageProfile'), title: 'Your profile', parent: 'account' });
  def('profileEdit',   '/account/profile/edit',      { screen: 'editProfile', access: cap('canManageProfile'), title: 'Edit profile', parent: 'profile' });
  def('addresses',     '/account/addresses',         { screen: 'addresses', access: cap('canManageProfile'), title: 'Addresses', parent: 'account' });
  def('addressNew',    '/account/addresses/new',     { screen: 'addAddress', access: cap('canManageProfile'), title: 'Add an address', parent: 'addresses' });
  def('addressEdit',   '/account/addresses/edit',    { screen: 'editAddress', access: cap('canManageProfile'), title: 'Edit address', direct: 'redirect', fallback: 'addresses', parent: 'addresses' });
  def('accountNotifications', '/account/notification-preferences', { screen: 'notificationPreferences', access: cap('canManageProfile'), title: 'Notification preferences', parent: 'account' });
  def('accountPrivacy', '/account/privacy',          { screen: 'privacySettings', access: cap('canManageProfile'), title: 'Privacy', parent: 'account' });
  def('accountSecurity', '/account/security',        { screen: 'securitySettings', access: cap('canManageProfile'), title: 'Security', parent: 'account' });
  def('followedStores', '/account/following',        { screen: 'followedStores', access: cap('canManageProfile'), title: 'Stores you follow', parent: 'account' });
  def('followedProviders', '/account/following/providers', { overlay: 'providerFollowed', access: cap('canPurchase'), title: 'Riders and agencies you follow', parent: 'followedStores' });
  def('activity',      '/account/activity',          { screen: 'userActivity', access: cap('canManageProfile'), title: 'Your activity', parent: 'account' });
  def('accountDelete', '/account/delete',            { screen: 'deleteAccount', access: cap('canManageProfile'), title: 'Delete account', parent: 'account' });
  def('saved',         '/account/saved',             { screen: 'saved', access: cap('canManageProfile'), title: 'Saved items', parent: 'account' });
  def('settings',      '/account/settings',          { screen: 'settings', title: 'Settings', parent: 'account' });
  def('transactions',  '/account/transactions',      { screen: 'transactions', access: cap('canPurchase'), title: 'Transactions', parent: 'account' });
  def('suspended',     '/account/suspended',         { screen: 'signIn', noSync: true, title: 'Account suspended', notes: 'Where the account state machine sends a suspended account (STATE_DESTINATION).' });

  /* -- sign-in & onboarding ------------------------------------------------- */
  def('signIn',        '/sign-in',                   { screen: 'signIn', title: 'Sign in', guestOnly: true });
  def('forgotPassword', '/forgot-password',          { screen: 'forgotPassword', title: 'Reset your password', parent: 'signIn' });
  def('resetPassword', '/reset-password',            { screen: 'resetPassword', title: 'Choose a new password', direct: 'redirect', fallback: 'forgotPassword', parent: 'signIn' });
  def('verify',        '/verify',                    { screen: 'verifyEmail', title: 'Verify your email', parent: 'signIn' });
  def('onboarding',    '/onboarding',                { screen: 'onboardWelcome', title: 'Create your LOUMOO account' });
  def('onboardType',   '/onboarding/type',           { screen: 'onboardType', title: 'Onboarding', direct: 'redirect', fallback: 'onboarding', parent: 'onboarding' });
  def('onboardIdentity', '/onboarding/identity',     { screen: 'onboardIdentity', title: 'Onboarding — identity', direct: 'redirect', fallback: 'onboarding', parent: 'onboarding' });
  def('onboardOtp',    '/onboarding/code',           { screen: 'onboardOtp', title: 'Onboarding — confirm your code', direct: 'redirect', fallback: 'onboarding', parent: 'onboarding' });
  def('onboardAdaptive', '/onboarding/profile',      { screen: 'onboardAdaptive', title: 'Onboarding — profile', direct: 'redirect', fallback: 'onboarding', parent: 'onboarding' });
  def('onboardBuyer',  '/onboarding/buyer',          { screen: 'onboardBuyer', title: 'Onboarding — buyer', direct: 'redirect', fallback: 'onboarding', parent: 'onboarding' });
  def('onboardSeller', '/onboarding/seller',         { screen: 'onboardSeller', title: 'Onboarding — seller', direct: 'redirect', fallback: 'onboarding', parent: 'onboarding' });
  def('onboardBusiness', '/onboarding/business',     { screen: 'onboardBusiness', title: 'Onboarding — business', direct: 'redirect', fallback: 'onboarding', parent: 'onboarding' });
  def('onboardVerify', '/onboarding/verification',   { screen: 'onboardVerify', title: 'Onboarding — verification', direct: 'redirect', fallback: 'onboarding', parent: 'onboarding' });
  def('onboardReview', '/onboarding/review',         { screen: 'onboardReview', title: 'Onboarding — review', direct: 'redirect', fallback: 'onboarding', parent: 'onboarding' });
  def('onboardSuccess', '/onboarding/done',          { screen: 'onboardSuccess', title: 'Welcome to LOUMOO', direct: 'redirect', fallback: 'home' });

  /* -- selling -------------------------------------------------------------- */
  def('sell',          '/sell',                      { screen: 'seller', access: SELLER, title: 'Seller workspace', parent: 'home' });
  def('sellListings',  '/sell/listings',             { screen: 'myListings', access: SELLER, title: 'Your listings', parent: 'sell' });
  def('sellDeliveries', '/sell/deliveries',          { overlay: 'sellerDispatch', access: SELLER, title: 'Deliveries', parent: 'sell' });
  def('sellDelivery',  '/sell/deliveries/:orderId',  { overlay: 'sellerDispatch', overlayArgs: { param: 'orderId', as: 'orderId' }, access: SELLER, title: 'Arrange a delivery', parent: 'sellDeliveries' });
  def('sellOrder',     '/sell/orders/:id',           { screen: 'sellerOrderDetail', bind: { id: 'currentOrder.id' }, access: SELLER, title: 'Seller order', direct: 'redirect', fallback: 'sell', parent: 'sell' });
  def('sellPayouts',   '/sell/payouts',              { screen: 'sellerPayouts', access: SELLER, title: 'Payouts', parent: 'sell' });
  def('sellAnalytics', '/sell/analytics',            { screen: 'storeAnalytics', access: cap('canManageStore'), title: 'Store analytics', parent: 'sell' });
  def('sellSettings',  '/sell/settings',             { screen: 'storeSettings', access: cap('canManageStore'), title: 'Store settings', parent: 'sell' });
  def('sellVerification', '/sell/verification',      { screen: 'storeVerification', access: cap('canManageStore'), title: 'Store verification', parent: 'sell' });
  def('sellOnboarding', '/sell/onboarding',          { screen: 'storeOnboarding', access: cap('canStartSelling'), title: 'Activate your boutique', parent: 'sell' });
  def('sellCreateStore', '/sell/create-store',       { screen: 'createStore', access: cap('canStartSelling'), title: 'Create your boutique', parent: 'sell' });
  def('publish',       '/sell/new',                  { screen: 'publishIntent', access: SELLER, title: 'Publish a listing', parent: 'sell' });
  def('publishStudio', '/sell/new/studio',           { screen: 'publishStudio', access: SELLER, title: 'Publishing studio', direct: 'redirect', fallback: 'publish', parent: 'publish' });
  def('publishReview', '/sell/new/review',           { screen: 'publishReview', access: SELLER, title: 'Review your listing', direct: 'redirect', fallback: 'publish', parent: 'publish' });
  def('publishSuccess', '/sell/new/done',            { screen: 'publishSuccess', access: SELLER, title: 'Listing published', direct: 'redirect', fallback: 'sellListings', parent: 'publish' });

  /* -- delivery ------------------------------------------------------------- */
  def('rider',         '/rider',                     { overlay: 'rider', access: cap('canPurchase'), title: 'Rider deliveries', parent: 'account',
                                                       notes: 'Being a rider is a registration, not a role: the server decides, and a non-rider is shown how to become one.' });
  def('delivery',      '/delivery/:id',              { overlay: 'tracking', overlayArgs: { param: 'id', as: 'deliveryId' }, access: cap('canPurchase'), title: 'Delivery tracking', parent: 'orders' });
  def('provider',      '/providers/:id',             { overlay: 'providerProfile', overlayArgs: { param: 'id', as: 'providerId', query: { city: 'city' } }, access: cap('canPurchase'), title: 'Delivery provider', parent: 'home' });

  /* -- administration ------------------------------------------------------- */
  def('admin',         '/admin',                     { page: '/superadmin/index.html', access: role('admin', 'super_admin'), title: 'Administration',
                                                       notes: 'The standalone control center (SuperAdmin/frontend), served as its own document.' });
  def('superadmin',    '/superadmin',                { page: '/superadmin/index.html', access: role('super_admin'), title: 'Super administration',
                                                       notes: 'Same control center; the page itself refuses anything below super_admin.' });
  def('adminRiders',   '/admin/riders',              { overlay: 'ridersAdmin', access: role('admin', 'super_admin'), title: 'Riders administration', parent: 'admin' });

  /* -- named areas that are NOT products yet (documented, never faked) ------- */
  def('markethub',     '/markethub',                 { kind: 'unavailable', status: 'not-implemented', title: 'MarketHub',
                                                       notes: 'No MarketHub product exists in this repository (no screen, module, API or schema).' });
  def('agency',        '/agency',                    { kind: 'unavailable', status: 'not-implemented', title: 'Agency workspace',
                                                       notes: 'Agencies exist only as delivery-provider records; delegation is a button inside the seller order screen. There is no agency workspace.' });

  /* ------------------------------------------------------------- legacy paths */
  // Valid URLs from before this registry, or hints the backend already hands out.
  // Each redirects to its canonical route and keeps the query string.
  var ALIASES = Object.freeze([
    { from: '/index.html',               to: '/' },
    { from: '/app',                      to: '/' },
    { from: '/Commerce App.dc.html',     to: '/' },
    { from: '/seller',                   to: '/sell' },
    { from: '/seller/onboarding',        to: '/sell/onboarding' },
    { from: '/seller/create-store',      to: '/sell/create-store' },
    { from: '/login',                    to: '/sign-in' },
    { from: '/signin',                   to: '/sign-in' },
    { from: '/signup',                   to: '/onboarding' },
    { from: '/sign-up',                  to: '/onboarding' },
    // Links the app itself used to generate when a seller shared or opened a publication
    // (sharePublication, the publishing studio's success cards). They never had a page; sellers
    // have already sent them, so they redirect to where those records actually live.
    { from: '/listing/:id',              to: '/product/:id' },
    { from: '/announce/:id',             to: '/announcements/:id' },
    // The old mock seller thread's URL. Threads now live at /chat/:id.
    { from: '/chat/seller',              to: '/chat' }
  ]);

  /* --------------------------------------------------- screens with no URL */
  // Every key of the shell's SCREENS list is either routed above or listed here
  // with the reason. tests/unit/routing_registry.test.js enforces both directions,
  // so a new screen cannot be added to the shell without a deliberate decision.
  var UNROUTED_SCREENS = Object.freeze({
    loading: 'A transient spinner state, not a place.',
    networkError: 'A transient error state, not a place.',
    notFound: 'Rendered by the router for any URL that has no route; it keeps the visitor\'s URL.',
    superAdmin: 'Legacy in-shell prototype of the control center. It ships seeded demo data and has no entry point; the real control center is the standalone page at /admin and /superadmin.',
    sellerPublicPage: 'Prototype with no data loader (publicSeller is never populated). The public storefront is /store/:slug.',
    publicUserProfile: 'Prototype with no data loader and no entry point (publicUser is never populated).'
  });

  /* -------------------------------------------------------------- compilation */
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function compile(route) {
    var names = [];
    var segs = route.path.split('/').slice(1);
    var src = segs.map(function (s) {
      if (s.charAt(0) === ':') { names.push(s.slice(1)); return '(' + PARAM_RE + ')'; }
      return escapeRe(s);
    }).join('/');
    var statics = segs.filter(function (s) { return s.charAt(0) !== ':'; }).length;
    return {
      names: names,
      re: new RegExp('^/' + src + '$'),
      reCI: new RegExp('^/' + src + '$', 'i'),
      // Specificity: more static segments first, then the longer path, so
      // '/hotels/voucher' beats '/hotels/:id' and '/orders/:id/tracking' beats '/orders/:id'.
      weight: statics * 1000 + segs.length * 10 - names.length
    };
  }

  var ROUTES = DEFS.map(function (d) {
    var c = compile(d);
    d.params = c.names;
    d._re = c.re; d._reCI = c.reCI; d._weight = c.weight;
    return d;
  });
  var BY_ID = {};
  ROUTES.forEach(function (r) {
    if (BY_ID[r.id]) throw new Error('duplicate route id: ' + r.id);
    BY_ID[r.id] = r;
  });
  var ORDERED = ROUTES.slice().sort(function (a, b) { return b._weight - a._weight; });
  // Aliases may carry parameters ('/listing/:id' -> '/product/:id').
  var ALIAS_MATCHERS = ALIASES.map(function (a) { return { alias: a, c: compile({ path: a.from }) }; });

  /* ----------------------------------------------------------------- helpers */
  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (e) { return null; }
  }

  /** '/a//b/' -> '/a/b'; '' -> '/'. Never lower-cases, never touches the query. */
  function normalizePath(p) {
    p = String(p == null ? '' : p);
    var q = p.search(/[?#]/);
    if (q !== -1) p = p.slice(0, q);
    if (p.charAt(0) !== '/') p = '/' + p;
    p = p.replace(/\/{2,}/g, '/');
    if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
    return p;
  }

  /** A path whose last segment has an extension is a file request, never an app route. */
  function isFileLike(pathname) {
    var last = normalizePath(pathname).split('/').pop() || '';
    return /\.[A-Za-z0-9]{1,12}$/.test(last);
  }

  function parseUrl(u) {
    u = String(u == null ? '' : u);
    var hash = '', search = '';
    var h = u.indexOf('#');
    if (h !== -1) { hash = u.slice(h); u = u.slice(0, h); }
    var q = u.indexOf('?');
    if (q !== -1) { search = u.slice(q); u = u.slice(0, q); }
    return { pathname: normalizePath(u), search: search, hash: hash };
  }

  function exact(pathname) {
    for (var i = 0; i < ORDERED.length; i++) {
      var m = ORDERED[i]._re.exec(pathname);
      if (m) return { route: ORDERED[i], match: m };
    }
    return null;
  }

  function paramsFrom(route, m) {
    var params = {};
    for (var i = 0; i < route.params.length; i++) {
      var v = safeDecode(m[i + 1]);
      if (v === null) return null;
      params[route.params[i]] = v;
    }
    return params;
  }

  /** Exact (case-sensitive) match of a canonical path. */
  function match(pathname) {
    var hit = exact(normalizePath(pathname));
    if (!hit) return null;
    var params = paramsFrom(hit.route, hit.match);
    return params ? { route: hit.route, params: params } : null;
  }

  function build(id, params, query) {
    var r = BY_ID[id];
    if (!r) return null;
    params = params || {};
    var segs = r.path.split('/').slice(1).map(function (s) {
      if (s.charAt(0) !== ':') return s;
      var v = params[s.slice(1)];
      if (v == null || v === '') return null;
      v = String(v);
      return new RegExp('^' + PARAM_RE + '$').test(v) ? encodeURIComponent(v) : null;
    });
    if (segs.some(function (s) { return s === null; })) return null;
    var path = '/' + segs.join('/');
    var qs = '';
    if (query && typeof query === 'object') {
      var parts = [];
      Object.keys(query).forEach(function (k) {
        if (query[k] == null || query[k] === '') return;
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(query[k])));
      });
      if (parts.length) qs = '?' + parts.join('&');
    }
    return path + qs;
  }

  /**
   * What a URL means.
   *   { type: 'route', route, params }
   *   { type: 'unavailable', route }            a documented, unbuilt area
   *   { type: 'redirect', to, reason }          legacy alias / casing / trailing-slash fix
   *   { type: 'file' }                          looks like a file: not an app route
   *   { type: 'notfound' }
   * `search` is carried through redirects untouched.
   */
  function resolve(input) {
    var u = parseUrl(input);
    var p = u.pathname;
    var tail = u.search;

    for (var i = 0; i < ALIAS_MATCHERS.length; i++) {
      var am = ALIAS_MATCHERS[i];
      if (am.c.names.length === 0) {
        if (am.alias.from.toLowerCase() === p.toLowerCase() || am.alias.from.toLowerCase() === (safeDecode(p) || '').toLowerCase()) {
          return { type: 'redirect', to: am.alias.to + tail, reason: 'legacy' };
        }
      } else {
        var hit = am.c.reCI.exec(p);
        if (hit) {
          var values = {};
          am.c.names.forEach(function (n, k) { values[n] = hit[k + 1]; });
          var to = am.alias.to.replace(/:([A-Za-z]+)/g, function (_, n) { return values[n]; });
          return { type: 'redirect', to: to + tail, reason: 'legacy' };
        }
      }
    }

    var hit = exact(p);
    if (hit) {
      var params = paramsFrom(hit.route, hit.match);
      if (!params) return { type: 'notfound' };
      if (hit.route.kind === 'unavailable') return { type: 'unavailable', route: hit.route, params: params };
      return { type: 'route', route: hit.route, params: params };
    }

    if (isFileLike(p)) return { type: 'file' };

    // Wrong casing of the static segments ('/Rider') is a typo, not a missing page.
    for (var j = 0; j < ORDERED.length; j++) {
      var m = ORDERED[j]._reCI.exec(p);
      if (m) {
        var ps = paramsFrom(ORDERED[j], m);
        if (!ps) break;
        var canonical = build(ORDERED[j].id, ps);
        if (canonical && canonical !== p) return { type: 'redirect', to: canonical + tail, reason: 'case' };
      }
    }
    return { type: 'notfound' };
  }

  function getByPath(obj, path) {
    var cur = obj;
    var keys = path.split('.');
    for (var i = 0; i < keys.length; i++) {
      if (cur == null) return undefined;
      cur = cur[keys[i]];
    }
    return cur;
  }

  /**
   * The route (and its path) that represents a shell state, or null when the
   * screen has no URL. Used to keep the address bar in step with `state.screen`.
   * @param {string} screen
   * @param {object} state  the shell state (read-only)
   */
  function forState(screen, state) {
    state = state || {};
    var best = null;
    for (var i = 0; i < ROUTES.length; i++) {
      var r = ROUTES[i];
      if (r.kind !== 'screen' || r.screen !== screen || r.noSync) continue;
      if (r.fixed) {
        var ok = Object.keys(r.fixed).every(function (k) { return getByPath(state, k) === r.fixed[k]; });
        if (!ok) continue;
      }
      var params = {};
      var complete = true;
      if (r.bind) {
        Object.keys(r.bind).forEach(function (name) {
          var v = getByPath(state, r.bind[name]);
          if (v == null || v === '') complete = false; else params[name] = String(v);
        });
      }
      var path = complete ? build(r.id, params) : null;
      if (path) { best = { route: r, params: params, path: path }; break; }
      // A parameterised screen with no value yet (e.g. 'business' before a store is chosen)
      // falls back to its parent listing so the address bar never lies.
      if (!best && r.parent && BY_ID[r.parent]) {
        var pp = build(r.parent, {});
        if (pp) best = { route: BY_ID[r.parent], params: {}, path: pp, degraded: true };
      }
    }
    return best;
  }

  /**
   * A post-sign-in destination is only honoured when it is a same-origin path
   * that names a real, non-auth route. Anything else — absolute URLs, '//host',
   * backslashes, control characters, unknown paths, the sign-in screens
   * themselves — is dropped, so the value can never be an open redirect or a loop.
   * @returns {string|null} the normalised '/path?query' to navigate to
   */
  function safeReturnTo(value) {
    if (typeof value !== 'string' || !value || value.length > 2048) return null;
    if (value.charAt(0) !== '/' || value.charAt(1) === '/' || value.indexOf('\\') !== -1) return null;
    if (/[\u0000-\u001f\u007f]/.test(value)) return null;
    var u = parseUrl(value);
    var r = resolve(u.pathname);
    if (r.type === 'redirect') { u = parseUrl(r.to); r = resolve(u.pathname); }
    if (r.type !== 'route') return null;
    if (AUTH_ROUTE_IDS.indexOf(r.route.id) !== -1 || r.route.kind === 'unavailable') return null;
    var search = /^\?[A-Za-z0-9_\-.~%&=+,:;@!$'()*\/]*$/.test(u.search) ? u.search : '';
    return u.pathname + search;
  }

  var AUTH_ROUTE_IDS = Object.freeze(['signIn', 'forgotPassword', 'resetPassword', 'verify', 'suspended', 'onboarding',
    'onboardType', 'onboardIdentity', 'onboardOtp', 'onboardAdaptive', 'onboardBuyer', 'onboardSeller', 'onboardBusiness',
    'onboardVerify', 'onboardReview', 'onboardSuccess']);

  /** Screens the registry routes (kind 'screen'). */
  function routedScreens() {
    var out = {};
    ROUTES.forEach(function (r) { if (r.kind === 'screen' && r.screen) out[r.screen] = true; });
    return Object.keys(out);
  }

  /** One entry per distinct pattern, for the generators and the tests. */
  function patterns() {
    return ROUTES.map(function (r) {
      return { id: r.id, path: r.path, kind: r.kind, access: r.access, page: r.page };
    });
  }

  return Object.freeze({
    ORIGIN: ORIGIN,
    PARAM_RE: PARAM_RE,
    routes: Object.freeze(ROUTES),
    aliases: ALIASES,
    unroutedScreens: UNROUTED_SCREENS,
    authRouteIds: AUTH_ROUTE_IDS,
    byId: function (id) { return BY_ID[id] || null; },
    normalizePath: normalizePath,
    parseUrl: parseUrl,
    isFileLike: isFileLike,
    match: match,
    resolve: resolve,
    build: build,
    forState: forState,
    safeReturnTo: safeReturnTo,
    routedScreens: routedScreens,
    patterns: patterns,
    access: { PUBLIC: PUBLIC, SELLER: SELLER, capability: cap, role: role }
  });
});
