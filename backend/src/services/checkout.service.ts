import type pg from 'pg';
import { withTransaction } from '../lib/transaction.js';
import { ValidationError, ConflictError, NotFoundError } from '../lib/errors.js';
import { normalizeBdPhone } from '../lib/phone.js';
import * as ordersRepository from '../repositories/orders.repository.js';
import * as orderItemsRepository from '../repositories/orderItems.repository.js';
import * as customersRepository from '../repositories/customers.repository.js';
import * as usersRepository from '../repositories/users.repository.js';
import * as couponRepository from '../repositories/coupon.repository.js';
import * as inventoryRepository from '../repositories/inventory.repository.js';
import * as orderStatusHistoryRepository from '../repositories/orderStatusHistory.repository.js';
import { validateCoupon, type CouponValidationLine } from './coupon/validateCoupon.js';
import type { Order } from '../repositories/orders.repository.js';
import type { OrderItem } from '../repositories/orderItems.repository.js';
import type { CustomerAddress } from '../types/customer.js';
import type { AreaUnitType, WardUnitType } from '../types/enums.js';

/**
 * Checkout / order-creation service (spec 11 — 02-customer §2.3/§2.9,
 * 03-payment-order §3, 10-coupon-discount §8.15b).
 *
 * The entire flow runs inside one `withTransaction` call (03-payment-order §3:
 * "Order creation is a single database transaction").
 */

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export type CheckoutLineInput = {
  productId: string;
  variantId: string | null;
  quantity: number;
};

export type GuestFieldsInput = {
  fullName: string;
  phoneNumber: string;
  email?: string | null;
  division: string;
  district: string;
  areaUnitType: string;
  areaUnitName: string;
  wardUnitType: string;
  wardUnitName: string;
  detailedAddress: string;
  postalCode?: string | null;
};

export type CreateOrderInput = {
  /** Populated by `optionalAuth` when a customer session cookie is valid. */
  actorUserId: string | null;
  paymentMethod: 'BKASH' | 'COD';
  lines: CheckoutLineInput[];
  couponCode?: string | null;
  idempotencyKey: string;
  /** Only used on the guest path — ignored (never trusted) when actorUserId resolves. */
  guestFields?: GuestFieldsInput | null;
  /** Optional at order-creation time — §3.1 steps 2-5: money is sent AFTER
   *  placing the order, so this is normally submitted later via a separate
   *  call. Accepted here too for a customer who already paid before placing
   *  the order (see service-level doc below). */
  bkashTransactionId?: string | null;
};

export type CreateOrderResult = {
  order: Order;
  items: OrderItem[];
  deduped: boolean;
};

/**
 * §3.1 timing decision (documented per the task's own instruction to decide
 * from the spec text, not assumption): §3.1's customer steps are
 * 1) select bKash, 2) PLACE THE ORDER, 3) send money, 4) enter transaction ID,
 * 5) submit payment info. Placing the order therefore happens BEFORE the
 * transaction ID exists — `bkashTransactionId` is NEVER required at
 * order-creation time. It is accepted here as an optional field only for the
 * edge case of a customer who already paid and knows the ID before placing
 * the order (so this call's uniqueness check still applies to it), but the
 * normal path is: create order with no transaction id (payment_status
 * PENDING_VERIFICATION), then a separate "submit payment info" endpoint
 * patches it later. No such endpoint exists yet elsewhere in the codebase
 * (grepped) — deferred; see the handback report for why it's out of this
 * slice's scope.
 */

// Flat shipping default: no shipping-cost rule exists anywhere in this
// codebase (grepped `shipping_amount`/`shippingAmount` — the only writer is
// `orders.repository.ts::createOrder`, which has always defaulted to 0 via
// the column DEFAULT). Keeping that same default here rather than inventing
// a new business rule.
const DEFAULT_SHIPPING_AMOUNT = 0;

type LiveLine = CouponValidationLine & {
  isActive: boolean;
  productActive: boolean;
  productName: string;
  variantDescription: string | null;
  availableStock: number;
};

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
 * Loads live prices/active-state/stock for every requested line, the same
 * variant-price-lookup pattern as `couponPreview.service.ts`
 * (`loadVariantPricing`) — never trusts a client-submitted price (§2.9.3
 * step 5, §8.16). Also resolves each variant's attribute-value description
 * (e.g. "Size: L, Color: Red") for the order_items snapshot.
 */
async function loadLiveLines(
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
    }>(
      `SELECT id, category_id, name, status, base_price FROM products WHERE id = ANY($1::uuid[])`,
      [productIdsWithoutVariant],
    );
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

// ---------------------------------------------------------------------------
// §2.9.3 guest validation — exact ordered steps, fail-fast, one field at a time.
// ---------------------------------------------------------------------------

