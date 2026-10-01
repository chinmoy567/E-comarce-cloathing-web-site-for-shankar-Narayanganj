# 17 — CMS-Driven Homepage and Campaign System

## Goal

After this slice the storefront homepage is rendered entirely from Admin/Manager-configured data rather than hard-coded page sections. Homepage Sections of six fixed types render in configurable order with server-evaluated scheduling; Campaigns provide schedulable themes that sections can be tagged with; product selection is either rule-based (automatic) or an explicitly ordered manual list; the Admin Homepage Builder allows create, edit, enable/disable, reorder, and authenticated preview of unpublished content; and the whole feature is gated by the existing CMS Management permission. Adding a category, a campaign, or a section requires no deployment.

## Requirement references

- `13-homepage-cms.md` §13.1 — the homepage is rendered entirely from Admin/Manager-configured content; the feature introduces no second product/category system, no second discount engine, no second auth/permission system, and no second analytics system; any future category must work without a frontend code change.
- `13-homepage-cms.md` §13.2 — the Homepage Section and Campaign entities and their relationship to existing catalogue entities.
- `13-homepage-cms.md` §13.3 — the six fixed `section_type` values and their product/category sources; `content_config` is `jsonb` validated **server-side against the schema for that `section_type`** on create/update — an invalid shape is rejected, not silently stored.
- `13-homepage-cms.md` §13.4 — the common field list, including `section_type` immutable after creation, `display_order`, `status`, CTA fields, independent desktop/mobile images, section-level scheduling, `campaign_id`, and audit fields; a section with no title/subtitle/CTA renders without that element.
- `13-homepage-cms.md` §13.5 — automatic selection rules `LATEST`, `FEATURED`, `CATEGORY`, `ON_SALE`; `limit`, optional `category_id`, sort order; only `Active` products are eligible; **Inactive and out-of-stock products are excluded from automatic lists**, while manually selected out-of-stock products may still render with a badge.
- `13-homepage-cms.md` §13.6 — manual selection through an ordered join table; manual selection may include any product regardless of `Featured`, but the storefront still respects `Active`/`Inactive`; a section uses exactly one mode.
- `13-homepage-cms.md` §13.6a — campaigns may reference products and categories through the same join-table pattern scoped to `campaign_id`.
- `13-homepage-cms.md` §13.7 — the Campaign field list; stored status values are Admin-set, with computed labels added at read time.
- `13-homepage-cms.md` §13.7a — **server-evaluated scheduling only**; visibility is a computed condition at request time, never a background job; `DISABLED` overrides the schedule; `DRAFT` is never visible; the `SCHEDULED`/`EXPIRED` derivation, identical for Campaign and Section.
- `13-homepage-cms.md` §13.8 — the rendering rule: the API returns `ACTIVE`, in-schedule sections sorted by `display_order`; the frontend never uses a template naming specific sections; **an empty `PRODUCT_CAROUSEL` is omitted entirely rather than rendered as an empty block**.
- `13-homepage-cms.md` §13.9 — one reusable component per `section_type`; no components named after a category or campaign; a single shared `<ProductCard />` used everywhere products are listed.
- `13-homepage-cms.md` §13.10 — the status vocabulary and which values are stored versus computed.
- `13-homepage-cms.md` §13.11 — imagery uses the **existing** Supabase Storage mechanism; desktop and mobile configured independently; fall back to whichever is supplied.
- `13-homepage-cms.md` §13.12 — the Homepage Builder; **reordering updates `display_order` for the affected sections in a single request**, not one per row; the Campaigns list; **Preview must be a separate authenticated call and must never expose DRAFT/SCHEDULED/DISABLED content to unauthenticated storefront requests**.
- `13-homepage-cms.md` §13.13 — `content_config`/`visual_theme` validated against a fixed per-type schema; free-form HTML/script injection rejected; rich text sanitized server-side before storage; `cta_url` accepts only relative storefront paths, the store's own domain, or safe `https://` URLs, validated server-side; every mutating endpoint enforces CMS Management in the backend.
- `13-homepage-cms.md` §13.14 — gated by the **existing** `cms.manage` permission; no new permission key.
- `13-homepage-cms.md` §13.15 — Metadata API, campaign-overridable homepage metadata, server-side/static rendering with revalidation, **a single homepage API request returning all sections with resolved product/category data**, Next.js Image optimization and lazy loading.
- `13-homepage-cms.md` §13.16 — existing analytics events only; no new event taxonomy; the homepage does not fire a competing content-view event.
- `13-homepage-cms.md` §13.17 — explicit v1 exclusions.
- `05-admin-operations.md` §5.8 — CMS functionality under the back-office; CMS permissions via RBAC.
- `06-rbac.md` §5.18 — `CMS Management`: Yes for Admin, Assigned for Manager.
- Skills: `frontend` §7, `seo` §1, `security` §6, `design`, `test` §5.

## Depends on

