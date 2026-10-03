import { z } from 'zod';

/**
 * Cart / wishlist request schemas (spec 09). `.strict()` everywhere: a `price`, `unitPrice`,
 * `lineTotal` or `subtotal` field is REJECTED, never ignored (11-security-hardening §11.6).
 */
const quantity = z.number().int().min(1).max(99);

export const addCartItemSchema = z.object({ variantId: z.string().uuid(), quantity }).strict();
export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

export const updateCartItemSchema = z.object({ quantity }).strict();
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;

export const cartVariantParamsSchema = z.object({ variantId: z.string().uuid() }).strict();
export type CartVariantParams = z.infer<typeof cartVariantParamsSchema>;

export const addWishlistItemSchema = z.object({ productId: z.string().uuid() }).strict();
export const wishlistProductParamsSchema = z.object({ productId: z.string().uuid() }).strict();
export type WishlistProductParams = z.infer<typeof wishlistProductParamsSchema>;
