'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SITE_DOMAIN, SITE_NAME } from '@/lib/site';

const FOOTER_LINKS = [
  { href: '/products', label: 'Shop' },
  { href: '/track-order', label: 'Track Order' },
  { href: '/auth/login', label: 'Login' },
] as const;

/** Storefront footer. Hidden on back-office routes. */
export function SiteFooter() {
  const pathname = usePathname();
  if (pathname.startsWith('/admin')) return null;

  return (
    <footer className="mt-3xl border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-xl px-lg py-3xl md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-lg font-bold tracking-tight text-text-primary">{SITE_NAME}</p>
          <p className="mt-xs text-sm text-text-secondary">{SITE_DOMAIN}</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-2xl gap-y-sm text-sm font-medium">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex min-h-11 items-center text-text-primary transition-colors duration-200 hover:text-primary"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="border-t border-border">
        <p className="mx-auto w-full max-w-screen-xl px-lg py-lg text-xs text-text-secondary">
          &copy; {new Date().getFullYear()} {SITE_NAME}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
