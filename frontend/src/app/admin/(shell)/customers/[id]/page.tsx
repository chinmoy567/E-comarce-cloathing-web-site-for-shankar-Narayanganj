'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiList, apiPatch, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import { formatDate, formatPrice } from '@/lib/admin/orders';
import { GuestBadge, OrderStatusBadge, PaymentStatusBadge, ShipmentStatusBadge } from '@/components/admin/orders/OrderStatusBadges';

type Customer = {
  id: string;
  accountType: 'GUEST' | 'REGISTERED';
  isGuest: boolean;
  fullName: string;
  phoneNumber: string;
  email: string | null;
  address: {
    division: string;
    district: string;
    areaUnitType: string;
    areaUnitName: string;
    wardUnitType: string;
    wardUnitName: string;
    detailedAddress: string;
    postalCode: string | null;
  };
  orderCount: number;
  lastOrderAt: string | null;
  createdAt: string;
  // Present only when the actor holds `payment.view` — omitted entirely otherwise.
  paymentSummary?: { totalPaid: number; pendingPayments: number; rejectedPayments: number };
};

type CustomerOrder = {
  id: string;
  order_number: string;
  order_status: string;
  shipment_status: string;
  total_amount: number;
  created_at: string;
  is_guest_order: boolean;
  payment_status?: string;
  payment_method?: string;
};

