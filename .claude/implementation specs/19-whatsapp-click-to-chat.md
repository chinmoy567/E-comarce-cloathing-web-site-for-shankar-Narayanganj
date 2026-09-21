# 19 — WhatsApp Click-to-Chat Product Contact Button

## Goal

After this slice the product detail page carries a **Chat on WhatsApp** button beside the primary purchase action, opening the customer's own WhatsApp with a pre-filled message about that product. It is a plain `wa.me` link built client-side from data already on the page — no backend endpoint, no WhatsApp API integration, no new dependency. The button pairs with Buy Now when the product is in stock and with Add to Wishlist when it is not, and it does not render at all when the destination number is unconfigured.

## Requirement references

- `12-whatsapp-contact.md` §12.1 — a plain Click-to-Chat (`wa.me`) link; **no Messenger, no Telegram, no WhatsApp Business/Cloud API, and no backend endpoint**; a frontend-only feature.
- `12-whatsapp-contact.md` §12.2 — the explicit out-of-scope list: Messenger, Telegram, WhatsApp Business/Cloud API (no templates, webhooks, Meta Business integration, or backend SDK), and **no new backend API endpoint** — `wa.me` is a plain URL needing no server round-trip.
- `12-whatsapp-contact.md` §12.3 — the button appears on the **product detail page** alongside the primary purchase action: in stock → **Buy Now + Chat on WhatsApp**; out of stock → **Add to Wishlist + Chat on WhatsApp** (no Buy Now), consistent with the existing Out of Stock display rule.
- `12-whatsapp-contact.md` §12.4 — the number comes from a single environment/configuration variable (e.g. `NEXT_PUBLIC_WHATSAPP_NUMBER`), referenced from a shared constant/helper and **never hard-coded inline** in page or component files; it is inherently public and that is acceptable — the requirement is *single source of truth*, not secrecy; stored in international format without symbols or a leading `+` (e.g. `8801XXXXXXXXX`), validated once at startup/build or via a shared helper rather than ad hoc at each usage site; **if the variable is unset or empty the button is not rendered (fail closed)**, and the condition is logged/flagged in development builds.
- `12-whatsapp-contact.md` §12.5 — the link format `https://wa.me/<NUMBER>?text=<URL-ENCODED MESSAGE>`; the message template; the field table (product name always; SKU/product ID only if present; size/variant and colour/variant only if the product has them and one is selected; product URL always, from `window.location.href` **or the canonical product URL per §1.1's SEO rules**; a fixed availability question always); the message is passed through **`encodeURIComponent`, not manual string replacement**, so punctuation, spaces, and non-ASCII (e.g. Bangla) product names encode correctly; an unavailable field is **omitted cleanly** — no literal placeholder, no "undefined"/"null".
- `12-whatsapp-contact.md` §12.6 — clicking opens the URL in a new tab (`target="_blank"` with `rel="noopener noreferrer"`) so the customer keeps their place; mobile hands off to the app and desktop opens WhatsApp Web — **native `wa.me` behaviour requiring no platform-detection code**; the button is a **plain anchor/link element**, not a JavaScript `window.open` popup, so it works with popup blockers and with JS disabled where feasible.
- `12-whatsapp-contact.md` §12.7 — a **single shared helper/component** (`buildWhatsAppLink(product, selectedVariant)` or `<WhatsAppChatButton />`) used everywhere, rather than duplicated link construction; **no new npm dependency** — template string plus `encodeURIComponent`, both native; do not add a WhatsApp SDK or chat-widget package; styling follows the existing design system and mobile-first rules, sitting alongside Buy Now / Add to Wishlist rather than as a floating chat widget.
- `12-whatsapp-contact.md` §12.8 — **no customer personal data** in the pre-filled message (no name, phone, address, or order history) — only product information and a generic availability question; the number is configuration, not a secret, but still follows the single-source-of-truth discipline per §11.9; **no tracking pixel, analytics event payload, or third-party script** is added beyond what the project's existing analytics may already capture as a normal outbound-link click — no bespoke WhatsApp-specific tracking.
- `05-admin-operations.md` §5.1 — `Out of Stock` is derived from stock data, which is what drives §12.3's button pairing.
- `01-overview.md` §1.1 — canonical URLs, which §12.5 allows as the product URL source.
- Skills: `frontend` §6, `seo` §4, `design`.

## Depends on

- **07** — the product detail page, its variant selection state, the derived out-of-stock flag, and the canonical URL builder.
- **09** — the Add to Wishlist action that pairs with the button when out of stock.

No backend dependency of any kind — §12.1 and §12.2 both state the feature adds no backend endpoint.

## Scope

**In scope**

- `buildWhatsAppLink()` — the single link-construction helper.
- `<WhatsAppChatButton />` — the single shared component.
- Configuration reading and one-time validation of the number.
- Placement on the product detail page with the stock-driven pairing.

**Out of scope / deferred**

- Everything in §12.2: Messenger, Telegram, WhatsApp Business/Cloud API, message templates, webhooks, Meta Business account integration, any backend WhatsApp SDK, and any new backend endpoint.
- A site-wide floating chat widget — §12.7 scopes this to the product-page contact button only.
- WhatsApp-specific analytics — §12.8 forbids a bespoke tracking integration.
- Placement anywhere other than the product detail page — §12.3 names that page specifically.

## Database changes

**None.** This is a frontend-only feature (§12.1); no table, column, or migration is added.

## Backend work

**None.** §12.2 is explicit: "**No new backend API endpoint** for this feature. `wa.me` is a plain URL the browser opens directly; the frontend needs no server round-trip to build it."

The only server-side involvement is the absence of one: the product data the message uses (name, SKU, variant options, canonical URL) is already delivered by spec 07's `PublicProductDetail`, and no field is added to it for this feature.

## Frontend work

### Configuration (§12.4)

`frontend/src/lib/whatsapp.ts` is the **only** place the number is read:

```ts
const RAW = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '';

/** International format, no symbols, no leading '+' — e.g. 8801XXXXXXXXX (§12.4). */
const WHATSAPP_NUMBER_PATTERN = /^[1-9]\d{7,15}$/;

export const whatsappNumber: string | null = (() => {
  const trimmed = RAW.trim();
  if (!trimmed) return null;
  if (!WHATSAPP_NUMBER_PATTERN.test(trimmed)) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[whatsapp] NEXT_PUBLIC_WHATSAPP_NUMBER is set but not in the required ' +
                   'international format (digits only, no leading +). The Chat on WhatsApp ' +
                   'button will not render.');
    }
    return null;
  }
  return trimmed;
})();

export const isWhatsAppEnabled = whatsappNumber !== null;
```

Validated **once** at module evaluation, not at each usage site (§12.4). Unset, empty, or malformed all resolve to `null`, and the button then does not render — §12.4's fail-closed rule: "no broken link shown to customers." The development-only warning satisfies "this condition is logged/flagged in development builds," and is silent in production so the console carries nothing in front of customers.

The number being public in the rendered page is expected and acceptable (§12.4) — it is a contact number, exactly like a "Call us" link. The requirement this code satisfies is single source of truth, not secrecy.

### Link construction (§12.5, §12.7)

The single helper — nothing else in the codebase builds a `wa.me` URL:

```ts
export type WhatsAppLinkInput = {
  productName: string;
  productSku: string | null;
  selectedSize: string | null;
  selectedColour: string | null;
  canonicalUrl: string;
};

export function buildWhatsAppLink(input: WhatsAppLinkInput): string | null {
  if (!whatsappNumber) return null;

  const parts: string[] = [`Hello, I am interested in ${input.productName}.`];
  if (input.productSku) parts.push(`Product ID: ${input.productSku}.`);

  const variantBits = [input.selectedSize, input.selectedColour].filter(Boolean);
  if (variantBits.length) parts.push(`${variantBits.join(', ')}.`);

  parts.push('Is this product available?');
  parts.push(input.canonicalUrl);

  const message = parts.join(' ');
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
}
```

Against §12.5's field table:

| Field | Behaviour |
| --- | --- |
| Product name | Always included |
| SKU / product ID | Included **only if present**; the whole `Product ID: …` clause is omitted otherwise — never a blank or `undefined` (§12.5) |
| Selected size | Included only when the product has size options and one is selected |
| Selected colour | Included only when the product has colour options and one is selected |
| Product URL | Always included — the **canonical** URL (see below) |
| Availability question | Always included, fixed phrasing |

Clean omission is achieved by building an array of complete clauses and joining, so an absent field contributes no fragment at all — §12.5's "the template does not leave literal placeholder text like 'Product ID: ' with nothing after it, or 'undefined'/'null' in the output."

`encodeURIComponent` is applied to the assembled message, never manual replacement (§12.5), so spaces, punctuation, `&`, `#`, and non-ASCII Bangla product names all encode correctly.

**Canonical URL over `window.location.href`.** §12.5 permits either, and the `seo` skill §4 resolves it: "WhatsApp Click-to-Chat's product URL uses this same canonical product URL, not `window.location.href` if that would differ from canonical — keep this one source of truth." The helper therefore takes the canonical URL produced by spec 07's builder. This also means the link is correct when the page was reached with tracking query parameters, which `window.location.href` would have carried into the message.

### The component (§12.6, §12.7)

```tsx
export function WhatsAppChatButton({ href }: { href: string | null }) {
  if (!href) return null;                    // fail closed (§12.4)
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="btn-secondary">
      Chat on WhatsApp
    </a>
  );
}
```

- A **plain anchor**, not `window.open` (§12.6) — it survives popup blockers, supports middle-click and long-press, and works with JavaScript disabled when the link is built during server render.
- `target="_blank"` with `rel="noopener noreferrer"` (§12.6) so the customer keeps their place on the product page.
- **No platform detection** (§12.6) — `wa.me` itself hands off to the app on mobile and to WhatsApp Web on desktop; writing detection code would duplicate behaviour the URL already provides.
- One component used everywhere this feature appears (§12.7).

### Placement and stock pairing (§12.3)

On the product detail page from spec 07, in the action row beside the primary action:

```text
In stock:      [ Buy Now ]            [ Chat on WhatsApp ]
Out of stock:  [ Add to Wishlist ]    [ Chat on WhatsApp ]
```

The pairing is driven by the same derived `isOutOfStock` flag spec 07 already computes from stock data — no new stock concept is introduced. When out of stock, **Buy Now is absent**, per the existing display rule (§12.3, §5.1).

The link is rebuilt whenever variant selection changes, so the message always reflects the customer's current choice (§12.5's "Current variant selection state on the page").

