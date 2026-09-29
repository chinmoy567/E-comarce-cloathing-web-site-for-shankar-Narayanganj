'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SITE_DOMAIN, SITE_NAME } from '@/lib/site';

/** Storefront footer. Hidden on back-office routes. */
export function SiteFooter() {
  const pathname = usePathname();
  if (pathname.startsWith('/admin')) return null;

  return (
    <footer className="mt-2xl border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-sm px-lg py-2xl text-sm text-text-secondary sm:flex-row sm:items-center sm:justify-between">
        <p>
          &copy; {new Date().getFullYear()} {SITE_NAME} &middot; {SITE_DOMAIN}
        </p>
        <nav aria-label="Footer" className="flex gap-lg">
          <Link href="/products" className="hover:text-primary">
            Shop
          </Link>
          <Link href="/orders/lookup" className="hover:text-primary">
            Track Order
          </Link>
          <Link href="/auth/login" className="hover:text-primary">
            Login
          </Link>
        </nav>
      </div>
    </footer>
  );
}
