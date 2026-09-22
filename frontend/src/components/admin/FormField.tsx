import type { InputHTMLAttributes } from 'react';

/**
 * Labeled text/password input matching the design skill's Form Input spec:
 * 44px height, label above (never placeholder-as-label), 2px red focus
 * border, 2px deep-red error border with message below.
 */
export function FormField({
  label,
  id,
  error,
  ...inputProps
}: {
  label: string;
  id: string;
  error?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="mb-lg w-full">
      <label htmlFor={id} className="mb-sm block text-xs font-semibold text-text-primary">
        {label}
        {inputProps.required && <span className="text-error"> *</span>}
      </label>
      <input
        id={id}
        className={`h-11 w-full rounded-lg border bg-background px-md text-base text-text-primary focus:border-2 focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-50 ${
          error ? 'border-2 border-error' : 'border border-border'
        }`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...inputProps}
      />
      {error && (
        <p id={`${id}-error`} className="mt-xs text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
