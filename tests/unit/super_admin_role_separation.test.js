/**
 * `admin` and `super_admin` are different powers (docs/ROUTING.md, "Admin vs super admin").
 *
 * Before this, the whole of /api/v1/admin/* accepted either role identically, so an
 * `admin` could (a) promote any account - itself included - to `super_admin`, (b) put
 * `primary_role` (or any column) into the generic user update, (c) rewrite platform
 * settings and (d) switch maintenance mode on. The tests/routing end-to-end suite
 * reproduced (a) and (b) against the real server and database (KNOWN_GAP lines); this
 * suite pins the fix hermetically, through the real admin router and controllers.
 *
 * Hermetic: the router is mounted on a throwaway Express app with the principal injected
 * by a header, the repository runs on its in-memory seed (NODE_ENV=test), no credentials.
 */
'use strict';

require('../setup');
const assert = require('assert');
const http = require('http');
const express = require('express');

const adminRouter = require('../../SuperAdmin/backend/routes/superAdminRoutes');
const errorHandler = require('../../server/shared/middleware/errorHandler');
const SuperAdminRepository = require('../../SuperAdmin/backend/repositories/SuperAdminRepository');

function makeApp() {
  const app = express();
  app.use(express.json());
  // Stand-in for requireAuth: attaches the principal the header names. Everything after it is real.
  app.use((req, _res, next) => {
    const role = req.headers['x-test-role'];
    if (role) req.principal = { id: req.headers['x-test-id'] || ('actor_' + role), primaryRole: role };
    next();
  });
  app.use('/api/v1/admin', adminRouter);
  app.use(errorHandler);
  return app;
}

