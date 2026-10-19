-- ============================================================================
-- LOUMOO — Migration 021: In-app messaging (buyer ↔ boutique conversations)
-- ----------------------------------------------------------------------------
-- One conversation per (buyer, store) pair, WhatsApp-style: asking a boutique
-- about a second product continues the same thread and drops a product card
-- into it, so the seller sees one person, not one ticket per product.
--
-- Who the seller is never comes from a request: the backend derives it from the
-- listing, the store row or the order (MessagingService). The tables are only
-- written by the backend's service-role client; participants may read their
-- own rows through RLS should the feed ever be queried with the user's JWT.
--
-- Unread counters and the inbox preview are maintained by a trigger on message
-- insert, in the same statement as the insert, so two messages arriving at once
-- can never lose an increment (a read-modify-write from Node could).
-- ============================================================================

CREATE TABLE IF NOT EXISTS iam.conversations (
    id                    VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    buyer_id              VARCHAR(64) NOT NULL REFERENCES iam.profiles(id) ON DELETE CASCADE,
    seller_id             VARCHAR(64) NOT NULL REFERENCES iam.profiles(id) ON DELETE CASCADE,
    store_id              VARCHAR(64) NOT NULL REFERENCES iam.stores(id) ON DELETE CASCADE,
    last_message_at       TIMESTAMPTZ,
    last_message_preview  VARCHAR(160) NOT NULL DEFAULT '',
    last_message_kind     VARCHAR(16),
    last_sender_id        VARCHAR(64),
    buyer_unread          INT NOT NULL DEFAULT 0 CHECK (buyer_unread >= 0),
    seller_unread         INT NOT NULL DEFAULT 0 CHECK (seller_unread >= 0),
    buyer_last_read_at    TIMESTAMPTZ,
    seller_last_read_at   TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT conversations_not_self CHECK (buyer_id <> seller_id),
    CONSTRAINT conversations_buyer_store_unique UNIQUE (buyer_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_buyer
    ON iam.conversations(buyer_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_conversations_seller
    ON iam.conversations(seller_id, last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS iam.messages (
    id               VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    -- Strictly increasing cursor for "messages after X" polling; timestamps can tie.
    seq              BIGINT GENERATED ALWAYS AS IDENTITY,
    conversation_id  VARCHAR(64) NOT NULL REFERENCES iam.conversations(id) ON DELETE CASCADE,
    sender_id        VARCHAR(64) NOT NULL REFERENCES iam.profiles(id) ON DELETE CASCADE,
    kind             VARCHAR(16) NOT NULL DEFAULT 'text'
                       CHECK (kind IN ('text', 'product', 'order')),
    body             TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
    metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- The sender's own id for this message, so a retried send is stored once.
    client_id        VARCHAR(64),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_seq ON iam.messages(seq);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq
    ON iam.messages(conversation_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_id
    ON iam.messages(conversation_id, sender_id, client_id)
    WHERE client_id IS NOT NULL;

-- Inbox preview + unread counters, atomically with the insert -----------------
CREATE OR REPLACE FUNCTION iam.messages_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE iam.conversations c
       SET last_message_at      = NEW.created_at,
           last_message_kind    = NEW.kind,
           last_sender_id       = NEW.sender_id,
           last_message_preview = LEFT(
               CASE NEW.kind
                 WHEN 'product' THEN 'Product · ' || COALESCE(NEW.metadata->>'title', 'a listing')
                 WHEN 'order'   THEN 'Order · '   || COALESCE(NEW.metadata->>'orderNumber', '')
                 ELSE regexp_replace(NEW.body, '\s+', ' ', 'g')
               END, 160),
           -- The recipient gains an unread message; the sender has, by replying,
           -- read everything before it.
           buyer_unread  = CASE WHEN NEW.sender_id = c.seller_id THEN c.buyer_unread + 1 ELSE 0 END,
           seller_unread = CASE WHEN NEW.sender_id = c.buyer_id  THEN c.seller_unread + 1 ELSE 0 END,
           buyer_last_read_at  = CASE WHEN NEW.sender_id = c.buyer_id  THEN NEW.created_at ELSE c.buyer_last_read_at END,
           seller_last_read_at = CASE WHEN NEW.sender_id = c.seller_id THEN NEW.created_at ELSE c.seller_last_read_at END,
           updated_at = NOW()
     WHERE c.id = NEW.conversation_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_after_insert ON iam.messages;
CREATE TRIGGER trg_messages_after_insert
    AFTER INSERT ON iam.messages
    FOR EACH ROW EXECUTE FUNCTION iam.messages_after_insert();

-- Row Level Security -----------------------------------------------------------
ALTER TABLE iam.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can read their conversations" ON iam.conversations;
CREATE POLICY "Participants can read their conversations"
    ON iam.conversations FOR SELECT
    USING (buyer_id = auth.uid()::text OR seller_id = auth.uid()::text);

DROP POLICY IF EXISTS "Service role full access to conversations" ON iam.conversations;
CREATE POLICY "Service role full access to conversations"
    ON iam.conversations FOR ALL TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Participants can read their messages" ON iam.messages;
CREATE POLICY "Participants can read their messages"
    ON iam.messages FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM iam.conversations c
         WHERE c.id = messages.conversation_id
           AND (c.buyer_id = auth.uid()::text OR c.seller_id = auth.uid()::text)
    ));

DROP POLICY IF EXISTS "Service role full access to messages" ON iam.messages;
CREATE POLICY "Service role full access to messages"
    ON iam.messages FOR ALL TO service_role
    USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON iam.conversations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON iam.messages TO service_role;
