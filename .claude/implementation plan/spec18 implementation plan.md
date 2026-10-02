# Spec 18 — Meta Pixel + CAPI: gap-closing plan

## Context
Spec 18 (`.claude/implementation specs/18-meta-pixel-and-conversions-api.md`, PRD `08-analytics-meta.md`) was mostly built earlier under the old "spec 8" label (tests in `backend/tests/spec-08-analytics-meta/`). Exploration found the core exists; ~12 gaps remain between the code and the spec's final decisions. This plan closes those gaps without rebuilding working parts (CLAUDE.md §9).

**Already done (reuse, don't rewrite):** `shared/src/analytics/metaEvents.ts` (contract, `@shared/analytics` alias both sides); `backend/src/services/analytics/metaCapi.ts` (safeFetch, 3s timeout, no retry, SKIPPED when unconfigured); `metaUserData.ts` (SHA-256); `POST /api/analytics/event` (route/controller/zod strict, rejects Purchase + `value`); `meta_event_log` table + unique Purchase index already in `migrations/0007_meta_events.sql`; `confirmOrder` in `services/orderStatus.service.ts:78-153` calls `emitPurchaseForOrder` post-commit; `TrackEvent.tsx`.

**Key facts that shape the plan**
- No migration 0018 needed for the table (0007 has it). Only a delta if retention pruning is added.
- No `order.confirmed` event bus exists; the post-commit direct call in `confirmOrder` is the single trigger. Keep it (smallest change); it satisfies "single place" §6.3.
- Cart is client-side (no backend cart) and `POST /api/checkout/validate` / `CheckoutPricing` (spec 21) don't exist. So spec's "server resolves cart / CheckoutPricing.totalAmount" can't be literal yet.

## Backend changes
1. **Purchase id → `purchase:<order_number>`** in `services/analytics/purchaseEvent.ts` (currently `purchase_<uuid>`).
2. **Insert-first idempotency**: claim the `meta_event_log` row (unique `(event_name, order_id)` index, ON CONFLICT DO NOTHING) *before* sending; skip send if no row claimed; then update row to SENT/FAILED + `http_status`. Touches `repositories/analytics.repository.ts`, `metaCapi.ts` (currently logs after send). Populate `value_amount`.
3. **Purchase user data**: add nothing new beyond order contact fields (guest parity already single-path); confirm no IP/UA needed (none available post-commit).
4. **`purchaseEventId`** added to `GuestOrderView` and `CustomerOrderDetailView` in `services/customerOrderViews.service.ts` (non-null once order has reached CONFIRMED, i.e. a `meta_event_log` Purchase row exists or status past CONFIRMED); update types/validation.
5. **Ingestion schema** (`validation/analytics.validation.ts`, controller): add `payload.contents[{id, quantity int}]` (price/value key → 400), `fbp`/`fbc` (≤256 chars, Meta cookie format); forward fbp/fbc into `user_data`.
6. **Server-side value for CAPI copy**: resolve `contents` ids/quantities against DB product/variant prices and compute `value` + `currency: BDT` server-side (new helper in `services/analytics/`). Browser values are never trusted.
7. **Graph API call check**: verify against current Meta CAPI docs (CLAUDE.md §6) whether the token should be `access_token` param vs the current `Authorization: Bearer`, and pin `META_GRAPH_API_VERSION` (currently defaults `v18.0`). Add `META_*` vars to `backend/.env.example`.
8. **Retention (optional, spec OQ7)**: prune non-Purchase `meta_event_log` rows >90d — only if you want it; would be migration `0017/0018` delta. Default: defer.
9. **Verify prod runtime** resolves `@shared/*` for `tsc` build + `node dist` (no runtime alias) — check before relying on it; fix only if broken.

## Frontend changes
1. **`lib/analytics.ts`**: module-level init guard + `window.fbq` check, full stub (`queue/loaded/version`); param allowlist; drop production `console.error`; read `_fbp/_fbc` from `document.cookie` and include in POST; POST `contents` (ids+qty only), never `value`; add `firePixelPurchase({eventId,value,currency,contents})` (fbq only, never posts to backend).
2. **`components/PixelInit.tsx`**: depend on `[pathname]` only, ref-guard StrictMode, no `content_name`, skip `/admin`; then simplify the `Suspense` in `app/layout.tsx:70` if `useSearchParams` removed.
3. **New `components/analytics/PurchasePixel.tsx`**: mounted on `app/account/orders/[orderNumber]/page.tsx` and guest lookup result (`components/orders/GuestOrderLookupForm.tsx`); fires once per `purchaseEventId` using backend `amounts.totalAmount`, fired-set in localStorage (try/catch).
4. **Remove browser-computed values**: `components/checkout/CheckoutWizard.tsx:87,97-117` (subtotal/displayTotal), `components/product/ProductDetail.tsx` AddToCart (`value: displayPrice*qty`) and ViewContent (`value: product.minPrice` — copy of a backend field, acceptable) → send ids/quantities only; Pixel `value` omitted unless it is a verbatim backend field. Since no server checkout pricing exists yet, InitiateCheckout/AddPaymentInfo Pixel copies omit `value`/`currency` (spec's own interim rule); CAPI copy computes merchandise subtotal server-side.
5. **Search**: `app/products/page.tsx:52` add capped `content_ids` of results.
6. **CSP** in `frontend/next.config.mjs` (currently only frame-ancestors/base-uri/object-src/form-action): spec requires `script-src https://connect.facebook.net`, `connect-src` + `img-src https://www.facebook.com`. Adding `script-src` conflicts with Next inline scripts (needs nonces) — **do not add a strict script-src now**; document the origins required and leave until a nonce-based CSP lands.

## Tests (per CLAUDE.md §10; add to existing `spec-08-analytics-meta` folder, which maps to spec 18)
Note: real vitest configs live at `backend/config/vitest/specNN/vitest.config.ts`, not `backend/vitest.specXX.config.ts` as CLAUDE.md says. Add a `spec18` config + `test:spec18` script (or extend `spec08`) and register new files.
Backend (use `testing-agent`/`/test 18`): Purchase timing (not at placement, not at PAID_VERIFIED, once at CONFIRMED for bKash and COD); duplicate emission blocked by unique index and *no second outbound call*; no event on CANCELLED/RETURNED; deterministic `purchase:<orderNumber>` id; discounted value; ingestion rejects Purchase/`value`/price-in-contents; fbp/fbc forwarding; server-computed value; hashed-only user_data key-set + prohibited-field assertion; failure isolation (500 + timeout → confirm still succeeds); single attempt; SKIPPED when unconfigured; guest parity; closed taxonomy; currency BDT; `purchaseEventId` in both payloads.
Frontend (`frontend/tests/analytics.*.test.ts`): same `eventId` for fbq and POST; no `value` in POST; init idempotent; no fire on `/admin`; `firePixelPurchase` doesn't POST; PurchasePixel fires once per id.

## Verification
- `npm run test:spec18` (or spec08) and full backend + frontend `vitest`; `tsc` + lint on both workspaces.
- `grep -ri META_CAPI_ACCESS_TOKEN frontend/` empty; build and grep the client bundle.
- Run the app (`run` skill): with Pixel ID set, check network tab shows fbq + `/api/analytics/event` with identical event_id on ViewContent/Search/AddToCart/Initiate/AddPaymentInfo; place an order → no Purchase; verify/confirm in admin → exactly one `meta_event_log` Purchase row (SQL count = 1); unset META vars → site works, rows SKIPPED.
- Update memory file for spec 18 status afterwards.

## Open points to confirm
- Cart is client-side and spec 21 checkout pricing is absent: plan uses interim rules above (omit Pixel value for checkout events; server recomputes merchandise subtotal for CAPI). Coupon-discounted value for InitiateCheckout/AddPaymentInfo (§8.31) stays unmet until spec 21.
- Retention pruning: defaulting to deferred.
