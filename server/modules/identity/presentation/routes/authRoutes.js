/**
 * LOUMOO — Universal Authentication & Verification Engine
 * ---------------------------------------------------------------------------
 * Server-authoritative authentication using Supabase & Resend.
 * Direct 6-digit OTP delivery without third-party rate limiting or bot-blockers.
 */

const express = require('express');
const router = express.Router();

const SessionToken = require('../../infrastructure/SessionToken');
const OtpSecurity = require('../../infrastructure/OtpSecurity');
const AuthThrottle = require('../../infrastructure/AuthThrottle');
const { resolveAuthUserId } = require('../../infrastructure/IdentityResolver');
const { requireAuth } = require('../guards/authGuard');
const AccountStateService = require('../../application/AccountStateService');
const ProfileRepository = require('../../infrastructure/ProfileRepository');
const SupabaseIdentityProvider = require('../../infrastructure/SupabaseIdentityProvider');
const { SupabaseDatabase } = require('../../../../infrastructure/database/SupabaseClient');
const CacheService = require('../../../../infrastructure/cache/CacheService');
const AnalyticsService = require('../../../../infrastructure/analytics/AnalyticsService');
const { sendEmail } = require('../../../../clients/resend');
const config = require('../../../../config/env');
const logger = require('../../../../shared/logging/logger');
const { AuthenticationError, ValidationError, InfrastructureError, RateLimitError } = require('../../../../shared/errors/AppError');

/**
 * THE session secret. There is deliberately no fallback default: a hardcoded
 * one lived in this file and in SupabaseIdentityProvider, which meant a
 * deployment that forgot SUPABASE_JWT_SECRET signed its sessions with a value
 * published in the repository — anyone could mint a token for any account.
 * Failing loudly is the only safe behaviour.
 */
function sessionSecret() {
  const secret = config.supabase.jwtSecret;
  if (!secret) {
    throw new InfrastructureError(
      'Config',
      'Authentication is unavailable: SUPABASE_JWT_SECRET is not configured.'
    );
  }
  return secret;
}

/** The ONE place a LOUMOO session token is minted. */
function issueSessionToken({ userId, email, firstName, lastName, phone, city }) {
  return SessionToken.sign(
    {
      sub: userId,
      email: email,
      role: 'authenticated',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {
        first_name: firstName || '',
        last_name: lastName || '',
        phone_number: phone || '',
        city: city || ''
      }
    },
    sessionSecret(),
    { expiresInSeconds: 30 * 86400 }
  );
}

// The Supabase auth user for an email is resolved through IdentityResolver,
// which uses only indexed, constant-time lookups. The previous implementation
// here paged through the entire user table (up to 25 × 200) on every OTP
// verification and, once the project outgrew the last page, stopped finding
// real users and fabricated a synthetic id in their place.

/**
 * Emits the verification code to the server log.
 *
 * ONLY outside production. This used to be an unconditional console.log, which
 * wrote a live authentication credential into the production log stream for
 * every signup — anyone with log access could sign in as any user.
 */
function logDevOtp(label, email, code) {
  if (config.isProduction) return;
  console.log(`
=======================================================
  LOUMOO ${label} FOR [${email}]: ${code}
=======================================================
`);
}

/** The verification-code email body. */
function otpEmailHtml(code, intro) {
  const message = intro || 'Here is your 6-digit verification code:';
  return `
    <div style="font-family:sans-serif;max-width:540px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
      <h2 style="color:#0f172a;margin-bottom:8px">Welcome to LOUMOO</h2>
      <p style="color:#475569;font-size:15px">${message}</p>
      <div style="background:#f1f5f9;padding:18px;border-radius:8px;font-size:32px;font-weight:bold;letter-spacing:6px;text-align:center;color:#0284c7;margin:20px 0">
        ${code}
      </div>
      <p style="color:#64748b;font-size:13px">This code expires in 15 minutes. If you did not request this, please ignore this email.</p>
    </div>
  `;
}

