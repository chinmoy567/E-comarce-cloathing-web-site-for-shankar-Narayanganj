import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Renders a CTA only when its URL is a relative storefront path or an
 * `https://` URL (13-homepage-cms §13.13). The backend already rejects
 * anything else; this is defence in depth, never the control.
 */
export function CtaLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  if (href.startsWith('/') && !href.startsWith('//')) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  if (href.startsWith('https://')) {
    return (
      <a href={href} rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return null;
}
