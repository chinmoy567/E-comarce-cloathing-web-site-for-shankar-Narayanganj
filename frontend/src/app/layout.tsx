import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_OG_IMAGE_PATH,
  SITE_URL,
  pageTitle,
} from '@/lib/site';
// import { PixelInit } from '@/components/PixelInit';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

/**
 * Site-wide metadata defaults (`seo` skill §1, §4–§5).
 *
 * `metadataBase` makes every relative canonical/OG URL in a child route resolve
 * against the canonical domain, so per-page metadata never needs to repeat it.
 * The title template gives each page `<Page> | Fabrillke` while the homepage
 * renders the bare brand name.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: pageTitle(),
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: pageTitle(),
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: 'en_US',
    images: [{ url: SITE_OG_IMAGE_PATH, width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: 'summary_large_image',
    title: pageTitle(),
    description: SITE_DESCRIPTION,
    images: [SITE_OG_IMAGE_PATH],
  },
};

/**
 * Root layout. Mobile-first, English-only chrome, 16px page gutters
 * (spec 01 §Frontend work).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-background text-text-primary min-h-screen">
        {/* <PixelInit /> */}
        <main className="mx-auto w-full max-w-screen-xl px-lg py-2xl">{children}</main>
      </body>
    </html>
  );
}
