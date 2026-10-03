import { NotFoundError } from '../lib/errors.js';
import * as usersRepository from '../repositories/users.repository.js';
import * as wishlistRepository from '../repositories/wishlist.repository.js';

/** Wishlist (spec 09) — registered customers only; the customer id comes from the session, never the client. */

async function customerIdFor(userId: string): Promise<string> {
  const user = await usersRepository.findById(userId);
  if (!user?.customerId) throw new NotFoundError('Customer not found.');
  return user.customerId;
}

export async function listWishlist(userId: string) {
  return wishlistRepository.list(await customerIdFor(userId));
}

export async function addToWishlist(userId: string, productId: string) {
  const customerId = await customerIdFor(userId);
  if (!(await wishlistRepository.add(customerId, productId))) throw new NotFoundError('Product not found.');
  return wishlistRepository.list(customerId);
}

export async function removeFromWishlist(userId: string, productId: string) {
  const customerId = await customerIdFor(userId);
  await wishlistRepository.remove(customerId, productId);
  return wishlistRepository.list(customerId);
}