const OTP_NAMESPACE = 'auth_otp';
const OTP_TTL_SECONDS = 900; // 15 minutes

// Account brute-force protection. The per-code attempt limit is keyed on the
// email identifier and on the code itself, so it cannot be bypassed by spoofing
// X-Forwarded-For or by rotating IPs — every guess counts against the one code.
const OTP_MAX_ATTEMPTS = 5;                    // failed verifications before the code is destroyed
const OTP_RESEND_MIN_INTERVAL_MS = 30 * 1000;  // minimum spacing between code dispatches
const OTP_MAX_SENDS = 5;                        // maximum dispatches within one code's lifetime

// Anti-abuse windows and caps. Login and OTP-generation throttles are keyed on
// a server-derived source (the connection IP) COMBINED with the account, never
// on a single client-controlled value — an attacker can neither lock a victim
// out globally nor buy extra guesses by changing the one field they control.
const AUTH_WINDOW_SECONDS = 15 * 60;            // 15-minute sliding window for all counters
const LOGIN_MAX_PER_ACCOUNT = 8;               // failed sign-ins for one account from one source
const LOGIN_MAX_PER_SOURCE = 30;               // failed sign-ins across all accounts from one source
const OTP_GEN_MAX_PER_SOURCE = 20;             // OTP dispatches from one source (anti-bombing)

/** The client address Express resolved (honours `trust proxy`). */
function requestSource(req) {
  return (req && (req.ip || (req.socket && req.socket.remoteAddress))) || 'unknown';
}

/**
 * Generates, stores and dispatches a fresh OTP for `email`, enforcing
 * generation throttling so the endpoint cannot be used to brute-force codes
 * into existence or to bomb an inbox.
 *
 * Throttling is silent and uniform: when a send is skipped — too soon after the
 * last one, over the per-code send cap, or (for a resend) no signup pending —
 * the caller still returns the same success envelope. Nothing about whether a
 * signup exists for the address is observable from the response.
 *
 * The chosen password is stored only as AES-GCM ciphertext and the code only as
 * an HMAC; neither is ever written to the cache in the clear.
 *
 * @returns {Promise<{sent:boolean, code?:string, throttled?:boolean}>}
 */
/**
 * The one sign-in refusal rule, shared by every path that mints a session
 * (password, OTP verification, password reset): a deleted account cannot be
 * reopened with credentials that still work at the identity provider, and a
 * suspended one is told why.
 */
function assertProfileCanSignIn(profile) {
  if (ProfileRepository.isDeletedProfile(profile)) {
    throw new AuthenticationError('This account has been deleted and cannot be accessed.');
  }
  if (profile.account_status === 'suspended' || profile.status === 'suspended') {
    throw new AuthenticationError('This account has been suspended. Contact LOUMOO support.');
  }
}

