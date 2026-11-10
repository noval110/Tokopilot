-- +goose Up
-- Sprint 4: sales, sale items with snapshots, per-store daily receipt numbers.

CREATE TABLE store_sale_counters (
    store_id    uuid    NOT NULL REFERENCES stores (id) ON DELETE RESTRICT,
    day         date    NOT NULL,           -- business day in the store's timezone
    last_number integer NOT NULL CHECK (last_number > 0),
    PRIMARY KEY (store_id, day)
);

CREATE TABLE sales (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        uuid        NOT NULL REFERENCES stores (id) ON DELETE RESTRICT,
    cashier_user_id uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    sale_number     text        NOT NULL CHECK (sale_number ~ '^TP-[0-9]{8}-[0-9]{4,}$'),
    status          text        NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'VOIDED')),
    subtotal        bigint      NOT NULL CHECK (subtotal >= 0),
    discount_amount bigint      NOT NULL DEFAULT 0,
    net_total       bigint      NOT NULL,
    payment_method  text        NOT NULL CHECK (payment_method IN ('CASH', 'TRANSFER', 'QRIS', 'OTHER')),
    idempotency_key text        NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,100}$'),
    request_hash    bytea       NOT NULL CHECK (octet_length(request_hash) = 32),
    notes           text        CHECK (notes IS NULL OR char_length(notes) <= 500),
    void_reason     text        CHECK (void_reason IS NULL OR char_length(btrim(void_reason)) BETWEEN 3 AND 500),
    voided_by       uuid        REFERENCES users (id) ON DELETE RESTRICT,
    voided_at       timestamptz,
    sold_at         timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT sales_id_store_key UNIQUE (id, store_id),
    CONSTRAINT sales_store_number_key UNIQUE (store_id, sale_number),
    CONSTRAINT sales_store_idempotency_key UNIQUE (store_id, idempotency_key),
    CONSTRAINT sales_discount_range CHECK (discount_amount >= 0 AND discount_amount <= subtotal),
    CONSTRAINT sales_net_total CHECK (net_total = subtotal - discount_amount),
    CONSTRAINT sales_void_consistent CHECK (
        (status = 'COMPLETED' AND void_reason IS NULL AND voided_by IS NULL AND voided_at IS NULL) OR
        (status = 'VOIDED' AND void_reason IS NOT NULL AND voided_by IS NOT NULL AND voided_at IS NOT NULL))
);

CREATE INDEX sales_store_sold_at_idx ON sales (store_id, sold_at DESC, id DESC);
CREATE INDEX sales_store_status_idx ON sales (store_id, status);

CREATE TABLE sale_items (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id               uuid          NOT NULL,
    store_id              uuid          NOT NULL,
    line_no               smallint      NOT NULL CHECK (line_no > 0),
    -- Nullable by design (PRD §10); products are archived, never deleted, so it stays set in practice.
    product_id            uuid,
    product_name_snapshot text          NOT NULL,
    sku_snapshot          text,
    unit_snapshot         text          NOT NULL,
    unit_scale_snapshot   smallint      NOT NULL CHECK (unit_scale_snapshot BETWEEN 0 AND 3),
    quantity              numeric(14,3) NOT NULL CHECK (quantity > 0),
    unit_price            bigint        NOT NULL CHECK (unit_price >= 0),
    cost_price_snapshot   bigint        NOT NULL CHECK (cost_price_snapshot >= 0),
    line_subtotal         bigint        NOT NULL CHECK (line_subtotal >= 0),
    CONSTRAINT sale_items_sale_same_store_fk FOREIGN KEY (sale_id, store_id) REFERENCES sales (id, store_id) ON DELETE RESTRICT,
    CONSTRAINT sale_items_product_same_store_fk FOREIGN KEY (product_id, store_id) REFERENCES products (id, store_id) ON DELETE RESTRICT,
    CONSTRAINT sale_items_line_key UNIQUE (sale_id, line_no)
);

CREATE INDEX sale_items_sale_idx ON sale_items (sale_id);
CREATE INDEX sale_items_product_idx ON sale_items (product_id);

-- Audit integrity: a sale is never deleted and its money never changes. The
-- only permitted update is the one-way COMPLETED -> VOIDED transition.
-- +goose StatementBegin
CREATE FUNCTION sales_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'sales rows cannot be deleted' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'COMPLETED' OR NEW.status <> 'VOIDED'
       OR NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.cashier_user_id <> OLD.cashier_user_id
       OR NEW.sale_number <> OLD.sale_number OR NEW.subtotal <> OLD.subtotal
       OR NEW.discount_amount <> OLD.discount_amount OR NEW.net_total <> OLD.net_total
       OR NEW.payment_method <> OLD.payment_method OR NEW.idempotency_key <> OLD.idempotency_key
       OR NEW.request_hash <> OLD.request_hash OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.sold_at <> OLD.sold_at OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'sales rows are immutable except COMPLETED -> VOIDED' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION sale_items_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'sale_items is append-only (% blocked)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER sales_guard_update_delete BEFORE UPDATE OR DELETE ON sales
    FOR EACH ROW EXECUTE FUNCTION sales_guard();
CREATE TRIGGER sales_no_truncate BEFORE TRUNCATE ON sales
    FOR EACH STATEMENT EXECUTE FUNCTION sale_items_immutable();
CREATE TRIGGER sale_items_no_update_delete BEFORE UPDATE OR DELETE ON sale_items
    FOR EACH ROW EXECUTE FUNCTION sale_items_immutable();
CREATE TRIGGER sale_items_no_truncate BEFORE TRUNCATE ON sale_items
    FOR EACH STATEMENT EXECUTE FUNCTION sale_items_immutable();

-- +goose Down
DROP TABLE sale_items;
DROP TABLE sales;
DROP FUNCTION sale_items_immutable();
DROP FUNCTION sales_guard();
DROP TABLE store_sale_counters;