- **01** — API conventions, validation, errors.
- **02** — `audit_logs`, `withTransaction`.
- **03** — `requireAuth('admin')`, `requirePermission('cms.manage')`.
- **04** — `sanitizeHtml`, `urlValidation`, limiters.
- **05** — `products`, `categories`, `Featured`, `Active`/`Inactive`.
- **06** — the Supabase Storage pipeline (§13.11's "existing mechanism").
- **07** — `<ProductCard />`, `PublicProductSummary`, `activeProductScope()`, the storefront shell, and the interim `/` this slice replaces.
- **10** — coupons, referenced (not recomputed) by `PROMO_BANNER` sections.

## Scope

**In scope**

- `homepage_sections`, `campaigns`, and the four join tables.
- Per-`section_type` `content_config` schemas and server-side validation.
- Server-evaluated scheduling and the computed status labels.
- Automatic and manual product resolution.
- The single public homepage endpoint returning fully resolved sections.
- Admin CRUD, single-request reordering, and authenticated preview.
- The six section components and the CMS-driven `/` page, replacing spec 07's interim landing page.
- Campaign-overridable homepage metadata.

**Out of scope / deferred**

- Everything in §13.17: a free-layout page builder, personalized or segmented content, A/B testing, multi-language content, and any second discount engine.
- CMS for pages other than the homepage — §13.1 scopes this to the homepage specifically.
- Analytics event firing — spec **18**; §13.16 confirms no new events are introduced.

## Database changes

Migration file: `backend/migrations/0017_homepage_cms.sql`

### Enums

```sql
CREATE TYPE section_type AS ENUM
  ('HERO','CATEGORY_GRID','PRODUCT_CAROUSEL','CAMPAIGN_BANNER','PROMO_BANNER','CUSTOM_CONTENT');
CREATE TYPE cms_status AS ENUM ('DRAFT','ACTIVE','DISABLED');
```

`cms_status` has exactly three values. **`SCHEDULED` and `EXPIRED` are absent by design** — §13.7a and §13.10 both state they are computed labels derived at read time, "not values the Admin picks from a dropdown."

### `campaigns` (§13.7)

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `name` | `text` | NOT NULL | — | |
| `slug` | `text` | NOT NULL | — | `UNIQUE` |
| `description` | `text` | NULL | — | |
| `starts_at` / `ends_at` | `timestamptz` | NULL | — | Server-evaluated (§13.7a) |
| `status` | `cms_status` | NOT NULL | `'ACTIVE'` | §13.7a: "`ACTIVE` is the stored default a Campaign is created with" |
| `hero_content` | `jsonb` | NULL | — | Optional override for a linked `HERO` (§13.7) |
| `visual_theme` | `jsonb` | NULL | — | Lightweight presentation data only (§13.13) |
| `created_by` / `updated_by` | `uuid` | NULL | — | |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- `CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)`.

### `homepage_sections` (§13.4)

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `section_type` | `section_type` | NOT NULL | — | **Immutable after creation** (§13.4) |
| `title` / `subtitle` | `text` | NULL | — | Optional (§13.4) |
| `display_order` | `integer` | NOT NULL | — | Ascending render order (§13.8) |
| `status` | `cms_status` | NOT NULL | `'DRAFT'` | §13.10 |
| `cta_label` / `cta_url` | `text` | NULL | — | §13.4; URL validated (§13.13) |
| `secondary_cta_label` / `secondary_cta_url` | `text` | NULL | — | Hero only (§13.4) |
| `desktop_image_url` / `mobile_image_url` | `text` | NULL | — | Independent (§13.11) |
| `starts_at` / `ends_at` | `timestamptz` | NULL | — | Section-level scheduling, independent of any campaign (§13.4) |
| `campaign_id` | `uuid` | NULL | — | FK → `campaigns(id)` ON DELETE SET NULL (§13.4) |
| `content_config` | `jsonb` | NOT NULL | `'{}'` | Type-specific, schema-validated (§13.3) |
| `created_by` / `updated_by` | `uuid` | NULL | — | |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL | `now()` | |

- Index `(status, display_order)`.
- `CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)`.
- Immutability of `section_type` is enforced in the service (the update schema has no such field) and by a trigger rejecting a change, since §13.4 states it outright.

### Join tables (§13.6, §13.6a)

`homepage_section_products` (`section_id`, `product_id`, `display_order`; PK on the first two), `homepage_section_categories` (`section_id`, `category_id`, `display_order`), `campaign_products` (`campaign_id`, `product_id`, `display_order`), `campaign_categories` (`campaign_id`, `category_id`, `display_order`). All reference the existing catalogue tables by id; **no product or category data is duplicated** (§13.1, §13.6a).

## Backend work

### `content_config` schemas (§13.3, §13.13)

One zod schema per `section_type`, selected by the section's type and applied on every create and update. An invalid shape is **rejected**, never stored (§13.3).

| `section_type` | `content_config` shape |
| --- | --- |
| `HERO` | `{ overlayPosition?: 'left'\|'center'\|'right' }` — images and CTAs are common fields |
| `CATEGORY_GRID` | `{ mode: 'ALL_ACTIVE_TOP_LEVEL' \| 'MANUAL'; columns?: 2\|3\|4 }` |
| `PRODUCT_CAROUSEL` | `{ mode: 'AUTOMATIC'; rule: 'LATEST'\|'FEATURED'\|'CATEGORY'\|'ON_SALE'; limit: 1–24; categoryId?: uuid; sort?: 'newest' }` **or** `{ mode: 'MANUAL'; sort: 'manually_selected' }` |
| `CAMPAIGN_BANNER` | `{}` — content comes from the linked `campaign_id` |
| `PROMO_BANNER` | `{ linkType?: 'CATEGORY'\|'COUPON'\|'URL'; categoryId?: uuid; couponCode?: string }` |
| `CUSTOM_CONTENT` | `{ body: string }` — sanitized server-side before storage (§13.13) |

A `CAMPAIGN_BANNER` without a `campaign_id` is rejected. A `PRODUCT_CAROUSEL` in `AUTOMATIC` mode with `rule: 'CATEGORY'` requires `categoryId`. `PROMO_BANNER`'s `couponCode` is a **reference only** — the section never stores or computes a discount (§13.1, §13.17: no second discount engine).

### Server-evaluated scheduling (§13.7a)

One shared function, used identically for sections and campaigns:

```ts
computeVisibility(entity, now): {
  visible: boolean;
  displayStatus: 'DRAFT' | 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'DISABLED';
}
```

```text
status === 'DRAFT'                         → { visible: false, displayStatus: 'DRAFT' }
status === 'DISABLED'                      → { visible: false, displayStatus: 'DISABLED' }   // overrides the schedule
status === 'ACTIVE' && starts_at > now     → { visible: false, displayStatus: 'SCHEDULED' }
status === 'ACTIVE' && ends_at   < now     → { visible: false, displayStatus: 'EXPIRED' }
otherwise                                  → { visible: true,  displayStatus: 'ACTIVE' }
```

`now` is always the Express clock — the browser's is never consulted (§13.7a). No background job flips a stored value; visibility is recomputed per request, exactly as §8.5 does for coupons.

A section with a `campaign_id` is visible only when **both** it and its campaign are visible, since §13.7a gives each its own independent schedule and a section belonging to an ended campaign should not outlive it.

### Product resolution (§13.5, §13.6)

**Automatic mode** — all rules run through spec 07's `activeProductScope()`, so "visible on the storefront" has one definition:

| Rule | Query |
| --- | --- |
| `LATEST` | Active products ordered by `created_at DESC`, optionally filtered by category |
| `FEATURED` | Active products with `is_featured = true` |
| `CATEGORY` | Active products in the category **and its subcategories** |
| `ON_SALE` | Active products currently discount-eligible per §8 |

§13.5 additionally excludes **out-of-stock** products from automatic lists — a narrower rule than spec 07's category browsing, which keeps them visible. Both are correct in their own context, and the difference is deliberate: a promotional carousel should not advertise what cannot be bought, while a category page should still show the item with an out-of-stock badge.

**Manual mode** — the join table's order, filtered to `Active` products only. §13.6: "an `Inactive` product manually added to a section is not rendered until it becomes `Active` again, so the Admin does not need to remember to remove it." Out-of-stock manually selected products **do** render, with the badge (§13.5's parenthetical).

**Empty carousels are omitted** (§13.8) — a `PRODUCT_CAROUSEL` resolving to zero products is dropped from the response entirely, evaluated at request time like the schedule check.

### `ON_SALE` resolution

§13.5 defines it as "Active products currently discount-eligible per Section 8." Read strictly against §8 alone the rule is unimplementable in v1, so it resolves through **two** sources — the union of them, deduplicated:

```sql
-- A: a visible price reduction already modelled in the catalogue
compare_at_price IS NOT NULL AND compare_at_price > base_price

-- B: covered by a product- or category-restricted ACTIVE, in-schedule coupon
--    (returns nothing until §8.12 enforcement ships; no code change needed then)
```

**Why A is included, and why it is not a second discount engine.** §13.17 forbids a second discount *engine* — a second thing that computes money. `compare_at_price` computes nothing: spec 05 fixes it as presentational, guarded by `CHECK (compare_at_price IS NULL OR compare_at_price >= base_price)`, and §13.9 already requires the ProductCard to render it as the strikethrough "discount indicator." A product showing a struck-through original price **is** the site's own visible statement that it is on sale. Selecting those products for an `ON_SALE` carousel is a *display* query over a *display* field — it never enters the §8.14 calculation chain, never affects an order total, and leaves `base_price`/`variants.price` as the sole money source.

