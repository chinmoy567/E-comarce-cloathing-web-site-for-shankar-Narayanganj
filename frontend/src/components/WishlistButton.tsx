'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ApiClientError } from '@/lib/apiClient';
import { addToWishlist, removeFromWishlist } from '@/lib/wishlist';
import { useWishlist } from '@/lib/useWishlist';

/**
 * Wishlist action (13-homepage-cms §13.9; 12-whatsapp §12.3). A signed-out visitor is routed to login with a
 * return path — never blocked from browsing and never silently ignored.
 * `variant="icon"` is the compact card overlay; `variant="button"` is the labelled product-page action.
 */
export function WishlistButton({
  productId,
  productName,
  variant = 'icon',
}: {
  productId: string;
  productName: string;
  variant?: 'icon' | 'button';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, ids } = useWishlist();
  const [pending, setPending] = useState(false);
  const saved = ids.has(productId);

  function goToLogin() {
    router.push(`/auth/login?next=${encodeURIComponent(pathname)}`);
  }

  async function toggle() {
    if (status === 'signed-out') {
      goToLogin();
      return;
    }
    setPending(true);
    try {
      if (saved) await removeFromWishlist(productId);
      else await addToWishlist(productId);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) goToLogin();
    } finally {
      setPending(false);
    }
  }

  if (variant === 'button') {
    return (
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={pending}
        aria-pressed={saved}
        className="inline-flex min-h-[48px] w-full items-center justify-center rounded-lg border-2 border-primary bg-white px-4 text-sm font-bold text-primary disabled:opacity-50 md:w-auto"
      >
        {saved ? 'Saved to Wishlist' : 'Add to Wishlist'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={pending}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${productName} from wishlist` : `Add ${productName} to wishlist`}
      className="flex h-11 w-11 items-center justify-center rounded-full bg-background/90 text-primary shadow-sm hover:bg-background disabled:opacity-50"
    >
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        aria-hidden="true"
        fill={saved ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      >
        <path d="M12 21s-7.5-4.6-9.5-9.3C1.2 8.5 3 5 6.4 5c2 0 3.6 1.1 5.6 3.3C14 6.1 15.6 5 17.6 5 21 5 22.8 8.5 21.5 11.7 19.5 16.4 12 21 12 21z" />
      </svg>
    </button>
  );
}
