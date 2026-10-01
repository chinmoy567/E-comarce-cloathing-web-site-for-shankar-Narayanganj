import type { NextFunction, Request, Response } from 'express';
import * as checkoutService from '../services/checkout.service.js';
import * as customerOrderViews from '../services/customerOrderViews.service.js';
import * as usersRepository from '../repositories/users.repository.js';
import { NotFoundError } from '../lib/errors.js';
import { buildPagination } from '../lib/pagination.js';
import type { CreateOrderRequest, GuestOrderLookupRequest, TrackOrderRequest } from '../validation/checkout.validation.js';
import type { PaginationQuery } from '../lib/pagination.js';
import type { ApiListSuccess, ApiSuccess } from '../types/api.js';
import type { Order } from '../repositories/orders.repository.js';
import type { OrderItem } from '../repositories/orderItems.repository.js';

/**
 * Checkout controllers (spec 11). Thin — business rules live in
 * `checkout.service.ts`; every error reaches the centralized `errorHandler`
 * via `next(err)`.
 */

function toOrderResponse(order: Order, items: OrderItem[]) {
  return {
    id: order.id,
    orderNumber: order.order_number,
    paymentMethod: order.payment_method,
    orderStatus: order.order_status,
    paymentStatus: order.payment_status,
    subtotal: order.subtotal,
    shippingAmount: order.shipping_amount,
    discountAmount: order.discount_amount,
    couponCode: order.coupon_code,
    totalAmount: order.total_amount,
    createdAt: order.created_at,
    items: items.map((item) => ({
      productId: item.product_id,
      productVariantId: item.product_variant_id,
      productName: item.product_name,
      variantDescription: item.variant_description,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    })),
  };
}

/**
 * POST /api/customer/orders — guest or registered checkout (`optionalAuth`
 * populates `req.actor` when a valid customer session cookie is present;
 * absence means guest).
 */
export async function createOrderController(
  req: Request<unknown, unknown, CreateOrderRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body;
    const result = await checkoutService.createOrder({
      actorUserId: req.actor?.userId ?? null,
      paymentMethod: body.paymentMethod,
      lines: body.lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId ?? null,
        quantity: line.quantity,
      })),
      couponCode: body.couponCode ?? null,
      idempotencyKey: body.idempotencyKey,
      guestFields: body.guestFields
        ? {
            fullName: body.guestFields.fullName,
            phoneNumber: body.guestFields.phoneNumber,
            email: body.guestFields.email ?? null,
            division: body.guestFields.division,
            district: body.guestFields.district,
            areaUnitType: body.guestFields.areaUnitType,
            areaUnitName: body.guestFields.areaUnitName,
            wardUnitType: body.guestFields.wardUnitType,
            wardUnitName: body.guestFields.wardUnitName,
            detailedAddress: body.guestFields.detailedAddress,
            postalCode: body.guestFields.postalCode ?? null,
          }
        : null,
      bkashTransactionId: body.bkashTransactionId ?? null,
    });

    res.status(result.deduped ? 200 : 201).json({
      data: toOrderResponse(result.order, result.items),
    } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/orders/lookup — guest lookup by (Order Number, Phone Number) pair (§2.9.5-2.9.7).
 * Always 200: any mismatch is the same `found: false` body, so neither the status code nor the
 * body distinguishes "order number wrong" from "phone wrong" (non-enumeration).
 */
export async function guestOrderLookupController(
  req: Request<unknown, unknown, GuestOrderLookupRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const view = await customerOrderViews.lookupGuestOrder(req.body.orderNumber, req.body.phoneNumber);
    res.status(200).json({
      data: view ? { found: true, ...view } : { found: false, message: customerOrderViews.GUEST_LOOKUP_NOT_FOUND_MESSAGE },
    } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

/** POST /api/track-order — public, courier-identifier lookup (§4.14, §4.16). Always 200. */
export async function trackOrderController(
  req: Request<unknown, unknown, TrackOrderRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await customerOrderViews.trackOrder(req.body.trackingId);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

/** The signed-in customer's id — derived from the session, NEVER from a client-supplied value. */
async function sessionCustomerId(req: Request): Promise<string> {
  const user = await usersRepository.findById(req.actor!.userId);
  if (!user || !user.customerId) throw new NotFoundError('Customer not found.');
  return user.customerId;
}

/** GET /api/customer/orders — registered-customer order history (customer-safe rows, no internal ids). */
export async function getCustomerOrderHistoryController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, pageSize } = req.query as unknown as PaginationQuery;
    const { items, total } = await customerOrderViews.getCustomerOrderList(await sessionCustomerId(req), { page, pageSize });
    res.status(200).json({
      data: items,
      pagination: buildPagination({ page, pageSize }, total),
    } satisfies ApiListSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

/** GET /api/customer/orders/:orderNumber — one order for its owner. 404 for anyone else's. */
export async function getCustomerOrderDetailController(
  req: Request<{ orderNumber: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const view = await customerOrderViews.getCustomerOrderDetail(await sessionCustomerId(req), req.params.orderNumber);
    res.status(200).json({ data: view } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
