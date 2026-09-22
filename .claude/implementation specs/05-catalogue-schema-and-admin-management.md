# 05 — Catalogue Schema and Admin Catalogue Management

## Goal

After this slice the catalogue exists and is fully manageable from the back-office: categories and subcategories, products with slugs, prices, visibility and Featured flags, product attributes (size, colour, age group), variants with per-variant stock, and the atomic stock primitives that later slices call. Admin/Manager users can create, update, delete, and control the visibility of catalogue entities under the §5.18 permission matrix, with inventory changes audited. No storefront page and no image upload yet — those are specs 06 and 07 — but every field the storefront and the courier/order flows need is in place.

## Requirement references

- `05-admin-operations.md` §5.1 — the complete catalogue capability list: create/update/delete products; create and manage categories and subcategories; upload and manage product images; manage sizes, colours, variants, age groups; manage prices; manage stock and inventory; control visibility; mark Active/Inactive/Featured; display Out of Stock.
- `05-admin-operations.md` §5.1 note on product status fields — `Active`/`Inactive` are two values of **one** visibility status; `Featured` is an independent flag; **`Out of Stock` is derived from stock data, never a separately settable status**.
- `05-admin-operations.md` §5.1 — the product type list (men's/women's/children's clothing, adult and children's footwear, sneakers, caps, accessories, other future types); variants example (colour × size); "stock should be managed at the appropriate product or variant level."
- `05-admin-operations.md` §5.1 — **stock decrement timing** (at `CONFIRMED`, not placement), **stock restoration rule** (any transition into `CANCELLED`/`RETURNED` from at or after `CONFIRMED` restores stock, as one uniform rule), and **stock decrement concurrency** (atomic check-and-decrement, never read-then-write; insufficient stock fails the confirmation and notifies the Admin/Manager).
- `06-rbac.md` §5.18 — the catalogue permission rows: Product Create/Update (Yes/Yes), Product Delete (Yes/Assigned), Category Management, Product Image Management, Size/Colour Management, Variant Management, Price Management, Inventory Management, Product Visibility (all Yes/Yes).
- `06-rbac.md` §5.15 rule 9–10 — backend authorizes and audits.
- `01-overview.md` §1.1 — SEO-friendly URLs, which requires stable product/category slugs.
- `13-homepage-cms.md` §13.5 — automatic product selection rules depend on `Featured`, `Active`, category membership, creation recency, and out-of-stock exclusion; §13.6 — manual selection respects `Active`/`Inactive`; §13.9 — one shared `<ProductCard />` with image, name, price, discounted price, discount indicator, Featured indicator, out-of-stock state.
- `10-coupon-discount.md` §8.12 — coupon product/category eligibility references existing product and category IDs; §8.14 — eligible subtotal uses **current catalogue prices looked up fresh server-side**.
- `12-whatsapp-contact.md` §12.3, §12.5 — the product page needs stock status and an optional SKU/product ID and variant selection.
- `11-security-hardening.md` §11.4 (pagination), §11.6 (schema validation, sanitization of stored content).
- Skills: `database` §1–3, `backend` §2, `security` §6, `test` §1 (stock decrement/restore), `design` (Product Management screen), `seo` §2 (slugs).

## Depends on

- **01** — API conventions, validation, pagination, error taxonomy.
- **02** — `audit_logs`, `withTransaction`, shared types.
- **03** — `requireAuth('admin')`, `requirePermission`, the seeded permission catalogue.
- **04** — `sanitizeHtml` for product descriptions; `authenticatedCeiling` limiter.

## Scope

**In scope**

- Schema: `categories`, `products`, `product_attributes`, `product_attribute_values`, `product_variants`, plus a `product_images` table whose rows are created in spec 06.
- Slug generation and uniqueness.
- Admin CRUD for categories, products, attributes, and variants.
- Visibility (`Active`/`Inactive`) and `Featured` control.
- Stock management: per-variant quantity, low-stock threshold, and the two atomic primitives `decrementStock` / `restoreStock` that spec 12 calls.
- Derived out-of-stock computation.
- Admin catalogue frontend: product list, product editor, category manager.

**Out of scope / deferred**

