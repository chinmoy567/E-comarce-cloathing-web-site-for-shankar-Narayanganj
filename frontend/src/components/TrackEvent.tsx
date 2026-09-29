'use client';

import { useEffect, useRef } from 'react';
import { track } from '@/lib/analytics';
import type { META_EVENTS, MetaEventPayload } from '@shared/analytics';

type ClientEventName = Exclude<(typeof META_EVENTS)[keyof typeof META_EVENTS], 'Purchase'>;

/** Fires one analytics event when mounted (once per mount, even under StrictMode). Renders nothing. */
export function TrackEvent({ name, payload }: { name: ClientEventName; payload: Partial<MetaEventPayload> }): null {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    track(name, payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
