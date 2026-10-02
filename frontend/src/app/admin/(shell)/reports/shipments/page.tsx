'use client';

import { shipmentStatusLabel } from '@/lib/account';
import { SHIPMENT_STATUS_ORDER, successRateLabel } from '@/lib/admin/reportsView';
import { REPORTS_BASE, useReport, type CourierRow, type ShipmentsSummary } from '@/lib/admin/reports';
import { useReportContext } from '@/components/admin/reports/ReportContext';
import { ReportHeader } from '@/components/admin/reports/ReportHeader';
import { ReportTable, type Column } from '@/components/admin/reports/ReportTable';
import { BarList, ReportBoundary } from '@/components/admin/reports/primitives';

const n = (v: number) => v.toLocaleString('en-BD');

export default function ShipmentsReportPage() {
  const { rangeQuery } = useReportContext();
  const { state, reload } = useReport<ShipmentsSummary>(`${REPORTS_BASE}/shipments/summary?${rangeQuery}`);

  const courierCols: Column<CourierRow>[] = [
    { key: 'name', header: 'Courier', render: (r) => r.courierName },
    { key: 'total', header: 'Shipments', numeric: true, render: (r) => n(r.total) },
    { key: 'delivered', header: 'Delivered', numeric: true, render: (r) => n(r.delivered) },
    { key: 'failed', header: 'Failed delivery', numeric: true, render: (r) => n(r.failedDelivery) },
    { key: 'returned', header: 'Returned', numeric: true, render: (r) => n(r.returned) },
    { key: 'creation', header: 'Creation failed', numeric: true, render: (r) => n(r.creationFailed) },
    { key: 'rate', header: 'Delivery success', numeric: true, render: (r) => successRateLabel(r.deliverySuccessRatePercent) },
  ];

  return (
    <div>
      <ReportHeader
        title="Courier and shipments"
        {...(state.phase === 'loaded' ? { meta: state.data.meta } : {})}
        exports={[{ report: 'shipments-summary' }]}
      />
      <ReportBoundary state={state} reload={reload}>
        {(d) => {
          const statusRows = SHIPMENT_STATUS_ORDER.map((s) => ({ status: s, label: shipmentStatusLabel(s), count: d.byStatus[s] ?? 0 }));
          const statusCols: Column<(typeof statusRows)[number]>[] = [
            { key: 'status', header: 'Shipment status', render: (r) => r.label },
            { key: 'count', header: 'Shipments', numeric: true, render: (r) => n(r.count) },
          ];
          return (
            <>
              <h3 className="mb-md text-base font-bold">By courier</h3>
              <div className="mb-xl">
                <ReportTable
                  caption="Shipments by courier"
                  columns={courierCols}
                  rows={d.byCourier}
                  rowKey={(r) => r.courierCode}
                  emptyText="No couriers are configured."
                />
              </div>
              <h3 className="mb-md text-base font-bold">By shipment status</h3>
              <BarList caption="Shipments by status" items={statusRows.map((r) => ({ label: r.label, count: r.count }))} />
              <ReportTable caption="Shipments by status" columns={statusCols} rows={statusRows} rowKey={(r) => r.status} />
            </>
          );
        }}
      </ReportBoundary>
    </div>
  );
}
