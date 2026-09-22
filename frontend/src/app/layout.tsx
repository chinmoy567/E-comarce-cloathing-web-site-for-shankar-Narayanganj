import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Shankar — Fashion & Clothing',
  description: 'Online fashion and clothing store.',
};

/**
 * Root layout. Mobile-first, English-only chrome, 16px page gutters
 * (spec 01 §Frontend work).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-background text-text-primary min-h-screen">
        <main className="mx-auto w-full max-w-screen-xl px-lg py-2xl">{children}</main>
      </body>
    </html>
  );
}