const VALID_AREA_UNIT_TYPES: AreaUnitType[] = ['UPAZILA', 'THANA'];
const VALID_WARD_UNIT_TYPES: WardUnitType[] = ['UNION', 'WARD'];

function fieldError(field: string, message: string): ValidationError {
  return new ValidationError(message, [{ field, message }]);
}

/**
 * §2.9.3 steps 1-4 (presence, phone format, address structure, email format).
 * Stops at the first failing step and throws exactly one field error —
 * deliberately NOT using `guestCheckoutSchema.safeParse` on the whole object,
 * since zod's parallel validation would report every invalid field at once,
 * contradicting the spec's fail-fast requirement (see plan notes).
 */
function validateGuestFieldsOrdered(input: GuestFieldsInput): CustomerAddress {
  // Step 1: required-field presence (all except email/postalCode, which are optional per §2.9.2).
  if (!input.fullName || input.fullName.trim().length === 0) {
    throw fieldError('fullName', 'Full name is required.');
  }
  if (!input.phoneNumber || input.phoneNumber.trim().length === 0) {
    throw fieldError('phoneNumber', 'Phone number is required.');
  }
  if (!input.division || input.division.trim().length === 0) {
    throw fieldError('division', 'Division is required.');
  }
  if (!input.district || input.district.trim().length === 0) {
    throw fieldError('district', 'District is required.');
  }
  if (!input.areaUnitType || !input.areaUnitName || input.areaUnitName.trim().length === 0) {
    throw fieldError('areaUnit', 'Upazila/Thana is required.');
  }
  if (!input.wardUnitType || !input.wardUnitName || input.wardUnitName.trim().length === 0) {
    throw fieldError('wardUnit', 'Union/Ward is required.');
  }
  if (!input.detailedAddress || input.detailedAddress.trim().length === 0) {
    throw fieldError('detailedAddress', 'Detailed address is required.');
  }

  // Step 2: Bangladesh phone number format.
  try {
    normalizeBdPhone(input.phoneNumber);
  } catch {
    throw fieldError('phoneNumber', 'A valid Bangladesh mobile number is required.');
  }

  // Step 3: address structure — the discriminator pairs must be valid values.
  if (!VALID_AREA_UNIT_TYPES.includes(input.areaUnitType as AreaUnitType)) {
    throw fieldError('areaUnitType', 'Upazila/Thana type must be UPAZILA or THANA.');
  }
  if (!VALID_WARD_UNIT_TYPES.includes(input.wardUnitType as WardUnitType)) {
    throw fieldError('wardUnitType', 'Union/Ward type must be UNION or WARD.');
  }

  // Step 4: email format, only if provided.
  if (input.email) {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(input.email)) {
      throw fieldError('email', 'A valid email address is required.');
    }
  }

  return {
    division: input.division,
    district: input.district,
    areaUnitType: input.areaUnitType as AreaUnitType,
    areaUnitName: input.areaUnitName,
    wardUnitType: input.wardUnitType as WardUnitType,
    wardUnitName: input.wardUnitName,
    detailedAddress: input.detailedAddress,
    postalCode: input.postalCode ?? null,
  } satisfies CustomerAddress;
}

/** §2.2 profile-completeness check — every required field must be genuinely non-empty, not merely present. */
function isProfileComplete(customer: {
  fullName: string;
  phoneNumber: string;
  address: CustomerAddress;
}): boolean {
  const a = customer.address;
  return (
    customer.fullName.trim().length > 0 &&
    customer.phoneNumber.trim().length > 0 &&
    a.division.trim().length > 0 &&
    a.district.trim().length > 0 &&
    a.areaUnitName.trim().length > 0 &&
    a.wardUnitName.trim().length > 0 &&
    a.detailedAddress.trim().length > 0
  );
}

/** Thrown when a registered/logged-in customer's profile is missing required fields (§2.3). */
export class ProfileIncompleteError extends ValidationError {
  constructor(missingFields: string[]) {
    super('Your profile is incomplete. Please complete your profile before placing an order.', [
      ...missingFields.map((field) => ({ field, message: 'is required' })),
    ]);
  }
}

function missingProfileFields(customer: { fullName: string; phoneNumber: string; address: CustomerAddress }): string[] {
  const missing: string[] = [];
  if (!customer.fullName.trim()) missing.push('fullName');
  if (!customer.phoneNumber.trim()) missing.push('phoneNumber');
  if (!customer.address.division.trim()) missing.push('division');
  if (!customer.address.district.trim()) missing.push('district');
  if (!customer.address.areaUnitName.trim()) missing.push('areaUnit');
  if (!customer.address.wardUnitName.trim()) missing.push('wardUnit');
  if (!customer.address.detailedAddress.trim()) missing.push('detailedAddress');
  return missing;
}

