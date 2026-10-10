/**
 * LOUMOO Store Application — House store provisioning (operator-run)
 * ---------------------------------------------------------------------------
 * Creates NanoAfrica (the platform owner's store that owns every curated
 * product) and nanoDelivery (its delivery agency) as REAL rows, owned by the
 * platform owner's own LOUMOO account, mirroring what the application's real
 * onboarding writes (CreateStoreUseCase, StoreOnboardingUseCase, the
 * organization and rider registration use cases) so that the owner can really use
 * Seller Studio, the seller order list and the dispatch board.
 *
 * Safety rules, all enforced here and not by the caller:
 *
 *   - DRY RUN BY DEFAULT. Nothing is written unless `apply` is set AND
 *     `confirmOwnerId` equals the id the lookup matched. The operator therefore
 *     always sees who was matched before anything happens.
 *   - The identity layer never matches users by email at runtime (see
 *     identity/infrastructure/ProfileRepository.js). This operator tool is the one
 *     place that may look an owner (or a rider) up by email, and only by a VERIFIED
 *     email, and only when exactly one live account carries it.
 *   - IDEMPOTENT. Rows are keyed by deterministic ids. A missing row is created; an
 *     existing row is never overwritten with defaults. Only blank fields are filled
 *     in and derived counters are refreshed, so anything the owner or an admin
 *     edited since (description, logo, hours, tariff, service areas, phone once set)
 *     survives a re-run. A row that belongs to someone else, or a rider who is
 *     already registered as something else, is a BLOCKER: it is reported and the
 *     run refuses to write rather than guessing.
 *   - Every database error aborts the run with the reason. Unlike the request path
 *     there is no "development fallback" here: a provisioning run that half-worked
 *     must say so. It is safe to run again after fixing the cause.
 *
 * Writes go through the same PostgREST-style admin client as the rest of the
 * server, so the same code runs against Supabase and the local PGlite stand-in.
 */
'use strict';

const { ValidationError, ConflictError, InfrastructureError } = require('../../../shared/errors/AppError');
const { HOUSE_STORE, HOUSE_AGENCY } = require('../domain/HouseStore');

/**
 * The verification tier written on the house store. It is the platform's own
 * store, so it carries the highest tier the schema allows (the CHECK on
 * iam.stores.verification_tier). Change it here and nowhere else.
 */
const HOUSE_STORE_VERIFICATION_TIER = 'official_brand';

const HOUSE_STORE_CATEGORY = 'general';
const HOUSE_STORE_SELLER_TYPE = 'BRAND';
const HOUSE_AGENCY_ORG_TYPE = 'AGENCY';
const DEFAULT_CITY = 'Douala';

// The account columns the lookup needs. Never select '*' from profiles in a tool
// that prints what it matched.
const PROFILE_COLUMNS = [
  'id', 'clerk_user_id', 'email', 'phone_number', 'first_name', 'last_name', 'city',
  'primary_role', 'status', 'account_status', 'email_verified_at',
  'onboarding_status', 'onboarding_started_at', 'onboarding_completed_at',
  'seller_status', 'primary_store_id', 'deleted_at'
].join(', ');

const ROLE_OWNER_PERMISSIONS = ['*'];
const ROLE_MEMBER_PERMISSIONS = ['org.view'];

function fail(message, details) { return new ValidationError(message, details); }

/** Throws a clear InfrastructureError when a PostgREST call failed; returns `data` otherwise. */
function must(result, what) {
  if (result && result.error) {
    throw new InfrastructureError('Supabase', `${what}: ${result.error.message || result.error.code || 'unknown error'}`, result.error);
  }
  return result ? result.data : null;
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return '(no email)';
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(3, local.length - head.length))}@${domain}`;
}

/** What a step shows about the values it writes: emails masked, nothing else altered. */
function display(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = k === 'email' ? maskEmail(v) : v;
  return out;
}

function fullName(profile) {
  return `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
}

function blank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (c) => `\\${c}`);
}

function regionFor(city) {
  return /yaound/i.test(city) ? 'Centre' : 'Littoral';
}

