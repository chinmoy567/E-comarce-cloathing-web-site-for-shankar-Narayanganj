'use client';

import { useState } from 'react';
import { apiPost, ApiClientError } from '@/lib/apiClient';

/**
 * Checkout coupon-entry field (10-coupon-discount §8.15a, plan §6). Built
 * standalone — no real checkout page exists yet to mount it on (spec 11's
 * job); exported ready for that page to import directly.
 *
 * Holds only the coupon CODE STRING in its own state. The discount shown
 * always comes from the last backend response — this component never
 * computes or displays a discount value it derived itself (CLAUDE.md §3,
 * §8.16).
 */

export type CouponLineInput = { variantId: string; quantity: number };

export type AppliedCoupon = {
  couponCode: string;
  discountType: 'percentage' | 'fixed_amount';
  discountAmount: number;
  eligibleSubtotal: number;
  message: string;
};

type ValidateCouponResponse =
  | { valid: true; couponCode: string; discountType: 'percentage' | 'fixed_amount'; discountAmount: number; eligibleSubtotal: number; message: string }
  | { valid: false; message: string };

type State =
  | { phase: 'idle' }
  | { phase: 'validating' }
  | { phase: 'applied'; applied: AppliedCoupon }
  | { phase: 'error'; message: string };

export type CouponFieldProps = {
  /** The current cart lines — ids and quantities only, never prices/totals (§8.16). */
  lines: CouponLineInput[];
  /** Called with the full applied-coupon result on success, or null when removed. */
  onApplied: (applied: AppliedCoupon | null) => void;
};

export function CouponField({ lines, onApplied }: CouponFieldProps) {
  const [code, setCode] = useState('');
  const [state, setState] = useState<State>({ phase: 'idle' });

  async function submit(nextCode: string) {
    setState({ phase: 'validating' });
    try {
      const result = await apiPost<ValidateCouponResponse>('/api/coupons/validate', {
        code: nextCode,
        lines,
      });

      if (!result.valid) {
        setState({ phase: 'error', message: result.message });
        onApplied(null);
        return;
      }

      const applied: AppliedCoupon = {
        couponCode: result.couponCode,
        discountType: result.discountType,
        discountAmount: result.discountAmount,
        eligibleSubtotal: result.eligibleSubtotal,
        message: result.message,
      };
      setState({ phase: 'applied', applied });
      onApplied(applied);
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
      });
      onApplied(null);
    }
  }

  async function handleApplyClick() {
    const trimmed = code.trim();
    if (!trimmed) return;

    // Applying a second code replaces the first with a confirmation prompt,
    // re-validating fully (§8.17) — never simply swapping the code.
    if (state.phase === 'applied') {
      const confirmed = window.confirm(`Replace ${state.applied.couponCode} with ${trimmed.toUpperCase()}?`);
      if (!confirmed) return;
    }

    await submit(trimmed);
  }

  function handleRemove() {
    setCode('');
    setState({ phase: 'idle' });
    onApplied(null);
  }

  const disabled = state.phase === 'validating';

  return (
    <div className="w-full">
      <label htmlFor="coupon-code" className="mb-sm block text-xs font-semibold text-text-primary">
        Discount / Coupon
      </label>
      <div className="flex gap-sm">
        <input
          id="coupon-code"
          type="text"
          placeholder="Enter coupon code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={disabled}
          className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-md text-base text-text-primary focus:border-2 focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void handleApplyClick()}
          disabled={disabled || code.trim().length === 0}
          className="h-11 shrink-0 rounded-lg bg-primary px-lg text-sm font-bold text-white hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.phase === 'validating' ? 'Applying…' : 'Apply'}
        </button>
      </div>

      {state.phase === 'applied' && (
        <div className="mt-sm flex items-center justify-between gap-sm rounded-lg border border-accent/30 bg-accent/5 p-md">
          <p className="text-sm font-medium text-accent">{state.applied.message}</p>
          <button
            type="button"
            onClick={handleRemove}
            className="shrink-0 text-xs font-semibold text-text-secondary underline"
          >
            Remove
          </button>
        </div>
      )}

      {state.phase === 'error' && (
        <p role="alert" className="mt-sm text-xs text-error">
          {state.message}
        </p>
      )}
    </div>
  );
}
