/**
 * LOUMOO SuperAdmin — superAdminApi.js
 * ---------------------------------------------------------------------------
 * Client API connector for the SuperAdmin Control Center.
 */

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SuperAdminAPI = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function getAuthToken() {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem('loumoo_token') ||
               localStorage.getItem('loumoo_supabase_session_token') ||
               '';
      }
    } catch (e) {}
    return '';
  }

  async function request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : endpoint;
    const token = getAuthToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };

    const res = await fetch(url, {
      ...options,
      headers
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (body && body.error && body.error.message) || body.message || 'Administrative request failed';
      const err = new Error(msg);
      err.status = res.status;
      err.body = body;
      throw err;
    }

    return body.data || body;
  }

  return {
    async getOverview() {
      return await request('/api/v1/admin/overview');
    },

    async getSettings() {
      const res = await request('/api/v1/admin/settings');
      return res.settings || res;
    },

    async getSetting(key) {
      const res = await request(`/api/v1/admin/settings/${encodeURIComponent(key)}`);
      return res.value || res;
    },

    async updateSetting(key, value, reason = '') {
      return await request(`/api/v1/admin/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value, reason })
      });
    },

    // ── Phase 2: Stores & Merchant KYC Moderation ──
    async getStores({ status = '', tier = '', search = '', limit = 50, offset = 0 } = {}) {
      const params = new URLSearchParams();
      if (status && status !== 'ALL') params.set('status', status);
      if (tier && tier !== 'ALL') params.set('tier', tier);
      if (search) params.set('search', search);
      params.set('limit', limit);
      params.set('offset', offset);
      const res = await request(`/api/v1/admin/stores?${params.toString()}`);
      return res.stores || [];
    },

    async getStore(id) {
      const res = await request(`/api/v1/admin/stores/${encodeURIComponent(id)}`);
      return res.store || res;
    },

    async moderateStore(id, updates) {
      return await request(`/api/v1/admin/stores/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
    },

    async verifyStoreKyc(id, tier = 'pro_merchant', reason = 'Store KYC verified by SuperAdmin') {
      return await request(`/api/v1/admin/stores/${encodeURIComponent(id)}/verify-kyc`, {
        method: 'POST',
        body: JSON.stringify({ tier, reason })
      });
    },

    async rejectStoreKyc(id, reason = 'KYC documentation insufficient') {
      return await request(`/api/v1/admin/stores/${encodeURIComponent(id)}/reject-kyc`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
    },

    async suspendStore(id, reason = 'Violation of terms') {
      return await request(`/api/v1/admin/stores/${encodeURIComponent(id)}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
    },

    async reactivateStore(id, reason = 'Store reactivated') {
      return await request(`/api/v1/admin/stores/${encodeURIComponent(id)}/reactivate`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
    },

    async getAuditLogs(params = 25, offsetParam = 0) {
      const q = new URLSearchParams();
      if (typeof params === 'object' && params !== null) {
        if (params.limit) q.set('limit', params.limit);
        if (params.offset !== undefined) q.set('offset', params.offset);
        if (params.resourceType) q.set('resourceType', params.resourceType);
        if (params.action) q.set('action', params.action);
        if (params.adminId) q.set('adminId', params.adminId);
        if (params.resourceId) q.set('resourceId', params.resourceId);
        if (params.startDate) q.set('startDate', params.startDate);
        if (params.endDate) q.set('endDate', params.endDate);
        if (params.search || params.q) q.set('search', params.search || params.q);
      } else {
        q.set('limit', params || 25);
        q.set('offset', offsetParam || 0);
      }
      const res = await request(`/api/v1/admin/audit-logs?${q.toString()}`);
      if (Array.isArray(res.logs)) {
        res.logs.totalCount = res.totalCount !== undefined ? res.totalCount : res.count;
        res.logs.totalPages = res.totalPages || 1;
        return res.logs;
      }
      return res.logs || [];
    },

    async getAuditActions() {
      const res = await request('/api/v1/admin/audit-logs/actions');
      return res.actions || [];
    },

    async exportAuditLogs(filters = {}, format = 'csv') {
      const q = new URLSearchParams();
      q.set('format', format);
      if (filters.resourceType) q.set('resourceType', filters.resourceType);
      if (filters.action) q.set('action', filters.action);
      if (filters.adminId) q.set('adminId', filters.adminId);
      if (filters.resourceId) q.set('resourceId', filters.resourceId);
      if (filters.startDate) q.set('startDate', filters.startDate);
      if (filters.endDate) q.set('endDate', filters.endDate);
      if (filters.search || filters.q) q.set('search', filters.search || filters.q);

      const url = `/api/v1/admin/audit-logs/export?${q.toString()}`;
      if (typeof window !== 'undefined' && window.document && window.URL && typeof window.fetch === 'function') {
        // Authenticated browser file download trigger
        const fetchRes = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${getAuthToken()}`
          }
        });
        if (!fetchRes.ok) {
          const errBody = await fetchRes.json().catch(() => ({}));
          throw new Error((errBody && errBody.error && errBody.error.message) || errBody.message || `Export failed with HTTP ${fetchRes.status}`);
        }
        const blob = await fetchRes.blob();
        const objectUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.setAttribute('download', `loumoo-audit-logs-${new Date().toISOString().slice(0, 10)}.${format}`);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => window.URL.revokeObjectURL(objectUrl), 2000);
        return { success: true, count: fetchRes.headers.get('X-Total-Records') };
      }
      return await request(url);
    },

    async getSettingsCategories() {
      const res = await request('/api/v1/admin/settings/categories');
      return res.categories || [];
    },

    async getSettingsByCategory(category) {
      const res = await request(`/api/v1/admin/settings/category/${encodeURIComponent(category)}`);
      return res.settings || {};
    },

    async resetSetting(key, reason = '') {
      return await request(`/api/v1/admin/settings/reset/${encodeURIComponent(key)}`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
    },

    async setMaintenanceMode(enabled, bannerText = '', allowAdminBypass = true) {
      return await request('/api/v1/admin/maintenance', {
        method: 'POST',
        body: JSON.stringify({ enabled, banner_text: bannerText, allow_admin_bypass: allowAdminBypass })
      });
    },

    async getDeepHealth() {
      return await request('/api/v1/admin/health/deep');
    },

    // Standard client aliases
    getAdminAuditLogs(params, offset) { return this.getAuditLogs(params, offset); },
    getAdminAuditActions() { return this.getAuditActions(); },
    exportAdminAuditLogs(filters, format) { return this.exportAuditLogs(filters, format); },
    resetSystemSetting(key, reason) { return this.resetSetting(key, reason); }
  };
});
