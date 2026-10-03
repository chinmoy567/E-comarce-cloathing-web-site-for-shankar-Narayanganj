import type pg from 'pg';
import { ValidationError } from '../lib/errors.js';
import * as couponRepository from '../repositories/coupon.repository.js';
import { validateCoupon, type CouponValidationLine } from './coupon/validateCoupon.js';
import { computeShipping, type ShippingQuote } from './shipping/computeShipping.js';
import type { AreaUnitType } from '../types/enums.js';

/**
 * The one checkout pricing function (spec 21 — "Contract additions").
 *
 *   lines → live prices → coupon engine → computeShipping(subtotal − discount) → total
 *
 * Both `POST /api/checkout/validate` (advisory preview) and spec 11's `createOrder()` call this, so
 * the preview and the placed order cannot disagree. Shipping is computed AFTER the coupon is final
 * and never before (10-coupon-discount §8.14c, §8.10): the coupon engine never sees a shipping
 * figure, so shipping can never help a coupon qualify, and a coupon never reduces shipping.
 *
 * Nothing here trusts the client for a price, discount, shipping amount or total (§8.16, §11.4).
 */

export type CheckoutLineInput = {
  productId: string;
  variantId: string | null;
  quantity: number;
};

export type LiveLine = CouponValidationLine & {
  isActive: boolean;
  productActive: boolean;
  productName: string;
  variantDescription: string | null;
  availableStock: number;
};

