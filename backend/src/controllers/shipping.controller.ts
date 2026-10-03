import type { NextFunction, Request, Response } from 'express';
import * as checkoutPreview from '../services/checkoutPreview.service.js';
import type { CheckoutValidateRequest, ShippingQuoteQuery } from '../validation/shipping.validation.js';
import type { ApiSuccess } from '../types/api.js';

/**
 * Public, advisory shipping controllers (spec 21). Thin — pricing lives in `checkoutPricing.ts`
 * and `computeShipping.ts`. Nothing here is trusted at order creation.
 */

/** GET /api/shipping/quote — zone name and amount only; never the internal zone code. */
export async function shippingQuoteController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { district, areaUnitType } = req.query as unknown as ShippingQuoteQuery;
    const quote = await checkoutPreview.quoteDistrict({ district, areaUnitType });
    res.status(200).json({
      data: {
        zoneName: quote.zoneName,
        amount: quote.amount,
        freeShippingApplied: quote.freeShippingApplied,
        freeShippingRemaining: quote.freeShippingRemaining,
      },
    } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

/** POST /api/checkout/validate — `optionalAuth` populates `req.actor` for a signed-in customer. */
export async function checkoutValidateController(
  req: Request<unknown, unknown, CheckoutValidateRequest>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body;
    const data = await checkoutPreview.previewCheckout({
      actorUserId: req.actor?.userId ?? null,
      lines: body.lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId ?? null,
        quantity: line.quantity,
      })),
      couponCode: body.couponCode ?? null,
      ...(body.delivery ? { delivery: body.delivery } : {}),
    });
    res.status(200).json({ data } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
