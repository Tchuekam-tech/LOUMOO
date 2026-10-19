/**
 * LOUMOO SuperAdmin — SuperAdminStoresController
 * ---------------------------------------------------------------------------
 * Handles administrative inspection, 1-click KYC verification, tier badge
 * assignment, and store suspension / reactivation.
 */

const SuperAdminService = require('../services/SuperAdminService');
const { clientIp } = require('../utils/clientIp');

class SuperAdminStoresController {
  static async listStores(req, res, next) {
    try {
      const status = req.query.status || null;
      const tier = req.query.tier || null;
      const search = req.query.search || null;
      const limit = parseInt(req.query.limit, 10) || 50;
      const offset = parseInt(req.query.offset, 10) || 0;

      const stores = await SuperAdminService.listStores({ status, tier, search, limit, offset });
      res.json({
        success: true,
        data: {
          stores,
          count: stores.length,
          limit,
          offset
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getStore(req, res, next) {
    try {
      const { id } = req.params;
      const store = await SuperAdminService.getStoreDetail(id);
      res.json({
        success: true,
        data: { store }
      });
    } catch (err) {
      next(err);
    }
  }

  static async moderateStore(req, res, next) {
    try {
      const { id } = req.params;
      const updates = req.body;
      const adminId = (req.principal && req.principal.id) || 'super_admin';
      const ipAddress = clientIp(req);

      const store = await SuperAdminService.moderateStore(id, updates, {
        adminId,
        reason: req.body.reason || null,
        ipAddress
      });

      res.json({
        success: true,
        message: `Store [${store.name || id}] updated successfully.`,
        data: { store }
      });
    } catch (err) {
      next(err);
    }
  }

  static async verifyKyc(req, res, next) {
    try {
      const { id } = req.params;
      const tier = req.body.tier || 'pro_merchant';
      const reason = req.body.reason || 'Store KYC verified by SuperAdmin';
      const adminId = (req.principal && req.principal.id) || 'super_admin';
      const ipAddress = clientIp(req);

      const store = await SuperAdminService.verifyStoreKyc(id, { tier, reason }, {
        adminId,
        ipAddress
      });

      res.json({
        success: true,
        message: `Store [${store.name || id}] KYC approved as ${tier}.`,
        data: { store }
      });
    } catch (err) {
      next(err);
    }
  }

  static async rejectKyc(req, res, next) {
    try {
      const { id } = req.params;
      const reason = req.body.reason || 'KYC documentation insufficient';
      const adminId = (req.principal && req.principal.id) || 'super_admin';
      const ipAddress = clientIp(req);

      const store = await SuperAdminService.rejectStoreKyc(id, { reason }, {
        adminId,
        ipAddress
      });

      res.json({
        success: true,
        message: `Store [${store.name || id}] KYC rejected.`,
        data: { store }
      });
    } catch (err) {
      next(err);
    }
  }

  static async suspend(req, res, next) {
    try {
      const { id } = req.params;
      const reason = req.body.reason || 'Store suspended by SuperAdmin';
      const adminId = (req.principal && req.principal.id) || 'super_admin';
      const ipAddress = clientIp(req);

      const store = await SuperAdminService.suspendStore(id, { reason }, {
        adminId,
        ipAddress
      });

      res.json({
        success: true,
        message: `Store [${store.name || id}] suspended.`,
        data: { store }
      });
    } catch (err) {
      next(err);
    }
  }

  static async reactivate(req, res, next) {
    try {
      const { id } = req.params;
      const reason = req.body.reason || 'Store reactivated by SuperAdmin';
      const adminId = (req.principal && req.principal.id) || 'super_admin';
      const ipAddress = clientIp(req);

      const store = await SuperAdminService.reactivateStore(id, { reason }, {
        adminId,
        ipAddress
      });

      res.json({
        success: true,
        message: `Store [${store.name || id}] reactivated successfully.`,
        data: { store }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = SuperAdminStoresController;