### Styling (§12.7, `design` skill)

- Secondary-button treatment: white background, 2px `#DC143C` border, `#DC143C` 14px bold text, 8px radius, 44px minimum height, full width on mobile and auto on desktop. Colours are limited to the documented palette — **WhatsApp brand green is not used**, because the `design` skill permits no colour outside the defined set and the CLAUDE.md priority order puts requirement and design rules above brand convention.
- Sits inline beside the primary action, **never as a floating chat widget** (§12.7).
- English label, exactly "Chat on WhatsApp" (§12.3's wording and the design system's English-only rule).
- 44px minimum touch target with 8px spacing from the adjacent button.

### No new dependency (§12.7)

Template string plus `encodeURIComponent`, both native. No WhatsApp SDK, no chat-widget package, no icon library added for this — if an icon is used, it comes from the project's existing icon set.

## Security requirements

- **No personal data in the message** (§12.8) — the input type carries only product fields. Name, phone, address, email, cart contents, and order history have no representation in `WhatsAppLinkInput`, so including them would require deliberately changing the type. The customer types anything further themselves inside WhatsApp.
- **`rel="noopener noreferrer"`** (§12.6) prevents the opened tab from accessing `window.opener` and suppresses the `Referer` header.
- **Fail closed** (§12.4) — an unset or malformed number renders no button rather than a broken `wa.me/` link.
- **Correct encoding** (§12.5) — `encodeURIComponent` on the whole message means a product name containing `&`, `#`, or a quote cannot truncate or corrupt the query string; the message is a `text` parameter to a third-party URL, not markup, so there is no injection surface beyond correct encoding.
- **No secret involved** (§12.4) — the number is configuration, deliberately public, and its handling follows §11.9's single-source-of-truth discipline rather than a secrecy requirement.
- **No third-party script** (§12.8) — the feature adds no script tag, so the CSP needs no new `script-src` entry. Only a link is rendered.
- **No new attack surface on the backend** — there is no endpoint to attack (§12.2).
- **No bespoke tracking** (§12.8) — no analytics event is added for this button. If the project's existing analytics already records outbound-link clicks generically, that generic mechanism applies unchanged; nothing WhatsApp-specific is introduced, and no new event name is added to spec 18's closed taxonomy.

