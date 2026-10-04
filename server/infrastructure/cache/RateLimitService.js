/**
 * Centralized Rate Limiting Service
 * Sliding-window counter backed by Redis or In-Memory map
 */

const crypto = require('crypto');
const ipaddr = require('ipaddr.js');
const RedisConnection = require('./RedisConnection');
const { RateLimitError } = require('../../shared/errors/AppError');
const { ServiceUnavailableError } = require('../../shared/errors/AppError');
const { config } = require('../../config/env');
const logger = require('../../shared/logging/logger');

/**
 * Return one stable representation for an address. Node commonly exposes an
 * IPv4 peer as ::ffff:a.b.c.d, while forwarding infrastructure may use the
 * dotted form. Treating those as different clients makes a limiter easy to
 * dilute. Invalid values are deliberately not trusted as client identity.
 */
function normalizeAddress(value) {
  if (typeof value !== 'string' || !value.trim()) return null;

  let candidate = value.trim().toLowerCase();
  if (candidate.startsWith('[') && candidate.endsWith(']')) {
    candidate = candidate.slice(1, -1);
  }
  // Zone identifiers are not meaningful for an HTTP peer identity and are
  // rejected by ipaddr.js. Removing them also prevents equivalent forms from
  // producing separate buckets.
  candidate = candidate.split('%')[0];

  try {
    const parsed = ipaddr.parse(candidate);
    if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) {
      return parsed.toIPv4Address().toString();
    }
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

// The memory fallback has no server-side reaper the way Redis EXPIRE does, so
// exhausted buckets are swept here. Sweeping is time-gated so a full scan never
// runs per request.
const MEMORY_SWEEP_INTERVAL_MS = 30000;

class RateLimitService {
  constructor() {
    this.redis = RedisConnection.getInstance();
    this.memoryBuckets = new Map(); // key -> { timestamps, expiresAt }
    this.lastMemorySweepAt = 0;
  }

  /**
   * Drop buckets whose window has fully elapsed. Without this the fallback map
   * keeps one entry per distinct caller key forever, so a Redis outage plus
   * rotating source addresses grows it without bound until the process dies.
   */
  _sweepMemoryBuckets(now) {
    if (now - this.lastMemorySweepAt < MEMORY_SWEEP_INTERVAL_MS) return;
    this.lastMemorySweepAt = now;
    for (const [key, bucket] of this.memoryBuckets) {
      if (!bucket || bucket.expiresAt <= now) {
        this.memoryBuckets.delete(key);
      }
    }
  }

  /**
   * Boolean check if request is allowed without throwing
   */
  async isAllowed(key, maxRequests = 100, windowSeconds = 60) {
    try {
      const res = await this.consume(key, maxRequests, windowSeconds);
      return { allowed: true, ...res };
    } catch (err) {
      if (err instanceof RateLimitError) {
        return { allowed: false, retryAfter: err.retryAfterSeconds || windowSeconds };
      }
      throw err;
    }
  }

  /**
   * Check and consume tokens for a given key
   * @param {string} key - Identifier (e.g. IP address or userId)
   * @param {number} maxRequests - Max requests allowed in the window
   * @param {number} windowSeconds - Window size in seconds
   */
  async consume(key, maxRequests = 100, windowSeconds = 60, requireRedis = false) {
    if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) {
      throw new TypeError('maxRequests must be a positive safe integer');
    }
    if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
      throw new TypeError('windowSeconds must be a positive number');
    }

    // Hash caller-derived keys before they reach Redis or the memory map. This
    // bounds key length and prevents control characters or delimiters in a
    // custom key from changing the storage namespace.
    const safeKey = typeof key === 'string' ? key.slice(0, 256) : String(key == null ? 'unknown' : key);
    const keyDigest = crypto.createHash('sha256').update(safeKey).digest('hex');
    const rateLimitKey = `ratelimit:${keyDigest}`;
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - windowMs;

    try {
      if (this.redis && this.redis.status === 'ready') {
        const multi = this.redis.multi();
        // Remove items older than window
        multi.zremrangebyscore(rateLimitKey, 0, windowStart);
        // Add current timestamp
        multi.zadd(rateLimitKey, now, `${now}-${crypto.randomUUID()}`);
        // Count requests in window
        multi.zcard(rateLimitKey);
        // Set expiry on bucket
        multi.expire(rateLimitKey, windowSeconds);

        const results = await multi.exec();
        const requestCount = results && results[2] && results[2][1];
        if (!Number.isFinite(requestCount)) {
          throw new Error('Redis returned an invalid rate-limit counter');
        }

        if (requestCount > maxRequests) {
          const retryAfter = Math.ceil(windowSeconds);
          throw new RateLimitError(`Rate limit exceeded (${requestCount}/${maxRequests}). Try again in ${retryAfter}s.`, retryAfter);
        }

        return {
          allowed: true,
          remaining: Math.max(0, maxRequests - requestCount),
          total: maxRequests,
          resetInSeconds: windowSeconds
        };
      }
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      if (requireRedis) throw new ServiceUnavailableError('The assistant is temporarily unavailable.');
      logger.warn(`[RateLimitService] Redis rate limit unavailable, using memory fallback: ${err.message}`);
    }

    if (requireRedis) throw new ServiceUnavailableError('The assistant is temporarily unavailable.');
    // In-memory fallback
    const bucket = this.memoryBuckets.get(rateLimitKey);
    let timestamps = bucket ? bucket.timestamps : [];
    timestamps = timestamps.filter(ts => ts > windowStart);
    timestamps.push(now);
    this.memoryBuckets.set(rateLimitKey, { timestamps, expiresAt: now + windowMs });
    this._sweepMemoryBuckets(now);

    if (timestamps.length > maxRequests) {
      throw new RateLimitError(`Rate limit exceeded (${timestamps.length}/${maxRequests}).`, windowSeconds);
    }

    return {
      allowed: true,
      remaining: maxRequests - timestamps.length,
      total: maxRequests,
      resetInSeconds: windowSeconds
    };
  }

  /**
   * Chooses the bucket a request is counted against. `req.ip` is Express's
   * proxy-aware, server-derived value. Never parse X-Forwarded-For here: that
   * header is attacker-controlled unless the configured ingress has already
   * established a trusted boundary.
   */
  resolveKey(req) {
    const ip = normalizeAddress(req && (req.ip || (req.socket && req.socket.remoteAddress)));
    return `ip:${ip || 'unknown'}`;
  }

  /**
   * Return the effective client bucket plus the immediate peer bucket. The
   * second bucket is an abuse backstop: if a caller can reach the service
   * through a shared ingress and varies a forged forwarded address, requests
   * still exhaust the ingress peer's quota instead of creating unlimited
   * client buckets.
   */
  resolveKeys(req) {
    const clientKey = this.resolveKey(req);
    const peerIp = normalizeAddress(req && req.socket && req.socket.remoteAddress);
    if (!peerIp) return [clientKey];

    const peerKey = `peer:${peerIp}`;
    return clientKey === `ip:${peerIp}` ? [peerKey] : [peerKey, clientKey];
  }

  middleware({ maxRequests = 60, windowSeconds = 60, keyGenerator = null, peerMaxRequests = maxRequests, keyPrefix = '', requireRedis = false } = {}) {
    return async (req, res, next) => {
      if (config.isProduction && (!this.redis || this.redis.status !== 'ready')) {
        // Liveness must remain probeable while the service is starting. The
        // signed webhook is also allowed to reach its signature verifier so a
        // missing Redis instance cannot turn an unsigned-event configuration
        // check into a generic infrastructure response. All other API traffic
        // falls through to the in-memory sliding window below: an unreachable
        // Redis must degrade the limiter, never take the whole API down.
        const path = req.originalUrl || req.path || '';
        const operationalProbe = /^\/api\/v1\/(?:health|healthz)(?:[/?]|$)/.test(path);
        const signedWebhook = /^\/api\/v1\/webhooks\/clerk(?:[/?]|$)/.test(path);
        if (operationalProbe || signedWebhook) return next();
      }

      const rawKeys = keyGenerator ? [keyGenerator(req)] : this.resolveKeys(req);
      const keys = rawKeys.map(key => keyPrefix ? `${keyPrefix}:${key}` : key);

      try {
        let result = null;
        // Check the immediate peer first. It is the bounded safety net for
        // spoofed forwarding headers and avoids creating attacker-sized client
        // bucket maps after the peer has already been blocked.
        for (let index = 0; index < keys.length; index++) {
          const bucketLimit = !keyGenerator && index === 0 && keys.length > 1
            ? peerMaxRequests
            : maxRequests;
          result = await this.consume(keys[index], bucketLimit, windowSeconds, requireRedis);
        }
        res.setHeader('X-RateLimit-Limit', result.total);
        res.setHeader('X-RateLimit-Remaining', result.remaining);
        res.setHeader('X-RateLimit-Reset', result.resetInSeconds);
        next();
      } catch (err) {
        if (err instanceof RateLimitError) {
          res.setHeader('Retry-After', String(err.retryAfterSeconds));
          res.setHeader('X-RateLimit-Limit', String(maxRequests));
          res.setHeader('X-RateLimit-Remaining', '0');
          res.setHeader('X-RateLimit-Reset', String(windowSeconds));
        }
        next(err);
      }
    };
  }
}

const service = new RateLimitService();
service.normalizeAddress = normalizeAddress;
service.RateLimitService = RateLimitService;
module.exports = service;
