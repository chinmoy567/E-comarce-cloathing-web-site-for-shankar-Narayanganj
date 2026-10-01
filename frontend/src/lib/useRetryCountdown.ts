'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Seconds remaining after a 429 `Retry-After`. The submit button stays disabled until it reaches zero.
 * The interval only runs while a wait is active — there is no polling and no auto-refresh.
 */
export function useRetryCountdown(): { secondsLeft: number; start: (seconds: number | undefined) => void; clear: () => void } {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = window.setInterval(() => setSecondsLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [secondsLeft > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback((seconds: number | undefined) => setSecondsLeft(Math.max(1, Math.min(seconds ?? 60, 3600))), []);
  const clear = useCallback(() => setSecondsLeft(0), []);
  return { secondsLeft, start, clear };
}
