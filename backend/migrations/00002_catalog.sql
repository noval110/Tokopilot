-- +goose Up
-- Sprint 2: categories, products, and the immutable stock ledger.
-- The ledger arrives now (not Sprint 3) so initial stock is recorded as an
-- INITIAL movement and current_stock = SUM(quantity_delta) holds from day one (BR-05).

CREATE TABLE categories (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id    uuid        NOT NULL REFERENCES stores (id) ON DELETE RESTRICT,
    name        text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
    archived_at timestamptz,
    created_by  uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    -- Target for composite FKs that pin children to the same store.
    CONSTRAINT categories_id_store_key UNIQUE (id, store_id)
);

CREATE UNIQUE INDEX categories_store_name_active_idx
    ON categories (store_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE products (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id      uuid          NOT NULL REFERENCES stores (id) ON DELETE RESTRICT,
    category_id   uuid,
    name          text          NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 150),
    -- Stored upper-cased by the app; NULL when the owner does not use SKUs.
    sku           text          CHECK (sku IS NULL OR sku ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
    unit          text          NOT NULL CHECK (char_length(btrim(unit)) BETWEEN 1 AND 20),
    -- Decimal places allowed for this product's quantities (ADR-0005): pcs = 0, kg = 3.
    unit_scale    smallint      NOT NULL DEFAULT 0 CHECK (unit_scale BETWEEN 0 AND 3),
    cost_price    bigint        NOT NULL CHECK (cost_price BETWEEN 0 AND 1000000000000),
    selling_price bigint        NOT NULL CHECK (selling_price BETWEEN 0 AND 1000000000000),
    current_stock numeric(14,3) NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
    min_stock     numeric(14,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
    is_active     boolean       NOT NULL DEFAULT true,
    archived_at   timestamptz,
    created_by    uuid          NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at    timestamptz   NOT NULL DEFAULT now(),
    updated_at    timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT products_id_store_key UNIQUE (id, store_id),
    -- A product can only reference a category of its own store.
    CONSTRAINT products_category_same_store_fk FOREIGN KEY (category_id, store_id)
        REFERENCES categories (id, store_id) ON DELETE RESTRICT,
    CONSTRAINT products_archive_consistent CHECK ((is_active AND archived_at IS NULL) OR (NOT is_active AND archived_at IS NOT NULL)),
    -- Quantities never carry more decimals than the unit allows.
    CONSTRAINT products_stock_scale CHECK (
        current_stock = round(current_stock, unit_scale) AND min_stock = round(min_stock, unit_scale))
);

-- PRD §10.1: SKU unique per store among active products (case-insensitive via upper-case storage).
CREATE UNIQUE INDEX products_store_sku_active_idx ON products (store_id, sku) WHERE sku IS NOT NULL AND is_active;
CREATE INDEX products_store_active_idx ON products (store_id, is_active);
CREATE INDEX products_store_name_idx ON products (store_id, lower(name));
CREATE INDEX products_category_idx ON products (category_id) WHERE category_id IS NOT NULL;

CREATE TABLE stock_movements (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id       uuid          NOT NULL,
    product_id     uuid          NOT NULL,
    actor_user_id  uuid          NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    movement_type  text          NOT NULL CHECK (movement_type IN
                     ('INITIAL', 'RESTOCK', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'SALE', 'SALE_VOID')),
    quantity_delta numeric(14,3) NOT NULL CHECK (quantity_delta <> 0),
    stock_before   numeric(14,3) NOT NULL CHECK (stock_before >= 0),
    stock_after    numeric(14,3) NOT NULL CHECK (stock_after >= 0),
    reason         text          CHECK (reason IS NULL OR char_length(reason) <= 500),
    reference_type text,
    reference_id   uuid,
    created_at     timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT stock_movements_product_same_store_fk FOREIGN KEY (product_id, store_id)
        REFERENCES products (id, store_id) ON DELETE RESTRICT,
    CONSTRAINT stock_movements_arithmetic CHECK (stock_after = stock_before + quantity_delta),
    CONSTRAINT stock_movements_direction CHECK (
        (movement_type IN ('INITIAL', 'RESTOCK', 'ADJUSTMENT_IN', 'SALE_VOID') AND quantity_delta > 0) OR
        (movement_type IN ('ADJUSTMENT_OUT', 'SALE') AND quantity_delta < 0))
);

CREATE INDEX stock_movements_store_product_time_idx ON stock_movements (store_id, product_id, created_at DESC);

-- +goose StatementBegin
CREATE FUNCTION stock_movements_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'stock_movements is append-only (% blocked)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER stock_movements_no_update_delete
    BEFORE UPDATE OR DELETE ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION stock_movements_immutable();

CREATE TRIGGER stock_movements_no_truncate
    BEFORE TRUNCATE ON stock_movements
    FOR EACH STATEMENT EXECUTE FUNCTION stock_movements_immutable();

-- +goose Down
DROP TABLE stock_movements;
DROP FUNCTION stock_movements_immutable();
DROP TABLE products;
DROP TABLE categories;