- Image upload and Supabase Storage — deferred to spec **06** (this slice creates the `product_images` table and the ordering/primary-image semantics so spec 06 only adds the upload path).
- Storefront browsing, search, filtering, product detail page, SEO metadata — deferred to spec **07**.
- Cart and wishlist — deferred to spec **09**.
- Coupon product/category join tables — deferred to spec **10**.
- Calling `decrementStock`/`restoreStock` from a status transition — deferred to spec **12**, which owns the state machine. This slice provides and tests the primitives in isolation; spec 12 owns *when* they fire.
- Product reviews/ratings — the `design` skill shows an optional rating in the product card, but **no PRD defines a review system**; see Open questions.

## Database changes

Migration file: `backend/migrations/0005_catalogue.sql`

### Enums

```sql
CREATE TYPE product_status AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE attribute_type AS ENUM ('SIZE', 'COLOUR', 'AGE_GROUP', 'OTHER');
```

`product_status` has exactly two values because §5.1's note states Active/Inactive are two values of one status. `OUT_OF_STOCK` is deliberately **not** a value — §5.1 states it "is not a separately settable status — it is derived from the same stock/inventory data… it is not stored as its own independent state."

### `categories`

Self-referencing tree covering categories and subcategories (§5.1).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `parent_id` | `uuid` | NULL | — | FK → `categories(id)` ON DELETE RESTRICT; NULL = top-level |
| `name` | `text` | NOT NULL | — | |
| `slug` | `text` | NOT NULL | — | SEO-friendly URL segment |
| `description` | `text` | NULL | — | |
| `display_order` | `integer` | NOT NULL | `0` | |
| `status` | `product_status` | NOT NULL | `'ACTIVE'` | Storefront visibility |
| `image_url` | `text` | NULL | — | Category card image (uploaded in spec 06) |
| `created_by` / `updated_by` | `uuid` | NULL | — | FK → `users(id)` |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- `UNIQUE (slug)`; index on `(parent_id, display_order)`; `CHECK (parent_id IS NULL OR parent_id <> id)`.
- Depth is limited to two levels (category → subcategory) by a service-layer check: a category whose `parent_id` is non-null cannot itself be a parent. §5.1 speaks only of "categories and subcategories."
- `ON DELETE RESTRICT` means a category with children or products cannot be deleted — see Data integrity.

### `products`

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `category_id` | `uuid` | NOT NULL | — | FK → `categories(id)` ON DELETE RESTRICT |
| `name` | `text` | NOT NULL | — | |
| `slug` | `text` | NOT NULL | — | §1.1 SEO-friendly URLs |
| `sku` | `text` | NULL | — | Optional (§12.5: "included only if the product has one") |
| `description` | `text` | NULL | — | Sanitized server-side before storage (§11.6) |
| `base_price` | `numeric(12,2)` | NOT NULL | — | BDT; `CHECK (base_price >= 0)` |
| `compare_at_price` | `numeric(12,2)` | NULL | — | Original price for the strikethrough/discount indicator (`design`: Price section; §13.9 ProductCard) |
| `status` | `product_status` | NOT NULL | `'INACTIVE'` | New products start hidden |
| `is_featured` | `boolean` | NOT NULL | `false` | Independent of status (§5.1 note) |
| `weight_grams` | `integer` | NULL | — | Parcel weight sent to couriers (§4.2) |
| `created_by` / `updated_by` | `uuid` | NULL | — | |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- `UNIQUE (slug)`; `UNIQUE (sku)` partial `WHERE sku IS NOT NULL`.
- Indexes: `(status, created_at DESC)` for §13.5's `LATEST` rule; `(status, is_featured)` for `FEATURED`; `(category_id, status)` for `CATEGORY`; a trigram or `to_tsvector` index on `name` for spec 07's search.
- `CHECK (compare_at_price IS NULL OR compare_at_price >= base_price)` — a "discount" that raises the price is a data error.

**Status/Featured independence (§5.1 note).** `status` and `is_featured` are separate columns; an Inactive product may be Featured. Only Active + Featured products surface on the storefront — that rule lives in the query layer (spec 07 and §13.5), not in the schema, exactly as the note describes it.

### `product_attributes` and `product_attribute_values`

§5.1's "manage product sizes / colours / age groups" plus "other fashion products that may be added in the future" means the attribute set must be data-driven, not a fixed column list.

