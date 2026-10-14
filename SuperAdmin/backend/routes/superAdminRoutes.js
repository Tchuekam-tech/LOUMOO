/**
 * LOUMOO SuperAdmin — Master Router
 * ---------------------------------------------------------------------------
 * Mounts all administrative and zero-code platform control endpoints.
 */

const express = require('express');
const router = express.Router();

const { requireSuperAdminRole, requireSuperAdminOnly } = require('../middleware/superAdminGuard');
const SuperAdminSettingsController = require('../controllers/SuperAdminSettingsController');
const SuperAdminOverviewController = require('../controllers/SuperAdminOverviewController');
const SuperAdminStoresController = require('../controllers/SuperAdminStoresController');
const SuperAdminListingsController = require('../controllers/SuperAdminListingsController');
const SuperAdminUsersController = require('../controllers/SuperAdminUsersController');
const SuperAdminOrdersController = require('../controllers/SuperAdminOrdersController');

// All admin endpoints strictly enforce RBAC: an authenticated `admin` or `super_admin`.
// The few operations that decide who owns the platform, or how it behaves for everyone,
// additionally require `super_admin` (requireSuperAdminOnly) - see docs/ROUTING.md.
router.use(requireSuperAdminRole);

// System Overview, Deep Health & Real-time Metrics
router.get('/overview', SuperAdminOverviewController.getOverview);
router.get('/health/deep', SuperAdminOverviewController.getDeepHealth);

// Emergency Platform Maintenance Toggle
router.post('/maintenance', requireSuperAdminOnly, SuperAdminSettingsController.setMaintenance);

// Stores & Merchant KYC Moderation (Phase 2)
router.get('/stores', SuperAdminStoresController.listStores);
router.get('/stores/:id', SuperAdminStoresController.getStore);
router.patch('/stores/:id', SuperAdminStoresController.moderateStore);
router.post('/stores/:id/verify-kyc', SuperAdminStoresController.verifyKyc);
router.post('/stores/:id/reject-kyc', SuperAdminStoresController.rejectKyc);
router.post('/stores/:id/suspend', SuperAdminStoresController.suspend);
router.post('/stores/:id/reactivate', SuperAdminStoresController.reactivate);

// Listings & Catalog Moderation (Phase 3)
router.get('/listings', SuperAdminListingsController.listListings);
router.get('/listings/:id', SuperAdminListingsController.getListing);
router.post('/listings/:id/moderate', SuperAdminListingsController.moderateListing);
router.patch('/listings/:id', SuperAdminListingsController.moderateListing);

// Users & Identity Governance (Phase 3)
router.get('/users', SuperAdminUsersController.listUsers);
router.get('/users/:id', SuperAdminUsersController.getUser);
router.patch('/users/:id', SuperAdminUsersController.updateUser);
router.patch('/users/:id/role', requireSuperAdminOnly, SuperAdminUsersController.updateUserRole);
router.put('/users/:id/role', requireSuperAdminOnly, SuperAdminUsersController.updateUserRole);
router.patch('/users/:id/kyc', SuperAdminUsersController.updateUserKyc);
router.put('/users/:id/kyc', SuperAdminUsersController.updateUserKyc);

// Orders & Escrow Arbitration (Phase 3)
router.get('/orders', SuperAdminOrdersController.listOrders);
router.get('/orders/:id', SuperAdminOrdersController.getOrder);
router.post('/orders/:id/escrow', SuperAdminOrdersController.resolveEscrow);

// Dynamic System Settings & Configuration (Zero-Code Platform Control)
router.get('/config', SuperAdminSettingsController.getAll);
router.get('/settings/categories', SuperAdminSettingsController.getCategories);
router.get('/settings/category/:category', SuperAdminSettingsController.getByCategory);
router.post('/settings/reset/:key', requireSuperAdminOnly, SuperAdminSettingsController.resetByKey);
router.get('/settings', SuperAdminSettingsController.getAll);
router.put('/settings', requireSuperAdminOnly, SuperAdminSettingsController.updateSettings);
router.patch('/settings', requireSuperAdminOnly, SuperAdminSettingsController.updateSettings);
router.get('/settings/:key', SuperAdminSettingsController.getByKey);
router.put('/settings/:key', requireSuperAdminOnly, SuperAdminSettingsController.updateByKey);

// Immutable Administrative Audit Logs & Export
router.get('/audit-logs/actions', SuperAdminOverviewController.getAuditActions);
router.get('/audit-logs/export', SuperAdminOverviewController.exportAuditLogs);
router.get('/audit-logs', SuperAdminOverviewController.getAuditLogs);

module.exports = router;
