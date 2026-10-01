import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { describePostError, formatCheckedAt, RISK_LABELS, viewState, visibleRows } from '../src/lib/admin/riskCheckView';
import type { RiskCheckResponse } from '../src/lib/admin/types';

const base: RiskCheckResponse = {
  available: true,
  phoneNumber: '01712345678',
  riskLevel: 'LOW',
  riskScore: null,
  totalOrders: 25,
  successfulOrders: 22,
  returnedOrders: 3,
  successRatePercent: 88,
  checkedAt: '2026-09-20T10:00:00Z',
  checkedByUserIdentifier: 'admin',
  canTriggerFreshCheck: true,
  triggerBlockedReason: null,
  message: null,
};

describe('risk check view logic', () => {
  it('uses exactly the five documented labels', () => {
    expect(Object.values(RISK_LABELS)).toEqual(['LOW RISK', 'MEDIUM RISK', 'HIGH RISK', 'UNKNOWN', 'CHECK FAILED']);
  });

  it('omits fields the provider did not return (never 0 or a dash)', () => {
    const rows = visibleRows({ ...base, totalOrders: null, successfulOrders: null, returnedOrders: null, successRatePercent: null });
    expect(rows.map((r) => r.label)).toEqual(['Phone']);
  });

  it('shows the success rate with a percent sign and omits the score when null', () => {
    const rows = visibleRows(base);
    expect(rows.find((r) => r.label === 'Success Rate')?.value).toBe('88%');
    expect(rows.find((r) => r.label === 'Risk Score')).toBeUndefined();
  });

  it('keys never-checked off available:false only', () => {
    expect(viewState({ ...base, available: false, riskLevel: 'UNKNOWN' })).toBe('never-checked');
    expect(viewState({ ...base, riskLevel: 'UNKNOWN', totalOrders: null })).toBe('no-history');
    expect(viewState({ ...base, riskLevel: 'CHECK_FAILED' })).toBe('check-failed');
    expect(viewState(base)).toBe('result');
  });

  it('formats dates as DD MMM YYYY with fixed month names', () => {
    expect(formatCheckedAt('2026-09-20T10:00:00')).toBe('20 Sep 2026');
    expect(formatCheckedAt(null)).toBeNull();
  });

  it('maps POST errors', () => {
    expect(describePostError({ status: 409, message: 'nope' })).toMatchObject({ message: 'nope', refetch: true });
    expect(describePostError({ status: 429, retryAfter: 42 })).toMatchObject({ cooldownSec: 42 });
    expect(describePostError({ status: 403 }).hideButton).toBe(true);
    expect(describePostError({ status: 422, message: '' }).message).toContain('could not be checked');
    expect(describePostError({ status: 503, message: '' }).message).toBe('Risk check is not configured.');
    expect(describePostError({ status: 0, code: 'NETWORK_ERROR' }).message).toContain('connection');
  });

  it('keeps forbidden wording out of the section sources', () => {
    const files = [
      'src/components/admin/orders/CustomerRiskSection.tsx',
      'src/components/admin/orders/RiskLevelBadge.tsx',
      'src/lib/admin/riskCheckView.ts',
    ];
    for (const f of files) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/fraud|criminal|blacklist|scam|suspect/i);
    }
  });

  it('never references the provider from the frontend source', () => {
    for (const f of ['src/components/admin/orders/CustomerRiskSection.tsx', 'src/lib/admin/riskCheckView.ts']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/BD_COURIER|bdcourier/i);
    }
  });
});
