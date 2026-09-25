import type { NextFunction, Request, Response } from 'express';
import { previewCoupon } from '../services/coupon/couponPreview.service.js';
import type { ValidateCouponInput } from '../validation/coupons.validation.js';
import type { ApiSuccess } from '../types/api.js';

/**
 * POST /api/coupons/validate — public, preview-only (10-coupon-discount
 * §8.15a, §8.18, plan §3).
 *
 * There is no customer-session infrastructure yet (only `requireAuth('admin')`
 * exists in this codebase) — a customer identity is therefore always
 * `null` here. This keeps the public/customer surface honest about what it
 * can currently determine, rather than guessing; guest/registered identity
 * wiring is spec 11/12's job.
 *
 * A rejected coupon is `200 { valid: false, message }`, never an HTTP error —
 * §8.22's message table is the one channel for customer-facing rejection text.
 */
export async function validateCouponController(
  req: Request<unknown, unknown, ValidateCouponInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await previewCoupon({
      code: req.body.code,
      lines: req.body.lines,
      customer: null,
    });

    if (!result.valid) {
      res.status(200).json({ data: { valid: false, message: result.message } } satisfies ApiSuccess<unknown>);
      return;
    }

    res.status(200).json({
      data: {
        valid: true,
        couponCode: result.code,
        discountType: result.discountType === 'PERCENTAGE' ? 'percentage' : 'fixed_amount',
        discountAmount: result.discountAmount,
        eligibleSubtotal: result.eligibleSubtotal,
        message: result.message,
      },
    } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
