import { withTransaction } from '../lib/transaction.js';
import { NotFoundError } from '../lib/errors.js';
import * as customersRepository from '../repositories/customers.repository.js';
import * as usersRepository from '../repositories/users.repository.js';
import { fieldError, priceCheckout, type CheckoutLineInput } from './checkoutPricing.js';
import { computeShipping, type ShippingQuote } from './shipping/computeShipping.js';
import type { AreaUnitType } from '../types/enums.js';

/**
 * Advisory read paths for shipping (spec 21). Neither writes anything: `createOrder()` always
 * recomputes from the persisted address, and anything the client sees here is a preview.
 */

export type CheckoutPricingView = {
  currency: 'BDT';
  subtotal: number;
  discountAmount: number;
  shippingAmount: number;
  totalAmount: number;
  appliedCoupon: { code: string; discountAmount: number } | null;
  /** The §8.22 message when the code is rejected. */
  couponMessage: string | null;
  shipping: { zoneName: string; freeShippingApplied: boolean; freeShippingRemaining: number | null };
};

/**
 * POST /api/checkout/validate. A registered customer is always priced on their saved profile
 * address (what createOrder() will use), so the preview cannot disagree with the placed order; a
 * guest must send `delivery`.
 */
export async function previewCheckout(input: {
  actorUserId: string | null;
  lines: CheckoutLineInput[];
  couponCode?: string | null;
  delivery?: { district: string; areaUnitType: AreaUnitType };
}): Promise<CheckoutPricingView> {
  return withTransaction(async (client) => {
    let address: { division: string; district: string; areaUnitType: AreaUnitType };
    let customer: { customerId: string | null; isRegistered: boolean };

    if (input.actorUserId) {
      const user = await usersRepository.findById(input.actorUserId, client);
      const registered = user?.customerId ? await customersRepository.findById(user.customerId, client) : null;
      if (!registered) throw new NotFoundError('Customer not found.');
      if (!registered.address.district.trim()) {
        throw fieldError('district', 'Add your district to your profile to see the delivery charge.');
      }
      address = registered.address;
      customer = { customerId: registered.id, isRegistered: true };
    } else {
      if (!input.delivery) throw fieldError('delivery', 'Choose your district to see the delivery charge.');
      address = { division: '', district: input.delivery.district, areaUnitType: input.delivery.areaUnitType };
      customer = { customerId: null, isRegistered: false };
    }

    const pricing = await priceCheckout(
      { lines: input.lines, couponCode: input.couponCode ?? null, address, customer, now: new Date() },
      client,
    );

    return {
      currency: 'BDT',
      subtotal: pricing.subtotal,
      discountAmount: pricing.discountAmount,
      shippingAmount: pricing.shipping.amount,
      totalAmount: pricing.totalAmount,
      appliedCoupon: pricing.coupon
        ? { code: pricing.coupon.code, discountAmount: pricing.coupon.discountAmount }
        : null,
      couponMessage: pricing.couponMessage,
      shipping: {
        zoneName: pricing.shipping.zoneName,
        freeShippingApplied: pricing.shipping.freeShippingApplied,
        freeShippingRemaining: pricing.shipping.freeShippingRemaining,
      },
    };
  });
}

/**
 * GET /api/shipping/quote — the base charge for a district. The cart is client-side only until
 * spec 09, so there is no subtotal here: a free-over-threshold zone is quoted at its flat charge
 * (`freeShippingRemaining` is therefore the full threshold). The cart- and coupon-aware figure is
 * `POST /api/checkout/validate`; the storefront uses that.
 */
export async function quoteDistrict(input: {
  district: string;
  areaUnitType: AreaUnitType;
}): Promise<ShippingQuote> {
  return withTransaction((client) =>
    computeShipping(
      {
        address: { division: '', district: input.district, isMetropolitan: input.areaUnitType === 'THANA' },
        merchandiseSubtotal: 0,
        now: new Date(),
      },
      client,
    ),
  );
}
