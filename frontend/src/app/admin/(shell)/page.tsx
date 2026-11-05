'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiGet, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';

type Summary = {
  newOrders: number;
  awaitingBkashVerification: number;
  codAwaitingConfirmation: number;
  paymentRejectedAwaitingResubmission: number;
  staleUnconfirmed: number;
  shipmentCreationFailed: number;
  codCollectionDiscrepancies: number;
  courierSyncProblems: number;
  stuckParcels: number;
  stuckParcelDays: number;
  returnedRecently: number;
  totalOrders: number;
};

const LAST_VISIT_KEY = 'frabrilike.admin.dashboard.lastVisit';

function readLastVisit(): string | null {
  try {
    return window.localStorage.getItem(LAST_VISIT_KEY);
  } catch {
    return null;
  }
}

function writeLastVisit(value: string): void {
  try {
    window.localStorage.setItem(LAST_VISIT_KEY, value);
  } catch {
    // Storage unavailable: the "new orders" counter falls back to the last 24 hours.
  }
}

/** `/admin` landing page with the §5.2 counters; every card links to the order list. */
export default function AdminDashboardPage() {
  const { state, hasPermission } = useAdminSession();
  const canSeeDashboard = hasPermission('dashboard.view');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.phase !== 'authenticated' || !canSeeDashboard) return;
    const controller = new AbortController();
    const since = readLastVisit();
    const query = since ? `?since=${encodeURIComponent(since)}` : '';

    apiGet<Summary>(`/api/admin/dashboard/summary${query}`, { signal: controller.signal })
      .then((data) => {
        setSummary(data);
        writeLastVisit(new Date().toISOString());
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
      });
    return () => controller.abort();
  }, [state.phase, canSeeDashboard]);

  // Each card opens the order list filtered to exactly the orders it counts.
  const cards: Array<{ label: string; value: number; href: string; alert?: boolean }> = summary
    ? [
        { label: 'New orders', value: summary.newOrders, href: '/admin/orders' },
        { label: 'Awaiting bKash verification', value: summary.awaitingBkashVerification, href: '/admin/orders?order_status=PENDING_CONFIRMATION' },
        { label: 'COD awaiting confirmation', value: summary.codAwaitingConfirmation, href: '/admin/orders?order_status=COD_VERIFICATION_PENDING' },
        { label: 'Payment rejected', value: summary.paymentRejectedAwaitingResubmission, href: '/admin/orders?view=rejected' },
        { label: 'Stale unconfirmed', value: summary.staleUnconfirmed, href: '/admin/orders?view=stale' },
        { label: 'Failed shipments', value: summary.shipmentCreationFailed, href: '/admin/orders?view=failed-shipment', alert: true },
        { label: 'COD money not yet collected', value: summary.codCollectionDiscrepancies, href: '/admin/orders?view=cod-discrepancy', alert: true },
        { label: 'Courier needs attention', value: summary.courierSyncProblems, href: '/admin/orders?view=courier-attention', alert: true },
        { label: `Parcels not moving (${summary.stuckParcelDays}+ days)`, value: summary.stuckParcels, href: '/admin/orders?view=parcel-stuck', alert: true },
        { label: 'Returned (last 30 days)', value: summary.returnedRecently, href: '/admin/orders?view=returned-recently' },
        { label: 'Total orders', value: summary.totalOrders, href: '/admin/orders' },
      ]
    : [];

  return (
    <div>
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Dashboard</h1>
      {state.phase === 'authenticated' && (
        <p className="mb-lg text-text-secondary">
          Signed in as <span className="font-medium text-text-primary">{state.me.userIdentifier}</span> (
          {state.me.role === 'ADMIN' ? 'Admin' : 'Manager'}).
        </p>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load the dashboard</p>
          <p className="mt-xs text-sm text-text-secondary">{error}</p>
        </div>
      )}

      {cards.length > 0 && (
        <ul className="grid grid-cols-2 gap-md lg:grid-cols-4">
          {cards.map((card) => (
            <li key={card.label}>
              <Link
                href={card.href}
                className={`block rounded-lg border bg-surface p-lg hover:border-primary ${
                  card.alert && card.value > 0 ? 'border-warning' : 'border-border'
                }`}
              >
                <p className="text-xs font-semibold text-text-secondary">{card.label}</p>
                <p className="mt-xs text-2xl font-bold">{card.value}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
