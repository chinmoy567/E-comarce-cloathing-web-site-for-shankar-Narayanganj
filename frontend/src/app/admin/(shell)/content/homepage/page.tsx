'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiList, apiPatch, apiPost, ApiClientError } from '@/lib/apiClient';
import type { HomepageSectionAdminResponse } from '@/lib/admin/types';
import { Button } from '@/components/admin/Button';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; items: HomepageSectionAdminResponse[] };

const DISPLAY_STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-accent/10 text-accent',
  DRAFT: 'bg-text-tertiary/10 text-text-secondary',
  SCHEDULED: 'bg-primary/10 text-primary',
  DISABLED: 'bg-text-tertiary/10 text-text-secondary',
  EXPIRED: 'bg-error/10 text-error',
};

const SECTION_TYPE_LABEL: Record<string, string> = {
  HERO: 'Hero',
  CATEGORY_GRID: 'Category Grid',
  PRODUCT_CAROUSEL: 'Product Carousel',
  CAMPAIGN_BANNER: 'Campaign Banner',
  PROMO_BANNER: 'Promo Banner',
  CUSTOM_CONTENT: 'Custom Content',
};

/**
 * Admin Homepage Builder (13-homepage-cms §13.12, plan §6). Move Up/Down
 * issues exactly one full-list reorder request — never one request per row
 * (§13.12).
 */
export default function HomepageSectionsPage() {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setState({ phase: 'loading' });
    apiList<HomepageSectionAdminResponse>('/api/admin/homepage/sections?pageSize=100')
      .then(({ data }) => setState({ phase: 'loaded', items: [...data].sort((a, b) => a.displayOrder - b.displayOrder) }))
      .catch((err: unknown) => {
        setState({ phase: 'error', message: err instanceof ApiClientError ? err.message : 'Something went wrong.' });
      });
  }

  useEffect(load, []);

  async function move(items: HomepageSectionAdminResponse[], index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    const reordered = [...items];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved!);

    setBusyId(items[index]!.id);
    try {
      await apiPost('/api/admin/homepage/sections/reorder', { sectionIds: reordered.map((s) => s.id) });
      setState({ phase: 'loaded', items: reordered });
    } catch (err) {
      setState({ phase: 'error', message: err instanceof ApiClientError ? err.message : 'Could not reorder sections.' });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleEnabled(section: HomepageSectionAdminResponse) {
    setBusyId(section.id);
    try {
      const nextStatus = section.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED';
      await apiPatch(`/api/admin/homepage/sections/${section.id}`, { status: nextStatus });
      load();
    } catch (err) {
      setState({ phase: 'error', message: err instanceof ApiClientError ? err.message : 'Could not update the section.' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-lg flex items-center justify-between gap-md">
        <h1 className="text-xl font-bold md:text-[28px]">Homepage</h1>
        <div className="flex gap-sm">
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

      {state.phase === 'loading' && <p className="text-text-secondary">Loading sections…</p>}

      {state.phase === 'error' && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load sections</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
        </div>
      )}

      {state.phase === 'loaded' && state.items.length === 0 && <p className="text-text-secondary">No sections yet.</p>}

      {state.phase === 'loaded' && state.items.length > 0 && (
        <ul className="flex flex-col gap-sm">
          {state.items.map((section, index) => (
            <li
              key={section.id}
              className="flex flex-col gap-sm rounded-lg border border-border bg-background p-lg sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold text-text-primary">
                  {index + 1}. {section.title || SECTION_TYPE_LABEL[section.sectionType]}
                </p>
                <p className="text-xs text-text-secondary">{SECTION_TYPE_LABEL[section.sectionType]}</p>
              </div>

              <div className="flex flex-wrap items-center gap-sm">
                <span
                  className={`rounded-lg px-sm py-xs text-xs font-semibold ${DISPLAY_STATUS_STYLE[section.displayStatus] ?? 'bg-text-tertiary/10 text-text-secondary'}`}
                >
                  {section.displayStatus}
                </span>

                <button
                  type="button"
                  aria-label="Move up"
                  disabled={busyId === section.id || index === 0}
                  onClick={() => move(state.items, index, -1)}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-border disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={busyId === section.id || index === state.items.length - 1}
                  onClick={() => move(state.items, index, 1)}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-border disabled:opacity-40"
                >
                  ↓
                </button>

                <Link href={`/admin/content/homepage/${section.id}`}>
                  <Button type="button" variant="secondary">
                    Edit
                  </Button>
                </Link>
                <Button type="button" variant="secondary" disabled={busyId === section.id} onClick={() => toggleEnabled(section)}>
                  {section.status === 'DISABLED' ? 'Enable' : 'Disable'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
