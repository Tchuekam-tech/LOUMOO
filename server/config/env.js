/**
 * LOUMOO Typed Environment Configuration
 * ---------------------------------------------------------------------------
 * THE single place environment variables are read. `server/config/index.js`
 * re-exports this module — there is intentionally only one config object.
 *
 * Production policy: the server refuses to boot when a credential that
 * security depends on is missing (severity 'error'). A misconfigured
 * production deployment must fail loudly at startup, never degrade silently
 * into a permissive mode.
 *
 * Some capabilities are deliberately WARNING-level rather than boot blockers:
 * Redis absence makes protected API traffic fail closed, and
 * CLERK_WEBHOOK_SECRET absence makes the webhook answer 503 without processing
 * unsigned identity events. Blocking the whole deployment on either capability
 * would hide the safe degraded behavior and turn it into an availability bug.
 */

const { z } = require('zod');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Priority load order: .env.local -> .env
const envLocalPath = path.resolve(process.cwd(), '.env.local');
const envPath = path.resolve(process.cwd(), '.env');

if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const envSchema = z.object({
  // Server
  PORT: z.string().default('8080').transform(val => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  APP_NAME: z.string().default('LOUMOO Universal Commerce Platform'),
  APP_BASE_URL: z.string().default('http://localhost:8080'),
  CORS_ORIGINS: z.string().default('*').transform(val => val.split(',').map(o => o.trim()).filter(Boolean)),
  // Express proxy trust policy. Keep this explicit: trusting every proxy lets
  // a direct caller forge X-Forwarded-For and X-Forwarded-Proto.
  TRUST_PROXY: z.string().optional(),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10).optional(),
  SUPABASE_ANON_KEY: z.string().min(10).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10).optional(),
  SUPABASE_PROJECT_REF: z.string().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  SUPABASE_MANAGEMENT_TOKEN: z.string().optional(),
  DATABASE_DIRECT_HOST: z.string().optional(),

  // Object storage (listing media)
  SUPABASE_STORAGE_BUCKET: z.string().default('listing-media'),

  // Clerk — the identity provider
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_APP_ID: z.string().optional(),
  CLERK_WEBHOOK_SECRET: z.string().optional(),
  // Comma-separated list of origins Clerk session tokens may be presented from.
  CLERK_AUTHORIZED_PARTIES: z.string().optional(),

  // Phone verification provider. LOUMOO never fakes an SMS: when this is unset
  // the phone verification endpoints answer 503 PHONE_VERIFICATION_NOT_CONFIGURED.
  //   'clerk'  -> phone numbers are verified through the Clerk identity provider
  //   'none'   -> phone verification is unavailable in this deployment
  PHONE_VERIFICATION_PROVIDER: z.enum(['clerk', 'none']).default('none'),

  // Redis
  REDIS_URL: z.string().optional(),

  // Development-only authentication bypass for the automated test suite.
  // Hard-disabled when NODE_ENV=production regardless of value (see below).
  LOUMOO_TEST_AUTH_SECRET: z.string().optional(),

  // AISStream
  AISSTREAM_API_KEY: z.string().optional(),
  // OpenAI-compatible base URL for the AISStream LLM chat provider
  // (e.g. https://api.openai.com/v1 or a self-hosted OpenAI-compatible gateway).
  // Leave empty when using the deterministic offline listing-AI baseline.
  AISSTREAM_BASE_URL: z.string().optional(),
  AISSTREAM_MODEL: z.string().optional(),

  // Google SMTP / App Password
  GOOGLE_APP_PASSWORD: z.string().optional(),

  // ElevenLabs
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_AGENT_ID: z.string().optional(),
  SEARCH_ENABLED: z.enum(['true', 'false']).default('false'),
  OPENAI_API_KEY: z.string().optional(),
  SEARCH_AI_MODEL: z.string().optional(),

  // PostHog
  POSTHOG_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().default('https://us.i.posthog.com'),

  // GitHub & Netlify
  GITHUB_TOKEN: z.string().optional(),
  NETLIFY_AUTH_TOKEN: z.string().optional(),

  // Sentry
  SENTRY_DSN: z.string().optional(),

  // Resend
  RESEND_API_KEY: z.string().optional()
});

let parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('[EnvValidation] Critical environment configuration errors:');
  parsedEnv.error.issues.forEach(issue => {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  });
  // Discard only the invalid variables. Falling back to raw process.env for
  // everything (e.g. because SUPABASE_ANON_KEY= is empty) left CORS_ORIGINS a
  // plain string, so `corsOrigins.includes(origin)` became a substring match
  // that admitted look-alike origins with credentials.
  const validOnly = { ...process.env };
  parsedEnv.error.issues.forEach(issue => { delete validOnly[issue.path[0]]; });
  parsedEnv = envSchema.safeParse(validOnly);
}

