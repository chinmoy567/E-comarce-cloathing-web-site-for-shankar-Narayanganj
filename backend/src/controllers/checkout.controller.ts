import type { NextFunction, Request, Response } from 'express';
import * as checkoutService from '../services/checkout.service.js';
import * as usersRepository from '../repositories/users.repository.js';
import { NotFoundError } from '../lib/errors.js';
import { buildPagination } from '../lib/pagination.js';
import type { CreateOrderRequest, GuestOrderLookupQuery } from '../validation/checkout.validation.js';
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
 * GET /api/customer/orders/lookup — guest order lookup by (Order Number,
 * Phone Number) pair (§2.9.5-2.9.7). Always a generic 404 on any mismatch —
 * never distinguishes "order number wrong" from "phone wrong" (non-enumeration).
 */
export async function lookupGuestOrderController(
  req: Request<unknown, unknown, unknown, GuestOrderLookupQuery>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { order_number, phone_number } = req.query;
    const result = await checkoutService.lookupGuestOrder(order_number, phone_number);

    if (!result) {
      throw new NotFoundError('No order was found matching that order number and phone number.');
    }

    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/customer/orders — registered-customer order history. `customer_id`
 * is derived from `req.actor.userId` -> `usersRepository.findById` ->
 * `.customerId`, NEVER from a client-supplied id.
 */
export async function getCustomerOrderHistoryController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, pageSize } = req.query as unknown as PaginationQuery;

    const user = await usersRepository.findById(req.actor!.userId);
    if (!user || !user.customerId) {
      throw new NotFoundError('Customer not found.');
    }

    const { items, total } = await checkoutService.getCustomerOrderHistory(user.customerId, { page, pageSize });

    res.status(200).json({
      data: items.map(({ shipmentStatus, ...order }) => ({ ...toOrderResponse(order, []), shipmentStatus })),
      pagination: buildPagination({ page, pageSize }, total),
    } satisfies ApiListSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/customer/orders/:id — one order for its owner. Projects only the
 * customer-visible fields (§2.9.6): no risk-check data, admin notes, payment
 * proof or courier error text.
 */
export async function getCustomerOrderDetailController(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await usersRepository.findById(req.actor!.userId);
    if (!user || !user.customerId) {
      throw new NotFoundError('Customer not found.');
    }

    const { order, items, shipment } = await checkoutService.getCustomerOrderDetail(user.customerId, req.params.id);

    res.status(200).json({
      data: {
        ...toOrderResponse(order, items),
        deliveryAddress: {
          fullName: order.full_name,
          phoneNumber: order.phone_number,
          division: order.division,
          district: order.district,
          areaUnitType: order.area_unit_type,
          areaUnitName: order.area_unit_name,
          wardUnitType: order.ward_unit_type,
          wardUnitName: order.ward_unit_name,
          detailedAddress: order.detailed_address,
          postalCode: order.postal_code,
        },
        shipment,
      },
    } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