async function prepareAndSendOtp({ email, fields = {}, requireExisting = false, subject, intro, ip = null }) {
  const existing = await CacheService.get(email, OTP_NAMESPACE);

  if (requireExisting && !existing) {
    return { sent: false };
  }

  const now = Date.now();
  if (existing) {
    const tooSoon = existing.lastSentAt && (now - existing.lastSentAt) < OTP_RESEND_MIN_INTERVAL_MS;
    const overCap = (existing.sendCount || 0) >= OTP_MAX_SENDS;
    if (tooSoon || overCap) {
      return { sent: false, throttled: true };
    }
  }

  // Per-source generation cap: bound how many codes one origin can have LOUMOO
  // mail out in a window, so signup/resend cannot be used to bomb inboxes or
  // enumerate across many addresses from one machine. Silent and uniform.
  const genKey = `otpgen:${AuthThrottle.fingerprint(ip || 'unknown')}`;
  const genState = await AuthThrottle.check(genKey, { max: OTP_GEN_MAX_PER_SOURCE, windowSeconds: AUTH_WINDOW_SECONDS });
  if (genState.blocked) {
    return { sent: false, throttled: true };
  }

  const code = OtpSecurity.generateOtp();
  const base = existing || {};
  const record = {
    email,
    passwordEnc: fields.password != null
      ? OtpSecurity.encryptSecret(fields.password)
      : (base.passwordEnc || null),
    firstName: fields.firstName != null ? fields.firstName : (base.firstName || ''),
    lastName: fields.lastName != null ? fields.lastName : (base.lastName || ''),
    phone: fields.phone != null ? fields.phone : (base.phone || ''),
    city: fields.city != null ? fields.city : (base.city || ''),
    // The Supabase auth id captured at signup (if any), preserved across resend
    // so verification resolves identity without a lookup.
    supabaseUserId: fields.supabaseUserId != null ? fields.supabaseUserId : (base.supabaseUserId || null),
    otpHash: OtpSecurity.hashOtp(code),
    attempts: 0,
    sendCount: (base.sendCount || 0) + 1,
    createdAt: base.createdAt || now,
    lastSentAt: now,
    expiresAt: now + OTP_TTL_SECONDS * 1000
  };

  await CacheService.set(email, record, OTP_TTL_SECONDS, OTP_NAMESPACE);

  // Count this dispatch against the source so the per-origin cap accrues.
  await AuthThrottle.recordFailure(genKey, { windowSeconds: AUTH_WINDOW_SECONDS });

  try {
    await sendEmail({
      to: email,
      subject: subject || `${code} is your LOUMOO verification code`,
      html: otpEmailHtml(code, intro)
    });
    logger.info(`[Auth] Sent verification OTP to ${email}`);
  } catch (emailErr) {
    logger.warn(`[Auth] OTP email warning: ${emailErr.message}`);
  }

  logDevOtp('VERIFICATION OTP', email, code);
  return { sent: true, code };
}

/* ── Public bootstrap config ── */
router.get('/config', (req, res) => {
  res.json({
    status: 'success',
    data: {
      provider: 'supabase',
      supabaseUrl: config.supabase.url,
      anonKey: config.supabase.anonKey,
      publishableKey: config.supabase.anonKey,
      configured: true,
      emailVerification: { enabled: true, provider: 'supabase' },
      phoneVerification: {
        enabled: false,
        provider: 'none',
        configurationRequirement: 'Phone verification is saved for local delivery and Mobile Money.'
      }
    }
  });
});

/* ── Direct Server-Authoritative Registration ── */
router.post('/signup', async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, phone, city } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();

    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new ValidationError('A valid email address is required.');
    }
    if (!password || password.length < 6) {
      throw new ValidationError('Password must be at least 6 characters.');
    }

    // Ensure the Supabase auth user exists with the chosen password. This is the
    // authoritative place the credential lands; the OTP cache only holds an
    // encrypted fallback copy for the confirmation step, never plaintext. When
    // creation succeeds we capture the real id so verification needs no lookup
    // at all — the common path resolves identity with zero extra I/O.
    let supabaseUserId = null;
    try {
      const admin = SupabaseDatabase.getAdmin();
      if (admin && admin.auth && admin.auth.admin) {
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: cleanEmail,
          password: password,
          email_confirm: false,
          user_metadata: {
            first_name: firstName || '',
            last_name: lastName || '',
            phone_number: phone || '',
            city: city || ''
          }
        });
        if (created && created.user) {
          supabaseUserId = created.user.id;
        } else if (createErr) {
          // "Already registered" is the expected, benign case; the id is then
          // resolved at verification through the indexed lookups.
          logger.debug(`[SupabaseUser] createUser note: ${createErr.message}`);
        }
      }
    } catch (e) {
      logger.debug(`[SupabaseUser] admin note: ${e.message}`);
    }

    const result = await prepareAndSendOtp({
      email: cleanEmail,
      fields: { password, firstName, lastName, phone, city, supabaseUserId },
      intro: 'Here is your 6-digit verification code to complete your registration:',
      ip: requestSource(req)
    });

    res.json({
      status: 'success',
      message: 'Verification code sent',
      data: {
        email: cleanEmail,
        needsEmailCode: true,
        // In local dev, provide devOtp for instant frictionless testing.
        devOtp: config.isDevelopment && result.code ? result.code : undefined
      }
    });
  } catch (err) { next(err); }
});

