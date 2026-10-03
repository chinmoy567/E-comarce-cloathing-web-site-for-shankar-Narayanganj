'use client';

import { formatReportDateTime } from '@/lib/admin/reportsView';
import type { ReportMeta, ReportName } from '@/lib/admin/reports';
import { ExportButton } from './ExportButton';
import { useReportContext } from './ReportContext';

/** Title, the freshness line (so a stale rollup is visibly stale) and the export control(s). */
export function ReportHeader({
  title,
  meta,
  exports,
}: {
  title: string;
  meta?: ReportMeta;
  exports?: Array<{ report: ReportName; label?: string }>;
}) {
  const { config, from, to } = useReportContext();
  return (
    <div className="mb-md flex flex-col gap-md md:flex-row md:items-start md:justify-between">
      <div>
        <h2 className="text-lg font-bold md:text-xl">{title}</h2>
        {meta && (
          <p className="mt-xs text-xs text-text-secondary">
            Computed {formatReportDateTime(meta.computedAt, config.timezone)}
            {meta.rollupRefreshedAt && <> · Trend data refreshed {formatReportDateTime(meta.rollupRefreshedAt, config.timezone)}</>}
          </p>
        )}
      </div>
      {exports && exports.length > 0 && (
        <div className="flex flex-col gap-sm md:flex-row md:flex-wrap md:justify-end">
          {exports.map((e) => (
            <ExportButton key={`${e.report}-${from}-${to}`} report={e.report} from={from} to={to} {...(e.label ? { label: e.label } : {})} />
          ))}
        </div>
      )}
    </div>
  );
}
