'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiList, apiPut, ApiClientError } from '@/lib/apiClient';
import type { CmsProductLookup } from '@/lib/admin/types';
import { Button } from '@/components/admin/Button';
import type { AttachmentTarget } from './CategoryAttachmentEditor';

function basePath(target: AttachmentTarget): string {
  return target.kind === 'section' ? `/api/admin/homepage/sections/${target.id}` : `/api/admin/campaigns/${target.id}`;
}

const SMALL_BUTTON = 'flex h-12 w-12 items-center justify-center rounded-lg border border-border disabled:opacity-40';

/** Ordered product picker: search, ordered Selected list, and one `PUT` with the whole list (atomic, §13.6). */
export function ProductAttachmentEditor({ target }: { target: AttachmentTarget }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CmsProductLookup[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CmsProductLookup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    apiGet<CmsProductLookup[]>(`${basePath(target)}/products`)
      .then((list) => {
        setSelected(list);
        setLoaded(true);
      })
      .catch((err: unknown) => setMessage({ tone: 'error', text: err instanceof ApiClientError ? err.message : 'Could not load products.' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the target identity changes
  }, [target.id, target.kind]);

  async function search() {
    setSearching(true);
    setMessage(null);
    try {
      const { data } = await apiList<CmsProductLookup>(
        `/api/admin/cms/lookups/products?pageSize=20&q=${encodeURIComponent(query.trim())}`,
      );
      setResults(data);
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiClientError ? err.message : 'Search failed.' });
    } finally {
      setSearching(false);
    }
  }

  const selectedIds = new Set(selected.map((p) => p.id));

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
      await apiPut(`${basePath(target)}/products`, { productIds: selected.map((p) => p.id) });
      setMessage({ tone: 'ok', text: 'Products saved.' });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiClientError ? err.message : 'Could not save products.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset className="mb-lg rounded-lg border border-border p-lg" disabled={saving}>
      <legend className="px-xs text-sm font-semibold">Products</legend>

      <label htmlFor={`product-search-${target.id}`} className="mb-sm block text-xs font-semibold">
        Search products
      </label>
      <div className="mb-md flex flex-col gap-sm sm:flex-row">
        <input
          id={`product-search-${target.id}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
          className="h-11 w-full rounded-lg border border-border bg-background px-md text-base"
        />
        <Button type="button" variant="secondary" loading={searching} onClick={() => void search()}>
          Search
        </Button>
      </div>

      {results.length > 0 && (
        <ul className="mb-md flex flex-col gap-sm" aria-label="Search results">
          {results.map((product) => (
            <li key={product.id} className="flex items-center justify-between gap-sm rounded-lg border border-border p-sm">
              <span className="text-sm">
                {product.name}
                {!product.isActive && <span className="ml-xs text-xs text-text-secondary">(inactive)</span>}
              </span>
              <button
                type="button"
                disabled={selectedIds.has(product.id)}
                onClick={() => setSelected((prev) => [...prev, product])}
                className="h-12 rounded-lg border border-border px-md text-sm font-semibold disabled:opacity-40"
              >
                {selectedIds.has(product.id) ? 'Added' : 'Add'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mb-xs text-xs font-semibold">Selected (in display order)</p>
      {!loaded && !message ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : selected.length === 0 ? (
        <p className="text-sm text-text-secondary">None selected.</p>
      ) : (
        <ul className="mb-md flex flex-col gap-sm">
          {selected.map((product, index) => (
            <li key={product.id} className="flex items-center justify-between gap-sm rounded-lg border border-border p-sm">
              <span className="text-sm">
                {product.name}
                {!product.isActive && <span className="ml-xs text-xs text-text-secondary">(inactive — hidden on the storefront)</span>}
              </span>
              <span className="flex gap-xs">
                <button type="button" aria-label={`Move ${product.name} up`} disabled={index === 0} onClick={() => move(index, -1)} className={SMALL_BUTTON}>
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${product.name} down`}
                  disabled={index === selected.length - 1}
                  onClick={() => move(index, 1)}
                  className={SMALL_BUTTON}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${product.name}`}
                  onClick={() => setSelected((prev) => prev.filter((p) => p.id !== product.id))}
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
        Save products
      </Button>
    </fieldset>
  );
}
