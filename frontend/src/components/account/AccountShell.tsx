import Link from 'next/link';
import type { ReactNode } from 'react';

/** Page frame for the signed-in account sub-pages: back link, title, optional subtitle. */
export function AccountShell({
  title,
  subtitle,
  backHref = '/account',
  backLabel = 'My Account',
  children,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <Link href={backHref} className="mb-lg inline-block text-sm font-semibold text-primary hover:underline">
        ← {backLabel}
      </Link>
      <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
      {subtitle && <p className="mt-xs text-sm text-text-secondary">{subtitle}</p>}
      <div className="mt-xl">{children}</div>
    </div>
  );
}
