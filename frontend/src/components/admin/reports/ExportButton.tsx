'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/admin/Button';
import { ApiClientError, apiGet, apiPost } from '@/lib/apiClient';
import {
  EXPORT_POLL_INTERVAL_MS,
  nextPollAction,
  type ExportPhase,
} from '@/lib/admin/reportsView';
import { REPORTS_BASE, reportErrorMessage, type ExportStatus, type ReportName } from '@/lib/admin/reports';

/**
 * Async CSV export (spec 20, §11.4). POST enqueues a job (202); the status is polled every 3 s up to
 * 5 minutes. Nothing else on the reports pages polls. The parent keys this component by range, so a
 * range change unmounts it and cancels the poll. One export per button at a time.
 */
export function ExportButton({ report, from, to, label = 'Export CSV' }: { report: ReportName; from: string; to: string; label?: string }) {
  const [phase, setPhase] = useState<ExportPhase>('idle');
  const [link, setLink] = useState<{ url: string; id: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const fail = useCallback((err: unknown) => {
    if (!alive.current) return;
    if (err instanceof ApiClientError && err.status === 404) {
      setPhase('gone');
      setMessage('That export is no longer available.');
    } else {
      setPhase('failed');
      setMessage(err instanceof Error ? reportErrorMessage(err) : 'The export failed.');
    }
  }, []);

  const poll = useCallback(
    (id: string, startedAt: number) => {
      apiGet<ExportStatus>(`${REPORTS_BASE}/exports/${id}`)
        .then((s) => {
          if (!alive.current) return;
          if (s.status === 'READY' && s.downloadUrl) {
            setLink({ url: s.downloadUrl, id });
            setPhase('ready');
          } else if (s.status === 'FAILED') {
            setPhase('failed');
            setMessage(s.errorMessage ?? 'The export failed.');
          } else if (nextPollAction(Date.now() - startedAt) === 'timeout') {
            setPhase('timeout');
            setMessage('This is taking longer than expected. Try again later.');
          } else {
            timer.current = setTimeout(() => poll(id, startedAt), EXPORT_POLL_INTERVAL_MS);
          }
        })
        .catch(fail);
    },
    [fail],
  );

  const start = () => {
    if (phase === 'starting' || phase === 'pending') return; // ignore double clicks
    setPhase('starting');
    setMessage(null);
    setLink(null);
    apiPost<{ id: string; status: string }>(`${REPORTS_BASE}/exports`, { report, from, to })
      .then(({ id }) => {
        if (!alive.current) return;
        setPhase('pending');
        poll(id, Date.now());
      })
      .catch(fail);
  };

  const refreshLink = () => {
    if (!link) return;
    apiGet<ExportStatus>(`${REPORTS_BASE}/exports/${link.id}`)
      .then((s) => alive.current && s.downloadUrl && setLink({ url: s.downloadUrl, id: link.id }))
      .catch(fail);
  };

  const busy = phase === 'starting' || phase === 'pending';

  return (
    <div className="flex flex-col gap-xs">
      {phase === 'ready' && link ? (
        <div className="flex flex-wrap items-center gap-sm">
          <a
            href={link.url}
            rel="noopener"
            className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary px-lg text-sm font-bold text-white hover:bg-primary-hover sm:w-auto"
          >
            Download CSV
          </a>
          <span className="text-xs text-text-secondary">This link expires shortly.</span>
          <button type="button" onClick={refreshLink} className="min-h-[44px] text-sm font-semibold text-primary underline">
            Get new link
          </button>
        </div>
      ) : (
        <Button type="button" variant="secondary" className="h-12" disabled={busy} aria-busy={busy} onClick={start}>
          {busy ? 'Preparing export…' : phase === 'failed' || phase === 'timeout' ? 'Retry export' : label}
        </Button>
      )}
      {message && (
        <p role="status" className="text-sm text-text-secondary">
          {message}
        </p>
      )}
    </div>
  );
}
