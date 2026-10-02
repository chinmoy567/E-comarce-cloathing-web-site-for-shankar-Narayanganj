'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/admin/Button';

/** In-page destructive confirmation with focus trapped inside and Escape to cancel. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape' && !busy) {
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = containerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/50 p-md" onKeyDown={onKeyDown}>
      <div
        ref={containerRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="w-full max-w-sm rounded-lg bg-background p-lg"
      >
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p id="confirm-message" className="mt-sm text-sm text-text-secondary">
          {message}
        </p>
        <div className="mt-lg flex flex-col gap-sm sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-12 rounded-lg border border-border px-lg text-sm font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <Button type="button" variant="destructive" loading={busy} onClick={onConfirm} className="h-12">
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
