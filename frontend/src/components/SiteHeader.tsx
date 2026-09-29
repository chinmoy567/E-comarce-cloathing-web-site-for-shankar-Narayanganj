'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SITE_NAME } from '@/lib/site';
import { useCart } from '@/lib/useCart';

/** Storefront header. Hidden on back-office routes, which render their own shell. */
export function SiteHeader() {
  const pathname = usePathname();
  const lines = useCart();
  if (pathname.startsWith('/admin')) return null;

  const count = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-14 w-full max-w-screen-xl items-center justify-between px-lg">
        <Link href="/" className="text-lg font-bold text-text-primary">
          {SITE_NAME}
        </Link>
        <nav aria-label="Main" className="flex items-center gap-lg text-sm font-medium text-text-primary">
          <Link href="/products" className="hover:text-primary">
            Shop
          </Link>
          <Link href="/orders/lookup" className="hidden hover:text-primary sm:inline">
            Track Order
          </Link>
          <Link href="/account" className="hover:text-primary">
            Account
          </Link>
          <Link href="/cart" className="hover:text-primary" aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}>
            Cart{count > 0 ? ` (${count})` : ''}
          </Link>
        </nav>
      </div>
    </header>
  );
}
