import type { ReactNode, SelectHTMLAttributes } from 'react';

/**
 * Labeled select matching the design skill's Select/Dropdown spec: 44px
 * height, label above, 2px red focus border, 2px deep-red error border with
 * message below — same conventions as `FormField.tsx`.
 */
export function SelectField({
  label,
  id,
  error,
  children,
  ...selectProps
}: {
  label: string;
  id: string;
  error?: string;
  children: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="mb-lg w-full">
      <label htmlFor={id} className="mb-sm block text-xs font-semibold text-text-primary">
        {label}
        {selectProps.required && <span className="text-error"> *</span>}
      </label>
      <select
        id={id}
        className={`h-11 w-full rounded-lg border bg-background px-md text-base text-text-primary focus:border-2 focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-50 ${
          error ? 'border-2 border-error' : 'border border-border'
        }`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...selectProps}
      >
        {children}
      </select>
      {error && (
        <p id={`${id}-error`} className="mt-xs text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
