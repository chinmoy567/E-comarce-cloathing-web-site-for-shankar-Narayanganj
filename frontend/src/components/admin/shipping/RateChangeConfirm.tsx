'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/admin/Button';

/**
 * In-page confirmation dialog (spec 21). Focus moves into the dialog and is trapped there; Escape
 * cancels. Confirm is disabled while the request is pending, so a double-click cannot submit twice.
 */
export function RateChangeConfirm({
  title,
  current,
  next,
  message,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  /** What customers are charged now — omitted for a first rate. */
  current?: string;
  /** What they will be charged after this change. */
  next: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !busy) {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rate-confirm-title"
      onKeyDown={onKeyDown}
      className="rounded-lg border-2 border-primary bg-background p-lg"
    >
      <h3 id="rate-confirm-title" className="mb-sm text-base font-bold text-text-primary">
        {title}
      </h3>
      <dl className="mb-md space-y-xs text-sm">
        {current !== undefined && (
          <div className="flex justify-between gap-md">
            <dt className="text-text-secondary">Current</dt>
            <dd className="text-right font-medium">{current}</dd>
          </div>
        )}
        <div className="flex justify-between gap-md">
          <dt className="text-text-secondary">New</dt>
          <dd className="text-right font-medium">{next}</dd>
        </div>
      </dl>
      <p className="mb-md text-sm font-semibold text-text-primary">{message}</p>
      <div className="flex flex-col gap-sm sm:flex-row">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-12 w-full rounded-lg border-2 border-border text-sm font-bold text-text-primary disabled:opacity-50 sm:w-auto sm:px-lg"
        >
          Cancel
        </button>
        <Button type="button" onClick={onConfirm} loading={busy} className="h-12">
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
