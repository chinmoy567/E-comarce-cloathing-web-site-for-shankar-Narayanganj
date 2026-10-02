'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/admin/Button';
import { barWidths, segmentWidths } from '@/lib/admin/reportsView';
import { isForbidden, reportErrorMessage, type ReportState } from '@/lib/admin/reports';

/** MetricCard, MetricCardRow, ReportBoundary, ReportPagination, BarList and ShareBar (spec 20). */

export function MetricCardRow({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul
      aria-label={label}
      className="-mx-lg mb-lg flex snap-x gap-md overflow-x-auto px-lg pb-xs md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 lg:grid-cols-4"
    >
      {children}
    </ul>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  href,
  attention,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  /** The only figure styled as needing attention (e.g. COD discrepancies). Text and a border, not colour alone. */
  attention?: boolean;
}) {
  const body = (
    <>
      <p className="text-xs font-semibold text-text-secondary">{label}</p>
      <p className="mt-xs text-lg font-bold text-text-primary md:text-2xl">{value}</p>
      {hint && <p className="mt-xs text-xs text-text-secondary">{hint}</p>}
      {href && <p className="mt-xs text-xs font-semibold text-primary underline">View orders</p>}
    </>
  );
  const cls = `block h-full rounded-lg border bg-background p-md ${attention ? 'border-2 border-warning' : 'border-border'}`;
  return (
    <li className="min-w-[60%] shrink-0 snap-start md:min-w-0">
      {href ? (
        <Link href={href} className={`${cls} hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary`}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="space-y-sm">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-16 rounded-lg bg-surface" />
      ))}
    </div>
  );
}

/**
 * Loading / error / empty wrapper used by every widget. Each widget loads independently so one slow
 * report never blanks the page. A 403 shows the access message with no retry and no data.
 */
export function ReportBoundary<T>({
  state,
  reload,
  isEmpty,
  emptyText = 'No data for this period.',
  skeletonRows,
  children,
}: {
  state: ReportState<T>;
  reload: () => void;
  isEmpty?: (data: T) => boolean;
  emptyText?: string;
  skeletonRows?: number;
  children: (data: T) => ReactNode;
}) {
  if (state.phase === 'loading') {
    return (
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading…</span>
        <Skeleton {...(skeletonRows ? { rows: skeletonRows } : {})} />
      </div>
    );
  }
  if (state.phase === 'error') {
    const forbidden = isForbidden(state.error);
    return (
      <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
        <p className="font-medium text-error">{forbidden ? 'You do not have access to reports.' : 'Could not load this report'}</p>
        {!forbidden && <p className="mt-xs text-sm text-text-secondary">{reportErrorMessage(state.error)}</p>}
        {!forbidden && (
          <Button type="button" variant="secondary" className="mt-md" onClick={reload}>
            Retry
          </Button>
        )}
      </div>
    );
  }
  if (isEmpty?.(state.data)) {
    return <p className="rounded-lg border border-border bg-surface p-lg text-text-secondary">{emptyText}</p>;
  }
  return <>{children(state.data)}</>;
}

export function ReportPagination({
  pagination,
  onPage,
}: {
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  onPage: (page: number) => void;
}) {
  if (pagination.totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-lg flex items-center justify-between gap-md">
      <Button type="button" variant="secondary" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>
        Previous
      </Button>
      <span className="text-sm text-text-secondary">
        Page {pagination.page} of {pagination.totalPages}
      </span>
      <Button type="button" variant="secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)}>
        Next
      </Button>
    </nav>
  );
}

export type BarItem = { label: string; count: number; href?: string };

/** Horizontal bars for a distribution. The count is always printed; the bar is geometry only. */
export function BarList({ items, caption }: { items: BarItem[]; caption: string }) {
  const widths = barWidths(items.map((i) => i.count));
  return (
    <ul aria-label={caption} className="mb-lg space-y-sm">
      {items.map((item, i) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-md text-sm">
            <span className="text-text-primary">
              {item.href ? (
                <Link href={item.href} className="underline hover:text-primary">
                  {item.label}
                </Link>
              ) : (
                item.label
              )}
            </span>
            <span className="font-semibold">{item.count.toLocaleString('en-BD')}</span>
          </div>
          <div className="mt-xs h-2 rounded bg-border/50" aria-hidden="true">
            <div className="h-2 rounded" style={{ width: `${widths[i]}%`, backgroundColor: '#1F2937' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const SHARE_COLORS = ['#1F2937', '#9CA3AF'] as const;

/** Two-segment proportion bar with a legend that carries the labels and counts (colour is never the only cue). */
export function ShareBar({ segments, caption }: { segments: [BarItem, BarItem]; caption: string }) {
  const widths = segmentWidths(segments.map((s) => s.count));
  return (
    <div className="mb-lg">
      <div
        role="img"
        aria-label={`${caption}: ${segments.map((s) => `${s.label} ${s.count}`).join(', ')}`}
        className="flex h-4 gap-[2px] overflow-hidden rounded"
      >
        {segments.map((s, i) => (
          <div key={s.label} style={{ width: `${widths[i]}%`, backgroundColor: SHARE_COLORS[i] }} />
        ))}
      </div>
      <ul className="mt-sm flex flex-wrap gap-lg text-sm">
        {segments.map((s, i) => (
          <li key={s.label} className="flex items-center gap-sm">
            <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: SHARE_COLORS[i] }} />
            <span>
              {s.label}: <strong>{s.count.toLocaleString('en-BD')}</strong>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
