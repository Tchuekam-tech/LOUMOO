/**
 * LOUMOO SuperAdmin — SuperAdminSettingsController
 * ---------------------------------------------------------------------------
 * Handles HTTP requests for reading and updating dynamic system settings.
 */

const SuperAdminService = require('../services/SuperAdminService');
const { ValidationError } = require('../../../server/shared/errors/AppError');
const { clientIp } = require('../utils/clientIp');

class SuperAdminSettingsController {
  static async getAll(req, res, next) {
    try {
      const settings = await SuperAdminService.getSystemSettings();
      res.json({
        success: true,
        data: {
          settings,
          timestamp: new Date().toISOString()
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getByKey(req, res, next) {
    try {
      const { key } = req.params;
      const value = await SuperAdminService.getSystemSetting(key);
      if (value === null || value === undefined) {
        return res.status(404).json({
          success: false,
          error: { code: 'SETTING_NOT_FOUND', message: `Setting [${key}] was not found.` }
        });
      }
      res.json({
        success: true,
        data: { key, value }
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateByKey(req, res, next) {
    try {
      const { key } = req.params;
      const { value, reason } = req.body;
      const adminId = (req.principal && req.principal.id) || 'super_admin';
      const ipAddress = clientIp(req);

      const result = await SuperAdminService.updateSystemSetting(key, value, {
        adminId,
        reason,
        ipAddress
      });

      res.json({
        success: true,
        message: `System setting [${key}] successfully updated.`,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateSettings(req, res, next) {
    try {
      const payload = req.body;
      const adminId = (req.principal && req.principal.id) || 'super_admin';
      const ipAddress = clientIp(req);

      const result = await SuperAdminService.updateSystemSettings(payload, {
        adminId,
        reason: req.body.reason || null,
        ipAddress
      });

      res.json({
        success: true,
        message: 'System settings successfully updated.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  static async getCategories(req, res, next) {
    try {
      const categories = SuperAdminService.getSettingCategories();
      res.json({
        success: true,
        data: {
          categories,
          count: categories.length
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getByCategory(req, res, next) {
    try {
      const { category } = req.params;
      const settings = await SuperAdminService.getSettingsByCategory(category);
      res.json({
        success: true,
        data: {
          category,
          settings
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async resetByKey(req, res, next) {
    try {
      const { key } = req.params;
      if (!key || typeof key !== 'string' || !key.trim()) {
        throw new ValidationError('A valid setting key parameter is required.');
      }
      const adminId = (req.principal && req.principal.id) || 'super_admin';
      const ipAddress = clientIp(req);
      const reason = req.body && req.body.reason ? String(req.body.reason).trim() : null;
      if (reason && reason.length > 500) {
        throw new ValidationError('Reset reason must be a string up to 500 characters.');
      }

      const result = await SuperAdminService.resetSystemSetting(key, {
        adminId,
        reason,
        ipAddress
      });

      res.json({
        success: true,
        message: `System setting [${key}] successfully reset to factory defaults.`,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  static async setMaintenance(req, res, next) {
    try {
      if (!req.body || typeof req.body !== 'object') {
        throw new ValidationError('Request body must be a JSON object.');
      }
      if (typeof req.body.enabled !== 'boolean') {
        throw new ValidationError('Maintenance status must be specified as a boolean (enabled: true/false).');
      }

      const adminId = (req.principal && req.principal.id) || 'super_admin';
      const ipAddress = clientIp(req);

      const result = await SuperAdminService.setMaintenanceMode(req.body, {
        adminId,
        ipAddress
      });

      res.json({
        success: true,
        message: `Maintenance mode successfully ${req.body.enabled ? 'activated' : 'deactivated'}.`,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = SuperAdminSettingsController;
