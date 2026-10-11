/**
 * LOUMOO Store Application — House store service (read side)
 * ---------------------------------------------------------------------------
 * Resolves NanoAfrica (the platform owner's store that owns every curated
 * product) and nanoDelivery (its delivery agency) from the database, so that an
 * order for a curated product can be filed under the REAL owner account.
 *
 * The seller is never taken from a request or from the static catalogue: it is
 * `iam.stores.owner_id` of the row with the deterministic id in HouseStore.js. If
 * that row does not exist (the provisioning script has not been run) every method
 * answers null and the callers keep today's safe behaviour — a curated product is
 * refused at checkout rather than filed under a seller that does not exist.
 *
 * Reads are cached briefly (a hit is cheap; a miss is cached even more briefly)
 * so a bag of curated products does not turn into a query per line, and so a store
 * provisioned a moment ago becomes orderable without a restart.
 */
'use strict';

const { SupabaseDatabase, handleDatabaseFailure } = require('../../../infrastructure/database/SupabaseClient');
const { HOUSE_STORE, HOUSE_AGENCY } = require('../domain/HouseStore');

const HIT_TTL_MS = 30 * 1000;
const MISS_TTL_MS = 5 * 1000;

class HouseStoreService {
  /**
   * @param {object} [options]
   * @param {object|null} [options.db] Supabase-style client; null means "no database".
   *   Omit to use the shared admin client.
   * @param {() => number} [options.now] Clock, injectable for tests.
   */
  constructor(options = {}) {
    const opts = options || {};
    this._customDb = opts.db;
    this._now = typeof opts.now === 'function' ? opts.now : Date.now;
    this._cache = null; // { value, expiresAt }
  }

  get db() {
    if (this._customDb !== undefined) return this._customDb;
    try {
      return SupabaseDatabase.getAdmin();
    } catch {
      return null;
    }
  }

  invalidate() {
    this._cache = null;
  }

  /**
   * The house store as the order path needs it, or null when it has not been
   * provisioned (or cannot be read). The store's own status is returned as-is so
   * the caller can refuse a suspended boutique with the usual message.
   * Besides what the order path needs (owner, status, phone) it carries the public
   * facts the product page shows about the seller (logo, verification, rating,
   * city), so the catalogue can present the REAL provisioned store rather than a
   * hard-coded one.
   * @returns {Promise<{storeId:string, slug:string, name:string, ownerId:string, status:string, phone:string|null,
   *   email:string|null, logoUrl:string|null, isVerified:boolean, verificationTier:string|null,
   *   rating:number|null, ratingCount:number, city:string|null}|null>}
   */
  async resolve({ force = false } = {}) {
    const now = this._now();
    if (!force && this._cache && this._cache.expiresAt > now) return this._cache.value;

    let value = null;
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db
          .from('stores')
          .select('id, owner_id, name, slug, status, phone_number, email, logo_url, is_verified, verification_tier, rating, rating_count, metadata, deleted_at')
          .eq('id', HOUSE_STORE.id)
          .is('deleted_at', null)
          .maybeSingle();
        if (error) {
          handleDatabaseFailure(error, 'HouseStoreService.resolve');
        } else if (data && data.owner_id) {
          value = {
            storeId: data.id,
            slug: data.slug,
            name: data.name,
            ownerId: data.owner_id,
            status: data.status,
            phone: data.phone_number || (data.metadata && data.metadata.phone) || null,
            email: data.email || null,
            logoUrl: data.logo_url || null,
            isVerified: Boolean(data.is_verified),
            verificationTier: data.verification_tier || null,
            rating: data.rating != null ? Number(data.rating) : null,
            ratingCount: Number(data.rating_count) || 0,
            city: (data.metadata && data.metadata.city) || null
          };
          // The seller edits the store's city through its location, not its
          // metadata, so the location row is the better source when it exists.
          value.city = (await this._readLocationCity(db, data.id)) || value.city;
        }
      } catch (err) {
        handleDatabaseFailure(err, 'HouseStoreService.resolve');
      }
    }

    this._cache = { value, expiresAt: now + (value ? HIT_TTL_MS : MISS_TTL_MS) };
    return value;
  }

  async _readLocationCity(db, storeId) {
    try {
      const { data, error } = await db.from('store_locations').select('city').eq('store_id', storeId).maybeSingle();
      return !error && data && data.city ? data.city : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Creates (or completes) NanoAfrica and nanoDelivery for a named owner. Operator
   * tooling, run from scripts/provision_nanoafrica.js; see HouseStoreProvisioner for
   * the rules (dry run by default, verified email only, idempotent, second
   * confirmation before any write). When something was written the cached lookups
   * are dropped so this process sees the new store at once.
   * @param {object} opts See HouseStoreProvisioner#run.
   */
  async provision(opts = {}) {
    const db = this.db;
    if (!db) {
      throw new Error('No database connection: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or run through "railway run").');
    }
    const { HouseStoreProvisioner } = require('./HouseStoreProvisioner');
    const provisioner = new HouseStoreProvisioner({
      db,
      now: () => new Date(this._now()),
      invalidateProfile: async (clerkUserId, userId) => {
        // The running server caches a signed-in profile for a few minutes; drop what we can reach.
        const ProfileRepository = require('../../identity/infrastructure/ProfileRepository');
        await ProfileRepository.invalidate(clerkUserId, userId);
      }
    });
    try {
      return await provisioner.run(opts);
    } finally {
      this.invalidate();
    }
  }

  /**
   * nanoDelivery as a delivery provider (the shape DeliveryRepository.findDriver
   * returns), or null when the store or the agency is not provisioned. The agency
   * is the provider record that belongs to the store owner's account AND names the
   * nanoDelivery organization — anything else is not the house agency.
   */
  async resolveDefaultProvider() {
    const house = await this.resolve();
    if (!house) return null;
    const { getSharedDeliveryService } = require('../../delivery/application/DeliveryService');
    const provider = await getSharedDeliveryService().repo.findDriver(house.ownerId);
    if (!provider || !provider.isAgency || provider.organizationId !== HOUSE_AGENCY.organizationId) return null;
    return provider;
  }
}

let shared = null;

/** The process-wide instance backed by the shared admin client. */
function getSharedHouseStore() {
  if (!shared) shared = new HouseStoreService();
  return shared;
}

module.exports = { HouseStoreService, getSharedHouseStore };