**Why B alone was rejected.** Source B is the literal §8 reading, but the §8.12 deferral means it matches nothing in v1, which would ship a selectable homepage rule that silently renders an empty carousel — a latent defect an operator would report as a bug. Including B keeps the literal reading live so the rule widens automatically once §8.12 is later enforced.

**Why an `ALL_PRODUCTS` coupon is excluded from B.** With a storewide coupon active, every product would qualify and the rule would degenerate to "all products," duplicating `LATEST`. Only product- or category-restricted coupons count.

Ordinary `LATEST`/`FEATURED` eligibility still applies: Active only, out-of-stock excluded (§13.5).

### Public endpoint (§13.15)

`GET /api/homepage` — public, `rateLimit('publicCeiling')`, returning **all** visible sections with their resolved product and category data in **one** request (§13.15: "a single request returning all active sections with their resolved product/category data (server-side joins), not N sequential client-side requests per section").

```ts
type HomepageResponse = {
  sections: Array<{
    id: string;
    sectionType: SectionType;
    title: string | null;
    subtitle: string | null;
    ctaLabel: string | null; ctaUrl: string | null;
    secondaryCtaLabel: string | null; secondaryCtaUrl: string | null;
    desktopImageUrl: string | null; mobileImageUrl: string | null;
    campaign: { name: string; slug: string; visualTheme: unknown | null;
                heroContent: unknown | null } | null;
    contentConfig: unknown;
    products?: PublicProductSummary[];                       // spec 07's shared shape
    categories?: Array<{ name: string; slug: string; imageUrl: string | null }>;
  }>;
  metadata: { title: string | null; description: string | null;
              ogImageUrl: string | null } | null;            // campaign override (§13.15)
};
```

Products use spec 07's `PublicProductSummary` — the same customer-safe projection, so no internal field can leak through a CMS surface that spec 07 already excludes elsewhere.

Cached `public, max-age=60, stale-while-revalidate=300`; the Next.js page uses ISR (§13.15).

### Preview (§13.12)

`GET /api/admin/homepage/preview` — `requireAuth('admin')` + `requirePermission('cms.manage')`, returning sections including `DRAFT`, `SCHEDULED`, and `DISABLED` ones, each annotated with its `displayStatus`.

§13.12 requires this be "a separate, authenticated API call/flag, never a public homepage response that happens to include unpublished content." It is therefore a **different route**, not a query parameter on the public endpoint — a flag on the public route would be one missing check away from publishing drafts.

### Admin routes

All `requireAuth('admin')` + `requirePermission('cms.manage')` + `rateLimit('authenticatedCeiling')`. §13.14 is explicit that the existing `cms.manage` key covers section/campaign create, update, delete, reorder, publish, and preview — **no new permission key is added**.

| Method | Path |
| --- | --- |
| `GET` / `POST` | `/api/admin/homepage/sections` |
| `GET` / `PATCH` / `DELETE` | `/api/admin/homepage/sections/:id` |
| `POST` | `/api/admin/homepage/sections/reorder` |
| `PUT` | `/api/admin/homepage/sections/:id/products` |
| `PUT` | `/api/admin/homepage/sections/:id/categories` |
| `GET` / `POST` | `/api/admin/campaigns` |
| `GET` / `PATCH` / `DELETE` | `/api/admin/campaigns/:id` |
| `PUT` | `/api/admin/campaigns/:id/products` |
| `PUT` | `/api/admin/campaigns/:id/categories` |
| `GET` | `/api/admin/homepage/preview` |

**Reorder** takes the full ordered list and applies it in **one transaction** (§13.12: "in a single request, not one request per row, to avoid an inconsistent intermediate order if the request is interrupted partway"):

```ts
type ReorderSectionsRequest = { sectionIds: string[] };   // the complete set, in order
```

A list that does not exactly match the existing section set is rejected, so a stale client cannot silently drop a section.

**Product/category attachment** uses `PUT` with the full ordered list, for the same atomicity reason.

### Validation and sanitization (§13.13)

- `content_config` and `visual_theme` validated against their fixed per-type schemas; unknown keys rejected by `.strict()`.
- `CUSTOM_CONTENT.body` and any rich text passed through `sanitizeHtml` (spec 04) **before storage**; the frontend additionally escapes at render.
- `cta_url`/`secondary_cta_url` validated by `urlValidation` (spec 04): a relative storefront path, the store's own domain, or an `https://` URL on an allowed host. `javascript:`, `data:`, and plain `http://` are rejected server-side, not merely trimmed for display.
- `visual_theme` accepts only a constrained shape — an accent colour from a bounded set and a banner-treatment enum. §13.13 says it is "never arbitrary CSS/script injection," so no free-form CSS string is accepted.

### Error cases

| Case | Status | `code` |
| --- | --- | --- |
| `content_config` invalid for the type | 400 | `VALIDATION_ERROR` |
| `section_type` change attempted | 400 | `SECTION_TYPE_IMMUTABLE` |
| `CAMPAIGN_BANNER` without a campaign | 400 | `VALIDATION_ERROR` |
| Unsafe `cta_url` | 400 | `INVALID_URL` |
| Reorder list incomplete or containing unknown ids | 400 | `VALIDATION_ERROR` |
| Missing `cms.manage` | 403 | `FORBIDDEN` |
| Section/campaign not found | 404 | `NOT_FOUND` |

### Contract additions (decided — resolve the frontend gaps)

**Image upload** (the pipeline §13.11 names, previously without a route). `POST /api/admin/homepage/images?kind=section-desktop|section-mobile|campaign-hero` — `cms.manage`, `authenticatedCeiling`, 5 MB multipart, runs spec 06's content-sniffed, re-encoded validator, stores in the public bucket under `cms/`, returns `{ url: string }` (absolute `https://` Supabase public URL). Failures use spec 06's error codes.

**Typed theme/hero shapes** (replace `unknown`, validated `.strict()` server-side):

```ts
type CampaignHeroContent = { title?: string /*≤120*/; subtitle?: string /*≤200*/;
                             ctaLabel?: string; ctaUrl?: string /*urlValidation*/;
                             desktopImageUrl?: string; mobileImageUrl?: string };
type CampaignVisualTheme = { accent?: 'PRIMARY' | 'DARK' | 'ACCENT'; treatment?: 'PLAIN' | 'BORDERED' };
// accent maps to the documented palette tokens (#DC143C / #1F2937 / #059669) in the frontend; no raw colours or CSS are accepted.
```

**CMS lookups** (so a `cms.manage`-only Manager can use the pickers without `product.update`/`category.manage`): `GET /api/admin/cms/lookups/products?q=&page=&pageSize=` → `{ id, name, slug, imageUrl, isActive }`; `GET /api/admin/cms/lookups/categories` → `{ id, name, slug, parentId }`. Both `cms.manage`, paginated, minimal projection.

**Attachment reads**: `GET /api/admin/homepage/sections/:id/products|categories` and `GET /api/admin/campaigns/:id/products|categories` return the current ordered list in the lookup shape above.

**Section limit**: at most 100 sections; creating a 101st returns `409 SECTION_LIMIT_REACHED`. `GET /api/admin/homepage/sections` therefore always returns the complete set in one page (`pageSize` ≤ 100), which makes the full-set reorder request always buildable.

**Campaign admin items** gain `sections: Array<{ id: string; title: string | null }>` (referencing sections), and `displayStatus`.

