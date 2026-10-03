/**
 * LOUMOO Delivery — Repository
 * ---------------------------------------------------------------------------
 * Persistence for riders, deliveries, the status timeline and GPS history on
 * `iam.delivery_drivers`, `iam.deliveries`, `iam.delivery_events` and
 * `iam.driver_locations` (migration 013).
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

const { SupabaseDatabase, handleDatabaseFailure } = require('../../../infrastructure/database/SupabaseClient');
const { ConflictError, NotFoundError, ValidationError, InfrastructureError } = require('../../../shared/errors/AppError');
const { config } = require('../../../config/env');
const logger = require('../../../shared/logging/logger');
const {
  DELIVERY_STATUS, TERMINAL_STATUSES, WORKLOAD_STATUSES, DRIVER_STATUS, OFFER_EXPIRED_NOTE
} = require('../domain/Delivery');

const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
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
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
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
        if (error) handleDatabaseFailure(error, 'DeliveryRepository.findStaleOffers');
        else return (data || []).map(fromRow);
      } catch (err) {
        handleDatabaseFailure(err, 'DeliveryRepository.findStaleOffers');
      }
    }
    return [...this._deliveries.values()]
      .filter((d) => d.status === DELIVERY_STATUS.ASSIGNED && d.assignedAt && Date.parse(d.assignedAt) <= cutoff)
      .sort((a, b) => Date.parse(a.assignedAt) - Date.parse(b.assignedAt))
      .slice(0, limit)
      .map((d) => ({ ...d }));
  }

  /**
   * How many deliveries each rider is carrying right now (assigned, accepted,
   * picked up or arrived), as `Map<driverId, count>`. Riders with none are absent.
   */
  async countOpenByDriver() {
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('deliveries').select('driver_id')
          .in('status', [...WORKLOAD_STATUSES])
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
      .filter((d) => d.driverId && WORKLOAD_STATUSES.includes(d.status))
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

  async upsertDriver({ profileId, name, phone, status = DRIVER_STATUS.ACTIVE, createdBy = null }) {
    const now = new Date().toISOString();
    const db = this.db;
    if (db) {
      try {
        const { data, error } = await db.from('delivery_drivers').upsert({
          profile_id: profileId,
          display_name: name,
          phone,
          status,
          created_by: createdBy,
          updated_at: now
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
    const stored = {
      id: profileId, name, phone, status, createdBy,
      createdAt: existing ? existing.createdAt : now, updatedAt: now
    };
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

  /** Asserts a record exists; convenience for callers that already hold an id. */
  async requireById(id) {
    const d = await this.findById(id);
    if (!d) throw new NotFoundError('Delivery', id);
    return d;
  }
}

module.exports = { DeliveryRepository, toRow, fromRow };
