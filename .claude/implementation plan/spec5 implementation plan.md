# Implementation Plan — Spec 05: Catalogue Schema and Admin Catalogue Management

Source spec: `.claude/implementation specs/05-catalogue-schema-and-admin-management.md`
Related PRDs: `05-admin-operations.md` §5.1, `06-rbac.md` §5.18, `01-overview.md` §1.1, `13-homepage-cms.md` §13.5/§13.6/§13.9, `10-coupon-discount.md` §8.12/§8.14
Status: **Planned — not yet implemented**

---

## Confirmed against current repo state

- Migrations go up to `0004_security_events.sql` (specs 01–04 applied), so this slice's migration becomes **`0005_catalogue.sql`** — the spec doc's own `0005_catalogue.sql` reference is now correct.
- All 10 catalogue permission keys the spec needs already exist in `backend/src/types/permissions.ts`: `product.create`, `product.update`, `product.delete`, `category.manage`, `product.image.manage`, `product.attribute.manage`, `product.variant.manage`, `product.price.manage`, `inventory.manage`, `product.visibility.manage`. No new permission key is added; nothing to update in the §5.18 matrix or the permission-catalogue seed.
- `sanitizeHtml` (`backend/src/lib/sanitizeHtml.ts`) and the `authenticatedCeiling` rate limiter (`backend/src/middleware/rateLimit.ts` + `backend/src/config/rateLimits.ts`) already exist from spec 04 — reused as-is, not rebuilt.
- `withTransaction`/`run`/`Db` pattern already established in `backend/src/repositories/db.ts` and used by `audit.repository.ts` — new repositories follow the same shape (raw SQL, snake_case row → camelCase record mapping, `db?: Db` param threaded through for transactional callers).
- `backend/src/lib/pagination.ts` already provides the `PaginationQuery`/list-response convention `audit.repository.ts` uses — reused for `/categories`, `/products`, `/attributes`.
- Route mounting convention: `backend/src/routes/admin/index.ts` mounts each sub-router with `requireAuth('admin')`, `rateLimit('authenticatedCeiling')`, `requirePasswordChanged`, then the sub-router applies `requirePermission` per route internally (see `managers.routes.ts` pattern). Catalogue routes follow the same mount pattern.
- No `products`/`categories`/variant tables exist yet — this is a clean create, no backfill.
- `backend/src/lib/uploadValidation.ts` exists (spec 04) but is **not** wired here — `product_images` rows are created only in spec 06; this slice only creates the empty table and ordering/primary-image semantics.

---

## 1. Migration

`backend/migrations/0005_catalogue.sql`:

- Enums: `product_status` (`ACTIVE`, `INACTIVE` only — no `OUT_OF_STOCK` value), `attribute_type` (`SIZE`, `COLOUR`, `AGE_GROUP`, `OTHER`).
- `categories` — self-referencing tree, `parent_id` FK `ON DELETE RESTRICT`, `UNIQUE(slug)`, index `(parent_id, display_order)`, `CHECK (parent_id IS NULL OR parent_id <> id)`.
- `products` — FK to `categories` `ON DELETE RESTRICT`, `UNIQUE(slug)`, partial `UNIQUE(sku) WHERE sku IS NOT NULL`, indexes `(status, created_at DESC)`, `(status, is_featured)`, `(category_id, status)`, a `to_tsvector`/trigram index on `name` for spec 07, `CHECK (compare_at_price IS NULL OR compare_at_price >= base_price)`, `CHECK (base_price >= 0)`.
- `product_attributes`, `product_attribute_values` — `UNIQUE(attribute_id, value)`.
- `product_variants` — FK to `products` `ON DELETE CASCADE`, partial `UNIQUE(sku) WHERE sku IS NOT NULL`, index on `product_id`, `CHECK (stock_quantity >= 0)`.
- `product_variant_values` — composite PK `(variant_id, attribute_value_id)`, FK to `product_variants` `ON DELETE CASCADE`, FK to `product_attribute_values` `ON DELETE RESTRICT`.
- `product_images` — FK to `products` `ON DELETE CASCADE`, partial unique index `(product_id) WHERE is_primary` (at most one primary image). Created empty; spec 06 populates it.

