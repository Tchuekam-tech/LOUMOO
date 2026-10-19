/**
 * LOUMOO SuperAdmin — SuperAdminOverviewController
 * ---------------------------------------------------------------------------
 * Handles HTTP requests for high-level system analytics and audit trail events.
 */

const SuperAdminService = require('../services/SuperAdminService');
const { ValidationError } = require('../../../server/shared/errors/AppError');
const { clientIp } = require('../utils/clientIp');

class SuperAdminOverviewController {
  static async getOverview(req, res, next) {
    try {
      const overview = await SuperAdminService.getOverviewMetrics();
      res.json({
        success: true,
        data: overview
      });
    } catch (err) {
      next(err);
    }
  }

  static async getAuditLogs(req, res, next) {
    try {
      if (req.query.limit !== undefined) {
        const parsedLimit = parseInt(req.query.limit, 10);
        if (isNaN(parsedLimit) || parsedLimit < 1) {
          throw new ValidationError('Query parameter [limit] must be a positive integer.');
        }
      }
      if (req.query.offset !== undefined) {
        const parsedOffset = parseInt(req.query.offset, 10);
        if (isNaN(parsedOffset) || parsedOffset < 0) {
          throw new ValidationError('Query parameter [offset] must be a non-negative integer.');
        }
      }
      if (req.query.startDate && isNaN(new Date(req.query.startDate).getTime())) {
        throw new ValidationError('Invalid query parameter [startDate]. Expected ISO-8601 date string.');
      }
      if (req.query.endDate && isNaN(new Date(req.query.endDate).getTime())) {
        throw new ValidationError('Invalid query parameter [endDate]. Expected ISO-8601 date string.');
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const resourceType = req.query.resourceType || null;
      const action = req.query.action || null;
      const adminId = req.query.adminId || null;
      const resourceId = req.query.resourceId || null;
      const startDate = req.query.startDate || null;
      const endDate = req.query.endDate || null;
      const search = req.query.search || req.query.q || null;

      const logs = await SuperAdminService.getAuditLogs({
        limit,
        offset,
        resourceType,
        action,
        adminId,
        resourceId,
        startDate,
        endDate,
        search
      });

      const totalCount = logs.totalCount !== undefined ? logs.totalCount : logs.length;
      const totalPages = logs.totalPages !== undefined ? logs.totalPages : Math.ceil(totalCount / limit) || 1;

      res.json({
        success: true,
        data: {
          logs,
          count: logs.length,
          totalCount,
          totalPages,
          limit,
          offset,
          filters: logs.filters || { resourceType, action, adminId, resourceId, startDate, endDate, search }
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getAuditActions(req, res, next) {
    try {
      const actions = await SuperAdminService.getAuditActions();
      res.json({
        success: true,
        data: {
          actions,
          count: actions.length
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async exportAuditLogs(req, res, next) {
    try {
      const format = (req.query.format || 'csv').toLowerCase();
      if (format !== 'csv' && format !== 'json') {
        throw new ValidationError('Unsupported export format. Supported formats are "csv" and "json".');
      }
      if (req.query.startDate && isNaN(new Date(req.query.startDate).getTime())) {
        throw new ValidationError('Invalid query parameter [startDate]. Expected ISO-8601 date string.');
      }
      if (req.query.endDate && isNaN(new Date(req.query.endDate).getTime())) {
        throw new ValidationError('Invalid query parameter [endDate]. Expected ISO-8601 date string.');
      }

      const resourceType = req.query.resourceType || null;
      const action = req.query.action || null;
      const adminId = req.query.adminId || null;
      const resourceId = req.query.resourceId || null;
      const startDate = req.query.startDate || null;
      const endDate = req.query.endDate || null;
      const search = req.query.search || req.query.q || null;

      const callerAdminId = (req.principal && req.principal.id) || 'super_admin';
      const ipAddress = clientIp(req);

      const result = await SuperAdminService.exportAuditLogs(
        { resourceType, action, adminId, resourceId, startDate, endDate, search },
        format,
        { adminId: callerAdminId, ipAddress }
      );

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `loumoo-audit-logs-${timestamp}.${result.extension}`;

      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Total-Records', String(result.count));

      res.send(result.content);
    } catch (err) {
      next(err);
    }
  }

  static async getDeepHealth(req, res, next) {
    try {
      const health = await SuperAdminService.getDeepHealth();
      res.json({
        success: true,
        data: health
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = SuperAdminOverviewController;