## Data integrity / idempotency

Not applicable in the usual sense — this slice writes no data, creates no order, and calls no API. Two consistency properties are worth stating:

- **One link builder, one number source** (§12.4, §12.7) — a stale or wrong number cannot appear in one place while another is correct, because there is exactly one constant and one helper.
- **The product URL is the canonical one** (`seo` §4), so the link a customer shares over WhatsApp is the same URL the site publishes to search engines and Open Graph — one identity per product, not three variants.

## Acceptance criteria

1. With `NEXT_PUBLIC_WHATSAPP_NUMBER=8801712345678`, the product detail page renders a **Chat on WhatsApp** button whose `href` is `https://wa.me/8801712345678?text=…`.
2. With the variable unset or empty, **no button renders**, no broken link appears, and the page is otherwise unchanged (§12.4).
3. With a malformed value (`+8801712345678`, `880-171-234-5678`, or `abc`), no button renders and a development-mode console warning appears; in a production build the warning is absent (§12.4).
4. For an **in-stock** product the action row shows **Buy Now** and **Chat on WhatsApp**; for an **out-of-stock** product it shows **Add to Wishlist** and **Chat on WhatsApp**, with **no Buy Now** (§12.3).
5. The decoded `text` parameter for a product with a SKU and a selected size and colour reads: `Hello, I am interested in Premium T-Shirt. Product ID: TSH-001. M, Navy. Is this product available? https://…/p/premium-t-shirt`.
6. For a product with **no SKU**, the message contains no `Product ID:` clause at all — not an empty one (§12.5).
7. With **no variant selected**, the message contains no variant clause, and the words `undefined` and `null` appear nowhere in it (§12.5).
8. Changing the selected size updates the `href` without a page reload.
9. A product named `Men's Panjabi & Cap — "Eid" Special` and one with a Bangla name both produce a correctly encoded URL that opens in WhatsApp with the name intact (§12.5).
10. The product URL in the message is the **canonical** URL — reaching the page with `?utm_source=fb` still yields the clean canonical URL, not `window.location.href` (`seo` §4, §12.5).
11. The rendered element is an `<a>` with `target="_blank"` and `rel="noopener noreferrer"`; no `window.open` call exists in the component (§12.6).
12. With JavaScript disabled, the server-rendered link is present and clickable (§12.6).
13. `grep -r "wa.me" frontend/src` matches **only** `lib/whatsapp.ts` (§12.7).
14. `grep -r "NEXT_PUBLIC_WHATSAPP_NUMBER" frontend/src` matches **only** `lib/whatsapp.ts` (§12.4).
15. `git diff` for this slice adds **no** dependency to `package.json` (§12.7).
16. `git diff` for this slice touches **no** file under `backend/` and adds no migration (§12.1, §12.2).
17. The message contains no customer name, phone, email, address, cart contents, or order reference (§12.8).
18. No new analytics event fires on click; spec 18's event taxonomy is unchanged (§12.8).
19. No new script tag or CSP origin is added (§12.8).
20. The button uses the documented palette secondary-button style, is at least 44px tall, sits inline beside the primary action, and is not a floating widget (§12.7, `design`).
21. At 375px both buttons are full width and stacked with 8px spacing, with no horizontal scroll; at 768px+ they sit side by side.

