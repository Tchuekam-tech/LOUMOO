/**
 * LOUMOO Delivery — Offer sweeper
 * ---------------------------------------------------------------------------
 * Returns rider offers nobody answered to their sellers on a timer (see "Offer
 * expiry" in docs/DELIVERY_API.md). The reads already release a lapsed offer
 * when someone looks at it; this covers the case where nobody does, so the
 * seller is told the rider went quiet instead of finding out later.
 *
 * Only for a long-lived process. A serverless runtime cannot keep a timer, and
 * relies on the release-on-read alone.
 */

const logger = require('../../../shared/logging/logger');

const DEFAULT_INTERVAL_MS = 60 * 1000;
const DEFAULT_BATCH = 50;

/**
 * Starts the sweep. Returns `{ tick, stop, timer }`: `tick()` runs one sweep now
 * (what the timer calls, exposed for tests and for an operator), `stop()` clears
 * the timer. The timer is unref'd, so it never keeps the process alive.
 *
 * Timer functions are injectable so the behaviour can be tested without waiting.
 */
function startOfferSweeper({
  service,
  intervalMs = DEFAULT_INTERVAL_MS,
  limit = DEFAULT_BATCH,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
} = {}) {
  if (!service || typeof service.expireStaleOffers !== 'function') {
    throw new TypeError('startOfferSweeper needs a delivery service with expireStaleOffers()');
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
    throw new RangeError('startOfferSweeper: intervalMs must be at least 1000');
  }

  let running = false;

  async function tick() {
    // A slow sweep must not be overtaken by the next tick: two sweeps would only
    // race each other for the same rows.
    if (running) return { expired: 0, skipped: true };
    running = true;
    try {
      const result = await service.expireStaleOffers({ limit });
      if (result.expired > 0) logger.info(`[OfferSweeper] returned ${result.expired} lapsed offer(s) to their sellers`);
      return result;
    } catch (err) {
      // Never let a failed sweep become an unhandled rejection on a timer.
      logger.error(`[OfferSweeper] sweep failed: ${err.message}`);
      return { expired: 0, failed: true };
    } finally {
      running = false;
    }
  }

  // Expiry switched off (DELIVERY_OFFER_TTL_MINUTES=0): nothing to sweep, so do
  // not hold a timer that wakes every minute to do nothing.
  if (!(service.offerTtlMs > 0)) {
    logger.info('[OfferSweeper] offer expiry is off; not scheduling a sweep');
    return { tick, stop: () => {}, timer: null };
  }

  const timer = setIntervalFn(tick, intervalMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return { tick, stop: () => clearIntervalFn(timer), timer };
}

module.exports = { startOfferSweeper, DEFAULT_INTERVAL_MS, DEFAULT_BATCH };
