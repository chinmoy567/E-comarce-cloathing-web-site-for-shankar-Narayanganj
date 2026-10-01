'use client';

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiGet, apiPost, ApiClientError } from '@/lib/apiClient';
import { Button } from '@/components/admin/Button';
import type { RiskCheckResponse } from '@/lib/admin/types';
import { describePostError, formatCheckedAt, viewState, visibleRows } from '@/lib/admin/riskCheckView';
import { RiskLevelBadge } from './RiskLevelBadge';

/**
 * Customer Risk section (spec 16, PRD 09 §7.7).
 *
 * Loads the CACHED result with GET on mount and never triggers the provider. The only thing that
 * does is the button's POST, an explicit Admin/Manager action. Whether a check is allowed comes
 * from the response (`canTriggerFreshCheck` / `triggerBlockedReason`); this component does not
 * re-implement the order-status rule. Advisory only: it never alters or blocks the order.
 */

const FORBIDDEN_MESSAGE = 'You do not have permission to view customer risk.';

type Props = {
  orderNumber: string;
  canCheck: boolean;
};

class SectionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) {
      return (
        <section className="rounded-lg border border-border bg-surface p-lg">
          <h2 className="text-lg font-bold">Customer Risk</h2>
          <p role="alert" className="mt-md text-sm text-error">
            Customer risk could not be displayed. The rest of the order is unaffected.
          </p>
        </section>
      );
    }
    return this.props.children;
  }
}

function Inner({ orderNumber, canCheck }: Props) {
  const [data, setData] = useState<RiskCheckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [buttonHidden, setButtonHidden] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inFlight = useRef(false);

  const path = `/api/admin/orders/${encodeURIComponent(orderNumber)}/risk-check`;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await apiGet<RiskCheckResponse>(path));
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 403) setForbidden(true);
      else setLoadError(err instanceof ApiClientError && err.message ? err.message : 'Customer risk could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function runCheck() {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setActionError(null);
    setNotice(null);
    try {
      setData(await apiPost<RiskCheckResponse>(path));
      setNotice('Customer risk updated.');
    } catch (err) {
      const e = describePostError(
        err instanceof ApiClientError
          ? err
          : { code: 'NETWORK_ERROR', status: 0, message: '' },
      );
      setActionError(e.message);
      if (e.hideButton) setButtonHidden(true);
      if (e.cooldownSec) setCooldown(e.cooldownSec);
      if (e.refetch) void apiGet<RiskCheckResponse>(path).then(setData).catch(() => undefined);
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }

  const heading = <h2 className="text-lg font-bold">Customer Risk</h2>;

  if (forbidden) {
    return (
      <section className="rounded-lg border border-border bg-surface p-lg">
        {heading}
        <p className="mt-md text-sm text-text-secondary">{FORBIDDEN_MESSAGE}</p>
      </section>
    );
  }

  if (loading && !data) {
    return (
      <section aria-busy="true" className="min-h-[140px] rounded-lg border border-border bg-surface p-lg">
        {heading}
        <p className="mt-md text-sm text-text-secondary">Loading customer risk…</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="rounded-lg border border-border bg-surface p-lg">
        {heading}
        <p role="alert" className="mt-md text-sm text-error">{loadError}</p>
        <div className="mt-md">
          <Button variant="secondary" onClick={() => void load()}>
            Reload
          </Button>
        </div>
      </section>
    );
  }

  const state = viewState(data);
  const checkedAt = formatCheckedAt(data.checkedAt);
  const blocked = !data.canTriggerFreshCheck;
  const buttonLabel = state === 'check-failed' ? 'Try Again' : 'Check Customer Risk';
  const helperId = 'risk-check-helper';

  return (
    <section className="rounded-lg border border-border bg-surface p-lg">
      {heading}

      {state === 'never-checked' && (
        <p className="mt-md text-sm text-text-secondary">{data.message}</p>
      )}

      {state !== 'never-checked' && (
        <div className="mt-md space-y-md">
          <RiskLevelBadge riskLevel={data.riskLevel} />

          {data.message && (
            <p role="status" className="text-sm text-text-secondary">
              {data.message}
            </p>
          )}

          {(state === 'result' || state === 'no-history') && (
            <dl className="grid gap-md md:grid-cols-2">
              {visibleRows(data).map((row) => (
                <div key={row.label}>
                  <dt className="text-xs font-semibold uppercase text-text-secondary">{row.label}</dt>
                  <dd className="mt-xs text-sm font-medium">{row.value}</dd>
                </div>
              ))}
              {checkedAt && (
                <div>
                  <dt className="text-xs font-semibold uppercase text-text-secondary">Last Checked</dt>
                  <dd className="mt-xs text-sm font-medium">
                    {checkedAt}
                    {data.checkedByUserIdentifier && (
                      <span className="block text-xs font-normal text-text-secondary">by {data.checkedByUserIdentifier}</span>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}

      {actionError && (
        <p role="alert" className="mt-md text-sm text-error">
          {actionError}
        </p>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {notice}
      </p>

      {canCheck && !buttonHidden && (
        <div className="mt-lg space-y-xs">
          <Button
            variant="primary"
            className="!h-12 md:!h-11"
            onClick={() => void runCheck()}
            loading={checking}
            disabled={blocked || cooldown > 0}
            aria-describedby={blocked ? helperId : undefined}
            aria-busy={checking}
          >
            {buttonLabel}
          </Button>
          {blocked && data.triggerBlockedReason && (
            <p id={helperId} className="text-xs text-text-secondary">
              {data.triggerBlockedReason}
            </p>
          )}
          {!blocked && <p className="text-xs text-text-secondary">Uses the stored result until you run a new check.</p>}
        </div>
      )}
    </section>
  );
}

export function CustomerRiskSection(props: Props) {
  return (
    <SectionBoundary>
      <Inner {...props} />
    </SectionBoundary>
  );
}
