'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiList, ApiClientError } from '@/lib/apiClient';
import type { PaginationBlock } from '@/lib/apiTypes';
import { Button } from '@/components/admin/Button';
import { formatDate, formatPrice, type AdminOrderListItem } from '@/lib/admin/orders';
import { GuestBadge, OrderStatusBadge, PaymentStatusBadge, ShipmentStatusBadge } from '@/components/admin/orders/OrderStatusBadges';

type Tab = { key: string; label: string; query: string };

/** Status tabs (design skill: Order Management). Each maps to plain list filters the API already supports. */
const TABS: Tab[] = [
  { key: 'all', label: 'All', query: '' },
  { key: 'pending-verification', label: 'Pending verification', query: 'order_status=PENDING_CONFIRMATION&payment_status=PENDING_VERIFICATION' },
  { key: 'cod-pending', label: 'COD pending', query: 'order_status=COD_VERIFICATION_PENDING' },
  { key: 'confirmed', label: 'Confirmed', query: 'order_status=CONFIRMED' },
  { key: 'processing', label: 'Processing', query: 'order_status=PROCESSING' },
  { key: 'delivered', label: 'Delivered', query: 'order_status=DELIVERED' },
  { key: 'cancelled', label: 'Cancelled', query: 'order_status=CANCELLED' },
  { key: 'returned', label: 'Returned', query: 'order_status=RETURNED' },
];

/** "Needs attention" views (§3.4, §5.21.3): surfacing only — nothing here changes an order. */
const ATTENTION: Tab[] = [
  { key: 'stale', label: 'Stale unconfirmed', query: 'stale=true' },
  { key: 'rejected', label: 'Payment rejected', query: 'payment_status=REJECTED&order_status=PENDING_CONFIRMATION' },
  { key: 'failed-shipment', label: 'Failed shipment', query: 'shipment_status=CREATION_FAILED' },
  { key: 'cod-discrepancy', label: 'COD discrepancy', query: 'has_cod_discrepancy=true' },
];

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; items: AdminOrderListItem[]; pagination: PaginationBlock };

export default function OrdersListPage() {
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('all');
  const [attention, setAttention] = useState<string | null>(null);
  const [method, setMethod] = useState('');
  const [guest, setGuest] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });

    const parts = [`page=${page}`, 'pageSize=20'];
    const attentionTab = ATTENTION.find((a) => a.key === attention);
    // A "needs attention" view replaces the status tab so the two filters never contradict each other.
    const q = attentionTab ? attentionTab.query : (TABS.find((t) => t.key === tab)?.query ?? '');
    if (q) parts.push(q);
    if (method) parts.push(`payment_method=${method}`);
    if (guest) parts.push(`is_guest_order=${guest}`);
    if (search) parts.push(`q=${encodeURIComponent(search)}`);

    apiList<AdminOrderListItem>(`/api/admin/orders?${parts.join('&')}`, { signal: controller.signal })
      .then(({ data, pagination }) => setState({ phase: 'loaded', items: data, pagination }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: 'error',
          message: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        });
      });

    return () => controller.abort();
  }, [page, tab, attention, method, guest, search]);

  const chip = (active: boolean) =>
    `h-11 shrink-0 whitespace-nowrap rounded-full border px-md text-sm font-semibold ${
      active ? 'border-primary bg-primary text-white' : 'border-border bg-background text-text-secondary hover:bg-surface'
    }`;

  return (
    <div>
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Orders</h1>

      {/* Status tabs: scroll horizontally on mobile by design */}
      <div role="tablist" aria-label="Order status" className="-mx-md mb-md flex gap-sm overflow-x-auto px-md pb-xs">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={!attention && tab === t.key}
            className={chip(!attention && tab === t.key)}
            onClick={() => {
              setAttention(null);
              setTab(t.key);
              setPage(1);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form
        className="mb-md flex flex-col gap-sm sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchInput.trim());
          setPage(1);
        }}
      >
        <label className="sr-only" htmlFor="order-search">
          Search orders
        </label>
        <input
          id="order-search"
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Order number, customer name or phone"
          maxLength={100}
          className="h-11 w-full rounded-lg border border-border bg-background px-md text-base focus:border-2 focus:border-primary focus:outline-none sm:max-w-sm"
        />
        <label className="sr-only" htmlFor="order-method">
          Payment method
        </label>
        <select
          id="order-method"
          value={method}
          onChange={(e) => {
            setMethod(e.target.value);
            setPage(1);
          }}
          className="h-11 rounded-lg border border-border bg-background px-md text-base"
        >
          <option value="">All payment methods</option>
          <option value="BKASH">bKash</option>
          <option value="COD">Cash on delivery</option>
        </select>
        <label className="sr-only" htmlFor="order-guest">
          Customer type
        </label>
        <select
          id="order-guest"
          value={guest}
          onChange={(e) => {
            setGuest(e.target.value);
            setPage(1);
          }}
          className="h-11 rounded-lg border border-border bg-background px-md text-base"
        >
          <option value="">Guest and registered</option>
          <option value="true">Guest only</option>
          <option value="false">Registered only</option>
        </select>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <div className="mb-lg flex flex-wrap items-center gap-sm" aria-label="Needs attention">
        <span className="text-xs font-semibold text-text-secondary">Needs attention:</span>
        {ATTENTION.map((a) => (
          <button
            key={a.key}
            type="button"
            aria-pressed={attention === a.key}
            className={chip(attention === a.key)}
            onClick={() => {
              setAttention(attention === a.key ? null : a.key);
              setPage(1);
            }}
          >
            {a.label}
          </button>
        ))}
      </div>

      {state.phase === 'loading' && <p className="text-text-secondary">Loading orders…</p>}

      {state.phase === 'error' && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load orders</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
        </div>
      )}

      {state.phase === 'loaded' && state.items.length === 0 && <p className="text-text-secondary">No orders match these filters.</p>}

      {state.phase === 'loaded' && state.items.length > 0 && (
        <>
          <ul className="space-y-sm">
            {state.items.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="block rounded-lg border border-border bg-background p-md hover:border-primary"
                >
                  <div className="flex items-start justify-between gap-md">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold">{order.order_number}</p>
                      <p className="mt-xs truncate text-sm">
                        {order.full_name ?? 'Unnamed customer'}
                        {order.is_guest_order && <GuestBadge />}
                      </p>
                      <p className="text-xs text-text-secondary">
                        {order.payment_method === 'BKASH' ? 'bKash' : 'COD'} · {formatDate(order.created_at, true)}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-bold text-primary">{formatPrice(order.total_amount)}</p>
                  </div>
                  <div className="mt-sm flex flex-wrap gap-xs">
                    <OrderStatusBadge value={order.order_status} />
                    <PaymentStatusBadge value={order.payment_status} />
                    <ShipmentStatusBadge value={order.shipment_status} />
                    {order.has_cod_collection_discrepancy && (
                      <span className="inline-block rounded-full bg-warning/10 px-md py-xs text-xs font-semibold">COD discrepancy</span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {state.pagination.totalPages > 1 && (
            <div className="mt-lg flex items-center justify-between gap-md">
              <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <span className="text-sm text-text-secondary">
                Page {state.pagination.page} of {state.pagination.totalPages}
              </span>
              <Button type="button" variant="secondary" disabled={page >= state.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
