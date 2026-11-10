-- +goose Up
-- Sprint 1: users, stores, membership, sessions.
-- Business invariants live here as constraints, not only in Go.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
    -- citext gives case-insensitive uniqueness; the app also lower-cases and trims.
    email         citext      NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
    password_hash text        NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_email_key UNIQUE (email)
);

CREATE TABLE stores (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
    timezone   text        NOT NULL DEFAULT 'Asia/Jakarta'
               CHECK (timezone IN ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura')),
    currency   char(3)     NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
    address    text        CHECK (address IS NULL OR char_length(address) <= 500),
    created_by uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE store_members (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id   uuid        NOT NULL REFERENCES stores (id) ON DELETE RESTRICT,
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    role       text        NOT NULL CHECK (role IN ('OWNER', 'STAFF')),
    created_by uuid        REFERENCES users (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT store_members_store_user_key UNIQUE (store_id, user_id),
    -- MVP (BR-02): one store membership per user account.
    CONSTRAINT store_members_user_key UNIQUE (user_id)
);

-- Exactly one owner per store (PRD §10: "satu owner aktif per toko").
CREATE UNIQUE INDEX store_members_one_owner_idx ON store_members (store_id) WHERE role = 'OWNER';

CREATE TABLE sessions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- SHA-256 of the random cookie token; the raw token is never stored.
    token_hash          bytea       NOT NULL CHECK (octet_length(token_hash) = 32),
    expires_at          timestamptz NOT NULL,
    absolute_expires_at timestamptz NOT NULL,
    last_seen_at        timestamptz NOT NULL DEFAULT now(),
    revoked_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sessions_token_hash_key UNIQUE (token_hash),
    CONSTRAINT sessions_expiry_order CHECK (expires_at <= absolute_expires_at)
);

CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

-- +goose Down
DROP TABLE sessions;
DROP TABLE store_members;
DROP TABLE stores;
DROP TABLE users;