**Metadata**: `metadata.ogImageUrl` is always an absolute `https://` URL or `null`.

**`CUSTOM_CONTENT.body`** is sanitized HTML from a fixed allowlist (`p, br, strong, em, ul, ol, li, h2, h3, a` with relative or `https://` `href` only), enforced by `sanitizeHtml` before storage.

**Route names** (shared decision, also recorded in `00-index.md`): product detail `/product/[slug]`, category listing `/category/[slug]`, catalogue index `/products`, search `/search`.

## Frontend work

### Components (§13.9)

Exactly one per `section_type`, none named after a category or campaign:

```text
<HeroSection /> <CategoryGrid /> <ProductCarousel />
<CampaignBanner /> <PromoBanner /> <CustomContentBlock />
```

`<ProductCarousel />` and `<CategoryGrid />` receive data as props. `<ProductCarousel />` renders spec 07's `<ProductCard />` — §13.9 requires the card be "shared by `<ProductCarousel />` and every other place products are listed… not reimplemented per section," so it is imported, not duplicated.

Components like `<MenCategory />`, `<ElectronicsCategory />`, or `<EidBanner />` **must not exist** — §13.9 states creating them would require a frontend change every time the Admin adds a category or campaign, violating §13.1.

### The homepage (§13.8, §13.15)

`/` fetches `GET /api/homepage` server-side and maps over `sections` in order, dispatching on `sectionType`. There is no template naming specific sections; adding, removing, disabling, or reordering sections is reflected on the next request with no deployment (§13.8).

- A section with no title/subtitle/CTA renders without those elements — no empty headings, no broken buttons (§13.4).
- Images: `mobile_image_url` below `md`, `desktop_image_url` above, each falling back to the other when only one is supplied (§13.11). Rendered through `next/image` with `priority` on the first hero and lazy loading below the fold (§13.15).
- Metadata via the Metadata API, overridden by the active campaign's `hero_content` when configured, falling back to store defaults (§13.15, `seo` §1).
- ISR with revalidation so crawlers see fully rendered section content (§13.15).
- No client-side clock decides visibility (§13.7a, `frontend` §7).
- No new analytics events; clicking into a product fires `ViewContent` on the product page as usual, and the homepage fires no competing content-view event (§13.16).

### Admin Homepage Builder (§13.12)

`/admin/content/homepage` — an ordered list of sections with name, computed status label, and Edit / Disable-Enable / Move controls, matching §13.12's sketch:

```text
1. Hero Banner          Status: Active     [Edit] [Disable] [Move]
4. Eid Collection       Status: Scheduled  [Edit] [Disable] [Move]
6. Special Offers       Status: Disabled   [Edit] [Enable]  [Move]
```

- Move Up/Down controls (44×44px) issuing **one** reorder request for the whole list — §13.12 accepts this as an equivalent to drag-and-drop "where it fits the existing admin UI without added complexity."
- The section editor shows only the fields relevant to the chosen type, with `section_type` fixed after creation.
- Image upload through spec 06's pipeline, desktop and mobile separately (§13.11).
- **Preview** opens the authenticated preview route, rendering the homepage as it will appear once published, visible only to the requesting session (§13.12).
- `/admin/content/campaigns` — the campaigns list with computed status and which sections reference each campaign (§13.12).
- The entire Content section is hidden from a Manager without `cms.manage` and still handles a backend 403 (`frontend` §3, §13.14).

### Frontend build detail

The bullets above stay as the behavioural summary; most of the customer-side components already exist under `frontend/src/components/homepage/`. This section pins each one's contract and the admin builder's full surface, using only the endpoints and response fields defined in **Backend work** above. Dependencies on other specs' endpoints are named as such; anything missing is under **Backend gaps**.

#### Pages and access

| Route | Who | Backend 403 / failure |
| --- | --- | --- |
| `/` (`app/page.tsx`) | **Public.** Server-rendered, ISR `revalidate = 60`. | No 403. If `GET /api/homepage` fails or returns no sections the page degrades (see States) — it never throws. |
| `/admin/content/homepage` | `cms.manage` | Whole-page "You do not have access to the Homepage Builder." for a `403` on the list; a `403` on any mutation shows an inline `role="alert"` and leaves the list as it was. |
| `/admin/content/homepage/new`, `/admin/content/homepage/[id]` | `cms.manage` | Same. |
| `/admin/content/homepage/preview` | `cms.manage` | `401` → admin shell redirects to login; `403` → page-level access message. The route is only ever reached from the builder. |
| `/admin/content/campaigns`, `/new`, `/[id]` | `cms.manage` | Same as the builder. |

