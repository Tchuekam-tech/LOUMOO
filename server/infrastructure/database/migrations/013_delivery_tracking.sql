-- ============================================================================
-- LOUMOO — Migration 013: Delivery tracking
-- ----------------------------------------------------------------------------
-- Adds the delivery layer on top of iam.orders:
--
--   iam.delivery_drivers   riders, created by an admin (there is no rider role
--                          on iam.profiles today; a rider is a profile that has
--                          an active row here)
--   iam.deliveries         one live delivery per HOME_DELIVERY order, with its
--                          own status machine (see docs/DELIVERY_API.md)
--   iam.delivery_events    append-only status timeline
--   iam.driver_locations   GPS history for a delivery (disputes, replays)
--
-- The backend is the only reader/writer (service-role client). RLS is enabled
-- with a service-role policy ONLY, so nothing here is reachable with an end
-- user's JWT: the handover-code nonce and attempt counter must never leave the
-- server, and the API layer decides what each participant may see.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- 1. Riders ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iam.delivery_drivers (
    profile_id    VARCHAR(64) PRIMARY KEY REFERENCES iam.profiles(id) ON DELETE CASCADE,
    display_name  VARCHAR(120) NOT NULL,
    phone         VARCHAR(32)  NOT NULL,
    status        VARCHAR(16)  NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended')),
    created_by    VARCHAR(64) REFERENCES iam.profiles(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Deliveries -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iam.deliveries (
    id               VARCHAR(64) PRIMARY KEY,
    order_id         VARCHAR(64) NOT NULL REFERENCES iam.orders(id) ON DELETE RESTRICT,
    -- Denormalised from the order so participant checks (and the 3-second
    -- location pings) never have to load the order row.
    buyer_id         VARCHAR(64) NOT NULL REFERENCES iam.profiles(id) ON DELETE RESTRICT,
    seller_id        VARCHAR(64) REFERENCES iam.profiles(id) ON DELETE SET NULL,
    driver_id        VARCHAR(64) REFERENCES iam.delivery_drivers(profile_id) ON DELETE SET NULL,
    status           VARCHAR(24) NOT NULL DEFAULT 'pending_assignment'
                       CHECK (status IN (
                         'pending_assignment', 'assigned', 'accepted', 'picked_up',
                         'arrived', 'delivered', 'failed', 'cancelled'
                       )),
    pickup           JSONB NOT NULL DEFAULT '{}'::jsonb,
    dropoff          JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Handover code = HMAC(server key, id | nonce) truncated to 4 digits. Only
    -- the nonce is stored, so a database dump reveals no live code. Bumped
    -- when a failed delivery is re-assigned so the old code stops working.
    handover_nonce   INTEGER NOT NULL DEFAULT 1,
    code_attempts    INTEGER NOT NULL DEFAULT 0 CHECK (code_attempts >= 0),
    eta_minutes      INTEGER CHECK (eta_minutes IS NULL OR eta_minutes >= 0),
    distance_km      NUMERIC(8, 2) CHECK (distance_km IS NULL OR distance_km >= 0),
    last_location    JSONB,
    failure_reason   TEXT,
    assigned_at      TIMESTAMPTZ,
    accepted_at      TIMESTAMPTZ,
    picked_up_at     TIMESTAMPTZ,
    arrived_at       TIMESTAMPTZ,
    delivered_at     TIMESTAMPTZ,
    cancelled_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "A rider is set from `assigned` onward" is enforced by the service, not a
-- CHECK: driver_id is ON DELETE SET NULL (so deleting an account never blocks),
-- and a CHECK would turn that cascade into a failed account deletion.

-- At most ONE open delivery per order. This is what makes "create delivery"
-- safe against a double click or two sellers' tabs racing each other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_deliveries_one_open_per_order
    ON iam.deliveries(order_id)
    WHERE status NOT IN ('delivered', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_deliveries_order   ON iam.deliveries(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_buyer   ON iam.deliveries(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_seller  ON iam.deliveries(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_driver_open
    ON iam.deliveries(driver_id, updated_at DESC)
    WHERE driver_id IS NOT NULL AND status NOT IN ('delivered', 'cancelled');

-- 3. Status timeline ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iam.delivery_events (
    id               BIGSERIAL PRIMARY KEY,
    delivery_id      VARCHAR(64) NOT NULL REFERENCES iam.deliveries(id) ON DELETE CASCADE,
    status           VARCHAR(24) NOT NULL,
    previous_status  VARCHAR(24),
    actor_id         VARCHAR(64),
    note             TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_events_delivery
    ON iam.delivery_events(delivery_id, id);

-- 4. GPS history ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iam.driver_locations (
    id           BIGSERIAL PRIMARY KEY,
    delivery_id  VARCHAR(64) NOT NULL REFERENCES iam.deliveries(id) ON DELETE CASCADE,
    driver_id    VARCHAR(64) NOT NULL,
    lat          DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng          DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
    -- DOUBLE PRECISION, not REAL: the service validates heading < 360 as a
    -- double, and a float4 can round 359.99999 up to 360 and violate the CHECK.
    speed_kmh    DOUBLE PRECISION CHECK (speed_kmh IS NULL OR speed_kmh >= 0),
    heading      DOUBLE PRECISION CHECK (heading IS NULL OR (heading >= 0 AND heading < 360)),
    accuracy_m   DOUBLE PRECISION CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_locations_delivery
    ON iam.driver_locations(delivery_id, recorded_at DESC);

-- GPS history is the one table here that grows without bound (one row per
-- accepted ping). Storage is small but not free, so retention is explicit:
-- run `SELECT iam.prune_driver_locations(30);` from a scheduled job.
CREATE OR REPLACE FUNCTION iam.prune_driver_locations(retain_days INTEGER DEFAULT 30)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    removed BIGINT;
BEGIN
    IF retain_days IS NULL OR retain_days < 1 THEN
        RAISE EXCEPTION 'retain_days must be at least 1';
    END IF;
    DELETE FROM iam.driver_locations
     WHERE recorded_at < NOW() - make_interval(days => retain_days)
       AND delivery_id IN (
            SELECT id FROM iam.deliveries WHERE status IN ('delivered', 'cancelled')
       );
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION iam.prune_driver_locations(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam.prune_driver_locations(INTEGER) TO service_role;

-- 5. Row Level Security -----------------------------------------------------------
ALTER TABLE iam.delivery_drivers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.deliveries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.delivery_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.driver_locations  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to delivery_drivers" ON iam.delivery_drivers;
CREATE POLICY "Service role full access to delivery_drivers"
    ON iam.delivery_drivers FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to deliveries" ON iam.deliveries;
CREATE POLICY "Service role full access to deliveries"
    ON iam.deliveries FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to delivery_events" ON iam.delivery_events;
CREATE POLICY "Service role full access to delivery_events"
    ON iam.delivery_events FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to driver_locations" ON iam.driver_locations;
CREATE POLICY "Service role full access to driver_locations"
    ON iam.driver_locations FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- 6. Privileges for the service role ---------------------------------------------
-- RLS above restricts these tables to the service role, but a policy is NOT a
-- GRANT. Supabase auto-grants table privileges to the API roles when a table is
-- created, yet the BIGSERIAL sequences in this (non-public) schema are missed,
-- so INSERT into delivery_events / driver_locations fails with SQLSTATE 42501
-- ("permission denied for sequence") because nextval() needs USAGE. Grant the
-- table and sequence privileges explicitly. Idempotent: GRANT is repeatable, and
-- pg_get_serial_sequence resolves the sequence name however it was created.
GRANT ALL ON iam.delivery_drivers, iam.deliveries, iam.delivery_events, iam.driver_locations
    TO service_role;

DO $$
BEGIN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE '
        || pg_get_serial_sequence('iam.delivery_events', 'id') || ' TO service_role';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE '
        || pg_get_serial_sequence('iam.driver_locations', 'id') || ' TO service_role';
END $$;