const env = parsedEnv.success ? parsedEnv.data : process.env;

// An invalid NODE_ENV (e.g. "prod") must not be discarded in favour of the
// 'development' default, which would enable development-only behaviour.
const nodeEnv = process.env.NODE_ENV || env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

/**
 * Convert the operator-facing TRUST_PROXY value into the value Express
 * expects. Railway's public service has one platform ingress hop, so its
 * production setting is TRUST_PROXY=1. Development deliberately trusts no
 * proxy by default; the test harness opts into one hop to exercise forwarded
 * request behavior.
 */
function parseTrustProxy(rawValue, environment) {
  const defaultVal = (environment === 'test' || environment === 'production') ? '1' : 'false';
  const raw = String(rawValue == null ? defaultVal : rawValue).trim();

  if (!raw || ['false', '0', 'off', 'none'].includes(raw.toLowerCase())) return false;
  if (['true', 'on', 'all'].includes(raw.toLowerCase())) return true;
  if (/^\d+$/.test(raw)) return Number(raw);

  const entries = raw.split(',').map(item => item.trim()).filter(Boolean);
  return entries.length === 1 ? entries[0] : entries;
}

const trustProxyRaw = typeof process.env.TRUST_PROXY === 'string'
  ? process.env.TRUST_PROXY.trim()
  : '';

const config = {
  port: env.PORT || 8080,
  nodeEnv,
  isProduction,
  isDevelopment: nodeEnv === 'development',
  isTest,
  appName: env.APP_NAME || 'LOUMOO Universal Commerce Platform',
  baseUrl: env.APP_BASE_URL || 'http://localhost:8080',
  corsOrigins: env.CORS_ORIGINS || ['*'],
  proxy: {
    trust: parseTrustProxy(env.TRUST_PROXY, nodeEnv),
    trustRaw: trustProxyRaw || ((isTest || isProduction) ? '1' : 'false'),
    explicitlyConfigured: Boolean(trustProxyRaw)
  },

  supabase: {
    url: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '',
    anonKey: env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    projectRef: env.SUPABASE_PROJECT_REF || '',
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY || '',
    jwtSecret: env.SUPABASE_JWT_SECRET || '',
    managementToken: env.SUPABASE_MANAGEMENT_TOKEN || '',
    directHost: env.DATABASE_DIRECT_HOST || '',
    storageBucket: env.SUPABASE_STORAGE_BUCKET || 'listing-media'
  },

  clerk: {
    publishableKey: env.CLERK_PUBLISHABLE_KEY || env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '',
    secretKey: env.CLERK_SECRET_KEY || '',
    appId: env.CLERK_APP_ID || '',
    webhookSecret: env.CLERK_WEBHOOK_SECRET || '',
    authorizedParties: (env.CLERK_AUTHORIZED_PARTIES || '')
      .split(',').map(o => o.trim()).filter(Boolean)
  },

  verification: {
    // Email verification is always owned by Clerk (the identity provider).
    emailProvider: 'clerk',
    phoneProvider: env.PHONE_VERIFICATION_PROVIDER || 'none',
    get phoneEnabled() {
      return this.phoneProvider !== 'none';
    }
  },

  redis: {
    url: env.REDIS_URL || ''
  },

  /**
   * Development-only test authentication.
   *
   * Enabled ONLY when: NODE_ENV is not production AND a secret is configured.
   * The production check is not a policy that can be overridden by an env var —
   * `enabled` is false in production even if the secret is present.
   */
  testAuth: {
    secret: env.LOUMOO_TEST_AUTH_SECRET || '',
    enabled: !isProduction && Boolean(env.LOUMOO_TEST_AUTH_SECRET)
  },

  aisstream: {
    apiKey: env.AISSTREAM_API_KEY || '',
    baseUrl: env.AISSTREAM_BASE_URL || '',
    model: env.AISSTREAM_MODEL || 'gpt-4o-mini'
  },
  google: { appPassword: env.GOOGLE_APP_PASSWORD || '' },
  elevenlabs: { apiKey: env.ELEVENLABS_API_KEY || '', agentId: env.ELEVENLABS_AGENT_ID || '' },
  search: { enabled: env.SEARCH_ENABLED === 'true', aiKey: env.OPENAI_API_KEY || '', aiModel: env.SEARCH_AI_MODEL || '' },

  posthog: {
    apiKey: env.POSTHOG_API_KEY || '',
    host: env.POSTHOG_HOST || 'https://us.i.posthog.com'
  },

  github: { token: env.GITHUB_TOKEN || '' },
  netlify: { token: env.NETLIFY_AUTH_TOKEN || '' },
  sentry: { dsn: env.SENTRY_DSN || '' },
  resend: { apiKey: env.RESEND_API_KEY || '' }
};

