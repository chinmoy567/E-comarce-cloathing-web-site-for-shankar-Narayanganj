'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, apiGet, apiList } from '@/lib/apiClient';
import type { PaginationBlock } from '@/lib/apiTypes';

/**
 * Types and data hooks for the back-office reports (spec 20). Types mirror the backend responses in
 * `backend/src/services/reports.service.ts`; the frontend only displays them.
 */

export type ReportMeta = {
  computedAt: string;
  rollupRefreshedAt: string | null;
  revenueRecognition: 'ORDER_STATUS_DELIVERED';
};
export type ReportRange = { from: string; to: string };
export type ReportConfig = { maxRangeDays: number; timezone: string };

export type SalesSummary = {
  range: ReportRange;
  deliveredRevenue: number;
  pipelineValue: number;
  cancelledValue: number;
  ordersDelivered: number;
  averageOrderValue: number;
  totalDiscountGiven: number;
  totalShipping: number;
  meta: ReportMeta;
};

export type TrendPoint = {
  day: string;
  ordersPlaced: number;
  ordersConfirmed: number;
  ordersDelivered: number;
  ordersCancelled: number;
  ordersReturned: number;
  grossSubtotal: number;
  totalDiscount: number;
  totalShipping: number;
  netRevenue: number;
  bkashOrders: number;
  codOrders: number;
  couponOrders: number;
};
export type SalesTrend = { range: ReportRange; granularity: 'day' | 'week' | 'month'; points: TrendPoint[]; meta: ReportMeta };

export type ProductSalesRow = { productId: string; productName: string; unitsSold: number; revenue: number; orderCount: number };
export type CategorySalesRow = { categoryId: string; categoryName: string; unitsSold: number; revenue: number };
export type StockRow = {
  productId: string;
  productName: string;
  variantId: string;
  variantLabel: string;
  sku: string | null;
  stockQuantity: number;
  lowStockThreshold: number | null;
  stockState: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
};

export type OrdersSummary = {
  range: ReportRange;
  byStatus: Record<string, number>;
  failedShipments: number;
  byPaymentMethod: { BKASH: number; COD: number };
  meta: ReportMeta;
};

export type PaymentsSummary = {
  range: ReportRange;
  bkashOrders: number;
  codOrders: number;
  bkashPendingVerification: number;
  bkashVerified: number;
  bkashRejected: number;
  codPendingCollection: number;
  codCollected: number;
  codCollectionDiscrepancies: number;
  meta: ReportMeta;
};

export type CustomersSummary = {
  range: ReportRange;
  totalCustomers: number;
  registeredCustomers: number;
  guestReferences: number;
  newCustomersInRange: number;
  returningCustomers: number;
  ordersByRegistered: number;
  ordersByGuest: number;
  averageOrdersPerCustomer: number;
  meta: ReportMeta;
};

export type CourierRow = {
  courierCode: string;
  courierName: string;
  total: number;
  delivered: number;
  failedDelivery: number;
  returned: number;
  creationFailed: number;
  deliverySuccessRatePercent: number | null;
};
export type ShipmentsSummary = { range: ReportRange; byCourier: CourierRow[]; byStatus: Record<string, number>; meta: ReportMeta };

export type TopCoupon = {
  couponId: string;
  code: string;
  usageCount: number;
  usageLimit: number | null;
  totalDiscount: number;
  distinctCustomers: number;
};
export type CouponsSummary = {
  range: ReportRange;
  totalDiscountGiven: number;
  ordersWithCoupon: number;
  ordersWithoutCoupon: number;
  topCoupons: TopCoupon[];
  meta: ReportMeta;
};

export type ReportName =
  | 'sales-summary'
  | 'sales-trend'
  | 'sales-by-product'
  | 'sales-by-category'
  | 'orders-summary'
  | 'payments-summary'
  | 'products-performance'
  | 'products-stock'
  | 'customers-summary'
  | 'shipments-summary'
  | 'coupons-summary';

export type ExportStatus = {
  id: string;
  status: 'PENDING' | 'READY' | 'FAILED';
  downloadUrl?: string;
  expiresAt?: string;
  errorMessage?: string;
};

export const REPORTS_BASE = '/api/admin/reports';

// ---- Hooks ---------------------------------------------------------------------------------------

export type ReportState<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: ApiClientError | Error }
  | { phase: 'loaded'; data: T };

export type ListPayload<T> = { data: T[]; pagination: PaginationBlock; meta: ReportMeta };

function useFetched<T>(path: string | null, load: (path: string, signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<ReportState<T>>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (path === null) return;
    // Changing the path (or retrying) aborts the in-flight request, so a slow earlier response can
    // never overwrite a newer one.
    const controller = new AbortController();
    setState({ phase: 'loading' });
    load(path, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ phase: 'loaded', data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ phase: 'error', error: error instanceof Error ? error : new Error('Something went wrong.') });
      });
    return () => controller.abort();
    // `load` is a stable module-level function per hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}

const loadOne = <T,>(path: string, signal: AbortSignal) => apiGet<T>(path, { signal });
const loadList = <T,>(path: string, signal: AbortSignal) => apiList<T>(path, { signal }) as unknown as Promise<ListPayload<T>>;

/** A single-object report (`{ data }`). Pass `null` to wait (e.g. until the config has loaded). */
export function useReport<T>(path: string | null) {
  return useFetched<T>(path, loadOne<T>);
}

/** A paginated list report (`{ data: rows, pagination, meta }`). */
export function useReportList<T>(path: string | null) {
  return useFetched<ListPayload<T>>(path, loadList<T>);
}

/** The range cap and time zone, fetched once per page load and shared by every report. */
export function useReportConfig() {
  return useReport<ReportConfig>(`${REPORTS_BASE}/config`);
}

/** User-facing message for a failed report request. */
export function reportErrorMessage(error: Error): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403) return 'You do not have access to reports.';
    if (error.status === 429) {
      return error.retryAfter
        ? `Too many requests. Try again in ${error.retryAfter} seconds.`
        : 'Too many requests. Please wait a moment and try again.';
    }
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

export const isForbidden = (error: Error): boolean => error instanceof ApiClientError && error.status === 403;
