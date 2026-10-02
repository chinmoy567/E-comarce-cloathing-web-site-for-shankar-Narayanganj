'use client';

import { orderStatusLabel, paymentMethodLabel } from '@/lib/account';
import { ORDER_STATUS_ORDER } from '@/lib/admin/reportsView';
import { REPORTS_BASE, useReport, type OrdersSummary } from '@/lib/admin/reports';
import { useReportContext } from '@/components/admin/reports/ReportContext';
import { ReportHeader } from '@/components/admin/reports/ReportHeader';
import { ReportTable, type Column } from '@/components/admin/reports/ReportTable';
import { BarList, MetricCard, MetricCardRow, ReportBoundary } from '@/components/admin/reports/primitives';

export default function OrdersReportPage() {
  const { rangeQuery } = useReportContext();
  const { state, reload } = useReport<OrdersSummary>(`${REPORTS_BASE}/orders/summary?${rangeQuery}`);

  return (
    <div>
      <ReportHeader title="Orders" {...(state.phase === 'loaded' ? { meta: state.data.meta } : {})} exports={[{ report: 'orders-summary' }]} />
      <ReportBoundary state={state} reload={reload}>
        {(d) => {
          // Each status count links to spec 13's filtered order list so the number is actionable.
          const rows = ORDER_STATUS_ORDER.map((s) => ({
            status: s,
            label: orderStatusLabel(s),
            count: d.byStatus[s] ?? 0,
            href: `/admin/orders?order_status=${s}`,
          }));
          const cols: Column<(typeof rows)[number]>[] = [
            { key: 'status', header: 'Order status', render: (r) => r.label },
            { key: 'count', header: 'Orders', numeric: true, render: (r) => r.count.toLocaleString('en-BD') },
          ];
          return (
            <>
              <MetricCardRow label="Order figures">
                <MetricCard label={paymentMethodLabel('BKASH')} value={d.byPaymentMethod.BKASH.toLocaleString('en-BD')} hint="Orders paid by bKash" />
                <MetricCard label={paymentMethodLabel('COD')} value={d.byPaymentMethod.COD.toLocaleString('en-BD')} hint="Cash on delivery orders" />
                <MetricCard label="Failed shipments" value={d.failedShipments.toLocaleString('en-BD')} hint="Shipments with a failed creation or delivery" />
              </MetricCardRow>
              <h3 className="mb-md text-base font-bold">Orders by status</h3>
              <BarList caption="Orders by status" items={rows.map((r) => ({ label: r.label, count: r.count, href: r.href }))} />
              <ReportTable caption="Orders by status" columns={cols} rows={rows} rowKey={(r) => r.status} />
            </>
          );
        }}
      </ReportBoundary>
    </div>
  );
}
