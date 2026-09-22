# 07 — Storefront Catalogue: Browsing, Search, Product Detail, and SEO Foundation

## Goal

After this slice the public storefront exists and is indexable: customers can browse categories, list and filter products, search, and open a product detail page with variant selection and live stock status — all server-rendered, all served by public Express endpoints that expose only customer-safe fields. The SEO foundation required by §1.1 is complete for these pages (Metadata API, slugs, canonical URLs, Open Graph, JSON-LD, `sitemap.xml`, `robots.txt`), and the shared `<ProductCard />` component that §13.9 requires every later listing to reuse is built here. No cart, no checkout, no CMS-driven homepage yet.

## Requirement references

- `01-overview.md` §1.1 — SEO is a first-class stack item: SSR/SSG where appropriate, Metadata API, dynamic product and category metadata, sitemap and robots.txt, canonical URLs, Open Graph, JSON-LD, SEO-friendly URLs.
- `02-customer.md` §2 — customers can browse products by category; search and filter products; view detailed product information; select variants such as size, colour, age group and other options; purchase across the listed product categories. All of this is available without an account.
- `05-admin-operations.md` §5.1 — `Active`/`Inactive` visibility; `Featured` as an independent flag (only an Active, Featured product is ever surfaced on the storefront); `Out of Stock` derived from stock data and "displayed where applicable."
- `13-homepage-cms.md` §13.9 — a single reusable `<ProductCard />` (image, name, price, discounted price, discount indicator, Featured indicator, out-of-stock state, wishlist action, product link) shared by every place products are listed, including category pages and search results — not reimplemented per section.
- `13-homepage-cms.md` §13.15 — server-side/static rendering with revalidation; Next.js Image optimization; lazy loading below the fold; avoid N sequential client requests.
- `12-whatsapp-contact.md` §12.3 — the product detail page shows **Buy Now + Chat on WhatsApp** when in stock, and **Add to Wishlist + Chat on WhatsApp** when out of stock (the button itself is built in spec 19; this slice establishes the stock-driven layout it plugs into).
- `08-analytics-meta.md` §6.2 — `PageView`, `ViewContent` (product detail view), and `Search` are storefront events (fired in spec 18; this slice defines where they attach).
- `11-security-hardening.md` §11.3 (public per-IP ceiling), §11.4 (mandatory pagination), §11.6 (input validation; output escaping of user-supplied content).
- Skills: `seo` §1–8 (the full SEO contract), `frontend` §2, §5, §9, §10, `design` (Product Listing Page, Product Detail Page, navigation, breakpoints), `security` §8 (public endpoints return only customer-safe models).

## Depends on

- **01** — API conventions, pagination, error taxonomy, Tailwind design tokens, `apiClient`.
- **04** — `publicCeiling` rate limiter, CSP whose `img-src` includes the storage host.
- **05** — `categories`, `products`, `product_variants`, attributes, slugs, derived out-of-stock.
- **06** — `product_images`, public image URLs, `<ProductImage />`.

## Scope

**In scope**

- Public read endpoints: category tree, product list (filter/sort/paginate), product detail by slug, search, and a lightweight feed for `sitemap.xml`.
- A customer-safe product projection shared by every public endpoint.
- Storefront pages: category listing (`/c/[slug]`), product listing with filters, product detail (`/p/[slug]`), search results (`/search`).
- Shared components: `<ProductCard />`, `<ProductGrid />`, `<VariantSelector />`, `<PriceDisplay />`, `<StockBadge />`, `<Breadcrumbs />`, storefront header/bottom-navigation/footer shell.
- SEO: `generateMetadata` per route, canonical URLs, Open Graph, JSON-LD (`Product`, `BreadcrumbList`, `Organization`/`WebSite`), `app/sitemap.ts`, `app/robots.ts`, and slug-change redirects.
- Storefront navigation shell including the **Track Order** entry point placeholder (header, mobile menu, footer) whose page is built in spec 15.

**Out of scope / deferred**

