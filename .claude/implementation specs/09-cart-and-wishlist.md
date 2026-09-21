# 09 — Shopping Cart and Wishlist

## Goal

After this slice a customer — guest or registered, with no account required — can add product variants to a cart, change quantities, remove lines, and see a server-computed cart summary whose prices come from the catalogue rather than from the browser. A registered customer's cart and wishlist persist across devices; a guest's cart persists in an anonymous server-side cart bound to an httpOnly cart cookie, and merges into the account's cart if they later log in. This is the last slice before checkout, and its central rule is the one checkout inherits: **the cart never carries a price the client supplied**.

## Requirement references

- `02-customer.md` §2 — customers can add products to the shopping cart and add products to a wishlist; checkout starts from the cart; all of this works before and without registration.
- `02-customer.md` §2.9.1 steps 1–2 — the customer adds products to the cart **without logging in** and proceeds to checkout, landing directly on guest fields; there is no account step anywhere in that path.
- `02-customer.md` §2.9.3 step 5 — at order placement the backend re-validates "cart/order content validation (items still available, prices current)", identically for guest and registered.
- `03-payment-order.md` §3 — order creation re-checks cart contents and current product prices inside one transaction; the backend never trusts a client total.
- `05-admin-operations.md` §5.1 — stock is decremented at `CONFIRMED`, not at placement and **not at add-to-cart**; `Out of Stock` is derived from stock data.
- `10-coupon-discount.md` §8.15a — the Apply Coupon call sends "the current cart contents (product/variant IDs and quantities — **not client-computed prices or totals**)"; §8.14 — the backend looks up current valid product prices fresh from the catalogue; §8.16 — the backend never trusts a frontend-submitted subtotal, discount, or total.
- `13-homepage-cms.md` §13.9 — the shared `<ProductCard />` includes a wishlist action, reused everywhere products are listed.
- `12-whatsapp-contact.md` §12.3 — an out-of-stock product shows **Add to Wishlist** + Chat on WhatsApp instead of Buy Now.
- `08-analytics-meta.md` §6.2 — `AddToCart` and `InitiateCheckout` are tracked events (fired in spec 18; this slice defines where they attach).
- `11-security-hardening.md` §11.3 (public ceiling), §11.4 (pagination, body limits), §11.6 (schema validation).
- Skills: `frontend` §2 (never compute totals client-side as authoritative), `backend` §2, `security` §3, §8, `design` (Shopping Cart page, Product card actions).

## Depends on

- **01** — API conventions, validation, errors, `apiClient`.
- **02** — `customers`, `withTransaction`.
- **04** — `publicCeiling` / `authenticatedCeiling` limiters.
- **05** — `products`, `product_variants`, prices, derived stock.
- **07** — `<ProductCard />`, `PublicProductSummary`, the storefront shell and its cart badge.
- **08** — customer sessions (`requireAuth('customer')`) for persistence and merge.

## Scope

**In scope**

- `carts`, `cart_items`, `wishlist_items` schema.
- Anonymous cart identity: an httpOnly `cart_token` cookie bound to a server-side cart row.
- Cart API: get, add item, update quantity, remove item, clear.
- Server-computed cart summary (line prices, merchandise subtotal, availability flags) — computed from the catalogue on every read.
- Cart merge on login/registration.
- Wishlist API (registered customers only) and the wishlist action on `<ProductCard />`.
- Cart and wishlist pages, cart badge, and the cart summary component.
- A `resolveCartForPricing()` service that specs 10 and 11 call to obtain authoritative line items.

**Out of scope / deferred**

- Coupon entry and discount preview — deferred to spec **10**; this slice's summary shows merchandise subtotal only.
- Shipping fee, order totals, checkout, and order creation — deferred to spec **11**.
- Stock decrement — deferred to spec **12**; §5.1 places it at `CONFIRMED`, so nothing in this slice reserves inventory.
- `AddToCart` / `InitiateCheckout` Pixel and CAPI events — deferred to spec **18**.
- Guest wishlist persistence — see Open questions 2.

## Database changes