## Tests required

Per the `test` skill §5 — this is a presentational, no-business-logic feature, so coverage is focused on the link-construction rules explicitly stated (§12.5) and the fail-closed rule required (§12.4).

1. **Message composition with every field present** (§12.5) — the decoded text matches the documented template exactly.
2. **SKU omitted cleanly** (§12.5) — no `Product ID:` fragment, no empty clause, no `undefined`.
3. **Variant omitted cleanly** (§12.5) — no variant clause when nothing is selected; size-only and colour-only cases each covered, since §12.5 makes them independently optional.
4. **Encoding correctness** (§12.5) — names containing spaces, `&`, `#`, `?`, quotes, and Bangla characters all round-trip through `decodeURIComponent` unchanged. This is the rule §12.5 singles out by insisting on `encodeURIComponent` over manual replacement.
5. **Canonical URL used** (§12.5, `seo` §4) — a page loaded with query parameters produces the canonical URL in the message.
6. **Fail closed** (§12.4) — unset, empty, whitespace-only, and malformed values each produce a `null` link and no rendered button.
7. **Number format validation** (§12.4) — a leading `+`, dashes, spaces, and non-digits are all rejected; a valid international number is accepted; validation runs once, not per call.
8. **Stock-driven pairing** (§12.3) — in stock renders Buy Now + WhatsApp; out of stock renders Add to Wishlist + WhatsApp and **no** Buy Now. One test per branch.
9. **Element and attributes** (§12.6) — an `<a>` with `target="_blank"` and `rel="noopener noreferrer"`; asserting the absence of `window.open`.
10. **No personal data** (§12.8) — a test rendering the button with a logged-in customer in session asserts that no customer field appears in the message.
11. **Single source of truth** (§12.4, §12.7) — a repository-level assertion that `wa.me` and the env var each appear in exactly one module.
12. **No backend footprint** (§12.1, §12.2) — a repository-level assertion that no backend route, service, or migration references WhatsApp.

