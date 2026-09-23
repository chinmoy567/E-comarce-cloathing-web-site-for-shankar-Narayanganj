'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiGet, apiList, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import { SelectField } from '@/components/admin/SelectField';
import { TextareaField } from '@/components/admin/TextareaField';
import { ToggleField } from '@/components/admin/ToggleField';
import type {
  AttributeResponse,
  CategoryResponse,
  CreateProductRequest,
  CreateVariantRequest,
  ProductResponse,
  UpdateProductRequest,
} from '@/lib/admin/types';

type CataloguePrereqState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; categories: CategoryResponse[]; attributes: AttributeResponse[] };

/** One editable variant row in the form's local state. */
type VariantDraft = {
  key: string;
  sku: string;
  price: string;
  compareAtPrice: string;
  stockQuantity: string;
  lowStockThreshold: string;
  attributeValueIds: string[];
};

function emptyVariant(): VariantDraft {
  return {
    key: crypto.randomUUID(),
    sku: '',
    price: '',
    compareAtPrice: '',
    stockQuantity: '0',
    lowStockThreshold: '5',
    attributeValueIds: [],
  };
}

function variantFromResponse(v: ProductResponse['variants'][number]): VariantDraft {
  return {
    key: v.id,
    sku: v.sku ?? '',
    price: v.price !== null ? String(v.price) : '',
    compareAtPrice: v.compareAtPrice !== null ? String(v.compareAtPrice) : '',
    stockQuantity: String(v.stockQuantity),
    lowStockThreshold: String(v.lowStockThreshold),
    attributeValueIds: v.attributeValueIds,
  };
}

function toNumberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Shared create/edit form for `/admin/catalogue/products/new` and `/[id]`
 * (spec 05 §Frontend work). Price, visibility (Active/Inactive), and stock
 * quantity fields are hidden — not merely disabled — when the current admin
 * session lacks `product.price.manage`, `product.visibility.manage`, or
 * `inventory.manage` respectively; the matching backend `requirePermission`
 * is the real gate (`frontend` skill §3), this is UX clarity only.
 *
 * Images are out of scope here — spec 06 wires real uploads; this only shows
 * a placeholder section.
 */