Migration file: `backend/migrations/0009_cart_wishlist.sql`

### `carts`

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `customer_id` | `uuid` | NULL | — | FK → `customers(id)` ON DELETE CASCADE; NULL for an anonymous cart |
| `token_hash` | `text` | NULL | — | SHA-256 of the `cart_token` cookie value; NULL once owned by a customer |
| `status` | `cart_status` | NOT NULL | `'ACTIVE'` | `ACTIVE` \| `CONVERTED` \| `ABANDONED` |
| `converted_order_id` | `uuid` | NULL | — | Set by spec 11 when an order is created from this cart |
| `last_activity_at` | `timestamptz` | NOT NULL | `now()` | |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL | `now()` | |

```sql
CREATE TYPE cart_status AS ENUM ('ACTIVE','CONVERTED','ABANDONED');
```

- `UNIQUE (token_hash)` partial `WHERE token_hash IS NOT NULL`.
- Partial unique index giving each customer exactly one active cart: `CREATE UNIQUE INDEX ON carts (customer_id) WHERE customer_id IS NOT NULL AND status = 'ACTIVE'` — this is what makes "merge into the customer's cart" a deterministic operation rather than a choice among several carts.
- `CHECK (customer_id IS NOT NULL OR token_hash IS NOT NULL)` — a cart always has an owner of one kind.
- Index on `(status, last_activity_at)` for cleanup.

### `cart_items`

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `cart_id` | `uuid` | NOT NULL | — | FK → `carts(id)` ON DELETE CASCADE |
| `product_variant_id` | `uuid` | NOT NULL | — | FK → `product_variants(id)` ON DELETE RESTRICT |
| `quantity` | `integer` | NOT NULL | — | `CHECK (quantity > 0 AND quantity <= 99)` |
| `added_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- `UNIQUE (cart_id, product_variant_id)` — one line per variant; re-adding increments rather than duplicating.

**No price column.** This is deliberate and load-bearing: §8.14 requires prices to be "looked up fresh from the catalogue… never trusted from the client," and §3 requires order creation to re-check "current product prices." Storing a price on the cart line would create a second, staler source of truth that some future code path would inevitably read. Prices are joined from `product_variants`/`products` on every read. The *order* snapshots prices (spec 11) — the cart never does.

### `wishlist_items`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | PK |
| `customer_id` | `uuid` | NOT NULL | FK → `customers(id)` ON DELETE CASCADE |
| `product_id` | `uuid` | NOT NULL | FK → `products(id)` ON DELETE CASCADE |
| `created_at` | `timestamptz` | NOT NULL | `now()` |

- `UNIQUE (customer_id, product_id)` — makes add-to-wishlist idempotent.
- The wishlist holds **products**, not variants: §12.3's out-of-stock case offers "Add to Wishlist" for the product as a whole, before any variant is selectable.

## Backend work

### Cart identity resolution

One middleware/service resolves the acting cart for every cart request:

1. If `requireAuth('customer')` produced an actor → use that customer's `ACTIVE` cart, creating it if absent.
2. Else if a valid `cart_token` cookie maps to an `ACTIVE` anonymous cart → use it.
3. Else → create an anonymous cart, issue a new `cart_token`.

`cart_token` is a 256-bit random value stored **hashed**, set as an `httpOnly`, `secure`, `sameSite=lax` cookie with a 30-day expiry. `lax` rather than `strict` because a customer may arrive from an external link and should keep their cart. The token is a bearer credential for a cart containing no personal data — no name, phone, or address is ever attached to a cart.

Cart endpoints are **unauthenticated by design** (§2.9.1 step 1: products are added to the cart without logging in). No route here requires a session.

### Routes

| Method | Path | Auth | Limiter |
| --- | --- | --- | --- |
| `GET` | `/api/cart` | optional | `publicCeiling` |
| `POST` | `/api/cart/items` | optional | `publicCeiling` |
| `PATCH` | `/api/cart/items/:variantId` | optional | `publicCeiling` |
| `DELETE` | `/api/cart/items/:variantId` | optional | `publicCeiling` |
| `DELETE` | `/api/cart` | optional | `publicCeiling` |
| `GET` | `/api/customer/wishlist` | customer | `authenticatedCeiling` |
| `POST` | `/api/customer/wishlist` | customer | `authenticatedCeiling` |
| `DELETE` | `/api/customer/wishlist/:productId` | customer | `authenticatedCeiling` |

### Types

```ts
type CartLine = {
  variantId: string;
  productSlug: string;
  productName: string;
  variantLabel: string;          // e.g. "Black / M", built from attribute values
  image: { url: string; altText: string | null } | null;
  unitPrice: number;             // from the catalogue, at read time
  quantity: number;
  lineTotal: number;             // unitPrice × quantity, computed server-side
  availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'UNAVAILABLE';
  availableQuantity: number | null;  // only when it is below the requested quantity
};

