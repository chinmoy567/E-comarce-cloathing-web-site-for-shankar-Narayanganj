import { Router } from 'express';
import {
  customerLoginController,
  customerRegisterController,
  customerLogoutController,
  customerMeController,
  customerRefreshController,
  customerRequestOtpController,
  customerVerifyOtpController,
  customerResetPasswordController,
} from '../../controllers/customerAuth.controller.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import {
  customerLoginSchema,
  customerRegisterSchema,
  customerRequestOtpSchema,
  customerVerifyOtpSchema,
  customerResetPasswordSchema,
  changeCustomerPasswordSchema,
} from '../../validation/customer.validation.js';

/**
 * Customer session lifecycle (02-customer §2.1–2.6).
 * Mounted at `/api/customer/auth` with rate limiting per endpoint.
 *
 * Login/register/request-otp/verify-otp/reset-password are public (no auth required).
 * Logout/me/change-password require customer auth.
 */
const router = Router();

// Registration & login (public)
router.post(
  '/register',
  rateLimit('customerRegister'),
  validate({ body: customerRegisterSchema }),
  customerRegisterController,
);

router.post('/login', rateLimit('customerLogin'), validate({ body: customerLoginSchema }), customerLoginController);

// Password recovery flow (public)
router.post(
  '/request-otp',
  rateLimit('customerRequestOtp'),
  validate({ body: customerRequestOtpSchema }),
  customerRequestOtpController,
);

router.post(
  '/verify-otp',
  rateLimit('customerVerifyOtp'),
  validate({ body: customerVerifyOtpSchema }),
  customerVerifyOtpController,
);

router.post(
  '/reset-password',
  rateLimit('customerVerifyOtp'),
  validate({ body: customerResetPasswordSchema }),
  customerResetPasswordController,
);

// Authenticated operations
router.post('/refresh', rateLimit('authenticatedCeiling'), customerRefreshController);

router.post('/logout', requireAuth('customer'), rateLimit('authenticatedCeiling'), customerLogoutController);

router.get('/me', requireAuth('customer'), rateLimit('authenticatedCeiling'), customerMeController);

router.post(
  '/change-password',
  requireAuth('customer'),
  rateLimit('authenticatedCeiling'),
  validate({ body: changeCustomerPasswordSchema }),
  customerLogoutController, // TODO: implement change-password
);

export default router;
