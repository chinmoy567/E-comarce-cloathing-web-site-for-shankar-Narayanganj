'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart } from '@/lib/useCart';
import { removeFromCart, updateCartQuantity } from '@/lib/cart';

/**
 * Cart page body (02-customer §"Add products to the shopping cart").
 * Client component: reads the localStorage cart reactively (spec 11 — see
 * `lib/cart.ts`'s header comment for why there is no server-side cart).
 * Prices shown here are display-only snapshots from add-to-cart time; the
 * backend recomputes authoritative prices/totals at checkout (CLAUDE.md §3).
 */
export function CartView() {
  const router = useRouter();
  const lines = useCart();

  const subtotal = lines.reduce((sum, l) => sum + l.displaySnapshot.unitPrice * l.quantity, 0);

  if (lines.length === 0) {
    return (
      <div className="text-center py-2xl">
        <p className="mb-lg text-text-secondary">Your cart is empty</p>
        <Link
          href="/products"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-lg text-sm font-bold text-white hover:bg-primary-hover"
        >
          Continue Shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-xl lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-md">
        {lines.map((line) => (
          <div
            key={`${line.productId}:${line.variantId ?? ''}`}
            className="flex gap-md rounded-lg border border-border p-lg"
          >
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-surface">
              {line.displaySnapshot.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={line.displaySnapshot.imageUrl} alt={line.displaySnapshot.productName} className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="flex flex-1 flex-col justify-between">
              <div>
                <Link href={`/product/${line.displaySnapshot.slug}`} className="text-sm font-bold text-text-primary hover:text-primary">
                  {line.displaySnapshot.productName}
                </Link>
                {line.displaySnapshot.variantDescription && (
                  <p className="text-xs text-text-secondary">{line.displaySnapshot.variantDescription}</p>
                )}
                <p className="mt-xs text-sm font-bold text-primary">৳{line.displaySnapshot.unitPrice.toLocaleString('en-BD')}</p>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-sm">
                  <button
                    type="button"
                    onClick={() => updateCartQuantity(line.productId, line.variantId, line.quantity - 1)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-base font-bold text-text-primary hover:border-primary"
                    aria-label="Decrease quantity"
                  >
                    −
                  </button>
                  <span className="min-w-[2ch] text-center text-sm font-semibold">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => updateCartQuantity(line.productId, line.variantId, line.quantity + 1)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-base font-bold text-text-primary hover:border-primary"
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removeFromCart(line.productId, line.variantId)}
                  className="text-xs font-semibold text-error underline"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="h-fit rounded-lg bg-surface p-lg">
        <h2 className="mb-md text-lg font-bold text-text-primary">Order Summary</h2>

        <div className="mb-md space-y-sm border-b border-border pb-md">
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Subtotal</span>
            <span className="font-medium">৳{subtotal.toLocaleString('en-BD')}</span>
          </div>
        </div>

        <div className="mb-lg flex justify-between">
          <span className="font-semibold">Total</span>
          <span className="text-xl font-bold">৳{subtotal.toLocaleString('en-BD')}</span>
        </div>

        <button
          type="button"
          onClick={() => router.push('/checkout')}
          className="mb-sm h-11 w-full rounded-lg bg-primary text-sm font-bold text-white hover:bg-primary-hover"
        >
          Proceed to Checkout
        </button>

        <Link href="/products" className="block text-center text-sm font-medium text-primary">
          Continue Shopping
        </Link>
      </div>
    </div>
  );
}
