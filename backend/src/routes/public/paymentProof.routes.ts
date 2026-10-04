import { Router, type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { createUploadLimit } from '../../middleware/uploadLimit.js';
import { optionalAuth } from '../../middleware/optionalAuth.js';
import { resubmitPaymentController, submitPaymentProofController } from '../../controllers/checkout.controller.js';
import { customerResubmitPaymentSchema, orderNumberParamsSchema } from '../../validation/orders.validation.js';
import { PAYMENT_PROOF_MAX_BYTES } from '../../config/constants.js';

/**
 * bKash payment screenshot upload (03-payment-order §3.1, spec 06 private slice).
 *
 * Body is the raw image bytes (the same `createUploadLimit` contract as the homepage upload);
 * the 5 MB cap applies to this route only — the global 100 kb limit stays everywhere else.
 * The phone number proving ownership travels in the `X-Order-Phone` header, never the URL, so it
 * does not reach access logs or the Referer.
 */
export function createPaymentProofRoutes(): Router {
  const router = Router();

  // The limiter reads its identifier from `req.body`, which is still unparsed here: surface the
  // order number so the per-order counter (and lockout) shared with the guest lookup applies.
  // `createUploadLimit` replaces `req.body` with the raw buffer right after.
  const exposeOrderNumber = (req: Request, _res: Response, next: NextFunction): void => {
    req.body = { orderNumber: req.params.orderNumber };
    next();
  };

  router.post(
    '/orders/:orderNumber/payment-proof',
    optionalAuth(),
    validate({ params: orderNumberParamsSchema }),
    exposeOrderNumber,
    rateLimit('guestOrderLookup'),
    createUploadLimit(PAYMENT_PROOF_MAX_BYTES),
    submitPaymentProofController,
  );

  // JSON twin: a new Transaction ID after a rejection. Same per-order limiter and lockout as the lookup,
  // so neither route is a way to guess the phone number that proves ownership.
  router.post(
    '/orders/:orderNumber/payment-resubmission',
    optionalAuth(),
    validate({ params: orderNumberParamsSchema, body: customerResubmitPaymentSchema }),
    (req: Request, _res: Response, next: NextFunction): void => {
      req.body = { ...req.body, orderNumber: req.params.orderNumber };
      next();
    },
    rateLimit('guestOrderLookup'),
    resubmitPaymentController,
  );

  return router;
}
