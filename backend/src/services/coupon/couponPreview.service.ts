import { withTransaction } from '../../lib/transaction.js';
import * as couponRepository from '../../repositories/coupon.repository.js';
import { validateCoupon, type CouponValidationLine, type CouponValidationResult } from './validateCoupon.js';

/**
 * `POST /api/coupons/validate` support (10-coupon-discount §8.15a, §8.18,
 * plan §3). Looks up live prices for the submitted variant ids fresh from the
 * catalogue — never trusts a client-submitted price (§8.16) — then calls the
 * shared `validateCoupon` engine. Writes nothing: no `coupon_usages` row, no
 * `usage_count` increment (§8.15a is preview-only).
 */

export type PreviewCouponLine = { variantId: string; quantity: number };

export type PreviewCouponCustomer = { customerId: string | null; isRegistered: boolean };

export type PreviewCouponInput = {
  code: string;
  lines: PreviewCouponLine[];
  customer: PreviewCouponCustomer | null;
};

type VariantPriceRow = {
  id: string;
  product_id: string;
  category_id: string;
  price: string | null;
  base_price: string;
};

/**
 * Looks up each variant's live, effective unit price (variant override price,
 * falling back to the parent product's base price) plus its product/category
 * ids, in one query. Unknown/inactive variant ids are simply absent from the
 * result — the caller treats a missing id as a zero-quantity line, never as
 * an error that would leak catalogue existence to an unauthenticated caller.
 */
async function loadVariantPricing(
  variantIds: string[],
): Promise<Map<string, { productId: string; categoryId: string; unitPrice: number }>> {
  if (variantIds.length === 0) return new Map();

  return withTransaction(async (client) => {
    const { rows } = await client.query<VariantPriceRow>(
      `SELECT v.id, v.product_id, p.category_id, v.price, p.base_price
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.id = ANY($1::uuid[]) AND v.is_active AND p.status = 'ACTIVE'`,
      [variantIds],
    );
    const map = new Map<string, { productId: string; categoryId: string; unitPrice: number }>();
    for (const row of rows) {
      const unitPrice = row.price !== null ? Number(row.price) : Number(row.base_price);
      map.set(row.id, { productId: row.product_id, categoryId: row.category_id, unitPrice });
    }
    return map;
  });
}

export async function previewCoupon(input: PreviewCouponInput): Promise<CouponValidationResult> {
  const pricing = await loadVariantPricing(input.lines.map((line) => line.variantId));

  const lines: CouponValidationLine[] = [];
  for (const line of input.lines) {
    const found = pricing.get(line.variantId);
    // An unknown/inactive/deleted variant id contributes nothing to the
    // eligible subtotal — it cannot inflate or deflate the discount
    // calculation by a client sending a bogus id.
    if (!found) continue;
    lines.push({
      variantId: line.variantId,
      productId: found.productId,
      categoryId: found.categoryId,
      quantity: line.quantity,
      unitPrice: found.unitPrice,
      lineTotal: found.unitPrice * line.quantity,
    });
  }

  const coupon = await couponRepository.findByNormalizedCode(input.code);

  // Per-customer usage count is only meaningful when a customer identity is
  // known (plan §2) — a guest preview before a phone number exists skips
  // step 4 here and defers it to order-creation time.
  let perCustomerUsageCount: number | null = null;
  if (coupon && input.customer?.customerId) {
    perCustomerUsageCount = await couponRepository.countUsagesForCustomer(coupon.id, input.customer.customerId);
  }

  return validateCoupon({
    coupon: coupon
      ? {
          id: coupon.id,
          code: coupon.code,
          status: coupon.status,
          isArchived: coupon.isArchived,
          startsAt: coupon.startsAt,
          expiresAt: coupon.expiresAt,
          usageLimit: coupon.usageLimit,
          usageCount: coupon.usageCount,
          perCustomerLimit: coupon.perCustomerLimit,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          maximumDiscountAmount: coupon.maximumDiscountAmount,
          minimumOrderAmount: coupon.minimumOrderAmount,
          customerEligibility: coupon.customerEligibility,
          eligibleCustomerId: coupon.eligibleCustomerId,
        }
      : null,
    lines,
    customer: input.customer,
    perCustomerUsageCount,
    now: new Date(),
  });
}
