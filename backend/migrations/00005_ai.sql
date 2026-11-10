-- +goose Up
-- Sprint 6: AI assistant conversations. Scoped per store AND per user (FR-AI-07).

CREATE TABLE ai_conversations (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id   uuid        NOT NULL REFERENCES stores (id) ON DELETE RESTRICT,
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    title      text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ai_conversations_id_store_key UNIQUE (id, store_id)
);

CREATE INDEX ai_conversations_owner_idx ON ai_conversations (store_id, user_id, updated_at DESC);

CREATE TABLE ai_messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid        NOT NULL,
    store_id        uuid        NOT NULL,
    role            text        NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    content         text        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 20000),
    tool_name       text        CHECK (tool_name IS NULL OR tool_name IN
                      ('get_low_stock_products', 'get_product_stock', 'get_sales_summary', 'get_top_selling_products', 'get_business_summary')),
    -- Safe metadata only (tool arguments, sources). Never API keys or tokens.
    tool_metadata   jsonb,
    seq             bigint      GENERATED ALWAYS AS IDENTITY,
    created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ai_messages_conversation_same_store_fk FOREIGN KEY (conversation_id, store_id)
        REFERENCES ai_conversations (id, store_id) ON DELETE CASCADE,
    CONSTRAINT ai_messages_tool_name_role CHECK ((role = 'tool') = (tool_name IS NOT NULL))
);

CREATE INDEX ai_messages_conversation_idx ON ai_messages (conversation_id, seq);

-- +goose Down
DROP TABLE ai_messages;
DROP TABLE ai_conversations;
