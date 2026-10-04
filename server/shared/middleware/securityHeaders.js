/**
 * LOUMOO — Security Headers Middleware
 * -------------------------------------------------------------------------
 * Adds the baseline HSTS/OPS headers that reverse proxies (Cloudflare,
 * Netlify, Nginx) cannot add on the app's behalf and that no dependency
 * currently provides (the 'helmet' package is deliberately NOT a dependency).
 *
*/

const DEFAULT_CSP = [
  "default-src 'self'",
  // ElevenLabs loads its bundled AudioWorklet modules through blob URLs.
  "script-src 'self' blob: 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net https://*.supabase.co https://*.clerk.accounts.dev https://clerk.loumoo.cm https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "frame-src 'self' https://challenges.cloudflare.com https://*.clerk.accounts.dev",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co https://*.clerk.accounts.dev https://clerk.loumoo.cm https://api.clerk.com https://us.i.posthog.com https://unpkg.com https://*.ingest.sentry.io https://sentry.io https://challenges.cloudflare.com https://api.elevenlabs.io wss://api.elevenlabs.io",
  "media-src 'self' blob: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self)');
  res.setHeader('Content-Security-Policy', DEFAULT_CSP);

  if (req.secure || req.protocol === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

module.exports = { securityHeaders, DEFAULT_CSP };