- Cart and wishlist behaviour — deferred to spec **09** (the card's wishlist/cart buttons render here but call handlers that spec 09 implements).
- CMS-driven homepage — deferred to spec **17**; `/` in this slice is a simple non-CMS landing page listing categories and featured products, replaced by the CMS renderer later.
- The WhatsApp button — deferred to spec **19** (the layout slot exists here).
- Meta Pixel `ViewContent`/`Search` firing — deferred to spec **18**.
- Customer account pages — deferred to spec **08**.
- Track Order page itself — deferred to spec **15**.
- Product reviews/ratings — not defined by any PRD (see spec 05 Open questions 1); the card renders no rating.

## Database changes

Migration file: `backend/migrations/0007_product_search_and_slug_history.sql`

No new business tables. Two additions supporting this slice's requirements:

### `product_slug_history`

Supports the `seo` skill §2 rule that a slug change must not silently 404 an indexed URL.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | PK |
| `product_id` | `uuid` | NOT NULL | FK → `products(id)` ON DELETE CASCADE |
| `old_slug` | `text` | NOT NULL | |
| `created_at` | `timestamptz` | NOT NULL | `now()` |

- `UNIQUE (old_slug)` — an old slug can never collide with a live slug or another history row; the product-create path checks both tables before assigning a slug.
- Written by spec 05's product-update service whenever `slug` changes.

An equivalent `category_slug_history` table with the same shape.

### Search index

```sql
ALTER TABLE products ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(sku,''))
  ) STORED;
CREATE INDEX products_search_idx ON products USING GIN (search_vector);
CREATE INDEX products_name_trgm_idx ON products USING GIN (name gin_trgm_ops);
```

`simple` rather than `english` because product names are commonly transliterated Bangla brand/garment terms that an English stemmer would mangle. The trigram index backs prefix/fuzzy matching for short queries. `pg_trgm` is enabled in this migration.

## Backend work

### Customer-safe product projection

One shared mapper, used by **every** public endpoint in this slice and by specs 09, 11, and 17. Public responses never contain internal-only fields.

```ts
type PublicProductSummary = {
  slug: string;                 // the public identifier; internal UUIDs are not exposed
  name: string;
  categorySlug: string;
  price: number;                // lowest active-variant price
  compareAtPrice: number | null;
  discountPercent: number | null;  // derived, presentational only
  isFeatured: boolean;
  isOutOfStock: boolean;        // derived from stock (§5.1) — never a stored status
  primaryImage: { url: string; altText: string | null } | null;
};

type PublicProductDetail = PublicProductSummary & {
  sku: string | null;           // omitted entirely when null (§12.5)
  description: string | null;   // sanitized at storage (spec 04), escaped at render
  images: Array<{ url: string; altText: string | null }>;
  attributes: Array<{
    type: 'SIZE' | 'COLOUR' | 'AGE_GROUP' | 'OTHER';
    name: string;
    values: Array<{ id: string; value: string }>;
  }>;
  variants: Array<{
    id: string;
    attributeValueIds: string[];
    price: number;
    compareAtPrice: number | null;
    isOutOfStock: boolean;      // derived per variant
  }>;
  breadcrumbs: Array<{ name: string; slug: string }>;
};
```

Deliberately absent from both shapes: raw database primary keys for products and categories, `stock_quantity` as a number, `weight_grams`, `low_stock_threshold`, `created_by`, cost or margin data, and any Inactive product or variant. Per the `security` skill §8, exact stock counts are not published — only the derived boolean — so the storefront cannot be used to scrape inventory levels. Variant `id` **is** exposed because the cart and order APIs (specs 09, 11) must reference a specific variant; it is an opaque identifier that grants nothing on its own, and every order path revalidates it server-side.

### Routes

All public, no authentication, all with `rateLimit('publicCeiling')` (§11.3).

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/catalogue/categories` | Full active tree (bounded, small) |
| `GET` | `/api/catalogue/products` | Filter + sort + paginate |
| `GET` | `/api/catalogue/products/:slug` | Detail; resolves slug history |
| `GET` | `/api/catalogue/search` | Query + paginate |
| `GET` | `/api/catalogue/sitemap-feed` | Slugs + `updated_at` for `sitemap.ts` |

```ts
// GET /api/catalogue/products
type ProductListQuery = {
  category?: string;          // category slug; includes its subcategories
  attributeValue?: string[];  // filter by attribute value ids (size, colour, …)
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  featured?: boolean;
  sort?: 'newest' | 'price_asc' | 'price_desc';   // no 'rating' — no rating system exists
  page?: number;
  pageSize?: number;          // max 48
};
// -> ApiListSuccess<PublicProductSummary> plus available filter facets

// GET /api/catalogue/search
type SearchQuery = { q: string; page?: number; pageSize?: number };
```

### Visibility rules — enforced server-side in one place

A single `activeProductScope()` query fragment is applied by every public endpoint:

- `products.status = 'ACTIVE'`.
- The product's category and, where nested, its parent are `ACTIVE`.
- Only `product_variants.is_active = true` variants contribute price and stock.
- A product whose every variant is inactive is excluded entirely.

`isOutOfStock` products **are** still listed and still have a detail page — out-of-stock is "displayed where applicable" (§5.1), and §12.3 requires an out-of-stock product page showing Add to Wishlist + Chat on WhatsApp, which is only possible if the page exists. The `inStockOnly` filter lets the customer hide them. (The exclusion rule in §13.5 applies specifically to *automatic homepage carousel selection*, not to category browsing — spec 17 applies it there.)

`is_featured` alone never surfaces anything: the `featured=true` filter is `status = 'ACTIVE' AND is_featured = true`, matching §5.1's "only an Active, Featured product should ever be surfaced on the storefront."

### Slug resolution and redirects

`GET /api/catalogue/products/:slug`:

1. Look up a live `products.slug`. Found and active → return detail.
2. Not found → look up `product_slug_history.old_slug`. Found → return `301` semantics as a payload (`{ redirectTo: '<current-slug>' }`) with status `301` so the Next.js route can issue a real redirect.
3. Otherwise → `404 NOT_FOUND` with a generic message.

An `INACTIVE` product returns `404`, not `403` — the storefront must not confirm that a hidden product exists.

### Search behaviour

- `q` trimmed, 2–100 characters, rejected otherwise with `VALIDATION_ERROR`.
- Full-text match on `search_vector` unioned with trigram similarity on `name` for short or misspelled queries, ranked by `ts_rank` then similarity.
- Scoped by `activeProductScope()`.
- Always paginated (§11.4).
- The query string is echoed back to the client **escaped**, and the page renders it as text, never as HTML (§11.6, both layers treat input as untrusted).

### Caching

Public catalogue responses set `Cache-Control: public, max-age=60, stale-while-revalidate=300`. The Next.js pages use ISR with a 300-second revalidate, satisfying §13.15's "rendered server-side/statically with revalidation." No private data is ever in these responses, so shared caching is safe — which is itself a reason the projection above excludes everything internal.

## Frontend work

Storefront routes under `frontend/src/app/(storefront)/`.

### Shell

- **Mobile header (56px)**: hamburger | logo (≤28px) | cart icon with badge. Bottom tab navigation (56px, 5 tabs: Home, Categories, Search, Cart, Account), active state `#DC143C`. Hamburger drawer at 80% viewport width with categories, customer section, and help links. All per the `design` skill's Navigation section.
- **Track Order** appears in the header navigation (desktop), the mobile menu, and the footer, using exactly that label (§4.14.8, §4.14: "a single, clearly-labelled **Track Order** entry point, using the label 'Track Order'"). The route is `/track-order`, following the existing Next.js routing convention; the page itself arrives in spec 15, so until then the link is present in navigation but the route is added with the page.
- English-only chrome, no Bangla in UI text (`design` §2).

### Pages

**`/` (interim landing)** — categories grid plus a featured-products grid. Explicitly replaced by the CMS-driven homepage in spec 17; built minimally here so the site is navigable and the SEO/`Organization` schema has a home.

**`/c/[slug]` — category / product listing** (`design`: Product Listing Page)
- Header with search and a filter toggle ("Filters" + icon, indicating active filter count).
- Filter drawer: category, size, colour, price range, in-stock only. Sort dropdown: New, Price (Low to High), Price (High to Low) — **no "Rating"** option, since no rating system is specified by any PRD.
- Product grid: 2 columns mobile, 3 tablet, 4 desktop, 8px gap.
- Pagination or Load More; the underlying API is always paginated.
- States: loading (skeleton grid), empty ("No products found" plus a clear-filters action), error (message plus retry), success.

**`/p/[slug]` — product detail** (`design`: Product Detail Page)
- Back + cart header; swipeable full-width square gallery with indicator dots (no thumbnail row); name (20px bold); price block (strikethrough compare-at in 14px gray, current price 18px bold `#DC143C`, discount badge); stock status; size selector as 44×44px buttons (selected `#DC143C` on white text, unselected white with red border, unavailable combinations greyed and disabled); colour selector; quantity selector; primary action; wishlist action; collapsible description; related products (same category) using the same `<ProductCard />`.
- **Action row is stock-driven per §12.3**: in stock → `Buy Now` + WhatsApp slot; out of stock → `Add to Wishlist` + WhatsApp slot, with no Buy Now. The WhatsApp slot renders nothing until spec 19.
- Variant selection disables combinations with no active variant and shows per-variant out-of-stock state, derived from the API's per-variant flag — never computed from a client-side stock number, because none is sent.

**`/search`** — the query as a heading (escaped), the same `<ProductGrid />`, an empty state suggesting categories.

### `<ProductCard />` — built once, used everywhere (§13.9)

Props: image, name, price, compare-at price, discount indicator, Featured indicator, out-of-stock state, wishlist action, product link. Exactly the field list §13.9 specifies. Spec 09 (wishlist), 17 (homepage carousels), and any later listing import this component; reimplementing it per section is a spec violation.

Card spec: 1px `#E5E7EB` border, 8px radius, 12px padding, square image, name 14px/700 clamped to 2 lines, price 16px/700 `#DC143C`, out-of-stock overlay badge, full-width 44px action buttons.

### SEO implementation (`seo` skill, §1.1)

- **Metadata API only** — `generateMetadata` per route; no hand-rolled `<head>` and no legacy `<Head>` component anywhere.
- **Per-entity metadata** — product title/description from that product's own name and description, with a store-level fallback when a field is empty (never an empty or `undefined` title).
- **Canonical URL** on every indexable page, built from `SITE_URL` in `frontend/src/lib/site.ts` (the official origin `https://fabrillke.com`, overridable per-deployment via `NEXT_PUBLIC_SITE_URL`) + the canonical path. A product reachable from multiple category paths canonicalizes to the single `/p/[slug]` URL. This same canonical builder is exported for spec 19's WhatsApp link, so the two cannot drift (`seo` §4).
- **Brand identity** — titles use the `<Page> | Fabrillke` template and `og:site_name` is `Fabrillke`, both read from `frontend/src/lib/site.ts` (`01-overview.md` §1.0). No placeholder store name is ever rendered.
- **Open Graph** — `og:title`, `og:description`, `og:image` (the product's real primary image, JPEG fallback variant from spec 06, ≥1200×630 where the source allows), `og:type`, `og:url`; plus `twitter:card`.
- **JSON-LD**, generated server-side from the same data the page renders (never a second copy):
  - `Product` on `/p/[slug]` — name, image, description, `offers` with `priceCurrency: "BDT"`, `price`, and `availability` mapped from the derived stock flag.
  - `BreadcrumbList` on category and product pages, matching the visible breadcrumbs.
  - `Organization` + `WebSite` on `/` — `name: "Fabrillke"` and `url: "https://fabrillke.com"` from the shared site config (`01-overview.md` §1.0).
- **`app/sitemap.ts`** — built from `/api/catalogue/sitemap-feed`: all Active products and Active categories with `lastModified`. Excludes Inactive/draft content and every admin route. Out-of-stock products are **included**, because they remain live, purchasable-later pages with a real detail view; the `seo` skill's exclusion of "out-of-stock" content is applied to products that are Inactive, which is how the store actually hides items.
- **`app/robots.ts`** — allows storefront routes; disallows `/admin`, `/api`, and any preview path (§13.12's preview must not be crawlable); references the canonical sitemap URL on the configured domain (`https://fabrillke.com/sitemap.xml` in production).
- **Slug-change redirects** — the `/p/[slug]` route issues a real `301` to the current slug when the API reports a historical slug.
- **Rendering** — product and category pages are SSR/ISR; core indexable content (name, description, price, images) is in the initial HTML. Only interactive widgets hydrate on top (`seo` §7).

### Performance (`design` Performance targets, `seo` §8)

Next.js `Image` with correct `sizes`, `priority` on the first gallery image and `loading="lazy"` elsewhere, fixed aspect boxes to prevent layout shift, no autoplay media, no gradients/blur/shadow effects beyond the card's subtle border.

## Security requirements

- **Public endpoints return only the customer-safe projection** (`security` §8) — no internal primary keys for products/categories, no exact stock counts, no cost/margin fields, no `created_by`, and no Inactive entity. An added field must be deliberately added to the mapper, so leakage requires an explicit act rather than an oversight.
- **Hidden products are indistinguishable from nonexistent ones** — `404` for both, so the catalogue cannot be probed for unreleased items.
- **No authorization is implied by these endpoints.** They are intentionally unauthenticated (§2: browsing requires no account); no session is read and none is required (`frontend` §5).
- **Input validation** on every query parameter via `.strict()` zod schemas, with bounded `pageSize` (≤48), bounded `q` length, and numeric price bounds (§11.6, §11.4).
- **No raw SQL string concatenation** for search — the `q` value is bound as a parameter into `plainto_tsquery`/`similarity` (§11.6, `security` §6).
- **Stored product descriptions were sanitized at write time** (spec 04/05); the frontend additionally renders them as escaped/sanitized content, because §11.6 requires both layers to treat user input as untrusted.
- **The search term is escaped when echoed**, closing the reflected-XSS path on `/search`.
- **Public per-IP rate ceiling** applies to all of these routes (§11.3).
- **`robots.txt` disallows `/admin` and `/api`** (`seo` §3), and no admin route emits indexable metadata.
- No Supabase client, key, or credential in the storefront bundle (`frontend` §1, §4).

## Data integrity / idempotency

These are read-only endpoints, so the integrity concerns are consistency rather than duplication:

- **One visibility rule, one place.** `activeProductScope()` is the single definition of "visible on the storefront"; category listing, search, sitemap, and (later) homepage carousels all call it, so a product cannot be hidden in one surface and visible in another.
- **Out-of-stock is always derived** from `product_variants.stock_quantity` at query time (§5.1). No cached or denormalized stock flag exists to drift.
- **JSON-LD and visible content share one data source**, so structured data cannot claim a price or availability the page does not show (`seo` §6).
- **Sitemap and live visibility share one source** — the sitemap feed uses the same scope, so a hidden product cannot remain listed in `sitemap.xml` (`seo` general rules).
- **Slug history is unique across live and historical slugs**, so a redirect can never form a loop or shadow a live product.
- Cached responses carry no personalized data, so a shared cache cannot leak one customer's view to another.

## Acceptance criteria

1. `GET /api/catalogue/products` returns only `ACTIVE` products in `ACTIVE` categories, with a `pagination` block, and never more than 48 rows.
2. Setting a product to `INACTIVE` in the back-office removes it from the list endpoint, from search, from the sitemap feed, and makes `/p/[slug]` return `404` — not `403`.
3. `GET /api/catalogue/products/:slug` for a product whose variants are all out of stock returns `isOutOfStock: true` **and still returns the product**.
4. No response from any endpoint in this slice contains a `products.id`, `categories.id`, `stock_quantity`, `weight_grams`, or `created_by` value (asserted by scanning the serialized payload).
5. A product whose slug was changed: requesting the old slug returns `301` and the browser lands on the new URL with a `200`.
6. `GET /api/catalogue/search?q=panjabi` returns matching active products; `q=a` returns `400`; `q` of 200 characters returns `400`.
7. Searching for `<img src=x onerror=alert(1)>` renders the term as visible text on `/search` and executes nothing.
8. Two different product pages render different `<title>`, `<meta name="description">`, `og:title`, `og:image`, and `Product` JSON-LD — verified by fetching both HTML documents, not by the presence of a `generateMetadata` function.
9. The `Product` JSON-LD `offers.price` and `availability` match the price and stock state visible on the page.
10. Every indexable page emits exactly one `<link rel="canonical">` pointing at `SITE_URL` (`https://fabrillke.com` in production) + the canonical path.
11. `/sitemap.xml` lists every Active product and category and no Inactive one; all URLs use the configured canonical domain (`fabrillke.com` in production).
12. `/robots.txt` disallows `/admin` and `/api` and references the sitemap.
13. `curl` of `/p/[slug]` with JavaScript disabled shows the product name, description, price, and image in the initial HTML.
14. The product detail page for an in-stock product shows `Buy Now` and a WhatsApp slot; for an out-of-stock product it shows `Add to Wishlist` and the WhatsApp slot, with no `Buy Now` (§12.3).
15. Selecting a size with no active variant is not possible — the control is disabled.
16. The sort dropdown offers New / Price ascending / Price descending and **no Rating option**.
17. At 375px, the listing grid is 2 columns with no horizontal scroll; at 320px nothing overflows; at 768px it is 3 columns.
18. Lighthouse on `/p/[slug]` scores ≥ 80 on performance with images lazy-loaded below the fold and no layout shift from the gallery.
19. `grep -r "supabase\|SERVICE_ROLE" frontend/src` returns nothing.
20. The header, mobile menu, and footer each contain a link labelled exactly "Track Order".

## Tests required

Per the `test` skill §5 (standard coverage) plus the `seo` skill's "verify with real output" rule. The high-risk business rules touched here are visibility and derived stock.

1. **Visibility scope** (§5.1) — Inactive product, product in an Inactive category, and product with only inactive variants are each absent from list, search, detail, and sitemap. One test per case, since each is a separate way to leak an unpublished item.
2. **Hidden ≠ forbidden** — an Inactive product's detail endpoint returns `404`, never `403` or a differentiated message.
3. **Out-of-stock is derived and still browsable** (§5.1, §12.3) — a fully out-of-stock product is listed and has a detail page; its flag flips when stock is restored with no status write.
4. **Featured requires Active** (§5.1 note) — an Inactive+Featured product never appears in a `featured=true` query.
5. **Customer-safe projection** (`security` §8) — a snapshot test asserting the exact key set of `PublicProductSummary` and `PublicProductDetail`, so adding an internal field to the entity cannot silently leak it.
6. **Slug redirect** (`seo` §2) — old slug → `301` to the current slug; an unknown slug → `404`; history slug and live slug cannot collide.
7. **Search injection safety** (§11.6) — quotes, `%`, `--`, and tsquery operators in `q` are bound as parameters and return results or empty, never an error or an injected query.
8. **Reflected-XSS on search echo** (§11.6) — the term renders as text.
9. **Pagination bounds** (§11.4) — `pageSize=1000` is rejected; the default is applied when omitted.
10. **Per-entity metadata** (`seo` §1) — fetch two product pages and assert different titles, descriptions, OG images, and JSON-LD. The skill explicitly requires verifying real output rather than code presence.
11. **JSON-LD matches visible content** (`seo` §6) — price and availability in the structured data equal those rendered.
12. **Canonical correctness** (`seo` §4) — one canonical per page, on the configured domain, and a product reached via a category path still canonicalizes to `/p/[slug]`.
13. **Sitemap/robots correctness** (`seo` §3) — Inactive content excluded; `/admin` and `/api` disallowed.
14. **Public ceiling applies** (§11.3) — exceeding the per-IP limit on a catalogue route returns `429` (the limiter pair required by the `test` skill §4 for each matrix endpoint).
15. **`<ProductCard />` is shared** (§13.9) — a structural test asserting that the category page, search page, and related-products section all render the same component, so spec 17 inherits it rather than forking it.

## Open questions / assumptions

1. **URL structure.** No PRD specifies storefront paths beyond §1.1's "SEO-friendly URLs" and §4.14.8's `/track-order` example. *Assumption:* `/p/[slug]` for products and `/c/[slug]` for categories — short, stable, and keeping a product on one canonical path regardless of the category it was browsed from (`seo` §4). `/track-order` matches the PRD's own example.
2. **Sort by rating.** The `design` skill's listing page lists "Rating" as a sort option and shows a rating on the product card, but no PRD defines reviews or ratings anywhere. *Assumption:* omit both. **Flagged** as the same design-vs-PRD conflict raised in spec 05: CLAUDE.md §1 ranks requirement files above the design system.
3. **Out-of-stock products in the sitemap.** The `seo` skill says to exclude "out-of-stock, unpublished/draft, or admin-only content," while §5.1 treats out-of-stock as a transient derived display state of a live product and §12.3 requires the page to exist and offer WhatsApp contact. *Assumption:* exclude Inactive products (the real "unpublished" state) and include out-of-stock ones, since de-indexing a temporarily out-of-stock product and re-indexing it on restock would churn the index for a state that changes hourly. **Flagged as a genuine skill-vs-PRD tension**; if the client prefers strict adherence to the skill, the sitemap query adds `AND NOT isOutOfStock` and nothing else changes.
4. **Search language configuration.** No PRD specifies search behaviour beyond §2's "search and filter products." *Assumption:* Postgres full-text with the `simple` configuration plus trigram fallback, no external search service (which would be a new technology, barred by CLAUDE.md §2).
5. **Related products.** The `design` skill's product page includes a related-products row; no PRD defines the selection rule. *Assumption:* most recent Active products in the same category, excluding the current one — the narrowest reading that adds no new concept.
6. **`/` before the CMS homepage.** §13.1 requires the homepage to be rendered entirely from CMS content, which does not exist until spec 17. *Assumption:* an interim, non-CMS landing page here, explicitly replaced in spec 17. The alternative — leaving `/` broken until spec 17 — would leave the app in a non-working state, which the slicing rules forbid.
7. **Currency and formatting.** No PRD states a currency formatter, but the `design` skill fixes `৳ 1,500.00` with a comma thousands separator, and §6.5 fixes `BDT` as the currency code for analytics and JSON-LD. *Assumption:* one shared `formatBdt()` helper used by every price display and one `BDT` constant used by JSON-LD and (later) Meta events, so display and structured data cannot disagree.
