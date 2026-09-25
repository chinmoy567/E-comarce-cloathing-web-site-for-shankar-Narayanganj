'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, ApiClientError } from '@/lib/apiClient';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import type { CouponDetailResponse, UpdateCouponRequest } from '@/lib/admin/types';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; coupon: CouponDetailResponse };

/** Converts an ISO timestamp to the value a `datetime-local` input expects. */
function toDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Coupon detail/edit (10-coupon-discount §8.30, plan §6). Every mutating
 * control here also has a real backend gate (`coupon.update`, `coupon.status`,
 * `coupon.delete`) — a 403 the UI didn't anticipate is handled, not assumed
 * away (`frontend` skill §3).
 */
export default function CouponDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [minimumOrderAmount, setMinimumOrderAmount] = useState('');
  const [maximumDiscountAmount, setMaximumDiscountAmount] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [usageLimit, setUsageLimit] = useState('');
  const [perCustomerLimit, setPerCustomerLimit] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    apiGet<CouponDetailResponse>(`/api/admin/coupons/${params.id}`, { signal: controller.signal })
      .then((coupon) => {
        setState({ phase: 'loaded', coupon });
        setName(coupon.name);
        setDescription(coupon.description ?? '');
        setMinimumOrderAmount(coupon.minimumOrderAmount != null ? String(coupon.minimumOrderAmount) : '');
        setMaximumDiscountAmount(coupon.maximumDiscountAmount != null ? String(coupon.maximumDiscountAmount) : '');
        setStartsAt(toDatetimeLocal(coupon.startsAt));
        setExpiresAt(toDatetimeLocal(coupon.expiresAt));
        setUsageLimit(coupon.usageLimit != null ? String(coupon.usageLimit) : '');
        setPerCustomerLimit(coupon.perCustomerLimit != null ? String(coupon.perCustomerLimit) : '');
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: 'error',
          message: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        });
      });

    return () => controller.abort();
  }, [params.id]);

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.phase !== 'loaded') return;
    setSavingProfile(true);
    setActionError('');
    setNotice('');

    try {
      const body: UpdateCouponRequest = {
        name,
        description: description || null,
        minimumOrderAmount: minimumOrderAmount ? Number(minimumOrderAmount) : null,
        maximumDiscountAmount:
          state.coupon.discountType === 'PERCENTAGE' && maximumDiscountAmount ? Number(maximumDiscountAmount) : null,
        startsAt: new Date(startsAt).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        usageLimit: usageLimit ? Number(usageLimit) : null,
        perCustomerLimit: perCustomerLimit ? Number(perCustomerLimit) : null,
      };
      const updated = await apiPatch<CouponDetailResponse>(`/api/admin/coupons/${params.id}`, body);
      setState({ phase: 'loaded', coupon: { ...updated, distinctCustomerCount: state.coupon.distinctCustomerCount } });
      setNotice('Coupon updated.');
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSetStatus(next: 'ACTIVE' | 'DISABLED') {
    if (state.phase !== 'loaded') return;
    setStatusBusy(true);
    setActionError('');
    setNotice('');

    try {
      const updated = await apiPost<CouponDetailResponse>(`/api/admin/coupons/${params.id}/status`, { status: next });
      setState({ phase: 'loaded', coupon: { ...updated, distinctCustomerCount: state.coupon.distinctCustomerCount } });
      setNotice(next === 'ACTIVE' ? 'Coupon activated.' : 'Coupon deactivated.');
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleDelete() {
    setStatusBusy(true);
    setActionError('');

    try {
      const result = await apiDelete<{ deleted?: true; archived?: true }>(`/api/admin/coupons/${params.id}`);
      if (result.archived) {
        setNotice('This coupon has been used, so it was archived instead of deleted.');
        const refreshed = await apiGet<CouponDetailResponse>(`/api/admin/coupons/${params.id}`);
        setState({ phase: 'loaded', coupon: refreshed });
        setStatusBusy(false);
        return;
      }
      router.replace('/admin/marketing/coupons');
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
      setStatusBusy(false);
    }
  }

  if (state.phase === 'loading') {
    return <p className="text-text-secondary">Loading coupon…</p>;
  }

  if (state.phase === 'error') {
    return (
      <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
        <p className="font-medium text-error">Could not load this coupon</p>
        <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
      </div>
    );
  }

  const { coupon } = state;
  const disabled = savingProfile;

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-lg flex items-center justify-between gap-md">
        <h1 className="text-xl font-bold md:text-[28px]">{coupon.code}</h1>
        <span className="rounded-lg bg-primary/10 px-sm py-xs text-xs font-semibold text-primary">
          {coupon.displayStatus}
        </span>
      </div>

      {notice && (
        <div className="mb-lg rounded-lg border border-accent/30 bg-accent/5 p-md">
          <p className="text-sm font-medium text-accent">{notice}</p>
        </div>
      )}
      {actionError && (
        <div role="alert" className="mb-lg rounded-lg border border-error/30 bg-error/5 p-md">
          <p className="text-sm font-medium text-error">{actionError}</p>
        </div>
      )}

      <div className="mb-2xl rounded-lg border border-border p-lg text-sm text-text-secondary">
        <p>
          <span className="font-semibold text-text-primary">Discount:</span>{' '}
          {coupon.discountType === 'PERCENTAGE' ? `${coupon.discountValue}%` : `৳${coupon.discountValue}`}
        </p>
        <p>
          <span className="font-semibold text-text-primary">Usage:</span> {coupon.usageCount} / {coupon.usageLimit ?? '∞'}
        </p>
        <p>
          <span className="font-semibold text-text-primary">Distinct customers used:</span> {coupon.distinctCustomerCount}
        </p>
        <p>
          <span className="font-semibold text-text-primary">Created:</span> {new Date(coupon.createdAt).toLocaleString('en-GB')}
        </p>
        <p>
          <span className="font-semibold text-text-primary">Last updated:</span> {new Date(coupon.updatedAt).toLocaleString('en-GB')}
        </p>
      </div>

      <form onSubmit={handleProfileSubmit} noValidate className="mb-2xl">
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
          label="Description"
          id="description"
          type="text"
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={disabled}
        />
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
        {coupon.discountType === 'PERCENTAGE' && (
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
        <Button type="submit" loading={savingProfile}>
          Save Changes
        </Button>
      </form>

      <div className="flex flex-col gap-md sm:flex-row">
        {coupon.status !== 'ACTIVE' ? (
          <Button type="button" variant="secondary" disabled={statusBusy} onClick={() => void handleSetStatus('ACTIVE')}>
            Activate
          </Button>
        ) : (
          <Button type="button" variant="secondary" disabled={statusBusy} onClick={() => void handleSetStatus('DISABLED')}>
            Deactivate
          </Button>
        )}
        <Button type="button" variant="destructive" disabled={statusBusy} onClick={() => void handleDelete()}>
          Delete / Archive
        </Button>
      </div>
    </div>
  );
}
