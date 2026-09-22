import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../config/constants.js';
import type { PaginationBlock } from '../types/api.js';

/**
 * Pagination is mandatory on every list endpoint (11-security-hardening §11.4).
 * Every later spec's list route mounts this schema rather than defining its own.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export type RangeBounds = { from: number; to: number };

/** Converts a validated pagination query to Supabase `range()` bounds (inclusive). */
export function toRange({ page, pageSize }: PaginationQuery): RangeBounds {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

/** Builds the `pagination` block returned alongside a list payload. */
export function buildPagination({ page, pageSize }: PaginationQuery, total: number): PaginationBlock {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };
