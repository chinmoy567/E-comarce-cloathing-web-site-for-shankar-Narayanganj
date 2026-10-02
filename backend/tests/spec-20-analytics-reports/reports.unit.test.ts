import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';

/**
 * Pure (no database) checks for spec 20: the shared range contract, the sort allowlists, CSV
 * escaping and the rollup's default window.
 */
describe('reports validation and helpers (spec 20)', () => {
  let v: typeof import('../../src/validation/reports.validation.js');
  let exportSvc: typeof import('../../src/services/reportExport.service.js');
  let rollup: typeof import('../../src/services/reportRollup.service.js');

  beforeAll(async () => {
    applyTestEnv();
    resetEnvCache();
    v = await import('../../src/validation/reports.validation.js');
    exportSvc = await import('../../src/services/reportExport.service.js');
    rollup = await import('../../src/services/reportRollup.service.js');
  });

  it('counts range days inclusively', () => {
    expect(v.rangeDays('2026-06-01', '2026-06-01')).toBe(1);
    expect(v.rangeDays('2026-06-01', '2026-06-30')).toBe(30);
  });

  it('requires from and to, and enforces from <= to and the span cap', () => {
    expect(v.reportRangeSchema.safeParse({}).success).toBe(false);
    expect(v.reportRangeSchema.safeParse({ from: '2026-06-01' }).success).toBe(false);
    expect(v.reportRangeSchema.safeParse({ from: '2026-06-02', to: '2026-06-01' }).success).toBe(false);
    expect(v.reportRangeSchema.safeParse({ from: '2026-06-01', to: '2026-06-30' }).success).toBe(true);
    const tooLong = v.reportRangeSchema.safeParse({ from: '2025-01-01', to: '2026-06-30' });
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect((tooLong.error.issues[0] as any).params).toEqual({ appCode: 'RANGE_TOO_LARGE' });
    }
  });

  it('rejects impossible calendar dates and unknown keys', () => {
    expect(v.reportRangeSchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success).toBe(false);
    expect(v.reportRangeSchema.safeParse({ from: '2026-06-01', to: '2026-06-30', x: 1 }).success).toBe(false);
  });

  it('only accepts allowlisted sort keys and applies defaults', () => {
    const ok = v.salesByProductQuerySchema.parse({ from: '2026-06-01', to: '2026-06-30' });
    expect(ok).toMatchObject({ sort: 'unitsSold', order: 'desc', page: 1, pageSize: 20 });
    expect(v.salesByProductQuerySchema.safeParse({ from: '2026-06-01', to: '2026-06-30', sort: 'name' }).success).toBe(false);
    expect(v.salesByCategoryQuerySchema.safeParse({ from: '2026-06-01', to: '2026-06-30', sort: 'orderCount' }).success).toBe(false);
    expect(v.productsStockQuerySchema.safeParse({ sort: 'unitsSold' }).success).toBe(false);
  });

  it('escapes CSV cells and neutralises formula prefixes', () => {
    expect(exportSvc.csvCell('plain')).toBe('plain');
    expect(exportSvc.csvCell('a,"b"')).toBe('"a,""b"""');
    expect(exportSvc.csvCell('=1+1')).toBe("'=1+1");
    expect(exportSvc.csvCell('@cmd')).toBe("'@cmd");
    expect(exportSvc.csvCell(12.5)).toBe('12.5');
    expect(exportSvc.csvCell(-3)).toBe('-3'); // a number is not a formula
    expect(exportSvc.toCsv([{ headers: ['a', 'b'], rows: [[1, null]] }])).toBe('a,b\r\n1,\r\n');
  });

  it('defaults the rollup window to 35 Dhaka days ending today', () => {
    const r = rollup.defaultRefreshRange();
    expect(v.rangeDays(r.from, r.to)).toBe(35);
  });
});
