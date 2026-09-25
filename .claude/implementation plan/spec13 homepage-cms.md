# Spec 13 — CMS-Driven Homepage & Campaign System — Implementation Plan

## Context

`.claude/project requirment documents/13-homepage-cms.md` requires the storefront homepage to be rendered entirely from Admin/Manager-configured content (Homepage Sections + Campaigns) instead of hard-coded page sections, reusing the existing catalogue, coupon, RBAC, and analytics systems rather than duplicating them.

An unusually detailed implementation-design document already exists at `.claude/implementation specs/17-homepage-cms-and-campaigns.md` (416 lines), written against this same PRD. Its design decisions (schema, `computeVisibility()`, product-resolution rules including the `ON_SALE` ambiguity resolution, response shapes, security rules, acceptance criteria, tests) are sound and are adopted here as the starting point, adapted to what's actually true in this repo today.

**Verified repo state (not assumed):**
- Only migrations `0001`–`0009` exist (baseline → coupons). The next migration is `0010`, not `0017` as spec 17's aspirational numbering assumed.
- Spec 06 (Supabase Storage pipeline) is **not built** — no `storage.service.ts`, no `storage_objects` table, no bucket. Only generic `uploadValidation.ts`/`uploadLimit.ts` helpers exist (from spec 04).
- Spec 07 (storefront browsing) is **not built** — no `(storefront)` route group, no `<ProductCard/>`, no `PublicProductSummary`. `frontend/src/app/page.tsx` is a 99-line placeholder health-check page explicitly marked for later replacement.
- Only specs 01–05 (foundation/schema/RBAC/security/catalogue-admin) and spec 10 (coupons) are actually implemented and tested.
- `cms.manage` permission key already exists in `backend/src/types/permissions.ts`, reserved and unused — this is the sole RBAC gate for the entire feature; no new key is added.
- `sanitizeHtml.ts` and `urlValidation.ts` already exist in `backend/src/lib/` with doc comments anticipating this spec — reused, not rebuilt.
- `publicCeiling`/`authenticatedCeiling` rate limiters already exist and are reused.

**Scope decision (confirmed with user via AskUserQuestion):** build spec 13 as a full end-to-end slice, including the *minimal* pieces of spec 06 and spec 07 needed to support it — a minimal Supabase Storage upload service for section/campaign images, and a minimal `activeProductScope()` / `PublicProductSummary` / `<ProductCard/>` sufficient for CMS product resolution and homepage rendering. Full spec 06 (private bucket, `storage_objects` tracking, image re-encoding) and full spec 07 (product/category pages, cart, wishlist, search) are explicitly deferred — see §10.

This mirrors how `.claude/implementation plan/spec12 whatsapp-contact.md` handled a similar missing-prerequisite situation: build the self-contained piece now, document the integration contract for what isn't built yet, don't block on it.

---

## 1. Database — Migration `backend/migrations/0010_homepage_cms.sql`

Verify `0010` is still free before implementing (`ls backend/migrations/`); use the next free number if another slice has landed first.

### Enums

```sql
CREATE TYPE section_type AS ENUM
  ('HERO','CATEGORY_GRID','PRODUCT_CAROUSEL','CAMPAIGN_BANNER','PROMO_BANNER','CUSTOM_CONTENT');

-- Exactly 3 stored values. SCHEDULED/EXPIRED are computed-only labels (§13.7a, §13.10),
-- never persisted — matches coupon_status's own precedent in 0009_coupons.sql.
CREATE TYPE cms_status AS ENUM ('DRAFT','ACTIVE','DISABLED');
```

### `campaigns` (§13.7)

Columns: `id uuid PK`, `name text NOT NULL`, `slug text NOT NULL UNIQUE`, `description text`, `starts_at`/`ends_at timestamptz`, `status cms_status NOT NULL DEFAULT 'ACTIVE'` (§13.7a: ACTIVE is the stored default), `hero_content jsonb`, `visual_theme jsonb`, `created_by`/`updated_by uuid FK → users(id)`, `created_at`/`updated_at timestamptz NOT NULL DEFAULT now()`.

Constraints: `CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)`. Index on `status`.

### `homepage_sections` (§13.4)