class HouseStoreProvisioner {
  /**
   * @param {object} deps
   * @param {object} deps.db Supabase-style admin client (schema iam). Required.
   * @param {() => Date} [deps.now]
   * @param {() => number} [deps.curatedCount] How many curated products the house store sells.
   * @param {(clerkUserId:string, userId:string) => Promise<void>} [deps.invalidateProfile]
   *   Best-effort cache drop for the owner's profile after it is changed.
   */
  constructor({ db, now, curatedCount, invalidateProfile } = {}) {
    if (!db) throw new Error('HouseStoreProvisioner needs a database client');
    this.db = db;
    this.now = typeof now === 'function' ? now : () => new Date();
    this.curatedCount = typeof curatedCount === 'function' ? curatedCount : defaultCuratedCount;
    this.invalidateProfile = invalidateProfile || null;
  }

  /**
   * Plans (and, with `apply`, performs) the provisioning.
   * @param {object} opts
   * @param {string} [opts.ownerEmail]  Looked up among VERIFIED emails; exactly one live account must match.
   * @param {string} [opts.ownerId]     Alternative to ownerEmail: the profile id itself.
   * @param {string} [opts.phone]       Public contact / WhatsApp number of the store and the agency.
   * @param {string} [opts.storeEmail]  Public store email (default: the owner's).
   * @param {string[]} [opts.riderEmails] Verified-email accounts to register as nanoDelivery riders.
   * @param {string} [opts.city]        Store city (default Douala).
   * @param {string} [opts.street]      Pickup street address (default empty: set it in Seller Studio).
   * @param {boolean} [opts.apply]      Write. Requires confirmOwnerId.
   * @param {string} [opts.confirmOwnerId] Must equal the matched owner id.
   */
  async run(opts = {}) {
    const input = this._normalise(opts);
    const owner = await this._findOwner(input);
    const riders = [];
    for (const email of input.riderEmails) riders.push(await this._findRider(email, owner));

    const plan = await this._plan(input, owner, riders);
    const result = {
      mode: input.apply ? 'apply' : 'dry-run',
      owner: {
        id: owner.id,
        name: fullName(owner) || '(no name)',
        email: maskEmail(owner.email),
        phone: owner.phone_number || null,
        primaryRole: owner.primary_role,
        sellerStatus: owner.seller_status,
        onboardingStatus: owner.onboarding_status
      },
      riders: riders.map((r) => ({ id: r.id, name: fullName(r) || '(no name)', email: maskEmail(r.email), phone: r.phone_number || null })),
      steps: plan.steps.map(({ run, ...visible }) => visible),
      warnings: plan.warnings,
      blockers: plan.blockers,
      applied: false,
      changed: 0
    };

    if (!input.apply) return result;

    if (!input.confirmOwnerId || input.confirmOwnerId !== owner.id) {
      throw fail(
        `Refusing to write: --confirm-owner-id must equal the account matched by the dry run (${owner.id}).`,
        { matchedOwnerId: owner.id }
      );
    }
    if (plan.blockers.length) {
      throw new ConflictError(`Refusing to write: ${plan.blockers.length} problem(s) must be fixed first.`, { blockers: plan.blockers });
    }

    // Parents before children: every foreign key is satisfied at the moment it is checked.
    for (const step of plan.steps) {
      if (step.action === 'create' || step.action === 'update') {
        await step.run();
        result.changed += 1;
      }
    }
    result.applied = true;

    if (this.invalidateProfile && result.steps.some((s) => s.table === 'profiles' && s.action === 'update')) {
      try { await this.invalidateProfile(owner.clerk_user_id, owner.id); } catch (_) { /* best effort */ }
    }
    return result;
  }

  // ------------------------------------------------------------------ input