export function ProductForm({
  mode,
  initialProduct,
  onSubmit,
  onToggleVisibility,
  visibilityBusy,
  submitError,
  submitting,
}: {
  mode: 'create' | 'edit';
  initialProduct?: ProductResponse;
  onSubmit: (input: CreateProductRequest | UpdateProductRequest) => void | Promise<void>;
  /** Edit mode only: flips Active/Inactive via `PATCH /products/:id/visibility`. */
  onToggleVisibility?: (nextActive: boolean) => void | Promise<void>;
  visibilityBusy?: boolean;
  submitError?: string;
  submitting: boolean;
}) {
  const { hasPermission } = useAdminSession();
  const canManagePrice = hasPermission('product.price.manage');
  const canManageVisibility = hasPermission('product.visibility.manage');
  const canManageInventory = hasPermission('inventory.manage');
  const canManageVariants = hasPermission('product.variant.manage');

  const [prereq, setPrereq] = useState<CataloguePrereqState>({ phase: 'loading' });

  const [name, setName] = useState(initialProduct?.name ?? '');
  const [categoryId, setCategoryId] = useState(initialProduct?.categoryId ?? '');
  const [sku, setSku] = useState(initialProduct?.sku ?? '');
  const [description, setDescription] = useState(initialProduct?.description ?? '');
  const [basePrice, setBasePrice] = useState(initialProduct ? String(initialProduct.basePrice) : '');
  const [compareAtPrice, setCompareAtPrice] = useState(
    initialProduct?.compareAtPrice !== undefined && initialProduct?.compareAtPrice !== null
      ? String(initialProduct.compareAtPrice)
      : '',
  );
  const [weightGrams, setWeightGrams] = useState(
    initialProduct?.weightGrams !== undefined && initialProduct?.weightGrams !== null
      ? String(initialProduct.weightGrams)
      : '',
  );
  const [isFeatured, setIsFeatured] = useState(initialProduct?.isFeatured ?? false);
  const [variants, setVariants] = useState<VariantDraft[]>(
    initialProduct && initialProduct.variants.length > 0
      ? initialProduct.variants.map(variantFromResponse)
      : [emptyVariant()],
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiList<CategoryResponse>('/api/admin/catalogue/categories?page=1&pageSize=100', {
        signal: controller.signal,
      }),
      apiGet<AttributeResponse[]>('/api/admin/catalogue/attributes', { signal: controller.signal }),
    ])
      .then(([categoriesResult, attributes]) => {
        setPrereq({ phase: 'loaded', categories: categoriesResult.data, attributes });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setPrereq({
          phase: 'error',
          message: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        });
      });
    return () => controller.abort();
  }, []);

  const attributesById = useMemo(() => {
    if (prereq.phase !== 'loaded') return new Map<string, AttributeResponse>();
    return new Map(prereq.attributes.map((a) => [a.id, a]));
  }, [prereq]);

  function updateVariant(key: string, patch: Partial<VariantDraft>) {
    setVariants((current) => current.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  }

  function toggleVariantAttributeValue(key: string, valueId: string) {
    setVariants((current) =>
      current.map((v) => {
        if (v.key !== key) return v;
        const has = v.attributeValueIds.includes(valueId);
        return {
          ...v,
          attributeValueIds: has
            ? v.attributeValueIds.filter((id) => id !== valueId)
            : [...v.attributeValueIds, valueId],
        };
      }),
    );
  }

  function addVariant() {
    setVariants((current) => [...current, emptyVariant()]);
  }

  function removeVariant(key: string) {
    setVariants((current) => (current.length > 1 ? current.filter((v) => v.key !== key) : current));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});

    const variantRequests: CreateVariantRequest[] = variants.map((v) => ({
      sku: v.sku.trim() ? v.sku.trim() : undefined,
      price: canManagePrice ? toNumberOrUndefined(v.price) ?? null : undefined,
      compareAtPrice: canManagePrice ? toNumberOrUndefined(v.compareAtPrice) ?? null : undefined,
      stockQuantity: canManageInventory ? (toNumberOrUndefined(v.stockQuantity) ?? 0) : 0,
      lowStockThreshold: toNumberOrUndefined(v.lowStockThreshold),
      attributeValueIds: v.attributeValueIds,
    }));

    if (mode === 'create') {
      const input: CreateProductRequest = {
        categoryId,
        name,
        sku: sku.trim() ? sku.trim() : undefined,
        description: description.trim() ? description.trim() : undefined,
        basePrice: canManagePrice ? (toNumberOrUndefined(basePrice) ?? 0) : 0,
        compareAtPrice: canManagePrice ? toNumberOrUndefined(compareAtPrice) ?? null : undefined,
        weightGrams: toNumberOrUndefined(weightGrams) ?? null,
        isFeatured,
        variants: variantRequests,
      };
      void onSubmit(input);
      return;
    }

    const input: UpdateProductRequest = {
      categoryId,
      name,
      sku: sku.trim() ? sku.trim() : null,
      description: description.trim() ? description.trim() : null,
      weightGrams: toNumberOrUndefined(weightGrams) ?? null,
      isFeatured,
      ...(canManagePrice
        ? { basePrice: toNumberOrUndefined(basePrice) ?? 0, compareAtPrice: toNumberOrUndefined(compareAtPrice) ?? null }
        : {}),
    };
    void onSubmit(input);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <FormField
        label="Product Name"
        id="name"
        type="text"
        required
        minLength={1}
        maxLength={200}
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={submitting}
        error={fieldErrors.name}
      />

      {prereq.phase === 'loading' && <p className="mb-lg text-sm text-text-secondary">Loading categories…</p>}
      {prereq.phase === 'error' && (
        <div role="alert" className="mb-lg rounded-lg border border-error/30 bg-error/5 p-md">
          <p className="text-sm font-medium text-error">{prereq.message}</p>
        </div>
      )}
      {prereq.phase === 'loaded' && (
        <SelectField
          label="Category"
          id="categoryId"
          required
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          disabled={submitting}
          error={fieldErrors.categoryId}
        >
          <option value="">Select a category…</option>
          {prereq.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.parentId ? `— ${category.name}` : category.name}
            </option>
          ))}
        </SelectField>
      )}

      <FormField
        label="SKU (optional)"
        id="sku"
        type="text"
        maxLength={64}
        value={sku}
        onChange={(e) => setSku(e.target.value)}
        disabled={submitting}
      />

      {canManagePrice && (
        <>
          <FormField
            label="Base Price (৳)"
            id="basePrice"
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            required
            value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)}
            disabled={submitting}
            error={fieldErrors.basePrice}
          />
          <FormField
            label="Compare-at Price (optional)"
            id="compareAtPrice"
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            value={compareAtPrice}
            onChange={(e) => setCompareAtPrice(e.target.value)}
            disabled={submitting}
            error={fieldErrors.compareAtPrice}
          />
        </>
      )}

      <TextareaField
        label="Description"
        id="description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={submitting}
      />

      <FormField
        label="Weight (grams, optional)"
        id="weightGrams"
        type="number"
        inputMode="numeric"
        min={1}
        value={weightGrams}
        onChange={(e) => setWeightGrams(e.target.value)}
        disabled={submitting}
      />

      <div className="mb-2xl">
        <h2 className="mb-md text-base font-bold">Variants</h2>
        <p className="mb-md text-xs text-text-secondary">
          A product with no size/colour options keeps a single default variant. Add more rows to create
          size/colour combinations.
        </p>

        {variants.map((variant, index) => (
          <div key={variant.key} className="mb-md rounded-lg border border-border p-md">
            <div className="mb-sm flex items-center justify-between">
              <p className="text-sm font-semibold text-text-primary">Variant {index + 1}</p>
              {variants.length > 1 && canManageVariants && (
                <button
                  type="button"
                  onClick={() => removeVariant(variant.key)}
                  className="h-11 px-sm text-xs font-semibold text-error"
                  disabled={submitting}
                >
                  Remove
                </button>
              )}
            </div>

            <FormField
              label="Variant SKU (optional)"
              id={`variant-sku-${variant.key}`}
              type="text"
              maxLength={64}
              value={variant.sku}
              onChange={(e) => updateVariant(variant.key, { sku: e.target.value })}
              disabled={submitting}
            />

            {canManagePrice && (
              <FormField
                label="Variant Price Override (optional)"
                id={`variant-price-${variant.key}`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                value={variant.price}
                onChange={(e) => updateVariant(variant.key, { price: e.target.value })}
                disabled={submitting}
              />
            )}

            {canManageInventory && (
              <FormField
                label="Stock Quantity"
                id={`variant-stock-${variant.key}`}
                type="number"
                inputMode="numeric"
                min={0}
                required
                value={variant.stockQuantity}
                onChange={(e) => updateVariant(variant.key, { stockQuantity: e.target.value })}
                disabled={submitting}
              />
            )}

            {prereq.phase === 'loaded' && prereq.attributes.length > 0 && (
              <div className="mb-lg">
                <p className="mb-sm text-xs font-semibold text-text-primary">Attribute values</p>
                {prereq.attributes.map((attribute) => (
                  <fieldset key={attribute.id} className="mb-sm">
                    <legend className="mb-xs text-xs text-text-secondary">{attribute.name}</legend>
                    <div className="flex flex-wrap gap-sm">
                      {attribute.values.map((value) => {
                        const selected = variant.attributeValueIds.includes(value.id);
                        return (
                          <button
                            key={value.id}
                            type="button"
                            disabled={submitting}
                            onClick={() => toggleVariantAttributeValue(variant.key, value.id)}
                            className={`h-11 min-w-[44px] rounded-lg px-md text-sm font-semibold ${
                              selected
                                ? 'bg-primary text-white'
                                : 'border border-border bg-background text-text-primary'
                            }`}
                          >
                            {value.value}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>
            )}
          </div>
        ))}

        {canManageVariants && (
          <Button type="button" variant="secondary" onClick={addVariant} disabled={submitting}>
            Add Variant
          </Button>
        )}
      </div>

      {canManageVisibility && mode === 'edit' && initialProduct && onToggleVisibility && (
        <ToggleField
          label="Active"
          id="isActive"
          checked={initialProduct.status === 'ACTIVE'}
          onChange={(next) => void onToggleVisibility(next)}
          disabled={submitting || visibilityBusy}
          helpText="Visible on the storefront when Active. Saved immediately."
        />
      )}
      {canManageVisibility && mode === 'create' && (
        <p className="mb-lg text-xs text-text-secondary">
          New products start Inactive. Activate it from this page after saving.
        </p>
      )}
      <ToggleField
        label="Featured"
        id="isFeatured"
        checked={isFeatured}
        onChange={setIsFeatured}
        disabled={submitting}
        helpText="Independent of Active/Inactive."
      />

      <div className="mb-2xl rounded-lg border border-border bg-surface p-lg">
        <p className="text-sm font-semibold text-text-primary">Images</p>
        <p className="mt-xs text-xs text-text-secondary">
          Image upload is coming in a later update.
        </p>
      </div>

      {submitError && (
        <div role="alert" className="mb-lg rounded-lg border border-error/30 bg-error/5 p-md">
          <p className="text-sm font-medium text-error">{submitError}</p>
        </div>
      )}

      <Button type="submit" loading={submitting} className="h-12 w-full">
        Save Product
      </Button>
    </form>
  );
}
