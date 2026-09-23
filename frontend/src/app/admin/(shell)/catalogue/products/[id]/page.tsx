'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiGet, apiPatch, ApiClientError } from '@/lib/apiClient';
import { ProductForm } from '@/components/admin/catalogue/ProductForm';
import type { ProductResponse, UpdateProductRequest, UpdateVisibilityRequest } from '@/lib/admin/types';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; product: ProductResponse };

/**
 * Product edit (spec 05 §Frontend work). Price/visibility/stock fields are
 * gated inside `ProductForm` by the actor's granted permissions; a 403 from
 * a direct hit (permission revoked mid-session, or attempted anyway) is
 * still handled gracefully here, not assumed away (`frontend` skill §3).
 */
export default function EditProductPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [state, setState] = useState<State>({ phase: 'loading' });
  const [submitting, setSubmitting] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    apiGet<ProductResponse>(`/api/admin/catalogue/products/${params.id}`, { signal: controller.signal })
      .then((product) => setState({ phase: 'loaded', product }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: 'error',
          message: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        });
      });
    return () => controller.abort();
  }, [params.id]);

  async function handleSubmit(input: UpdateProductRequest) {
    setSubmitting(true);
    setErrorMessage('');
    setNotice('');
    try {
      const updated = await apiPatch<ProductResponse>(`/api/admin/catalogue/products/${params.id}`, input);
      setState({ phase: 'loaded', product: updated });
      setNotice('Product updated.');
    } catch (err) {
      setErrorMessage(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleVisibility(nextActive: boolean) {
    setVisibilityBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      const body: UpdateVisibilityRequest = { status: nextActive ? 'ACTIVE' : 'INACTIVE' };
      const updated = await apiPatch<ProductResponse>(`/api/admin/catalogue/products/${params.id}/visibility`, body);
      setState({ phase: 'loaded', product: updated });
      setNotice(updated.status === 'ACTIVE' ? 'Product activated.' : 'Product deactivated.');
    } catch (err) {
      setErrorMessage(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setVisibilityBusy(false);
    }
  }

  if (state.phase === 'loading') {
    return <p className="text-text-secondary">Loading product…</p>;
  }

  if (state.phase === 'error') {
    return (
      <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
        <p className="font-medium text-error">Could not load this product</p>
        <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-lg flex items-center justify-between gap-md">
        <h1 className="truncate text-xl font-bold md:text-[28px]">{state.product.name}</h1>
        <span
          className={`shrink-0 rounded-lg px-sm py-xs text-xs font-semibold ${
            state.product.status === 'ACTIVE' ? 'bg-accent/10 text-accent' : 'bg-text-tertiary/10 text-text-secondary'
          }`}
        >
          {state.product.status === 'ACTIVE' ? 'Active' : 'Inactive'}
        </span>
      </div>

      {notice && (
        <div className="mb-lg rounded-lg border border-accent/30 bg-accent/5 p-md">
          <p className="text-sm font-medium text-accent">{notice}</p>
        </div>
      )}

      <ProductForm
        mode="edit"
        initialProduct={state.product}
        onSubmit={handleSubmit}
        onToggleVisibility={handleToggleVisibility}
        visibilityBusy={visibilityBusy}
        submitError={errorMessage}
        submitting={submitting}
      />

      <button
        type="button"
        onClick={() => router.push('/admin/catalogue/products')}
        className="mt-lg h-11 text-sm font-semibold text-text-secondary"
      >
        Back to Products
      </button>
    </div>
  );
}
