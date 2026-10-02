'use client';

import { REPORTS_BASE, useReport, type CustomersSummary } from '@/lib/admin/reports';
import { useReportContext } from '@/components/admin/reports/ReportContext';
import { ReportHeader } from '@/components/admin/reports/ReportHeader';
import { MetricCard, MetricCardRow, ReportBoundary, ShareBar } from '@/components/admin/reports/primitives';

const n = (v: number) => v.toLocaleString('en-BD');

/** Counts only: no name, phone, email or address appears anywhere in this slice. */
export default function CustomersReportPage() {
  const { rangeQuery } = useReportContext();
  const { state, reload } = useReport<CustomersSummary>(`${REPORTS_BASE}/customers/summary?${rangeQuery}`);

  return (
    <div>
      <ReportHeader title="Customers" {...(state.phase === 'loaded' ? { meta: state.data.meta } : {})} exports={[{ report: 'customers-summary' }]} />
      <ReportBoundary state={state} reload={reload}>
        {(d) => (
          <>
            <MetricCardRow label="Customer figures">
              <MetricCard label="Total customers" value={n(d.totalCustomers)} hint="Registered customers plus guest references" />
              <MetricCard label="Registered" value={n(d.registeredCustomers)} />
              <MetricCard label="Guest references" value={n(d.guestReferences)} />
              <MetricCard label="New in period" value={n(d.newCustomersInRange)} />
              <MetricCard label="Returning" value={n(d.returningCustomers)} hint="Customers with two or more orders" />
              <MetricCard label="Orders per customer" value={n(d.averageOrdersPerCustomer)} hint="Average, for customers who ordered in the period" />
            </MetricCardRow>
            <h3 className="mb-md text-base font-bold">Orders: registered vs guest</h3>
            <ShareBar
              caption="Orders by customer type"
              segments={[
                { label: 'Registered', count: d.ordersByRegistered },
                { label: 'Guest', count: d.ordersByGuest },
              ]}
            />
          </>
        )}
      </ReportBoundary>
    </div>
  );
}
