'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { initPixel, track } from '@/lib/analytics';
import { META_EVENTS } from '@shared/analytics';

/**
 * PixelInit: initializes Meta Pixel on mount and fires PageView on route changes.
 * Mount this once in the root layout so every page fires a PageView event.
 * (spec 18 §Event placement)
 */
export function PixelInit(): null {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initialize Pixel on first mount
  useEffect(() => {
    initPixel();
  }, []);

  // Fire PageView on route change
  useEffect(() => {
    track(META_EVENTS.PAGE_VIEW, {
      content_name: pathname,
    });
  }, [pathname, searchParams]);

  return null;
}