/* ── Direct Server-Authoritative OTP Verification ── */
router.post('/verify-otp', async (req, res, next) => {
  try {
    const { email, code } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanCode = String(code || '').trim().replace(/[^0-9]/g, '');

    if (!cleanEmail || !cleanCode) {
      throw new ValidationError('Email and 6-digit verification code are required.');
    }

    // One generic failure for every unsuccessful outcome — wrong code, expired
    // code, no pending signup, or too many attempts. Distinguishing them would
    // reveal whether a signup exists for this address and whether guesses land.
    const INVALID = 'That verification code is invalid or has expired. Please request a new one.';

    const cached = await CacheService.get(cleanEmail, OTP_NAMESPACE);
    if (!cached) {
      throw new AuthenticationError(INVALID);
    }

    const nowMs = Date.now();
    const expired = cached.expiresAt && nowMs > cached.expiresAt;
    const lockedOut = (cached.attempts || 0) >= OTP_MAX_ATTEMPTS;
    if (expired || lockedOut) {
      await CacheService.delete(cleanEmail, OTP_NAMESPACE);
      throw new AuthenticationError(INVALID);
    }

    if (!OtpSecurity.verifyOtp(cleanCode, cached.otpHash)) {
      const attempts = (cached.attempts || 0) + 1;
      if (attempts >= OTP_MAX_ATTEMPTS) {
        // The code is now spent: destroy it so brute force cannot continue.
        await CacheService.delete(cleanEmail, OTP_NAMESPACE);
      } else {
        // Persist the higher attempt count WITHOUT extending the original
        // expiry — a wrong guess must never buy the attacker more time.
        const remainingTtl = Math.max(1, Math.ceil((cached.expiresAt - nowMs) / 1000));
        await CacheService.set(cleanEmail, { ...cached, attempts }, remainingTtl, OTP_NAMESPACE);
      }
      throw new AuthenticationError(INVALID);
    }

    // Correct code. Consume it immediately so it is single-use even under two
    // concurrent requests carrying the same valid code.
    await CacheService.delete(cleanEmail, OTP_NAMESPACE);
    const password = OtpSecurity.decryptSecret(cached.passwordEnc);

    // Establish the AUTHORITATIVE identity for this verified email. Resolution
    // is constant-time — the id captured at signup, then the indexed profiles
    // mirror, then a single admin probe — never a paginated scan of the whole
    // user table. If no real identity can be established we FAIL rather than
    // fabricate one: a synthesized `usr_<hex(email)>` id forks the same person
    // into two accounts and is a predictable, guessable subject claim.
    let userId = cached.supabaseUserId || null;

    let admin = null;
    try {
      admin = SupabaseDatabase.getAdmin();
    } catch (e) {
      logger.error(`[Auth] Identity provider unavailable during verification: ${e.message}`);
    }

    if (admin && admin.auth && admin.auth.admin) {
      if (!userId) {
        userId = await resolveAuthUserId(admin, cleanEmail);
      }

      if (userId) {
        // Existing account — mark the address confirmed and update password if provided.
        try {
          const updatePayload = { email_confirm: true };
          if (password) updatePayload.password = password;
          await admin.auth.admin.updateUserById(userId, updatePayload);
        } catch (e) {
          logger.debug(`[SupabaseUser] confirm note: ${e.message}`);
        }
      } else {
        // Genuinely new — create a confirmed user and take the id it returns.
        try {
          const { data: created } = await admin.auth.admin.createUser({
            email: cleanEmail,
            password: password || undefined,
            email_confirm: true,
            user_metadata: {
              first_name: cached.firstName,
              last_name: cached.lastName,
              phone_number: cached.phone,
              city: cached.city
            }
          });
          userId = created && created.user ? created.user.id : null;
        } catch (createErr) {
          // A create race, or an account that exists without a local profile:
          // resolve once more rather than guessing an id.
          logger.debug(`[SupabaseUser] create note: ${createErr.message}`);
          userId = await resolveAuthUserId(admin, cleanEmail);
        }
      }
    }

    if (!userId) {
      // Never mint a session for an identity the provider did not issue.
      throw new InfrastructureError(
        'Identity',
        'We could not finish verifying your account right now. Please try again in a moment.'
      );
    }

    // Generate authenticated JWT session token
    const sessionToken = issueSessionToken({
      userId,
      email: cleanEmail,
      firstName: cached.firstName,
      lastName: cached.lastName,
      phone: cached.phone,
      city: cached.city
    });

    // Provision or update profile in database
    const { profile } = await ProfileRepository.getOrCreateForClerkUser({
      clerkUserId: userId,
      email: cleanEmail,
      firstName: cached.firstName,
      lastName: cached.lastName,
      phoneNumber: cached.phone,
      city: cached.city
    });
    assertProfileCanSignIn(profile);

    const now = new Date().toISOString();
    await ProfileRepository.update(profile.id, {
      email_verified_at: now,
      phone_number: cached.phone || profile.phone_number
    }, userId);

    await ProfileRepository.recordLogin(profile.id, userId);
    const { principal, accountState } = await AccountStateService.resolve(userId, { source: 'supabase' });

    // (The OTP was already consumed above, before provisioning, for single-use.)
    logger.info(`[Auth] User ${cleanEmail} verified and logged in successfully (id=${userId})`);

    res.json({
      status: 'success',
      data: {
        token: sessionToken,
        accessToken: sessionToken,
        user: {
          id: userId,
          email: cleanEmail,
          firstName: cached.firstName,
          lastName: cached.lastName
        },
        accountState: AccountStateService.toClientState(principal, accountState)
      }
    });
  } catch (err) { next(err); }
});