  _normalise(opts) {
    const ownerEmail = blank(opts.ownerEmail) ? null : String(opts.ownerEmail).trim().toLowerCase();
    const ownerId = blank(opts.ownerId) ? null : String(opts.ownerId).trim();
    if (!!ownerEmail === !!ownerId) {
      throw fail('Name the owner with exactly one of --owner-email or --owner-id.');
    }
    const riderEmails = [...new Set((opts.riderEmails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
    const city = blank(opts.city) ? DEFAULT_CITY : String(opts.city).trim();
    return {
      ownerEmail,
      ownerId,
      phone: blank(opts.phone) ? null : String(opts.phone).trim(),
      storeEmail: blank(opts.storeEmail) ? null : String(opts.storeEmail).trim().toLowerCase(),
      riderEmails,
      city,
      street: blank(opts.street) ? '' : String(opts.street).trim(),
      apply: opts.apply === true,
      confirmOwnerId: blank(opts.confirmOwnerId) ? null : String(opts.confirmOwnerId).trim()
    };
  }

  // ---------------------------------------------------------------- lookups

  _assertLiveAccount(profile, label) {
    if (profile.deleted_at || profile.account_status === 'anonymized' || profile.status === 'deleted' || profile.status === 'deactivated') {
      throw fail(`${label} (${profile.id}) is a deleted or deactivated account.`);
    }
    if (profile.account_status === 'suspended' || profile.status === 'suspended') {
      throw fail(`${label} (${profile.id}) is suspended.`);
    }
  }

  async _findOwner(input) {
    if (input.ownerId) {
      const data = must(await this.db.from('profiles').select(PROFILE_COLUMNS).eq('id', input.ownerId).maybeSingle(), 'owner lookup');
      if (!data) throw fail(`No account has the id ${input.ownerId}.`);
      this._assertLiveAccount(data, 'The owner account');
      if (!data.email_verified_at) {
        throw fail(`The owner account ${data.id} has no verified email, so it cannot sign in to sell. Verify it first.`);
      }
      return data;
    }
    return this._findByVerifiedEmail(input.ownerEmail, 'owner');
  }

  /** Exactly one live account with this email, and its email must be verified. */
  async _findByVerifiedEmail(email, label) {
    const rows = must(
      await this.db.from('profiles').select(PROFILE_COLUMNS).ilike('email', escapeLike(email)).limit(10),
      `${label} lookup`
    ) || [];
    // ilike is case-insensitive but also pattern-aware; only an exact (case-insensitive) match counts.
    const matches = rows.filter((r) => String(r.email || '').toLowerCase() === email && !r.deleted_at && r.account_status !== 'anonymized');
    if (matches.length === 0) throw fail(`No account has the email ${email} (${label}).`);
    if (matches.length > 1) {
      throw fail(`More than one account has the email ${email} (${label}): ${matches.map((m) => m.id).join(', ')}. Use --owner-id to choose one.`);
    }
    const profile = matches[0];
    this._assertLiveAccount(profile, `The ${label} account`);
    if (!profile.email_verified_at) {
      throw fail(`The email ${email} (${label}) is not verified. Only a verified email can be matched to an account.`);
    }
    return profile;
  }

  async _findRider(email, owner) {
    const profile = await this._findByVerifiedEmail(email, 'rider');
    if (profile.id === owner.id) {
      throw fail('The owner is the nanoDelivery agency itself; give --rider-email an account of someone who will ride.');
    }
    return profile;
  }

  async _one(table, column, value, select = '*') {
    return must(await this.db.from(table).select(select).eq(column, value).maybeSingle(), `${table} read`);
  }

  // ------------------------------------------------------------------- plan

  async _plan(input, owner, riders) {
    const steps = [];
    const warnings = [];
    const blockers = [];
    const nowIso = this.now().toISOString();
    const phone = input.phone || owner.phone_number || null;
    const storeEmail = input.storeEmail || (owner.email ? String(owner.email).toLowerCase() : null);
    const city = input.city;
    const db = this.db;

    if (!phone) {
      warnings.push('NO PHONE NUMBER: the owner profile has none and --phone was not given. Buyers could not call or WhatsApp the store and the agency record cannot be created. Pass --phone.');
      blockers.push('A contact phone is required (--phone), because the owner profile has none.');
    } else if (phone.length < 6) {
      blockers.push(`The phone number "${phone}" is too short to be a contact number.`);
    }

    const productCount = Number(this.curatedCount()) || 0;

    // ---- store -----------------------------------------------------------
    const existingStore = await this._one('stores', 'id', HOUSE_STORE.id);
    const slugHolder = await this._one('stores', 'slug', HOUSE_STORE.slug, 'id, owner_id');
    if (slugHolder && slugHolder.id !== HOUSE_STORE.id) {
      blockers.push(`The slug "${HOUSE_STORE.slug}" is already used by another store (${slugHolder.id}).`);
    }
    const storeDescription = `${HOUSE_STORE.name} is the official LOUMOO house store: ${productCount ? `${productCount} curated products` : 'curated products'}, delivered by ${HOUSE_AGENCY.name} in ${city} and across Cameroon.`;
    const storeRow = {
      id: HOUSE_STORE.id,
      owner_id: owner.id,
      organization_id: null,
      seller_type: HOUSE_STORE_SELLER_TYPE,
      name: HOUSE_STORE.name,
      slug: HOUSE_STORE.slug,
      description: storeDescription,
      category_id: HOUSE_STORE_CATEGORY,
      phone_number: phone,
      email: storeEmail,
      status: 'ACTIVE',
      visibility: 'PUBLIC',
      is_verified: true,
      verification_tier: HOUSE_STORE_VERIFICATION_TIER,
      reputation_score: 100.00,
      trust_tier: 'NEW',
      onboarding_step: 'ACTIVE',
      onboarding_completed: true,
      product_count: productCount,
      metadata: { city, phone, houseStore: true },
      created_at: nowIso,
      updated_at: nowIso
    };
    let storeIsLive = true;
    if (!existingStore) {
      steps.push({
        table: 'stores', key: HOUSE_STORE.id, action: 'create',
        note: `${HOUSE_STORE.name}, ACTIVE + PUBLIC, verified (${HOUSE_STORE_VERIFICATION_TIER}), seller type ${HOUSE_STORE_SELLER_TYPE}, ${productCount} curated products`,
        fields: display({ owner_id: owner.id, phone_number: phone, email: storeEmail }),
        run: async () => must(await db.from('stores').insert(storeRow), 'create store')
      });
    } else if (existingStore.owner_id !== owner.id || existingStore.deleted_at) {
      storeIsLive = false;
      blockers.push(existingStore.deleted_at
        ? `The store ${HOUSE_STORE.id} exists but is deleted; restore or remove it by hand first.`
        : `The store ${HOUSE_STORE.id} already exists and belongs to another account (${existingStore.owner_id}). Moving a store between owners is a manual decision.`);
      steps.push({ table: 'stores', key: HOUSE_STORE.id, action: 'conflict', note: 'owned by someone else or deleted' });
    } else {
      // Fill blanks and refresh the derived counter; never touch what was edited.
      const patch = {};
      if (blank(existingStore.phone_number) && phone) patch.phone_number = phone;
      if (blank(existingStore.email) && storeEmail) patch.email = storeEmail;
      if (blank(existingStore.description)) patch.description = storeDescription;
      if (productCount && Number(existingStore.product_count) !== productCount) patch.product_count = productCount;
      if (existingStore.status !== 'ACTIVE') {
        warnings.push(`The store ${HOUSE_STORE.id} is ${existingStore.status}, not ACTIVE. It was left as it is, so orders for curated products are refused until it is reactivated.`);
      }
      if (Object.keys(patch).length) {
        steps.push({
          table: 'stores', key: HOUSE_STORE.id, action: 'update', note: 'fills blank fields and refreshes the product count only', fields: display(patch),
          run: async () => must(await db.from('stores').update({ ...patch, updated_at: nowIso }).eq('id', HOUSE_STORE.id), 'update store')
        });
      } else {
        steps.push({ table: 'stores', key: HOUSE_STORE.id, action: 'exists', note: `status ${existingStore.status}, left as it is` });
      }
    }

    const otherStores = must(
      await db.from('stores').select('id, name, status').eq('owner_id', owner.id).is('deleted_at', null).limit(20),
      'owner stores read'
    ) || [];
    const owned = otherStores.filter((s) => s.id !== HOUSE_STORE.id);
    if (owned.length) {
      warnings.push(`The owner already has another store (${owned.map((s) => `${s.id} "${s.name}"`).join(', ')}). The account keeps it as its primary store; ${HOUSE_STORE.name} is added alongside it and orders for curated products still reach the owner.`);
    }

    // ---- store members and the store's secondary records -----------------
    if (storeIsLive) {
      const member = existingStore
        ? must(await db.from('store_members').select('id').eq('store_id', HOUSE_STORE.id).eq('user_id', owner.id).maybeSingle(), 'store member read')
        : null;
      if (!member) {
        steps.push({
          table: 'store_members', key: `${HOUSE_STORE.id}/${owner.id}`, action: 'create', note: 'owner membership with every permission',
          run: async () => must(await db.from('store_members').insert({ store_id: HOUSE_STORE.id, user_id: owner.id, role: 'owner', permissions: ROLE_OWNER_PERMISSIONS }), 'create store member')
        });
      } else {
        steps.push({ table: 'store_members', key: `${HOUSE_STORE.id}/${owner.id}`, action: 'exists' });
      }

      const secondary = [
        {
          table: 'store_profiles', note: 'public tagline and contact link',
          row: {
            store_id: HOUSE_STORE.id,
            tagline: `Authentic products, delivered by ${HOUSE_AGENCY.name}`,
            bio: storeDescription,
            // No "escrow_ready" badge (the schema default): there is no payment gateway.
            badges: [],
            social_links: { whatsapp: phone || '', facebook: '', instagram: '', website: '' }
          }
        },
        {
          table: 'store_settings', note: 'pay on delivery or pickup; no online payment methods (no payment gateway exists)',
          row: {
            store_id: HOUSE_STORE.id, currency: 'XAF',
            accepts_escrow: false, accepts_momo: false, accepts_orange_money: false,
            accepts_cash_on_delivery: true, allow_store_pickup: true, allow_national_shipping: true
          }
        },
        {
          table: 'store_locations', note: input.street ? `${city}, ${input.street}` : `${city} (set the pickup street in Seller Studio)`,
          row: {
            store_id: HOUSE_STORE.id, city, region: regionFor(city),
            district_quarter: /^douala$/i.test(city) ? 'Akwa' : city,
            street_address: input.street
          }
        },
        {
          table: 'store_hours', note: 'default opening hours (Africa/Douala)',
          row: { store_id: HOUSE_STORE.id, timezone: 'Africa/Douala' }
        }
      ];
      for (const s of secondary) {
        const have = existingStore
          ? must(await db.from(s.table).select('id').eq('store_id', HOUSE_STORE.id).maybeSingle(), `${s.table} read`)
          : null;
        if (have) {
          steps.push({ table: s.table, key: HOUSE_STORE.id, action: 'exists', note: 'left as the owner set it' });
        } else {
          steps.push({
            table: s.table, key: HOUSE_STORE.id, action: 'create', note: s.note,
            run: async () => must(await db.from(s.table).insert(s.row), `create ${s.table}`)
          });
        }
      }
    }

    // ---- agency organization ---------------------------------------------
    const existingOrg = await this._one('organizations', 'id', HOUSE_AGENCY.organizationId);
    const orgSlugHolder = await this._one('organizations', 'slug', HOUSE_AGENCY.slug, 'id');
    if (orgSlugHolder && orgSlugHolder.id !== HOUSE_AGENCY.organizationId) {
      blockers.push(`The organization slug "${HOUSE_AGENCY.slug}" is already used by another organization (${orgSlugHolder.id}).`);
    }
    const orgDescription = `${HOUSE_AGENCY.name} is the delivery agency of ${HOUSE_STORE.name}: its riders collect and deliver the orders placed on the house store.`;
    let orgIsLive = true;
    if (!existingOrg) {
      steps.push({
        table: 'organizations', key: HOUSE_AGENCY.organizationId, action: 'create', note: `${HOUSE_AGENCY.name}, type ${HOUSE_AGENCY_ORG_TYPE}`,
        fields: { owner_id: owner.id, phone_number: phone },
        run: async () => must(await db.from('organizations').insert({
          id: HOUSE_AGENCY.organizationId,
          owner_id: owner.id,
          name: HOUSE_AGENCY.name,
          slug: HOUSE_AGENCY.slug,
          org_type: HOUSE_AGENCY_ORG_TYPE,
          description: orgDescription,
          email: storeEmail,
          phone_number: phone,
          city,
          country: 'Cameroon',
          status: 'ACTIVE',
          metadata: { houseAgency: true },
          created_at: nowIso,
          updated_at: nowIso
        }), 'create organization')
      });
    } else if (existingOrg.owner_id !== owner.id || existingOrg.deleted_at) {
      orgIsLive = false;
      blockers.push(existingOrg.deleted_at
        ? `The organization ${HOUSE_AGENCY.organizationId} exists but is deleted; restore or remove it by hand first.`
        : `The organization ${HOUSE_AGENCY.organizationId} already exists and belongs to another account (${existingOrg.owner_id}).`);
      steps.push({ table: 'organizations', key: HOUSE_AGENCY.organizationId, action: 'conflict', note: 'owned by someone else or deleted' });
    } else {
      const patch = {};
      if (blank(existingOrg.phone_number) && phone) patch.phone_number = phone;
      if (blank(existingOrg.email) && storeEmail) patch.email = storeEmail;
      if (blank(existingOrg.description)) patch.description = orgDescription;
      if (existingOrg.org_type !== HOUSE_AGENCY_ORG_TYPE) {
        blockers.push(`The organization ${HOUSE_AGENCY.organizationId} is of type ${existingOrg.org_type}, not ${HOUSE_AGENCY_ORG_TYPE}.`);
      }
      if (existingOrg.status !== 'ACTIVE') {
        warnings.push(`The organization ${HOUSE_AGENCY.organizationId} is ${existingOrg.status}. It was left as it is.`);
      }
      if (Object.keys(patch).length) {
        steps.push({
          table: 'organizations', key: HOUSE_AGENCY.organizationId, action: 'update', note: 'fills blank fields only', fields: display(patch),
          run: async () => must(await db.from('organizations').update({ ...patch, updated_at: nowIso }).eq('id', HOUSE_AGENCY.organizationId), 'update organization')
        });
      } else {
        steps.push({ table: 'organizations', key: HOUSE_AGENCY.organizationId, action: 'exists', note: `status ${existingOrg.status}` });
      }
    }

    if (orgIsLive) {
      const ownerMember = existingOrg
        ? must(await db.from('organization_members').select('id, role, status').eq('organization_id', HOUSE_AGENCY.organizationId).eq('user_id', owner.id).maybeSingle(), 'organization member read')
        : null;
      if (!ownerMember) {
        steps.push({
          table: 'organization_members', key: `${HOUSE_AGENCY.organizationId}/${owner.id}`, action: 'create', note: 'owner membership (OWNER, ACTIVE)',
          run: async () => must(await db.from('organization_members').insert({
            organization_id: HOUSE_AGENCY.organizationId, user_id: owner.id, role: 'OWNER', permissions: ROLE_OWNER_PERMISSIONS, status: 'ACTIVE'
          }), 'create organization owner member')
        });
      } else {
        steps.push({ table: 'organization_members', key: `${HOUSE_AGENCY.organizationId}/${owner.id}`, action: 'exists', note: `${ownerMember.role}, ${ownerMember.status}` });
      }
    }

    // ---- the agency as a delivery provider -------------------------------
    const agency = await this._one('delivery_drivers', 'profile_id', owner.id);
    if (!agency) {
      steps.push({
        table: 'delivery_drivers', key: owner.id, action: 'create',
        note: `${HOUSE_AGENCY.name} as a delivery provider (agency, standard city rate, no service-area limit)`,
        fields: { display_name: HOUSE_AGENCY.name, phone, organization_id: HOUSE_AGENCY.organizationId },
        run: async () => must(await db.from('delivery_drivers').insert({
          profile_id: owner.id,
          display_name: HOUSE_AGENCY.name,
          phone: phone || '',
          status: 'active',
          created_by: owner.id,
          is_agency: true,
          organization_id: HOUSE_AGENCY.organizationId,
          base_fee_xaf: null,
          service_areas: []
        }), 'create agency provider')
      });
    } else if (!agency.is_agency || agency.organization_id !== HOUSE_AGENCY.organizationId) {
      blockers.push(`The owner (${owner.id}) is already registered as a delivery provider that is not ${HOUSE_AGENCY.name}${agency.is_agency ? ` (agency of ${agency.organization_id})` : ' (a plain rider)'}. A profile can hold only one provider record; use another account as the owner or remove that record first.`);
      steps.push({ table: 'delivery_drivers', key: owner.id, action: 'conflict', note: 'owner already holds a different provider record' });
    } else {
      if (agency.status !== 'active') {
        warnings.push(`${HOUSE_AGENCY.name} is ${agency.status} as a delivery provider; it was left as it is.`);
      }
      steps.push({ table: 'delivery_drivers', key: owner.id, action: 'exists', note: `tariff, areas and phone left as set (status ${agency.status})` });
    }

    // ---- riders ----------------------------------------------------------
    for (const rider of riders) {
      const name = fullName(rider) || String(rider.email).split('@')[0];
      const driver = await this._one('delivery_drivers', 'profile_id', rider.id);
      if (!driver) {
        if (blank(rider.phone_number) || String(rider.phone_number).trim().length < 6) {
          blockers.push(`The rider ${maskEmail(rider.email)} (${rider.id}) has no usable phone number on their profile; the customer must be able to call them.`);
        }
        steps.push({
          table: 'delivery_drivers', key: rider.id, action: 'create', note: `rider ${name}`,
          fields: { display_name: name, phone: rider.phone_number || null },
          run: async () => must(await db.from('delivery_drivers').insert({
            profile_id: rider.id, display_name: name, phone: rider.phone_number, status: 'active', created_by: owner.id,
            is_agency: false, organization_id: null, service_areas: []
          }), `register rider ${rider.id}`)
        });
      } else if (driver.is_agency) {
        blockers.push(`The account ${rider.id} is an agency provider (${driver.organization_id}), not a rider.`);
        steps.push({ table: 'delivery_drivers', key: rider.id, action: 'conflict', note: 'is an agency, not a rider' });
      } else {
        if (driver.status !== 'active') warnings.push(`The rider ${maskEmail(rider.email)} is ${driver.status}; left as it is.`);
        steps.push({ table: 'delivery_drivers', key: rider.id, action: 'exists', note: `already a rider (${driver.status}); profile left as set` });
      }

      if (orgIsLive) {
        const member = existingOrg
          ? must(await db.from('organization_members').select('id, status').eq('organization_id', HOUSE_AGENCY.organizationId).eq('user_id', rider.id).maybeSingle(), 'rider membership read')
          : null;
        if (!member) {
          steps.push({
            table: 'organization_members', key: `${HOUSE_AGENCY.organizationId}/${rider.id}`, action: 'create', note: `${name} joins ${HOUSE_AGENCY.name}, so the agency can hand deliveries to them`,
            run: async () => must(await db.from('organization_members').insert({
              organization_id: HOUSE_AGENCY.organizationId, user_id: rider.id, role: 'MEMBER', permissions: ROLE_MEMBER_PERMISSIONS, status: 'ACTIVE', invited_by: owner.id
            }), `add rider ${rider.id} to the agency`)
          });
        } else {
          if (member.status !== 'ACTIVE') warnings.push(`The rider ${maskEmail(rider.email)} is ${member.status} in ${HOUSE_AGENCY.name}; left as it is, so the agency cannot delegate to them.`);
          steps.push({ table: 'organization_members', key: `${HOUSE_AGENCY.organizationId}/${rider.id}`, action: 'exists', note: `status ${member.status}` });
        }
      }
    }

    // ---- the owner's own account -----------------------------------------
    // What activating a store does for a seller (StoreOnboardingUseCase): seller
    // status READY, the primary store, and the seller role. READY requires a
    // COMPLETED onboarding (chk_profiles_seller_requires_onboarding), so an owner
    // who never finished it is completed here and the dry run says so.
    const patch = {};
    if (owner.primary_role === 'customer') patch.primary_role = 'seller';
    if (owner.onboarding_status !== 'COMPLETED') {
      patch.onboarding_status = 'COMPLETED';
      patch.onboarding_completed_at = nowIso;
      if (!owner.onboarding_started_at) patch.onboarding_started_at = nowIso;
    }
    if (owner.seller_status !== 'READY') patch.seller_status = 'READY';
    if (blank(owner.primary_store_id)) {
      patch.primary_store_id = HOUSE_STORE.id;
    } else if (owner.primary_store_id !== HOUSE_STORE.id) {
      const primary = await this._one('stores', 'id', owner.primary_store_id, 'id, deleted_at');
      if (!primary || primary.deleted_at) patch.primary_store_id = HOUSE_STORE.id;
    }
    if (Object.keys(patch).length && storeIsLive) {
      steps.push({
        table: 'profiles', key: owner.id, action: 'update', note: 'lets the owner sell and use the dispatch board (as activating a store does)', fields: patch,
        run: async () => must(await db.from('profiles').update({ ...patch, updated_at: nowIso }).eq('id', owner.id), 'update owner account')
      });
    } else {
      steps.push({ table: 'profiles', key: owner.id, action: 'exists', note: `role ${owner.primary_role}, seller status ${owner.seller_status}` });
    }
    if (owner.primary_role === 'admin' || owner.primary_role === 'super_admin') {
      warnings.push(`The owner is a platform ${owner.primary_role}; the role was kept as it is.`);
    }

    return { steps, warnings, blockers };
  }
}

function defaultCuratedCount() {
  try {
    return Object.keys(require('../../catalog/dataLoader').catalogProducts || {}).length;
  } catch (_) {
    return 0;
  }
}

module.exports = {
  HouseStoreProvisioner,
  HOUSE_STORE_VERIFICATION_TIER,
  maskEmail
};
