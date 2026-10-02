import { getEnv } from '../config/env.js';
import { NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import * as repo from '../repositories/reports.repository.js';
import * as reports from './reports.service.js';
import { signExportUrl, uploadExportCsv } from './storage/reportExports.service.js';
import type { ReportName } from '../validation/reports.validation.js';

/**
 * Asynchronous CSV export (spec 20, §11.4). The request path only inserts a PENDING row; the worker
 * (`scripts/processReportExports.ts`) builds the file by calling the SAME report functions the screen
 * uses, so a download can never disagree with what was shown. The file goes to a private bucket.
 */

type Cell = string | number | null;
export type Section = { headers: string[]; rows: Cell[][] };
const EXPORT_PAGE_SIZE = 100;

export async function createExport(actorId: string, report: ReportName, range: repo.Range) {
  const row = await repo.insertExport({ requestedBy: actorId, report, from: range.from, to: range.to });
  return { id: row.id, status: row.status };
}

export type ExportStatusView = {
  id: string;
  status: 'PENDING' | 'READY' | 'FAILED';
  downloadUrl?: string;
  expiresAt?: string;
  errorMessage?: string;
};

/** Owner-scoped. A colleague's id is indistinguishable from a missing one (404). */
export async function getExportStatus(id: string, ownerId: string): Promise<ExportStatusView> {
  const row = await repo.findExportForOwner(id, ownerId);
  if (!row) throw new NotFoundError('Export not found.');
  if (row.status === 'READY' && row.storagePath) {
    const signed = await signExportUrl(row.storagePath);
    return { id: row.id, status: 'READY', downloadUrl: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }
  if (row.status === 'FAILED') {
    return { id: row.id, status: 'FAILED', errorMessage: row.errorMessage ?? 'The export failed.' };
  }
  // PROCESSING is shown as PENDING: to the client both mean "not ready yet".
  return { id: row.id, status: 'PENDING' };
}

// ---- CSV -----------------------------------------------------------------------------------------

/** Cells starting with = + - @ are prefixed so a spreadsheet cannot evaluate them as formulas. */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(sections: Section[]): string {
  return (
    sections.map((s) => [s.headers, ...s.rows].map((r) => r.map(csvCell).join(',')).join('\r\n')).join('\r\n\r\n') + '\r\n'
  );
}

const kv = (obj: object, skip: string[] = []): Section => ({
  headers: ['metric', 'value'],
  rows: Object.entries(obj)
    .filter(([k, v]) => !skip.includes(k) && (typeof v === 'number' || typeof v === 'string' || v === null))
    .map(([k, v]) => [k, v as Cell]),
});

const table = <T extends object>(rows: T[], cols: Array<keyof T & string>): Section => ({
  headers: cols,
  rows: rows.map((r) => cols.map((c) => ((r as Record<string, unknown>)[c] ?? null) as Cell)),
});

async function allPages<T>(
  load: (page: repo.PageArgs) => Promise<{ data: T[]; pagination: { totalPages: number } }>,
): Promise<T[]> {
  const cap = getEnv().REPORT_EXPORT_MAX_ROWS;
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const res = await load({ page, pageSize: EXPORT_PAGE_SIZE });
    out.push(...res.data);
    if (page >= res.pagination.totalPages || out.length >= cap) break;
  }
  return out.slice(0, cap);
}

export async function buildReportSections(report: ReportName, range: repo.Range): Promise<Section[]> {
  switch (report) {
    case 'sales-summary':
      return [kv(await reports.getSalesSummary(range), ['range'])];
    case 'sales-trend': {
      const t = await reports.getSalesTrend(range, 'day');
      return [
        table(t.points, [
          'day', 'ordersPlaced', 'ordersConfirmed', 'ordersDelivered', 'ordersCancelled', 'ordersReturned',
          'grossSubtotal', 'totalDiscount', 'totalShipping', 'netRevenue', 'bkashOrders', 'codOrders', 'couponOrders',
        ]),
      ];
    }
    case 'sales-by-product':
    case 'products-performance': {
      const rows = await allPages((p) => reports.getSalesByProduct(range, 'unitsSold', 'desc', p));
      return [table(rows, ['productId', 'productName', 'unitsSold', 'revenue', 'orderCount'])];
    }
    case 'sales-by-category': {
      const rows = await allPages((p) => reports.getSalesByCategory(range, 'revenue', 'desc', p));
      return [table(rows, ['categoryId', 'categoryName', 'unitsSold', 'revenue'])];
    }
    case 'products-stock': {
      const rows = await allPages((p) => reports.getProductsStock('all', 'stockQuantity', 'asc', p));
      return [
        table(rows, ['productId', 'productName', 'variantId', 'variantLabel', 'sku', 'stockQuantity', 'lowStockThreshold', 'stockState']),
      ];
    }
    case 'orders-summary': {
      const o = await reports.getOrdersSummary(range);
      return [
        { headers: ['orderStatus', 'count'], rows: Object.entries(o.byStatus) },
        { headers: ['paymentMethod', 'count'], rows: Object.entries(o.byPaymentMethod) },
        { headers: ['metric', 'value'], rows: [['failedShipments', o.failedShipments]] },
      ];
    }
    case 'payments-summary':
      return [kv(await reports.getPaymentsSummary(range), ['range'])];
    case 'customers-summary':
      return [kv(await reports.getCustomersSummary(range), ['range'])];
    case 'shipments-summary': {
      const s = await reports.getShipmentsSummary(range);
      return [
        table(s.byCourier, [
          'courierCode', 'courierName', 'total', 'delivered', 'failedDelivery', 'returned', 'creationFailed', 'deliverySuccessRatePercent',
        ]),
        { headers: ['shipmentStatus', 'count'], rows: Object.entries(s.byStatus) },
      ];
    }
    case 'coupons-summary': {
      const c = await reports.getCouponsSummary(range);
      return [
        kv(c, ['range']),
        table(c.topCoupons, ['couponId', 'code', 'usageCount', 'usageLimit', 'totalDiscount', 'distinctCustomers']),
      ];
    }
  }
}

// ---- Worker --------------------------------------------------------------------------------------

/** Processes one claimed job. Returns false when the queue is empty. Failures are recorded, never thrown. */
export async function processNextExport(): Promise<boolean> {
  const job = await repo.claimNextExport();
  if (!job) return false;
  try {
    const csv = toCsv(await buildReportSections(job.report as ReportName, { from: job.rangeFrom, to: job.rangeTo }));
    const path = `${job.requestedBy}/${job.id}.csv`;
    await uploadExportCsv(path, csv);
    await repo.markExportReady(job.id, path);
  } catch (err) {
    logger.error({ exportId: job.id, err: err instanceof Error ? err.message : 'unknown' }, 'report export failed');
    await repo.markExportFailed(job.id, 'The export could not be generated. Please try again.');
  }
  return true;
}

export async function processPendingExports(maxJobs = 20): Promise<number> {
  let processed = 0;
  while (processed < maxJobs && (await processNextExport())) processed++;
  return processed;
}