/* ── Password Sign-In (returning users) ──────────────────────────── */
/**
 * POST /api/v1/auth/login
 *
 * The browser has always called this endpoint (src/services/clerkSession.js
 * `signIn`), but it did not exist — every returning user got
 * 404 ROUTE_NOT_FOUND rendered as "Sign in failed". Registration worked, so the
 * defect only ever showed up on the SECOND visit.
 *
 * The password is verified by Supabase Auth, which owns the credential. LOUMOO
 * never reads, stores or compares a password hash itself; on success it mints
 * the same session token the OTP path issues, so there is exactly one session
 * format in the system.
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    let cleanEmail = String(email || '').trim().toLowerCase();

    // If identifier is not an email, try resolving account email by phone number
    if (cleanEmail && !cleanEmail.includes('@')) {
      const cleanPhone = cleanEmail.replace(/[^0-9+]/g, '');
      if (cleanPhone) {
        try {
          const admin = SupabaseDatabase.getAdmin();
          const { data: matchedProfile } = await admin
            .schema('iam')
            .from('profiles')
            .select('email')
            .or(`phone_number.eq.${cleanPhone},phone_number.eq.+${cleanPhone.replace(/^\+/, '')},phone_number.eq.+237${cleanPhone.replace(/^(\+?237)?/, '')}`)
            .is('deleted_at', null)
            .limit(1)
            .maybeSingle();
          if (matchedProfile && matchedProfile.email) {
            cleanEmail = matchedProfile.email;
          }
        } catch (phoneErr) {
          logger.debug(`[Auth] phone lookup note: ${phoneErr.message}`);
        }
      }
    }

    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new ValidationError('Enter the email address or phone number on your account.');
    }
    if (!password) {
      throw new ValidationError('Enter your password.');
    }

    // Brute-force / credential-stuffing gate. Two buckets, both keyed on the
    // connection source AND the account (never the account alone), so an
    // attacker can neither lock a victim out from elsewhere nor get unlimited
    // guesses by only varying the email. Only FAILURES are counted below and a
    // correct password clears the bucket, so a legitimate user is never blocked
    // by their own successful sign-ins.
    const srcFp = AuthThrottle.fingerprint(requestSource(req));
    const accountKey = `login:${srcFp}:${AuthThrottle.fingerprint(cleanEmail)}`;
    const sourceKey = `login:src:${srcFp}`;
    const THROTTLE = { windowSeconds: AUTH_WINDOW_SECONDS };

    const [acctState, srcState] = await Promise.all([
      AuthThrottle.check(accountKey, { max: LOGIN_MAX_PER_ACCOUNT, ...THROTTLE }),
      AuthThrottle.check(sourceKey, { max: LOGIN_MAX_PER_SOURCE, ...THROTTLE })
    ]);
    if (acctState.blocked || srcState.blocked) {
      const retryAfter = Math.max(acctState.retryAfter || 0, srcState.retryAfter || 0) || AUTH_WINDOW_SECONDS;
      res.setHeader('Retry-After', retryAfter);
      logger.warn(`[Auth] Sign-in throttled (source=${srcFp})`);
      throw new RateLimitError('Too many sign-in attempts. Please wait a few minutes and try again.', retryAfter);
    }

    const publicClient = SupabaseDatabase.getPublic();
    const { data, error } = await publicClient.auth.signInWithPassword({
      email: cleanEmail,
      password: String(password)
    });

    // Wrong password and unknown account return the SAME message on purpose:
    // distinguishing them turns this endpoint into an account enumerator. The
    // failed attempt is counted against both buckets before we answer.
    if (error || !data || !data.user) {
      await Promise.all([
        AuthThrottle.recordFailure(accountKey, THROTTLE),
        AuthThrottle.recordFailure(sourceKey, THROTTLE)
      ]);
      logger.warn(`[Auth] Failed sign-in for ${cleanEmail}: ${error ? error.message : 'no user'}`);
      throw new AuthenticationError('That email or password is incorrect.');
    }

    const authUser = data.user;
    // Correct credentials: clear this account's guessing counter for the source
    // so an occasional mistyped password never accumulates against the user.
    await AuthThrottle.clear(accountKey);
    const meta = authUser.user_metadata || {};

    const { profile } = await ProfileRepository.getOrCreateForClerkUser({
      clerkUserId: authUser.id,
      email: cleanEmail,
      firstName: meta.first_name || '',
      lastName: meta.last_name || '',
      phoneNumber: meta.phone_number || '',
      city: meta.city || ''
    });

    assertProfileCanSignIn(profile);

    // Supabase confirmed the address at signup; mirror that once so the
    // account state machine does not send a verified user back to /verify.
    if (authUser.email_confirmed_at && !profile.email_verified_at) {
      await ProfileRepository.update(profile.id, {
        email_verified_at: authUser.email_confirmed_at
      }, authUser.id);
    }

    const sessionToken = issueSessionToken({
      userId: authUser.id,
      email: cleanEmail,
      firstName: meta.first_name,
      lastName: meta.last_name,
      phone: meta.phone_number,
      city: meta.city
    });

    await ProfileRepository.recordLogin(profile.id, authUser.id);
    const { principal, accountState } = await AccountStateService.resolve(authUser.id, { source: 'supabase' });

    AnalyticsService.track(profile.id, 'auth_signed_in', { method: 'password' });
    logger.info(`[Auth] ${cleanEmail} signed in (id=${authUser.id}, state=${accountState.state})`);

    res.json({
      status: 'success',
      data: {
        token: sessionToken,
        accessToken: sessionToken,
        user: {
          id: authUser.id,
          email: cleanEmail,
          firstName: meta.first_name || '',
          lastName: meta.last_name || ''
        },
        accountState: AccountStateService.toClientState(principal, accountState)
      }
    });
  } catch (err) { next(err); }
});

/* ── Password Reset (request OTP) ────────────────────────────────── */
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body || {};
    let cleanEmail = String(email || '').trim().toLowerCase();

    if (!cleanEmail.includes('@')) {
      const cleanPhone = cleanEmail.replace(/[^0-9+]/g, '');
      if (cleanPhone) {
        try {
          const admin = SupabaseDatabase.getAdmin();
          const { data: matchedProfile } = await admin
            .schema('iam')
            .from('profiles')
            .select('email')
            .or(`phone_number.eq.${cleanPhone},phone_number.eq.+${cleanPhone.replace(/^\+/, '')},phone_number.eq.+237${cleanPhone.replace(/^(\+?237)?/, '')}`)
            .is('deleted_at', null)
            .limit(1)
            .maybeSingle();
          if (matchedProfile && matchedProfile.email) {
            cleanEmail = matchedProfile.email;
          }
        } catch (phoneErr) {
          logger.debug(`[Auth] phone lookup note: ${phoneErr.message}`);
        }
      }
    }

    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new ValidationError('Enter a valid email address.');
    }

    // Prepare and dispatch 6-digit OTP to user email
    const result = await prepareAndSendOtp({
      email: cleanEmail,
      subject: 'Your LOUMOO password recovery code',
      intro: 'Here is your 6-digit recovery code to reset your password:',
      ip: requestSource(req)
    });

    res.json({
      status: 'success',
      message: 'If an account exists, a recovery code has been sent.',
      data: {
        devOtp: config.isDevelopment && result.code ? result.code : undefined
      }
    });
  } catch (err) { next(err); }
});