/** Customer detail (05-admin §5.7): profile, address, order history, limited contact correction. */
export default function CustomerDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const { hasPermission } = useAdminSession();
  const canEdit = hasPermission('customer.update');

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setError(null);
    Promise.all([
      apiGet<Customer>(`/api/admin/customers/${id}`, { signal: controller.signal }),
      apiList<CustomerOrder>(`/api/admin/customers/${id}/orders?pageSize=50`, { signal: controller.signal }),
    ])
      .then(([c, o]) => {
        setCustomer(c);
        setOrders(o.data);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
      });
    return () => controller.abort();
  }, [id, refreshKey]);

  return (
    <div>
      <Link href="/admin/customers" className="text-sm font-medium text-primary hover:underline">
        ← Customers
      </Link>
      <h1 className="mb-lg mt-sm text-xl font-bold md:text-[28px]">Customer</h1>

      {error && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load customer</p>
          <p className="mt-xs text-sm text-text-secondary">{error}</p>
        </div>
      )}
      {!customer && !error && <p className="text-text-secondary">Loading customer…</p>}

      {customer && (
        <div className="space-y-lg">
          <section className="rounded-lg border border-border bg-surface p-lg" aria-labelledby="profile-heading">
            <div className="flex items-start justify-between gap-md">
              <h2 id="profile-heading" className="text-lg font-bold">
                {customer.fullName}
                {customer.isGuest ? <GuestBadge /> : <span className="ml-xs text-xs font-semibold text-text-secondary">Registered</span>}
              </h2>
              {canEdit && !editing && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit contact
                </Button>
              )}
            </div>

            {editing ? (
              <EditContactForm
                customer={customer}
                onCancel={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false);
                  reload();
                }}
              />
            ) : (
              <dl className="mt-md space-y-sm text-sm">
                <div>
                  <dt className="text-xs font-semibold text-text-secondary">Phone</dt>
                  <dd>
                    <a href={`tel:${customer.phoneNumber}`} className="text-primary hover:underline">
                      {customer.phoneNumber}
                    </a>
                  </dd>
                </div>
                {customer.email && (
                  <div>
                    <dt className="text-xs font-semibold text-text-secondary">Email</dt>
                    <dd>{customer.email}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs font-semibold text-text-secondary">Address</dt>
                  <dd className="text-text-secondary">
                    {[
                      customer.address.detailedAddress,
                      `${customer.address.wardUnitType === 'UNION' ? 'Union' : 'Ward'}: ${customer.address.wardUnitName}`,
                      `${customer.address.areaUnitType === 'THANA' ? 'Thana' : 'Upazila'}: ${customer.address.areaUnitName}`,
                      customer.address.district,
                      customer.address.division,
                      customer.address.postalCode,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-text-secondary">Customer since</dt>
                  <dd>{formatDate(customer.createdAt)}</dd>
                </div>
              </dl>
            )}
          </section>

          <section className="grid gap-md sm:grid-cols-2" aria-label="Order statistics">
            <div className="rounded-lg border border-border bg-surface p-lg">
              <p className="text-xs font-semibold text-text-secondary">Orders</p>
              <p className="mt-xs text-xl font-bold">{customer.orderCount}</p>
            </div>
            {customer.paymentSummary && (
              <div className="rounded-lg border border-border bg-surface p-lg">
                <p className="text-xs font-semibold text-text-secondary">Paid in total</p>
                <p className="mt-xs text-xl font-bold">{formatPrice(customer.paymentSummary.totalPaid)}</p>
                <p className="mt-xs text-xs text-text-secondary">
                  {customer.paymentSummary.pendingPayments} pending · {customer.paymentSummary.rejectedPayments} rejected
                </p>
              </div>
            )}
          </section>

          <section aria-labelledby="orders-heading">
            <h2 id="orders-heading" className="mb-md text-lg font-bold">
              Order history
            </h2>
            {orders.length === 0 ? (
              <p className="text-sm text-text-secondary">This customer has no orders.</p>
            ) : (
              <ul className="space-y-sm">
                {orders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/admin/orders/${o.id}`} className="block rounded-lg border border-border bg-background p-md hover:border-primary">
                      <div className="flex items-start justify-between gap-md">
                        <div>
                          <p className="font-mono text-sm font-semibold">{o.order_number}</p>
                          <p className="text-xs text-text-secondary">{formatDate(o.created_at, true)}</p>
                        </div>
                        <p className="text-sm font-bold text-primary">{formatPrice(o.total_amount)}</p>
                      </div>
                      <div className="mt-sm flex flex-wrap gap-xs">
                        <OrderStatusBadge value={o.order_status} />
                        {o.payment_status && <PaymentStatusBadge value={o.payment_status} />}
                        <ShipmentStatusBadge value={o.shipment_status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function EditContactForm({ customer, onCancel, onSaved }: { customer: Customer; onCancel: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = useState(customer.fullName);
  const [email, setEmail] = useState(customer.email ?? '');
  const [detailedAddress, setDetailedAddress] = useState(customer.address.detailedAddress);
  const [postalCode, setPostalCode] = useState(customer.address.postalCode ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiClientError | string | null>(null);

  const fieldError = (f: string) => (error instanceof ApiClientError ? error.fieldError(f) : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/api/admin/customers/${customer.id}`, {
        fullName: fullName.trim(),
        email: email.trim() === '' ? null : email.trim(),
        detailedAddress: detailedAddress.trim(),
        postalCode: postalCode.trim() === '' ? null : postalCode.trim(),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err : 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="mt-md" onSubmit={submit} noValidate>
      <p className="mb-md text-xs text-text-secondary">
        Only contact details and the street address can be corrected here. The phone number and account type cannot be changed.
      </p>
      <FormField
        id="c-name"
        label="Full name"
        required
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        maxLength={120}
        {...(fieldError('fullName') ? { error: fieldError('fullName')! } : {})}
      />
      <FormField
        id="c-email"
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        maxLength={254}
        {...(fieldError('email') ? { error: fieldError('email')! } : {})}
      />
      <FormField
        id="c-address"
        label="Detailed address"
        required
        value={detailedAddress}
        onChange={(e) => setDetailedAddress(e.target.value)}
        maxLength={500}
        {...(fieldError('detailedAddress') ? { error: fieldError('detailedAddress')! } : {})}
      />
      <FormField
        id="c-postal"
        label="Postal code"
        value={postalCode}
        onChange={(e) => setPostalCode(e.target.value)}
        maxLength={20}
        {...(fieldError('postalCode') ? { error: fieldError('postalCode')! } : {})}
      />
      {error && (
        <p role="alert" className="mb-md text-sm text-error">
          {typeof error === 'string' ? error : error.message}
        </p>
      )}
      <div className="flex flex-col-reverse gap-sm sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
