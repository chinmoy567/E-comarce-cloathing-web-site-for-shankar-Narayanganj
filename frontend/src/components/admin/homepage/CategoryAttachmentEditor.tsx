'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPut, ApiClientError } from '@/lib/apiClient';
import type { CmsCategoryLookup } from '@/lib/admin/types';
import { Button } from '@/components/admin/Button';
import { useCategoryLookup } from './useCategoryLookup';

export type AttachmentTarget = { kind: 'section' | 'campaign'; id: string };

function basePath(target: AttachmentTarget): string {
  return target.kind === 'section' ? `/api/admin/homepage/sections/${target.id}` : `/api/admin/campaigns/${target.id}`;
}

const SMALL_BUTTON = 'flex h-12 w-12 items-center justify-center rounded-lg border border-border disabled:opacity-40';

/** Ordered category attachment: one `PUT` with the whole list (atomic, §13.6a). */
export function CategoryAttachmentEditor({ target }: { target: AttachmentTarget }) {
  const { categories, failed } = useCategoryLookup();
  const [selected, setSelected] = useState<CmsCategoryLookup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    apiGet<CmsCategoryLookup[]>(`${basePath(target)}/categories`)
      .then((list) => {
        setSelected(list);
        setLoaded(true);
      })
      .catch((err: unknown) => setMessage({ tone: 'error', text: err instanceof ApiClientError ? err.message : 'Could not load categories.' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the target identity changes
  }, [target.id, target.kind]);

  const selectedIds = new Set(selected.map((c) => c.id));
  const available = categories.filter((c) => !selectedIds.has(c.id));

  function move(index: number, direction: -1 | 1) {
    const next = [...selected];
    const [item] = next.splice(index, 1);
    next.splice(index + direction, 0, item!);
    setSelected(next);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await apiPut(`${basePath(target)}/categories`, { categoryIds: selected.map((c) => c.id) });
      setMessage({ tone: 'ok', text: 'Categories saved.' });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiClientError ? err.message : 'Could not save categories.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset className="mb-lg rounded-lg border border-border p-lg" disabled={saving}>
      <legend className="px-xs text-sm font-semibold">Categories</legend>

      {!loaded && !message && <p className="text-sm text-text-secondary">Loading…</p>}
      {failed && <p role="alert" className="text-sm text-error">Could not load the category list.</p>}

      <label htmlFor={`add-category-${target.id}`} className="mb-sm block text-xs font-semibold">
        Add a category
      </label>
      <select
        id={`add-category-${target.id}`}
        value=""
        onChange={(e) => {
          const found = categories.find((c) => c.id === e.target.value);
          if (found) setSelected((prev) => [...prev, found]);
        }}
        className="mb-md h-11 w-full rounded-lg border border-border bg-background px-md text-base"
      >
        <option value="">Select…</option>
        {available.map((category) => (
          <option key={category.id} value={category.id}>
            {category.parentId ? '— ' : ''}
            {category.name}
          </option>
        ))}
      </select>

      <p className="mb-xs text-xs font-semibold">Selected (in display order)</p>
      {selected.length === 0 ? (
        <p className="text-sm text-text-secondary">None selected.</p>
      ) : (
        <ul className="mb-md flex flex-col gap-sm">
          {selected.map((category, index) => (
            <li key={category.id} className="flex items-center justify-between gap-sm rounded-lg border border-border p-sm">
              <span className="text-sm">{category.name}</span>
              <span className="flex gap-xs">
                <button type="button" aria-label={`Move ${category.name} up`} disabled={index === 0} onClick={() => move(index, -1)} className={SMALL_BUTTON}>
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${category.name} down`}
                  disabled={index === selected.length - 1}
                  onClick={() => move(index, 1)}
                  className={SMALL_BUTTON}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${category.name}`}
                  onClick={() => setSelected((prev) => prev.filter((c) => c.id !== category.id))}
                  className={SMALL_BUTTON}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mb-sm text-sm ${message.tone === 'error' ? 'text-error' : 'text-accent'}`}>
          {message.text}
        </p>
      )}
      <Button type="button" variant="secondary" loading={saving} onClick={save} disabled={!loaded}>
        Save categories
      </Button>
    </fieldset>
  );
}