/* ── Password Reset (confirm code & update password) ─────────────── */
router.post('/reset-password', async (req, res, next) => {
  try {
    const { email, code, newPassword } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanCode = String(code || '').trim().replace(/[^0-9]/g, '');

    if (!cleanEmail || !cleanCode) {
      throw new ValidationError('Email and 6-digit recovery code are required.');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new ValidationError('Your password must be at least 8 characters.');
    }

    const INVALID = 'That recovery code is invalid or has expired. Please request a new one.';
    const cached = await CacheService.get(cleanEmail, OTP_NAMESPACE);
    if (!cached) {
      throw new AuthenticationError(INVALID);
    }

    const nowMs = Date.now();
    const expired = cached.expiresAt && nowMs > cached.expiresAt;
    const lockedOut = (cached.attempts || 0) >= OTP_MAX_ATTEMPTS;
    if (expired || lockedOut) {
      await CacheService.delete(cleanEmail, OTP_NAMESPACE);
      throw new AuthenticationError(INVALID);
    }

    if (!OtpSecurity.verifyOtp(cleanCode, cached.otpHash)) {
      const attempts = (cached.attempts || 0) + 1;
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await CacheService.delete(cleanEmail, OTP_NAMESPACE);
      } else {
        const remainingTtl = Math.max(1, Math.ceil((cached.expiresAt - nowMs) / 1000));
        await CacheService.set(cleanEmail, { ...cached, attempts }, remainingTtl, OTP_NAMESPACE);
      }
      throw new AuthenticationError(INVALID);
    }

    // Consume OTP code
    await CacheService.delete(cleanEmail, OTP_NAMESPACE);

    const admin = SupabaseDatabase.getAdmin();
    if (!admin || !admin.auth || !admin.auth.admin) {
      throw new InfrastructureError('Identity', 'Authentication provider is currently unavailable.');
    }

    const userId = await resolveAuthUserId(admin, cleanEmail);
    if (!userId) {
      throw new AuthenticationError('Account not found.');
    }

    // Refuse BEFORE touching the credential: resetting a deleted or suspended
    // account's password must not hand it a fresh session.
    const { profile } = await ProfileRepository.getOrCreateForClerkUser({
      clerkUserId: userId,
      email: cleanEmail
    });
    assertProfileCanSignIn(profile);

    // Authoritative password update in Supabase
    const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
      password: newPassword,
      email_confirm: true
    });
    if (updateErr) {
      logger.error(`[Auth] Failed to update password for ${cleanEmail}: ${updateErr.message}`);
      throw new InfrastructureError('Identity', 'Could not update password. Please try again.');
    }

    const sessionToken = issueSessionToken({
      userId,
      email: cleanEmail,
      firstName: profile.first_name,
      lastName: profile.last_name,
      phone: profile.phone_number,
      city: profile.city
    });

    await ProfileRepository.recordLogin(profile.id, userId);
    const { principal, accountState } = await AccountStateService.resolve(userId, { source: 'supabase' });

    logger.info(`[Auth] User ${cleanEmail} reset password and signed in`);

    res.json({
      status: 'success',
      message: 'Password updated successfully.',
      data: {
        token: sessionToken,
        accessToken: sessionToken,
        user: {
          id: userId,
          email: cleanEmail,
          firstName: profile.first_name || '',
          lastName: profile.last_name || ''
        },
        accountState: AccountStateService.toClientState(principal, accountState)
      }
    });
  } catch (err) { next(err); }
});