type CartResponse = {
  lines: CartLine[];
  itemCount: number;             // sum of quantities — drives the header badge
  merchandiseSubtotal: number;   // sum of lineTotal — server-computed, pre-discount
  hasUnavailableLines: boolean;
  currency: 'BDT';
};

// POST /api/cart/items
type AddCartItemRequest = { variantId: string; quantity: number };   // no price field, ever

// PATCH /api/cart/items/:variantId
type UpdateCartItemRequest = { quantity: number };   // 0 is rejected; use DELETE
```

`AddCartItemRequest` carrying no price or total is the API-shape expression of §8.15a's rule that the client sends "product/variant IDs and quantities — not client-computed prices or totals." A request containing a `price` or `lineTotal` field is rejected by the `.strict()` schema rather than ignored, so a tampering attempt fails loudly (§11.6).

### Cart pricing service

```ts
resolveCartForPricing(cartId: string): Promise<{
  lines: Array<{ variantId: string; productId: string; categoryId: string;
                 quantity: number; unitPrice: number; lineTotal: number }>;
  merchandiseSubtotal: number;
  unavailable: Array<{ variantId: string; reason: 'OUT_OF_STOCK' | 'UNAVAILABLE'; available: number }>;
}>;
```

This is the **single** function that turns a cart into priced lines. It:

- Joins `cart_items` → `product_variants` → `products` in one query (no N+1, per `database` skill §6).
- Uses `product_variants.price` when set, otherwise `products.base_price` — the same precedence spec 05 defines and spec 11 must not re-derive.
- Ignores `compare_at_price` entirely, since spec 05 fixes it as presentational only.
- Marks a line `UNAVAILABLE` when the product or variant is inactive or the category is inactive (matching spec 07's `activeProductScope`), and `OUT_OF_STOCK` when `stock_quantity < quantity`.
- Returns `categoryId` and `productId` because spec 10's coupon eligibility (§8.12) needs them and spec 11's order lines need them — so eligibility is computed from the same priced lines the order is built from, never from a second lookup that could disagree.

Spec 10 (`POST /api/coupons/validate`) and spec 11 (order creation) both call this function. That is the mechanism by which §8.14's "recalculates the entire pricing chain from current data on every apply/validate and again at order creation" is guaranteed to use identical inputs at both points.

### Cart operations

**Add** — inside `withTransaction`: validate the variant exists, is active, and its product and category are active; upsert the line (`ON CONFLICT (cart_id, product_variant_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity`), capped at 99; touch `last_activity_at`; return the recomputed cart.

Adding an out-of-stock item is **allowed** and the line is flagged `OUT_OF_STOCK`. Nothing is reserved — §5.1 puts the decrement at `CONFIRMED`, so a cart holds no inventory claim. Checkout (spec 11) is where an unavailable line blocks the order. The UI discourages it; the data model does not forbid it, because stock can change while the cart sits.

**Update quantity** — replace, not increment; quantity 0 rejected with `VALIDATION_ERROR`.

**Merge on login** (called by spec 08's login and registration handlers, inside their transaction):

```text
mergeAnonymousCart(anonymousCartId, customerId):
  for each line in the anonymous cart:
    upsert into the customer's ACTIVE cart, summing quantities (capped at 99)
  mark the anonymous cart ABANDONED, clear its token_hash
  clear the cart_token cookie
```

Summing rather than replacing is the choice least likely to lose something the customer deliberately added on either device. The customer's own cart survives; the anonymous one is absorbed.

### Wishlist

Registered customers only (`requireAuth('customer')`). Add is idempotent via the unique constraint. The list returns `PublicProductSummary` objects from spec 07's mapper, so a wishlisted product that goes inactive simply disappears from the list rather than rendering a dead card.

### Cleanup

A maintenance script (not a scheduled job in this slice) marks anonymous `ACTIVE` carts untouched for more than 30 days as `ABANDONED` and deletes those older than 90 days. §11.4's "no synchronous heavy work in the request path" means this never runs inside a request.

### Error cases

| Case | Status | `code` |
| --- | --- | --- |
| Variant not found / inactive / product or category inactive | 404 | `NOT_FOUND` (never reveals that a hidden product exists) |
| Quantity out of range | 400 | `VALIDATION_ERROR` |
| Request body carries a price/total field | 400 | `VALIDATION_ERROR` |
| Cart token invalid or expired | 200 | a fresh empty cart with a new token — never an error the customer must resolve |
| Item not in cart on update/delete | 404 | `NOT_FOUND` |
| Wishlist add without a session | 401 | `UNAUTHORIZED` |

## Frontend work

- **Cart badge** in the header (spec 07's shell) driven by `itemCount` from `GET /api/cart`. 12×12px, `#DC143C`, white 10px text, top-right of the cart icon (`design`: Mobile Header).
- **`/cart`** (`design`: Shopping Cart):
  - Header "Cart"; item rows with an 80×80px image, name (14px, 1 line), price (14px `#DC143C`), a `+`/`−` quantity control with the number between, and a remove action. 1px `#E5E7EB` dividers.
  - A **sticky summary** at the bottom: subtotal label (14px gray) and amount (16px bold), a placeholder row for shipping that spec 11 fills, then a full-width 48px red Checkout button and a full-width 44px outline Continue Shopping button.
  - The summary renders **only** values from `CartResponse`. It never sums line totals in JavaScript — per the `frontend` skill §2, a client-computed authoritative total is a defect even when it happens to match.
  - Unavailable/out-of-stock lines are visibly flagged with an explanatory message and the Checkout button is disabled while `hasUnavailableLines` is true. This is UX; spec 11's backend re-check is the actual gate.
  - States: loading (skeleton rows), empty ("Your cart is empty" plus a Continue Shopping action), error (message + retry), success.
- **Add to cart** from the product detail page (spec 07) requires a complete variant selection; the button shows a pending state and then a confirmation, with the badge updating from the response.
- **Wishlist action on `<ProductCard />`** (§13.9) — for a signed-out visitor it routes to login with a return path rather than silently failing, and never blocks browsing.
- **`/account/wishlist`** — a `<ProductGrid />` of `<ProductCard />`s (the same component from spec 07, per §13.9), with an empty state.
- **`AddToCart` / `InitiateCheckout` attach points** are marked in the code for spec 18, which owns event firing and `event_id` generation.
- Touch targets ≥44px; quantity controls 44×44px; no hover-only affordances; mobile-first at 375px.

## Security requirements

- **The client never supplies a price.** Request schemas contain no price, subtotal, or total field, and `.strict()` rejects one if sent. All money in `CartResponse` is computed server-side from the catalogue (§8.16, `security` skill §5, `frontend` skill §2).
- **Cart identity is a server-issued, httpOnly, hashed-at-rest token** — not a client-readable id and not a customer id, so guessing or crafting a token cannot reach another cart. Only the hash is stored, so a database read does not yield usable tokens.
- **No PII in a cart.** Names, phones, and addresses are collected at checkout (§2.9.2), never attached to a cart — so an anonymous cart token, if leaked, exposes only a list of products.
- **A customer's cart is reachable only via their session**, never by a client-supplied `cartId`; no endpoint accepts a cart identifier as a parameter.
- **Hidden products stay hidden** — adding an inactive product's variant returns `404`, identical to a nonexistent one, so the cart cannot be used to probe unreleased catalogue entries (the same rule spec 07 applies).
- **No inventory is reserved**, so cart manipulation cannot be used to deny stock to other customers — a direct consequence of §5.1's decrement-at-`CONFIRMED` rule.
- **Rate limiting** — cart routes fall under the public per-IP ceiling (§11.3); wishlist routes under the authenticated ceiling.
- **Validation** — `.strict()` zod schemas on every route; `variantId` must be a UUID; quantity bounded 1–99 (§11.6, §11.4).
- Cart responses are `Cache-Control: no-store` — they are per-visitor and must never enter a shared cache.

## Data integrity / idempotency

- **One line per variant** — `UNIQUE (cart_id, product_variant_id)` plus an upsert means a double-clicked "Add to cart" increments a single row rather than creating two lines. This is the cart-level analogue of the idempotency §3.1 requires at order placement; it does not replace it.
- **One active cart per customer** — the partial unique index makes merge deterministic and prevents a customer accumulating parallel carts across devices.
- **Quantity bounds are a database `CHECK`**, so no application path can store 0 or a negative quantity.
- **Merge is atomic** — it runs inside the login transaction, so a failure leaves the anonymous cart intact and re-mergeable rather than half-absorbed.
- **Wishlist add is idempotent** by unique constraint.
- **No price snapshot in the cart** means a cart can never present a stale price as authoritative; every read reflects the catalogue at that instant, and spec 11 recomputes again at order creation (§3, §8.15b).
- **`converted_order_id` and `CONVERTED` status** (set by spec 11) give order creation a place to mark the cart consumed, so a second submission of the same checkout finds an already-converted cart rather than silently re-ordering.

## Acceptance criteria

1. `GET /api/cart` with no cookie returns an empty cart and sets an httpOnly `cart_token`; the raw token value does not appear in any database column (only its hash).
2. `POST /api/cart/items` with `{variantId, quantity: 2}` returns a cart whose `merchandiseSubtotal` equals the catalogue price × 2 — and changing the variant's price in the back-office changes the next `GET /api/cart` response with no cart write.
3. `POST /api/cart/items` with `{variantId, quantity: 1, unitPrice: 1}` returns `400 VALIDATION_ERROR` naming `unitPrice`.
4. Adding the same variant twice yields one line with quantity 2, not two lines.
5. `PATCH /api/cart/items/:variantId` with `{quantity: 0}` returns `400`; `DELETE` removes the line.
6. Quantity 100 is rejected; direct SQL insert of quantity 0 is rejected by the `CHECK`.
7. Adding a variant of an `INACTIVE` product returns `404`, identical to a nonexistent variant id.
8. Adding an out-of-stock variant succeeds, the line reports `availability: 'OUT_OF_STOCK'`, `hasUnavailableLines` is true, and `product_variants.stock_quantity` is unchanged — nothing is reserved.
9. A guest builds a cart, then registers or logs in: the anonymous lines appear in the account cart with quantities summed, the anonymous cart is `ABANDONED`, and the `cart_token` cookie is cleared.
10. A logged-in customer's cart is identical across two browsers.
11. No cart endpoint accepts a cart id parameter (verified by inspecting the route definitions).
12. A tampered `cart_token` yields a fresh empty cart, not another customer's cart and not an error page.
13. `resolveCartForPricing` returns `productId` and `categoryId` per line, and its `merchandiseSubtotal` equals `GET /api/cart`'s — one function, one answer.
14. `POST /api/customer/wishlist` twice for the same product leaves one row; without a session it returns `401`.
15. A wishlisted product set to `INACTIVE` disappears from `/api/customer/wishlist`.
16. Cart responses carry `Cache-Control: no-store`.
17. The cart page at 375px shows 80×80px images, 44×44px quantity controls, a sticky summary, and no horizontal scroll; at 320px nothing overflows.
18. The cart page's displayed subtotal is byte-identical to `merchandiseSubtotal` from the API, and no JavaScript in the page sums line totals (verified by inspecting the component).

## Tests required

Per the `test` skill: cart pricing feeds directly into §3's coupon/price-integrity area, which the skill ranks as high-risk, so the price-source tests below are not "standard CRUD coverage."

1. **Client-supplied prices are rejected, not ignored** (§8.16, §8.15a) — a request carrying `unitPrice`/`lineTotal`/`subtotal` returns 400. This is the precursor to spec 10's and 11's price-manipulation defences.
2. **Prices always come from the catalogue** (§8.14) — change a variant price between two cart reads and assert the second reflects it with no cart mutation; assert no price column exists on `cart_items`.
3. **Variant price precedence** — a variant with its own `price` uses it; one without falls back to `products.base_price`. Spec 11 must produce the same number, so it is pinned here.
4. **Subtotal is server-computed** — tamper with nothing and assert `merchandiseSubtotal` equals the sum of catalogue-derived line totals, including a decimal case that would round badly in floating point (`numeric(12,2)` end to end).
5. **One line per variant** — concurrent double add yields one row with summed quantity.
6. **Quantity bounds** — application and database both reject 0 and >99.
7. **Hidden products are unreachable and indistinguishable** — inactive product/variant/category each return 404 identical to a nonexistent id (§5.1, spec 07's visibility rule).
8. **Out-of-stock add reserves nothing** (§5.1) — stock unchanged after adding; the line is flagged. This guards the decrement-at-`CONFIRMED` rule against a future "reserve at add" refactor.
9. **Anonymous cart isolation** — two tokens never see each other's carts; a forged token yields an empty cart.
10. **Merge on login** (§2.9.1, §2) — guest cart + account cart merge with summed quantities, atomically; a forced failure mid-merge leaves the anonymous cart intact.
11. **One active cart per customer** — concurrent cart creation for one customer yields one row.
12. **`resolveCartForPricing` agrees with `GET /api/cart`** — the same cart yields the same subtotal through both paths, and the resolver returns the `productId`/`categoryId` that spec 10's eligibility check needs.
13. **Wishlist idempotency and auth** — duplicate add is a no-op; unauthenticated add is 401.
14. **No PII on a cart** — asserting the cart tables carry no name/phone/address column, so a leaked cart token exposes nothing personal.

## Open questions / assumptions

1. **Cart persistence mechanism.** No PRD specifies where a guest cart lives. *Assumption:* a server-side cart keyed by an httpOnly cookie, rather than `localStorage`. Three PRD rules push this way: the server must receive current cart contents for coupon validation, must re-read cart contents at order creation, and must not trust client-submitted cart economics (§8.15a, §3, §8.16). A `localStorage` cart would have to be uploaded wholesale at checkout, making the client the source of cart truth.
2. **Guest wishlist.** §2 lists "add products to a wishlist" among customer capabilities without stating whether a guest can. §12.3 shows "Add to Wishlist" on an out-of-stock product page, which a guest can reach. *Assumption:* wishlist requires an account (it is inherently a saved-for-later list tied to a person), and a signed-out visitor tapping it is routed to login with a return path — never blocked from browsing, never prompted during checkout. **Flagged as genuinely ambiguous**; if guest wishlists are wanted, they attach to the same `cart_token` identity with no schema change beyond a nullable `cart_id`.
3. **Cart lifetime.** Not specified. *Assumption:* 30-day cookie, 30-day inactivity to `ABANDONED`, 90-day deletion, all env-configurable.
4. **Maximum quantity per line.** Not specified. *Assumption:* 99, both as a sanity bound and to keep a single order's stock impact reasonable.
5. **Merge strategy.** §2.9.8 covers merging *order history* on account claim but says nothing about carts. *Assumption:* sum quantities rather than replace, as the least destructive choice.
6. **Shipping fee.** Deliberately absent from `CartResponse` here. No PRD defines how shipping is computed (flagged in spec 05 Open questions 3 and again in spec 11); the cart shows merchandise subtotal only, and spec 11 introduces the shipping line once that rule is decided. §8.14c is clear that whatever it is, the coupon discount never reduces it.