`product_attributes`:

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | PK |
| `type` | `attribute_type` | NOT NULL | SIZE / COLOUR / AGE_GROUP / OTHER |
| `name` | `text` | NOT NULL | Display label, e.g. "Size" |
| `display_order` | `integer` | NOT NULL | |

`product_attribute_values`:

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | PK |
| `attribute_id` | `uuid` | NOT NULL | FK → `product_attributes(id)` ON DELETE RESTRICT |
| `value` | `text` | NOT NULL | e.g. "M", "Navy", "Kids" |
| `display_order` | `integer` | NOT NULL | |

- `UNIQUE (attribute_id, value)`.

### `product_variants`

Stock lives here (§5.1: "Stock should be managed at the appropriate product or variant level").

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `product_id` | `uuid` | NOT NULL | — | FK → `products(id)` ON DELETE CASCADE |
| `sku` | `text` | NULL | — | Per-variant SKU |
| `price` | `numeric(12,2)` | NULL | — | Overrides `products.base_price` when set |
| `compare_at_price` | `numeric(12,2)` | NULL | — | |
| `stock_quantity` | `integer` | NOT NULL | `0` | `CHECK (stock_quantity >= 0)` |
| `low_stock_threshold` | `integer` | NOT NULL | `5` | Drives §5.9's low-stock report |
| `is_active` | `boolean` | NOT NULL | `true` | A retired variant |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- `UNIQUE (sku)` partial `WHERE sku IS NOT NULL`.
- Index on `product_id`.
- **`CHECK (stock_quantity >= 0)` is the structural guarantee behind §5.1's oversell rule** — even if application logic were wrong, the database refuses a negative stock row, so a decrement below zero fails rather than overselling.

`product_variant_values` (join to the attribute values that define a variant):

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `variant_id` | `uuid` | NOT NULL | FK → `product_variants(id)` ON DELETE CASCADE |
| `attribute_value_id` | `uuid` | NOT NULL | FK → `product_attribute_values(id)` ON DELETE RESTRICT |

