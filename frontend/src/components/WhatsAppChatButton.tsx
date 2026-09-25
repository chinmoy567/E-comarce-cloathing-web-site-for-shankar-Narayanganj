/**
 * Chat on WhatsApp button (spec 12, implementation spec 19).
 *
 * The single shared component used everywhere this feature appears (§12.7).
 * Placement contract for the product detail page (spec 07, not yet built):
 *
 *   In stock:      <BuyNowButton />        <WhatsAppChatButton href={...} />
 *   Out of stock:  <AddToWishlistButton /> <WhatsAppChatButton href={...} />
 *
 * `href` is built via `buildWhatsAppLink()` from `lib/whatsapp.ts`, using the
 * canonical product URL (`absoluteUrl()` from `lib/site.ts`), not
 * `window.location.href` (`seo` skill §4).
 */

export function WhatsAppChatButton({ href }: { href: string | null }) {
  if (!href) return null; // fail closed (§12.4)

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border-2 border-[#DC143C] bg-white px-4 text-sm font-bold text-[#DC143C] sm:w-auto"
    >
      Chat on WhatsApp
    </a>
  );
}