/* ── Resend OTP ── */
router.post('/resend-otp', async (req, res, next) => {
  try {
    const { email } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail) throw new ValidationError('Email is required.');

    // Only resend when a signup is actually pending for this address. Otherwise
    // we answer with the same success envelope and send nothing — the endpoint
    // reveals nothing about who has an account and cannot be used to mail codes
    // to arbitrary third parties. Throttling inside prepareAndSendOtp is silent.
    const result = await prepareAndSendOtp({
      email: cleanEmail,
      requireExisting: true,
      subject: 'Your new LOUMOO verification code',
      intro: 'Here is your new 6-digit verification code:',
      ip: requestSource(req)
    });

    res.json({
      status: 'success',
      message: 'New verification code sent',
      data: { devOtp: config.isDevelopment && result.code ? result.code : undefined }
    });
  } catch (err) { next(err); }
});

/* ── Session establishment (Bearer Token) ── */
router.post('/session', requireAuth, async (req, res, next) => {
  try {
    await ProfileRepository.recordLogin(req.principal.id, req.principal.clerkUserId);

    AnalyticsService.identify(req.principal.id, {
      email: req.principal.email,
      name: `${req.principal.firstName} ${req.principal.lastName}`.trim(),
      role: req.principal.primaryRole
    });
    AnalyticsService.track(req.principal.id, 'auth_session_established', {
      provider: req.auth.source,
      accountState: req.accountState.state
    });

    logger.info(`[Auth] session established user=${req.principal.id} state=${req.accountState.state}`);

    res.json({
      status: 'success',
      data: AccountStateService.toClientState(req.principal, req.accountState)
    });
  } catch (err) { next(err); }
});