Idempotent per existing migration-runner convention (checked against `0001`–`0005` style before writing).

## 2. Repositories (new files under `backend/src/repositories/`)

- `categories.repository.ts` — CRUD, `findChildren`, delete-guard existence checks (child categories / products referencing it) via `COUNT` queries used by the service layer's 409 logic.
- `products.repository.ts` — CRUD, slug-collision-aware insert, list with filter/pagination, `findBySlug`, computed `totalStock`/`isOutOfStock` via a join/aggregate over `product_variants` at read time (never stored).
- `productAttributes.repository.ts` — attributes + values CRUD.
- `productVariants.repository.ts` — CRUD, `findByProductId`, attribute-value-combination uniqueness check, `product_variant_values` join-row writes.
- `inventory.repository.ts` — the raw conditional `UPDATE ... WHERE stock_quantity >= $qty` used by `decrementStock`/`restoreStock`, plus the manual-adjust `UPDATE` used by `PATCH /variants/:id/stock`. Kept separate from `productVariants.repository.ts` since it's the one file `services/inventory.service.ts` and (later) spec 12 call directly.

All follow the `audit.repository.ts` shape: typed `*Row` (snake_case) → typed `*Record`/`*Response` (camelCase) mapper, `db?: Db` threaded for transactional use, `run(db, ...)` wrapper.

## 3. Services (new files under `backend/src/services/`)

