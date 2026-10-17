/**
 * LOUMOO — Migration 021 (in-app messaging) against a real Postgres (PGlite)
 * ---------------------------------------------------------------------------
 * Every migration is applied twice (they must be re-runnable), then:
 *
 *   1. CONSTRAINTS. No conversation with oneself; one per (buyer, store); a body
 *      over 2000 characters, an unknown kind and a repeated clientId are refused.
 *   2. TRIGGER. Inbox preview, unread counters and read marks are kept by the
 *      insert trigger, and they match Conversation.applyInsert — the rule the
 *      in-memory repository (and so the service tests) uses — message for message.
 *   3. ACCESS. The server role can do everything; a browser role holding every
 *      grant still reads nothing that is not its own (row-level security).
 *
 * Needs @electric-sql/pglite. It is not a dependency of the app: when it cannot be
 * loaded the suite says SKIPPED (and fails under CI). Locally:
 *   NODE_PATH=<dir with pglite>/node_modules node tests/unit/messaging_migration.test.js
 */

require('../setup');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const Conv = require('../../server/modules/messaging/domain/Conversation');

const MIGRATIONS = path.resolve(__dirname, '../../server/infrastructure/database/migrations');

function loadPglite() {
  try {
    return {
      PGlite: require('@electric-sql/pglite').PGlite,
      extensions: {
        pg_trgm: require('@electric-sql/pglite/contrib/pg_trgm').pg_trgm,
        uuid_ossp: require('@electric-sql/pglite/contrib/uuid_ossp').uuid_ossp,
        pgcrypto: require('@electric-sql/pglite/contrib/pgcrypto').pgcrypto
      }
    };
  } catch (e) {
    return null;
  }
}

async function sqlstate(db, sql, params) {
  try {
    await db.query(sql, params);
    return 'OK';
  } catch (e) {
    return e.code || e.message;
  }
}

async function applyAll(db) {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    try {
      await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    } catch (e) {
      try { await db.exec('ROLLBACK'); } catch (_) { /* nothing open */ }
      throw new Error(`${f} failed: ${String(e.message).split('\n')[0]}`);
    }
  }
  return files;
}

const iso = (v) => (v instanceof Date ? v.toISOString() : v);