router.post('/logout', (req, res) => {
  res.json({
    status: 'success',
    message: 'Signed out successfully.'
  });
});


/* ── Verification Status & Actions ── */
router.get('/verification', requireAuth, async (req, res, next) => {
  try {
    const isEmailVerified = Boolean(req.principal && req.principal.emailVerifiedAt);
    const isPhoneVerified = Boolean(req.principal && req.principal.phoneVerifiedAt);
    res.json({
      status: 'success',
      data: {
        email: {
          verified: isEmailVerified,
          address: req.principal.email,
          provider: 'supabase'
        },
        phone: {
          verified: isPhoneVerified,
          number: req.principal.phoneNumber,
          available: false,
          configurationRequirement: 'Phone verification is optional.'
        }
      }
    });
  } catch (err) { next(err); }
});

router.post('/verification/refresh', requireAuth, async (req, res, next) => {
  try {
    res.json({
      status: 'success',
      data: { refreshed: true }
    });
  } catch (err) { next(err); }
});

router.post('/verification/email', requireAuth, async (req, res, next) => {
  try {
    const isEmailVerified = Boolean(req.principal && req.principal.emailVerifiedAt);
    if (isEmailVerified) {
      return res.json({
        status: 'success',
        data: { alreadyVerified: true }
      });
    }
    res.json({
      status: 'success',
      data: { sent: true }
    });
  } catch (err) { next(err); }
});

module.exports = router;
