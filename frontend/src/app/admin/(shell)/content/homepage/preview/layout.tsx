import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The preview exposes unpublished content to an authenticated admin only; it must never be indexed.
export const metadata: Metadata = {
  title: 'Homepage preview',
  robots: { index: false, follow: false },
};

export default function PreviewLayout({ children }: { children: ReactNode }) {
  return children;
}
