'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { apiPost, ApiClientError } from '@/lib/apiClient';
import type { GuestOrderLookupResponse } from '@/lib/account';
import { useRetryCountdown } from '@/lib/useRetryCountdown';
import { GuestOrderResult } from './GuestOrderResult';

const NOT_FOUND_MESSAGE = 'We could not find an order matching those details.';

type View =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'found'; order: Extract<GuestOrderLookupResponse, { found: true }> }
  | { phase: 'error'; message: string };

/**
 * Guest order lookup by (Order Number, Phone Number) pair (02-customer §2.9.5-2.9.7), POST so neither value
 * ever lands in a URL, history or log. Every non-429, non-connection failure — wrong number, wrong phone,
 * malformed input, 4xx/5xx — shows the SAME generic message; the form never says which field was wrong.
 * The result lives in component state only and is cleared as soon as either field is edited.
 */
export function GuestOrderLookupForm() {
  const [orderNumber, setOrderNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [view, setView] = useState<View>({ phase: 'idle' });
  const inFlight = useRef(false);
  const { secondsLeft, start, clear } = useRetryCountdown();

  const loading = view.phase === 'loading';

  useEffect(() => {
    if (view.phase === 'found') document.getElementById('guest-order-result')?.focus();
  }, [view.phase]);

  function edit(setter: (v: string) => void, value: string) {
    setter(value);
    if (view.phase !== 'loading') setView({ phase: 'idle' });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current || secondsLeft > 0) return;
    inFlight.current = true;
    setView({ phase: 'loading' });
    clear();
    try {
      const data = await apiPost<GuestOrderLookupResponse>('/api/orders/lookup', {
        orderNumber: orderNumber.trim(),
        phoneNumber: phoneNumber.trim(),
      });
      setView(data.found ? { phase: 'found', order: data } : { phase: 'error', message: NOT_FOUND_MESSAGE });
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 429) {
        start(err.retryAfter);
        setView({ phase: 'error', message: err.message });
      } else if (err instanceof ApiClientError && err.status === 0) {
        // A connection failure is the one other message, because the customer must act on it.
        setView({ phase: 'error', message: err.message });
      } else {
        setView({ phase: 'error', message: NOT_FOUND_MESSAGE });
      }
    } finally {
      inFlight.current = false;
    }
  }

  const inputClass =
    'h-11 w-full rounded-lg border border-border bg-background px-md text-base text-text-primary focus:border-2 focus:border-primary focus:outline-none';

  return (
    <div className="mx-auto max-w-md">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-lg" noValidate>
        <div>
          <label htmlFor="orderNumber" className="mb-sm block text-xs font-semibold text-text-primary">
            Order Number
          </label>
          <input
            id="orderNumber"
            type="text"
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={orderNumber}
            readOnly={loading}
            onChange={(e) => edit(setOrderNumber, e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="phoneNumber" className="mb-sm block text-xs font-semibold text-text-primary">
            Phone Number
          </label>
          <input
            id="phoneNumber"
            type="tel"
            inputMode="tel"
            required
            autoComplete="tel"
            placeholder="01XXXXXXXXX"
            value={phoneNumber}
            readOnly={loading}
            onChange={(e) => edit(setPhoneNumber, e.target.value)}
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={loading || secondsLeft > 0 || !orderNumber.trim() || !phoneNumber.trim()}
          className="h-12 w-full rounded-lg bg-primary text-sm font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Looking up…' : secondsLeft > 0 ? `Try again in ${secondsLeft}s` : 'Find My Order'}
        </button>
      </form>

      <div aria-live="polite" aria-busy={loading}>
        {view.phase === 'error' && (
          <p role="alert" className="mt-lg text-sm text-error">
            {view.message}
          </p>
        )}
        {view.phase === 'found' && <GuestOrderResult order={view.order} />}
      </div>

      <p className="mt-xl text-center text-sm text-text-secondary">
        This is different from Track Order, which uses the courier&apos;s Order ID or Tracking ID.{' '}
        <Link href="/track-order" className="font-semibold text-primary underline">
          Track Order
        </Link>
      </p>
    </div>
  );
}
