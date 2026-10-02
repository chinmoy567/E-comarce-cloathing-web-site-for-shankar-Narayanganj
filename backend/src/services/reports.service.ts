import { getEnv } from '../config/env.js';
import { REPORT_TIMEZONE } from '../config/constants.js';
import { SHIPMENT_STATUSES, ORDER_STATUSES, PAYMENT_METHODS } from '../types/orderEnums.js';
import { buildPagination } from '../lib/pagination.js';
import type { PaginationBlock } from '../types/api.js';
import * as repo from '../repositories/reports.repository.js';
import type {
  CategorySortKey,
  Granularity,
  SalesSortKey,
  StockFilter,
  StockSortKey,
} from '../validation/reports.validation.js';

/**
 * Report assembly (spec 20). Read-only: this module and the repository it calls never write
 * business data. It zero-fills enum buckets from the §5.21 enums (so a report can neither invent nor
 * merge a status), derives ratios, and stamps every response with `ReportMeta`.
 *
 * Revenue recognition: revenue is recognized on orders whose `order_status` is DELIVERED. Earlier
 * states are pipeline value; CANCELLED is reported separately; RETURNED is in none of the three.
 */

export type ReportMeta = {
  computedAt: string;
  rollupRefreshedAt: string | null;
  revenueRecognition: 'ORDER_STATUS_DELIVERED';
};

function meta(rollupRefreshedAt: Date | null = null): ReportMeta {
  return {
    computedAt: new Date().toISOString(),
    rollupRefreshedAt: rollupRefreshedAt ? rollupRefreshedAt.toISOString() : null,
    revenueRecognition: 'ORDER_STATUS_DELIVERED',
  };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** A zero-filled record over a fixed enum, so every key is always present. */
function zeroFilled<K extends string>(keys: readonly K[], counts: Record<string, number>): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, counts[k] ?? 0])) as Record<K, number>;
}

export type ListReport<T> = { data: T[]; pagination: PaginationBlock; meta: ReportMeta };

export function getReportConfig(): { maxRangeDays: number; timezone: string } {
  return { maxRangeDays: getEnv().REPORT_MAX_RANGE_DAYS, timezone: REPORT_TIMEZONE };
}

export async function getSalesSummary(range: repo.Range) {
  const s = await repo.salesSummary(range);
  return {
    range,
    ...s,
    averageOrderValue: s.ordersDelivered === 0 ? 0 : round2(s.deliveredRevenue / s.ordersDelivered),
    meta: meta(),
  };
}

export async function getSalesTrend(range: repo.Range, granularity: Granularity) {
  const { points, refreshedAt } = await repo.salesTrend(range, granularity);
  return { range, granularity, points, meta: meta(refreshedAt) };
}

export async function getSalesByProduct(
  range: repo.Range,
  sort: SalesSortKey,
  order: 'asc' | 'desc',
  page: repo.PageArgs,
): Promise<ListReport<repo.ProductSalesRow>> {
  const { rows, total } = await repo.salesByProduct(range, sort, order, page);
  return { data: rows, pagination: buildPagination(page, total), meta: meta() };
}

export async function getSalesByCategory(
  range: repo.Range,
  sort: CategorySortKey,
  order: 'asc' | 'desc',
  page: repo.PageArgs,
): Promise<ListReport<repo.CategorySalesRow>> {
  const { rows, total } = await repo.salesByCategory(range, sort, order, page);
  return { data: rows, pagination: buildPagination(page, total), meta: meta() };
}

export async function getOrdersSummary(range: repo.Range) {
  const s = await repo.ordersSummary(range);
  return {
    range,
    byStatus: zeroFilled(ORDER_STATUSES, s.byStatus),
    failedShipments: s.failedShipments,
    byPaymentMethod: zeroFilled(PAYMENT_METHODS, s.byPaymentMethod),
    meta: meta(),
  };
}

export async function getPaymentsSummary(range: repo.Range) {
  return { range, ...(await repo.paymentsSummary(range)), meta: meta() };
}

export async function getProductsPerformance(
  range: repo.Range,
  sort: SalesSortKey,
  order: 'asc' | 'desc',
  page: repo.PageArgs,
) {
  return getSalesByProduct(range, sort, order, page);
}

export async function getProductsStock(
  filter: StockFilter,
  sort: StockSortKey,
  order: 'asc' | 'desc',
  page: repo.PageArgs,
): Promise<ListReport<repo.StockRow>> {
  const { rows, total } = await repo.productsStock(filter, sort, order, page);
  return { data: rows, pagination: buildPagination(page, total), meta: meta() };
}

export async function getCustomersSummary(range: repo.Range) {
  return { range, ...(await repo.customersSummary(range)), meta: meta() };
}

export async function getShipmentsSummary(range: repo.Range) {
  const s = await repo.shipmentsSummary(range);
  return {
    range,
    byCourier: s.byCourier.map((c) => {
      const attempted = c.delivered + c.failedDelivery + c.returned;
      return { ...c, deliverySuccessRatePercent: attempted === 0 ? null : round2((c.delivered / attempted) * 100) };
    }),
    byStatus: zeroFilled(SHIPMENT_STATUSES, s.byStatus),
    meta: meta(),
  };
}

const TOP_COUPONS_LIMIT = 20;

export async function getCouponsSummary(range: repo.Range) {
  return { range, ...(await repo.couponsSummary(range, TOP_COUPONS_LIMIT)), meta: meta() };
}
