'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatMoney } from '@/lib/account';
import { buildQuery } from '@/lib/admin/reportsView';
import { REPORTS_BASE, useReportList, type ProductSalesRow, type StockRow } from '@/lib/admin/reports';
import { useReportContext } from '@/components/admin/reports/ReportContext';
import { ReportHeader } from '@/components/admin/reports/ReportHeader';
import { ReportTable, type Column, type SortState } from '@/components/admin/reports/ReportTable';
import { ReportBoundary, ReportPagination } from '@/components/admin/reports/primitives';

const STOCK_STATE_LABEL: Record<StockRow['stockState'], string> = {
  IN_STOCK: 'In stock',
  LOW_STOCK: 'Low stock',
  OUT_OF_STOCK: 'Out of stock',
};

const toggle = (cur: SortState, key: string, first: 'asc' | 'desc'): SortState => ({
  sort: key,
  order: cur.sort === key ? (cur.order === 'desc' ? 'asc' : 'desc') : first,
});

export default function ProductsReportPage() {
  const ctx = useReportContext();
  const [sort, setSort] = useState<SortState>({ sort: 'unitsSold', order: 'desc' });
  const [filter, setFilter] = useState<'all' | 'out_of_stock' | 'low_stock'>('all');
  const [stockSort, setStockSort] = useState<SortState>({ sort: 'stockQuantity', order: 'asc' });
  const [stockPage, setStockPage] = useState(1);

  useEffect(() => setStockPage(1), [filter, stockSort]);

  const perf = useReportList<ProductSalesRow>(
    `${REPORTS_BASE}/products/performance?${ctx.rangeQuery}&${buildQuery({ sort: sort.sort, order: sort.order, page: ctx.page })}`,
  );
  const stock = useReportList<StockRow>(
    `${REPORTS_BASE}/products/stock?${buildQuery({ filter, sort: stockSort.sort, order: stockSort.order, page: stockPage })}`,
  );

  const productLink = (id: string, text: string) => (
    <Link href={`/admin/catalogue/products/${id}`} className="underline hover:text-primary">
      {text}
    </Link>
  );

  const perfCols: Column<ProductSalesRow>[] = [
    { key: 'name', header: 'Product', render: (r) => productLink(r.productId, r.productName) },
    { key: 'units', header: 'Units sold', numeric: true, sortKey: 'unitsSold', render: (r) => r.unitsSold.toLocaleString('en-BD') },
    { key: 'revenue', header: 'Revenue', numeric: true, sortKey: 'revenue', render: (r) => formatMoney(r.revenue, { decimals: 2 }) },
    { key: 'orders', header: 'Orders', numeric: true, sortKey: 'orderCount', render: (r) => r.orderCount.toLocaleString('en-BD') },
  ];
  const stockCols: Column<StockRow>[] = [
    { key: 'name', header: 'Product', sortKey: 'productName', render: (r) => productLink(r.productId, r.productName) },
    { key: 'variant', header: 'Variant', render: (r) => r.variantLabel },
    { key: 'sku', header: 'SKU', render: (r) => r.sku ?? '-' },
    { key: 'stock', header: 'In stock', numeric: true, sortKey: 'stockQuantity', render: (r) => r.stockQuantity.toLocaleString('en-BD') },
    { key: 'threshold', header: 'Low-stock level', numeric: true, render: (r) => (r.lowStockThreshold === null ? '-' : r.lowStockThreshold) },
    { key: 'state', header: 'Status', render: (r) => STOCK_STATE_LABEL[r.stockState] },
  ];

  return (
    <div>
      <ReportHeader
        title="Products"
        {...(perf.state.phase === 'loaded' ? { meta: perf.state.data.meta } : {})}
        exports={[
          { report: 'products-performance', label: 'Export performance' },
          { report: 'products-stock', label: 'Export stock' },
        ]}
      />

      <section className="mb-xl">
        <h3 className="mb-sm text-base font-bold">Best-selling products</h3>
        <p className="mb-md text-xs text-text-secondary">Delivered orders in the selected period. Sort by units sold for best-sellers.</p>
        <ReportBoundary state={perf.state} reload={perf.reload}>
          {(r) => (
            <>
              <ReportTable
                caption="Product performance"
                columns={perfCols}
                rows={r.data}
                rowKey={(x) => x.productId}
                sort={sort}
                onSort={(k) => {
                  setSort((cur) => toggle(cur, k, 'desc'));
                  ctx.setPage(1);
                }}
              />
              <ReportPagination pagination={r.pagination} onPage={ctx.setPage} />
            </>
          )}
        </ReportBoundary>
      </section>

      <section className="mb-xl">
        <h3 className="mb-sm text-base font-bold">Stock</h3>
        <p className="mb-md text-xs text-text-secondary">Current inventory, independent of the selected period.</p>
        <div className="mb-md sm:w-56">
          <label htmlFor="stock-filter" className="mb-sm block text-xs font-semibold">
            Show
          </label>
          <select
            id="stock-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="h-11 w-full rounded-lg border border-border bg-background px-md text-base"
          >
            <option value="all">All variants</option>
            <option value="out_of_stock">Out of stock</option>
            <option value="low_stock">Low stock</option>
          </select>
        </div>
        <ReportBoundary state={stock.state} reload={stock.reload}>
          {(r) => (
            <>
              <ReportTable
                caption="Stock by variant"
                columns={stockCols}
                rows={r.data}
                rowKey={(x) => x.variantId}
                emptyText="No variants match this filter."
                sort={stockSort}
                onSort={(k) => setStockSort((cur) => toggle(cur, k, 'asc'))}
              />
              <ReportPagination pagination={r.pagination} onPage={setStockPage} />
            </>
          )}
        </ReportBoundary>
      </section>
    </div>
  );
}
