/**
 * LOUMOO Delivery Frontend API Client
 * ---------------------------------------------------------------------------
 * Talks to the delivery-tracking backend at /api/v1/deliveries/* (see
 * docs/DELIVERY_API.md). Mirrors the shape and auth handling of travelApi.js:
 * the bearer session token is resolved from the canonical LOUMOO client and
 * attached as `Authorization: Bearer <token>` on every request.
 *
 * The live feed (`subscribe`) uses fetch() streaming, NOT the browser's native
 * EventSource — the contract requires the Authorization header on the stream,
 * which EventSource cannot send, and query-string tokens are deliberately
 * unsupported. When the stream is unavailable (serverless 501, or a dropped
 * connection) it falls back to polling GET /:id, exactly as the contract says.
 */

const DELIVERY_API_BASE = '/api/v1/deliveries';

class DeliveryApiClient {
  constructor(baseUrl = DELIVERY_API_BASE) {
    this.baseUrl = baseUrl;
  }

  /** The same bearer the rest of the app uses (canonical client, then storage). */
  async _resolveToken() {
    if (typeof window === 'undefined') return null;
    for (const client of [window.LoumooAPI, window.loumooApi]) {
      if (client && typeof client.resolveToken === 'function') {
        try {
          const token = await client.resolveToken();
          if (token) return token;
        } catch (e) { /* fall through */ }
      }
    }
    try {
      return localStorage.getItem('loumoo_token')
        || localStorage.getItem('loumoo_auth_token')
        || sessionStorage.getItem('loumoo_token')
        || null;
    } catch (e) {
      return null;
    }
  }