/**
 * Credentials without which LOUMOO cannot enforce its own security model.
 * Missing any of these in production is a fatal misconfiguration, not a
 * warning: running without them would mean running without authentication.
 */
const PRODUCTION_REQUIRED = [
  // Sessions are LOUMOO-issued HS256 JWTs verified in
  // SupabaseIdentityProvider. Without this secret the server cannot verify a
  // session at all, and an earlier revision fell back to a hardcoded value
  // that is public in this repository — every account forgeable. It is
  // therefore the single most important production credential.
  ['SUPABASE_JWT_SECRET', config.supabase.jwtSecret, 'Session tokens cannot be signed or verified without it.'],
  ['SUPABASE_URL', config.supabase.url, 'No database means no authoritative account state.'],
  ['SUPABASE_SERVICE_ROLE_KEY', config.supabase.serviceRoleKey, 'The API cannot read or write account state without it.'],
  ['SUPABASE_ANON_KEY', config.supabase.anonKey, 'Password sign-in calls Supabase Auth through the public client.']
];

/**
 * Missing credentials that degrade ONE capability but are not exploitable and
 * must not block boot. The webhook endpoint refuses to process unsigned
 * identity events (503 WEBHOOK_NOT_CONFIGURED) until the secret is set — the
 * documented behavior in .env.example is that the server runs without it.
 */
const PRODUCTION_WARNINGS = [
  ['REDIS_URL', config.redis.url,
    'Missing. Shared rate limiting is unavailable; protected API traffic fails closed instead of using process-local state.'],
  ['CLERK_WEBHOOK_SECRET', config.clerk.webhookSecret,
    'Missing. The /api/v1/webhooks/clerk endpoint answers 503 WEBHOOK_NOT_CONFIGURED ' +
    'until the Svix signing secret is configured — identity events are NOT processed.'],
  // Clerk no longer authenticates anyone: authGuard verifies Supabase/LOUMOO
  // session tokens. These stay as warnings (the webhook and legacy adapters
  // still read them) but must not block a boot that is otherwise secure.
  ['CLERK_SECRET_KEY', config.clerk.secretKey,
    'Missing. Only the legacy Clerk webhook/identity adapter needs it; session verification does not.']
];

/**
 * Returns the list of misconfigurations. Always safe to call — it never
 * includes secret VALUES, only variable names. Each problem carries a
 * severity: 'error' blocks boot, 'warning' is logged and does not.
 */
function validateProductionConfig() {
  const problems = [];

  for (const [name, value, why] of PRODUCTION_REQUIRED) {
    if (!value) problems.push({ variable: name, reason: `Missing. ${why}`, severity: 'error' });
  }

  for (const [name, value, why] of PRODUCTION_WARNINGS) {
    if (!value) problems.push({ variable: name, reason: why, severity: 'warning' });
  }

  if (config.corsOrigins.includes('*')) {
    problems.push({
      variable: 'CORS_ORIGINS',
      reason: 'Wildcard "*" is not permitted in production; list the exact origins.',
      severity: 'error'
    });
  }

  if (!config.proxy.explicitlyConfigured) {
    problems.push({
      variable: 'TRUST_PROXY',
      reason: 'Not explicitly configured; defaulted to 1 (Railway single-hop ingress). For multi-tier proxies or custom CIDRs, set TRUST_PROXY explicitly.',
      severity: 'warning'
    });
  }

  if (config.proxy.trust === true) {
    problems.push({
      variable: 'TRUST_PROXY',
      reason: 'Trusting every proxy is unsafe; use an exact hop count or trusted proxy CIDR list.',
      severity: 'error'
    });
  }

  if (env.LOUMOO_TEST_AUTH_SECRET) {
    problems.push({
      variable: 'LOUMOO_TEST_AUTH_SECRET',
      reason: 'The test authentication bypass secret must never be set in production.',
      severity: 'error'
    });
  }

  return problems;
}

/** Throws in production when a security-critical configuration is absent. */
function assertProductionConfig() {
  if (!config.isProduction) return [];
  const problems = validateProductionConfig();
  const fatal = problems.filter(p => p.severity === 'error');
  if (fatal.length > 0) {
    const detail = fatal.map(p => `  - ${p.variable}: ${p.reason}`).join('\n');
    throw new Error(
      `[LOUMOO] Refusing to start in production with an insecure configuration:\n${detail}\n` +
      'See .env.example for the full list of required variables.'
    );
  }
  return problems;
}

module.exports = config;
module.exports.config = config;
module.exports.envSchema = envSchema;
module.exports.validateProductionConfig = validateProductionConfig;
module.exports.assertProductionConfig = assertProductionConfig;
