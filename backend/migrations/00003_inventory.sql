-- +goose Up
-- Sprint 3: structured adjustment reasons and a trustworthy ledger order.

ALTER TABLE stock_movements
    ADD COLUMN reason_code text
        CHECK (reason_code IS NULL OR reason_code IN ('DAMAGED', 'LOST', 'EXPIRED', 'COUNT_CORRECTION', 'OTHER'));

-- Every adjustment states why; "OTHER" must be explained in the note (reason).
ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_adjustment_reason CHECK (
        (movement_type NOT IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT') OR reason_code IS NOT NULL) AND
        (reason_code IS DISTINCT FROM 'OTHER' OR char_length(btrim(coalesce(reason, ''))) > 0)
    );

-- Ledger order. now() is the *transaction start* time, so under concurrency a
-- row can carry an older timestamp than rows committed before it. seq is taken
-- at INSERT time — after the product row lock is held — so for any product it
-- strictly follows the real order of stock changes. created_at switches to the
-- actual write time for human-readable audit.
-- (Adding the identity column rewrites the table; row triggers do not fire.)
ALTER TABLE stock_movements ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE stock_movements ALTER COLUMN created_at SET DEFAULT clock_timestamp();

CREATE UNIQUE INDEX stock_movements_seq_idx ON stock_movements (seq);
CREATE INDEX stock_movements_store_seq_idx ON stock_movements (store_id, seq DESC);
CREATE INDEX stock_movements_store_product_seq_idx ON stock_movements (store_id, product_id, seq DESC);

-- +goose Down
DROP INDEX stock_movements_store_product_seq_idx;
DROP INDEX stock_movements_store_seq_idx;
DROP INDEX stock_movements_seq_idx;
ALTER TABLE stock_movements ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE stock_movements DROP COLUMN seq;
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_adjustment_reason;
ALTER TABLE stock_movements DROP COLUMN reason_code;
