/**
 * LOUMOO SuperAdmin — Master Router
 * ---------------------------------------------------------------------------
 * Mounts all administrative and zero-code platform control endpoints.
 */

const express = require('express');
const router = express.Router();

const { requireModeratorRole, requireSuperAdminRole, requireSuperAdminOnly } = require('../middleware/superAdminGuard');
const SuperAdminSettingsController = require('../controllers/SuperAdminSettingsController');
const SuperAdminOverviewController = require('../controllers/SuperAdminOverviewController');
const SuperAdminStoresController = require('../controllers/SuperAdminStoresController');
const SuperAdminListingsController = require('../controllers/SuperAdminListingsController');
const SuperAdminUsersController = require('../controllers/SuperAdminUsersController');
const SuperAdminOrdersController = require('../controllers/SuperAdminOrdersController');

// RBAC tiers (docs/ROUTING.md):
//   • base            requireModeratorRole  — moderator | admin | super_admin
//   • requireSuperAdminRole                 — admin | super_admin
//   • requireSuperAdminOnly                 — super_admin (platform owner)
// The base gate authenticates every request and admits trust-and-safety staff
// (moderators) to content moderation only — reviewing/moderating listings and
// stores. Settings, identity governance (KYC, roles), escrow, audit logs and
// the owner-only actions each stack a stronger gate below.
router.use(requireModeratorRole);

// System Overview, Deep Health & Real-time Metrics (admin+: exposes financial KPIs)
router.get('/overview', requireSuperAdminRole, SuperAdminOverviewController.getOverview);
router.get('/health/deep', requireSuperAdminRole, SuperAdminOverviewController.getDeepHealth);

// Emergency Platform Maintenance Toggle (owner only)
router.post('/maintenance', requireSuperAdminOnly, SuperAdminSettingsController.setMaintenance);

// Stores & Merchant KYC Moderation (Phase 2)
router.get('/stores', SuperAdminStoresController.listStores);                     // moderator+
router.get('/stores/:id', SuperAdminStoresController.getStore);                   // moderator+
router.patch('/stores/:id', SuperAdminStoresController.moderateStore);            // moderator+ (content moderation)
router.post('/stores/:id/verify-kyc', requireSuperAdminRole, SuperAdminStoresController.verifyKyc);  // admin+ (identity governance)
router.post('/stores/:id/reject-kyc', requireSuperAdminRole, SuperAdminStoresController.rejectKyc);  // admin+
router.post('/stores/:id/suspend', SuperAdminStoresController.suspend);           // moderator+
router.post('/stores/:id/reactivate', SuperAdminStoresController.reactivate);     // moderator+

// Listings & Catalog Moderation (Phase 3) — moderator+
router.get('/listings', SuperAdminListingsController.listListings);
router.get('/listings/:id', SuperAdminListingsController.getListing);
router.post('/listings/:id/moderate', SuperAdminListingsController.moderateListing);
router.patch('/listings/:id', SuperAdminListingsController.moderateListing);

// Users & Identity Governance (Phase 3)
router.get('/users', SuperAdminUsersController.listUsers);                        // moderator+ (review)
router.get('/users/:id', SuperAdminUsersController.getUser);                      // moderator+ (review)
router.patch('/users/:id', requireSuperAdminRole, SuperAdminUsersController.updateUser);               // admin+
router.patch('/users/:id/role', requireSuperAdminOnly, SuperAdminUsersController.updateUserRole);      // owner only
router.put('/users/:id/role', requireSuperAdminOnly, SuperAdminUsersController.updateUserRole);
router.patch('/users/:id/kyc', requireSuperAdminRole, SuperAdminUsersController.updateUserKyc);        // admin+
router.put('/users/:id/kyc', requireSuperAdminRole, SuperAdminUsersController.updateUserKyc);

// Orders & Escrow Arbitration (Phase 3)
router.get('/orders', SuperAdminOrdersController.listOrders);                     // moderator+ (view)
router.get('/orders/:id', SuperAdminOrdersController.getOrder);                   // moderator+ (view)
router.post('/orders/:id/escrow', requireSuperAdminRole, SuperAdminOrdersController.resolveEscrow);    // admin+ (financial)

// Dynamic System Settings & Configuration (admin+ to read; owner to write)
router.get('/config', requireSuperAdminRole, SuperAdminSettingsController.getAll);
router.get('/settings/categories', requireSuperAdminRole, SuperAdminSettingsController.getCategories);
router.get('/settings/category/:category', requireSuperAdminRole, SuperAdminSettingsController.getByCategory);
router.post('/settings/reset/:key', requireSuperAdminOnly, SuperAdminSettingsController.resetByKey);
router.get('/settings', requireSuperAdminRole, SuperAdminSettingsController.getAll);
router.put('/settings', requireSuperAdminOnly, SuperAdminSettingsController.updateSettings);
router.patch('/settings', requireSuperAdminOnly, SuperAdminSettingsController.updateSettings);
router.get('/settings/:key', requireSuperAdminRole, SuperAdminSettingsController.getByKey);
router.put('/settings/:key', requireSuperAdminOnly, SuperAdminSettingsController.updateByKey);

// Immutable Administrative Audit Logs & Export (admin+)
router.get('/audit-logs/actions', requireSuperAdminRole, SuperAdminOverviewController.getAuditActions);
router.get('/audit-logs/export', requireSuperAdminRole, SuperAdminOverviewController.exportAuditLogs);
router.get('/audit-logs', requireSuperAdminRole, SuperAdminOverviewController.getAuditLogs);

module.exports = router;
