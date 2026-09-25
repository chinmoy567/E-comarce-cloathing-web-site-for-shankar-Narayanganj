'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiPost, ApiClientError } from '@/lib/apiClient';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import type { CouponDiscountType, CouponResponse, CreateCouponRequest } from '@/lib/admin/types';

/**
 * Coupon create form (10-coupon-discount §8.3, plan §6). Product/category
 * restriction controls are deliberately absent — §8.12 v1 scope hides them
 * rather than exposing a control that silently does nothing.
 */
export default function NewCouponPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [discountType, setDiscountType] = useState<CouponDiscountType>('PERCENTAGE');
  const [discountValue, setDiscountValue] = useState('');
  const [minimumOrderAmount, setMinimumOrderAmount] = useState('');
  const [maximumDiscountAmount, setMaximumDiscountAmount] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [usageLimit, setUsageLimit] = useState('');
  const [perCustomerLimit, setPerCustomerLimit] = useState('');
  const [customerEligibility, setCustomerEligibility] = useState<CreateCouponRequest['customerEligibility']>('ALL_CUSTOMERS');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPhase('submitting');
    setErrorMessage('');

    try {
      const body: CreateCouponRequest = {
        code,
        name,
        description: description || null,
        discountType,
        discountValue: Number(discountValue),
        minimumOrderAmount: minimumOrderAmount ? Number(minimumOrderAmount) : null,
        maximumDiscountAmount:
          discountType === 'PERCENTAGE' && maximumDiscountAmount ? Number(maximumDiscountAmount) : null,
        startsAt: new Date(startsAt).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        usageLimit: usageLimit ? Number(usageLimit) : null,
        perCustomerLimit: perCustomerLimit ? Number(perCustomerLimit) : null,
        customerEligibility,
      };
      const created = await apiPost<CouponResponse>('/api/admin/coupons', body);
      router.replace(`/admin/marketing/coupons/${created.id}`);
    } catch (err) {
      setPhase('error');
      setErrorMessage(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    }
  }

  const disabled = phase === 'submitting';

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Add Coupon</h1>

      <form onSubmit={handleSubmit} noValidate>
        <FormField
          label="Code"
          id="code"
          type="text"
          required
          minLength={3}
          maxLength={32}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={disabled}
        />
        <FormField
          label="Name"
          id="name"
          type="text"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled}
        />
        <FormField
          label="Description (optional)"
          id="description"
          type="text"
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={disabled}
        />

        <div className="mb-lg">
          <span className="mb-sm block text-xs font-semibold text-text-primary">Discount Type</span>
          <div className="flex gap-md">
            <label className="flex items-center gap-xs text-sm">
              <input
                type="radio"
                name="discountType"
                checked={discountType === 'PERCENTAGE'}
                onChange={() => setDiscountType('PERCENTAGE')}
                disabled={disabled}
              />
              Percentage
            </label>
            <label className="flex items-center gap-xs text-sm">
              <input
                type="radio"
                name="discountType"
                checked={discountType === 'FIXED_AMOUNT'}
                onChange={() => {
                  setDiscountType('FIXED_AMOUNT');
                  setMaximumDiscountAmount('');
                }}
                disabled={disabled}
              />
              Fixed amount (৳)
            </label>
          </div>
        </div>

        <FormField
          label={discountType === 'PERCENTAGE' ? 'Discount value (%)' : 'Discount value (৳)'}
          id="discountValue"
          type="number"
          required
          min={0.01}
          max={discountType === 'PERCENTAGE' ? 100 : undefined}
          step="0.01"
          value={discountValue}
          onChange={(e) => setDiscountValue(e.target.value)}
          disabled={disabled}
        />

        {discountType === 'PERCENTAGE' && (
          <FormField
            label="Maximum discount amount (৳, optional)"
            id="maximumDiscountAmount"
            type="number"
            min={0.01}
            step="0.01"
            value={maximumDiscountAmount}
            onChange={(e) => setMaximumDiscountAmount(e.target.value)}
            disabled={disabled}
          />
        )}

        <FormField
          label="Minimum order amount (৳, optional)"
          id="minimumOrderAmount"
          type="number"
          min={0}
          step="0.01"
          value={minimumOrderAmount}
          onChange={(e) => setMinimumOrderAmount(e.target.value)}
          disabled={disabled}
        />

        <FormField
          label="Starts at"
          id="startsAt"
          type="datetime-local"
          required
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          disabled={disabled}
        />
        <FormField
          label="Expires at"
          id="expiresAt"
          type="datetime-local"
          required
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          disabled={disabled}
        />

        <FormField
          label="Total usage limit (optional)"
          id="usageLimit"
          type="number"
          min={1}
          step="1"
          value={usageLimit}
          onChange={(e) => setUsageLimit(e.target.value)}
          disabled={disabled}
        />
        <FormField
          label="Per-customer usage limit (optional)"
          id="perCustomerLimit"
          type="number"
          min={1}
          step="1"
          value={perCustomerLimit}
          onChange={(e) => setPerCustomerLimit(e.target.value)}
          disabled={disabled}
        />

        <div className="mb-lg">
          <label htmlFor="customerEligibility" className="mb-sm block text-xs font-semibold text-text-primary">
            Customer Eligibility
          </label>
          <select
            id="customerEligibility"
            value={customerEligibility}
            onChange={(e) => setCustomerEligibility(e.target.value as CreateCouponRequest['customerEligibility'])}
            disabled={disabled}
            className="h-11 w-full rounded-lg border border-border bg-background px-md text-base text-text-primary"
          >
            <option value="ALL_CUSTOMERS">All customers</option>
            <option value="REGISTERED_CUSTOMERS_ONLY">Registered customers only</option>
          </select>
        </div>

        {/* Product/category restriction controls are intentionally not shown
            here — §8.12 v1 scope: every coupon behaves as ALL_PRODUCTS. */}

        {phase === 'error' && (
          <div role="alert" className="mb-lg rounded-lg border border-error/30 bg-error/5 p-md">
            <p className="text-sm font-medium text-error">{errorMessage}</p>
          </div>
        )}

        <Button type="submit" loading={disabled}>
          Create Coupon
        </Button>
      </form>
    </div>
  );
}
