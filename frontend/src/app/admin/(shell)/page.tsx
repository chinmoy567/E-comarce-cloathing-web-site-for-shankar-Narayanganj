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
  totalOrders: number;
};

const LAST_VISIT_KEY = 'fabrillke.admin.dashboard.lastVisit';

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

  const cards: Array<{ label: string; value: number }> = summary
    ? [
        { label: 'New orders', value: summary.newOrders },
        { label: 'Awaiting bKash verification', value: summary.awaitingBkashVerification },
        { label: 'COD awaiting confirmation', value: summary.codAwaitingConfirmation },
        { label: 'Payment rejected', value: summary.paymentRejectedAwaitingResubmission },
        { label: 'Stale unconfirmed', value: summary.staleUnconfirmed },
        { label: 'Failed shipments', value: summary.shipmentCreationFailed },
        { label: 'COD discrepancies', value: summary.codCollectionDiscrepancies },
        { label: 'Total orders', value: summary.totalOrders },
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
              <Link href="/admin/orders" className="block rounded-lg border border-border bg-surface p-lg hover:border-primary">
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
