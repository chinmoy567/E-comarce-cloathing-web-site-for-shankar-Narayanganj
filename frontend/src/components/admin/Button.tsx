import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'destructive';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover active:bg-primary-active',
  secondary: 'border-2 border-primary bg-background text-primary hover:bg-surface active:bg-border/40',
  destructive: 'bg-error text-white hover:bg-error/90',
};

/** 44px-minimum button matching the design skill's Button specs. No shadows, no gradients. */
export function Button({
  variant = 'primary',
  loading = false,
  className = '',
  children,
  disabled,
  ...props
}: {
  variant?: Variant;
  loading?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`h-11 w-full rounded-lg px-lg text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${VARIANT_CLASSES[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? 'Please wait…' : children}
    </button>
  );
}
