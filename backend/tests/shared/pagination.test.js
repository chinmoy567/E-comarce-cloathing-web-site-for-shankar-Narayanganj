import { describe, expect, it } from 'vitest';
import { buildPagination, paginationQuerySchema, toRange } from '../../src/lib/pagination.ts';
describe('pagination helper (11-security-hardening §11.4)', () => {
    it('applies defaults when the query is empty', () => {
        const parsed = paginationQuerySchema.parse({});
        expect(parsed).toEqual({ page: 1, pageSize: 20 });
    });
    it('rejects a pageSize above the maximum', () => {
        expect(paginationQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    });
    it('rejects a pageSize below the minimum and a page below 1', () => {
        expect(paginationQuerySchema.safeParse({ pageSize: 0 }).success).toBe(false);
        expect(paginationQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    });
    it('converts a page to inclusive Supabase range bounds', () => {
        expect(toRange({ page: 1, pageSize: 20 })).toEqual({ from: 0, to: 19 });
        expect(toRange({ page: 3, pageSize: 10 })).toEqual({ from: 20, to: 29 });
    });
    it('builds the pagination block', () => {
        expect(buildPagination({ page: 2, pageSize: 20 }, 45)).toEqual({
            page: 2,
            pageSize: 20,
            total: 45,
            totalPages: 3,
        });
        expect(buildPagination({ page: 1, pageSize: 20 }, 0).totalPages).toBe(0);
    });
});
