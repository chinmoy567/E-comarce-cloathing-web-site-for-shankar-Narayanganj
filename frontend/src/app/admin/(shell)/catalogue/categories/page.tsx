'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiList, apiPatch, apiPost, apiDelete, ApiClientError } from '@/lib/apiClient';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import { SelectField } from '@/components/admin/SelectField';
import type { CategoryResponse } from '@/lib/admin/types';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; items: CategoryResponse[] };

type FormState = {
  id: string | null;
  name: string;
  parentId: string;
};

const EMPTY_FORM: FormState = { id: null, name: '', parentId: '' };

/**
 * Category tree (spec 05 §Frontend work). Max two levels (category ->
 * subcategory) per §5.1 / the plan's depth-limit note — the parent select
 * only lists top-level categories, so the UI cannot imply deeper nesting.
 * Reorder is a simple up/down pair (no drag library exists in this codebase
 * yet), swapping `displayOrder` between adjacent siblings.
 */
export default function CategoriesPage() {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');

  function load(): () => void {
    const controller = new AbortController();
    setState({ phase: 'loading' });
    apiList<CategoryResponse>('/api/admin/catalogue/categories?page=1&pageSize=100', {
      signal: controller.signal,
    })
      .then(({ data }) => setState({ phase: 'loaded', items: data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: 'error',
          message: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
        });
      });
    return () => controller.abort();
  }

  useEffect(() => load(), []);

  const topLevel = useMemo(
    () => (state.phase === 'loaded' ? state.items.filter((c) => c.parentId === null) : []),
    [state],
  );

  const tree = useMemo(() => {
    if (state.phase !== 'loaded') return [];
    const children = new Map<string, CategoryResponse[]>();
    for (const item of state.items) {
      if (item.parentId) {
        children.set(item.parentId, [...(children.get(item.parentId) ?? []), item]);
      }
    }
    return topLevel.map((parent) => ({
      parent,
      children: (children.get(parent.id) ?? []).sort((a, b) => a.displayOrder - b.displayOrder),
    }));
  }, [state, topLevel]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage('');
    setNotice('');

    try {
      if (form.id) {
        await apiPatch(`/api/admin/catalogue/categories/${form.id}`, {
          name: form.name,
          parentId: form.parentId ? form.parentId : null,
        });
        setNotice('Category updated.');
      } else {
        await apiPost('/api/admin/catalogue/categories', {
          name: form.name,
          parentId: form.parentId ? form.parentId : null,
        });
        setNotice('Category created.');
      }
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setErrorMessage(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(category: CategoryResponse) {
    setForm({ id: category.id, name: category.name, parentId: category.parentId ?? '' });
    setErrorMessage('');
    setNotice('');
  }

  async function toggleActive(category: CategoryResponse) {
    setBusyId(category.id);
    setErrorMessage('');
    setNotice('');
    try {
      await apiPatch(`/api/admin/catalogue/categories/${category.id}`, {
        status: category.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      });
      load();
    } catch (err) {
      setErrorMessage(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(category: CategoryResponse) {
    setBusyId(category.id);
    setErrorMessage('');
    setNotice('');
    try {
      await apiDelete(`/api/admin/catalogue/categories/${category.id}`);
      setNotice('Category deleted.');
      load();
    } catch (err) {
      setErrorMessage(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function move(category: CategoryResponse, siblings: CategoryResponse[], direction: -1 | 1) {
    const index = siblings.findIndex((s) => s.id === category.id);
    const target = siblings[index + direction];
    if (!target) return;

    setBusyId(category.id);
    setErrorMessage('');
    try {
      await Promise.all([
        apiPatch(`/api/admin/catalogue/categories/${category.id}`, { displayOrder: target.displayOrder }),
        apiPatch(`/api/admin/catalogue/categories/${target.id}`, { displayOrder: category.displayOrder }),
      ]);
      load();
    } catch (err) {
      setErrorMessage(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  function renderRow(category: CategoryResponse, siblings: CategoryResponse[], indent: boolean) {
    const index = siblings.findIndex((s) => s.id === category.id);
    return (
      <li
        key={category.id}
        className={`flex min-h-[56px] items-center justify-between gap-sm border-b border-border py-sm ${
          indent ? 'pl-lg' : ''
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text-primary">{category.name}</p>
          <p className="text-xs text-text-secondary">{category.slug}</p>
        </div>

        <div className="flex shrink-0 items-center gap-xs">
          <button
            type="button"
            aria-label="Move up"
            disabled={busyId === category.id || index <= 0}
            onClick={() => void move(category, siblings, -1)}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-text-secondary disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Move down"
            disabled={busyId === category.id || index >= siblings.length - 1}
            onClick={() => void move(category, siblings, 1)}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-text-secondary disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            disabled={busyId === category.id}
            onClick={() => void toggleActive(category)}
            className={`h-11 rounded-lg px-sm text-xs font-semibold ${
              category.status === 'ACTIVE' ? 'bg-accent/10 text-accent' : 'bg-text-tertiary/10 text-text-secondary'
            }`}
          >
            {category.status === 'ACTIVE' ? 'Active' : 'Inactive'}
          </button>
          <button
            type="button"
            disabled={busyId === category.id}
            onClick={() => startEdit(category)}
            className="h-11 rounded-lg px-sm text-xs font-semibold text-primary"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={busyId === category.id}
            onClick={() => void handleDelete(category)}
            className="h-11 rounded-lg px-sm text-xs font-semibold text-error"
          >
            Delete
          </button>
        </div>
      </li>
    );
  }

  return (
    <div>
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Categories</h1>

      <form onSubmit={handleSubmit} noValidate className="mb-2xl rounded-lg border border-border p-lg">
        <h2 className="mb-md text-base font-bold">{form.id ? 'Edit Category' : 'Add Category'}</h2>
        <FormField
          label="Name"
          id="categoryName"
          type="text"
          required
          minLength={1}
          maxLength={200}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          disabled={submitting}
        />
        <SelectField
          label="Parent Category (optional — leave blank for a top-level category)"
          id="categoryParent"
          value={form.parentId}
          onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}
          disabled={submitting}
        >
          <option value="">None (top level)</option>
          {topLevel
            .filter((c) => c.id !== form.id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </SelectField>

        {errorMessage && (
          <div role="alert" className="mb-lg rounded-lg border border-error/30 bg-error/5 p-md">
            <p className="text-sm font-medium text-error">{errorMessage}</p>
          </div>
        )}
        {notice && (
          <div className="mb-lg rounded-lg border border-accent/30 bg-accent/5 p-md">
            <p className="text-sm font-medium text-accent">{notice}</p>
          </div>
        )}

        <div className="flex gap-sm">
          <Button type="submit" loading={submitting}>
            {form.id ? 'Save Changes' : 'Add Category'}
          </Button>
          {form.id && (
            <Button type="button" variant="secondary" onClick={() => setForm(EMPTY_FORM)} disabled={submitting}>
              Cancel
            </Button>
          )}
        </div>
      </form>

      {state.phase === 'loading' && <p className="text-text-secondary">Loading categories…</p>}

      {state.phase === 'error' && (
        <div role="alert" className="rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load categories</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
        </div>
      )}

      {state.phase === 'loaded' && state.items.length === 0 && (
        <p className="text-text-secondary">No categories yet. Add one above.</p>
      )}

      {state.phase === 'loaded' && state.items.length > 0 && (
        <ul>
          {tree.map(({ parent, children }) => (
            <div key={parent.id}>
              {renderRow(parent, topLevel, false)}
              {children.map((child) => renderRow(child, children, true))}
            </div>
          ))}
        </ul>
      )}
    </div>
  );
}
