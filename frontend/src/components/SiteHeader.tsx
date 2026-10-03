'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SITE_NAME } from '@/lib/site';
import { useCart } from '@/lib/useCart';

/** The storefront's primary links. "Track Order" is labelled exactly that everywhere (04-courier §4.14, §4.14.8). */
const NAV_LINKS = [
  { href: '/products', label: 'Shop' },
  { href: '/search', label: 'Search' },
  { href: '/track-order', label: 'Track Order' },
  { href: '/account', label: 'Account' },
] as const;

/** Storefront header. Hidden on back-office routes, which render their own shell. */
export function SiteHeader() {
  const pathname = usePathname();
  const lines = useCart();
  const [menuOpen, setMenuOpen] = useState(false);

  // A navigation closes the mobile menu.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (pathname.startsWith('/admin')) return null;

  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const cartLabel = `Cart, ${count} item${count === 1 ? '' : 's'}`;
  const cartText = `Cart${count > 0 ? ` (${count})` : ''}`;

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-14 w-full max-w-screen-xl items-center justify-between px-lg">
        <Link href="/" className="text-lg font-bold text-text-primary">
          {SITE_NAME}
        </Link>

        {/* Desktop navigation */}
        <nav aria-label="Main" className="hidden items-center gap-lg text-sm font-medium text-text-primary sm:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-primary">
              {link.label}
            </Link>
          ))}
          <Link href="/cart" className="hover:text-primary" aria-label={cartLabel}>
            {cartText}
          </Link>
        </nav>

        {/* Mobile: cart stays one tap away; everything else (including Track Order) lives in the menu. */}
        <div className="flex items-center gap-md text-sm font-medium text-text-primary sm:hidden">
          <Link href="/cart" className="inline-flex min-h-11 items-center hover:text-primary" aria-label={cartLabel}>
            {cartText}
          </Link>
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-md font-semibold"
          >
            {menuOpen ? 'Close' : 'Menu'}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav id="mobile-menu" aria-label="Mobile" className="border-t border-border bg-background sm:hidden">
          <ul className="mx-auto w-full max-w-screen-xl px-lg py-sm">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="flex min-h-11 items-center text-sm font-medium text-text-primary hover:text-primary">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