export type PricedOrderItem = {
  productId: string;
  productVariantId: string | null;
  productName: string;
  variantDescription: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type AppliedCouponResult = {
  couponId: string;
  code: string;
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discountAmount: number;
  eligibleSubtotal: number;
};

export type PriceCheckoutInput = {
  lines: CheckoutLineInput[];
  couponCode?: string | null;
  /** Only the fields zone resolution reads; `isMetropolitan` is derived here, never supplied by a client. */
  address: { division: string; district: string; areaUnitType: AreaUnitType };
  /** `customerId` is null for a guest preview before a phone number exists. */
  customer: { customerId: string | null; isRegistered: boolean };
  now: Date;
  /** True only when an order is actually being placed (see ShippingInput.recordUnmatched). */
  recordUnmatched?: boolean;
};

export type CheckoutPricingResult = {
  subtotal: number;
  discountAmount: number;
  coupon: AppliedCouponResult | null;
  /** The §8.22 message when the code was rejected; the caller decides whether that is fatal. */
  couponMessage: string | null;
  shipping: ShippingQuote;
  totalAmount: number;
  couponLines: CouponValidationLine[];
  orderItems: PricedOrderItem[];
};

export function fieldError(field: string, message: string): ValidationError {
  return new ValidationError(message, [{ field, message }]);
}

type VariantPricingRow = {
  variant_id: string | null;
  product_id: string;
  category_id: string;
  product_name: string;
  product_status: string;
  variant_is_active: boolean | null;
  price: string | null;
  base_price: string;
  stock_quantity: number | null;
  variant_description: string | null;
};

/**
 * Loads live prices/active-state/stock for every requested line, the same variant-price-lookup
 * pattern as `couponPreview.service.ts` — never trusts a client-submitted price (§2.9.3 step 5, §8.16).
 * Also resolves each variant's attribute-value description (e.g. "Size: L, Color: Red") for the
 * order_items snapshot.
 */
export async function loadLiveLines(
  client: pg.PoolClient,
  lines: CheckoutLineInput[],
): Promise<Map<string, LiveLine>> {
  const map = new Map<string, LiveLine>();
  if (lines.length === 0) return map;

  const variantIds = lines.filter((l) => l.variantId).map((l) => l.variantId!);
  const productIdsWithoutVariant = lines.filter((l) => !l.variantId).map((l) => l.productId);

  if (variantIds.length > 0) {
    const { rows } = await client.query<VariantPricingRow>(
      `SELECT v.id AS variant_id, v.product_id, p.category_id, p.name AS product_name,
              p.status AS product_status, v.is_active AS variant_is_active,
              v.price, p.base_price, v.stock_quantity,
              (
                SELECT string_agg(pa.name || ': ' || pav.value, ', ')
                  FROM product_variant_values pvv
                  JOIN product_attribute_values pav ON pav.id = pvv.attribute_value_id
                  JOIN product_attributes pa ON pa.id = pav.attribute_id
                 WHERE pvv.variant_id = v.id
              ) AS variant_description
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.id = ANY($1::uuid[])`,
      [variantIds],
    );
    for (const row of rows) {
      const unitPrice = row.price !== null ? Number(row.price) : Number(row.base_price);
      map.set(`v:${row.variant_id}`, {
        variantId: row.variant_id!,
        productId: row.product_id,
        categoryId: row.category_id,
        quantity: 0,
        unitPrice,
        lineTotal: 0,
        isActive: row.variant_is_active === true,
        productActive: row.product_status === 'ACTIVE',
        productName: row.product_name,
        variantDescription: row.variant_description,
        availableStock: row.stock_quantity ?? 0,
      });
    }
  }

  if (productIdsWithoutVariant.length > 0) {
    const { rows } = await client.query<{
      id: string;
      category_id: string;
      name: string;
      status: string;
      base_price: string;
    }>(`SELECT id, category_id, name, status, base_price FROM products WHERE id = ANY($1::uuid[])`, [
      productIdsWithoutVariant,
    ]);
    for (const row of rows) {
      map.set(`p:${row.id}`, {
        variantId: '',
        productId: row.id,
        categoryId: row.category_id,
        quantity: 0,
        unitPrice: Number(row.base_price),
        lineTotal: 0,
        isActive: true,
        productActive: row.status === 'ACTIVE',
        productName: row.name,
        variantDescription: null,
        availableStock: Number.MAX_SAFE_INTEGER, // products without variants aren't stock-tracked here
      });
    }
  }

  return map;
}

function lineKey(line: CheckoutLineInput): string {
  return line.variantId ? `v:${line.variantId}` : `p:${line.productId}`;
}

const roundMoney = (n: number): number => Math.round(n * 100) / 100;

export async function priceCheckout(input: PriceCheckoutInput, client: pg.PoolClient): Promise<CheckoutPricingResult> {
  if (!input.lines || input.lines.length === 0) {
    throw fieldError('lines', 'Your cart is empty.');
  }

  // ---- §2.9.3 step 5 / §8.15b: cart & price revalidation ---------------------------------------
  const liveLines = await loadLiveLines(client, input.lines);

  const couponLines: CouponValidationLine[] = [];
  const orderItems: PricedOrderItem[] = [];

  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw fieldError('quantity', 'Item quantity must be a positive whole number.');
    }
    const live = liveLines.get(lineKey(line));
    if (!live || !live.isActive || !live.productActive) {
      throw fieldError('lines', `One or more items in your cart are no longer available: ${line.productId}.`);
    }
    const lineTotal = roundMoney(live.unitPrice * line.quantity);
    couponLines.push({
      variantId: live.variantId || line.productId,
      productId: live.productId,
      categoryId: live.categoryId,
      quantity: line.quantity,
      unitPrice: live.unitPrice,
      lineTotal,
    });
    orderItems.push({
      productId: live.productId,
      productVariantId: line.variantId,
      productName: live.productName,
      variantDescription: live.variantDescription,
      unitPrice: live.unitPrice,
      quantity: line.quantity,
      lineTotal,
    });
  }

  const subtotal = roundMoney(couponLines.reduce((sum, l) => sum + l.lineTotal, 0));

  // ---- §8.15b: coupon revalidation from scratch ------------------------------------------------
  let coupon: AppliedCouponResult | null = null;
  let couponMessage: string | null = null;

  if (input.couponCode) {
    const record = await couponRepository.findByNormalizedCode(input.couponCode, client);
    let perCustomerUsageCount: number | null = null;
    if (record && input.customer.customerId) {
      perCustomerUsageCount = await couponRepository.countUsagesForCustomer(record.id, input.customer.customerId, client);
    }

    const result = validateCoupon({
      coupon: record
        ? {
            id: record.id,
            code: record.code,
            status: record.status,
            isArchived: record.isArchived,
            startsAt: record.startsAt,
            expiresAt: record.expiresAt,
            usageLimit: record.usageLimit,
            usageCount: record.usageCount,
            perCustomerLimit: record.perCustomerLimit,
            discountType: record.discountType,
            discountValue: record.discountValue,
            maximumDiscountAmount: record.maximumDiscountAmount,
            minimumOrderAmount: record.minimumOrderAmount,
            customerEligibility: record.customerEligibility,
            eligibleCustomerId: record.eligibleCustomerId,
          }
        : null,
      lines: couponLines,
      customer: input.customer.customerId ? input.customer : null,
      perCustomerUsageCount,
      now: input.now,
    });

    if (result.valid) {
      coupon = {
        couponId: result.couponId,
        code: result.code,
        discountType: result.discountType,
        discountAmount: result.discountAmount,
        eligibleSubtotal: result.eligibleSubtotal,
      };
    } else {
      couponMessage = result.message;
    }
  }

  const discountAmount = coupon?.discountAmount ?? 0;

  // ---- Shipping: AFTER the discount is final (§8.14c); threshold reads the post-discount subtotal --
  const shipping = await computeShipping(
    {
      address: {
        division: input.address.division,
        district: input.address.district,
        // The Upazila/Thana discriminator separates city from rural (02-customer §2.2).
        isMetropolitan: input.address.areaUnitType === 'THANA',
      },
      merchandiseSubtotal: roundMoney(subtotal - discountAmount),
      now: input.now,
      recordUnmatched: input.recordUnmatched ?? false,
    },
    client,
  );

  const totalAmount = roundMoney(subtotal - discountAmount + shipping.amount);

  return { subtotal, discountAmount, coupon, couponMessage, shipping, totalAmount, couponLines, orderItems };
}