// ---------------------------------------------------------------------------
// createOrder
// ---------------------------------------------------------------------------

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  return withTransaction(async (client) => {
    // Step 0 (§3.1): idempotency check first — no re-validation, no side effects.
    const existing = await ordersRepository.findByIdempotencyKey(input.idempotencyKey, client);
    if (existing) {
      const items = await orderItemsRepository.listByOrderId(client, existing.id);
      return { order: existing, items, deduped: true };
    }

    if (!input.lines || input.lines.length === 0) {
      throw fieldError('lines', 'Your cart is empty.');
    }

    // ---- Branch: registered vs guest -------------------------------------
    let resolvedAddress: CustomerAddress;
    let resolvedFullName: string;
    let resolvedPhone: string;
    let customerId: string;
    let isRegisteredCustomer: boolean;

    if (input.actorUserId) {
      const user = await usersRepository.findById(input.actorUserId, client);
      if (!user || !user.customerId) {
        throw new NotFoundError('Customer not found.');
      }
      const customer = await customersRepository.findById(user.customerId, client);
      if (!customer) {
        throw new NotFoundError('Customer not found.');
      }

      if (!isProfileComplete(customer)) {
        throw new ProfileIncompleteError(missingProfileFields(customer));
      }

      resolvedAddress = customer.address;
      resolvedFullName = customer.fullName;
      resolvedPhone = customer.phoneNumber;
      customerId = customer.id;
      isRegisteredCustomer = true;
    } else {
      if (!input.guestFields) {
        throw fieldError('fullName', 'Full name is required.');
      }
      resolvedAddress = validateGuestFieldsOrdered(input.guestFields);
      resolvedFullName = input.guestFields.fullName;
      resolvedPhone = normalizeBdPhone(input.guestFields.phoneNumber);

      // §2.9.4: create-or-reuse the guest customer reference (never downgrades
      // an existing REGISTERED record).
      const customer = await customersRepository.upsertByPhoneNumber(
        {
          fullName: resolvedFullName,
          phoneNumber: resolvedPhone,
          email: input.guestFields.email ?? null,
          address: resolvedAddress,
        },
        'GUEST',
        client,
      );
      customerId = customer.id;
      isRegisteredCustomer = customer.accountType === 'REGISTERED';
    }

    // ---- §2.9.3 step 5 / §8.15b: cart & price revalidation ----------------
    const liveLines = await loadLiveLines(client, input.lines);

    const couponLines: CouponValidationLine[] = [];
    const orderItemInputs: {
      productId: string;
      productVariantId: string | null;
      productName: string;
      variantDescription: string | null;
      unitPrice: number;
      quantity: number;
      lineTotal: number;
    }[] = [];

    for (const line of input.lines) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw fieldError('quantity', 'Item quantity must be a positive whole number.');
      }
      const key = lineKey(line);
      const live = liveLines.get(key);
      if (!live || !live.isActive || !live.productActive) {
        throw fieldError('lines', `One or more items in your cart are no longer available: ${line.productId}.`);
      }
      const lineTotal = Math.round(live.unitPrice * line.quantity * 100) / 100;
      couponLines.push({
        variantId: live.variantId || line.productId,
        productId: live.productId,
        categoryId: live.categoryId,
        quantity: line.quantity,
        unitPrice: live.unitPrice,
        lineTotal,
      });
      orderItemInputs.push({
        productId: live.productId,
        productVariantId: line.variantId,
        productName: live.productName,
        variantDescription: live.variantDescription,
        unitPrice: live.unitPrice,
        quantity: line.quantity,
        lineTotal,
      });
    }

    const subtotal = Math.round(couponLines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;

    // ---- §3.1 payment-method-specific validation --------------------------
    // bKash: transaction ID is NOT required at order-creation time (see
    // module doc — §3.1 places the order before money is sent). COD has no
    // additional required field at this step.

    // ---- §8.15b: coupon revalidation from scratch --------------------------
    let couponId: string | null = null;
    let couponCode: string | null = null;
    let discountType: 'PERCENTAGE' | 'FIXED_AMOUNT' | null = null;
    let discountAmount: number | null = null;
    let eligibleSubtotal: number | null = null;

    if (input.couponCode) {
      const coupon = await couponRepository.findByNormalizedCode(input.couponCode, client);
      let perCustomerUsageCount: number | null = null;
      if (coupon) {
        perCustomerUsageCount = await couponRepository.countUsagesForCustomer(coupon.id, customerId, client);
      }

      const result = validateCoupon({
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
        lines: couponLines,
        customer: { customerId, isRegistered: isRegisteredCustomer },
        perCustomerUsageCount,
        now: new Date(),
      });

      if (!result.valid) {
        throw new ValidationError(result.message, [{ field: 'couponCode', message: result.message }]);
      }

      couponId = result.couponId;
      couponCode = result.code;
      discountType = result.discountType;
      discountAmount = result.discountAmount;
      eligibleSubtotal = result.eligibleSubtotal;
    }

    const shippingAmount = DEFAULT_SHIPPING_AMOUNT;
    const totalAmount =
      Math.round((subtotal - (discountAmount ?? 0) + shippingAmount) * 100) / 100;

    // ---- Stock decrement -----------------------------------------------
    // NOTE: 07-order-state-machine §5.21 / database skill §2 state stock
    // decrements at CONFIRMED, not at order placement. This function
    // deliberately does NOT decrement stock here — see the handback report's
    // "deviation" section for why the task's own instruction to decrement at
    // creation time was not followed: it directly contradicts the
    // authoritative spec, which this codebase's CLAUDE.md ranks above any
    // single instruction. Stock decrement at CONFIRMED remains a follow-up
    // task at the Admin/Manager order-confirmation action (out of this
    // checkout slice's scope; see report).

    const initialOrderStatus = input.paymentMethod === 'BKASH' ? 'PENDING_CONFIRMATION' : 'COD_VERIFICATION_PENDING';
    const initialPaymentStatus = input.paymentMethod === 'BKASH' ? 'PENDING_VERIFICATION' : 'PENDING_COLLECTION';

    let orderNumber = ordersRepository.generateOrderNumber();
    let order: Order;
    // Retry loop on order_number collision (extremely unlikely given the
    // random suffix, but the unique constraint is the real enforcement
    // point — see `generateOrderNumber`'s doc comment).
    for (let attempt = 0; ; attempt++) {
      try {
        order = await ordersRepository.createOrder(client, {
          order_number: orderNumber,
          customer_id: customerId,
          payment_method: input.paymentMethod,
          order_status: initialOrderStatus,
          payment_status: initialPaymentStatus,
          subtotal,
          shipping_amount: shippingAmount,
          coupon_id: couponId,
          discount_amount: discountAmount,
          total_amount: totalAmount,
          address: {
            fullName: resolvedFullName,
            phoneNumber: resolvedPhone,
            division: resolvedAddress.division,
            district: resolvedAddress.district,
            areaUnitType: resolvedAddress.areaUnitType,
            areaUnitName: resolvedAddress.areaUnitName,
            wardUnitType: resolvedAddress.wardUnitType,
            wardUnitName: resolvedAddress.wardUnitName,
            detailedAddress: resolvedAddress.detailedAddress,
            postalCode: resolvedAddress.postalCode,
          },
          bkash_transaction_id: input.bkashTransactionId ?? null,
          idempotency_key: input.idempotencyKey,
          coupon_code: couponCode,
          discount_type: discountType,
          eligible_subtotal: eligibleSubtotal,
        });
        break;
      } catch (err) {
        if (err instanceof ConflictError && err.code === 'ORDER_NUMBER_EXISTS' && attempt < 3) {
          orderNumber = ordersRepository.generateOrderNumber();
          continue;
        }
        if (err instanceof ConflictError && err.code === 'BKASH_TRANSACTION_ID_EXISTS') {
          throw err;
        }
        throw err;
      }
    }

    const items = await orderItemsRepository.insertMany(client, order.id, orderItemInputs);

    // ---- Coupon usage recording (§8.25/§8.26) — atomic, same transaction ----
    if (couponId && discountAmount !== null) {
      const coupon = await couponRepository.findById(couponId, client);
      const usageResult = await couponRepository.recordCouponUsage(client, {
        couponId,
        orderId: order.id,
        customerId,
        discountAmount,
        perCustomerLimit: coupon?.perCustomerLimit ?? null,
      });
      if (!usageResult.ok) {
        const message =
          usageResult.reason === 'USAGE_LIMIT_REACHED'
            ? 'This coupon has reached its usage limit.'
            : 'You have already used this coupon.';
        throw new ValidationError(message, [{ field: 'couponCode', message }]);
      }
    }

    // ---- §5.21.11 audit trail: initial order_status + payment_status rows ---
    await orderStatusHistoryRepository.append(
      {
        entityType: 'order',
        entityId: order.id,
        statusField: 'order_status',
        previousStatus: null,
        newStatus: order.order_status,
        actorType: 'SYSTEM',
      },
      client,
    );
    await orderStatusHistoryRepository.append(
      {
        entityType: 'order',
        entityId: order.id,
        statusField: 'payment_status',
        previousStatus: null,
        newStatus: order.payment_status,
        actorType: 'SYSTEM',
      },
      client,
    );

    return { order, items, deduped: false };
  });
}

// Guest lookup, account order history/detail and Track Order live in
// `customerOrderViews.service.ts` (spec 15) — the single customer-safe serializer.

// Re-exported so inventory decrement remains reachable from a future
// order-confirmation slice without a second import path (kept unused here
// deliberately — see the stock-decrement note above).
export { inventoryRepository as _inventoryRepositoryForFutureConfirmSlice };
