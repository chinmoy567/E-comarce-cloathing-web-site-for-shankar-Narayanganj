'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { initPixel, track } from '@/lib/analytics';
import { META_EVENTS } from '@shared/analytics';

/**
 * PixelInit: initialises the Meta Pixel and fires PageView once per storefront
 * navigation (pathname changes only). Never fires under /admin — back-office
 * navigation must not reach Meta. Mount once in the root layout. (spec 18)
 */
export function PixelInit(): null {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    initPixel();
  }, []);

  useEffect(() => {
    if (lastPath.current === pathname) return; // StrictMode double effect
    lastPath.current = pathname;
    if (pathname === '/admin' || pathname.startsWith('/admin/')) return;
    track(META_EVENTS.PAGE_VIEW, {});
  }, [pathname]);

  return null;
}
