import type { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../lib/errors.js';
import * as customerService from '../services/customer.service.js';
import { signAccessToken, generateRefreshToken, hashRefreshToken } from '../lib/session.js';
import { CUSTOMER_ACCESS_COOKIE, CUSTOMER_REFRESH_COOKIE } from '../config/constants.js';

/**
 * Customer auth controllers (02-customer §2.1–2.6).
 * Sessions separate from admin (scope: 'customer' vs 'admin').
 */

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

    // Create session tokens
    const accessToken = signAccessToken({
      sub: customer.id,
      scope: 'customer',
      role: 'CUSTOMER',
    });
    const refreshToken = generateRefreshToken();
    const hashedRefreshToken = hashRefreshToken(refreshToken);

    // TODO: Store refresh token in database

    res.cookie(CUSTOMER_ACCESS_COOKIE, accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie(CUSTOMER_REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

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

    // Create session tokens
    const accessToken = signAccessToken({
      sub: customer.id,
      scope: 'customer',
      role: 'CUSTOMER',
    });
    const refreshToken = generateRefreshToken();
    const hashedRefreshToken = hashRefreshToken(refreshToken);

    // TODO: Store refresh token in database

    res.cookie(CUSTOMER_ACCESS_COOKIE, accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000,
    });

    res.cookie(CUSTOMER_REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

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

    // TODO: Verify refresh token against database

    // For now, just issue a new access token
    // In production, verify the hash in the database

    const customerId = req.actor?.userId;
    if (!customerId) {
      throw new UnauthorizedError('Not authenticated');
    }

    const newAccessToken = signAccessToken({
      sub: customerId,
      scope: 'customer',
      role: 'CUSTOMER',
    });

    res.cookie(CUSTOMER_ACCESS_COOKIE, newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000,
    });

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

    const result = await customerService.requestPasswordResetOtp(email);

    // Don't expose OTP ID to prevent enumeration — just confirm email was sent
    res.json({
      data: {
        message: 'If an account with this email exists, an OTP has been sent.',
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

    const resetToken = await customerService.verifyPasswordResetOtp(otp_id, otp_code);

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

    await customerService.resetPassword(reset_token, new_password);

    res.json({
      data: {
        message: 'Password reset successful. Please log in with your new password.',
      },
    });
  } catch (err) {
    next(err);
  }
}
