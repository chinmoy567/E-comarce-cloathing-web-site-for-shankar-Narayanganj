'use client';

import Link from 'next/link';
import { useWishlist } from '@/lib/useWishlist';
import { toProductSummary } from '@/lib/productSummary';
import { loadWishlist } from '@/lib/wishlist';
import { ProductCard } from '@/components/ProductCard';

/** Saved products (spec 09). Reuses the shared `<ProductCard />`, so the wishlist action works in place. */
export function WishlistGrid() {
  const { status, items } = useWishlist();

  if (status === 'unknown') {
    return (
      <div className="grid grid-cols-2 gap-md" aria-busy="true" aria-label="Loading wishlist">
        {[0, 1].map((i) => (
          <div key={i} className="aspect-[3/4] animate-pulse rounded-lg bg-surface" />
        ))}
      </div>
    );
  }

  if (status === 'signed-out') {
    return (
      <div className="py-xl text-center">
        <p className="mb-md text-text-secondary">Sign in to see your wishlist.</p>
        <Link
          href="/auth/login?next=%2Faccount%2Fwishlist"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-lg text-sm font-bold text-white hover:bg-primary-hover"
        >
          Sign in
        </Link>
        <button type="button" onClick={() => void loadWishlist()} className="sr-only">
          Retry
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-xl text-center">
        <p className="mb-md text-text-secondary">Your wishlist is empty.</p>
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
    <div className="grid grid-cols-2 gap-md md:grid-cols-3">
      {items.map((product) => (
        <ProductCard key={product.id} product={toProductSummary(product)} />
      ))}
    </div>
  );
}
