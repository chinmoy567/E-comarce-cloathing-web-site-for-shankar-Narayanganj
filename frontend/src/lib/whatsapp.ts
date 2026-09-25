/**
 * WhatsApp Click-to-Chat product contact (spec 12, implementation spec 19).
 *
 * The single place the destination number is read and the single place a
 * `wa.me` link is built — no other module in the frontend may reference
 * `NEXT_PUBLIC_WHATSAPP_NUMBER` or construct a `wa.me` URL (§12.4, §12.7).
 */

const RAW = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '';

/** International format, no symbols, no leading '+' — e.g. 8801XXXXXXXXX (§12.4). */
const WHATSAPP_NUMBER_PATTERN = /^[1-9]\d{7,15}$/;

/**
 * The configured WhatsApp number, or `null` if unset, empty, or malformed.
 *
 * Validated once at module evaluation, not at each usage site (§12.4). A
 * `null` value means the Chat on WhatsApp button must not render — fail
 * closed, never a broken `wa.me/` link shown to a customer.
 */
export const whatsappNumber: string | null = (() => {
  const trimmed = RAW.trim();
  if (!trimmed) return null;
  if (!WHATSAPP_NUMBER_PATTERN.test(trimmed)) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[whatsapp] NEXT_PUBLIC_WHATSAPP_NUMBER is set but not in the required ' +
          'international format (digits only, no leading +, no spaces or dashes). ' +
          'The Chat on WhatsApp button will not render.',
      );
    }
    return null;
  }
  return trimmed;
})();

export const isWhatsAppEnabled = whatsappNumber !== null;

export type WhatsAppLinkInput = {
  productName: string;
  productSku: string | null;
  selectedSize: string | null;
  selectedColour: string | null;
  canonicalUrl: string;
};

/**
 * Builds a `https://wa.me/<NUMBER>?text=...` link from product data already
 * available on the page (§12.5). Returns `null` when the number is not
 * configured, so callers can decide not to render the button (§12.4).
 */
export function buildWhatsAppLink(input: WhatsAppLinkInput): string | null {
  if (!whatsappNumber) return null;

  const parts: string[] = [`Hello, I am interested in ${input.productName}.`];
  if (input.productSku) parts.push(`Product ID: ${input.productSku}.`);

  const variantBits = [input.selectedSize, input.selectedColour].filter(
    (value): value is string => Boolean(value),
  );
  if (variantBits.length) parts.push(`${variantBits.join(', ')}.`);

  parts.push('Is this product available?');
  parts.push(input.canonicalUrl);

  const message = parts.join(' ');
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
}
