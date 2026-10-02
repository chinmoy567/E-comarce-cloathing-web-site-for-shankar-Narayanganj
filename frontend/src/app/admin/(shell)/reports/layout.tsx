'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { ReportContext } from '@/components/admin/reports/ReportContext';
import { ReportRangeSelector, type RangeValue } from '@/components/admin/reports/ReportRangeSelector';
import { ReportBoundary } from '@/components/admin/reports/primitives';
import { useAdminSession } from '@/lib/admin/session';
import { useReportConfig } from '@/lib/admin/reports';
import { buildQuery, isIsoDate, presetRange, validateRange } from '@/lib/admin/reportsView';

const TABS = [
  { href: '/admin/reports/sales', label: 'Sales' },
  { href: '/admin/reports/orders', label: 'Orders' },
  { href: '/admin/reports/payments', label: 'Payments' },
  { href: '/admin/reports/products', label: 'Products' },
  { href: '/admin/reports/customers', label: 'Customers' },
  { href: '/admin/reports/shipments', label: 'Shipments' },
  { href: '/admin/reports/coupons', label: 'Coupons' },
];

const GRANULARITIES = ['day', 'week', 'month'] as const;

/**
 * Shared reports frame (spec 20 §Pages and access). The range lives in the URL query string so a
 * refresh, back/forward or a shared link restores the view and the tabs preserve it. Access is
 * enforced by the backend (`analytics.view`); a 403 on the config call shows the access state and
 * no report content renders. The nav entry being hidden is only a convenience.
 */
function ReportsFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { hasPermission } = useAdminSession();
  const { state, reload } = useReportConfig();
  const tabRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  const onTabKey = (e: KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    tabRefs.current[(index + delta + TABS.length) % TABS.length]?.focus();
  };

  return (
    <div>
      <h1 className="mb-md text-xl font-bold md:text-[28px]">Reports</h1>
      <ReportBoundary state={state} reload={reload} skeletonRows={2}>
        {(config) => {
          if (!hasPermission('analytics.view')) {
            return (
              <p role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg font-medium text-error">
                You do not have access to reports.
              </p>
            );
          }

          const fallback = presetRange('30d', config.timezone);
          const rawFrom = search.get('from') ?? '';
          const rawTo = search.get('to') ?? '';
          const valid = isIsoDate(rawFrom) && isIsoDate(rawTo) && validateRange(rawFrom, rawTo, config.maxRangeDays) === null;
          const from = valid ? rawFrom : fallback.from;
          const to = valid ? rawTo : fallback.to;
          const g = search.get('granularity');
          const granularity = (GRANULARITIES as readonly string[]).includes(g ?? '') ? (g as RangeValue['granularity']) : 'day';
          const page = Math.max(1, Number.parseInt(search.get('page') ?? '1', 10) || 1);

          const withParams = (path: string, extra: Record<string, string | number | undefined>) =>
            `${path}?${buildQuery({ from, to, granularity: granularity === 'day' ? undefined : granularity, ...extra })}`;

          const apply = (next: RangeValue) =>
            router.replace(withParams(pathname, { from: next.from, to: next.to, granularity: next.granularity === 'day' ? undefined : next.granularity }));

          return (
            <ReportContext.Provider
              value={{
                config,
                from,
                to,
                granularity,
                page,
                rangeQuery: buildQuery({ from, to }),
                setPage: (p) => router.replace(withParams(pathname, { page: p > 1 ? p : undefined })),
              }}
            >
              <nav aria-label="Report groups" className="-mx-lg mb-md border-b border-border px-lg md:mx-0 md:px-0">
                <ul role="tablist" className="flex overflow-x-auto">
                  {TABS.map((tab, i) => {
                    const active = pathname === tab.href;
                    return (
                      <li key={tab.href} role="presentation">
                        <Link
                          ref={(el) => {
                            tabRefs.current[i] = el;
                          }}
                          role="tab"
                          aria-selected={active}
                          {...(active ? { 'aria-current': 'page' as const } : {})}
                          href={withParams(tab.href, {})}
                          onKeyDown={(e) => onTabKey(e, i)}
                          className={`block min-h-[44px] whitespace-nowrap px-md py-md text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                            active ? 'border-b-2 border-primary text-primary' : 'text-text-secondary hover:text-primary'
                          }`}
                        >
                          {tab.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              <ReportRangeSelector
                value={{ from, to, granularity }}
                config={config}
                showGranularity={pathname === '/admin/reports/sales'}
                onChange={apply}
              />
              {children}
            </ReportContext.Provider>
          );
        }}
      </ReportBoundary>
    </div>
  );
}

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<p className="text-text-secondary">Loading reports…</p>}>
      <ReportsFrame>{children}</ReportsFrame>
    </Suspense>
  );
}
