# Spec 12 — WhatsApp Product Contact (Click-to-Chat) — Implementation Plan

## Context

Spec `.claude/project requirment documents/12-whatsapp-contact.md` requires a frontend-only
"Chat on WhatsApp" button on the product detail page, built entirely from a `wa.me` link
with no backend endpoint and no WhatsApp Business API integration. This plan designs the
reusable link-building logic, the config, and the button component so they are ready to
drop into the product detail page.

**Scope note (confirmed with user):** the customer-facing product detail page
(`frontend/src/app/product/[slug]/page.tsx` or similar) does not exist yet — only the admin
product editor (`frontend/src/app/admin/(shell)/catalogue/products/[id]/page.tsx`) exists.
Building that page is a separate, larger piece of work and is **out of scope** here. This
plan delivers the WhatsApp feature as self-contained, reusable pieces (helper + component +
config) with a documented integration contract, so whoever builds the product page later
(or a follow-up task) can wire it in with no further design decisions.

## 1. Config: WhatsApp number (fail-closed, single source of truth)

New file: `frontend/src/lib/whatsapp.ts`

- Reads `process.env.NEXT_PUBLIC_WHATSAPP_NUMBER` once, exposes a `getWhatsAppNumber()`
  (or a pre-computed constant, matching `site.ts`'s style) that returns the number or
  `null`/`undefined` if unset/empty.
- Validate format once (digits only, no `+`, no spaces — matches `wa.me` requirement, e.g.
  `8801XXXXXXXXX`). If set but invalid, treat as unset and log a warning in development
  (`process.env.NODE_ENV !== 'production'`), consistent with spec 12.4's "logged/flagged in
  development builds."
- Unlike `frontend/src/lib/site.ts`'s `NEXT_PUBLIC_SITE_URL` (which falls back to a
  production default), this must **fail closed**: no fallback value — absent/invalid means
  "don't render the button."
- Add `NEXT_PUBLIC_WHATSAPP_NUMBER=` to `frontend/.env.example` with a comment showing the
  expected format.

## 2. Link builder: `buildWhatsAppLink`

Same file (`frontend/src/lib/whatsapp.ts`), exported alongside the config helper:

```ts
buildWhatsAppLink(params: {
  productName: string;
  productId?: string | null;
  selectedSize?: string | null;
  selectedColor?: string | null;
  productUrl: string;
}): string | null
```

- Returns `null` if the WhatsApp number is unset/invalid (caller uses this to decide
  whether to render the button — keeps the fail-closed rule in one place).
- Assembles the message per spec 12.5 template, omitting any field that is absent — no
  literal `undefined`, `null`, or dangling labels like `"Product ID: "`.
- `productUrl` is expected to already be the canonical URL, built via
  `absoluteUrl()` from `frontend/src/lib/site.ts` (per that file's own doc comment, which
  anticipates this use) — this helper does not compute the URL itself, so it stays
  independent of routing/`window.location`.
- Passes the assembled message through `encodeURIComponent` and appends it as the `text`
  query param to `https://wa.me/<NUMBER>?text=...`.
- Pure function, fully unit-testable without DOM/router mocking.

## 3. Component: `WhatsAppChatButton`

New file: `frontend/src/components/WhatsAppChatButton.tsx` (storefront-scoped, not under
`components/admin/`).

- Props mirror `buildWhatsAppLink`'s params (`productName`, `productId?`, `selectedSize?`,
  `selectedColor?`, `productUrl`).
- Calls `buildWhatsAppLink` internally; if it returns `null` (number unset/invalid), the
  component renders nothing (`return null`) — satisfies "fail closed, no broken link
  shown."
- Renders a plain `<a>` tag (not `window.open`) with `href` set to the constructed link,
  `target="_blank"`, `rel="noopener noreferrer"`.
- Styling: no icon library is installed in `frontend/package.json` (only `next`/`react`/
  `react-dom` + Tailwind/TS tooling) and spec 12.7 explicitly forbids adding one — use an
  inline SVG WhatsApp glyph (small, hand-written path) or a text-only label, styled with
  Tailwind to sit naturally next to a Buy Now / Add to Wishlist button (secondary/outline
  visual weight, 44px min tap height, consistent with the sizing convention already used in
  `frontend/src/components/admin/Button.tsx`). No new Button component is created for this
  — `admin/Button.tsx` is admin-scoped and not reused directly, but its variant/sizing
  conventions inform this component's Tailwind classes.
- Mobile-first per project rules: button wraps/stacks correctly next to the primary action
  on narrow viewports.

## 4. Integration contract (for later product-page work)

Document (in the component's file, as a short comment, and in the PR/commit description —
not a new markdown doc) that the product detail page should render:

```text
In stock:      <BuyNowButton />        <WhatsAppChatButton productUrl={absoluteUrl(...)} ... />
Out of stock:  <AddToWishlistButton /> <WhatsAppChatButton productUrl={absoluteUrl(...)} ... />
```

with `productId` sourced from the product's `sku` (per `ProductResponse.sku` in
`frontend/src/lib/admin/types.ts`, which may be `null` — omitted when null) and
`selectedSize`/`selectedColor` sourced from whatever variant-selection state that page
implements — this plan does not invent that state since the page doesn't exist yet.

## 5. Tests

New test file (frontend test location, mirroring existing frontend test conventions):

- `buildWhatsAppLink`:
  - includes all fields when present, correctly `encodeURIComponent`-escaped (verify Bangla
    text and punctuation round-trip)
  - omits SKU/size/color individually and in combination without leaving blank labels or
    `undefined`/`null` literals
  - returns `null` when the WhatsApp number is unset or fails format validation
- Config helper: valid number passes, missing/malformed number fails closed, dev-mode
  warning is logged (assert via console spy, not by asserting on button rendering — no
  product page exists to render it in yet).
- `WhatsAppChatButton`: renders `null` when the link builder returns `null`; renders an
  anchor with correct `href`, `target="_blank"`, `rel="noopener noreferrer"` attributes
  when the number is configured.

## Files touched

- `frontend/src/lib/whatsapp.ts` (new) — config + `buildWhatsAppLink`
- `frontend/src/components/WhatsAppChatButton.tsx` (new)
- `frontend/.env.example` (add `NEXT_PUBLIC_WHATSAPP_NUMBER`)
- Corresponding test file(s) for the above two new modules

## Explicitly not done

- No product detail page (prerequisite, separate task)
- No backend route/controller/service — spec 12.2 forbids this
- No new npm dependency (icon library, WhatsApp SDK)
- No outbound-click analytics event — none exists generically in the project today
  (`frontend/src/lib/analytics.ts` only fires named Meta events), and spec 12.8 does not
  require adding one

## Verification

- `npm run typecheck` / `npm run build` in `frontend/` to confirm the new files compile
  cleanly with no product page consuming them yet.
- Run the new unit tests for `buildWhatsAppLink` and `WhatsAppChatButton`.
- Manually render `<WhatsAppChatButton productName="Test" productUrl="https://fabrillke.com/product/test" />`
  in a throwaway page/story (or Storybook if present) with `NEXT_PUBLIC_WHATSAPP_NUMBER`
  set and unset, to visually confirm fail-closed behavior and the constructed link opens
  WhatsApp Web/app correctly.
