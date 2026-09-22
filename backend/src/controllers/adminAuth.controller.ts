import type { CookieOptions, NextFunction, Request, Response } from 'express';
import {
  ADMIN_ACCESS_COOKIE,
  ADMIN_CSRF_COOKIE,
  ADMIN_REFRESH_COOKIE,
} from '../config/constants.js';
import { getEnv } from '../config/env.js';
import * as adminAuthService from '../services/adminAuth.service.js';
import type { SessionTokens } from '../services/adminAuth.service.js';
import { UnauthorizedError } from '../lib/errors.js';
import type { ApiSuccess } from '../types/api.js';
import type {
  AdminLoginInput,
  ChangePasswordInput,
} from '../validation/admin.validation.js';

/**
 * Sets the three back-office session cookies. Tokens never appear in a
 * response body (spec 03 §Request/response types note).
 */
function setSessionCookies(res: Response, tokens: SessionTokens): void {
  const env = getEnv();
  const secure = env.NODE_ENV === 'production';

  const base: CookieOptions = { httpOnly: true, secure, sameSite: 'strict', path: '/' };

  res.cookie(ADMIN_ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    maxAge: env.ADMIN_ACCESS_TOKEN_TTL_MIN * 60 * 1000,
  });
  res.cookie(ADMIN_REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    maxAge: tokens.refreshTokenExpiresAt.getTime() - Date.now(),
  });
  // The CSRF cookie is deliberately NOT httpOnly — the frontend reads it to
  // echo it back as the X-CSRF-Token header (double-submit, §11.5).
  res.cookie(ADMIN_CSRF_COOKIE, tokens.csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: tokens.refreshTokenExpiresAt.getTime() - Date.now(),
  });
}

function clearSessionCookies(res: Response): void {
  const env = getEnv();
  const secure = env.NODE_ENV === 'production';
  const base: CookieOptions = { httpOnly: true, secure, sameSite: 'strict', path: '/' };

  res.clearCookie(ADMIN_ACCESS_COOKIE, base);
  res.clearCookie(ADMIN_REFRESH_COOKIE, base);
  res.clearCookie(ADMIN_CSRF_COOKIE, { ...base, httpOnly: false });
}

export async function loginController(
  req: Request<unknown, unknown, AdminLoginInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await adminAuthService.login(req.body.userIdentifier, req.body.password);
    setSessionCookies(res, result.tokens);
    res.status(200).json({
      data: {
        user: result.user,
        permissions: result.permissions,
        mustChangePassword: result.mustChangePassword,
      },
    } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function refreshController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = (req.cookies as Record<string, string> | undefined)?.[ADMIN_REFRESH_COOKIE];
    if (!raw) {
      throw new UnauthorizedError('Session expired.');
    }
    const result = await adminAuthService.refresh(raw);
    setSessionCookies(res, result.tokens);
    res.status(200).json({ data: { refreshed: true } } satisfies ApiSuccess<{ refreshed: true }>);
  } catch (err) {
    next(err);
  }
}

export async function logoutController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = (req.cookies as Record<string, string> | undefined)?.[ADMIN_REFRESH_COOKIE];
    await adminAuthService.logout(req.actor!.userId, raw);
    clearSessionCookies(res);
    res.status(200).json({ data: { loggedOut: true } } satisfies ApiSuccess<{ loggedOut: true }>);
  } catch (err) {
    next(err);
  }
}

export async function meController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.actor!;
    const result = await adminAuthService.getMe(actor.userId, actor.permissions);
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function changePasswordController(
  req: Request<unknown, unknown, ChangePasswordInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await adminAuthService.changePassword(req.actor!.userId, req.body.currentPassword, req.body.newPassword);
    res.status(200).json({ data: { changed: true } } satisfies ApiSuccess<{ changed: true }>);
  } catch (err) {
    next(err);
  }
}
