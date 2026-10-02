'use client';

import { REPORTS_BASE, useReport, type PaymentsSummary } from '@/lib/admin/reports';
import { useReportContext } from '@/components/admin/reports/ReportContext';
import { ReportHeader } from '@/components/admin/reports/ReportHeader';
import { MetricCard, MetricCardRow, ReportBoundary } from '@/components/admin/reports/primitives';

const n = (v: number) => v.toLocaleString('en-BD');

/** Payment lines come straight from the payment fields; they are never merged with order or shipment counts (§5.21.11). */
export default function PaymentsReportPage() {
  const { rangeQuery } = useReportContext();
  const { state, reload } = useReport<PaymentsSummary>(`${REPORTS_BASE}/payments/summary?${rangeQuery}`);

  return (
    <div>
      <ReportHeader title="Payments" {...(state.phase === 'loaded' ? { meta: state.data.meta } : {})} exports={[{ report: 'payments-summary' }]} />
      <ReportBoundary state={state} reload={reload}>
        {(d) => (
          <MetricCardRow label="Payment figures">
            <MetricCard label="bKash orders" value={n(d.bkashOrders)} />
            <MetricCard label="COD orders" value={n(d.codOrders)} />
            <MetricCard label="bKash pending verification" value={n(d.bkashPendingVerification)} />
            <MetricCard label="bKash verified" value={n(d.bkashVerified)} />
            <MetricCard label="bKash rejected" value={n(d.bkashRejected)} />
            <MetricCard label="COD pending collection" value={n(d.codPendingCollection)} />
            <MetricCard label="COD collected" value={n(d.codCollected)} />
            <MetricCard
              label="COD collection discrepancies"
              value={n(d.codCollectionDiscrepancies)}
              hint="Delivered COD orders still marked Pending Collection"
              href="/admin/orders?has_cod_discrepancy=true"
              attention
            />
          </MetricCardRow>
        )}
      </ReportBoundary>
    </div>
  );
}