- `slug.service.ts` — `generateSlug(name)`: lower-case, ASCII-transliterate, collapse non-alphanumerics to `-`, trim to 80 chars; collision resolution with `-2`, `-3` suffixes retried inside the insert transaction on `UNIQUE` violation (via existing `pgErrors.ts` conflict detection, same pattern likely already used elsewhere for unique-constraint retries).
- `categories.service.ts` — depth-limit enforcement (a category with a non-null `parent_id` cannot itself be a parent — service-layer check, not schema), delete-guard (409 `CATEGORY_NOT_EMPTY` if children or products exist).
- `products.service.ts` — create/update orchestration (category-exists/active check, description sanitization via `sanitizeHtml`, slug generation, variant creation in the same transaction, attribute-value-combination validation), delete-guard stub (409 `PRODUCT_REFERENCED` — order-line-item check is a no-op hook until spec 11 exists, per spec's explicit note).
- `inventory.service.ts` — `decrementStock` / `restoreStock` exactly per the spec's signatures:
  - Both sort `items` by `variantId` before issuing any `UPDATE` (deadlock-free lock ordering — this is the one line most likely to be silently dropped, so it gets its own explicit code comment referencing spec 05's lock-ordering rationale).
  - `decrementStock`: per-item conditional `UPDATE product_variants SET stock_quantity = stock_quantity - $qty WHERE id = $variantId AND stock_quantity >= $qty`; any zero-row-affected update aborts the whole call (`ok: false`, transaction rolled back by caller) — never partial.
  - `restoreStock`: unconditional `+qty` update, single uniform rule for any `CANCELLED`/`RETURNED` entry from ≥`CONFIRMED` (spec 12 decides *when*; this only provides *how*).
  - Both append one `audit_logs` row per variant via `audit.repository.append` (actions `stock_decrement` / `stock_restore`), passed the same transaction client so audit and stock change commit atomically.
  - Both must run inside a caller-supplied transaction — no internal `withTransaction` call of their own.
  - One retry on SQLSTATE `40P01` (deadlock) that still escapes despite lock ordering.
- `PATCH /variants/:id/stock` manual-adjust path (in the controller or a small service function) requires a `reason` (400 if absent) and audits with `action = 'stock_adjust'`.

## 4. Validation (new file `backend/src/validation/catalogue.validation.ts`)

`.strict()` zod schemas per spec's rules: `name` 1–200 trimmed; `basePrice`/`price`/`compareAtPrice` ≥ 0, ≤ 2 decimals, numeric; `stockQuantity` integer ≥ 0; `slug` never accepted from client on create (only an explicit opt-in field on update, per the stability rule); `attributeValueIds: string[]`; `categoryId` required and validated for existence in the service layer (not the schema).

## 5. Controllers (new files under `backend/src/controllers/`)

- `categories.controller.ts`, `products.controller.ts`, `productAttributes.controller.ts`, `productVariants.controller.ts`, `inventory.controller.ts` (or folded into `productVariants.controller.ts` for the stock/price/visibility sub-resource endpoints — final split decided during implementation to match existing controller granularity, e.g. `managers.controller.ts` vs `permissionsCatalogue.controller.ts` split precedent).

## 6. Routes (new file `backend/src/routes/admin/catalogue.routes.ts`, mounted in `routes/admin/index.ts`)

Exact table from the spec, each route wrapped in its own `requirePermission(key)` (mount-level `requireAuth`/`rateLimit`/`requirePasswordChanged` already applied by `index.ts`, matching the `managers`/`audit-logs`/`permissions` precedent):

| Method | Path | Permission |
| --- | --- | --- |
| GET/POST | `/categories`, PATCH/DELETE `/categories/:id` | `category.manage` |
| GET/POST | `/attributes`, POST `/attributes/:id/values`, DELETE `/attributes/:id/values/:valueId` | `product.attribute.manage` |
| GET | `/products`, GET `/products/:id` | `product.update` |
| POST | `/products` | `product.create` |
| PATCH | `/products/:id` | `product.update` |
| DELETE | `/products/:id` | `product.delete` |
| PATCH | `/products/:id/price` | `product.price.manage` |
| PATCH | `/products/:id/visibility` | `product.visibility.manage` |
| POST | `/products/:id/variants`, PATCH `/variants/:id`, DELETE `/variants/:id` | `product.variant.manage` |
| PATCH | `/variants/:id/stock` | `inventory.manage` |

Price/visibility/stock are separate endpoints from the general `PATCH /products/:id` specifically so each can carry its own distinct `requirePermission` — not folded into one handler with internal branching.

## 7. Frontend (new routes under `frontend/src/app/admin/catalogue/`)

- `/admin/catalogue/products` — paginated list, search, filter bar, row (image/name/price/stock/status/derived Out-of-Stock badge), floating `+` create button. Matches `design` skill's Product Management screen tokens (row height 80px, `#DC143C` price/accent, `#6B7280` stock text, `#E5E7EB` divider).
- `/admin/catalogue/products/new` and `/admin/catalogue/products/[id]` — product form (name, category select, price, compare-at price, sanitized description textarea, weight, variants section, Active toggle, Featured toggle, images placeholder pending spec 06).
- `/admin/catalogue/categories` — tree list, reorder, Active toggle.
- Price/visibility/stock controls conditionally rendered per the caller's granted permissions (returned from spec 03's session/permission info), but the backend 403 is the real control — UI hiding is convenience only, per `frontend` skill §3.
- Loading/empty/error/success states on every screen; mobile-first at 375px, verified at 320px, no horizontal scroll, 44px-minimum touch targets, matching spec 04's plan precedent of testing responsive behavior explicitly.

## 8. Security checklist (spec §Security requirements)

- Every route: `requirePermission` server-side, never UI-only.
- `description` sanitized via existing `sanitizeHtml` before storage; storefront (spec 07) re-escapes at render — no layer trusts the other.
- Prices stored `numeric(12,2)`; no client-supplied price ever treated as authoritative elsewhere (coupon engine / order creation always re-read from DB — enforced structurally in specs 10/11, not here, but this slice must not introduce any code path that accepts a price for calculation).
- All list endpoints paginated.
- `slug` server-generated only, never client-accepted on create.
- `stock_quantity >= 0` DB `CHECK` — last-line defense independent of application logic.
- Every stock/price change audited with actor, previous/new value, reason.

## 9. Data integrity checklist

- Atomic check-and-decrement via conditional `UPDATE`, no read-then-write, ever.
- All-or-nothing multi-line decrement (any zero-row update aborts the whole call).
- `restoreStock` is one function, one code path, for every `CANCELLED`/`RETURNED` entry — spec 12 will be the only caller, but the guarantee (one implementation) is established here.
- Slug uniqueness via DB constraint, not application-level check-then-insert.
- One primary image per product via partial unique index.
- Referenced catalogue rows (products with order line items, once spec 11 exists) are never hard-deleted, only deactivated — stub hook now, wired in spec 11.

## 10. Tests (hand off to `testing-agent`)

Per spec's 15-item "Tests required" list — highlighting the ones needing a real database (not mockable):

1. Atomic decrement under concurrency — two simultaneous last-unit decrements, exactly one wins, stock never negative. **Real DB required.**
2. Insufficient stock fails cleanly, writes nothing, reports shortfall detail.
3. Multi-line all-or-nothing decrement.
4. Restore round-trips exactly (decrement then restore = original quantity).
5. DB `CHECK` rejects negative stock at the data layer directly.
6. Out-of-stock is derived only — no stored column, flag changes with stock alone.
7. Active/Inactive × Featured are fully independent and both storable in all four combinations.
8. One test per §5.18 catalogue permission row (10 keys).
9. Price/visibility/stock endpoints check their own distinct permission key, not `product.update` generically (verified by revoking just that one key in the fixture).
10. Slug stability (rename doesn't change slug) + uniqueness under concurrent same-name creates.
11. Description sanitization strips script tags/event handlers before storage.
12. Deletion guards: non-empty category → 409; referenced product → 409 (once spec 11 hook is active).
13. Audit rows on stock and price changes carry actor/previous/new/reason.
14. Pagination bounds on `GET /products`.
15. **Deadlock-free lock ordering** — two concurrent `decrementStock` calls on the same two variants passed in opposite order, both complete without SQLSTATE `40P01`. This is the regression test that would catch the `variant_id` sort ever being dropped. **Real DB required.**

---

## Open decisions carried from the spec (informational, not blocking)

1. No product ratings/reviews — omitted from the product card, per spec's explicit design-vs-PRD conflict resolution (CLAUDE.md §1: requirement files outrank the design system).
2. Stock always at variant level, single default variant for option-less products — one decrement path, one race condition surface.
3. Shipping fee / `weight_grams` — this slice only stores `weight_grams`; `computeShipping()` belongs to spec 21, not here.
4. Category depth fixed at exactly two levels (category → subcategory), enforced in the service layer only.
5. Age group modeled as an `attribute_type` value, not a separate column.
6. `compare_at_price` is presentational only — never read by any money calculation (coupon/order/payment all use `base_price`/`variant.price` exclusively).

None of these require a decision before implementation — all are already resolved in the spec itself.

---

## Implementation order

1. Migration (`0005_catalogue.sql`)
2. Repositories (`categories`, `products`, `productAttributes`, `productVariants`, `inventory`)
3. `slug.service.ts`
4. `inventory.service.ts` (`decrementStock`/`restoreStock` + lock ordering + audit)
5. `categories.service.ts`, `products.service.ts` (incl. sanitization, delete-guards)
6. Validation schemas
7. Controllers
8. Routes (`catalogue.routes.ts`), mount in `routes/admin/index.ts`
9. Frontend admin catalogue pages (products list/editor, categories tree)
10. Hand off to `testing-agent` for spec 05's 15-item test list
