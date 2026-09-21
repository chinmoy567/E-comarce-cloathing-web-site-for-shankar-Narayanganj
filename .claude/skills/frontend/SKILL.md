---
name: frontend
description: Frontend implementation strategy for this Bangladesh e-commerce platform — Next.js/React/TypeScript/Tailwind conventions, the design system, backend-as-source-of-truth rules, RBAC-gated admin UI, and cross-cutting checks that must pass before any storefront or back-office page ships, per .claude/project requirment documents/ and .claude/skills/design/
type: skill
version: 1.0
priority: high
---

# Frontend Skill

**For**: Bangladesh Fashion & Clothing E-Commerce Platform
**Purpose**: A checklist of the frontend rules that recur across the spec, so `frontend-builder` and reviewers check the same list every time. This skill is the cross-cutting review layer alongside `frontend-builder.md` (which owns how-to-implement instructions) — similar to how `test` sits alongside `backend-builder`/`frontend-builder`. See also the `seo` skill for SEO-specific requirements and `.claude/skills/design/SKILL.md` for the full visual/UX system.

Read the matching numbered doc in `.claude/project requirment documents/` for the feature area before building or reviewing; this skill is the index, not a replacement for reading the actual spec section.

---

## 1. Fixed Stack (Section 1.1)

Next.js, React, **TypeScript only**, Tailwind CSS. The browser/Next.js client **never talks to Supabase directly** — no Supabase client, anon key, or service-role key in frontend code, ever. All data access goes through REST calls to the Express backend.

## 2. The Frontend Is Never the Source of Truth

This is the single most-repeated rule across the spec — check it on every page/component:

- **Never compute prices, discounts, totals, or stock availability client-side as the authoritative value** (Section 8.15–8.16, `10-coupon-discount.md`; Section 5.1). The frontend may show an optimistic/preview value from the backend's preview endpoint, but must always re-render whatever the backend returns at order placement — never locally recompute and submit a final total.
- **Hiding a button, disabling a field, or checking a role client-side is UX convenience only, never authorization** (Section 5.15/5.17). Every protected action must also handle the backend's rejection gracefully if attempted directly — don't skip building that error-handling path just because the UI already hides the option.
- **Payment, order, and shipment status are three independent values** (Section 5.21.11) — never merge them into one "status" badge or infer one from another in the UI. Render each using the exact enum values from `07-order-state-machine.md`, not illustrative narrative labels from other docs.
- **Client-side form validation is for UX feedback only** — treat backend validation as the real gate, and always surface backend validation errors rather than assuming client-side validation already caught everything.

## 3. RBAC-Gated Admin/Manager UI (`06-rbac.md`, Section 5.18)

- Every admin action is gated by the Section 5.18 permission matrix, not just by role — a Manager without an `Assigned` permission (e.g. `coupon.create`, `courier.manage`) must not see or reach that action in the UI.
- Remember: the frontend gate is for UX clarity only — the corresponding backend check is what actually protects the action (see Section 2 above).

## 4. Secrets & Credentials

No courier or payment credentials, service-role keys, or admin secrets in client bundles, `NEXT_PUBLIC_*` env vars, or browser-visible network requests (Section 4.8/5.5).

## 5. Guest & Public Flows (Section 2.9, 4.14)

Guest checkout, guest order lookup, and public Track Order are unauthenticated by design — don't gate them behind a session/login check; they're validated by submitted fields (Order Number + Phone, or courier tracking ID).

## 6. WhatsApp Click-to-Chat (`12-whatsapp-contact.md`)

Construct the `wa.me` link exactly per Section 12.5 using the configured number from env/config, never hardcoded. Respect the stock-based button pairing behavior (12.6) and explicit out-of-scope items (12.2). Product URL used should match the canonical product URL (see `seo` skill), not necessarily raw `window.location.href` if those would differ.

## 7. CMS-Driven Homepage (`13-homepage-cms.md`)

Build reusable section components per Section 13.9 driven by backend-supplied section/campaign data — don't hardcode homepage content the spec defines as CMS-managed. Never trust a client-side clock to decide if a campaign is live (13.7a — that's server-evaluated).

## 8. Design System (`.claude/skills/design/SKILL.md`)

- Mobile-first: design/test at 375px first, verify at 320px, enhance at 768px+.
- English-only UI chrome (buttons, labels, navigation) — no Bangla in interface text.
- No gradients, blur, drop shadows, or decorative effects — flat, not "AI slop."
- 44px minimum touch target for buttons/inputs (48px recommended); checkboxes/radios 20×20px with 28×28px tap area.
- Only the documented palette — primary red `#DC143C`, dark gray `#1F2937`, accent green `#059669`, error red `#DC2626`, text `#111827`, background `#FFFFFF`, border `#E5E7EB`. Never invent new colors.
- High-contrast text on white; no light-gray-on-white body text. No hover-only interactions on mobile. No autoplay media.

## 9. SEO (see `seo` skill for full detail)

Every indexable storefront page uses the Next.js Metadata API with entity-specific title/description/Open Graph/canonical URL/JSON-LD — SEO is a required stack item (Section 1.1), not optional polish. Product/category pages render core content server-side (SSR/SSG), not client-only.

## 10. Error & Loading States

- Every API-consuming component handles loading, error, and empty states explicitly — never assume the happy path is the only path (courier API failures, payment verification pending, out-of-stock at checkout time are all documented failure modes elsewhere in the spec, and the UI must represent them, not silently break).
- Error messages shown to the user don't leak backend internals (stack traces, raw error objects) — this mirrors the `security` skill's error-hygiene rule from the other side of the API boundary.

---

## General rules for this project

- **Write only what's needed for the requested page/component** — no speculative abstractions, no unused config, no scaffolding for pages not yet requested.
- **Follow existing project conventions once code exists** — check folder layout (`app/` routing, component structure, hooks, state management), naming, and API-client conventions before introducing a new pattern.
- **Read the design skill before making any visual decision** — colors, spacing, breakpoints, and component specs are already decided; don't improvise them.
- **A frontend feature that trusts a client-computed price/total/permission is incomplete**, even if it "looks right" in the happy path — verify the backend actually re-validates before calling the feature done.
