'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatMoney } from '@/lib/account';
import { formatReportDate, REVENUE_RECOGNITION_COPY, TREND_MEASURES, buildQuery, type TrendMeasure } from '@/lib/admin/reportsView';
import {
  REPORTS_BASE,
  useReport,
  useReportList,
  type CategorySalesRow,
  type ProductSalesRow,
  type SalesSummary,
  type SalesTrend,
} from '@/lib/admin/reports';
import { useReportContext } from '@/components/admin/reports/ReportContext';
import { ReportHeader } from '@/components/admin/reports/ReportHeader';
import { ReportTable, type Column, type SortState } from '@/components/admin/reports/ReportTable';
import { TrendChart } from '@/components/admin/reports/TrendChart';
import { MetricCard, MetricCardRow, ReportBoundary, ReportPagination } from '@/components/admin/reports/primitives';

const money = (v: number) => formatMoney(v, { decimals: 2 });
const toggle = (cur: SortState, key: string): SortState => ({ sort: key, order: cur.sort === key && cur.order === 'desc' ? 'asc' : 'desc' });

export default function SalesReportPage() {
  const ctx = useReportContext();
  const { rangeQuery } = ctx;
  const [measure, setMeasure] = useState<TrendMeasure>('netRevenue');
  const [productSort, setProductSort] = useState<SortState>({ sort: 'unitsSold', order: 'desc' });
  const [categorySort, setCategorySort] = useState<SortState>({ sort: 'revenue', order: 'desc' });
  const [categoryPage, setCategoryPage] = useState(1);

  useEffect(() => setCategoryPage(1), [rangeQuery]);

  const summary = useReport<SalesSummary>(`${REPORTS_BASE}/sales/summary?${rangeQuery}`);
  const trend = useReport<SalesTrend>(`${REPORTS_BASE}/sales/trend?${rangeQuery}&granularity=${ctx.granularity}`);
  const byProduct = useReportList<ProductSalesRow>(
    `${REPORTS_BASE}/sales/by-product?${rangeQuery}&${buildQuery({ sort: productSort.sort, order: productSort.order, page: ctx.page })}`,
  );
  const byCategory = useReportList<CategorySalesRow>(
    `${REPORTS_BASE}/sales/by-category?${rangeQuery}&${buildQuery({ sort: categorySort.sort, order: categorySort.order, page: categoryPage })}`,
  );

  const productCols: Column<ProductSalesRow>[] = [
    {
      key: 'name',
      header: 'Product',
      render: (r) => (
        <Link href={`/admin/catalogue/products/${r.productId}`} className="underline hover:text-primary">
          {r.productName}
        </Link>
      ),
    },
    { key: 'units', header: 'Units sold', numeric: true, sortKey: 'unitsSold', render: (r) => r.unitsSold.toLocaleString('en-BD') },
    { key: 'revenue', header: 'Revenue', numeric: true, sortKey: 'revenue', render: (r) => money(r.revenue) },
    { key: 'orders', header: 'Orders', numeric: true, sortKey: 'orderCount', render: (r) => r.orderCount.toLocaleString('en-BD') },
  ];
  const categoryCols: Column<CategorySalesRow>[] = [
    { key: 'name', header: 'Category', render: (r) => r.categoryName },
    { key: 'units', header: 'Units sold', numeric: true, sortKey: 'unitsSold', render: (r) => r.unitsSold.toLocaleString('en-BD') },
    { key: 'revenue', header: 'Revenue', numeric: true, sortKey: 'revenue', render: (r) => money(r.revenue) },
  ];
  const trendCols: Column<SalesTrend['points'][number]>[] = [
    { key: 'day', header: 'Period', render: (p) => formatReportDate(p.day) },
    { key: 'placed', header: 'Placed', numeric: true, render: (p) => p.ordersPlaced },
    { key: 'confirmed', header: 'Confirmed', numeric: true, render: (p) => p.ordersConfirmed },
    { key: 'delivered', header: 'Delivered', numeric: true, render: (p) => p.ordersDelivered },
    { key: 'cancelled', header: 'Cancelled', numeric: true, render: (p) => p.ordersCancelled },
    { key: 'returned', header: 'Returned', numeric: true, render: (p) => p.ordersReturned },
    { key: 'gross', header: 'Gross subtotal', numeric: true, render: (p) => money(p.grossSubtotal) },
    { key: 'discount', header: 'Discount', numeric: true, render: (p) => money(p.totalDiscount) },
    { key: 'shipping', header: 'Shipping', numeric: true, render: (p) => money(p.totalShipping) },
    { key: 'revenue', header: 'Delivered revenue', numeric: true, render: (p) => money(p.netRevenue) },
    { key: 'bkash', header: 'bKash', numeric: true, render: (p) => p.bkashOrders },
    { key: 'cod', header: 'COD', numeric: true, render: (p) => p.codOrders },
    { key: 'coupon', header: 'With coupon', numeric: true, render: (p) => p.couponOrders },
  ];

  return (
    <div>
      <ReportHeader
        title="Sales"
        {...(summary.state.phase === 'loaded' ? { meta: summary.state.data.meta } : {})}
        exports={[
          { report: 'sales-summary', label: 'Export summary' },
          { report: 'sales-trend', label: 'Export trend' },
          { report: 'sales-by-product', label: 'Export by product' },
          { report: 'sales-by-category', label: 'Export by category' },
        ]}
      />

      <ReportBoundary state={summary.state} reload={summary.reload}>
        {(s) => (
          <>
            <p className="mb-md text-sm text-text-secondary">{REVENUE_RECOGNITION_COPY[s.meta.revenueRecognition]}</p>
            <MetricCardRow label="Revenue figures">
              <MetricCard label="Delivered revenue" value={money(s.deliveredRevenue)} hint="Recognized when an order is Delivered" />
              <MetricCard label="Pipeline value" value={money(s.pipelineValue)} hint="Placed, not yet delivered or cancelled" />
              <MetricCard label="Cancelled value" value={money(s.cancelledValue)} hint="Excluded from revenue" />
            </MetricCardRow>
            <MetricCardRow label="Other sales figures">
              <MetricCard label="Orders delivered" value={s.ordersDelivered.toLocaleString('en-BD')} />
              <MetricCard label="Average order value" value={money(s.averageOrderValue)} hint="Delivered revenue per delivered order" />
              <MetricCard label="Discount given" value={money(s.totalDiscountGiven)} />
              <MetricCard label="Shipping charged" value={money(s.totalShipping)} />
            </MetricCardRow>
          </>
        )}
      </ReportBoundary>

      <section className="mb-xl">
        <div className="mb-md flex flex-col gap-sm sm:flex-row sm:items-end sm:justify-between">
          <h3 className="text-base font-bold">Trend</h3>
          <div className="sm:w-56">
            <label htmlFor="trend-measure" className="mb-sm block text-xs font-semibold">
              Measure
            </label>
            <select
              id="trend-measure"
              value={measure}
              onChange={(e) => setMeasure(e.target.value as TrendMeasure)}
              className="h-11 w-full rounded-lg border border-border bg-background px-md text-base"
            >
              {TREND_MEASURES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <ReportBoundary
          state={trend.state}
          reload={trend.reload}
          isEmpty={(t) => t.points.length === 0}
          emptyText="No trend data for this period. The daily rollup may not have run yet."
        >
          {(t) => (
            <>
              <TrendChart points={t.points} measure={measure} />
              <ReportTable caption="Trend data" columns={trendCols} rows={t.points} rowKey={(p) => p.day} />
            </>
          )}
        </ReportBoundary>
      </section>

      <section className="mb-xl">
        <h3 className="mb-sm text-base font-bold">Sales by product</h3>
        <p className="mb-md text-xs text-text-secondary">
          Delivered orders only. Revenue is before coupon discounts, so it will not add up to delivered revenue above.
        </p>
        <ReportBoundary state={byProduct.state} reload={byProduct.reload}>
          {(r) => (
            <>
              <ReportTable
                caption="Sales by product"
                columns={productCols}
                rows={r.data}
                rowKey={(x) => x.productId}
                sort={productSort}
                onSort={(k) => {
                  setProductSort((cur) => toggle(cur, k));
                  ctx.setPage(1);
                }}
              />
              <ReportPagination pagination={r.pagination} onPage={ctx.setPage} />
            </>
          )}
        </ReportBoundary>
      </section>

      <section className="mb-xl">
        <h3 className="mb-md text-base font-bold">Sales by category</h3>
        <ReportBoundary state={byCategory.state} reload={byCategory.reload}>
          {(r) => (
            <>
              <ReportTable
                caption="Sales by category"
                columns={categoryCols}
                rows={r.data}
                rowKey={(x) => x.categoryId}
                sort={categorySort}
                onSort={(k) => {
                  setCategorySort((cur) => toggle(cur, k));
                  setCategoryPage(1);
                }}
              />
              <ReportPagination pagination={r.pagination} onPage={setCategoryPage} />
            </>
          )}
        </ReportBoundary>
      </section>
    </div>
  );
}
