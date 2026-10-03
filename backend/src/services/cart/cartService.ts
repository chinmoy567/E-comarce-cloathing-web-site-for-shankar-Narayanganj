import { randomBytes } from 'node:crypto';
import { NotFoundError } from '../../lib/errors.js';
import { sha256Hex } from '../../lib/hash.js';
import { withTransaction } from '../../lib/transaction.js';
import * as cartRepository from '../../repositories/cart.repository.js';
import * as usersRepository from '../../repositories/users.repository.js';
import { resolveCartLines, type CartLineView } from './cartPricingService.js';

/**
 * Cart business logic (spec 09). Identity is always server-derived: a customer's own cart via their
 * session, otherwise an anonymous cart bound to a hashed `cart_token` cookie. No endpoint accepts a
 * cart id, and the cart never carries a client-supplied price.
 */

export type CartResponse = {
  lines: CartLineView[];
  itemCount: number;
  merchandiseSubtotal: number;
  hasUnavailableLines: boolean;
  currency: 'BDT';
};

export type CartIdentity = { cartId: string; newToken: string | null };

/** Resolves (creating when needed) the acting cart. A bad or expired token yields a fresh empty cart. */
export async function resolveIdentity(input: { customerUserId?: string; token?: string }): Promise<CartIdentity> {
  if (input.customerUserId) {
    const user = await usersRepository.findById(input.customerUserId);
    if (user?.customerId) {
      const cart = await cartRepository.getOrCreateForCustomer(user.customerId);
      return { cartId: cart.id, newToken: null };
    }
  }
  if (input.token) {
    const existing = await cartRepository.findActiveByTokenHash(sha256Hex(input.token));
    if (existing) return { cartId: existing.id, newToken: null };
  }
  const token = randomBytes(32).toString('hex');
  const cart = await cartRepository.createAnonymous(sha256Hex(token));
  return { cartId: cart.id, newToken: token };
}

export async function getCart(cartId: string): Promise<CartResponse> {
  const { lines, merchandiseSubtotal, unavailable } = await resolveCartLines(cartId);
  return {
    lines,
    itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
    merchandiseSubtotal,
    hasUnavailableLines: unavailable.length > 0,
    currency: 'BDT',
  };
}

export async function addItem(cartId: string, variantId: string, quantity: number): Promise<CartResponse> {
  await withTransaction(async (client) => {
    // Inactive variant/product/category is indistinguishable from a nonexistent id.
    if (!(await cartRepository.isVariantPurchasable(variantId, client))) {
      throw new NotFoundError('Product not found.');
    }
    await cartRepository.upsertAddItem(cartId, variantId, quantity, client);
    await cartRepository.touch(cartId, client);
  });
  return getCart(cartId);
}

export async function updateItem(cartId: string, variantId: string, quantity: number): Promise<CartResponse> {
  const updated = await cartRepository.setItemQuantity(cartId, variantId, quantity);
  if (!updated) throw new NotFoundError('Item not in cart.');
  await cartRepository.touch(cartId);
  return getCart(cartId);
}

export async function removeItem(cartId: string, variantId: string): Promise<CartResponse> {
  const removed = await cartRepository.deleteItem(cartId, variantId);
  if (!removed) throw new NotFoundError('Item not in cart.');
  await cartRepository.touch(cartId);
  return getCart(cartId);
}

export async function clearCart(cartId: string): Promise<CartResponse> {
  await cartRepository.clearItems(cartId);
  await cartRepository.touch(cartId);
  return getCart(cartId);
}

/**
 * Absorbs a guest cart into the customer's cart on login/registration (quantities summed, capped at 99).
 * Atomic: a failure leaves the anonymous cart intact and re-mergeable. Returns true when a merge happened.
 */
export async function mergeAnonymousCart(token: string, customerUserId: string): Promise<boolean> {
  const user = await usersRepository.findById(customerUserId);
  if (!user?.customerId) return false;
  const customerId = user.customerId;

  return withTransaction(async (client) => {
    const anonymous = await cartRepository.findActiveByTokenHash(sha256Hex(token), client);
    if (!anonymous || anonymous.customerId) return false;
    const target = await cartRepository.getOrCreateForCustomer(customerId, client);
    await cartRepository.mergeInto(anonymous.id, target.id, customerId, client);
    return true;
  });
}
