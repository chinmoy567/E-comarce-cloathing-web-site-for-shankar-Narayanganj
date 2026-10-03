'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCartState } from '@/lib/useCart';
import { refreshCart, removeFromCart, updateCartQuantity } from '@/lib/cart';
import { ApiClientError } from '@/lib/apiClient';

/**
 * Cart page body (spec 09; 02-customer §"Add products to the shopping cart").
 * Every figure rendered here — unit prices, line totals, the subtotal, availability — comes from the
 * server cart response. Nothing is summed in JavaScript: the backend is the authority for money
 * (CLAUDE.md §3). The cart is pre-discount and pre-shipping, so shipping reads "Calculated at checkout".
 */
export function CartView() {
  const router = useRouter();
  const { status, cart } = useCartState();
  const [pendingVariant, setPendingVariant] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(variantId: string, action: () => Promise<void>) {
    setActionError(null);
    setPendingVariant(variantId);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Could not update your cart. Please try again.');
      void refreshCart();
    } finally {
      setPendingVariant(null);
    }
  }

  if (status === 'idle' || (status === 'loading' && !cart)) {
    return (
      <div className="space-y-md" aria-busy="true" aria-label="Loading cart">
        {[0, 1].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg bg-surface" />
        ))}
      </div>
    );
  }

  if (status === 'error' && !cart) {
    return (
      <div className="py-2xl text-center">
        <p role="alert" className="mb-lg text-text-secondary">
          We could not load your cart.
        </p>
        <button
          type="button"
          onClick={() => void refreshCart()}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-lg text-sm font-bold text-white hover:bg-primary-hover"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!cart || cart.lines.length === 0) {
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
        {actionError && (
          <p role="alert" className="rounded-lg border border-error/30 bg-error/10 p-md text-sm text-error">
            {actionError}
          </p>
        )}
        {cart.lines.map((line) => {
          const busy = pendingVariant === line.variantId;
          return (
            <div key={line.variantId} className="flex gap-md rounded-lg border border-border p-lg">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-surface">
                {line.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={line.image.url} alt={line.image.altText ?? line.productName} className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-between gap-sm">
                <div>
                  <Link href={`/product/${line.productSlug}`} className="block truncate text-sm font-bold text-text-primary hover:text-primary">
                    {line.productName}
                  </Link>
                  {line.variantLabel && <p className="text-xs text-text-secondary">{line.variantLabel}</p>}
                  <p className="mt-xs text-sm font-bold text-primary">৳{line.unitPrice.toLocaleString('en-BD')}</p>
                  {line.availability === 'OUT_OF_STOCK' && (
                    <p role="status" className="mt-xs text-xs font-semibold text-error">
                      {line.availableQuantity && line.availableQuantity > 0
                        ? `Only ${line.availableQuantity} left in stock. Reduce the quantity to continue.`
                        : 'Out of stock. Remove it to continue.'}
                    </p>
                  )}
                  {line.availability === 'UNAVAILABLE' && (
                    <p role="status" className="mt-xs text-xs font-semibold text-error">
                      No longer available. Remove it to continue.
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-sm">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(line.variantId, () => updateCartQuantity(line.variantId, line.quantity - 1))}
                      className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-base font-bold text-text-primary hover:border-primary disabled:opacity-50"
                      aria-label={`Decrease quantity of ${line.productName}`}
                    >
                      −
                    </button>
                    <span className="min-w-[2ch] text-center text-sm font-semibold">{line.quantity}</span>
                    <button
                      type="button"
                      disabled={busy || line.quantity >= 99}
                      onClick={() => void run(line.variantId, () => updateCartQuantity(line.variantId, line.quantity + 1))}
                      className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-base font-bold text-text-primary hover:border-primary disabled:opacity-50"
                      aria-label={`Increase quantity of ${line.productName}`}
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(line.variantId, () => removeFromCart(line.variantId))}
                    className="inline-flex min-h-11 items-center px-sm text-xs font-semibold text-error underline disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="h-fit rounded-lg bg-surface p-lg">
        <h2 className="mb-md text-lg font-bold text-text-primary">Order Summary</h2>

        <dl className="mb-lg space-y-sm">
          <div className="flex justify-between text-sm">
            <dt className="text-text-secondary">Subtotal</dt>
            <dd className="font-medium">৳{cart.merchandiseSubtotal.toLocaleString('en-BD')}</dd>
          </div>
          {/* Never a placeholder amount, "৳0", "Free" or an estimate: the charge depends on the delivery district. */}
          <div className="flex justify-between gap-md text-sm">
            <dt className="text-text-secondary">Shipping</dt>
            <dd className="text-right text-text-secondary">Calculated at checkout</dd>
          </div>
        </dl>

        {cart.hasUnavailableLines && (
          <p role="alert" className="mb-sm text-xs text-error">
            Some items are unavailable. Update your cart to continue.
          </p>
        )}

        {/* UX only: the backend re-checks availability and prices when the order is created. */}
        <button
          type="button"
          disabled={cart.hasUnavailableLines}
          onClick={() => router.push('/checkout')}
          className="mb-sm h-12 w-full rounded-lg bg-primary text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-50"
        >
          Proceed to Checkout
        </button>

        <Link
          href="/products"
          className="flex h-11 w-full items-center justify-center rounded-lg border border-border text-sm font-medium text-primary"
        >
          Continue Shopping
        </Link>
      </div>
    </div>
  );
}
