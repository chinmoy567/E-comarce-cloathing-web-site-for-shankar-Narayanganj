'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiPost } from '@/lib/apiClient';
import type { CheckoutPricing } from '@/lib/publicTypes';
import {
  isCurrentResponse,
  pricingRequestKey,
  type PricingPhase,
  type PricingRequest,
} from '@/lib/checkoutPricingView';

const DEBOUNCE_MS = 300;

/**
 * Fetches the backend-computed checkout pricing (spec 21 — `POST /api/checkout/validate`).
 *
 * Debounced 300 ms, the previous request is aborted, and a response is applied only when it still
 * matches the current request (so a slow earlier response can never overwrite a newer one). While a
 * new request is pending the previous figures are cleared, so a stale amount is never shown for a
 * new address. A failed or slow quote never blocks checkout: the backend recomputes at order creation.
 */
export function useCheckoutPricing(request: PricingRequest | null) {
  const key = useMemo(() => pricingRequestKey(request), [request]);
  const [state, setState] = useState<{ key: string | null; phase: PricingPhase; pricing: CheckoutPricing | null }>({
    key: null,
    phase: 'idle',
    pricing: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!request || key === null) {
      setState({ key: null, phase: 'idle', pricing: null });
      return;
    }

    setState({ key, phase: 'loading', pricing: null });
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      apiPost<CheckoutPricing>('/api/checkout/validate', request, { signal: controller.signal })
        .then((pricing) => {
          if (controller.signal.aborted) return;
          setState((current) =>
            isCurrentResponse(key, current.key) ? { key, phase: 'ready', pricing } : current,
          );
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setState((current) =>
            isCurrentResponse(key, current.key) ? { key, phase: 'error', pricing: null } : current,
          );
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // `request` is captured through `key`, its serialised identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { phase: state.phase, pricing: state.pricing, retry };
}
