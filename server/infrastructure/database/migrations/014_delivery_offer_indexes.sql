-- ============================================================================
-- LOUMOO — Migration 014: indexes for the delivery offer queries
-- ----------------------------------------------------------------------------
-- Migration 013 indexed the delivery tables for the reads the first two steps
-- made: by order, by buyer, by seller, by rider, and a delivery's timeline.
-- Driver assignment (step 2c) added two hot queries that none of those indexes
-- can serve, so both are sequential scans today:
--
--   1. the stale-offer sweep (DeliveryRepository.findStaleOffers) --
--      status = 'assigned' AND assigned_at <= cutoff, oldest first. It runs
--      once a minute from the sweeper, and again before every rider listing and
--      every auto-assign;
--
--   2. the non-responder penalty (DeliveryRepository.countRecentLapses) --
--      the hand-back rows of the last hour, read on every rider listing and
--      every auto-assign. iam.delivery_events only has (delivery_id, id), which
--      answers "this delivery's timeline" and nothing else.
--
-- Both tables are append-mostly and grow with traffic: delivery_events gains a
-- row for every status change of every delivery. At a few thousand deliveries
-- the scans are unnoticeable, which is why 013 shipped without them; they get
-- steadily worse from there, and the cost falls on the seller's rider picker.
--
-- Both indexes are PARTIAL, on the shape the query asks for, so they stay a
-- small fraction of each table.
--
-- The lapse index deliberately does NOT mention the note text that
-- OFFER_EXPIRED_NOTE holds, although the query filters on it. Putting a string
-- constant from the application into an index predicate would mean that editing
-- that sentence silently stops the index matching. The hand-back shape
-- (pending_assignment <- assigned) is already selective; the note and the actor
-- are rechecked on the few rows that survive.
--
-- Idempotent: safe to re-run. Adding an index changes no data and no behaviour,
-- and either can be dropped again with no application change.
-- ============================================================================

-- 1. The stale-offer sweep ------------------------------------------------------
-- Serves: WHERE status = 'assigned' AND assigned_at <= $1 ORDER BY assigned_at
-- Only offers awaiting an answer are in it, so it holds a handful of rows at a
-- time however large the table grows.
CREATE INDEX IF NOT EXISTS idx_deliveries_stale_offers
    ON iam.deliveries(assigned_at)
    WHERE status = 'assigned';

-- 2. The non-responder penalty --------------------------------------------------
-- Serves: WHERE status = 'pending_assignment' AND previous_status = 'assigned'
--           AND note = $1 AND created_at >= $2
-- The partial predicate covers the two status columns; created_at orders the
-- window; note and actor_id are rechecked.
CREATE INDEX IF NOT EXISTS idx_delivery_events_offer_handbacks
    ON iam.delivery_events(created_at DESC)
    WHERE status = 'pending_assignment' AND previous_status = 'assigned';
