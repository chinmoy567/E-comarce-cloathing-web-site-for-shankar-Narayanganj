'use client';

import type { ReactNode } from 'react';

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Numeric columns are right-aligned. */
  numeric?: boolean;
  /** The allowlisted `sort` key sent to the API. Only columns the backend can sort carry one. */
  sortKey?: string;
};

export type SortState = { sort: string; order: 'asc' | 'desc' };

/**
 * A real `<table>` from `md`; one stacked card per row (label/value pairs in a `dl`) below it.
 * Both render the same rows, so the data is identical at every width. Sorting is delegated to the API
 * through `onSort` — the table never reorders rows itself.
 */
export function ReportTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  emptyText = 'No data for this period.',
  sort,
  onSort,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyText?: string;
  sort?: SortState;
  onSort?: (sortKey: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="rounded-lg border border-border bg-surface p-lg text-text-secondary">{emptyText}</p>;
  }
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="mb-sm text-left text-sm font-semibold">{caption}</caption>
          <thead>
            <tr className="border-b border-border">
              {columns.map((c) => {
                const active = sort && c.sortKey === sort.sort;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={`px-md py-sm font-semibold text-text-secondary ${c.numeric ? 'text-right' : 'text-left'}`}
                  >
                    {c.sortKey && onSort ? (
                      <button
                        type="button"
                        onClick={() => onSort(c.sortKey!)}
                        className="min-h-[44px] font-semibold hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {c.header}
                        {active ? (sort.order === 'asc' ? ' ↑' : ' ↓') : ''}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-border">
                {columns.map((c) => (
                  <td key={c.key} className={`px-md py-sm ${c.numeric ? 'text-right tabular-nums' : 'text-left'}`}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label={caption} className="space-y-sm md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="rounded-lg border border-border bg-background p-md">
            <dl className="space-y-xs">
              {columns.map((c) => (
                <div key={c.key} className="flex justify-between gap-md text-sm">
                  <dt className="text-text-secondary">{c.header}</dt>
                  <dd className="text-right font-medium">{c.render(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
