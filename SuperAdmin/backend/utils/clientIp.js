/**
 * LOUMOO SuperAdmin — clientIp
 * ---------------------------------------------------------------------------
 * Best-effort client IP for audit attribution.
 *
 * Trusts Express's `req.ip`, which already honours the app's configured
 * `trust proxy` setting (Railway/Vercel single-hop ingress — see server config),
 * so behind the proxy it is the real caller rather than the proxy hop. Falls
 * back to the raw socket address and never touches the deprecated
 * `req.connection`, so it cannot throw on a minimal or mocked request. Returns
 * null when the address is unknown rather than a misleading placeholder.
 */
function clientIp(req) {
  if (!req) return null;
  return req.ip || (req.socket && req.socket.remoteAddress) || null;
}

module.exports = { clientIp };
