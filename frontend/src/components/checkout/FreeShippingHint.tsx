import { freeShippingHint } from '@/lib/checkoutPricingView';

/** "Add ৳X more for free delivery" — informational only; never changes an amount or a button state. */
export function FreeShippingHint({ remaining }: { remaining: number | null }) {
  const text = freeShippingHint(remaining);
  if (!text) return null;
  return (
    <p role="status" className="mt-sm text-xs text-text-secondary">
      {text}
    </p>
  );
}
