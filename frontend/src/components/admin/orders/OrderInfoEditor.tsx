'use client';

import { useState, type FormEvent } from 'react';
import { apiPatch, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';
import { buildOrderInfoPatch, validateOrderInfo, type OrderInfoForm } from '@/lib/admin/orderInfo';
import type { AdminOrderDetail } from '@/lib/admin/orders';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import { TextareaField } from '@/components/admin/TextareaField';

function toForm(order: AdminOrderDetail): OrderInfoForm {
  return {
    contactName: order.full_name ?? '',
    contactPhone: order.phone_number ?? '',
    detailedAddress: order.detailed_address ?? '',
    postalCode: order.postal_code ?? '',
    deliveryInstructions: order.delivery_instructions ?? '',
    internalNote: order.internal_note ?? '',
  };
}

/**
 * Edit order information (05-admin §5.2, spec 13): the narrow whitelist the backend allows — contact
 * name and phone, detailed address, postal code, delivery instructions and the internal note.
 * Status, amounts, coupon and items are not editable here. Contact, address and delivery
 * instructions lock once a shipment exists (they are already with the courier); the note never does.
 * Needs `order.update`; the backend is the real gate.
 */
export function OrderInfoEditor({ order, onChanged }: { order: AdminOrderDetail; onChanged: () => void }) {
  const { hasPermission } = useAdminSession();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<OrderInfoForm>(() => toForm(order));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  if (!hasPermission('order.update')) return null;

  const shipmentStatus = order.shipment?.status ?? order.shipment_status;
  const locked = shipmentStatus !== undefined && shipmentStatus !== null && shipmentStatus !== 'NOT_CREATED';

  function set<K extends keyof OrderInfoForm>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function start() {
    setForm(toForm(order));
    setErrors({});
    setMessage(null);
    setOpen(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const found = validateOrderInfo(form, locked);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const patch = buildOrderInfoPatch(toForm(order), form, locked);
    if (Object.keys(patch).length === 0) {
      setMessage({ kind: 'error', text: 'Nothing has changed.' });
      return;
    }

    setBusy(true);
    try {
      await apiPatch(`/api/admin/orders/${order.id}`, patch);
      setOpen(false);
      onChanged();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-md">
        <Button type="button" variant="secondary" onClick={start}>
          Edit order information
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate className="mt-lg rounded-lg border border-border bg-background p-lg">
      <h3 className="mb-sm text-base font-bold">Edit order information</h3>
      {locked ? (
        <p className="mb-md text-xs text-text-secondary">
          A shipment exists, so contact, address and delivery instructions can no longer be changed. You can still edit the
          internal note.
        </p>
      ) : (
        <p className="mb-md text-xs text-text-secondary">
          Changing the phone number also changes the number the customer must use to look this order up. Division, district and
          area cannot be changed here.
        </p>
      )}

      <FormField
        label="Contact name"
        id="info-name"
        type="text"
        maxLength={120}
        value={form.contactName}
        onChange={(e) => set('contactName', e.target.value)}
        disabled={busy || locked}
        error={errors.contactName}
      />
      <FormField
        label="Contact phone"
        id="info-phone"
        type="tel"
        inputMode="tel"
        maxLength={20}
        value={form.contactPhone}
        onChange={(e) => set('contactPhone', e.target.value)}
        disabled={busy || locked}
        error={errors.contactPhone}
      />
      <TextareaField
        label="Detailed address"
        id="info-address"
        maxLength={500}
        value={form.detailedAddress}
        onChange={(e) => set('detailedAddress', e.target.value)}
        disabled={busy || locked}
        error={errors.detailedAddress}
      />
      <FormField
        label="Postal code (optional)"
        id="info-postal"
        type="text"
        maxLength={20}
        value={form.postalCode}
        onChange={(e) => set('postalCode', e.target.value)}
        disabled={busy || locked}
        error={errors.postalCode}
      />
      <TextareaField
        label="Delivery instructions for the courier (optional, up to 250 characters)"
        id="info-instructions"
        maxLength={250}
        value={form.deliveryInstructions}
        onChange={(e) => set('deliveryInstructions', e.target.value)}
        disabled={busy || locked}
        error={errors.deliveryInstructions}
      />
      <TextareaField
        label="Internal note (staff only)"
        id="info-note"
        maxLength={1000}
        value={form.internalNote}
        onChange={(e) => set('internalNote', e.target.value)}
        disabled={busy}
        error={errors.internalNote}
      />

      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`mb-md text-sm ${message.kind === 'error' ? 'text-error' : 'text-success'}`}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap gap-sm">
        <Button type="submit" loading={busy}>
          Save
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
