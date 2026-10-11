/**
 * LOUMOO Delivery — Repository
 * ---------------------------------------------------------------------------
 * Persistence for riders, deliveries, the status timeline and GPS history on
 * `iam.delivery_drivers`, `iam.deliveries`, `iam.delivery_events` and
 * `iam.driver_locations` (migration 013), and the riders' live availability on
 * `iam.rider_presence` (migration 017: one overwritten row per rider, never a trail).
 *
 * Backend selection: when a Supabase admin client is available the database is
 * the ONLY source of truth. The in-memory maps are used when no client exists
 * (unit tests, a laptop with no credentials) or, in non-production, after a
 * handled database failure — the same policy as OrderRepository, via
 * handleDatabaseFailure, which throws in production.
 *
 * Concurrency: every state change goes through `updateWhere(id, expected, patch)`,
 * a compare-and-swap that applies only if the row still matches `expected`.
 * That is what stops two riders accepting the same delivery, two pings racing a
 * status change, or two wrong-code guesses sharing one attempt slot.
 */

const { SupabaseDatabase, handleDatabaseFailure: baseHandleDatabaseFailure } = require('../../../infrastructure/database/SupabaseClient');
const {
  ConflictError, NotFoundError, ValidationError, InfrastructureError, ServiceUnavailableError
} = require('../../../shared/errors/AppError');
const { config } = require('../../../config/env');
const logger = require('../../../shared/logging/logger');
const {
  DELIVERY_STATUS, TERMINAL_STATUSES, WORKLOAD_STATUSES, DRIVER_STATUS, OFFER_EXPIRED_NOTE
} = require('../domain/Delivery');
const { PRESENCE_STATUS } = require('../domain/RiderPresence');

const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
// PostgREST answers PGRST205 for a table that is not in its schema cache; a direct
// Postgres connection says 42P01 ("undefined_table"). Either means migration 013
// (or 014) has not been applied to this database.
const MISSING_TABLE_CODES = Object.freeze(['PGRST205', '42P01']);
const ADMIN_ROLES = Object.freeze(['admin', 'super_admin']);

/** Delivery is deployed but its tables are not: an operator has to apply the migrations. */
class DeliveryNotReadyError extends ServiceUnavailableError {
  constructor() {
    super('Delivery is not available yet. Please try again later.');
    this.code = 'DELIVERY_NOT_READY';
  }
}

function isMissingTable(err) {
  return Boolean(err) && MISSING_TABLE_CODES.includes(err.code);
}

/**
 * The repository's failure policy. In production a missing delivery table is
 * answered with a clear 503 on every path, reads included: the base policy would
 * let a read fall back to the empty in-memory store, which looks like "no
 * deliveries" and hides a deployment that is simply missing its migration. The
 * operator gets the full detail in the log; the client gets a plain message.
 *
 * In production EVERY other database failure here throws as well. The base policy
 * lets a failed READ fall back to this repository's in-memory maps, but in a
 * production process those maps are empty and nothing ever fills them, so the
 * fallback does not mean "serve what we have": it means "answer none". A failed
 * `delivery_drivers` read became an EMPTY rider list with HTTP 200 (the checkout
 * picker showed no riders, the admin roster and the seller's ranking showed none),
 * a failed `findDriver` became "you are not a rider" (the rider's heartbeat
 * stopped), a failed `findById` became a 404 the clients treat as final. A visible
 * 5xx is recoverable (the screens offer a retry); a wrong "nothing here" is not.
 * The exceptions are the reads that pass DEGRADE_ON_FAILURE (below): housekeeping the next
 * sweep repeats. Development and test keep the in-memory fallback.
 */
function handleDatabaseFailure(err, context, options) {
  if (err instanceof DeliveryNotReadyError) throw err;
  if (config.isProduction && isMissingTable(err)) {
    logger.error(`[Delivery] ${context}: a delivery table is missing. Apply migrations 013, 014 and 017 (node scripts/apply_migration.js --all).`);
    throw new DeliveryNotReadyError();
  }
  const handled = baseHandleDatabaseFailure(err, context, options);
  if (config.isProduction && !(options && options.allowFallback)) throw new InfrastructureError('Supabase', context, err);
  return handled;
}

/**
 * Passed by the few reads whose caller simply tries again, so a failure there is logged and
 * answered "none" instead of thrown: the sweeper's housekeeping reads (an offer that is not
 * released this round is released by the next sweep) and the single-rider presence read (a
 * rider with no row reads as offline, which is the safe direction). Every read that decides
 * what a user sees or who is offered a job still throws in production, and a missing table
 * is still a 503 on all of them.
 */