Columns: `id uuid PK`, `section_type section_type NOT NULL` (immutable after creation), `title`/`subtitle text`, `display_order integer NOT NULL CHECK (>= 0)`, `status cms_status NOT NULL DEFAULT 'DRAFT'`, `cta_label`/`cta_url text`, `secondary_cta_label`/`secondary_cta_url text` (hero only), `desktop_image_url`/`mobile_image_url text`, `starts_at`/`ends_at timestamptz`, `campaign_id uuid FK → campaigns(id) ON DELETE SET NULL`, `content_config jsonb NOT NULL DEFAULT '{}'`, `created_by`/`updated_by uuid FK → users(id)`, `created_at`/`updated_at timestamptz NOT NULL DEFAULT now()`.

Constraints: same `ends_at > starts_at` check. Indexes: `(status, display_order)`, `(campaign_id)`.

**`section_type` immutability** (§13.4) enforced two ways: the update validation schema has no `sectionType` field (API-level), and a `BEFORE UPDATE` trigger (`reject_section_type_change()`) raises if `NEW.section_type IS DISTINCT FROM OLD.section_type` (database-level, blocks a direct SQL bypass) — the spec states the rule outright, so both layers enforce it.

No unique constraint on `display_order`: the reorder endpoint assigns a dense sequence inside one transaction (§3.5 below), so duplicates never persist; a hard constraint would make an in-flight multi-row reorder transiently invalid depending on statement order.

### Join tables (§13.6, §13.6a)

Four tables, all referencing existing catalogue rows by id (no duplication): `homepage_section_products(section_id, product_id, display_order, PK(section_id, product_id), FK section_id ON DELETE CASCADE)`, `homepage_section_categories` (same shape, category_id), `campaign_products` (same shape, campaign_id + product_id), `campaign_categories` (same shape, campaign_id + category_id). Each has a `(parent_id, display_order)` index.

### Decision: no `storage_objects` tracking table

Homepage/campaign images are stored as plain `text` URL columns (already in the schema above), pointing at a dedicated public Supabase Storage bucket. **No `storage_objects` table is added in this slice.**

Justification: a shared tracking table's value (full spec 06's design) is coordinating ownership/lifecycle across many call-sites and mixed public/private buckets. This slice has exactly one call site, one public bucket, no sensitive content. Building that table now, sized for scope not yet designed, risks a shape spec 06 has to redesign later. Storing the URL directly on the owning row matches the existing `categories.image_url`-style pattern from `0005_catalogue.sql`. Nothing here blocks spec 06 from adding `storage_objects` later. Restated in §10 so it isn't silently dropped.

---

## 2. Minimal Storage Upload Service (spec 06 slice)

New file: `backend/src/services/storage/homepageImages.service.ts`

```ts
export type UploadHomepageImageInput = {
  file: Buffer;
  kind: 'section-desktop' | 'section-mobile' | 'campaign-hero';
};
export type UploadHomepageImageResult = { url: string; storagePath: string };
export async function uploadHomepageImage(input: UploadHomepageImageInput): Promise<UploadHomepageImageResult>;
```

1. Content-sniff + size-validate via the **existing** `backend/src/lib/uploadValidation.ts` (SVG/HTML always rejected regardless of declared MIME; UUID-based storage filename, never derived from user input).
2. Upload via the **existing** `backend/src/lib/supabase.ts` service-role client to a new public bucket `homepage-images` (path `${kind}/${uuidFilename}`), no second Supabase client.
3. Return the bucket's public URL. No re-encoding/WebP conversion, no thumbnailing (`sharp` is not installed and is not added here — full spec 06's job).

