'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/admin/Button';
import { SelectField } from '@/components/admin/SelectField';
import { TextareaField } from '@/components/admin/TextareaField';

/**
 * Destructive-action dialog that requires an accountable reason (§5.21.2,
 * §5.21.7) and, for payment rejection, one of §3.4's listed reason codes. The
 * 10-character minimum mirrors the backend; the backend is still the control.
 */
export function ReasonDialog({
  title,
  description,
  confirmLabel,
  reasonCodes,
  submitting,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  reasonCodes?: Array<{ value: string; label: string }>;
  submitting: boolean;
  error: string | null;
  onConfirm: (input: { reason: string; reasonCode?: string }) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState(reasonCodes?.[0]?.value ?? '');
  const textareaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    textareaRef.current?.querySelector('textarea')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const trimmed = reason.trim();
  const tooShort = trimmed.length < 10;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-text-primary/50 p-md sm:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reason-dialog-title"
        className="w-full max-w-md rounded-lg border border-border bg-background p-lg"
      >
        <h2 id="reason-dialog-title" className="text-lg font-bold">
          {title}
        </h2>
        {description && <p className="mt-xs text-sm text-text-secondary">{description}</p>}

        <form
          className="mt-lg"
          onSubmit={(e) => {
            e.preventDefault();
            if (tooShort || submitting) return;
            onConfirm({ reason: trimmed, ...(reasonCodes ? { reasonCode } : {}) });
          }}
        >
          {reasonCodes && (
            <SelectField id="reason-code" label="Reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              {reasonCodes.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </SelectField>
          )}

          <div ref={textareaRef}>
            <TextareaField
              id="reason-text"
              label="Details (at least 10 characters)"
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              {...(reason.length > 0 && tooShort ? { error: 'Please give at least 10 characters.' } : {})}
            />
          </div>

          {error && (
            <p role="alert" className="mb-md text-sm text-error">
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-sm sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Keep order
            </Button>
            <Button type="submit" variant="destructive" loading={submitting} disabled={tooShort}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