The Homepage and Campaigns entries in `lib/admin/nav.ts` already carry `requires: 'cms.manage'`; the entire Content area is hidden without it (UX only — §13.14's backend check is the control). Admin routes are not indexable; the preview must never be crawlable (`app/robots.ts` disallows `/admin`, §13.12).

#### Customer homepage components

Entry: `app/page.tsx` calls `fetchHomepage()` (`lib/homepage.ts`), then `generateMetadata()` and the body both read that one response (the single request of §13.15). The body maps `sections` in the order given and dispatches in **one** place, `components/homepage/HomepageSection.tsx`, on `sectionType`; it holds no list of known sections.

All six components take `{ section: HomepageSectionResponse; priority?: boolean }` (`lib/publicTypes.ts`; `priority` is true only for the first section so only the first image is eager).

| Component | `sectionType` | Fields used | Behaviour |
| --- | --- | --- | --- |
| `HeroSection.tsx` | `HERO` | `title`, `subtitle`, `ctaLabel/ctaUrl`, `secondaryCtaLabel/secondaryCtaUrl`, `mobileImageUrl`, `desktopImageUrl`, `contentConfig.overlayPosition` (`left`/`center`/`right`) | `mobileImageUrl` below `md`, `desktopImageUrl` from `md`, each falling back to the other (§13.11). Text sits below the image on mobile and over it from `md` in a solid panel positioned by `overlayPosition` (no gradient scrim). Missing title/subtitle/CTA → that element is not rendered (no empty heading or button, §13.4). A CTA renders only if **both** label and URL exist. |
| `CategoryGrid.tsx` | `CATEGORY_GRID` | `title`, `subtitle`, `categories[].name/slug/imageUrl`, `contentConfig.columns` (2/3/4) | Grid, 2 columns on mobile and `columns` (default 4) from `lg`. Each tile is one link with the category name as its text; image `alt=""` when the name is adjacent, otherwise the name. No categories → renders nothing. |
| `ProductCarousel.tsx` | `PRODUCT_CAROUSEL` | `title`, `subtitle`, `ctaLabel/ctaUrl`, `products[]` | Renders spec 07's `<ProductCard />` per product (never reimplemented, §13.9). Product grid per the `design` skill (2 columns mobile, 3 tablet, 4–5 desktop). **No JS carousel, arrows or autoplay** — "carousel" is the §13.9 component name, the layout is the design skill's grid; a horizontal scroll row is not introduced. Out-of-stock manual products render with `ProductCard`'s existing badge. Empty `products` → renders nothing (defence in depth; the backend already omits it, §13.8). |
| `CampaignBanner.tsx` | `CAMPAIGN_BANNER` | `campaign.name`, `title`, `subtitle`, `ctaLabel/ctaUrl`, images | Full-width banner linking to the CTA; campaign `visualTheme`/`heroContent` are applied only once their shape is defined (gap 2). |
| `PromoBanner.tsx` | `PROMO_BANNER` | `title`, `subtitle`, `ctaUrl`, images, `contentConfig.linkType/couponCode` | One link target: `ctaUrl`. If `contentConfig.couponCode` is set it is shown as plain text "Use code {code}" — a reference only, never a computed saving (§13.1, §13.17). |
| `CustomContentBlock.tsx` | `CUSTOM_CONTENT` | `title`, `contentConfig.body` | Renders the already-sanitized `body` (see conflicts: spec text says "escape at render"). Missing body → nothing. |

Shared rules:

- **One `<h1>`.** The first `HERO`'s title is the page `<h1>`; every other section title is an `<h2>`. If there is no hero title, render a visually hidden `<h1>` containing `SITE_NAME` from `lib/site.ts` so the page always has exactly one.
- **Links.** A `ctaUrl` beginning with `/` uses `next/link`. A URL beginning with `https://` uses a plain `<a rel="noopener noreferrer">`. Anything else is not rendered as a link (defence in depth — the backend already rejects `javascript:`, `data:` and `http://`).
- **Images** use `next/image` with a `sizes` attribute (the existing `fill` images omit it, which defeats responsive loading), `priority` only on the first section, lazy below the fold; `alt` is the section title or `""` when decorative.
- **No component named after a category or campaign** exists or may be added (§13.9).
- Visibility is never decided in the browser: no `Date.now()`/`new Date()` comparison against `startsAt`/`endsAt` anywhere in these components (§13.7a).
- Metadata: `generateMetadata` uses `metadata.title`, `metadata.description`, `metadata.ogImageUrl`, falling back to `SITE_DESCRIPTION`/`SITE_OG_IMAGE_PATH` (`lib/site.ts`), canonical `absoluteUrl('/')`, title via `pageTitle()`.

#### Customer homepage states

| State | Behaviour |
| --- | --- |
| Loading | None — server rendered; the route has no client spinner. A `loading.tsx` is not added (it would flash over ISR content). |
| Success | Sections in server order, each independently skippable (a section whose own data is empty renders nothing, the rest are unaffected). |
| Empty (`sections: []`) | The existing fallback (latest products via `fetchProducts`) stays as a safety net so the storefront is never blank before anything is published, or when the API is unreachable. It is **not** CMS-managed content and must not grow. |
| Error | `fetchHomepage()` already swallows a failed request into the empty state, so a transient API outage shows the fallback and ISR retries on the next request; no error banner is shown to customers. |
| Disabled / double-click | Not applicable (no mutations); CTA links are plain anchors. |

Accessibility and responsive: sections stack in one column on mobile with `gap-2xl`; all CTA links are 48px tall full-width on mobile and auto-width from `sm`; hero text meets 4.5:1 on its solid panel; focus rings visible; no autoplay, no motion.

Analytics: the homepage fires **only** the root `PageView` (spec 18). No `ViewContent`, no section-impression or banner-click event, no `TrackEvent` on the page (§13.16, spec 18 acceptance 19).

#### Admin Homepage Builder

##### Components

| Component | File | Props | Reuses |
| --- | --- | --- | --- |
| Builder list page | `app/admin/(shell)/content/homepage/page.tsx` (exists) | — | `apiList`, `apiPost`, `apiPatch`, `apiDelete`, `Button` |
| `SectionRow` | `components/admin/homepage/SectionRow.tsx` (extract from the page) | `section: HomepageSectionAdminResponse`, `index`, `count`, `busy`, `onMove(dir)`, `onToggle()`, `onDelete()` | `Button` |
| `DisplayStatusBadge` | `components/admin/homepage/DisplayStatusBadge.tsx` (extract) | `status: 'DRAFT' \| 'ACTIVE' \| 'SCHEDULED' \| 'EXPIRED' \| 'DISABLED'` | `StatusBadge` |
| Section editor | `components/admin/HomepageSectionForm.tsx` (exists) | `sectionType`, `initial`, `onSubmit`, `submitLabel` | `FormField`, `SelectField`, `ToggleField`, `TextareaField`, `ImageUploadField` |
| `ProductAttachmentEditor` | `components/admin/homepage/ProductAttachmentEditor.tsx` (new) | `target: { kind: 'section' \| 'campaign'; id: string }`, `initialProductIds: string[]` | `Button` |
| `CategoryAttachmentEditor` | `components/admin/homepage/CategoryAttachmentEditor.tsx` (new) | same as above | `Button` |
| `CampaignSelect` | `components/admin/homepage/CampaignSelect.tsx` (new) | `value`, `onChange`, `required` | `SelectField` |
| Campaign form | `components/admin/CampaignForm.tsx` (exists) | | |
| Preview page | `app/admin/(shell)/content/homepage/preview/page.tsx` (exists) | — | `HomepageSection` (the **same** customer renderers) |

##### Data: endpoint → fields

| Screen / action | Endpoint | Fields |
| --- | --- | --- |
| Builder list | `GET /api/admin/homepage/sections` | per row: `id`, `sectionType`, `title`, `displayOrder`, `status`, `displayStatus`, (and `campaign` association if returned — gap 8) |
| Enable / Disable / Publish | `PATCH /api/admin/homepage/sections/:id` `{ status }` | `status` ∈ `DRAFT`/`ACTIVE`/`DISABLED` |
| Reorder | `POST /api/admin/homepage/sections/reorder` `{ sectionIds }` | the complete ordered id list in **one** request |
| Delete | `DELETE /api/admin/homepage/sections/:id` | — |
| Section create / edit | `POST` / `PATCH /api/admin/homepage/sections[/:id]` | the fields in **Database changes → `homepage_sections`**, with `contentConfig` per the shapes table; `sectionType` only on create |
| Attach products / categories | `PUT /api/admin/homepage/sections/:id/products` / `…/categories` | full ordered id list (atomic) |
| Campaigns list | `GET /api/admin/campaigns` | `name`, `slug`, `startsAt`, `endsAt`, `status`, computed `displayStatus`, referencing sections (gap 8) |
| Campaign create / edit / delete | `POST` / `PATCH` / `DELETE /api/admin/campaigns[/:id]`; `PUT …/products`, `…/categories` | campaign columns incl. `heroContent`, `visualTheme` (gap 2) |
| Preview | `GET /api/admin/homepage/preview` | sections as the public shape plus `displayStatus` each; optional `metadata` |

Each row's controls are: **Edit**, a status action — **Publish** (stored `DRAFT` → `ACTIVE`), **Disable** (`ACTIVE` → `DISABLED`), **Enable** (`DISABLED` → `ACTIVE`) — **Move up**, **Move down**, and **Delete**. The existing page labels a `DRAFT` section "Disable"; it must read "Publish". The displayed status is the backend's `displayStatus` rendered as text plus a tone (`ACTIVE`, `SCHEDULED`, `EXPIRED`, `DRAFT`, `DISABLED`); the frontend never computes `SCHEDULED`/`EXPIRED` from `startsAt`/`endsAt`.

##### Section editor

Shows only the fields for the section's type (matching the `contentConfig` table): `HERO` → overlay position; `CATEGORY_GRID` → mode (`ALL_ACTIVE_TOP_LEVEL`/`MANUAL`) and columns, plus the category picker when `MANUAL`; `PRODUCT_CAROUSEL` → mode, then for `AUTOMATIC` the rule (`LATEST`/`FEATURED`/`CATEGORY`/`ON_SALE`), limit 1–24, and a category select when the rule is `CATEGORY`; for `MANUAL` the ordered product picker; `CAMPAIGN_BANNER` → required campaign select; `PROMO_BANNER` → link type, category select or coupon code; `CUSTOM_CONTENT` → body textarea. Common fields: title, subtitle, CTA label/URL, secondary CTA (hero only), desktop and mobile images (separate `ImageUploadField`s, §13.11), starts/ends, status, optional campaign. `sectionType` is chosen once on `/new` and shown read-only on edit.

- **Campaign and category are chosen from a list, never typed as UUIDs** (the current form has free-text "Campaign ID" / "Category ID" inputs).
- **Product picker**: search box, results list, an ordered "Selected" list with Move up/down/Remove (48px), and one **Save products** that issues a single `PUT` with the whole ordered list. Inactive products the backend later hides are not a frontend concern.
- **UX validation** (backend is authoritative and its errors are shown field-by-field via `ApiClientError.fieldError`): CTA label requires a URL and vice-versa; URL starts with `/` or `https://`; limit 1–24; `endsAt` after `startsAt`; `CAMPAIGN_BANNER` needs a campaign; `CATEGORY` rule needs a category. `INVALID_URL` maps to the URL field, `VALIDATION_ERROR` details to their fields, the rest to a form-level alert.
- **Custom content**: the textarea carries the note "Unsupported markup is removed when you save." After a successful save the form shows the stored (sanitized) value, so the admin sees what was actually kept.
- Date/time inputs are `datetime-local` converted to ISO; the label states "Times are in your browser's time zone."

##### Reorder

Move Up/Down (48px, `aria-label="Move {section name} up"`) computes the new full order locally and sends **one** `POST …/reorder`. While any move is in flight **all** move buttons are disabled (the current page disables only one row, which lets two overlapping reorders race). On success the new order is kept; **on failure the previous order is restored** and an inline error shown (the current page replaces the list with an error state). Ends of the list disable the corresponding arrow. A polite live region announces "{name} moved to position N."

##### Preview

"Preview" on the builder opens `/admin/content/homepage/preview`, which fetches `GET /api/admin/homepage/preview` with the admin session and renders the sections through the **same** `HomepageSection` the public page uses. A sticky "Preview — not live" banner is always visible; each section carries its `displayStatus` tag; `noindex`; `no-store`. The preview has no public URL and no query-string variant of `/`. A section hidden by a schedule or `DISABLED` shows with its tag rather than being omitted, so the admin sees exactly what will appear when it goes live. Empty → "No sections to preview."

##### Campaigns

`/admin/content/campaigns` lists campaigns with name, slug, schedule, computed status and the sections that reference each (gap 8), with Create, Edit, Delete (confirm). `CampaignForm.tsx` edits the §13.7 fields, the hero image through `ImageUploadField` (`kind="campaign-hero"`), and the attached products/categories through the same two attachment editors.

##### Builder states

| State | Behaviour |
| --- | --- |
| Loading | "Loading sections…" |
| Empty | "No sections yet." with an Add Section button |
| Error | Alert with message and a Retry button |
| Success | Ordered list; action results announced |
| Disabled | A row's controls are disabled while any request on the page is in flight |
| Double-click | Every mutating button is disabled while `busyId`/`saving` is set; the form's submit button shows its loading label and ignores a second submit |
| Delete | In-page confirmation dialog ("Delete this section? This cannot be undone."), destructive style, focus trapped |

##### Responsive and accessibility

Rows stack at 375px (title/type on top, controls wrapping beneath) and sit on one line from `sm`. All controls ≥ 44px, row actions 48px where space allows, 8px apart. The list is a `<ul>` with each status as text. Forms are single-column; labels visible; errors under fields in `#DC2626`.

#### What the frontend must NOT do

- Hardcode any section, banner, category or campaign (§13.1, §13.9); add components named after one.
- Decide visibility, schedule status or section order from the browser clock or from its own sorting after the backend responded.
- Send one request per row when reordering, or send a partial id list.
- Offer `sectionType` as editable after creation.
- Render un-sanitized rich text or build HTML from `contentConfig`/`visualTheme`; accept CSS or script in any theme/config field.
- Compute or display a discount for a promo banner; invent a "sale" price.
- Fire any analytics event from the homepage or builder.
- Expose preview content on any public route or via a URL flag; cache the preview.

#### Existing code to reconcile

- `HomepageSectionForm.tsx`: free-text Campaign ID / Category ID inputs; no product or category attachment UI; no Delete in the builder; `DRAFT` rows labelled "Disable"; reorder failure discards the list.
- `ImageUploadField.tsx` posts to `/api/admin/homepage/images?kind=…`, an endpoint **not defined by this spec or spec 06** (gap 1).
- `CategoryGrid.tsx` links to `/category/${slug}`; no such route exists in `app/` (spec 07's route is `/c/[slug]`; the implemented catalogue routes are `/products` and `/product/[slug]`). The link must target whatever category-listing route is built.
- `HeroSection.tsx` renders `<h1>` unconditionally; there may be several heroes or none.
- Components use `next/image` `fill` without `sizes`.
- `app/page.tsx` wraps `metadata.ogImageUrl` in `absoluteUrl()`, which corrupts an already-absolute Supabase URL.

#### Backend gaps (all resolved — see Contract additions and Gap resolutions)

1. **No endpoint is defined for uploading section or campaign images.** §13.11 and the bullet say "through spec 06's pipeline", but spec 06 defines only product and category image endpoints. The current UI calls an undocumented `/api/admin/homepage/images`.
2. **`campaign.heroContent`, `campaign.visualTheme` and the "banner-treatment" / "accent colour" sets are typed `unknown`/unspecified.** The frontend cannot render or edit them until a bounded shape is published; until then they are ignored on the storefront and omitted from the editor.
3. **The pickers depend on endpoints behind other permissions.** Listing products needs `product.update` (spec 05) and categories `category.manage`; a Manager holding only `cms.manage` cannot populate the product/category/campaign pickers. A `cms.manage`-scoped lookup (or granting those reads under `cms.manage`) is needed.
4. **No read of the current attachments.** `PUT …/products` and `…/categories` take full lists but no GET is defined for a section's or campaign's current lists, so the editors cannot prefill unless the detail responses include them.
5. **Reorder requires the complete set, but the list endpoint is paginated** (max 100 per page); with more than 100 sections the client cannot build a valid request.
6. **`PROMO_BANNER` `linkType: 'CATEGORY'` stores only `categoryId`**, with no slug in the public response; the frontend links via `ctaUrl` alone.
7. **`metadata.ogImageUrl` format** (absolute vs relative) is unspecified.
8. **No field says which sections reference a campaign**, although §13.12 asks the Campaigns list to show it; the admin list/detail projections are also not specified.

#### Spec-vs-spec / spec-vs-PRD conflicts (decisions in Gap resolutions)

- Spec text says the frontend "additionally escapes at render" `CUSTOM_CONTENT.body`, while §13.13 stores sanitized **rich text**. Escaping would print tags literally. The current component renders the sanitized HTML; keeping that requires a decision (or a client-side re-sanitizer, which adds a dependency). Recommendation: keep rendering the server-sanitized value and treat "escape" as applying to every other field.
- Spec 07 names `/c/[slug]` and `/p/[slug]`; the implemented storefront uses `/products` and `/product/[slug]`.
- The `design` skill's homepage shows a hero "text overlay (centered)"; spec 17 has `overlayPosition`. Built as `overlayPosition` with a solid panel (no scrim gradient).

#### Gap resolutions and frontend consequences

| Gap | Decision |
| --- | --- |
| 1 | `POST /api/admin/homepage/images` is now specified; `ImageUploadField.tsx` already targets it and keeps its `kind` values. |
| 2 | `CampaignHeroContent` and `CampaignVisualTheme` typed above. `CampaignBanner`/`HeroSection` apply `heroContent` fields over the linked hero's own, and map `accent`/`treatment` to existing token classes (`border-primary`, `border-text-primary`, `border-accent`; `PLAIN` = no border). The editor offers two selects and a hero-content form with `ImageUploadField`s. |
| 3 | The three pickers call the `cms/lookups` endpoints; the `category.manage`/`product.update` calls are not used by the CMS. |
| 4 | `ProductAttachmentEditor`/`CategoryAttachmentEditor` prefill from the attachment `GET`s. |
| 5 | The 100-section limit makes the reorder request always complete; the builder surfaces `SECTION_LIMIT_REACHED` on Add Section. |
| 6 | When `linkType = CATEGORY` the editor fills `ctaUrl` with `/category/{slug}` from the lookup, so the storefront needs only `ctaUrl`. `categoryId` stays as the stored reference. |
| 7 | `app/page.tsx` passes `ogImageUrl` through as-is when it starts with `https://`, else falls back to the default; `absoluteUrl()` is no longer applied to it. |
| 8 | The Campaigns list shows each campaign's `sections` as linked names. |

**Conflicts decided.** (a) `CUSTOM_CONTENT` renders the sanitized HTML via `dangerouslySetInnerHTML` — "escape at render" applies to every other text field (React's default); no client re-sanitizer dependency is added. (b) Routes are `/product/[slug]` and `/category/[slug]`; `CategoryGrid` already links correctly, and the category listing page is a required build item of spec 07. (c) Hero overlay uses `overlayPosition` with a solid panel.

## Security requirements

- **Every mutating endpoint enforces `cms.manage` server-side** (§13.13, §13.14) — hiding the Homepage Builder from a Manager is not sufficient on its own.
- **No new permission key** (§13.14) — the existing `cms.manage` covers create, update, delete, reorder, publish, and preview.
- **Preview is a separate authenticated route** (§13.12) — unpublished content can never appear in a public homepage response, because the public route's query never selects non-visible sections.
- **`content_config`/`visual_theme` are schema-validated per type** (§13.3, §13.13); free-form HTML or script is rejected, and `visual_theme` accepts no raw CSS.
- **Rich text is sanitized before storage** (§13.13) and escaped at render — both layers, per §11.6.
- **`cta_url` is validated server-side** (§13.13) against relative paths, the store domain, and safe `https://` URLs; `javascript:`/`data:` rejected.
- **Products are serialized through spec 07's customer-safe projection**, so no internal catalogue field leaks through a CMS surface.
- **Scheduling is server-evaluated** (§13.7a) — a manipulated client clock cannot reveal a scheduled campaign early.
- **Images go through the existing Supabase Storage pipeline** (§13.11) with spec 06's content sniffing and re-encoding; no second storage integration and no new upload path.
- **All list endpoints paginate** (§11.4); all input uses `.strict()` schemas (§11.6).
- **Audit** on every create, update, delete, reorder, and status change (§5.15 rule 10).

## Data integrity / idempotency

- **Reordering is atomic** (§13.12) — one request, one transaction, the full ordered set; an interruption leaves the previous order intact rather than a partial permutation.
- **Attachment lists are full-set `PUT`s**, so repeating a request converges rather than accumulating duplicate rows; the join tables' composite primary keys make a duplicate impossible anyway.
- **No duplicated catalogue data** (§13.1, §13.6a) — sections and campaigns reference products and categories by id, so a rename or price change is reflected immediately with nothing to re-sync.
- **Visibility is computed, never stored** (§13.7a) — `SCHEDULED` and `EXPIRED` cannot drift from server time because they are not persisted, and no background job exists to fail.
- **Deleting a campaign nulls `campaign_id`** on its sections rather than deleting them, so a section is never silently lost; a `CAMPAIGN_BANNER` left without a campaign fails its own visibility check and is omitted.
- **`section_type` immutability** (§13.4) prevents a section's `content_config` from becoming invalid for its type after the fact.
- **Empty carousels are omitted at request time** (§13.8), so a category emptying out degrades gracefully rather than rendering a blank block.
- **One definition of product visibility** — `activeProductScope()` from spec 07 — so the homepage cannot show a product the category page hides.

## Acceptance criteria

1. `GET /api/homepage` returns only `ACTIVE`, in-schedule sections, sorted ascending by `display_order`, in **one** request with resolved products and categories.
2. A `DRAFT` section, a `DISABLED` section, a section whose `starts_at` is in the future, and one whose `ends_at` has passed are all absent from the public response (§13.7a, §13.10).
3. `DISABLED` overrides an in-schedule window (§13.7a).
4. A section linked to an expired campaign is not rendered even when the section's own window is open.
5. Changing a section's `display_order` through the reorder endpoint changes the homepage order on the next request **with no deployment** (§13.8).
6. Reordering issues **one** request for the whole list; a list missing a section is rejected with 400 and changes nothing (§13.12).
7. A `PRODUCT_CAROUSEL` resolving to zero products is absent from the response entirely — not present with an empty array (§13.8).
8. An `AUTOMATIC` `FEATURED` carousel excludes Inactive and out-of-stock products; a `MANUAL` section including an out-of-stock product renders it with the badge, and excludes a product that is Inactive (§13.5, §13.6).
9. Creating a section with `content_config` invalid for its type returns 400 and stores nothing (§13.3).
10. `PATCH` attempting to change `section_type` returns 400, and a direct SQL change is rejected by the trigger (§13.4).
11. `cta_url: "javascript:alert(1)"` is rejected server-side; a relative path and an allowed `https://` URL are accepted (§13.13).
12. `CUSTOM_CONTENT.body` containing `<script>` is stored sanitized (§13.13).
13. `visual_theme` containing a raw CSS string is rejected (§13.13).
14. `GET /api/admin/homepage/preview` as a `cms.manage` holder returns DRAFT/SCHEDULED/DISABLED sections with their computed labels; the public endpoint never does; an unauthenticated preview request returns 401 (§13.12).
15. A Manager without `cms.manage` gets 403 on every mutating endpoint and on preview; granting it flips them (§13.14).
16. Adding a brand-new category in the catalogue makes it available to `CATEGORY_GRID` and to the `CATEGORY` carousel rule **with no frontend code change** (§13.1).
17. `grep -r "MenCategory\|EidBanner\|ElectronicsCategory" frontend/src` returns nothing (§13.9).
18. `<ProductCarousel />` renders the same `<ProductCard />` component used by the category and search pages (§13.9).
19. A section with only a desktop image renders it at both breakpoints, and vice versa (§13.11).
20. A section with no title, subtitle, or CTA renders without those elements — no empty heading, no empty button (§13.4).
21. Homepage metadata is overridden by an active campaign's `hero_content` and falls back to store defaults otherwise (§13.15).
22. The homepage HTML contains section content in the initial server response with JavaScript disabled (§13.15).
23. Setting the server clock past a campaign's `ends_at` removes it from the public response with no job run and no stored value changed (§13.7a).
24. Every create/update/delete/reorder writes an `audit_logs` row naming the actor.
25. At 375px the homepage renders with a 2-column product grid, correct mobile images, no horizontal scroll, and no layout shift from late-loading banners.

## Tests required

Per the `test` skill §5 (standard coverage) plus the security-sensitive rules §13.12 and §13.13 introduce.

1. **Visibility computation** (§13.7a, §13.10) — one test per case: DRAFT, DISABLED, before `starts_at`, after `ends_at`, in-window, and `DISABLED` overriding an open window. The computed labels are asserted alongside visibility.
2. **Campaign-section interaction** — a section is hidden when its campaign is not visible, in each of the campaign's non-visible states.
3. **Server time only** (§13.7a) — a client-supplied timestamp is rejected, and visibility follows the server clock.
4. **Rendering order** (§13.8) — sections come back sorted by `display_order`; reordering changes the result.
5. **Atomic reorder** (§13.12) — a single request applies the full order; an interrupted or partial list changes nothing.
6. **Empty carousel omitted** (§13.8) — a rule resolving to zero products drops the section.
7. **Automatic selection rules** (§13.5) — one test per rule (`LATEST`, `FEATURED`, `CATEGORY` including subcategories, `ON_SALE`), each asserting that Inactive and out-of-stock products are excluded.
7a. **`ON_SALE` specifically** — a product with `compare_at_price > base_price` is selected; one with `compare_at_price IS NULL` is not; a storewide `ALL_PRODUCTS` coupon selects nothing; a product- or category-restricted active coupon selects its products; a product matching both sources appears exactly once. Asserts the carousel is non-empty under ordinary catalogue data — the defect this resolution exists to prevent.
8. **Manual selection rules** (§13.6) — ordering respected; Inactive products excluded; out-of-stock products included with the badge; any product selectable regardless of `Featured`.
9. **`content_config` validation** (§13.3) — a valid shape per type is accepted; a shape valid for a different type is rejected; unknown keys rejected.
10. **`section_type` immutability** (§13.4) — rejected at the API and at the database.
11. **URL validation** (§13.13) — `javascript:`, `data:`, and `http://` rejected; relative paths and allowed `https://` accepted.
12. **Rich-text sanitization** (§13.13) — scripts and event handlers stripped before storage.
13. **`visual_theme` is constrained** (§13.13) — arbitrary CSS or script rejected.
14. **Preview isolation** (§13.12) — the highest-value security test here: unpublished content appears only on the authenticated preview route, never on the public endpoint, and the public route has no parameter that could include it.
15. **Permission enforcement** (§13.14, §5.18) — `cms.manage` required on every mutating endpoint and on preview; tested both ungranted and granted, since it is an `Assigned` row for Manager.
16. **No duplicated catalogue data** (§13.1) — renaming a product changes the homepage response with no CMS write.
17. **Shared `<ProductCard />`** (§13.9) — a structural test asserting the carousel renders the same component as the category page.
18. **Customer-safe product projection** — the homepage's product objects match spec 07's key set exactly, so no internal field leaks.
19. **Image fallback** (§13.11) — desktop-only and mobile-only sections both render at both breakpoints.
20. **Audit rows** on every mutation (§5.15 rule 10).

## Open questions / assumptions

1. **`ON_SALE` semantics — RESOLVED; the rule is functional in v1.** §13.5 defines it as "Active products currently discount-eligible per Section 8," but that section is entirely coupon-based and §8.12 defers product/category eligibility, so the literal reading matches nothing in v1 and would ship an `ON_SALE` carousel that always renders empty.

   **Resolution:** resolve it as the union of (A) products with `compare_at_price > base_price` and (B) products under a product/category-restricted active coupon, as specified under "`ON_SALE` resolution."

   The earlier objection to A — that it lets a display field drive business selection — does not hold on closer reading. §13.17 forbids a second discount *engine*, meaning a second computation of money; `compare_at_price` computes nothing and is already required by §13.9 to render as the ProductCard's visible discount indicator. Driving a *display* carousel from a *display* field introduces no money path: `base_price`/`variants.price` remain the only inputs to the §8.14 chain, and no order, coupon, or payment figure changes. The genuine risk would be letting `compare_at_price` reach a total — spec 05 already forbids that, and this spec does not touch it.

   B is retained so the literal §8 reading stays live: if §8.12 enforcement ships later, the rule widens automatically with no code change.

   *Residual note for the client (not a blocker):* `compare_at_price` is manually entered, so `ON_SALE` reflects what staff have marked down. If the client wants sale status derived from a scheduled promotion mechanism instead, that is a new requirement needing a PRD — §8's coupon engine is explicitly not it (§13.17).
2. **Two out-of-stock rules.** §13.5 excludes out-of-stock products from automatic homepage lists while spec 07 keeps them visible in category browsing (and §12.3 requires their product pages to exist). *Assumption:* both are correct in their own context, as described above. This is a deliberate difference, not an inconsistency, but worth stating so a future reviewer does not "fix" one to match the other.
3. **Campaign `hero_content` shape.** §13.7 says it holds "optional override content for a linked `HERO` section (title, subtitle, images, CTA)" without a schema. *Assumption:* the same validated shape as a `HERO` section's common fields, so one validator covers both and a campaign cannot introduce content a section could not hold.
4. **`visual_theme` scope.** §13.7 and §13.13 describe "lightweight presentation data (e.g. accent color, banner treatment)" and forbid arbitrary CSS. *Assumption:* an accent colour restricted to the documented palette (the `design` skill forbids inventing colours) and a banner-treatment enum. An unrestricted colour field would let a campaign break the design system.
5. **Homepage metadata override.** §13.15 says "campaign-tagged homepages may override title/description from the active campaign's `hero_content` where configured." *Assumption:* when several visible campaigns exist, the one linked to the lowest-`display_order` visible section wins, deterministically. No PRD addresses multiple simultaneous campaigns.
6. **Section-level vs. campaign-level schedule conflicts.** §13.4 says section scheduling is "independent of any campaign," while §13.7a gives campaigns their own visibility. *Assumption:* both must be visible for the section to render, since showing a campaign-tagged section after its campaign ended would contradict the campaign's schedule. **Flagged:** "independent" could alternatively mean the section's own window governs alone; the chosen reading is the one that cannot display expired campaign content.
7. **Replacing spec 07's interim `/`.** Spec 07 built a non-CMS landing page so the site was navigable before this slice. *Assumption:* this slice deletes it and seeds an initial set of sections (hero, category grid, featured carousel) so the homepage is not empty on first deploy — configured as ordinary Campaign/Section data, per §13.7's "there is no festival-specific code path; every campaign, including the first one shipped, is created as ordinary Campaign data."
