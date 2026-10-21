/**
 * LOUMOO — Security Headers Middleware
 * -------------------------------------------------------------------------
 * Adds the baseline HSTS/OPS headers that reverse proxies (Cloudflare,
 * Netlify, Nginx) cannot add on the app's behalf and that no dependency
 * currently provides (the 'helmet' package is deliberately NOT a dependency).
 *
 * The CSP lists every third-party origin the shell and its service modules load
 * from. vercel.json sends the same policy on the statically served home page
 * (tests/unit/security_headers_csp.test.js keeps the two identical). When a module
 * starts loading from a new host, add it here or the browser blocks it.
*/

// The delivery-tracking map and the rider hub (src/services/deliveryTrackingScreen.js,
// riderHub.js) load MapLibre's script and stylesheet from cdnjs and fetch styles,
// tiles, glyphs and geocoding from these hosts.
const MAP_SCRIPT_HOSTS = 'https://cdnjs.cloudflare.com';
const MAP_DATA_HOSTS = 'https://tiles.openfreemap.org https://demotiles.maplibre.org https://server.arcgisonline.com https://nominatim.openstreetmap.org';

const DEFAULT_CSP = [
  "default-src 'self'",
  // ElevenLabs loads its bundled AudioWorklet modules through blob URLs.
  `script-src 'self' blob: 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net ${MAP_SCRIPT_HOSTS} https://*.supabase.co https://*.clerk.accounts.dev https://clerk.loumoo.cm https://challenges.cloudflare.com`,
  "worker-src 'self' blob:",
  "frame-src 'self' https://challenges.cloudflare.com https://*.clerk.accounts.dev",
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${MAP_SCRIPT_HOSTS}`,
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' https://*.supabase.co https://*.clerk.accounts.dev https://clerk.loumoo.cm https://api.clerk.com https://us.i.posthog.com https://unpkg.com https://*.ingest.sentry.io https://sentry.io https://challenges.cloudflare.com https://api.elevenlabs.io wss://api.elevenlabs.io ${MAP_DATA_HOSTS}`,
  "media-src 'self' blob: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

const PERMISSIONS_POLICY = 'microphone=(self), camera=(self)';
const HSTS = 'max-age=31536000; includeSubDomains';

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  res.setHeader('Content-Security-Policy', DEFAULT_CSP);

  if (req.secure || req.protocol === 'https') {
    res.setHeader('Strict-Transport-Security', HSTS);
  }

  next();
}

module.exports = { securityHeaders, DEFAULT_CSP, PERMISSIONS_POLICY, HSTS };
