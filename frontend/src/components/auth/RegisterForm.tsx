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
  // Set when the phone already has a guest record: the customer must prove an order number to claim it.
  const [claimMode, setClaimMode] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');

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
      if (claimMode) {
        // The claim signs the customer in (session cookies), so go straight to the account.
        await apiPost('/api/customer/auth/claim-guest', {
          phone_number: formData.phone_number,
          order_number: orderNumber.trim(),
          password: formData.password,
        });
        router.push('/account');
        router.refresh();
        return;
      }

      await apiPost('/api/customer/auth/register', {
        phone_number: formData.phone_number,
        password: formData.password,
      });

      // Registered successfully; redirect to login
      router.push('/auth/login?registered=true');
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === 'GUEST_RECORD_EXISTS') {
          // This number has ordered as a guest before. Ask for one of those order numbers instead.
          setClaimMode(true);
          setError(null);
          return;
        }
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
        <p className="text-xs text-text-secondary mt-1">At least 8 characters with one digit</p>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          value={formData.password}
          onChange={handleChange}
          className={`mt-2 h-11 w-full rounded-lg border bg-background px-md text-base outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary ${
            fieldErrors.password ? 'border-error' : 'border-border'
          }`}
        />
        {fieldErrors.password && <p className="mt-1 text-sm text-error">{fieldErrors.password}</p>}
      </div>

      <div>
        <label htmlFor="password_confirm" className="block text-sm font-medium text-text-primary">
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
          className={`mt-2 h-11 w-full rounded-lg border bg-background px-md text-base outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary ${
            fieldErrors.password_confirm ? 'border-error' : 'border-border'
          }`}
        />
        {fieldErrors.password_confirm && (
          <p className="mt-1 text-sm text-error">{fieldErrors.password_confirm}</p>
        )}
      </div>

      {claimMode && (
        <div>
          <div className="rounded-lg border border-info/30 bg-info/10 p-lg text-sm text-text-primary">
            You have ordered with this number before. Enter one of your order numbers to claim your order history
            and finish creating your account.
          </div>
          <label htmlFor="order_number" className="mt-4 block text-sm font-medium text-text-primary">
            Order number
          </label>
          <input
            id="order_number"
            name="order_number"
            required
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-md text-base outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-white transition-colors hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? 'Creating account...' : 'Create Account'}
      </button>
    </form>
  );
}