- PK `(variant_id, attribute_value_id)`.
- A service-layer check enforces that two variants of the same product cannot share an identical attribute-value combination (§5.1's variant example implies "Black / M" is one variant).

**Every product has at least one variant.** A product with no options gets a single default variant with no attribute values. This makes stock, pricing, and order line items uniform — there is exactly one place stock is ever read or written, which is what makes §5.1's atomic decrement rule enforceable.

### `product_images`

Created here; populated by spec 06.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `product_id` | `uuid` | NOT NULL | — | FK → `products(id)` ON DELETE CASCADE |
| `storage_path` | `text` | NOT NULL | — | Supabase Storage object path |
| `alt_text` | `text` | NULL | — | Required for accessibility (`design`: Images) |
| `display_order` | `integer` | NOT NULL | `0` | |
| `is_primary` | `boolean` | NOT NULL | `false` | |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

- Unique partial index enforcing at most one primary image per product: `CREATE UNIQUE INDEX ON product_images (product_id) WHERE is_primary`.

## Backend work

### Routes

All under `/api/admin/catalogue`, all requiring `requireAuth('admin')` + the named permission + `rateLimit('authenticatedCeiling')`.

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/categories` | `category.manage` |
| `POST` | `/categories` | `category.manage` |
| `PATCH` | `/categories/:id` | `category.manage` |
| `DELETE` | `/categories/:id` | `category.manage` |
| `GET` | `/attributes` | `product.attribute.manage` |
| `POST` | `/attributes` | `product.attribute.manage` |
| `POST` | `/attributes/:id/values` | `product.attribute.manage` |
| `DELETE` | `/attributes/:id/values/:valueId` | `product.attribute.manage` |
| `GET` | `/products` | `product.update`¹ |
| `POST` | `/products` | `product.create` |
| `GET` | `/products/:id` | `product.update` |
| `PATCH` | `/products/:id` | `product.update` |
| `DELETE` | `/products/:id` | `product.delete` |
| `PATCH` | `/products/:id/price` | `product.price.manage` |
| `PATCH` | `/products/:id/visibility` | `product.visibility.manage` |
| `POST` | `/products/:id/variants` | `product.variant.manage` |
| `PATCH` | `/variants/:id` | `product.variant.manage` |
| `DELETE` | `/variants/:id` | `product.variant.manage` |
| `PATCH` | `/variants/:id/stock` | `inventory.manage` |

¹ The §5.18 matrix has no "Product View" row. Listing products in the back-office is gated on `product.update` (Yes for both roles) rather than on an invented key, since §5.16 forbids inventing permission keys.

Three separate permissions are enforced on distinct sub-resources, per §5.18's separate matrix rows: changing price requires `product.price.manage`, changing visibility requires `product.visibility.manage`, and changing stock requires `inventory.manage` — a Manager with `product.update` alone cannot change a price, a visibility flag, or stock. This is why those three are separate endpoints rather than fields on the general `PATCH /products/:id`.

### Types

```ts
type CategoryResponse = {
  id: string; parentId: string | null; name: string; slug: string;
  description: string | null; displayOrder: number;
  status: 'ACTIVE' | 'INACTIVE'; imageUrl: string | null;
};

type CreateProductRequest = {
  categoryId: string;
  name: string;
  sku?: string;
  description?: string;
  basePrice: number;
  compareAtPrice?: number;
  weightGrams?: number;
  isFeatured?: boolean;
  variants: Array<{
    sku?: string;
    price?: number;
    compareAtPrice?: number;
    stockQuantity: number;
    lowStockThreshold?: number;
    attributeValueIds: string[];   // [] for a no-option product
  }>;
};

type ProductResponse = {
  id: string; categoryId: string; name: string; slug: string;
  sku: string | null; description: string | null;
  basePrice: number; compareAtPrice: number | null;
  status: 'ACTIVE' | 'INACTIVE'; isFeatured: boolean;
  weightGrams: number | null;
  variants: VariantResponse[];
  images: ProductImageResponse[];
  totalStock: number;        // derived: sum of active variants' stock
  isOutOfStock: boolean;     // derived: totalStock === 0 — never stored (§5.1)
};

type UpdateStockRequest = { stockQuantity: number; reason: string };
type UpdateVisibilityRequest = { status: 'ACTIVE' | 'INACTIVE' };
type UpdatePriceRequest = { basePrice?: number; compareAtPrice?: number | null };
```

`isOutOfStock` and `totalStock` are computed at read time from `product_variants.stock_quantity`. There is no stored out-of-stock column and no code path that writes one (§5.1).

### Validation rules

- `name` 1–200 chars, trimmed. `slug` is generated, never accepted from the client.
- `basePrice`, `price`, `compareAtPrice` ≥ 0, at most 2 decimal places, `numeric` not float.
- `stockQuantity` integer ≥ 0.
- `description` passes through `sanitizeHtml` (spec 04) before storage (§11.6).
- `attributeValueIds` must all exist and must not duplicate an existing variant's combination on the same product.
- `categoryId` must exist and be `ACTIVE` or the request explicitly acknowledges an inactive category.

### Slug generation (`services/slug.service.ts`)

Lower-cased, ASCII-transliterated, non-alphanumerics collapsed to `-`, trimmed to 80 chars. Collisions get a `-2`, `-3` suffix, resolved inside the insert transaction so two concurrent creates cannot both take a slug (the `UNIQUE` constraint is the real guard; the service retries on conflict).

Per the `seo` skill §2, slugs are **stable**: renaming a product does not change its slug by default. A slug change is an explicit, separate field on `PATCH /products/:id`, and the old slug is recorded so spec 07 can issue a redirect rather than a 404.

### Stock primitives (`services/inventory.service.ts`)

These are the functions spec 12 calls from inside the order state-transition transaction. They are defined and tested here in isolation.

```ts
// Atomic check-and-decrement per §5.1 "Stock decrement concurrency".
// Returns ok:false (never throws, never partially applies) when stock is insufficient.
// Items are sorted by variantId before any UPDATE is issued (deadlock-free lock ordering).
decrementStock(
  items: Array<{ variantId: string; quantity: number }>,
  ctx: { orderId: string; actorUserId: string | null }
): Promise<{ ok: true } | { ok: false; insufficient: Array<{ variantId: string; available: number; requested: number }> }>;

// The single uniform restoration rule per §5.1 "Stock restoration rule".
// Items are sorted by variantId before any UPDATE is issued (same lock ordering as decrementStock).
restoreStock(
  items: Array<{ variantId: string; quantity: number }>,
  ctx: { orderId: string; reason: string; actorUserId: string | null }
): Promise<void>;
```

`decrementStock` issues, per item, a **conditional update**, never a read-then-write:

```sql
UPDATE product_variants
   SET stock_quantity = stock_quantity - $qty
 WHERE id = $variantId
   AND stock_quantity >= $qty
```

**Lock ordering — items are sorted by `variant_id` before the first update is issued.** Each conditional `UPDATE` takes a row lock that is held until the enclosing transaction commits, so two concurrent confirmations touching the same two variants in opposite order would deadlock (Postgres aborts one with SQLSTATE `40P01`, surfacing as a spurious confirmation failure on a legitimate order). Sorting the items by `variant_id` in both `decrementStock` and `restoreStock` makes every transaction acquire locks in the same global order, so the wait-for cycle cannot form. This is not optional — it is the reason a multi-item order is safe to confirm under concurrency, and it costs one `sort()` call. A `40P01` that still escapes (a deadlock with an unrelated statement) is retried once by the caller before being surfaced.

If any item's update affects zero rows, the whole call reports `ok: false` and the enclosing transaction rolls back — so a multi-line order can never partially decrement. This is exactly §5.1's "a conditional update that only succeeds if sufficient stock remains… If insufficient stock remains at confirmation time, the confirmation must fail and the Admin/Manager must be notified instead of confirming an oversold order." Both functions must be called **inside** a caller-provided transaction; they never open their own.

Both append an `audit_logs` row per variant (`entity_type = 'product_variant'`, `action = 'stock_decrement'` / `'stock_restore'`, previous and new quantity, order id, reason, actor).

Manual stock edits via `PATCH /variants/:id/stock` also audit, with `action = 'stock_adjust'` and the supplied `reason`, so an unexplained inventory change is impossible to make.

### Deletion semantics

- **Category delete** — rejected with 409 `CATEGORY_NOT_EMPTY` if it has child categories or products (the FK is `RESTRICT`). The Admin deactivates instead.
- **Product delete** — rejected with 409 `PRODUCT_REFERENCED` if any order line item references one of its variants. §8.23's principle (historical orders must keep showing exactly what was bought) applies to products too: a product that has been ordered is deactivated, never deleted. Because order tables do not exist until spec 11, this check is written now as a service-layer hook that spec 11 activates; until then only the FK from `product_variants` applies.
- **Variant delete** — same rule.

## Frontend work

Admin routes under `frontend/src/app/admin/catalogue/`, following the `design` skill's "Product Management" screen.

- **`/admin/catalogue/products`** — search input (44px), collapsed filter bar, paginated product list. Each row: 60×60 image, name (14px), price (14px `#DC143C`), stock ("15 in stock", 12px `#6B7280`), status badge, and an **Out of Stock** badge derived from `isOutOfStock` — never a stored status. Row height 80px, 12px padding, 1px `#E5E7EB` divider. A fixed 56×56 `+` button bottom-right (`#DC143C`).
- **`/admin/catalogue/products/new`** and **`/[id]`** — form: name, category select, price, compare-at price, description textarea (120px min), weight, variants section, Active toggle, Featured toggle, images section (placeholder until spec 06). Save button full-width 48px. Labels above inputs at 12px/600; inputs 44px with a 2px `#DC143C` focus border and a 2px `#DC2626` error border with the message below.
- Price, visibility, and stock controls are **hidden when the user lacks the corresponding permission** and, per the `frontend` skill §3, still render the backend's 403 gracefully if the action is somehow attempted — the UI gate is convenience, the backend check is the control.
- **`/admin/catalogue/categories`** — tree list with reorder and Active toggle.
- Every screen implements loading / empty / error / success states explicitly. Mobile-first at 375px, verified at 320px, no horizontal scroll, no multi-column forms on mobile.

## Security requirements

- Every route enforces its §5.18 permission server-side via `requirePermission`; hiding an admin control is never the authorization (§5.15, §5.17). Price, visibility, and inventory are separately gated because that matrix lists them as separate rows.
- Product descriptions and category descriptions pass through `sanitizeHtml` **before storage** (§11.6) — the storefront also escapes at render, since neither layer assumes the other sanitized.
- Prices are `numeric(12,2)` and are only ever read from the database by the coupon engine (§8.14) and order creation (§3) — no client-supplied price is ever stored as authoritative or used in a calculation.
- All list endpoints paginate (§11.4).
- All input is validated by `.strict()` zod schemas; `slug` is server-generated and never accepted from the client, so a caller cannot claim another product's URL (§11.6).
- `stock_quantity >= 0` is a database `CHECK`, so no application bug can produce negative inventory.
- Every stock change and every price change appends an audit row with actor, previous and new values, and a reason (§5.15 rule 10).
- No Supabase credential or service-role key reaches the admin frontend bundle.

## Data integrity / idempotency

- **Atomic check-and-decrement (§5.1).** The conditional `UPDATE` is the only decrement path; two concurrent confirmations for the last unit of a variant cannot both succeed, because the second one's `WHERE stock_quantity >= $qty` matches zero rows. This is the primitive spec 12's `CONFIRMED` transition depends on and the reason an oversold order is structurally impossible.
- **All-or-nothing multi-line decrement.** A failure on any line aborts the whole call, so an order never partially reserves inventory.
- **Restoration is one uniform rule (§5.1).** `restoreStock` is a single function invoked by the state-transition handler for *any* entry into `CANCELLED` or `RETURNED` from a state at or after `CONFIRMED` — not a per-transition special case. Spec 12 wires it; this slice guarantees there is exactly one implementation to wire.
- **Slug uniqueness** is a database constraint, so concurrent creates cannot collide.
- **One primary image per product** is a partial unique index, not application discipline.
- **Referenced catalogue rows are never deleted**, preserving historical order accuracy in the same spirit as §8.23's coupon snapshot rule.

## Acceptance criteria

1. `npm run migrate` applies `0005_catalogue.sql` idempotently.
2. `POST /api/admin/catalogue/products` as Admin creates a product with generated slug; creating a second product with the same name yields a distinct slug (`-2`).
3. A new product defaults to `status = 'INACTIVE'` and does not appear in any storefront-facing query (verified again in spec 07).
4. `PATCH /products/:id/visibility` as a Manager returns 200 (that row is `Yes` for Manager), while `DELETE /products/:id` as a Manager without `product.delete` (an `Assigned` row) returns 403 and returns 200 once the permission is granted.
5. Setting `isFeatured: true` on an `INACTIVE` product succeeds — the two fields are independent (§5.1 note).
6. `GET /products/:id` for a product whose variants all have `stock_quantity = 0` returns `isOutOfStock: true`; no column named `out_of_stock` exists in the schema (`\d products` confirms).
7. Restocking one variant flips `isOutOfStock` to `false` with no status write.
8. `decrementStock([{variantId, quantity: 3}])` against a variant with 5 units leaves 2 and returns `ok: true`.
9. `decrementStock` against a variant with 2 units requesting 3 returns `ok: false` with `available: 2, requested: 3`, and the stored quantity is **unchanged**.
10. Two concurrent `decrementStock` calls each requesting the last unit: exactly one returns `ok: true`, the other returns `ok: false`, and final stock is 0 — never −1.
11. A two-line `decrementStock` where the second line is short leaves **both** quantities unchanged.
12. `restoreStock` returns the quantity and appends an audit row with previous and new values.
13. `PATCH /variants/:id/stock` without a `reason` returns 400.
14. Direct SQL `UPDATE product_variants SET stock_quantity = -1` is rejected by the `CHECK`.
15. `DELETE /categories/:id` for a category containing products returns 409 `CATEGORY_NOT_EMPTY`.
16. Creating two variants of one product with the same attribute-value combination returns 409.
17. A product description containing `<script>alert(1)</script>` is stored with the script stripped.
18. `GET /products` returns a `pagination` block and never more than `pageSize` rows.
19. At 375px, the product list and editor render with no horizontal scroll and 44px-minimum controls.

## Tests required

Per the `test` skill — §1 names stock decrement/restore explicitly as a state-machine-adjacent requirement; catalogue CRUD otherwise falls under §5's "standard coverage."

1. **Atomic decrement under concurrency** (§5.1 "Stock decrement concurrency") — two simultaneous decrements of the last unit; exactly one succeeds, stock never negative. Run against a real database; a mocked data layer cannot exercise this.
2. **Insufficient stock fails cleanly** (§5.1) — returns the shortfall, writes nothing, and reports enough detail for the Admin/Manager notification the PRD requires.
3. **Multi-line all-or-nothing** — a partially-satisfiable order decrements nothing.
4. **Restore returns exactly what was taken** (§5.1 "Stock restoration rule") — decrement then restore round-trips to the original quantity.
5. **Database rejects negative stock** — the `CHECK` constraint, tested at the data layer, not via the service.
6. **Out of stock is derived, never stored** (§5.1 note) — assert no column stores it and that the derived flag changes with stock alone, with no status write.
7. **Active/Inactive and Featured are independent** (§5.1 note) — every combination is storable; only Active+Featured is eligible for storefront featured queries.
8. **Permission matrix rows for catalogue** (§5.18) — one test per row: `product.create`, `product.update`, `product.delete` (Assigned — rejected ungranted, allowed granted), `category.manage`, `product.image.manage`, `product.attribute.manage`, `product.variant.manage`, `product.price.manage`, `inventory.manage`, `product.visibility.manage`.
9. **Price/visibility/stock require their own permissions** — a Manager holding only `product.update` is rejected on the price, visibility, and stock endpoints if those rows were `Assigned`; with the current matrix all three are `Yes`, so the test asserts the endpoints check the *correct distinct* key (verified by revoking it in the fixture).
10. **Slug stability and uniqueness** (§1.1, `seo` §2) — renaming does not change the slug; concurrent creates with the same name produce distinct slugs.
11. **Description sanitization** (§11.6) — script tags and event handlers stripped before storage.
12. **Deletion guards** — non-empty category and referenced product both rejected.
13. **Audit on stock and price changes** (§5.15 rule 10) — previous/new values, actor, and reason recorded.
14. **Pagination** (§11.4) — the product list is bounded.
15. **Deadlock-free lock ordering** — two concurrent `decrementStock` calls on the same two variants, each given its item list in the *opposite* order, both complete (one succeeding, or one failing on stock) with **no `40P01` deadlock error**. This is the test that would fail if the `variant_id` sort were ever dropped during implementation.

## Open questions / assumptions

1. **Product ratings/reviews.** The `design` skill's product card and listing page show an optional rating ("⭐ 4.5 (120)"), but **no PRD in `.claude/project requirment documents/` defines a review or rating system** — it appears in none of the catalogue list, the customer capabilities, or the ProductCard field list (§5.1, §2, §13.9). *Assumption:* no ratings in v1; the rating element is omitted from the product card rather than faked. **Flagged as a design-vs-PRD conflict** — the design system implies a feature the requirements never specify, and CLAUDE.md §1 puts requirement files above the design system.
2. **Stock at product vs. variant level.** §5.1 says "Stock should be managed at the appropriate product or variant level," leaving the choice open. *Assumption:* always at the variant level, with a single default variant for products that have no options. One storage location is what makes §5.1's atomic decrement rule enforceable in exactly one place; two levels would mean two decrement paths and two race conditions.
3. **Shipping fee / parcel weight.** §8.14c's calculation chain adds a shipping charge, and §4.2 sends parcel weight to the courier, but **no PRD defines how the shipping fee is computed** — it even notes "there is none to change; shipping fee computation is unaffected by this feature." *Resolution:* `weight_grams` is captured here for courier payloads (§4.2), and shipping-fee computation is **owned by spec 21**, which gives it an admin-managed zone/rate table and `computeShipping()` as the single authority. Spec 11 calls it; nothing in this slice computes a shipping amount. Still genuinely absent from the PRDs — spec 21 exists precisely because no PRD defines it.
4. **Category depth.** §5.1 names "categories" and "subcategories" (two levels) while §13.5's `CATEGORY` rule says "the selected category (and its subcategories)". *Assumption:* exactly two levels, enforced in the service. Deeper nesting would still work at the schema level if later required.
5. **Age group modelling.** §5.1 lists age group alongside size and colour as something to "manage… where applicable." *Assumption:* it is an attribute type like the others, not a separate column, so §5.1's "other fashion products that may be added in the future" is satisfied without a migration per attribute kind.
6. **`compare_at_price`.** §13.9's ProductCard lists "price, discounted price, discount indicator" and the `design` skill specifies a strikethrough original price, but no PRD names the field or a product-level discount mechanism (§8 is coupon-only and §13.17 explicitly rules out a second discount engine). *Assumption:* `compare_at_price` is presentational only — a manually-entered "was" price — and is never used in any order, coupon, or payment calculation. All money math uses `base_price`/`variants.price` exclusively, keeping the calculation chain single-sourced.
