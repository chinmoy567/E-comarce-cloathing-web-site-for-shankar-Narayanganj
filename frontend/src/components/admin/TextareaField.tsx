import type { TextareaHTMLAttributes } from 'react';

/**
 * Labeled textarea matching the design skill's Textarea spec: 120px minimum
 * height, label above, 2px red focus border, 2px deep-red error border with
 * message below — same conventions as `FormField.tsx`.
 */
export function TextareaField({
  label,
  id,
  error,
  ...textareaProps
}: {
  label: string;
  id: string;
  error?: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="mb-lg w-full">
      <label htmlFor={id} className="mb-sm block text-xs font-semibold text-text-primary">
        {label}
        {textareaProps.required && <span className="text-error"> *</span>}
      </label>
      <textarea
        id={id}
        className={`min-h-[120px] w-full rounded-lg border bg-background px-md py-md text-base text-text-primary focus:border-2 focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-50 ${
          error ? 'border-2 border-error' : 'border border-border'
        }`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...textareaProps}
      />
      {error && (
        <p id={`${id}-error`} className="mt-xs text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
