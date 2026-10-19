/**
 * LOUMOO SuperAdmin — SuperAdminOrdersController
 * ---------------------------------------------------------------------------
 * Handles transaction monitoring, order inspection, and administrative escrow
 * dispute arbitration (fund release, refund, or security hold).
 */

const SuperAdminService = require('../services/SuperAdminService');
const { clientIp } = require('../utils/clientIp');

class SuperAdminOrdersController {
  static async listOrders(req, res, next) {
    try {
      const status = req.query.status || null;
      const escrowStatus = req.query.escrowStatus || req.query.escrow_status || null;
      const search = req.query.search || null;
      const limit = parseInt(req.query.limit, 10) || 50;
      const offset = parseInt(req.query.offset, 10) || 0;

      const orders = await SuperAdminService.listOrders({ status, escrowStatus, search, limit, offset });
      res.json({
        success: true,
        data: {
          orders,
          count: orders.length,
          limit,
          offset
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getOrder(req, res, next) {
    try {
      const { id } = req.params;
      const order = await SuperAdminService.getOrderDetail(id);
      res.json({
        success: true,
        data: { order }
      });
    } catch (err) {
      next(err);
    }
  }

  static async resolveEscrow(req, res, next) {
    try {
      const { id } = req.params;
      const actionOrPayload = req.body;
      const adminId = (req.principal && req.principal.id) || 'super_admin';
      const ipAddress = clientIp(req);

      const order = await SuperAdminService.resolveEscrow(id, actionOrPayload, {
        adminId,
        reason: req.body.reason || null,
        ipAddress
      });

      res.json({
        success: true,
        message: `Escrow for order ${id} resolved (${order.escrow_status}).`,
        data: { order }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = SuperAdminOrdersController;