New constants in `backend/src/config/constants.ts`: `HOMEPAGE_IMAGES_BUCKET = 'homepage-images'`, `HOMEPAGE_IMAGE_MAX_BYTES = 5 * 1024 * 1024`. Document the one-time bucket-creation step (Supabase bucket creation isn't a SQL migration) in `backend/README.md`.

**Upload endpoint:** `POST /api/admin/homepage/images?kind=...` — `requireAuth('admin')` + `requirePermission('cms.manage')` + upload-size middleware + `rateLimit('authenticatedCeiling')`. Controller: `backend/src/controllers/admin/homepageImages.controller.ts`, reads the raw body per the existing `uploadLimit.ts` contract, returns `{ url }`. `kind` validated by a small `.strict()` zod enum schema.

---

## 3. Backend — Homepage Sections & Campaigns

### File layout (new)

```
backend/migrations/0010_homepage_cms.sql
backend/src/types/homepageCms.ts                          # shared enums/types, PublicProductSummary
backend/src/repositories/homepageSections.repository.ts
backend/src/repositories/campaigns.repository.ts
backend/src/repositories/homepageSectionProducts.repository.ts
backend/src/repositories/homepageSectionCategories.repository.ts
backend/src/repositories/campaignProducts.repository.ts
backend/src/repositories/campaignCategories.repository.ts
backend/src/services/homepageCms/visibility.ts             # computeVisibility()
backend/src/services/homepageCms/contentConfig.schemas.ts  # per-type zod schemas
backend/src/services/homepageCms/productResolution.ts      # activeProductScope() + rules + ON_SALE
backend/src/services/homepageCms/homepageSections.service.ts
backend/src/services/homepageCms/campaigns.service.ts
backend/src/services/homepageCms/homepage.service.ts       # public GET /api/homepage assembly
backend/src/services/homepageCms/preview.service.ts
backend/src/services/storage/homepageImages.service.ts
backend/src/validation/homepageCms.validation.ts
backend/src/controllers/admin/homepageSections.controller.ts
backend/src/controllers/admin/campaigns.controller.ts
backend/src/controllers/admin/homepagePreview.controller.ts
backend/src/controllers/admin/homepageImages.controller.ts
backend/src/controllers/homepage.controller.ts             # public
backend/src/routes/admin/homepage.routes.ts                # sections + reorder + images + preview
backend/src/routes/admin/campaigns.routes.ts
backend/src/routes/public/homepage.routes.ts
```

Changed: `backend/src/routes/admin/index.ts` (mount new routers), `backend/src/routes/index.ts` or `routes/public/index.ts` — verify actual public-route mounting convention at build time (`backend/src/routes/public/` currently has no `index.ts`, just individual route files — check `app.ts`), `backend/src/config/constants.ts`.

### `content_config` schemas (§13.3, §13.13)

One `.strict()` zod schema per `section_type` in `contentConfig.schemas.ts`, selected via `contentConfigSchemaFor(sectionType)`:

| `section_type` | Shape |
| --- | --- |
| `HERO` | `{ overlayPosition?: 'left'\|'center'\|'right' }` |
| `CATEGORY_GRID` | `{ mode: 'ALL_ACTIVE_TOP_LEVEL'\|'MANUAL'; columns?: 2\|3\|4 }` |
| `PRODUCT_CAROUSEL` | discriminated union on `mode`: `{ mode:'AUTOMATIC'; rule:'LATEST'\|'FEATURED'\|'CATEGORY'\|'ON_SALE'; limit:1-24; categoryId?:uuid; sort?:'newest' }` (refine: `categoryId` required when `rule==='CATEGORY'`) or `{ mode:'MANUAL'; sort?:'manually_selected' }` |
| `CAMPAIGN_BANNER` | `{}` — content comes from linked `campaign_id` |
| `PROMO_BANNER` | `{ linkType?:'CATEGORY'\|'COUPON'\|'URL'; categoryId?:uuid; couponCode?:string }` |
| `CUSTOM_CONTENT` | `{ body: string }` — sanitized server-side via existing `sanitizeHtml()` in the **service** layer after zod validates shape, before persistence |

`CAMPAIGN_BANNER` without `campaign_id` and `visual_theme` (campaigns) accepting anything beyond `{ accentColor: <allowlisted enum from design skill>; bannerTreatment: 'STANDARD'|'FULL_BLEED'|'SPLIT' }` are both rejected — cross-field/schema checks enforced in the service, matching coupon's `assertFieldsValid` pattern. Confirm exact accent-color tokens against the `design` skill before finalizing (never invent brand colors).

### `computeVisibility()` — shared (§13.7a)

`backend/src/services/homepageCms/visibility.ts`:

```ts
export type DisplayStatus = 'DRAFT'|'ACTIVE'|'SCHEDULED'|'EXPIRED'|'DISABLED';
export function computeVisibility(
  entity: { status: 'DRAFT'|'ACTIVE'|'DISABLED'; startsAt: Date|null; endsAt: Date|null },
  now: Date,
): { visible: boolean; displayStatus: DisplayStatus } {
  if (entity.status === 'DRAFT') return { visible: false, displayStatus: 'DRAFT' };
  if (entity.status === 'DISABLED') return { visible: false, displayStatus: 'DISABLED' };
  if (entity.startsAt && entity.startsAt > now) return { visible: false, displayStatus: 'SCHEDULED' };
  if (entity.endsAt && entity.endsAt < now) return { visible: false, displayStatus: 'EXPIRED' };
  return { visible: true, displayStatus: 'ACTIVE' };
}
```

`now` is always `new Date()` computed inside the service — no route accepts a client-supplied timestamp. A section with `campaign_id` is visible only when **both** its own and its campaign's `computeVisibility()` say visible (adopted from spec 17, flagged as the chosen reading of "independent" scheduling — see §3.9).

### Product resolution (§13.5, §13.6)

Minimal `activeProductScope()` in `productResolution.ts`, filtered to `products.status = 'ACTIVE'` always, plus (automatic mode only) an active-variant-with-stock exclusion:

| Rule | Filter |
| --- | --- |
| `LATEST` | `ORDER BY created_at DESC LIMIT :limit`, optional `category_id` |
| `FEATURED` | `is_featured = true` |
| `CATEGORY` | category id + its direct subcategories (one extra query against `categories.parent_id`) |
| `ON_SALE` | see below |

**Manual mode**: reads `homepage_section_products` ordered by `display_order`, filtered to `Active` products only (no out-of-stock exclusion — §13.6's explicit carve-out), computing a per-product `outOfStock` flag for the frontend badge.

**`ON_SALE` resolution — adopted from spec 17 as-is, agreed:** union (deduplicated) of (A) `compare_at_price > base_price` (a display field, guarded by the existing `products_compare_at_price_check`, never entering an order total) and (B) products/categories under an ACTIVE, in-schedule, product-/category-restricted coupon (`ALL_PRODUCTS`-eligibility coupons excluded, to avoid degenerating into `LATEST`). Source B returns nothing until §8.12 enforcement ships, by design — the rule widens automatically with zero code change later. This is not a second discount engine: `compare_at_price` computes no money and is already required by §13.9 to render as the ProductCard's discount indicator.

### Reorder — atomic, single transaction (§13.12)

Service `reorderSections(actor, sectionIds)`: inside `withTransaction`, `SELECT id FROM homepage_sections FOR UPDATE` to load the current set, reject (400 `VALIDATION_ERROR`) unless `sectionIds` as a set exactly equals the current set (no missing/extra/duplicate id), then apply a dense `display_order` sequence via one `UPDATE` per row **inside the same transaction**, then one `audit_logs` row for the whole batch. An interruption rolls back everything — no partial permutation.

Attachment endpoints (`PUT .../products`, `PUT .../categories`, campaign equivalents) use the same full-replace-in-one-transaction pattern: `DELETE` the join rows for that parent, bulk `INSERT` the new ordered list, one audit entry — both inside one `withTransaction`.

### Public endpoint — `GET /api/homepage`

`homepage.service.ts::getHomepage(now = new Date())`:
1. Query non-`DRAFT` sections ordered by `display_order` (DRAFT excluded at the query as a safe optimization — `computeVisibility` remains the single source of truth for every row that does reach it).
2. Compute each section's visibility; batch-load any referenced campaigns (one query, not N) and compute their visibility; final visibility requires both.
3. Resolve products/categories for visible sections; a `PRODUCT_CAROUSEL` resolving to zero products is **dropped from the response entirely** (§13.8), not returned with `products: []`.
4. `metadata` (title/description/ogImage) comes from the visible campaign with `hero_content` linked to the lowest-`display_order` visible section, tie-broken deterministically (flagged as an assumption — no PRD addresses concurrent campaigns); falls back to `SITE_NAME`/`SITE_DESCRIPTION` otherwise.

Response type `HomepageResponse` and `PublicProductSummary` (`{ id, name, slug, imageUrl, price, compareAtPrice, isFeatured, outOfStock }`) defined in `backend/src/types/homepageCms.ts`, mirrored by hand on the frontend.

Route: `backend/src/routes/public/homepage.routes.ts`, `GET /`, `rateLimit('publicCeiling')`, no auth, `Cache-Control: public, max-age=60, stale-while-revalidate=300`.

### Admin preview — structurally separate route (§13.12)

`GET /api/admin/homepage/preview` — `requireAuth('admin')` + `requirePermission('cms.manage')` + `rateLimit('authenticatedCeiling')`. `preview.service.ts::getPreview()` reuses the same assembly minus the DRAFT filter, annotating every section/campaign with its computed `displayStatus`. Implemented as a genuinely separate function/route, **never** a flag/query-param on the public endpoint — per §13.12 and the reasoning that a flag is one missing check away from publishing drafts.

### Admin route table

All under `requireAuth('admin')` + `rateLimit('authenticatedCeiling')` + `requirePasswordChanged` at the router-mount level, each individual route additionally chaining `requirePermission('cms.manage')`:

```
GET/POST    /api/admin/homepage/sections
GET/PATCH/DELETE /api/admin/homepage/sections/:id
POST        /api/admin/homepage/sections/reorder
PUT         /api/admin/homepage/sections/:id/products
PUT         /api/admin/homepage/sections/:id/categories
POST        /api/admin/homepage/images
GET         /api/admin/homepage/preview
GET/POST    /api/admin/campaigns
GET/PATCH/DELETE /api/admin/campaigns/:id
PUT         /api/admin/campaigns/:id/products
PUT         /api/admin/campaigns/:id/categories
```

Deleting a campaign nulls linked sections' `campaign_id` via `ON DELETE SET NULL` rather than deleting them.

### Resolved design questions (adopted from spec 17, stance stated)

1. **`ON_SALE`** — agree, adopt as-is.
2. **Automatic excludes out-of-stock, manual includes with badge** — agree, literal reading, not an inconsistency.
3. **Campaign `hero_content` shape** — agree: same optional fields a HERO section's common fields use.
4. **`visual_theme` scope** — agree: constrained enum, no free CSS string.
5. **Multi-campaign metadata tie-break** — agree with lowest-`display_order`-wins, flagged as an assumption in code.
6. **Section vs. campaign schedule "independence"** — agree both must be visible (a section can't outlive its ended campaign); flagged in `visibility.ts`'s doc comment as the chosen reading.
7. **Replacing the interim `/`** — adapted: this repo's `page.tsx` is a placeholder health-check demo, not a built spec-07 landing page as spec 17 assumed. This plan replaces it directly and seeds one Hero + one Category Grid + one Featured Carousel section via a one-time manual seed script (`backend/scripts/seedHomepageSections.ts`, not a migration — CMS content is operational data), so the homepage isn't empty on first deploy, consistent with "no festival-specific code path."

---

## 4. Validation (`backend/src/validation/homepageCms.validation.ts`)

Follows `coupons.validation.ts` conventions exactly: `.strict()` on every object schema, `z.coerce.date()`/`z.coerce.number()` for query/body coercion, separate schemas per operation. `updateSectionSchema` mirrors `createSectionSchema` with `sectionType` entirely absent (its absence is the API-level immutability enforcement). `ctaUrlSchema` wraps the existing `isValidCtaUrl()`. `reorderSectionsSchema`, `attachProductsSchema`, `attachCategoriesSchema` each take a full ordered id array. Cross-field checks that a single object schema can't express (content_config shape matches section_type, `CAMPAIGN_BANNER` requires `campaignId`) live in the service layer, matching coupon's own layering.

---

## 5. Controllers & Routes

Directly modeled on `coupons.controller.ts` / `coupons.routes.ts`: thin controllers, `req.actor` → `Actor`, try/catch → `next(err)`, `buildPagination` for lists, `ApiSuccess`/`ApiListSuccess` envelopes. No new design decisions beyond §3/§4.

---

## 6. Frontend

### Minimal storefront slice (spec 07 sliver)

- `frontend/src/lib/publicTypes.ts` — `PublicProductSummary`, `HomepageResponse` (hand-mirrored from backend types, matching existing convention).
- `frontend/src/components/ProductCard.tsx` (storefront-scoped, not under `components/admin/`) — `next/image`, name, price, struck-through `compareAtPrice`, Featured badge, Out-of-Stock badge, wrapped in `<Link href={"/product/"+slug}>`. The link target doesn't exist yet (full spec 07) — documented as a dead link in this slice's scope, same pattern as spec 12's integration-contract note.

### Section components (§13.9) — exactly six, dispatcher-driven

```
frontend/src/components/homepage/HeroSection.tsx
frontend/src/components/homepage/CategoryGrid.tsx
frontend/src/components/homepage/ProductCarousel.tsx   # renders <ProductCard/>, never reimplements it
frontend/src/components/homepage/CampaignBanner.tsx
frontend/src/components/homepage/PromoBanner.tsx
frontend/src/components/homepage/CustomContentBlock.tsx
frontend/src/components/homepage/HomepageSection.tsx   # dispatcher on sectionType
```

No component named after a category or campaign (`<MenCategory/>`, `<EidBanner/>` forbidden). A section with no title/subtitle/CTA renders without that DOM node via plain conditional rendering (§13.4). Image fallback: `desktopImageUrl ?? mobileImageUrl` above `md`, reversed below (§13.11).

### Homepage page (§13.8, §13.15)

`frontend/src/app/page.tsx` **replaces** the placeholder. Server component, `export const revalidate = 60` (ISR), `generateMetadata()` reads the campaign override or falls back to `SITE_NAME`/`SITE_DESCRIPTION` via existing `pageTitle()`/`absoluteUrl()` helpers from `frontend/src/lib/site.ts`. One server-side `fetch('/api/homepage', { next: { revalidate: 60 } })` — single request, no client-side visibility logic, no new analytics event (PageView fires unchanged).

### Admin Homepage Builder & Campaigns

```
frontend/src/app/admin/(shell)/content/homepage/page.tsx           # list + Move Up/Down + Edit/Disable/Enable
frontend/src/app/admin/(shell)/content/homepage/new/page.tsx       # section_type locked after create
frontend/src/app/admin/(shell)/content/homepage/[id]/page.tsx
frontend/src/app/admin/(shell)/content/homepage/preview/page.tsx   # reuses HomepageSection components + "Preview — not live" banner
frontend/src/app/admin/(shell)/content/campaigns/page.tsx
frontend/src/app/admin/(shell)/content/campaigns/new/page.tsx
frontend/src/app/admin/(shell)/content/campaigns/[id]/page.tsx
frontend/src/components/admin/ImageUploadField.tsx
```

Mirrors `frontend/src/app/admin/(shell)/marketing/coupons/` exactly (`'use client'`, `apiGet`/`apiPost`/etc from `@/lib/apiClient`, `ApiClientError` catch, shared `Button`/`FormField`). List page shows computed `displayStatus` badges; Move Up/Down issues **one** full-list reorder request, never per-row. Section editor renders only the fields relevant to the loaded `section_type`. Content nav entry hidden from a Manager lacking `cms.manage`, and every page still handles a raw 403 if hit directly.

---

## 7. Security Requirements

- `cms.manage` enforced server-side on every mutating + preview endpoint (§13.13/§13.14) — independent of frontend nav hiding. No new permission key.
- Preview is structurally a separate route/function, not a public-endpoint flag — impossible for unpublished content to leak by construction, not just by policy.
- `content_config`/`visual_theme` schema-validated per type, `.strict()` — unknown keys are 400, never silently stored.
- `CUSTOM_CONTENT.body` sanitized server-side via existing `sanitizeHtml()` before storage; check for any existing `dangerouslySetInnerHTML` convention in `frontend/src` before adding a new render path for it.
- `cta_url`/`secondary_cta_url` validated server-side via existing `isValidCtaUrl()` — `javascript:`, `data:`, bare `http://` rejected.
- Images content-sniffed (never by extension/declared MIME) — SVG/HTML always rejected, closing a stored-XSS-via-SVG vector.
- Products served through the narrow `PublicProductSummary` projection — no internal catalogue field (cost, supplier, raw stock) leaks.
- Scheduling is server-evaluated only — no route accepts a client-supplied "as of" timestamp.
- All list endpoints paginate; audit logging on every create/update/delete/reorder/attach/status-change, one entry per logical action, inside the same transaction as the mutation.
- Mutating admin routes ride the existing CSRF mechanism already wired into `apiClient.ts` — no new CSRF handling needed.

---

## 8. Tests

New directory: `backend/tests/spec-13-homepage-cms/`. New config `backend/config/vitest/spec13/vitest.config.ts` (copy spec10's, swap `include`), plus `"test:spec13"` script in `backend/package.json`, plus a new "Spec 13" section in `backend/tests/TEST_ORGANIZATION.md`.

Test files (23 total; adapted from spec 17's list to what's buildable given the minimal-slice scope — full-page SSR/viewport tests replaced by component-level tests, noted explicitly rather than silently dropped):

1. `visibility.unit.test.ts` — every `computeVisibility()` case.
2. `homepage.campaignInteraction.test.ts` — section hidden when campaign non-visible, each state.
3. `homepage.serverTimeOnly.test.ts` — no request accepts a client timestamp.
4. `homepage.renderingOrder.test.ts` — sorted by `display_order`; reorder changes result.
5. `homepageSections.reorder.repository.test.ts` — atomic reorder; invalid list rejected, nothing changes.
6. `homepage.emptyCarouselOmitted.test.ts` — zero-product carousel dropped entirely.
7. `productResolution.automaticRules.test.ts` — one case per rule, Inactive/out-of-stock excluded.
8. `productResolution.onSale.test.ts` — Source A, Source B, `ALL_PRODUCTS` exclusion, dedup.
9. `productResolution.manualSelection.test.ts` — order respected, Inactive excluded, out-of-stock included with badge.
10. `contentConfig.validation.test.ts` — valid/invalid/cross-type/unknown-key cases.
11. `homepageSections.sectionTypeImmutable.test.ts` — API-level and trigger-level rejection.
12. `homepageCms.urlValidation.test.ts` — `javascript:`/`data:`/`http://` rejected, relative/allowed https accepted.
13. `homepageCms.richTextSanitization.test.ts` — script/handler stripped before storage.
14. `homepageCms.visualThemeConstrained.test.ts` — arbitrary CSS rejected.
15. `homepage.previewIsolation.test.ts` — **highest-value security test**: DRAFT/DISABLED content on preview only, never on public, unauthenticated preview 401.
16. `homepageCms.permissions.test.ts` — 403 without `cms.manage`, 200/201 with.
17. `homepage.noDuplicatedCatalogueData.test.ts` — product rename reflected with zero CMS writes.
18. `productCard.shared.test.tsx` — `<ProductCarousel/>` renders the actual imported `<ProductCard/>` module.
19. `homepage.publicProjection.test.ts` — response product keys exactly match `PublicProductSummary`.
20. `homepage.imageFallback.test.ts` — desktop-only/mobile-only both resolve non-null for both breakpoints.
21. `homepageCms.audit.test.ts` — one audit row per logical action, none on rollback.
22. `homepageImages.upload.test.ts` — valid formats accepted, SVG/oversized/unauthorized rejected.
23. `campaigns.crud.test.ts` — CRUD, slug uniqueness, delete nulls linked sections' `campaign_id`.

---

## 9. Acceptance Criteria

1. `GET /api/homepage` returns only ACTIVE, in-schedule sections sorted by `display_order`, one request, resolved data.
2. DRAFT/DISABLED/future-start/past-end sections all absent from public response.
3. DISABLED overrides an in-schedule window.
4. Section linked to a non-visible campaign not rendered even with its own window open.
5. Reorder changes next `GET /api/homepage` order, no deploy.
6. Reorder is one request; invalid list rejected with 400, nothing changes.
7. Zero-product carousel absent entirely, not `products: []`.
8. Automatic excludes Inactive/out-of-stock; manual includes out-of-stock with badge, excludes Inactive.
9. Invalid `content_config` for type → 400, nothing persisted.
10. `sectionType` change ignored at API, rejected by trigger at DB.
11. `javascript:` cta_url rejected; relative/allowed https accepted.
12. `CUSTOM_CONTENT.body` with `<script>` stored sanitized.
13. `visual_theme` raw CSS rejected.
14. Preview shows DRAFT/SCHEDULED/DISABLED with labels; public never does; unauthenticated preview 401.
15. Manager without `cms.manage` gets 403 everywhere mutating + preview; granting flips it.
16. New category usable by CATEGORY_GRID/CATEGORY rule with zero frontend change.
17. `grep -r "MenCategory\|EidBanner\|ElectronicsCategory" frontend/src` empty.
18. `<ProductCarousel/>` renders the shared `<ProductCard/>`.
19. Desktop-only/mobile-only sections both resolve at both breakpoints.
20. No title/subtitle/CTA → no empty DOM element.
21. Metadata overridden by tie-broken campaign, falls back otherwise.
22. Advancing server clock past `ends_at` removes campaign from response, no job, no stored change.
23. Every mutation writes exactly one audit row naming the actor.
24. `npm run typecheck` and `npm run build` pass in both `backend/` and `frontend/`.
25. SVG upload rejected regardless of declared MIME.

---

## 10. Follow-up Work / Explicitly Deferred

**Full spec 06 still needed later:** private bucket + signed URLs for payment proofs; a generic `storage_objects` tracking table if/when multiple call-sites need shared lifecycle tracking (this slice uses plain URL columns instead, §1); image re-encoding to WebP/thumbnailing; product image upload wiring (`product_images` table exists since `0005_catalogue.sql`, still empty, untouched here).

**Full spec 07 still needed later:** product detail pages (`<ProductCard/>`'s link target is currently dead), category listing/search/filtering, cart and wishlist wiring (`<ProductCard/>` here has no wishlist button), a generalized `activeProductScope()` beyond the CMS's specific filter needs.

**Spec 18 (analytics firing):** not applicable — §13.16 confirms no new events; verify `PageView` still fires correctly against the new `page.tsx`, but no new event code is added.

**CMS scope beyond the homepage:** explicitly out of scope per §13.1 — no generic multi-page CMS.

---

## 11. Verification

```bash
cd backend && npm run typecheck && npm run build
cd frontend && npm run typecheck && npm run build
cd backend && npm run migrate   # confirm exact script name in backend/package.json first
cd backend && npm run test:spec13
```

Manual QA:
1. Create one of each `section_type` as Admin; confirm type-specific fields and locked `section_type` after creation.
2. Upload a desktop-only image to a HERO section; confirm it renders at both breakpoints once ACTIVE.
3. Rename a `.svg` to `.png` and attempt upload; confirm rejection.
4. Create a DRAFT section, view it via `/admin/content/homepage/preview`, confirm absence from `/` in an unauthenticated window.
5. Reorder via Move Up/Down; confirm exactly one network request and the homepage reflects the new order.
6. As a Manager without `cms.manage`: confirm nav hidden, API returns 403 directly.
7. Create a Campaign with `hero_content` title override linked to a `CAMPAIGN_BANNER` section; confirm homepage `<title>` and OG tag reflect it.
8. Set a Campaign's `ends_at` to the past directly in the DB; confirm it disappears from `/` with no job run.
9. At 375px: no horizontal scroll, correct mobile images, 2-column carousel grid, 44×44px admin controls.
10. `grep -r "MenCategory\|EidBanner\|ElectronicsCategory" frontend/src` — empty.

### Critical files

`backend/migrations/0010_homepage_cms.sql`, `backend/src/services/homepageCms/visibility.ts`, `backend/src/services/homepageCms/productResolution.ts`, `backend/src/services/homepageCms/homepage.service.ts`, `backend/src/validation/homepageCms.validation.ts`, `backend/src/services/storage/homepageImages.service.ts`, `backend/src/routes/admin/homepage.routes.ts`, `frontend/src/app/page.tsx`, `frontend/src/components/homepage/HomepageSection.tsx`, `frontend/src/components/ProductCard.tsx`, `backend/tests/spec-13-homepage-cms/`.
