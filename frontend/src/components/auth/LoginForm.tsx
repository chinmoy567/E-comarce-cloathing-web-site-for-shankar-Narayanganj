'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiPost } from '@/lib/apiClient';
import { refreshCart } from '@/lib/cart';

/** Same-site relative paths only, so a `next` value can never become an open redirect. */
function safeNextPath(): string {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/account';
}

/**
 * Customer login form (02-customer §2.4).
 * Phone + password submission with error handling and loading state.
 */
export function LoginForm() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({
    phone_number: '',
    password: '',
  });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setFieldErrors({});

    try {
      await apiPost('/api/customer/auth/login', formData);

      // Session cookie set by API; redirect to account
      // The backend merged any guest cart into the account cart during login.
      void refreshCart();
      router.push(safeNextPath());
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.details.length > 0) {
          // Field-level errors
          const fieldMap: Record<string, string> = {};
          err.details.forEach((detail) => {
            if (detail.field) {
              fieldMap[detail.field] = detail.message;
            }
          });
          setFieldErrors(fieldMap);
        }
        // General error
        if (!err.details.length || err.status === 401) {
          setError(err.message);
        }
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear field error when user starts typing
    if (fieldErrors[name]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <div className="rounded-lg border border-error/30 bg-error/10 p-lg text-sm text-error">{error}</div>}

      <div>
        <label htmlFor="phone_number" className="block text-sm font-medium text-text-primary">
          Phone Number
        </label>
        <input
          id="phone_number"
          name="phone_number"
          type="tel"
          placeholder="01XXXXXXXXX"
          required
          autoComplete="tel"
          value={formData.phone_number}
          onChange={handleChange}
          className={`mt-2 h-11 w-full rounded-lg border bg-background px-md text-base outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary ${
            fieldErrors.phone_number ? 'border-error' : 'border-border'
          }`}
        />
        {fieldErrors.phone_number && <p className="mt-1 text-sm text-error">{fieldErrors.phone_number}</p>}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-text-primary">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          value={formData.password}
          onChange={handleChange}
          className={`mt-2 h-11 w-full rounded-lg border bg-background px-md text-base outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary ${
            fieldErrors.password ? 'border-error' : 'border-border'
          }`}
        />
        {fieldErrors.password && <p className="mt-1 text-sm text-error">{fieldErrors.password}</p>}
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-white transition-colors hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  );
}
