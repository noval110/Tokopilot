# Initial ERD

Baseline dari PRD §10, dengan tambahan yang dibutuhkan keputusan teknis (ditandai ➕). Nama kolom final ditetapkan di migration tiap sprint; constraint di sini wajib dipertahankan.

```mermaid
erDiagram
  users ||--o{ store_members : "anggota"
  stores ||--o{ store_members : "punya"
  users ||--o{ sessions : "login"
  stores ||--o{ categories : ""
  stores ||--o{ products : ""
  categories |o--o{ products : ""
  products ||--o{ stock_movements : "ledger"
  users ||--o{ stock_movements : "actor"
  stores ||--o{ sales : ""
  users ||--o{ sales : "kasir"
  sales ||--|{ sale_items : ""
  products |o--o{ sale_items : "snapshot"
  stores ||--o{ store_sale_counters : ""
  stores ||--o{ ai_conversations : ""
  users ||--o{ ai_conversations : ""
  ai_conversations ||--o{ ai_messages : ""

  users {
    uuid id PK
    text name
    citext email UK "dinormalisasi lower+trim"
    text password_hash "argon2id, tidak pernah dikirim API"
    timestamptz created_at
    timestamptz updated_at
  }
  sessions {
    uuid id PK "➕ ADR-0002"
    uuid user_id FK
    bytea token_hash UK "SHA-256 dari token acak"
    timestamptz expires_at
    timestamptz revoked_at "nullable"
    timestamptz created_at
  }
  stores {
    uuid id PK
    text name
    text timezone "default Asia/Jakarta"
    char3 currency "default IDR"
    text address "nullable"
    timestamptz created_at
    timestamptz updated_at
  }
  store_members {
    uuid id PK
    uuid store_id FK
    uuid user_id FK "UNIQUE: satu toko per user (MVP)"
    text role "OWNER | STAFF"
    uuid created_by FK
    timestamptz created_at
  }
  categories {
    uuid id PK
    uuid store_id FK
    text name "UNIQUE(store_id, lower(name)) WHERE archived_at IS NULL"
    timestamptz archived_at
    timestamptz created_at
    timestamptz updated_at
  }
  products {
    uuid id PK
    uuid store_id FK
    uuid category_id FK "nullable"
    text name
    text sku "nullable; UNIQUE(store_id, sku) WHERE sku IS NOT NULL"
    text unit
    smallint unit_scale "➕ 0..3 digit desimal yang diizinkan"
    bigint cost_price "CHECK >= 0"
    bigint selling_price "CHECK >= 0"
    numeric current_stock "NUMERIC(14,3) CHECK >= 0"
    numeric min_stock "NUMERIC(14,3) CHECK >= 0"
    boolean is_active
    uuid created_by FK
    timestamptz created_at
    timestamptz updated_at
  }
  stock_movements {
    uuid id PK
    uuid store_id FK
    uuid product_id FK
    uuid actor_user_id FK
    text movement_type "INITIAL|RESTOCK|ADJUSTMENT_IN|ADJUSTMENT_OUT|SALE|SALE_VOID"
    numeric quantity_delta "signed, != 0"
    numeric stock_before
    numeric stock_after "CHECK stock_after = stock_before + quantity_delta AND >= 0"
    text reason "wajib untuk ADJUSTMENT_* dan SALE_VOID"
    text reference_type "nullable: SALE"
    uuid reference_id "nullable"
    timestamptz created_at
  }
  sales {
    uuid id PK
    uuid store_id FK
    uuid cashier_user_id FK
    text sale_number "UNIQUE(store_id, sale_number)"
    text status "COMPLETED | VOIDED"
    bigint subtotal
    bigint discount_amount "CHECK 0 <= discount <= subtotal"
    bigint net_total "CHECK = subtotal - discount"
    text payment_method "CASH | TRANSFER | QRIS | OTHER"
    text idempotency_key "UNIQUE(store_id, idempotency_key)"
    bytea request_hash "➕ tolak key sama dengan payload beda"
    text notes "nullable"
    text void_reason "wajib jika VOIDED"
    uuid voided_by FK "nullable"
    timestamptz voided_at "nullable"
    timestamptz sold_at
    timestamptz created_at
  }
  sale_items {
    uuid id PK
    uuid sale_id FK
    uuid product_id FK "nullable, ON DELETE SET NULL"
    text product_name_snapshot
    text sku_snapshot "nullable"
    text unit_snapshot
    numeric quantity "CHECK > 0"
    bigint unit_price
    bigint cost_price_snapshot
    bigint line_subtotal "= round_half_up(unit_price * quantity)"
  }
  store_sale_counters {
    uuid store_id PK "➕ ADR-0007; PK (store_id, day)"
    date day PK "hari dalam timezone toko"
    int last_number
  }
  ai_conversations {
    uuid id PK
    uuid store_id FK
    uuid user_id FK
    text title
    timestamptz created_at
    timestamptz updated_at
  }
  ai_messages {
    uuid id PK
    uuid conversation_id FK
    text role "user | assistant | tool"
    text content
    text tool_name "nullable"
    jsonb tool_metadata "tanpa secret"
    timestamptz created_at
  }
```

## Index minimum (PRD §10.1)

- `products (store_id, is_active)`, `products (store_id, lower(name))`, partial unique SKU.
- `stock_movements (store_id, product_id, created_at DESC)`.
- `sales (store_id, sold_at DESC)`, `sales (store_id, status)`, unique `(store_id, idempotency_key)`.
- `sale_items (sale_id)`, `sale_items (product_id)`.
- `ai_conversations (store_id, user_id, updated_at DESC)`, `ai_messages (conversation_id, created_at)`.

## Status implementasi

| Tabel | Migration | Catatan |
|---|---|---|
| users, stores, store_members, sessions | 00001 (Sprint 1) | sesuai ERD |
| categories, products, stock_movements | 00002 (Sprint 2) | `stock_movements` dibuat lebih awal dari rencana agar stok awal tercatat (ADR-0005). Integritas antar-toko dijaga composite FK `(category_id, store_id)` dan `(product_id, store_id)` |
| sales, sale_items, store_sale_counters | Sprint 4 | — |
| ai_conversations, ai_messages | Sprint 6 | — |

## Kebijakan delete

- Tidak ada `ON DELETE CASCADE` dari `stores`/`products` ke data transaksi atau ledger. Produk diarsip (`is_active = false`).
- `stock_movements` append-only: trigger `BEFORE UPDATE OR DELETE` → `RAISE EXCEPTION`.

## Rounding

`line_subtotal = unit_price × quantity` dibulatkan **half-up ke rupiah terdekat** saat quantity pecahan (mis. 1,5 kg × Rp 12.333 = 18.499,5 → Rp 18.500). Dihitung di Go dengan decimal, bukan float. Perlu konfirmasi (ADR-0005).
