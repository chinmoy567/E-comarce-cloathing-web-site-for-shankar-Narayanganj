'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiPost, ApiClientError } from '@/lib/apiClient';
import { ProductForm } from '@/components/admin/catalogue/ProductForm';
import type { CreateProductRequest, ProductResponse, UpdateProductRequest } from '@/lib/admin/types';

/**
 * Product create (spec 05 §Frontend work). New products always start
 * `INACTIVE` server-side (§5.1) — there is no `status` field on
 * `CreateProductRequest`; the admin activates it afterward from the edit page
 * if they hold `product.visibility.manage`.
 */
export default function NewProductPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(input: CreateProductRequest | UpdateProductRequest) {
    setSubmitting(true);
    setErrorMessage('');
    try {
      const created = await apiPost<ProductResponse>('/api/admin/catalogue/products', input);
      router.replace(`/admin/catalogue/products/${created.id}`);
    } catch (err) {
      setErrorMessage(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Add Product</h1>
      <ProductForm mode="create" onSubmit={handleSubmit} submitError={errorMessage} submitting={submitting} />
    </div>
  );
}
