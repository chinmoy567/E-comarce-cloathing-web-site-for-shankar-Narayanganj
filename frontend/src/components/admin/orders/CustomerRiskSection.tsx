'use client';

import { useState } from 'react';
import { apiPost, ApiClientError } from '@/lib/apiClient';
import { Button } from '@/components/admin/Button';
import { RiskLevelBadge } from './RiskLevelBadge';

interface RiskCheckResult {
  phoneNumber: string;
  totalOrders: number | null;
  successfulOrders: number | null;
  returnedOrders: number | null;
  successRate: number | null;
  riskScore: number | null;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' | 'CHECK_FAILED';
  checkedAt: string;
  error?: {
    code: string;
    message: string;
  };
}

interface CustomerRiskSectionProps {
  orderId: string;
  orderStatus: string;
  canCheck: boolean;
  initialData?: RiskCheckResult | null;
}

export function CustomerRiskSection({
  orderId,
  orderStatus,
  canCheck,
  initialData,
}: CustomerRiskSectionProps) {
  const [data, setData] = useState<RiskCheckResult | null>(initialData || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isVisibleStatus = ['CONFIRMED', 'PROCESSING'].includes(orderStatus);

  if (!isVisibleStatus) {
    return null;
  }

  const handleCheck = async (forceRefresh: boolean = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiPost<{ success: boolean; data: RiskCheckResult }>(
        `/api/admin/orders/${orderId}/risk-check`,
        { forceRefresh }
      );
      if (result.success) {
        setData(result.data);
      } else {
        setError('Failed to check customer risk');
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message || 'Failed to check customer risk');
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-lg">
      <h2 className="mb-lg text-lg font-bold">Customer Risk Check</h2>

      {error && (
        <div className="mb-lg rounded-lg border border-error/30 bg-error/5 p-md">
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      {!data ? (
        <div className="flex flex-col gap-md">
          <p className="text-sm text-text-secondary">
            No risk check data available yet. Click "Check Risk" to evaluate this customer's delivery history.
          </p>
          {canCheck && (
            <Button
              onClick={() => handleCheck(false)}
              disabled={loading}
              loading={loading}
              variant="primary"
            >
              {loading ? 'Checking Risk…' : 'Check Risk'}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-lg">
          <div className="grid gap-lg sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs font-semibold text-text-secondary">PHONE</p>
              <p className="mt-xs text-sm font-medium">{data.phoneNumber}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-secondary">TOTAL ORDERS</p>
              <p className="mt-xs text-sm font-medium">
                {data.totalOrders !== null ? data.totalOrders : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-secondary">DELIVERED</p>
              <p className="mt-xs text-sm font-medium">
                {data.successfulOrders !== null ? data.successfulOrders : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-secondary">RETURNED</p>
              <p className="mt-xs text-sm font-medium">
                {data.returnedOrders !== null ? data.returnedOrders : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-secondary">SUCCESS RATE</p>
              <p className="mt-xs text-sm font-medium">
                {data.successRate !== null ? `${data.successRate}%` : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-secondary">RISK SCORE</p>
              <p className="mt-xs text-sm font-medium">
                {data.riskScore !== null ? data.riskScore : '—'}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-md sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-text-secondary">RISK LEVEL</p>
              <div className="mt-xs">
                <RiskLevelBadge
                  riskLevel={data.riskLevel}
                  riskScore={data.riskScore}
                />
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-text-secondary">LAST CHECKED</p>
              <p className="mt-xs text-sm font-medium">{formatDate(data.checkedAt)}</p>
            </div>
          </div>

          {canCheck && (
            <div className="flex gap-md pt-lg">
              <Button
                onClick={() => handleCheck(true)}
                disabled={loading}
                loading={loading}
                variant="secondary"
              >
                {loading ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