const DEGRADE_ON_FAILURE = Object.freeze({ allowFallback: true });
const MAX_MEMORY_LOCATIONS_PER_DELIVERY = 500;
// Rows read to count rider workload and recent lapses. Equal to Supabase's default
// API row limit (db-max-rows = 1000): PostgREST silently truncates any larger
// client limit to that, so a bigger number here would make the "cap reached" warning
// unreachable while counts quietly came back short. Far above any realistic number
// of simultaneously open deliveries; logged loudly if it is ever reached.
const MAX_WORKLOAD_ROWS = 1000;

// camelCase record key -> column name, for both reads and writes.
const DELIVERY_COLUMNS = Object.freeze({
  id: 'id',
  orderId: 'order_id',
  buyerId: 'buyer_id',
  sellerId: 'seller_id',
  driverId: 'driver_id',
  status: 'status',
  pickup: 'pickup',
  dropoff: 'dropoff',
  handoverNonce: 'handover_nonce',
  codeAttempts: 'code_attempts',
  etaMinutes: 'eta_minutes',
  distanceKm: 'distance_km',
  lastLocation: 'last_location',
  failureReason: 'failure_reason',
  assignedAt: 'assigned_at',
  acceptedAt: 'accepted_at',
  pickedUpAt: 'picked_up_at',
  arrivedAt: 'arrived_at',
  deliveredAt: 'delivered_at',
  cancelledAt: 'cancelled_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

function toRow(record) {
  const row = {};
  for (const [key, value] of Object.entries(record)) {
    const column = DELIVERY_COLUMNS[key];
    if (column && value !== undefined) row[column] = value;
  }
  return row;
}

function fromRow(row) {
  if (!row) return null;
  const record = {};
  for (const [key, column] of Object.entries(DELIVERY_COLUMNS)) {
    record[key] = row[column] === undefined ? null : row[column];
  }
  record.handoverNonce = Number(record.handoverNonce) || 1;
  record.codeAttempts = Number(record.codeAttempts) || 0;
  record.etaMinutes = record.etaMinutes == null ? null : Number(record.etaMinutes);
  record.distanceKm = record.distanceKm == null ? null : Number(record.distanceKm);
  record.pickup = record.pickup || {};
  record.dropoff = record.dropoff || {};
  return record;
}

function driverFromRow(row) {
  if (!row) return null;
  return {
    id: row.profile_id,
    name: row.display_name,
    phone: row.phone,
    status: row.status,
    // Marketplace profile (migration 018). A row written before 018 has these as
    // NULL/absent, so each falls back to a sensible empty value.
    photoUrl: row.photo_url || null,
    vehicleType: row.vehicle_type || null,
    serviceAreas: Array.isArray(row.service_areas) ? row.service_areas : [],
    baseFeeXaf: row.base_fee_xaf === null || row.base_fee_xaf === undefined ? null : Number(row.base_fee_xaf),
    ratingAvg: row.rating_avg === null || row.rating_avg === undefined ? null : Number(row.rating_avg),
    ratingCount: Number(row.rating_count) || 0,
    isAgency: Boolean(row.is_agency),
    organizationId: row.organization_id || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Presence record key -> iam.rider_presence column (migration 017).
const PRESENCE_COLUMNS = Object.freeze({
  riderId: 'rider_id',
  status: 'status',
  latitude: 'latitude',
  longitude: 'longitude',
  accuracy: 'accuracy',
  lastSeenAt: 'last_seen_at',
  updatedAt: 'updated_at'
});

function presenceFromRow(row) {
  if (!row) return null;
  const record = {};
  for (const [key, column] of Object.entries(PRESENCE_COLUMNS)) {
    record[key] = row[column] === undefined ? null : row[column];
  }
  for (const key of ['latitude', 'longitude', 'accuracy']) {
    record[key] = record[key] == null ? null : Number(record[key]);
  }
  return record;
}

function toPresenceRow(patch) {
  const row = {};
  for (const [key, value] of Object.entries(patch)) {
    const column = PRESENCE_COLUMNS[key];
    if (column && value !== undefined) row[column] = value;
  }
  return row;
}

function isOpen(status) {
  return !TERMINAL_STATUSES.includes(status);
}

/**
 * For a query whose answer decides who is offered a job: a database error must
 * not be read as an empty answer. handleDatabaseFailure logs and alerts, but in
 * production it lets READS fall back to the (empty) in-memory store, and "nobody
 * is busy" or "nobody has lapsed" would silently steer an assignment to the wrong
 * rider. So in production the error is thrown and the request fails visibly;
 * elsewhere the usual development fallback applies.
 */
function failRankingInput(error, context) {
  handleDatabaseFailure(error, context);
  if (config.isProduction) throw new InfrastructureError('Supabase', context, error);
}

/** `Map<value, occurrences>` of a list of ids. */
function tally(ids) {
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  return counts;
}

class DeliveryRepository {
  constructor(options = {}) {
    const opts = options || {};
    this._customDb = opts.db;
    this._deliveries = new Map();
    this._drivers = new Map();
    this._events = new Map();     // deliveryId -> [event]
    this._locations = new Map();  // deliveryId -> [point]
    this._presence = new Map();   // riderId -> presence record
    this._eventSeq = 0;
  }

  get db() {
    if (this._customDb !== undefined) return this._customDb;
    try {
      return SupabaseDatabase.getAdmin();
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- deliveries

  /** Inserts a new delivery. Throws ConflictError if the order already has an open one. */
  async insertDelivery(record) {
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('deliveries').insert(toRow(record)).select().single();
        if (error) {
          if (error.code === PG_UNIQUE_VIOLATION) {
            throw new ConflictError('This order already has an open delivery.', { orderId: record.orderId });
          }
          handleDatabaseFailure(error, 'DeliveryRepository.insertDelivery');
        } else if (data) {
          return fromRow(data);
        }
      } catch (err) {
        if (err instanceof ConflictError) throw err;
        handleDatabaseFailure(err, 'DeliveryRepository.insertDelivery');
      }
    }

    for (const d of this._deliveries.values()) {
      if (d.orderId === record.orderId && isOpen(d.status)) {
        throw new ConflictError('This order already has an open delivery.', { orderId: record.orderId });
      }
    }
    const stored = { ...fromRow(toRow(record)) };
    this._deliveries.set(stored.id, stored);
    return { ...stored };
  }

  async findById(id) {
    if (!id) return null;
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('deliveries').select('*').eq('id', id).maybeSingle();
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.findById');
        else return fromRow(data);
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.findById');
      }
    }
    const d = this._deliveries.get(id);
    return d ? { ...d } : null;
  }

  /** The open delivery for an order, if any. */
  async findOpenByOrder(orderId) {
    if (!orderId) return null;
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('deliveries').select('*')
          .eq('order_id', orderId)
          .not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`)
          .maybeSingle();
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.findOpenByOrder');
        else return fromRow(data);
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.findOpenByOrder');
      }
    }
    for (const d of this._deliveries.values()) {
      if (d.orderId === orderId && isOpen(d.status)) return { ...d };
    }
    return null;
  }

  /** The open delivery if there is one, otherwise the most recent finished one. */
  async findByOrder(orderId) {
    const open = await this.findOpenByOrder(orderId);
    if (open) return open;
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('deliveries').select('*')
          .eq('order_id', orderId)
          .order('created_at', { ascending: false })
          .limit(1);
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.findByOrder');
        else return fromRow((data || [])[0]);
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.findByOrder');
      }
    }
    const all = [...this._deliveries.values()]
      .filter((d) => d.orderId === orderId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return all[0] ? { ...all[0] } : null;
  }

  /**
   * For many orders at once: `Map<orderId, delivery>` holding each order's open
   * delivery, else its most recent finished one (the same choice as findByOrder),
   * in one query instead of one per order. Orders with no delivery are absent.
   */
  async findLatestByOrders(orderIds) {
    const ids = [...new Set((orderIds || []).filter(Boolean))];
    if (!ids.length) return new Map();
    const pick = (rows) => {
      const byOrder = new Map();
      // Newest first, so the first finished row seen is the latest; an open one
      // always wins over any finished one.
      for (const d of rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))) {
        const current = byOrder.get(d.orderId);
        if (!current || (!isOpen(current.status) && isOpen(d.status))) byOrder.set(d.orderId, d);
      }
      return byOrder;
    };
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('deliveries').select('*')
          .in('order_id', ids)
          .order('created_at', { ascending: false })
          .limit(MAX_WORKLOAD_ROWS);
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.findLatestByOrders');
        else return pick((data || []).map(fromRow));
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.findLatestByOrders');
      }
    }
    return pick([...this._deliveries.values()].filter((d) => ids.includes(d.orderId)).map((d) => ({ ...d })));
  }

  /** Open deliveries assigned to a rider, newest activity first. */
  async findOpenByDriver(driverId, { limit = 20 } = {}) {
    if (!driverId) return [];
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('deliveries').select('*')
          .eq('driver_id', driverId)
          .not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`)
          .order('updated_at', { ascending: false })
          .limit(limit);
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.findOpenByDriver');
        else return (data || []).map(fromRow);
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.findOpenByDriver');
      }
    }
    return [...this._deliveries.values()]
      .filter((d) => d.driverId === driverId && isOpen(d.status))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, limit)
      .map((d) => ({ ...d }));
  }

  /**
   * Offers (`assigned` deliveries) handed out at or before `cutoffIso`, oldest
   * first: the ones whose acceptance window has lapsed. A row with no
   * `assigned_at` is never returned (nothing to count from). Bounded, so a
   * backlog is worked off over several sweeps instead of in one long query.
   */
  async findStaleOffers(cutoffIso, { limit = 50 } = {}) {
    const cutoff = Date.parse(cutoffIso);
    if (!Number.isFinite(cutoff)) return [];
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('deliveries').select('*')
          .eq('status', DELIVERY_STATUS.ASSIGNED)
          .lte('assigned_at', new Date(cutoff).toISOString())
          .order('assigned_at', { ascending: true })
          .limit(limit);
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.findStaleOffers', DEGRADE_ON_FAILURE);
        else return (data || []).map(fromRow);
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.findStaleOffers', DEGRADE_ON_FAILURE);
      }
    }
    return [...this._deliveries.values()]
      .filter((d) => d.status === DELIVERY_STATUS.ASSIGNED && d.assignedAt && Date.parse(d.assignedAt) <= cutoff)
      .sort((a, b) => Date.parse(a.assignedAt) - Date.parse(b.assignedAt))
      .slice(0, limit)
      .map((d) => ({ ...d }));
  }

  /**
   * How many deliveries each rider is carrying right now, as `Map<driverId, count>`.
   * Riders with none are absent. By default that is every WORKLOAD_STATUSES delivery
   * (assigned, accepted, picked up or arrived); pass `statuses` to count a subset,
   * e.g. only the ones that make a rider busy (accepted onward).
   */
  async countOpenByDriver({ statuses = WORKLOAD_STATUSES } = {}) {
    const counted = [...statuses];
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('deliveries').select('driver_id')
          .in('status', counted)
          .not('driver_id', 'is', null)
          .limit(MAX_WORKLOAD_ROWS);
        if (error) failRankingInput(error, 'DeliveryRepository.countOpenByDriver');
        else {
          if ((data || []).length >= MAX_WORKLOAD_ROWS) {
            logger.warn(`[DeliveryRepository] Workload count hit its ${MAX_WORKLOAD_ROWS}-row cap; rider counts may be low.`);
          }
          return tally((data || []).map((r) => r.driver_id));
        }
      } catch (err) {
        if (err instanceof InfrastructureError) throw err;
        failRankingInput(err, 'DeliveryRepository.countOpenByDriver');
      }
    }
    return tally([...this._deliveries.values()]
      .filter((d) => d.driverId && counted.includes(d.status))
      .map((d) => d.driverId));
  }

  /**
   * How many deliveries each rider has COMPLETED (status 'delivered'), as
   * `Map<driverId, count>`. This is the rider's public "N deliveries" reputation,
   * derived from the truth rather than a counter that could drift. Riders with
   * none are absent.
   */
  async countCompletedByDriver() {
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('deliveries').select('driver_id')
          .eq('status', 'delivered')
          .not('driver_id', 'is', null)
          .limit(MAX_WORKLOAD_ROWS);
        if (error) failRankingInput(error, 'DeliveryRepository.countCompletedByDriver');
        else {
          if ((data || []).length >= MAX_WORKLOAD_ROWS) {
            logger.warn(`[DeliveryRepository] Completed-count hit its ${MAX_WORKLOAD_ROWS}-row cap; rider totals may be low.`);
          }
          return tally((data || []).map((r) => r.driver_id));
        }
      } catch (err) {
        if (err instanceof InfrastructureError) throw err;
        failRankingInput(err, 'DeliveryRepository.countCompletedByDriver');
      }
    }
    return tally([...this._deliveries.values()]
      .filter((d) => d.driverId && d.status === 'delivered')
      .map((d) => d.driverId));
  }

  /**
   * Compare-and-swap update. `expected` is a map of record keys that must still
   * hold (e.g. `{ status: 'assigned', driverId: 'drv_1' }`; null means IS NULL).
   * Returns the updated record, or `null` when the row no longer matches — the
   * caller turns that into a ConflictError with a message that fits the action.
   */
  async updateWhere(id, expected, patch) {
    const db = this.db;
    const fullPatch = { ...patch, updatedAt: patch.updatedAt || new Date().toISOString() };
    if (db) {
      try {
        let query = db.from('deliveries').update(toRow(fullPatch)).eq('id', id);
        for (const [key, value] of Object.entries(expected || {})) {
          const column = DELIVERY_COLUMNS[key];
          if (!column) throw new Error(`updateWhere: unknown column key "${key}"`);
          query = value === null ? query.is(column, null) : query.eq(column, value);
        }
        const { data, error } = await query.select().maybeSingle();
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.updateWhere');
        else return fromRow(data);
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.updateWhere');
      }
    }

    const current = this._deliveries.get(id);
    if (!current) return null;
    for (const [key, value] of Object.entries(expected || {})) {
      const have = current[key] === undefined ? null : current[key];
      if (have !== value) return null;
    }
    // Re-opening a terminal row, or a second open row for one order, would break
    // the partial unique index in the database; keep the memory backend honest.
    const next = { ...current, ...fullPatch };
    this._deliveries.set(id, next);
    return { ...next };
  }

  // ------------------------------------------------------------------ timeline

  async insertEvent({ deliveryId, status, previousStatus = null, actorId = null, note = null, at = new Date().toISOString() }) {
    const db = this.db;
    if (db) {
      try {
        const { error } = await db.from('delivery_events').insert({
          delivery_id: deliveryId,
          status,
          previous_status: previousStatus,
          actor_id: actorId,
          note,
          created_at: at
        });
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.insertEvent');
        else return;
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.insertEvent');
      }
    }
    const list = this._events.get(deliveryId) || [];
    list.push({ id: ++this._eventSeq, deliveryId, status, previousStatus, actorId, note, at });
    this._events.set(deliveryId, list);
  }

  async listEvents(deliveryId) {
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('delivery_events').select('*')
          .eq('delivery_id', deliveryId).order('id', { ascending: true });
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.listEvents');
        else {
          return (data || []).map((r) => ({
            id: r.id, deliveryId: r.delivery_id, status: r.status, previousStatus: r.previous_status,
            actorId: r.actor_id, note: r.note, at: r.created_at
          }));
        }
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.listEvents');
      }
    }
    return (this._events.get(deliveryId) || []).map((e) => ({ ...e }));
  }

  /**
   * How many offers each rider let lapse since `sinceIso`, as `Map<riderId, count>`
   * (riders with none are absent). A lapse is the timeline row written when an
   * `assigned` offer returns to `pending_assignment` with OFFER_EXPIRED_NOTE; the
   * rider is its actor. A decline has the same shape but a different note, and is
   * deliberately NOT counted: declining is a rider who is answering.
   */
  async countRecentLapses(sinceIso) {
    const since = Date.parse(sinceIso);
    if (!Number.isFinite(since)) return new Map();
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('delivery_events').select('actor_id')
          .eq('status', DELIVERY_STATUS.PENDING_ASSIGNMENT)
          .eq('previous_status', DELIVERY_STATUS.ASSIGNED)
          .eq('note', OFFER_EXPIRED_NOTE)
          .gte('created_at', new Date(since).toISOString())
          .limit(MAX_WORKLOAD_ROWS);
        if (error) failRankingInput(error, 'DeliveryRepository.countRecentLapses');
        else {
          if ((data || []).length >= MAX_WORKLOAD_ROWS) {
            logger.warn(`[DeliveryRepository] Recent-lapse count hit its ${MAX_WORKLOAD_ROWS}-row cap; the non-responder penalty may miss riders.`);
          }
          return tally((data || []).map((r) => r.actor_id).filter(Boolean));
        }
      } catch (err) {
        if (err instanceof InfrastructureError) throw err;
        failRankingInput(err, 'DeliveryRepository.countRecentLapses');
      }
    }
    const ids = [];
    for (const list of this._events.values()) {
      for (const e of list) {
        if (e.status === DELIVERY_STATUS.PENDING_ASSIGNMENT && e.previousStatus === DELIVERY_STATUS.ASSIGNED
          && e.note === OFFER_EXPIRED_NOTE && e.actorId && Date.parse(e.at) >= since) ids.push(e.actorId);
      }
    }
    return tally(ids);
  }

  // ----------------------------------------------------------------------- GPS

  async insertLocation({ deliveryId, driverId, lat, lng, speedKmh = null, heading = null, accuracyM = null, at }) {
    const recordedAt = at || new Date().toISOString();
    const db = this.db;
    if (db) {
      try {
        const { error } = await db.from('driver_locations').insert({
          delivery_id: deliveryId,
          driver_id: driverId,
          lat,
          lng,
          speed_kmh: speedKmh,
          heading,
          accuracy_m: accuracyM,
          recorded_at: recordedAt
        });
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.insertLocation');
        else return;
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.insertLocation');
      }
    }
    const list = this._locations.get(deliveryId) || [];
    list.push({ deliveryId, driverId, lat, lng, speedKmh, heading, accuracyM, at: recordedAt });
    if (list.length > MAX_MEMORY_LOCATIONS_PER_DELIVERY) list.shift();
    this._locations.set(deliveryId, list);
  }

  async listLocations(deliveryId, { limit = 200 } = {}) {
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('driver_locations').select('*')
          .eq('delivery_id', deliveryId).order('recorded_at', { ascending: false }).limit(limit);
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.listLocations');
        else {
          return (data || []).reverse().map((r) => ({
            deliveryId: r.delivery_id, driverId: r.driver_id, lat: r.lat, lng: r.lng,
            speedKmh: r.speed_kmh, heading: r.heading, accuracyM: r.accuracy_m, at: r.recorded_at
          }));
        }
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.listLocations');
      }
    }
    return (this._locations.get(deliveryId) || []).slice(-limit).map((p) => ({ ...p }));
  }

  // ------------------------------------------------------------------- drivers

  async findDriver(profileId) {
    if (!profileId) return null;
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('delivery_drivers').select('*').eq('profile_id', profileId).maybeSingle();
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.findDriver');
        else return driverFromRow(data);
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.findDriver');
      }
    }
    const d = this._drivers.get(profileId);
    return d ? { ...d } : null;
  }

  async upsertDriver({ profileId, name, phone, status = DRIVER_STATUS.ACTIVE, createdBy = null, profile = null }) {
    const now = new Date().toISOString();
    // Only the marketplace columns the caller actually provided are written, so
    // editing a name or phone never wipes a rider's photo, areas or tariff. On a
    // conflict Postgres updates just the columns present in the payload.
    const COLS = {
      photoUrl: 'photo_url', vehicleType: 'vehicle_type', serviceAreas: 'service_areas',
      baseFeeXaf: 'base_fee_xaf', isAgency: 'is_agency', organizationId: 'organization_id'
    };
    const profileCols = {};
    if (profile && typeof profile === 'object') {
      for (const key of Object.keys(COLS)) {
        if (profile[key] !== undefined) profileCols[COLS[key]] = profile[key];
      }
    }
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('delivery_drivers').upsert({
          profile_id: profileId,
          display_name: name,
          phone,
          status,
          created_by: createdBy,
          updated_at: now,
          ...profileCols
        }, { onConflict: 'profile_id' }).select().single();
        if (error) {
          if (error.code === PG_FOREIGN_KEY_VIOLATION) throw new ValidationError('No account exists with that id', [{ field: 'profileId', message: 'Check the rider\'s account id.' }]);
          handleDatabaseFailure(error, 'DeliveryRepository.upsertDriver');
        } else {
          return driverFromRow(data);
        }
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        handleDatabaseFailure(err, 'DeliveryRepository.upsertDriver');
      }
    }
    const existing = this._drivers.get(profileId);
    const base = existing || {
      id: profileId, serviceAreas: [], photoUrl: null, vehicleType: null,
      baseFeeXaf: null, ratingAvg: null, ratingCount: 0, isAgency: false, organizationId: null
    };
    const stored = {
      ...base,
      id: profileId, name, phone, status, createdBy,
      createdAt: existing ? existing.createdAt : now, updatedAt: now
    };
    // Mirror the "only what was provided" merge for the in-memory engine.
    if (profile && typeof profile === 'object') {
      for (const key of Object.keys(COLS)) {
        if (profile[key] !== undefined) stored[key] = profile[key];
      }
    }
    this._drivers.set(profileId, stored);
    return { ...stored };
  }

  async listDrivers({ status = DRIVER_STATUS.ACTIVE, limit = 100 } = {}) {
    const db = this.db;
    if (db) {
      try {
        let query = db.from('delivery_drivers').select('*').order('display_name', { ascending: true }).limit(limit);
        if (status) query = query.eq('status', status);
        const { data, error } = await query;
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.listDrivers');
        else return (data || []).map(driverFromRow);
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.listDrivers');
      }
    }
    return [...this._drivers.values()]
      .filter((d) => !status || d.status === status)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((d) => ({ ...d }));
  }

  // ------------------------------------------------------------------ presence

  /** The stored presence of one rider, or null when they have never had a row. */
  async findPresence(riderId) {
    if (!riderId) return null;
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('rider_presence').select('*').eq('rider_id', riderId).maybeSingle();
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.findPresence', DEGRADE_ON_FAILURE);
        else return presenceFromRow(data);
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.findPresence', DEGRADE_ON_FAILURE);
      }
    }
    const row = this._presence.get(riderId);
    return row ? { ...row } : null;
  }

  /**
   * Makes sure the rider has a presence row, an `offline` one if it has to create
   * it, and leaves an existing row untouched. Idempotent and race-safe (two first
   * calls create one row): every transition below is an UPDATE, so the row has to
   * exist before it can be moved.
   */
  async ensurePresence(riderId, atIso = new Date().toISOString()) {
    const db = this.db;
    if (db) {
      try {
        const { error } = await db.from('rider_presence').upsert(
          { rider_id: riderId, status: PRESENCE_STATUS.OFFLINE, updated_at: atIso },
          { onConflict: 'rider_id', ignoreDuplicates: true }
        );
        if (error) {
          if (error.code === PG_FOREIGN_KEY_VIOLATION) throw new ValidationError('That account is not a rider', [{ field: 'riderId', message: 'Register the rider first.' }]);
          handleDatabaseFailure(error, 'DeliveryRepository.ensurePresence');
        } else {
          return;
        }
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        handleDatabaseFailure(err, 'DeliveryRepository.ensurePresence');
      }
    }
    if (!this._presence.has(riderId)) {
      this._presence.set(riderId, {
        riderId, status: PRESENCE_STATUS.OFFLINE, latitude: null, longitude: null, accuracy: null,
        lastSeenAt: null, updatedAt: atIso
      });
    }
  }

  /**
   * Compare-and-swap on a rider's presence, the same contract as `updateWhere`: the
   * patch applies only while the stored status is one of `expectedStatuses`, and,
   * with `seenSince`, only while the last heartbeat is NEWER than that instant (so
   * "online and fresh" is decided in the same atomic step that claims the rider,
   * not in a read that can go stale before the write). `staleAt` is the mirror
   * image, for the sweeper: only while the last heartbeat is at or BEFORE that
   * instant, so a rider who beat between the sweeper's read and its write is not
   * set offline. `updatedBefore` guards the row's own age the same way, for the
   * janitor that puts a leaked `busy` row right: only while nothing has written to it
   * since that instant, so a claim made after the janitor's read is never undone.
   * Returns the updated record, or `null` when the row no longer matches.
   */
  async transitionPresence(riderId, expectedStatuses, patch, { seenSince = null, staleAt = null, updatedBefore = null } = {}) {
    const expected = [...expectedStatuses];
    const fullPatch = { ...patch, updatedAt: patch.updatedAt || new Date().toISOString() };
    const db = this.db;
    if (db) {
      try {
        let query = db.from('rider_presence').update(toPresenceRow(fullPatch))
          .eq('rider_id', riderId).in('status', expected);
        if (seenSince) query = query.gt('last_seen_at', seenSince);
        if (staleAt) query = query.lte('last_seen_at', staleAt);
        if (updatedBefore) query = query.lte('updated_at', updatedBefore);
        const { data, error } = await query.select().maybeSingle();
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.transitionPresence');
        else return presenceFromRow(data);
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.transitionPresence');
      }
    }
    const current = this._presence.get(riderId);
    if (!current || !expected.includes(current.status)) return null;
    if (seenSince) {
      const seen = Date.parse(current.lastSeenAt);
      if (!Number.isFinite(seen) || !(seen > Date.parse(seenSince))) return null;
    }
    if (staleAt) {
      const seen = Date.parse(current.lastSeenAt);
      if (!Number.isFinite(seen) || !(seen <= Date.parse(staleAt))) return null;
    }
    if (updatedBefore) {
      const written = Date.parse(current.updatedAt);
      if (!Number.isFinite(written) || !(written <= Date.parse(updatedBefore))) return null;
    }
    const next = { ...current, ...fullPatch };
    this._presence.set(riderId, next);
    return { ...next };
  }

  /** Every presence row (the admin roster), by rider id. Capped like the other rider reads. */
  async listPresence({ limit = MAX_WORKLOAD_ROWS } = {}) {
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('rider_presence').select('*').limit(limit);
        if (error) failRankingInput(error, 'DeliveryRepository.listPresence');
        else return (data || []).map(presenceFromRow);
      } catch (err) {
        if (err instanceof InfrastructureError) throw err;
        failRankingInput(err, 'DeliveryRepository.listPresence');
      }
    }
    return [...this._presence.values()].slice(0, limit).map((r) => ({ ...r }));
  }

  /**
   * Riders stored `online` whose last heartbeat is NEWER than `seenSinceIso`: the
   * pool an offer is chosen from. Offline, paused and busy riders are not read at
   * all. A database error is thrown in production rather than answered with an
   * empty pool (see failRankingInput).
   */
  async listFreshOnlinePresence(seenSinceIso, { limit = MAX_WORKLOAD_ROWS } = {}) {
    const since = Date.parse(seenSinceIso);
    if (!Number.isFinite(since)) return [];
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('rider_presence').select('*')
          .eq('status', PRESENCE_STATUS.ONLINE)
          .gt('last_seen_at', new Date(since).toISOString())
          .limit(limit);
        if (error) failRankingInput(error, 'DeliveryRepository.listFreshOnlinePresence');
        else return (data || []).map(presenceFromRow);
      } catch (err) {
        if (err instanceof InfrastructureError) throw err;
        failRankingInput(err, 'DeliveryRepository.listFreshOnlinePresence');
      }
    }
    return [...this._presence.values()]
      .filter((r) => r.status === PRESENCE_STATUS.ONLINE && Date.parse(r.lastSeenAt) > since)
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  /**
   * Riders stored `online` whose last heartbeat is at or before `cutoffIso`: the ones
   * the sweeper sets offline. Oldest first and bounded, so a backlog is worked off
   * over several sweeps.
   */
  async findStalePresence(cutoffIso, { limit = 50 } = {}) {
    const cutoff = Date.parse(cutoffIso);
    if (!Number.isFinite(cutoff)) return [];
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('rider_presence').select('*')
          .eq('status', PRESENCE_STATUS.ONLINE)
          .lte('last_seen_at', new Date(cutoff).toISOString())
          .order('last_seen_at', { ascending: true })
          .limit(limit);
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.findStalePresence', DEGRADE_ON_FAILURE);
        else return (data || []).map(presenceFromRow);
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.findStalePresence', DEGRADE_ON_FAILURE);
      }
    }
    return [...this._presence.values()]
      .filter((r) => r.status === PRESENCE_STATUS.ONLINE && Date.parse(r.lastSeenAt) <= cutoff)
      .sort((a, b) => Date.parse(a.lastSeenAt) - Date.parse(b.lastSeenAt))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  /**
   * Riders stored `busy` that nothing has written to since `cutoffIso`: candidates
   * for the janitor that puts a leaked busy row right once it knows the rider holds
   * no accepted delivery. Oldest first and bounded.
   */
  async findStaleBusyPresence(cutoffIso, { limit = 50 } = {}) {
    const cutoff = Date.parse(cutoffIso);
    if (!Number.isFinite(cutoff)) return [];
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('rider_presence').select('*')
          .eq('status', PRESENCE_STATUS.BUSY)
          .lte('updated_at', new Date(cutoff).toISOString())
          .order('updated_at', { ascending: true })
          .limit(limit);
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.findStaleBusyPresence', DEGRADE_ON_FAILURE);
        else return (data || []).map(presenceFromRow);
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.findStaleBusyPresence', DEGRADE_ON_FAILURE);
      }
    }
    return [...this._presence.values()]
      .filter((r) => r.status === PRESENCE_STATUS.BUSY && Date.parse(r.updatedAt) <= cutoff)
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  /**
   * Active member user ids of an organization (iam.organization_members). Used to
   * resolve an agency's rider roster and to authorise delegation. Best-effort: any
   * failure (missing table, offline) returns [], so the caller fails safe
   * (delegation denied rather than wrongly allowed). Without a database it reads
   * the in-memory `_orgMembers` map (empty unless a test seeded it).
   */
  async listOrgMemberIds(orgId) {
    if (!orgId) return [];
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db
          .from('organization_members')
          .select('user_id, status')
          .eq('organization_id', orgId)
          .eq('status', 'ACTIVE')
          .limit(500);
        if (!error) return (data || []).map((r) => r.user_id).filter(Boolean);
      } catch (_) { /* fail safe below */ }
      return [];
    }
    return [...((this._orgMembers && this._orgMembers.get(orgId)) || [])];
  }

  /** Test seam: seed an org's active member ids for the in-memory engine. */
  seedOrgMembers(orgId, userIds) {
    if (!this._orgMembers) this._orgMembers = new Map();
    this._orgMembers.set(orgId, [...(userIds || [])]);
  }

  /**
   * Profile ids of the administrators who should hear about a delivery that needs
   * one. Suspended, deleted and anonymised accounts are skipped. Without a
   * database (tests, a laptop) it reads `_adminIds`, which is empty by default.
   */
  async listAdminIds({ limit = 20 } = {}) {
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db
          .from('profiles')
          .select('*')
          .in('primary_role', ADMIN_ROLES)
          .limit(limit * 2);
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.listAdminIds');
        else {
          return (data || [])
            .filter((p) => p.account_status !== 'anonymized' && p.account_status !== 'suspended'
              && p.status !== 'deleted' && p.status !== 'suspended' && !p.deleted_at)
            .map((p) => p.id)
            .slice(0, limit);
        }
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.listAdminIds');
      }
    }
    return (this._adminIds || []).slice(0, limit);
  }

  /**
   * Whether the delivery tables exist in this database: `{ ready: true }`, or
   * `{ ready: false, reason }`. For the boot-time check; it never throws, and it
   * says "not ready" only for a missing table, not for a flaky network.
   */
  async probe() {
    const db = this.db;
    if (!db) return { ready: true, reason: 'in-memory store (no database client)' };
    try {
      const { error } = await db.from('deliveries').select('id').limit(1);
      if (!error) {
        // Dispatch offers work only to riders who are online, which it reads from the
        // presence table: without it nobody can be offered anything.
        const presence = await db.from('rider_presence').select('rider_id').limit(1);
        if (presence.error && isMissingTable(presence.error)) {
          return { ready: false, reason: 'iam.rider_presence does not exist: apply migration 017_rider_presence.sql' };
        }
        return { ready: true };
      }
      if (isMissingTable(error)) return { ready: false, reason: 'iam.deliveries does not exist: apply migrations 013 and 014' };
      return { ready: true, reason: `could not check (${error.code || error.message})` };
    } catch (err) {
      return { ready: true, reason: `could not check (${err.message})` };
    }
  }

  /** Asserts a record exists; convenience for callers that already hold an id. */
  async requireById(id) {
    const d = await this.findById(id);
    if (!d) throw new NotFoundError('Delivery', id);
    return d;
  }
}

module.exports = { DeliveryRepository, DeliveryNotReadyError, toRow, fromRow };
