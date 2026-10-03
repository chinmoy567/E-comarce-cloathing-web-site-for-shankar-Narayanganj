'use client';

import Link from 'next/link';
import { formatMoney } from '@/lib/account';
import { usageLabel } from '@/lib/admin/reportsView';
import { REPORTS_BASE, useReport, type CouponsSummary, type TopCoupon } from '@/lib/admin/reports';
import { useReportContext } from '@/components/admin/reports/ReportContext';
import { ReportHeader } from '@/components/admin/reports/ReportHeader';
import { ReportTable, type Column } from '@/components/admin/reports/ReportTable';
import { MetricCard, MetricCardRow, ReportBoundary } from '@/components/admin/reports/primitives';

const n = (v: number) => v.toLocaleString('en-BD');

export default function CouponsReportPage() {
  const { rangeQuery } = useReportContext();
  const { state, reload } = useReport<CouponsSummary>(`${REPORTS_BASE}/coupons/summary?${rangeQuery}`);

  const cols: Column<TopCoupon>[] = [
    {
      key: 'code',
      header: 'Coupon',
      render: (r) => (
        <Link href={`/admin/marketing/coupons/${r.couponId}`} className="inline-flex min-h-[44px] items-center font-mono underline hover:text-primary">
          {r.code}
        </Link>
      ),
    },
    { key: 'usage', header: 'Used / limit', numeric: true, render: (r) => usageLabel(r.usageCount, r.usageLimit) },
    { key: 'discount', header: 'Discount given', numeric: true, render: (r) => formatMoney(r.totalDiscount, { decimals: 2 }) },
    { key: 'customers', header: 'Distinct customers', numeric: true, render: (r) => n(r.distinctCustomers) },
  ];

  return (
    <div>
      <ReportHeader title="Coupons and discounts" {...(state.phase === 'loaded' ? { meta: state.data.meta } : {})} exports={[{ report: 'coupons-summary' }]} />
      <ReportBoundary state={state} reload={reload}>
        {(d) => (
          <>
            <MetricCardRow label="Coupon figures">
              <MetricCard label="Total discount given" value={formatMoney(d.totalDiscountGiven, { decimals: 2 })} hint="Excludes cancelled and returned orders" />
              <MetricCard label="Orders with a coupon" value={n(d.ordersWithCoupon)} />
              <MetricCard label="Orders without a coupon" value={n(d.ordersWithoutCoupon)} />
            </MetricCardRow>
            <h3 className="mb-md text-base font-bold">Most-used coupons</h3>
            <ReportTable caption="Most-used coupons" columns={cols} rows={d.topCoupons} rowKey={(r) => r.couponId} emptyText="No coupons were used in this period." />
          </>
        )}
      </ReportBoundary>
    </div>
  );
}