async function run() {
  const lib = loadPglite();
  if (!lib) {
    if (process.env.CI) throw new Error('@electric-sql/pglite is not installed: migration 021 cannot be checked.');
    console.log('    - messaging migration: SKIPPED (@electric-sql/pglite is not installed)');
    return;
  }

  const db = new lib.PGlite({ extensions: lib.extensions });
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT ''service_role''::text';
    CREATE SCHEMA IF NOT EXISTS extensions;`);

  const files = await applyAll(db);
  assert.ok(files.includes('021_in_app_messaging.sql'), 'migration 021 is in the set');
  await applyAll(db);

  for (const id of ['buyer_1', 'seller_1', 'buyer_2']) {
    await db.query('INSERT INTO iam.profiles (id, clerk_user_id) VALUES ($1, $2)', [id, `clerk_${id}`]);
  }
  await db.query(`INSERT INTO iam.stores (id, owner_id, name, slug) VALUES ('store_1', 'seller_1', 'Orca', 'orca')`);

  // ---------------------------------------------------------------- 1. constraints
  assert.strictEqual(await sqlstate(db,
    `INSERT INTO iam.conversations (buyer_id, seller_id, store_id) VALUES ('seller_1', 'seller_1', 'store_1')`), '23514',
  'nobody can open a conversation with themselves');
  const conv = (await db.query(
    `INSERT INTO iam.conversations (id, buyer_id, seller_id, store_id) VALUES ('conv_1', 'buyer_1', 'seller_1', 'store_1') RETURNING *`)).rows[0];
  assert.strictEqual(conv.buyer_unread, 0);
  assert.strictEqual(await sqlstate(db,
    `INSERT INTO iam.conversations (buyer_id, seller_id, store_id) VALUES ('buyer_1', 'seller_1', 'store_1')`), '23505',
  'one conversation per buyer and store');

  const insert = (sender, kind, body, metadata = {}, clientId = null) => db.query(
    `INSERT INTO iam.messages (conversation_id, sender_id, kind, body, metadata, client_id)
     VALUES ('conv_1', $1, $2, $3, $4::jsonb, $5) RETURNING *`,
    [sender, kind, body, JSON.stringify(metadata), clientId]
  );
  assert.strictEqual(await sqlstate(db,
    `INSERT INTO iam.messages (conversation_id, sender_id, body) VALUES ('conv_1', 'buyer_1', $1)`, ['x'.repeat(2001)]), '23514',
  'a body over 2000 characters is refused by the table too');
  assert.strictEqual(await sqlstate(db,
    `INSERT INTO iam.messages (conversation_id, sender_id, kind) VALUES ('conv_1', 'buyer_1', 'voice')`), '23514',
  'unknown kinds are refused');

  // ------------------------------------------------------- 2. trigger == applyInsert
  // The in-memory model of the same conversation, advanced with every insert.
  let model = {
    id: 'conv_1', buyerId: 'buyer_1', sellerId: 'seller_1', storeId: 'store_1',
    buyerUnread: 0, sellerUnread: 0, buyerLastReadAt: null, sellerLastReadAt: null
  };
  const script = [
    ['buyer_1', 'product', '', { listingId: 'l1', title: 'Tecno Camon 50' }],
    ['buyer_1', 'text', 'Hello,\n\n is it   available?'],
    ['buyer_1', 'text', 'Delivery to Bonanjo?'],
    ['seller_1', 'text', 'Yes, today.'],
    ['seller_1', 'order', '', { orderNumber: 'LM-ABC123' }],
    ['buyer_1', 'text', 'Merci!'],
    ['buyer_1', 'text', 'y'.repeat(400)]
  ];
  const seqs = [];
  for (const [sender, kind, body, metadata] of script) {
    const message = (await insert(sender, kind, body, metadata || {})).rows[0];
    seqs.push(Number(message.seq));
    model = Conv.applyInsert(model, {
      senderId: sender, kind, body, metadata: metadata || {}, createdAt: iso(message.created_at)
    });
    const row = (await db.query(`SELECT * FROM iam.conversations WHERE id = 'conv_1'`)).rows[0];
    const label = `after ${sender}'s ${kind}`;
    assert.strictEqual(row.last_message_preview, model.lastMessagePreview, `preview ${label}`);
    assert.strictEqual(row.last_message_kind, model.lastMessageKind, `kind ${label}`);
    assert.strictEqual(row.last_sender_id, model.lastSenderId, `sender ${label}`);
    assert.strictEqual(row.buyer_unread, model.buyerUnread, `buyer unread ${label}`);
    assert.strictEqual(row.seller_unread, model.sellerUnread, `seller unread ${label}`);
    assert.strictEqual(iso(row.last_message_at), iso(message.created_at), `last message time ${label}`);
    assert.strictEqual(iso(row.buyer_last_read_at), model.buyerLastReadAt ? iso(model.buyerLastReadAt) : null, `buyer read mark ${label}`);
    assert.strictEqual(iso(row.seller_last_read_at), model.sellerLastReadAt ? iso(model.sellerLastReadAt) : null, `seller read mark ${label}`);
  }
  const final = (await db.query(`SELECT * FROM iam.conversations WHERE id = 'conv_1'`)).rows[0];
  assert.strictEqual(final.seller_unread, 2, 'the seller has the buyer\'s two latest messages to read');
  assert.strictEqual(final.buyer_unread, 0, 'the buyer read everything by replying');
  assert.strictEqual(final.last_message_preview.length, 160, 'the preview is capped');
  for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i] > seqs[i - 1], 'seq strictly increases: it is the polling cursor');

  // A retried send (same clientId from the same sender) is stored once.
  assert.strictEqual(await sqlstate(db,
    `INSERT INTO iam.messages (conversation_id, sender_id, body, client_id) VALUES ('conv_1', 'buyer_1', 'a', 'c_dup_000001')`), 'OK');
  assert.strictEqual(await sqlstate(db,
    `INSERT INTO iam.messages (conversation_id, sender_id, body, client_id) VALUES ('conv_1', 'buyer_1', 'a', 'c_dup_000001')`), '23505');
  assert.strictEqual(await sqlstate(db,
    `INSERT INTO iam.messages (conversation_id, sender_id, body, client_id) VALUES ('conv_1', 'seller_1', 'a', 'c_dup_000001')`), 'OK',
  'clientIds are per sender');

  // Deleting a conversation takes its messages with it.
  await db.query(`INSERT INTO iam.conversations (id, buyer_id, seller_id, store_id) VALUES ('conv_2', 'buyer_2', 'seller_1', 'store_1')`);
  await db.query(`INSERT INTO iam.messages (conversation_id, sender_id, body) VALUES ('conv_2', 'buyer_2', 'hi')`);
  await db.query(`DELETE FROM iam.conversations WHERE id = 'conv_2'`);
  assert.strictEqual((await db.query(`SELECT 1 FROM iam.messages WHERE conversation_id = 'conv_2'`)).rows.length, 0);

  // ------------------------------------------------------------------- 3. access
  const may = async (role, table, privilege) =>
    (await db.query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, table, privilege])).rows[0].ok;
  for (const table of ['iam.conversations', 'iam.messages']) {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      assert.strictEqual(await may('service_role', table, privilege), true, `service_role holds ${privilege} on ${table}`);
    }
  }
  await db.exec(`GRANT USAGE ON SCHEMA iam TO anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON iam.conversations, iam.messages TO anon, authenticated;`);
  try {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      try {
        assert.strictEqual((await db.query(`SELECT * FROM iam.conversations`)).rows.length, 0, `${role} reads no conversation that is not theirs`);
        assert.strictEqual((await db.query(`SELECT * FROM iam.messages`)).rows.length, 0, `${role} reads no message that is not theirs`);
        let denied = null;
        try { await db.query(`INSERT INTO iam.messages (conversation_id, sender_id, body) VALUES ('conv_1', 'seller_1', 'forged')`); } catch (e) { denied = e.code; }
        assert.strictEqual(denied, '42501', `${role} cannot write a message, even holding INSERT`);
      } finally {
        await db.exec('RESET ROLE');
      }
    }
    await db.exec('SET ROLE service_role');
    try {
      assert.ok((await db.query(`SELECT * FROM iam.messages`)).rows.length > 0, 'the server role sees every message');
      const unreadBefore = (await db.query(`SELECT buyer_unread FROM iam.conversations WHERE id = 'conv_1'`)).rows[0].buyer_unread;
      await db.query(`INSERT INTO iam.messages (conversation_id, sender_id, body) VALUES ('conv_1', 'seller_1', 'as the server')`);
      assert.strictEqual((await db.query(`SELECT buyer_unread FROM iam.conversations WHERE id = 'conv_1'`)).rows[0].buyer_unread, unreadBefore + 1,
        'and the trigger runs for the server role (it needs no extra grant)');
    } finally {
      await db.exec('RESET ROLE');
    }
  } finally {
    await db.exec(`REVOKE SELECT, INSERT, UPDATE, DELETE ON iam.conversations, iam.messages FROM anon, authenticated;
      REVOKE USAGE ON SCHEMA iam FROM anon, authenticated, service_role;`);
  }

  await db.close();
  console.log('    ✓ Messaging migration: constraints, trigger parity with the domain, access.');
}

module.exports = { run };

if (require.main === module) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