function call(server, method, path, role, body, id) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const headers = { 'Content-Type': 'application/json' };
    if (role) headers['x-test-role'] = role;
    if (id) headers['x-test-id'] = id;
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch (e) { json = data; } resolve({ status: res.statusCode, body: json }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  assert.strictEqual(process.env.NODE_ENV, 'test');
  const server = http.createServer(makeApp());
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const U = '/api/v1/admin/users/';
  try {
    // --- who may open the admin API at all (unchanged) ---------------------------------
    for (const role of ['customer', 'seller', 'moderator']) {
      const r = await call(server, 'GET', '/api/v1/admin/overview', role);
      assert.strictEqual(r.status, 403, `${role} must not reach the admin API`);
    }
    assert.strictEqual((await call(server, 'GET', '/api/v1/admin/overview')).status, 401, 'no principal -> 401');
    for (const role of ['admin', 'super_admin']) {
      assert.strictEqual((await call(server, 'GET', '/api/v1/admin/users', role)).status, 200, `${role} lists users`);
    }
    console.log('    ✓ super_admin_role_separation: customer/seller/moderator are refused, admin and super_admin reach the admin API');

    // --- (a) an admin cannot hand out roles -----------------------------------------------
    let r = await call(server, 'PUT', U + 'usr_buyer_1/role', 'admin', { role: 'super_admin' });
    assert.strictEqual(r.status, 403, `admin -> super_admin promotion must be refused (got ${r.status})`);
    r = await call(server, 'PATCH', U + 'usr_buyer_1/role', 'admin', { role: 'admin' });
    assert.strictEqual(r.status, 403, 'admin must not mint another admin');
    r = await call(server, 'PUT', U + 'usr_buyer_1/role', 'admin', { role: 'seller' });
    assert.strictEqual(r.status, 403, 'role changes need a super administrator');
    assert.strictEqual((await SuperAdminRepository.getUserById('usr_buyer_1')).primary_role, 'customer', 'nothing changed');
    console.log('    ✓ super_admin_role_separation: an admin cannot change any role (no admin -> super_admin escalation)');

    // --- (b) the generic update no longer takes arbitrary columns ------------------------------
    for (const body of [{ primary_role: 'super_admin' }, { clerk_user_id: 'x' }, { seller_status: 'READY' }, { first_name: 'Ok', primary_role: 'admin' }]) {
      r = await call(server, 'PATCH', U + 'usr_buyer_1', 'admin', body);
      assert.strictEqual(r.status, 400, `${JSON.stringify(body)} must be refused, got ${r.status}`);
    }
    r = await call(server, 'PATCH', U + 'usr_buyer_1', 'super_admin', { primary_role: 'admin' });
    assert.strictEqual(r.status, 400, 'even a super admin changes roles through the role route, not the generic update');
    assert.strictEqual((await SuperAdminRepository.getUserById('usr_buyer_1')).primary_role, 'customer');
    r = await call(server, 'PATCH', U + 'usr_buyer_1', 'admin', { status: 'banana' });
    assert.strictEqual(r.status, 400, 'status is validated');
    r = await call(server, 'PATCH', U + 'usr_buyer_1', 'admin', { city: 'Yaoundé', reason: 'address fix' });
    assert.strictEqual(r.status, 200, `a plain moderation edit still works (got ${r.status})`);
    assert.strictEqual((await SuperAdminRepository.getUserById('usr_buyer_1')).city, 'Yaoundé');
    console.log('    ✓ super_admin_role_separation: the generic user update accepts only moderation fields (no primary_role mass assignment)');

    // --- an admin cannot act on an account that outranks them -----------------------------
    r = await call(server, 'PATCH', U + 'usr_admin_1', 'admin', { status: 'suspended' });
    assert.strictEqual(r.status, 403, 'an admin must not suspend a super admin');
    assert.strictEqual((await SuperAdminRepository.getUserById('usr_admin_1')).status, 'active');
    r = await call(server, 'PATCH', U + 'usr_admin_1', 'super_admin', { city: 'Douala' });
    assert.strictEqual(r.status, 200, 'a super admin may edit another administrator');
    console.log('    ✓ super_admin_role_separation: an admin cannot modify an administrator account; a super admin can');

    // --- the super admin keeps the power, with a self-protection -----------------------------
    r = await call(server, 'PUT', U + 'usr_seller_1/role', 'super_admin', { role: 'moderator' }, 'actor_super');
    assert.strictEqual(r.status, 200, `super_admin changes a role (got ${r.status}: ${JSON.stringify(r.body).slice(0, 120)})`);
    assert.strictEqual((await SuperAdminRepository.getUserById('usr_seller_1')).primary_role, 'moderator');
    r = await call(server, 'PUT', U + 'usr_seller_1/role', 'super_admin', { role: 'wizard' }, 'actor_super');
    assert.strictEqual(r.status, 400, 'unknown roles are refused');
    r = await call(server, 'PUT', U + 'actor_super/role', 'super_admin', { role: 'customer' }, 'actor_super');
    assert.strictEqual(r.status, 400, 'nobody changes their own role');
    console.log('    ✓ super_admin_role_separation: a super admin can still grant roles; unknown roles and self-changes are refused');

    // --- (c)(d) platform-wide behaviour is the platform owner's -------------------------------------
    const platform = [
      ['PUT', '/api/v1/admin/settings/maintenance_mode', { value: { enabled: false } }],
      ['PUT', '/api/v1/admin/settings', { settings: {} }],
      ['PATCH', '/api/v1/admin/settings', { settings: {} }],
      ['POST', '/api/v1/admin/settings/reset/maintenance_mode', {}],
      ['POST', '/api/v1/admin/maintenance', { enabled: false }]
    ];
    for (const [m, p, b] of platform) {
      const denied = await call(server, m, p, 'admin', b);
      assert.strictEqual(denied.status, 403, `${m} ${p} must be super_admin only (admin got ${denied.status})`);
      const allowed = await call(server, m, p, 'super_admin', b);
      assert.notStrictEqual(allowed.status, 403, `${m} ${p} must stay available to super_admin (got ${allowed.status})`);
      assert.notStrictEqual(allowed.status, 401);
    }
    // Reading settings and the day-to-day moderation endpoints stay with admin.
    for (const p of ['/api/v1/admin/settings', '/api/v1/admin/overview', '/api/v1/admin/audit-logs', '/api/v1/admin/stores', '/api/v1/admin/orders']) {
      assert.strictEqual((await call(server, 'GET', p, 'admin')).status, 200, `admin still reads ${p}`);
    }
    console.log('    ✓ super_admin_role_separation: settings writes and maintenance are super_admin only; admins keep read and moderation access');
  } finally {
    await new Promise(r => server.close(r));
  }
}

module.exports = { run };

if (require.main === module) {
  run().then(() => { console.log('super_admin_role_separation: OK'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
