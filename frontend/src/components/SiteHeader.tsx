'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
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

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const cartBadge =
    count > 0 ? (
      <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-[5px] text-[11px] font-semibold leading-none text-white">
        {count}
      </span>
    ) : null;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex h-14 w-full max-w-screen-xl items-center justify-between px-lg md:h-16">
        <Link href="/" className="inline-flex min-h-11 items-center text-xl font-bold tracking-tight text-text-primary">
          {SITE_NAME}
        </Link>

        {/* Desktop navigation */}
        <nav aria-label="Main" className="hidden items-center gap-2xl text-sm font-medium md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? 'page' : undefined}
              className={`border-b-2 py-1 transition-colors duration-200 hover:text-primary ${
                isActive(link.href) ? 'border-primary text-primary' : 'border-transparent text-text-primary'
              }`}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/cart"
            aria-label={cartLabel}
            className="relative inline-flex h-11 w-11 items-center justify-center rounded-lg text-text-primary transition-colors duration-200 hover:bg-surface hover:text-primary"
          >
            <Icon name="cart" className="h-6 w-6" />
            {cartBadge}
          </Link>
        </nav>

        {/* Mobile: cart stays one tap away; everything else (including Track Order) lives in the menu. */}
        <div className="flex items-center gap-xs text-text-primary md:hidden">
          <Link
            href="/cart"
            aria-label={cartLabel}
            className="relative inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-surface hover:text-primary"
          >
            <Icon name="cart" className="h-6 w-6" />
            {cartBadge}
          </Link>
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-surface"
          >
            <Icon name={menuOpen ? 'close' : 'menu'} className="h-6 w-6" />
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="mobile-menu"
          aria-label="Mobile"
          className="border-t border-border bg-background motion-safe:animate-[menu-in_180ms_ease-out] md:hidden"
        >
          <ul className="mx-auto w-full max-w-screen-xl px-lg py-sm">
            {NAV_LINKS.map((link) => (
              <li key={link.href} className="border-b border-border last:border-b-0">
                <Link
                  href={link.href}
                  aria-current={isActive(link.href) ? 'page' : undefined}
                  className={`flex min-h-12 items-center justify-between text-base font-medium hover:text-primary ${
                    isActive(link.href) ? 'text-primary' : 'text-text-primary'
                  }`}
                >
                  {link.label}
                  <Icon name="arrowRight" className="h-4 w-4 text-text-tertiary" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
