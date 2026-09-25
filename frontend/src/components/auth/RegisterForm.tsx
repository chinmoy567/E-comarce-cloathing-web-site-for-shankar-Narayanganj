'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiPost } from '@/lib/apiClient';

/**
 * Customer registration form (02-customer §2.1).
 * Phone + password with confirmation and validation.
 */
export function RegisterForm() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({
    phone_number: '',
    password: '',
    password_confirm: '',
  });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    // Client-side validation
    const newErrors: Record<string, string> = {};

    if (!formData.phone_number) {
      newErrors.phone_number = 'Phone number is required';
    } else if (!/^01[3-9]\d{8}$/.test(formData.phone_number)) {
      newErrors.phone_number = 'Invalid Bangladesh phone number';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    } else if (!/\d/.test(formData.password)) {
      newErrors.password = 'Password must contain at least one digit';
    }

    if (!formData.password_confirm) {
      newErrors.password_confirm = 'Please confirm your password';
    } else if (formData.password !== formData.password_confirm) {
      newErrors.password_confirm = 'Passwords do not match';
    }

    if (Object.keys(newErrors).length > 0) {
      setFieldErrors(newErrors);
      return;
    }

    setIsLoading(true);

    try {
      await apiPost('/api/customer/auth/register', {
        phone_number: formData.phone_number,
        password: formData.password,
      });

      // Registered successfully; redirect to login
      router.push('/auth/login?registered=true');
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.details.length > 0) {
          const fieldMap: Record<string, string> = {};
          err.details.forEach((detail) => {
            if (detail.field) {
              fieldMap[detail.field] = detail.message;
            }
          });
          setFieldErrors(fieldMap);
        }
        if (!err.details.length) {
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
        <p className="text-xs text-gray-600 mt-1">At least 8 characters with one digit</p>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          value={formData.password}
          onChange={handleChange}
          className={`mt-2 w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition ${
            fieldErrors.password ? 'border-red-500' : 'border-gray-300'
          }`}
        />
        {fieldErrors.password && <p className="mt-1 text-sm text-red-600">{fieldErrors.password}</p>}
      </div>

      <div>
        <label htmlFor="password_confirm" className="block text-sm font-medium text-gray-700">
          Confirm Password
        </label>
        <input
          id="password_confirm"
          name="password_confirm"
          type="password"
          required
          autoComplete="new-password"
          value={formData.password_confirm}
          onChange={handleChange}
          className={`mt-2 w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition ${
            fieldErrors.password_confirm ? 'border-red-500' : 'border-gray-300'
          }`}
        />
        {fieldErrors.password_confirm && (
          <p className="mt-1 text-sm text-red-600">{fieldErrors.password_confirm}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400 transition"
      >
        {isLoading ? 'Creating account...' : 'Create Account'}
      </button>
    </form>
  );
}
