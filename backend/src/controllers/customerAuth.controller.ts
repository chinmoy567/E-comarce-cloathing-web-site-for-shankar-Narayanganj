import type { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../lib/errors.js';
import * as customerService from '../services/customer.service.js';
import * as customerPasswordRecovery from '../services/customerPasswordRecovery.service.js';
import * as customerAccountVerification from '../services/customerAccountVerification.service.js';
import * as customerSession from '../services/customerSession.service.js';
import { mergeGuestCartOnAuth } from './cart.controller.js';
import { CUSTOMER_ACCESS_COOKIE, CUSTOMER_REFRESH_COOKIE } from '../config/constants.js';

/**
 * Customer auth controllers (02-customer §2.1–2.6).
 * Sessions separate from admin (scope: 'customer' vs 'admin').
 */


function setSessionCookies(res: Response, tokens: customerSession.CustomerSessionTokens): void {
  const base = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const };
  res.cookie(CUSTOMER_ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: 15 * 60 * 1000 });
  res.cookie(CUSTOMER_REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    maxAge: Math.max(0, tokens.refreshTokenExpiresAt.getTime() - Date.now()),
  });
}

/**
 * POST /api/customer/auth/register — Register a new customer account.
 * Phone must be unique; password is hashed before storage.
 */
export async function customerRegisterController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { phone_number, password } = req.body;

    const customer = await customerService.registerCustomer({
      phone_number,
      password,
    });

    setSessionCookies(res, await customerSession.issueCustomerSession(customer.id));

    await mergeGuestCartOnAuth(req, res, customer.id);

    res.status(201).json({
      data: {
        customer_id: customer.id,
        phone_number: customer.phone_number,
        message: 'Registration successful',
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/customer/auth/login — Authenticate with phone + password.
 */
export async function customerLoginController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { phone_number, password } = req.body;

    const customer = await customerService.loginCustomer({
      phone_number,
      password,
    });

    setSessionCookies(res, await customerSession.issueCustomerSession(customer.id));

    await mergeGuestCartOnAuth(req, res, customer.id);

    res.json({
      data: {
        customer_id: customer.id,
        phone_number: customer.phone_number,
        message: 'Login successful',
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/customer/auth/logout — Invalidate customer session.
 */
export async function customerLogoutController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const cookies = req.cookies as Record<string, string> | undefined;
    await customerSession.revokeCustomerSession(req.actor!.userId, cookies?.[CUSTOMER_REFRESH_COOKIE]);
    res.clearCookie(CUSTOMER_ACCESS_COOKIE);
    res.clearCookie(CUSTOMER_REFRESH_COOKIE);

    res.json({ data: { message: 'Logout successful' } });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/customer/auth/me — Get current authenticated customer profile.
 */
export async function customerMeController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.actor) {
      throw new UnauthorizedError('Not authenticated');
    }

    const customer = await customerService.getCustomerProfile(req.actor.userId);

    res.json({ data: customer });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/customer/auth/profile — edit name and email (§2.6). */
export async function customerUpdateProfileController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const profile = await customerService.updateCustomerProfile(req.actor!.userId, req.body, req.requestId);
    res.json({ data: profile });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/customer/auth/address — replace the delivery address (§2.2/§2.6). */
export async function customerUpdateAddressController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const profile = await customerService.updateCustomerAddress(req.actor!.userId, req.body, req.requestId);
    res.json({ data: profile });
  } catch (err) {
    next(err);
  }
}

/** POST /api/customer/auth/change-password — requires the current password (§2.6). */
export async function customerChangePasswordController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { old_password, new_password } = req.body;
    await customerService.changeCustomerPassword(req.actor!.userId, old_password, new_password);
    res.json({ data: { message: 'Password changed successfully.' } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/customer/auth/refresh — Refresh access token using refresh token.
 */
export async function customerRefreshController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const refreshToken = (req.cookies as Record<string, string> | undefined)?.[CUSTOMER_REFRESH_COOKIE];
    if (!refreshToken) {
      throw new UnauthorizedError('Refresh token missing');
    }

    let tokens;
    try {
      tokens = await customerSession.refreshCustomerSession(refreshToken);
    } catch (err) {
      res.clearCookie(CUSTOMER_ACCESS_COOKIE);
      res.clearCookie(CUSTOMER_REFRESH_COOKIE);
      throw err;
    }
    setSessionCookies(res, tokens);

    res.json({ data: { message: 'Token refreshed' } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/customer/auth/request-otp — Request password reset OTP.
 * Rate-limited to prevent abuse (02-customer §2.5).
 */
export async function customerRequestOtpController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email } = req.body;

    const { otpId } = await customerPasswordRecovery.requestPasswordResetOtp(email);

    // Identical for known, unknown, and rate-limited emails (no enumeration). `otp_id` is a real
    // id only when a code was issued; otherwise it is a random uuid that can never verify.
    res.json({
      data: {
        otp_id: otpId,
        message: 'If an account with this email exists, a code has been sent.',
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/customer/auth/verify-otp — Verify OTP and get reset token.
 */
export async function customerVerifyOtpController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { otp_id, otp_code } = req.body;

    const resetToken = await customerPasswordRecovery.verifyPasswordResetOtp(otp_id, otp_code);

    res.json({
      data: {
        reset_token: resetToken,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/customer/auth/reset-password — Reset password with valid reset token.
 */
export async function customerResetPasswordController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { reset_token, new_password } = req.body;

    await customerPasswordRecovery.resetPassword(reset_token, new_password, req.requestId);

    res.json({
      data: {
        message: 'Password reset successful. Please log in with your new password.',
      },
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/customer/auth/phone-change/request — password + email OTP (spec 08 §Phone change). */
export async function customerPhoneChangeRequestController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { new_phone_number, current_password } = req.body;
    const { otpId } = await customerAccountVerification.requestPhoneChange(
      req.actor!.userId,
      new_phone_number,
      current_password,
    );
    res.json({ data: { otp_id: otpId, message: 'If the details are valid, a code has been sent to your email.' } });
  } catch (err) {
    next(err);
  }
}

/** POST /api/customer/auth/phone-change/confirm */
export async function customerPhoneChangeConfirmController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { otp_id, otp_code, new_phone_number } = req.body;
    const { phoneNumber } = await customerAccountVerification.confirmPhoneChange(
      req.actor!.userId,
      otp_id,
      otp_code,
      new_phone_number,
      req.requestId,
    );
    res.json({ data: { phone_number: phoneNumber } });
  } catch (err) {
    next(err);
  }
}

/** POST /api/customer/auth/email-change/confirm — the emailed link's token is the credential. */
export async function customerEmailChangeConfirmController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await customerAccountVerification.confirmEmailChange(req.body.token, req.requestId);
    res.json({ data: { message: 'Email address confirmed.' } });
  } catch (err) {
    next(err);
  }
}

/** POST /api/customer/auth/claim-guest — turn a guest record into an account (02-customer §2.9.8). */
export async function customerClaimGuestController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { phone_number, order_number, password } = req.body;
    const customer = await customerAccountVerification.claimGuestAccount(
      { phone: phone_number, orderNumber: order_number, password },
      req.requestId,
    );
    setSessionCookies(res, await customerSession.issueCustomerSession(customer.id));
    await mergeGuestCartOnAuth(req, res, customer.id);
    res.status(201).json({
      data: { customer_id: customer.id, phone_number: customer.phone_number, message: 'Account created.' },
    });
  } catch (err) {
    next(err);
  }
}
