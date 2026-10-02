'use client';

import { createContext, useContext } from 'react';
import type { ReportConfig } from '@/lib/admin/reports';

/** The shared range state (kept in the URL by the frame) and config, read by every report page. */
export type ReportContextValue = {
  config: ReportConfig;
  from: string;
  to: string;
  granularity: 'day' | 'week' | 'month';
  page: number;
  /** `from=…&to=…` for every report request. */
  rangeQuery: string;
  setPage: (page: number) => void;
};

export const ReportContext = createContext<ReportContextValue | null>(null);

export function useReportContext(): ReportContextValue {
  const ctx = useContext(ReportContext);
  if (!ctx) throw new Error('useReportContext must be used inside the reports layout.');
  return ctx;
}
