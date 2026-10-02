# Plan — Spec 19: WhatsApp Click-to-Chat (gap-closing)

## Context
Spec 19 (`.claude/implementation specs/19-whatsapp-click-to-chat.md`, reqs `12-whatsapp-contact.md`) is a **frontend-only** feature: a `wa.me` button on the product detail page. Exploration shows the core is **already built**; this slice closes the remaining gaps (spec's own "Frontend gap audit" items 1–6 + acceptance criteria not yet met) and fills the missing tests. No backend, DB, migration or dependency change.

## Already done (do not rewrite)
- `frontend/src/lib/whatsapp.ts` — env read + one-time validation, fail-closed, dev-only warn, `buildWhatsAppLink()`. Matches spec verbatim.
- `frontend/src/components/WhatsAppChatButton.tsx` — anchor, `target=_blank`, `rel=noopener noreferrer`, null → renders nothing.
- `ProductDetail.tsx` — derives `isOutOfStock`, rebuilds link from selected size/colour/SKU, passes canonical URL (`absoluteUrl('/product/${slug}')` from `app/product/[slug]/page.tsx`).
- `frontend/.env.example` documents `NEXT_PUBLIC_WHATSAPP_NUMBER`.
- `frontend/tests/whatsapp.test.ts` — covers tests 1–4, 6–7 partially, 11 (single-source grep).

## Gaps to close

### A. `components/WhatsAppChatButton.tsx` (spec gaps 1–4, 6)
1. Append `<span className="sr-only"> (opens in a new tab)</span>` inside the anchor; visible label stays exactly "Chat on WhatsApp".
2. `min-h-[44px]` → `min-h-[48px]` (match Buy Now).
3. Replace hard-coded `border-[#DC143C] bg-white text-[#DC143C]` with tokens `border-primary bg-background text-primary` (tokens exist in `tailwind.config.ts`).
4. Add `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`.
5. No `onClick`, no `track()`, no `lib/analytics` import (guard stays a pure anchor).

### B. `components/product/ProductDetail.tsx` (spec gaps 2, 5)
- **Breakpoint bug:** `tailwind.config.ts` defines `sm = 375px`, so the current `sm:flex-row` / `sm:w-auto` puts buttons side by side at 375px — violates acceptance 21 (stacked, full width at 375px; side by side from 768px). Change the action row to `flex-col gap-sm md:flex-row` and the buttons' `sm:w-auto` → `md:w-auto` (including in `WhatsAppChatButton`).
- Align Add to Wishlist and Add to Cart heights to `min-h-[48px]` (primary row uniform).
- Keep §12.3 pairing as is: out of stock → Wishlist + WhatsApp, no Buy Now. (Note: existing in-stock row also shows Add to Cart — an extra button beyond the spec's "Buy Now + WhatsApp"; leave it, it is spec 02/09 behaviour, flag only.)

### C. Out-of-scope observations (flag, don't fix)
- **Add to Wishlist is a no-op `<button>`** — spec 09 wishlist wiring isn't connected here. Not part of spec 19; mention to user.
- Spec acceptance examples say `/p/premium-t-shirt`; real route is `/product/[slug]` (spec decision already recorded). No change.

## Tests (`frontend/tests/`, vitest env is `node`, `.ts` only, no testing-library/jsdom)
Extend `whatsapp.test.ts` only for missing cases; **do not add dependencies** (acceptance 15). Spec-wise folder rule in CLAUDE.md applies to `backend/tests`; frontend tests stay flat as existing.
- Test 5: canonical URL in message — query-param page URL not leaked (builder uses the passed canonical value; assert with `?utm_source=fb`-style input absent).
- Test 8 (stock pairing), 9 (element/attrs), 10 (no PII): without a DOM renderer, implement as **source-structure assertions** (read component source: has `target="_blank"`, `rel="noopener noreferrer"`, no `window.open`, no `onClick`/`analytics` import; `ProductDetail` renders Buy Now only in the in-stock branch and WhatsApp in both; `WhatsAppLinkInput` has only the 5 product fields). Alternative `react-dom/server` `renderToStaticMarkup` (already a React dep) for the component's rendered HTML — preferred for attribute checks if the vitest config can include `.tsx`; requires adding `tests/**/*.test.tsx` to `include` and a JSX transform (esbuild handles this natively).
- Test 12: repo-level assertion no `backend/` file references WhatsApp (grep-style, like the existing single-source test).
- Add `NEXT_PUBLIC_WHATSAPP_NUMBER` env-grep assertion is already covered (test 11).

## Verification
1. `cd frontend && npx vitest run tests/whatsapp.test.ts` and full `npm test`; `npx tsc --noEmit`; `npm run lint`.
2. `git diff --stat`: only `frontend/src/components/WhatsAppChatButton.tsx`, `ProductDetail.tsx`, `frontend/tests/*`; **no** `package.json`, **no** `backend/`, no migration (acceptance 15, 16).
3. `grep -r "wa.me" frontend/src` and `grep -r NEXT_PUBLIC_WHATSAPP_NUMBER frontend/src` → only `lib/whatsapp.ts` (13, 14).
4. Browser (run skill): with a valid number — in-stock product shows Buy Now + WhatsApp, out-of-stock shows Wishlist + WhatsApp; href decoded text matches template; changing size updates href; 375px stacked/full width, 768px+ side by side, no horizontal scroll; unset/`+880…` number → no button; view-source shows the anchor (JS-off, acceptance 12).
5. Check `.env.local` number is valid format (don't print it).

## Decision for the user
Whether to render tests via `react-dom/server` (needs `.tsx` in vitest include) or use source-structure assertions only. Default: `renderToStaticMarkup`, falling back to source assertions if config friction.
