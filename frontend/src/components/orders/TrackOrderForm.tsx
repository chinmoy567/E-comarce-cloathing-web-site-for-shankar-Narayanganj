'use client';

import { useEffect, useRef, useState } from 'react';
import { apiPost, ApiClientError } from '@/lib/apiClient';
import type { TrackOrderResponse } from '@/lib/trackOrderTypes';
import { TRACKING_ID_ERROR, TRACK_PREFILL_KEY, validateTrackingId } from '@/lib/tracking';
import { useRetryCountdown } from '@/lib/useRetryCountdown';
import { TrackingNotFound } from './TrackingNotFound';
import { TrackingResult } from './TrackingResult';

type View =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'result'; response: TrackOrderResponse }
  | { phase: 'error'; message: string };

/**
 * Public Track Order form (04-courier §4.14): ONE input and one button, no login. Posts the courier Order ID /
 * Tracking ID — a different feature from the guest order lookup (§4.14.1). The previous result is cleared on
 * any new submit or error so an old result is never shown beside a new one.
 */
export function TrackOrderForm() {
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ phase: 'idle' });
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const { secondsLeft, start, clear } = useRetryCountdown();

  // Pre-fill (never auto-submit) from the account order page. sessionStorage, not a query string: the root
  // PixelInit reports page URLs to Meta and a tracking id must not travel there.
  useEffect(() => {
    try {
      const prefill = window.sessionStorage.getItem(TRACK_PREFILL_KEY);
      if (prefill) {
        setValue(prefill);
        window.sessionStorage.removeItem(TRACK_PREFILL_KEY);
      }
    } catch {
      // storage unavailable — the customer can still type the id
    }
  }, []);

  useEffect(() => {
    if (view.phase === 'result' && view.response.found) document.getElementById('track-order-result')?.focus();
  }, [view]);

  const loading = view.phase === 'loading';

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current || secondsLeft > 0) return;

    const trimmed = value.trim();
    const problem = validateTrackingId(trimmed);
    if (problem) {
      setFieldError(problem);
      setView({ phase: 'idle' });
      document.getElementById('trackingId')?.focus();
      return;
    }

    setFieldError(null);
    inFlight.current = true;
    controller.current?.abort();
    controller.current = new AbortController();
    setView({ phase: 'loading' });
    clear();
    try {
      const response = await apiPost<TrackOrderResponse>(
        '/api/track-order',
        { trackingId: trimmed },
        { signal: controller.current.signal },
      );
      setView({ phase: 'result', response });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof ApiClientError && err.status === 429) {
        start(err.retryAfter);
        setView({ phase: 'error', message: err.message });
      } else if (err instanceof ApiClientError && err.code === 'VALIDATION_ERROR') {
        setFieldError(TRACKING_ID_ERROR);
        setView({ phase: 'idle' });
      } else if (err instanceof ApiClientError) {
        setView({ phase: 'error', message: err.status === 0 ? err.message : 'Something went wrong. Please try again.' });
      } else {
        setView({ phase: 'error', message: 'Something went wrong. Please try again.' });
      }
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-md">
        <div>
          <label htmlFor="trackingId" className="mb-sm block text-xs font-semibold text-text-primary">
            Order ID / Tracking ID
          </label>
          <input
            id="trackingId"
            type="text"
            required
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={value}
            readOnly={loading}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby="trackingHelp trackingError"
            onChange={(e) => {
              setValue(e.target.value);
              setFieldError(null);
            }}
            className="h-11 w-full rounded-lg border border-border bg-background px-md font-mono text-base text-text-primary focus:border-2 focus:border-primary focus:outline-none"
          />
          <p id="trackingHelp" className="mt-sm text-xs text-text-secondary">
            You can find your Order ID or Tracking ID in the SMS sent by the courier, or on your order confirmation once
            the shipment has been created.
          </p>
          <p id="trackingError" role="alert" className="mt-sm text-xs text-error">
            {fieldError}
          </p>
        </div>
        <button
          type="submit"
          disabled={loading || secondsLeft > 0 || !value.trim()}
          className="h-12 w-full rounded-lg bg-primary text-sm font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Checking…' : secondsLeft > 0 ? `Try again in ${secondsLeft}s` : 'Track Order'}
        </button>
      </form>

      <div aria-live="polite" aria-busy={loading}>
        {view.phase === 'error' && (
          <p role="alert" className="mt-lg text-sm text-error">
            {view.message}
          </p>
        )}
        {view.phase === 'result' &&
          (view.response.found ? (
            <TrackingResult result={view.response} />
          ) : (
            <TrackingNotFound message={view.response.message} showLookupLink={view.response.reason === 'NOT_AVAILABLE_YET'} />
          ))}
      </div>
    </div>
  );
}
