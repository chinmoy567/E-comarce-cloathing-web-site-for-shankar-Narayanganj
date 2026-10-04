'use client';

import { useState } from 'react';
import { apiDelete, apiPatch, apiPost, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import { ToggleField } from '@/components/admin/ToggleField';
import type { AttributeResponse, CreateVariantRequest, ProductResponse, VariantResponse } from '@/lib/admin/types';

/**
 * Edit-mode variants (05-admin §5.1, spec 05). Each action goes to its own endpoint, because the
 * product `PATCH` does not carry variants: save fields (`product.variant.manage`, price fields also
 * need `product.price.manage`), set stock with a required reason (`inventory.manage`), add and
 * remove a variant. Controls the session lacks permission for are hidden; the backend is the gate.
 */

function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function errorMessage(err: unknown): string {
  return err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.';
}

function AttributePicker({
  attributes,
  selected,
  onToggle,
  disabled,
}: {
  attributes: AttributeResponse[];
  selected: string[];
  onToggle: (valueId: string) => void;
  disabled: boolean;
}) {
  if (attributes.length === 0) return null;
  return (
    <div className="mb-lg">
      <p className="mb-sm text-xs font-semibold text-text-primary">Attribute values</p>
      {attributes.map((attribute) => (
        <fieldset key={attribute.id} className="mb-sm">
          <legend className="mb-xs text-xs text-text-secondary">{attribute.name}</legend>
          <div className="flex flex-wrap gap-sm">
            {attribute.values.map((value) => {
              const isSelected = selected.includes(value.id);
              return (
                <button
                  key={value.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={isSelected}
                  onClick={() => onToggle(value.id)}
                  className={`h-11 min-w-[44px] rounded-lg px-md text-sm font-semibold ${
                    isSelected ? 'bg-primary text-white' : 'border border-border bg-background text-text-primary'
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
  );
}

function toggled(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function VariantRow({
  variant,
  index,
  attributes,
  canRemove,
  onChanged,
}: {
  variant: VariantResponse;
  index: number;
  attributes: AttributeResponse[];
  canRemove: boolean;
  onChanged: () => void;
}) {
  const { hasPermission } = useAdminSession();
  const canManageVariants = hasPermission('product.variant.manage');
  const canManagePrice = hasPermission('product.price.manage');
  const canManageInventory = hasPermission('inventory.manage');

  const [sku, setSku] = useState(variant.sku ?? '');
  const [price, setPrice] = useState(variant.price !== null ? String(variant.price) : '');
  const [compareAtPrice, setCompareAtPrice] = useState(
    variant.compareAtPrice !== null ? String(variant.compareAtPrice) : '',
  );
  const [lowStock, setLowStock] = useState(String(variant.lowStockThreshold));
  const [isActive, setIsActive] = useState(variant.isActive);
  const [valueIds, setValueIds] = useState(variant.attributeValueIds);
  const [newStock, setNewStock] = useState('');
  const [reason, setReason] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState<'save' | 'stock' | 'remove' | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function run(kind: 'save' | 'stock' | 'remove', action: () => Promise<unknown>, success: string) {
    setBusy(kind);
    setStatus(null);
    try {
      await action();
      setStatus({ kind: 'ok', text: success });
      onChanged();
    } catch (err) {
      setStatus({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  const saveFields = () =>
    run(
      'save',
      () =>
        apiPatch<VariantResponse>(`/api/admin/catalogue/variants/${variant.id}`, {
          sku: sku.trim() ? sku.trim() : null,
          lowStockThreshold: Math.max(0, Math.trunc(Number(lowStock) || 0)),
          isActive,
          attributeValueIds: valueIds,
          // Price fields are sent only when this session may change them; the backend rejects them otherwise.
          ...(canManagePrice ? { price: toNumberOrNull(price), compareAtPrice: toNumberOrNull(compareAtPrice) } : {}),
        }),
      'Variant saved.',
    );

  const saveStock = () => {
    const quantity = Number(newStock);
    if (newStock.trim() === '' || !Number.isInteger(quantity) || quantity < 0) {
      setStatus({ kind: 'error', text: 'Enter a whole number of 0 or more.' });
      return Promise.resolve();
    }
    if (!reason.trim()) {
      setStatus({ kind: 'error', text: 'A reason is required for a stock change.' });
      return Promise.resolve();
    }
    return run(
      'stock',
      async () => {
        await apiPatch<VariantResponse>(`/api/admin/catalogue/variants/${variant.id}/stock`, {
          stockQuantity: quantity,
          reason: reason.trim(),
        });
        setNewStock('');
        setReason('');
      },
      'Stock updated.',
    );
  };

  const remove = () => run('remove', () => apiDelete(`/api/admin/catalogue/variants/${variant.id}`), 'Variant removed.');

  const disabled = busy !== null;

  return (
    <div className="mb-md rounded-lg border border-border p-md">
      <div className="mb-sm flex items-center justify-between">
        <p className="text-sm font-semibold text-text-primary">
          Variant {index + 1}
          {!variant.isActive && <span className="ml-sm text-xs font-normal text-text-secondary">(inactive)</span>}
        </p>
        <p className="text-xs text-text-secondary">In stock: {variant.stockQuantity}</p>
      </div>

      {canManageVariants && (
        <>
          <FormField
            label="Variant SKU (optional)"
            id={`variant-sku-${variant.id}`}
            type="text"
            maxLength={64}
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            disabled={disabled}
          />
          {canManagePrice && (
            <>
              <FormField
                label="Variant Price Override (optional)"
                id={`variant-price-${variant.id}`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={disabled}
              />
              <FormField
                label="Variant Compare-at Price (optional)"
                id={`variant-compare-${variant.id}`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                value={compareAtPrice}
                onChange={(e) => setCompareAtPrice(e.target.value)}
                disabled={disabled}
              />
            </>
          )}
          <FormField
            label="Low-stock Threshold"
            id={`variant-low-${variant.id}`}
            type="number"
            inputMode="numeric"
            min={0}
            value={lowStock}
            onChange={(e) => setLowStock(e.target.value)}
            disabled={disabled}
          />
          <AttributePicker
            attributes={attributes}
            selected={valueIds}
            onToggle={(id) => setValueIds((current) => toggled(current, id))}
            disabled={disabled}
          />
          <ToggleField
            label="Active"
            id={`variant-active-${variant.id}`}
            checked={isActive}
            onChange={setIsActive}
            disabled={disabled}
            helpText="An inactive variant is not sold and does not count towards stock."
          />
          <Button type="button" onClick={() => void saveFields()} loading={busy === 'save'} disabled={disabled}>
            Save Variant
          </Button>
        </>
      )}

      {canManageInventory && (
        <div className="mt-lg border-t border-border pt-md">
          <p className="mb-sm text-xs font-semibold text-text-primary">Set stock</p>
          <FormField
            label="New Stock Quantity"
            id={`variant-newstock-${variant.id}`}
            type="number"
            inputMode="numeric"
            min={0}
            value={newStock}
            onChange={(e) => setNewStock(e.target.value)}
            disabled={disabled}
          />
          <FormField
            label="Reason for change"
            id={`variant-reason-${variant.id}`}
            type="text"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={disabled}
          />
          <Button type="button" variant="secondary" onClick={() => void saveStock()} loading={busy === 'stock'} disabled={disabled}>
            Update Stock
          </Button>
        </div>
      )}

      {canManageVariants && canRemove && (
        <div className="mt-lg">
          {confirmRemove ? (
            <div className="flex flex-wrap items-center gap-sm">
              <p className="text-xs text-text-secondary">Remove this variant?</p>
              <Button type="button" variant="destructive" onClick={() => void remove()} loading={busy === 'remove'} disabled={disabled}>
                Yes, remove
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirmRemove(false)} disabled={disabled}>
                Keep
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              className="h-11 px-sm text-xs font-semibold text-error"
              disabled={disabled}
            >
              Remove variant
            </button>
          )}
        </div>
      )}

      {status && (
        <p
          role={status.kind === 'error' ? 'alert' : 'status'}
          className={`mt-sm text-xs ${status.kind === 'error' ? 'text-error' : 'text-success'}`}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}

function AddVariant({
  productId,
  attributes,
  onChanged,
}: {
  productId: string;
  attributes: AttributeResponse[];
  onChanged: () => void;
}) {
  const { hasPermission } = useAdminSession();
  const canManagePrice = hasPermission('product.price.manage');
  const canManageInventory = hasPermission('inventory.manage');

  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [valueIds, setValueIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function add() {
    setBusy(true);
    setError('');
    try {
      const body: CreateVariantRequest = {
        sku: sku.trim() ? sku.trim() : null,
        stockQuantity: canManageInventory ? Math.max(0, Math.trunc(Number(stock) || 0)) : 0,
        attributeValueIds: valueIds,
        ...(canManagePrice ? { price: toNumberOrNull(price) } : {}),
      };
      await apiPost<VariantResponse>(`/api/admin/catalogue/products/${productId}/variants`, body);
      setOpen(false);
      setSku('');
      setPrice('');
      setStock('0');
      setValueIds([]);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Add Variant
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-border p-md">
      <p className="mb-sm text-sm font-semibold text-text-primary">New variant</p>
      <FormField
        label="Variant SKU (optional)"
        id="new-variant-sku"
        type="text"
        maxLength={64}
        value={sku}
        onChange={(e) => setSku(e.target.value)}
        disabled={busy}
      />
      {canManagePrice && (
        <FormField
          label="Variant Price Override (optional)"
          id="new-variant-price"
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          disabled={busy}
        />
      )}
      {canManageInventory && (
        <FormField
          label="Stock Quantity"
          id="new-variant-stock"
          type="number"
          inputMode="numeric"
          min={0}
          value={stock}
          onChange={(e) => setStock(e.target.value)}
          disabled={busy}
        />
      )}
      <AttributePicker
        attributes={attributes}
        selected={valueIds}
        onToggle={(id) => setValueIds((current) => toggled(current, id))}
        disabled={busy}
      />
      {error && (
        <p role="alert" className="mb-sm text-xs text-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-sm">
        <Button type="button" onClick={() => void add()} loading={busy}>
          Add Variant
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function VariantEditor({
  product,
  attributes,
  onChanged,
}: {
  product: ProductResponse;
  attributes: AttributeResponse[];
  /** Called after any successful change so the page can reload the product. */
  onChanged: () => void;
}) {
  const { hasPermission } = useAdminSession();
  return (
    <div className="mb-2xl">
      <h2 className="mb-md text-base font-bold">Variants</h2>
      <p className="mb-md text-xs text-text-secondary">
        Each variant saves on its own. A product always keeps at least one variant.
      </p>
      {product.variants.map((variant, index) => (
        <VariantRow
          key={variant.id}
          variant={variant}
          index={index}
          attributes={attributes}
          canRemove={product.variants.length > 1}
          onChanged={onChanged}
        />
      ))}
      {hasPermission('product.variant.manage') && (
        <AddVariant productId={product.id} attributes={attributes} onChanged={onChanged} />
      )}
    </div>
  );
}
