import * as cartRepository from '../../repositories/cart.repository.js';
import type { Db } from '../../repositories/db.js';

/**
 * The single function that turns a cart into priced lines (spec 09). Specs 10 (coupon eligibility)
 * and 11 (order creation) call this, so the cart view, coupon preview and order always price from the
 * same inputs. Money is `numeric(12,2)` end to end: totals are summed as integer paisa, never floats.
 */

export type PricedLine = {
  variantId: string;
  productId: string;
  categoryId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type UnavailableLine = { variantId: string; reason: 'OUT_OF_STOCK' | 'UNAVAILABLE'; available: number };

export type CartLineView = {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantLabel: string;
  image: { url: string; altText: string | null } | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'UNAVAILABLE';
  availableQuantity: number | null;
};

const toPaisa = (amount: string): number => Math.round(Number(amount) * 100);
const fromPaisa = (paisa: number): number => paisa / 100;

export async function resolveCartLines(
  cartId: string,
  db?: Db,
): Promise<{
  lines: CartLineView[];
  priced: PricedLine[];
  merchandiseSubtotal: number;
  unavailable: UnavailableLine[];
}> {
  const rows = await cartRepository.listPricedLines(cartId, db);
  let subtotalPaisa = 0;
  const lines: CartLineView[] = [];
  const priced: PricedLine[] = [];
  const unavailable: UnavailableLine[] = [];

  for (const r of rows) {
    const linePaisa = toPaisa(r.line_total);
    subtotalPaisa += linePaisa;

    let availability: CartLineView['availability'] = 'AVAILABLE';
    if (!r.purchasable) availability = 'UNAVAILABLE';
    else if (r.stock_quantity < r.quantity) availability = 'OUT_OF_STOCK';

    if (availability !== 'AVAILABLE') {
      unavailable.push({
        variantId: r.variant_id,
        reason: availability,
        available: r.purchasable ? r.stock_quantity : 0,
      });
    }

    priced.push({
      variantId: r.variant_id,
      productId: r.product_id,
      categoryId: r.category_id,
      quantity: r.quantity,
      unitPrice: Number(r.unit_price),
      lineTotal: fromPaisa(linePaisa),
    });
    lines.push({
      variantId: r.variant_id,
      productId: r.product_id,
      productSlug: r.product_slug,
      productName: r.product_name,
      variantLabel: r.variant_label,
      image: r.image_url ? { url: r.image_url, altText: r.image_alt } : null,
      unitPrice: Number(r.unit_price),
      quantity: r.quantity,
      lineTotal: fromPaisa(linePaisa),
      availability,
      availableQuantity: availability === 'OUT_OF_STOCK' ? r.stock_quantity : null,
    });
  }

  return { lines, priced, merchandiseSubtotal: fromPaisa(subtotalPaisa), unavailable };
}

/** Pricing-only view for specs 10/11: priced lines, subtotal and unavailable lines. */
export async function resolveCartForPricing(cartId: string, db?: Db) {
  const { priced, merchandiseSubtotal, unavailable } = await resolveCartLines(cartId, db);
  return { lines: priced, merchandiseSubtotal, unavailable };
}
