/**
 * LOUMOO — an organization ADMIN cannot make anyone OWNER
 * ---------------------------------------------------------------------------
 * OrganizationService.updateMember only refused a non-owner touching a member
 * who was ALREADY owner. Changing a member's role TO owner was not checked, so
 * an ADMIN could PATCH their own membership to OWNER (permissions ['*']) and
 * then deactivate the organization. addMember already refused this; now
 * updateMember does too. An unknown member status is a 400, not a database
 * CHECK violation.
 *
 * Hermetic: memberships come from a stand-in; writes are recorded.
 */

require('../setup');

const assert = require('assert');
const SupabaseModule = require('../../server/infrastructure/database/SupabaseClient');
const OrganizationService = require('../../server/modules/identity/application/OrganizationService');
const { OrganizationMember, ORG_ROLES, ROLE_PERMISSIONS } = require('../../server/modules/identity/domain/Organization');

const ORG = '00000000-0000-4000-8000-000000000001';
const members = {
  usr_owner: { organization_id: ORG, user_id: 'usr_owner', role: ORG_ROLES.OWNER, status: 'ACTIVE', permissions: ROLE_PERMISSIONS[ORG_ROLES.OWNER] },
  usr_admin: { organization_id: ORG, user_id: 'usr_admin', role: ORG_ROLES.ADMIN, status: 'ACTIVE', permissions: ROLE_PERMISSIONS[ORG_ROLES.ADMIN] },
  usr_staff: { organization_id: ORG, user_id: 'usr_staff', role: ORG_ROLES.MANAGER, status: 'ACTIVE', permissions: ROLE_PERMISSIONS[ORG_ROLES.MANAGER] }
};

async function rejects(label, fn, re) {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert.ok(err, `${label}: was allowed`);
  assert.ok(re.test(err.message), `${label}: ${err.message}`);
}

(async () => {
  const writes = [];
  const originalGetMembership = OrganizationService.getMembership;
  const originalGetAdmin = SupabaseModule.SupabaseClient.getAdmin;
  OrganizationService.getMembership = async (orgId, userId) => (members[userId] ? new OrganizationMember(members[userId]) : null);
  SupabaseModule.SupabaseClient.getAdmin = () => ({
    from: () => {
      let payload = null;
      const q = {
        update: (p) => { payload = p; return q; },
        eq: () => q, select: () => q,
        single: async () => { writes.push(payload); return { data: { ...members.usr_staff, ...payload }, error: null }; }
      };
      return q;
    }
  });

  try {
    await rejects('admin promotes self to OWNER',
      () => OrganizationService.updateMember(ORG, { id: 'usr_admin' }, 'usr_admin', { role: 'OWNER' }), /owner/i);
    await rejects('admin promotes a manager to OWNER',
      () => OrganizationService.updateMember(ORG, { id: 'usr_admin' }, 'usr_staff', { role: 'owner' }), /owner/i);
    assert.deepStrictEqual(writes, [], 'no membership was written');

    await rejects('an unknown status',
      () => OrganizationService.updateMember(ORG, { id: 'usr_admin' }, 'usr_staff', { status: 'banned' }), /Invalid status/);

    // What stays allowed: the owner grants OWNER; an admin changes a manager's role or status.
    await OrganizationService.updateMember(ORG, { id: 'usr_owner' }, 'usr_staff', { role: 'OWNER' });
    await OrganizationService.updateMember(ORG, { id: 'usr_admin' }, 'usr_staff', { role: 'ADMIN', status: 'suspended' });
    assert.strictEqual(writes.length, 2, 'both allowed changes were written');
    assert.strictEqual(writes[1].status, 'SUSPENDED');
  } finally {
    OrganizationService.getMembership = originalGetMembership;
    SupabaseModule.SupabaseClient.getAdmin = originalGetAdmin;
  }

  console.log('org_owner_escalation: only the owner grants OWNER; statuses are validated');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
