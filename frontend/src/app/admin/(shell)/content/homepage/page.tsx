'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiList, apiPatch, apiPost, ApiClientError } from '@/lib/apiClient';
import type { HomepageSectionAdminResponse } from '@/lib/admin/types';
import { Button } from '@/components/admin/Button';
import { SectionRow, SECTION_TYPE_LABEL } from '@/components/admin/homepage/SectionRow';
import { ConfirmDialog } from '@/components/admin/homepage/ConfirmDialog';

type State =
  | { phase: 'loading' }
  | { phase: 'forbidden' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; items: HomepageSectionAdminResponse[] };

function sectionName(section: HomepageSectionAdminResponse): string {
  return section.title || SECTION_TYPE_LABEL[section.sectionType] || section.sectionType;
}

/**
 * Admin Homepage Builder (13-homepage-cms §13.12). Move Up/Down issues exactly
 * one full-list reorder request, never one per row. While any request is in
 * flight every control is disabled; a failed reorder restores the previous order.
 */
export default function HomepageSectionsPage() {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [pendingDelete, setPendingDelete] = useState<HomepageSectionAdminResponse | null>(null);

  const load = useCallback(() => {
    setState({ phase: 'loading' });
    apiList<HomepageSectionAdminResponse>('/api/admin/homepage/sections?pageSize=100')
      .then(({ data }) => setState({ phase: 'loaded', items: [...data].sort((a, b) => a.displayOrder - b.displayOrder) }))
      .catch((err: unknown) => {
        if (err instanceof ApiClientError && err.status === 403) {
          setState({ phase: 'forbidden' });
          return;
        }
        setState({ phase: 'error', message: err instanceof ApiClientError ? err.message : 'Something went wrong.' });
      });
  }, []);

  useEffect(load, [load]);

  function describe(err: unknown, fallback: string): string {
    if (err instanceof ApiClientError && err.status === 403) return 'You do not have permission to change the homepage.';
    return err instanceof ApiClientError ? err.message : fallback;
  }

  async function move(items: HomepageSectionAdminResponse[], index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (busy || targetIndex < 0 || targetIndex >= items.length) return;

    const previous = items;
    const reordered = [...items];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved!);

    setBusy(true);
    setActionError(null);
    setState({ phase: 'loaded', items: reordered });
    try {
      await apiPost('/api/admin/homepage/sections/reorder', { sectionIds: reordered.map((s) => s.id) });
      setAnnouncement(`${sectionName(moved!)} moved to position ${targetIndex + 1}.`);
    } catch (err) {
      setState({ phase: 'loaded', items: previous });
      setActionError(describe(err, 'Could not reorder sections.'));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(section: HomepageSectionAdminResponse) {
    if (busy) return;
    const next = section.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    setBusy(true);
    setActionError(null);
    try {
      await apiPatch(`/api/admin/homepage/sections/${section.id}`, { status: next });
      const verb = section.status === 'DRAFT' ? 'published' : next === 'ACTIVE' ? 'enabled' : 'disabled';
      setAnnouncement(`${sectionName(section)} ${verb}.`);
      const { data } = await apiList<HomepageSectionAdminResponse>('/api/admin/homepage/sections?pageSize=100');
      setState({ phase: 'loaded', items: [...data].sort((a, b) => a.displayOrder - b.displayOrder) });
    } catch (err) {
      setActionError(describe(err, 'Could not update the section.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || busy) return;
    const target = pendingDelete;
    setBusy(true);
    setActionError(null);
    try {
      await apiDelete(`/api/admin/homepage/sections/${target.id}`);
      setState((prev) => (prev.phase === 'loaded' ? { phase: 'loaded', items: prev.items.filter((s) => s.id !== target.id) } : prev));
      setAnnouncement(`${sectionName(target)} deleted.`);
    } catch (err) {
      setActionError(describe(err, 'Could not delete the section.'));
    } finally {
      setPendingDelete(null);
      setBusy(false);
    }
  }

  if (state.phase === 'forbidden') {
    return (
      <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
        <p className="font-medium text-error">You do not have access to the Homepage Builder.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold md:text-[28px]">Homepage</h1>
        <div className="flex flex-col gap-sm sm:flex-row">
          <Link href="/admin/content/homepage/preview">
            <Button type="button" variant="secondary">
              Preview
            </Button>
          </Link>
          <Link href="/admin/content/homepage/new">
            <Button type="button">Add Section</Button>
          </Link>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {actionError && (
        <div role="alert" className="mb-md rounded-lg border border-error/30 bg-error/5 p-md">
          <p className="text-sm text-error">{actionError}</p>
        </div>
      )}

      {state.phase === 'loading' && <p className="text-text-secondary">Loading sections…</p>}

      {state.phase === 'error' && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load sections</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
          <div className="mt-md">
            <Button type="button" variant="secondary" onClick={load}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {state.phase === 'loaded' && state.items.length === 0 && (
        <div>
          <p className="mb-md text-text-secondary">No sections yet.</p>
          <Link href="/admin/content/homepage/new">
            <Button type="button">Add Section</Button>
          </Link>
        </div>
      )}

      {state.phase === 'loaded' && state.items.length > 0 && (
        <ul className="flex flex-col gap-sm">
          {state.items.map((section, index) => (
            <SectionRow
              key={section.id}
              section={section}
              index={index}
              count={state.items.length}
              busy={busy}
              onMove={(direction) => void move(state.items, index, direction)}
              onToggle={() => void changeStatus(section)}
              onDelete={() => setPendingDelete(section)}
            />
          ))}
        </ul>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this section?"
          message="Delete this section? This cannot be undone."
          confirmLabel="Delete"
          busy={busy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
