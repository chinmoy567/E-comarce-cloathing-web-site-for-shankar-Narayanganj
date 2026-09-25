'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiPost } from '@/lib/apiClient';

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
      router.push('/account');
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
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700 text-sm">{error}</div>}

      <div>
        <label htmlFor="phone_number" className="block text-sm font-medium text-gray-700">
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
          className={`mt-2 w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition ${
            fieldErrors.phone_number ? 'border-red-500' : 'border-gray-300'
          }`}
        />
        {fieldErrors.phone_number && <p className="mt-1 text-sm text-red-600">{fieldErrors.phone_number}</p>}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
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
          className={`mt-2 w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition ${
            fieldErrors.password ? 'border-red-500' : 'border-gray-300'
          }`}
        />
        {fieldErrors.password && <p className="mt-1 text-sm text-red-600">{fieldErrors.password}</p>}
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400 transition"
      >
        {isLoading ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  );
}
