---
name: seo
description: SEO implementation strategy for this Bangladesh e-commerce platform's Next.js frontend — Metadata API, sitemap/robots.txt, canonical URLs, Open Graph, JSON-LD structured data, and SEO-friendly URLs, per .claude/project requirment documents/01-overview.md Section 1.1 and 13-homepage-cms.md Section 13.15
type: skill
version: 1.0
priority: medium
---

# SEO Skill

**For**: Bangladesh Fashion & Clothing E-Commerce Platform (Next.js storefront)
**Purpose**: Make SEO implementation consistent across every storefront page instead of ad hoc per feature. This is a required part of the stack (`01-overview.md` Section 1.1 lists SEO as a first-class technology-stack item, not an afterthought) — treat gaps here with the same weight as a missing feature, not as optional polish.

This skill complements `frontend-builder` (implements pages) — read it before building or reviewing any customer-facing storefront page (product, category, homepage, search, content pages). It does not apply to the Admin/Manager back-office, which is not indexed and has no SEO requirements.

---

## 1. Metadata API (Next.js)

- Every storefront route (product, category, homepage, static content pages) generates metadata via Next.js's Metadata API (`generateMetadata` / static `metadata` export) — never hand-rolled `<head>` tags in a page component.
- Title and description are **dynamic per entity**: a product page's title/description reflect that product's actual name/description, not a single static site-wide string. Verify this by checking two different product pages render different metadata, not just that the mechanism exists.
- Fallback to sensible store-level defaults when entity-specific content is missing (e.g. a product with no description) — never render an empty or literally-undefined title/description.
- Homepage metadata may be overridden by an active campaign's `hero_content` per `13-homepage-cms.md` Section 13.15, falling back to store defaults otherwise — don't hardcode homepage metadata in a way that can't be overridden by CMS content.

## 2. SEO-Friendly URLs

- Product and category URLs use readable slugs derived from the name (e.g. `/products/mens-cotton-panjabi`, not `/products/4821` or a raw UUID).
- Slugs are stable — changing a product's display name should not silently break existing indexed URLs; if a slug must change, that's a redirect concern (see Section 5 below), not a silent 404.
- No unnecessary query-string-based pagination/filtering exposed as the canonical URL for a page that should be indexed as one entity — use path segments or ensure canonical tags point to the intended indexable version (see Section 4).

## 2.5 Website Identity

The brand name is **Fabrillke** and the canonical domain is **fabrillke.com**
(`01-overview.md` §1.0). Every title, `og:site_name`, `Organization`/`WebSite` JSON-LD
name, canonical URL, sitemap URL and `robots.txt` sitemap reference uses these.

Read them from `frontend/src/lib/site.ts` (`SITE_NAME`, `SITE_URL`, `absoluteUrl()`,
`pageTitle()`) — never hardcode the name or domain in a page, and never emit a
placeholder like "Fashion Store" or "E-commerce Platform".

## 3. Sitemap & robots.txt

- `sitemap.xml` generated via Next.js's sitemap convention (`app/sitemap.ts` or equivalent), dynamically including all published products and categories — not a static hand-maintained list that goes stale as the catalogue changes.
- Out-of-stock, unpublished/draft, or admin-only content is **excluded** from the sitemap.
- `robots.txt` allows crawling of customer-facing storefront routes and **disallows** the Admin/Manager back-office routes, API routes, and any internal/preview paths.
- Sitemap references the canonical domain — `https://fabrillke.com` in production — resolved from `SITE_URL` in `frontend/src/lib/site.ts`, which honours `NEXT_PUBLIC_SITE_URL` so a preview/staging deployment canonicalizes to itself. Never hardcode a different domain than the one actually served.

## 4. Canonical URLs

- Every indexable page sets an explicit canonical URL via the Metadata API — required even when the URL is already "clean," since it protects against duplicate-content issues from query strings, trailing slashes, or `www`/non-`www` variants.
- A product reachable via multiple category paths (if the catalogue structure allows that) canonicalizes to one primary URL, not one canonical per category path.
- WhatsApp Click-to-Chat's product URL (`12-whatsapp-contact.md` Section 12) uses this same canonical product URL, not `window.location.href` if that would differ from canonical — keep this one source of truth.

## 5. Open Graph Metadata

- `og:title`, `og:description`, `og:image`, `og:type`, `og:url` set per page, mirroring the entity-specific metadata above (not a single site-wide OG image for every product).
- Product pages use an actual product image for `og:image` at a size that renders correctly in link previews (check the platform's minimum recommended dimensions) — not a generic logo/placeholder.
- `twitter:card` metadata set alongside Open Graph where the project's audience/channels warrant it.

## 6. JSON-LD Structured Data

- Product pages emit `Product` schema (name, image, description, price, availability, currency — BDT) via JSON-LD, matching the actual live price/stock shown on the page, not a stale cached value.
- Category/listing pages emit `BreadcrumbList` schema reflecting the real navigation path.
- Organization/website-level schema (`Organization`/`WebSite`) present at least on the homepage.
- Structured data is generated server-side from the same data source the visible page content uses — never a second, independently-maintained copy that can drift out of sync with what's actually displayed (a classic source of "structured data doesn't match visible content" SEO penalties).

## 7. Rendering Strategy

- Product and category pages use server-side rendering or static generation (with revalidation) per Section 1.1 — never a client-only rendered page for content that needs to be indexed, since that content must be present in the initial HTML response, not only after client-side JS execution.
- Pages that must reflect near-real-time stock/price still render the core indexable content (name, description, images) server-side; only the live stock/price widget may hydrate client-side on top of that.

## 8. Performance as an SEO Input

- Homepage and product/category pages avoid render-blocking patterns that would hurt Core Web Vitals: oversized unoptimized images (use Next.js `Image`), unnecessary client-side JS on the critical path, layout shift from late-loading content (campaign banners, homepage CMS sections per `13-homepage-cms.md` Section 13.15).
- No autoplay media, no unbounded third-party script loading on storefront pages (this also matches the project's general "no decorative bloat" design principle).

---

## General rules for this project

- **Verify with real output, not just code presence** — check that two different product pages actually render different `<title>`/meta tags/JSON-LD, not just that a `generateMetadata` function exists somewhere.
- **Sitemap and canonical URLs must stay in sync with the actual published/unpublished state of catalogue and CMS content** — a product hidden from the storefront but still in the sitemap, or vice versa, is a real bug, not a nitpick.
- **SEO metadata is backend-data-driven, never hardcoded per page** — product/category names, prices, and descriptions come from the same data source the page itself renders from, matching the project's general rule that the backend/database is the single source of truth.
- **Don't introduce a second metadata mechanism outside the Next.js Metadata API** (e.g. a manual `<Head>` component from an older Next.js pattern) — use the currently-established convention consistently across all pages.
