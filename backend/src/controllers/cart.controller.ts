import type { NextFunction, Request, Response } from 'express';
import { CART_COOKIE, CART_COOKIE_MAX_AGE_MS } from '../config/constants.js';
import * as cartService from '../services/cart/cartService.js';
import * as wishlistService from '../services/wishlist.service.js';
import type { AddCartItemInput, CartVariantParams, UpdateCartItemInput, WishlistProductParams } from '../validation/cart.validation.js';
import type { ApiSuccess } from '../types/api.js';

/** Cart + wishlist controllers (spec 09). Cart responses are per-visitor: never cacheable. */

function cartCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: CART_COOKIE_MAX_AGE_MS,
    path: '/',
  };
}

/** Resolves the acting cart from the session or the cart cookie, issuing a fresh token when needed. */
async function actingCartId(req: Request, res: Response): Promise<string> {
  const token = (req.cookies as Record<string, string> | undefined)?.[CART_COOKIE];
  const identity = await cartService.resolveIdentity({ customerUserId: req.actor?.userId, token });
  if (identity.newToken) res.cookie(CART_COOKIE, identity.newToken, cartCookieOptions());
  return identity.cartId;
}

function send(res: Response, status: number, data: cartService.CartResponse): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ data } satisfies ApiSuccess<cartService.CartResponse>);
}

export async function getCartController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    send(res, 200, await cartService.getCart(await actingCartId(req, res)));
  } catch (err) {
    next(err);
  }
}

export async function addCartItemController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { variantId, quantity } = req.body as AddCartItemInput;
    send(res, 200, await cartService.addItem(await actingCartId(req, res), variantId, quantity));
  } catch (err) {
    next(err);
  }
}

export async function updateCartItemController(
  req: Request<CartVariantParams>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { quantity } = req.body as UpdateCartItemInput;
    send(res, 200, await cartService.updateItem(await actingCartId(req, res), req.params.variantId, quantity));
  } catch (err) {
    next(err);
  }
}

export async function removeCartItemController(
  req: Request<CartVariantParams>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    send(res, 200, await cartService.removeItem(await actingCartId(req, res), req.params.variantId));
  } catch (err) {
    next(err);
  }
}

export async function clearCartController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    send(res, 200, await cartService.clearCart(await actingCartId(req, res)));
  } catch (err) {
    next(err);
  }
}

/**
 * Called by customer login/registration: folds a guest cart into the account cart. A merge failure must
 * never fail the login — the anonymous cart stays intact and is re-merged on the next login.
 */
export async function mergeGuestCartOnAuth(req: Request, res: Response, customerUserId: string): Promise<void> {
  const token = (req.cookies as Record<string, string> | undefined)?.[CART_COOKIE];
  if (!token) return;
  try {
    if (await cartService.mergeAnonymousCart(token, customerUserId)) {
      res.clearCookie(CART_COOKIE, { path: '/' });
    }
  } catch {
    // Intentionally swallowed: see the doc comment.
  }
}

export async function listWishlistController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ data: await wishlistService.listWishlist(req.actor!.userId) });
  } catch (err) {
    next(err);
  }
}

export async function addWishlistItemController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const { productId } = req.body as { productId: string };
    res.status(200).json({ data: await wishlistService.addToWishlist(req.actor!.userId, productId) });
  } catch (err) {
    next(err);
  }
}

export async function removeWishlistItemController(
  req: Request<WishlistProductParams>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ data: await wishlistService.removeFromWishlist(req.actor!.userId, req.params.productId) });
  } catch (err) {
    next(err);
  }
}
