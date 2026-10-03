import { formatMoney } from '@/lib/account';
import type { CheckoutPricing } from '@/lib/publicTypes';

/**
 * Pure view-model for the checkout shipping line (spec 21 frontend). The browser only DISPLAYS the
 * figures `POST /api/checkout/validate` returned; it never computes, estimates, rounds, defaults or
 * caches a shipping amount, discount or total, and never sends one (the backend `.strict()` schema
 * would reject it). Kept free of React so it is unit-testable in the node-only vitest environment.
 */

export type PricingPhase = 'idle' | 'loading' | 'ready' | 'error';

export type PricingLineInput = { productId: string; variantId: string | null; quantity: number };

export type PricingAddress = { district: string; areaUnitType: string };

export type PricingRequest = {
  lines: PricingLineInput[];
  couponCode?: string;
  delivery?: { district: string; areaUnitType: 'UPAZILA' | 'THANA' };
};

function isAreaUnitType(value: string): value is 'UPAZILA' | 'THANA' {
  return value === 'UPAZILA' || value === 'THANA';
}

/**
 * The request body for the pricing preview, or `null` when it must not be made yet.
 * A guest is priced only once a district is chosen — `AddressFields` defaults `areaUnitType` to
 * THANA, so the default alone must never imply "metropolitan Dhaka". A signed-in customer is priced
 * on their saved profile address server-side, so no `delivery` is sent.
 */
export function buildPricingRequest(params: {
  lines: PricingLineInput[];
  couponCode: string | null;
  address: PricingAddress;
  isLoggedIn: boolean;
}): PricingRequest | null {
  if (params.lines.length === 0) return null;

  const base: PricingRequest = {
    lines: params.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity })),
    ...(params.couponCode ? { couponCode: params.couponCode } : {}),
  };

  if (params.isLoggedIn) return base;

  const district = params.address.district.trim();
  if (!district || !isAreaUnitType(params.address.areaUnitType)) return null;
  return { ...base, delivery: { district, areaUnitType: params.address.areaUnitType } };
}

/** Stable identity of a request, so a slow earlier response can never overwrite a newer one. */
export function pricingRequestKey(request: PricingRequest | null): string | null {
  return request ? JSON.stringify(request) : null;
}

/** True only when the response belongs to the request that is still current. */
export function isCurrentResponse(responseKey: string | null, currentKey: string | null): boolean {
  return responseKey !== null && responseKey === currentKey;
}

export type ShippingLineView = {
  /** Left-hand label. */
  label: string;
  /** Right-hand text; empty while loading so a stale figure is never shown for a new address. */
  value: string;
  busy: boolean;
  /** Set only for the error phase, to offer a Retry control. */
  retryable: boolean;
};

export function describeShippingLine(phase: PricingPhase, pricing: CheckoutPricing | null): ShippingLineView {
  switch (phase) {
    case 'idle':
      return { label: 'Shipping', value: 'Calculated once you choose your district', busy: false, retryable: false };
    case 'loading':
      return { label: 'Shipping', value: 'Calculating…', busy: true, retryable: false };
    case 'error':
      return {
        label: 'Shipping',
        value: 'Delivery charge unavailable right now. It will be calculated when you place your order.',
        busy: false,
        retryable: true,
      };
    case 'ready': {
      if (!pricing) return describeShippingLine('idle', null);
      const zone = pricing.shipping.zoneName;
      const amount = pricing.shipping.freeShippingApplied ? 'Free' : formatMoney(pricing.shippingAmount, { decimals: 2 });
      return { label: `Delivery to ${zone}`, value: amount, busy: false, retryable: false };
    }
  }
}

/** "Add ৳X more for free delivery" — purely informational, never a promise (the order response is final). */
export function freeShippingHint(remaining: number | null | undefined): string | null {
  if (remaining === null || remaining === undefined || !(remaining > 0)) return null;
  return `Add ${formatMoney(remaining)} more for free delivery`;
}

/** The Total row: a backend figure only. Never a browser-computed sum. */
export function describeTotal(phase: PricingPhase, pricing: CheckoutPricing | null): string {
  if (phase === 'ready' && pricing) return formatMoney(pricing.totalAmount);
  if (phase === 'loading') return 'Calculating…';
  return 'Calculated when you place your order';
}

/** Keys that must never appear in any request body the checkout sends. */
export const FORBIDDEN_REQUEST_KEYS = ['shipping', 'shipping_amount', 'shippingAmount', 'total', 'totalAmount', 'subtotal'] as const;