## Open questions / assumptions

1. **Product ID vs. SKU.** §12.5's template says `Product ID: [ID]` while the field table names the source as "Product SKU / product ID," to be included "only if the product has one." Spec 05 makes `sku` nullable and `products.id` a UUID that spec 07 deliberately never exposes. *Assumption:* use the SKU when present and omit the clause otherwise — sending an internal UUID would both be useless to the shop staff reading the message and contradict spec 07's rule that internal identifiers stay off customer-facing surfaces.
2. **Variant formatting in the message.** §12.5's template shows `[Variant details]` without a format. *Assumption:* the selected values joined with a comma (`M, Navy`), which reads naturally in a chat message and needs no label scaffolding that could leave a dangling fragment when one value is absent.
3. **Button colour.** WhatsApp's brand green (`#25D366`) is conventional for this button, but the `design` skill states "Never invent new colors" and lists a fixed palette, and §12.7 says styling follows the existing design system. *Assumption:* the standard secondary-button style (white with a `#DC143C` border). **Flagged** as a deliberate departure from platform convention in favour of the project's own rule; a single explicit client decision could add the brand colour as a documented palette addition.
4. **Icon.** Neither §12 nor the design system mentions one. *Assumption:* text-only label, or an icon from the project's existing set if one is already in use — §12.7 forbids adding a package for this.
5. **Outbound-link analytics.** §12.8 permits whatever "generic mechanism" already exists for outbound-link clicks but forbids a bespoke integration. *Assumption:* no such generic mechanism exists (spec 18 implements a closed set of seven Meta events, none of which covers outbound clicks), so nothing is tracked. **Flagged:** if the client later wants click volume on this button, §12.8 means that must be a general outbound-link mechanism, not a WhatsApp-specific one.
6. **Server-rendered vs. click-time construction.** §12.5 allows either "at click time or render time." *Assumption:* render time, recomputed on variant change — this is what makes §12.6's "works identically with JS disabled where feasible" achievable, since the link exists in the server-rendered HTML.
