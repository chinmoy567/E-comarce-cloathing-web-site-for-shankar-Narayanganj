# Spec 17 — Homepage CMS & Campaigns: gap-closing plan

## Context
Spec 17 is written as greenfield, but exploration shows most of it already exists, built earlier under the label "spec 13" (requirement doc `13-homepage-cms.md`). The migration, services, routes, six storefront components, admin pages and 23 backend test files are present. So this is a **gap-closing slice**, not a new build. Do not recreate `0017_homepage_cms.sql`: it would duplicate `0010_homepage_cms.sql` and fail on `CREATE TYPE`.

Decisions taken (no blocking questions):
- Extend the existing `backend/tests/spec-13-homepage-cms/` folder and `config/vitest/spec13` config; do not create a duplicate spec-17 folder. Note the mapping in `tests/TEST_ORGANIZATION.md`.
- Keep the existing bucket `homepage-images` and the `${kind}/` prefix. The spec's `cms/` prefix is cosmetic and spec 06 does not exist.
- Add a minimal `/category/[slug]` page, because `CategoryGrid` links there today and it 404s.

## Phase 1 — Backend contract gaps (all under `backend/src`)
1. **Section limit.** In `services/homepageCms/homepageSections.service.ts` create path: count sections in the transaction; at 100 throw `Conflict(..., 'SECTION_LIMIT_REACHED')` (409). List endpoint pageSize max 100.
2. **CMS lookups** (new, `cms.manage`, `authenticatedCeiling`, paginated, minimal projection): `GET /api/admin/cms/lookups/products?q&page&pageSize` → `{id,name,slug,imageUrl,isActive}`; `GET .../categories` → `{id,name,slug,parentId}`. New controller + route mounted in `routes/admin/index.ts`; query via existing catalogue repositories or a small lookup repository.
3. **Attachment reads.** `GET /sections/:id/products|categories` and `GET /campaigns/:id/products|categories` returning the ordered list in lookup shape; reuse `homepageSectionProducts/Categories` and `campaignProducts/Categories` repositories.
4. **Campaign admin projection.** Add `displayStatus` and `sections: [{id,title}]` to the admin campaign list/detail.
5. **Theme/hero shapes.** Align `contentConfig.schemas.ts` with the spec: `visualTheme` `{accent: PRIMARY|DARK|ACCENT, treatment: PLAIN|BORDERED}`; `heroContent` limits title ≤120, subtitle ≤200, all `.strict()`. Replace `unknown` in repository types. Existing stored rows: none are seeded, so no data migration, but confirm with a grep of the seed/migrations before changing enums.
6. **Metadata.** `homepage.service.ts:~155`: derive `ogImageUrl` from the winning campaign's hero image (absolute `https://` or null), and confirm the winner is the campaign of the lowest-`display_order` visible section.
7. **Verify, fix only if wrong** (agent could not confirm): error codes `SECTION_TYPE_IMMUTABLE` and `INVALID_URL`; `Cache-Control: public, max-age=60, stale-while-revalidate=300` on `GET /api/homepage`; reorder rejects an incomplete or unknown `sectionIds` set (`homepageSections.service.ts:~244`); `PROMO_BANNER`/`CAMPAIGN_BANNER` validation rules.
8. No migration is expected. If one is needed (e.g. a DB-level guard), it is `0017_*.sql`, incremental only, using the existing runner (`npm run migrate`).

## Phase 2 — Frontend (all under `frontend/src`)
1. `app/page.tsx`: pass `metadata.ogImageUrl` through when it starts with `https://`, else the default; stop wrapping it in `absoluteUrl()`.
2. `HeroSection.tsx`: `<h1>` only for the first hero's title; page-level visually-hidden `<h1>` with `SITE_NAME` when no hero title; other titles `<h2>`. Add `sizes` to every `next/image` `fill` in Hero, CampaignBanner, PromoBanner, CategoryGrid (and check ProductCarousel).
3. `CampaignBanner`/`HeroSection`: apply campaign `heroContent` over the hero and map `accent`/`treatment` to `border-primary` / `border-text-primary` / `border-accent`.
4. New `app/category/[slug]/page.tsx`: minimal listing via the existing public catalogue API and shared `ProductCard`. Confirm the backend has a category-filter endpoint first; if not, filter via the existing products query param.
5. New `components/admin/homepage/`: `SectionRow`, `DisplayStatusBadge` (extract from the builder page), `ProductAttachmentEditor`, `CategoryAttachmentEditor` (search via lookups, ordered selected list, Move up/down/Remove, one `PUT`), `CampaignSelect`.
6. `HomepageSectionForm.tsx`: replace free-text Campaign ID / Category ID with `CampaignSelect` and category select; embed the attachment editors for MANUAL carousel / MANUAL category grid; `PROMO_BANNER` CATEGORY link fills `ctaUrl` with `/category/{slug}`; datetime-local time-zone note; custom-content note; show stored sanitized value after save.
7. `homepage/page.tsx` (builder): label `DRAFT` as **Publish**; add Delete with a focus-trapped confirm dialog; disable all move buttons while any reorder is in flight; on failure restore the previous order; polite live region; surface `SECTION_LIMIT_REACHED`.
8. `CampaignForm.tsx` + campaigns list: hero-content fields with `ImageUploadField kind="campaign-hero"`, attachment editors, list showing `displayStatus` and referencing sections, delete confirm.
9. Constraint: no client clock visibility logic, no component named after a category/campaign, no analytics events from the homepage or builder.

## Phase 3 — Tests (testing-agent / `test` skill)
Backend, in `backend/tests/spec-13-homepage-cms/`, registered in `config/vitest/spec13/vitest.config.ts` `include`:
- `SECTION_LIMIT_REACHED` at the 101st section.
- Lookups: permission (403 without `cms.manage`), pagination, minimal projection.
- Attachment GETs: ordering and permission.
- Campaign projection `sections[]` / `displayStatus`.
- Theme/hero strictness with the new shapes (raw CSS rejected).
- Metadata `ogImageUrl` absolute-or-null; campaign override winner.
- Re-audit the existing 23 files against spec 17's Tests-required list; add only the gaps (e.g. 7a ON_SALE dedupe, 16 rename-propagation, 18 key-set equality).
Frontend (`frontend/tests`): shared `ProductCard` already covered; add tests for single-`h1`, CTA link safety (`/`, `https://` only), image fallback, and reorder restore-on-failure if the existing test setup supports component tests.
Update `tests/TEST_ORGANIZATION.md`.

## Verification
- `cd backend && npm run test:spec13` (plus `npm run build`/typecheck); `npm run migrate` only if a migration was added.
- `cd frontend && npm run lint && npm run build && npm test`.
- Run the app and check in the browser: `/` renders sections with JS disabled; builder reorder issues one request (network tab); Publish/Disable/Delete work; preview shows DRAFT/SCHEDULED with tags and is `noindex`; a Manager without `cms.manage` gets 403 and no nav entry; 375px layout has a 2-column product grid and no horizontal scroll.
- `grep -r "MenCategory\|EidBanner\|ElectronicsCategory" frontend/src` returns nothing.

## Open items to flag (not blocking)
- Spec 06 (image pipeline) is not built: homepage uploads do no re-encoding. Noted, not fixed here.
- `activeProductScope()` is an inline slice in `productResolution.ts`, not a shared spec 07 function; leave as is.
