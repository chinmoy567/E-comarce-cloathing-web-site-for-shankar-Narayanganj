import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { paginationQuerySchema } from '../lib/pagination.js';

/**
 * Report query contracts (spec 20 "Shared query contract", 11-security-hardening §11.4/§11.6).
 *
 * `from` and `to` are REQUIRED on every report — nothing defaults to "all time", which would be an
 * unbounded scan. The span is capped at REPORT_MAX_RANGE_DAYS; a longer range is rejected with
 * `RANGE_TOO_LARGE` (surfaced through the `appCode` refinement tag `validate()` understands).
 * Sort keys are allowlisted here and mapped to fixed SQL fragments in the repository — a caller
 * string never reaches SQL.
 */

export const REPORT_NAMES = [
  'sales-summary',
  'sales-trend',
  'sales-by-product',
  'sales-by-category',
  'orders-summary',
  'payments-summary',
  'products-performance',
  'products-stock',
  'customers-summary',
  'shipments-summary',
  'coupons-summary',
] as const;
export type ReportName = (typeof REPORT_NAMES)[number];

const MS_PER_DAY = 86_400_000;

const isoDate = z
  .string({ required_error: 'Required.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO date (YYYY-MM-DD).')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Not a valid calendar date.');

/** Whole days between two ISO dates, inclusive of both ends. */
export function rangeDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY) + 1;
}

export type ReportRange = { from: string; to: string };

/** Adds the from<=to and span-cap checks to any object schema that carries `from`/`to`. */
export function withRangeChecks<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const { from, to } = value as ReportRange;
    if (typeof from !== 'string' || typeof to !== 'string') return;
    if (from > to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: 'The start date must be on or before the end date.' });
      return;
    }
    const cap = getEnv().REPORT_MAX_RANGE_DAYS;
    if (rangeDays(from, to) > cap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: `Choose a range of ${cap} days or fewer.`,
        params: { appCode: 'RANGE_TOO_LARGE' },
      });
    }
  });
}

const rangeShape = { from: isoDate, to: isoDate };
const sortOrder = z.enum(['asc', 'desc']).default('desc');

/** Reports with no extra parameters: sales/summary, orders/payments/customers/shipments/coupons summary. */
export const reportRangeSchema = withRangeChecks(z.object(rangeShape).strict());

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];
export const trendQuerySchema = withRangeChecks(
  z.object({ ...rangeShape, granularity: z.enum(GRANULARITIES).default('day') }).strict(),
);

export const SALES_SORT_KEYS = ['unitsSold', 'revenue', 'orderCount'] as const;
export const salesByProductQuerySchema = withRangeChecks(
  z
    .object({ ...rangeShape, sort: z.enum(SALES_SORT_KEYS).default('unitsSold'), order: sortOrder })
    .merge(paginationQuerySchema)
    .strict(),
);

export const CATEGORY_SORT_KEYS = ['revenue', 'unitsSold'] as const;
export const salesByCategoryQuerySchema = withRangeChecks(
  z
    .object({ ...rangeShape, sort: z.enum(CATEGORY_SORT_KEYS).default('revenue'), order: sortOrder })
    .merge(paginationQuerySchema)
    .strict(),
);

/** /products/performance shares the by-product sort allowlist. */
export const productsPerformanceQuerySchema = salesByProductQuerySchema;

export const STOCK_FILTERS = ['all', 'out_of_stock', 'low_stock'] as const;
export const STOCK_SORT_KEYS = ['stockQuantity', 'productName'] as const;
/** Stock is a point-in-time view of live inventory, so it takes no date range. */
export const productsStockQuerySchema = z
  .object({
    filter: z.enum(STOCK_FILTERS).default('all'),
    sort: z.enum(STOCK_SORT_KEYS).default('stockQuantity'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .merge(paginationQuerySchema)
  .strict();

export const createExportSchema = withRangeChecks(
  z.object({ report: z.enum(REPORT_NAMES), ...rangeShape }).strict(),
);

export const exportIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

export type SalesSortKey = (typeof SALES_SORT_KEYS)[number];
export type CategorySortKey = (typeof CATEGORY_SORT_KEYS)[number];
export type StockFilter = (typeof STOCK_FILTERS)[number];
export type StockSortKey = (typeof STOCK_SORT_KEYS)[number];
