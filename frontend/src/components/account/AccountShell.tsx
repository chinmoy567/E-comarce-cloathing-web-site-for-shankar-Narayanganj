import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';

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
      <Link href={backHref} className="-ml-xs mb-sm inline-flex min-h-11 items-center gap-xs text-sm font-semibold text-primary hover:underline">
        <Icon name="arrowLeft" className="h-4 w-4" />
        {backLabel}
      </Link>
      <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
      {subtitle && <p className="mt-xs text-sm text-text-secondary">{subtitle}</p>}
      <div className="mt-xl">{children}</div>
    </div>
  );
}
