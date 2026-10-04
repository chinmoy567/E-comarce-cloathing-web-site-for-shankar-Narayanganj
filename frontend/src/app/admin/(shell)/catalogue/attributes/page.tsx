'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPost, ApiClientError } from '@/lib/apiClient';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import { SelectField } from '@/components/admin/SelectField';
import type { AttributeResponse, AttributeType, AttributeValueResponse } from '@/lib/admin/types';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; items: AttributeResponse[] };

const TYPE_LABELS: Record<AttributeType, string> = {
  SIZE: 'Size',
  COLOUR: 'Colour',
  AGE_GROUP: 'Age group',
  OTHER: 'Other',
};

function errorMessage(err: unknown): string {
  return err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.';
}

function AttributeCard({ attribute, onChanged }: { attribute: AttributeResponse; onChanged: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ kind: 'ok', text: success });
      onChanged();
      return true;
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addValue(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setMessage({ kind: 'error', text: 'Enter a value to add.' });
      return;
    }
    const ok = await run(
      () => apiPost<AttributeValueResponse>(`/api/admin/catalogue/attributes/${attribute.id}/values`, { value: trimmed }),
      `Added "${trimmed}".`,
    );
    if (ok) setValue('');
  }

  const ordered = [...attribute.values].sort((a, b) => a.displayOrder - b.displayOrder || a.value.localeCompare(b.value));

  return (
    <section className="mb-lg rounded-lg border border-border p-lg" aria-labelledby={`attr-${attribute.id}`}>
      <div className="mb-md flex items-baseline justify-between gap-md">
        <h2 id={`attr-${attribute.id}`} className="text-base font-bold text-text-primary">
          {attribute.name}
        </h2>
        <span className="text-xs text-text-secondary">{TYPE_LABELS[attribute.type]}</span>
      </div>

      {ordered.length === 0 ? (
        <p className="mb-md text-sm text-text-secondary">No values yet.</p>
      ) : (
        <ul className="mb-md flex flex-wrap gap-sm">
          {ordered.map((v) => (
            <li key={v.id} className="flex items-center gap-xs rounded-lg border border-border bg-surface pl-md">
              <span className="text-sm text-text-primary">{v.value}</span>
              {confirmId === v.id ? (
                <span className="flex items-center gap-xs pr-xs">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => apiDelete(`/api/admin/catalogue/attributes/${attribute.id}/values/${v.id}`),
                        `Removed "${v.value}".`,
                      ).then(() => setConfirmId(null))
                    }
                    className="h-11 px-sm text-xs font-semibold text-error"
                  >
                    Remove
                  </button>
                  <button type="button" onClick={() => setConfirmId(null)} className="h-11 px-sm text-xs font-semibold">
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`Remove ${v.value}`}
                  disabled={busy}
                  onClick={() => setConfirmId(v.id)}
                  className="h-11 w-11 text-base text-text-secondary"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => void addValue(e)} noValidate className="flex flex-wrap items-end gap-sm">
        <div className="min-w-0 flex-1">
          <FormField
            label={`Add a ${attribute.name.toLowerCase()} value`}
            id={`attr-value-${attribute.id}`}
            type="text"
            maxLength={100}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="mb-lg">
          <Button type="submit" loading={busy}>
            Add
          </Button>
        </div>
      </form>

      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-xs ${message.kind === 'error' ? 'text-error' : 'text-success'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}

/**
 * Product attributes (spec 05 §Frontend work, 05-admin §5.1): the sizes, colours and age groups
 * variants are built from. A value that a variant uses cannot be removed — the backend answers
 * with a conflict and the message is shown.
 */
export default function AttributesPage() {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [type, setType] = useState<AttributeType>('SIZE');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');

  function load(): () => void {
    const controller = new AbortController();
    apiGet<AttributeResponse[]>('/api/admin/catalogue/attributes', { signal: controller.signal })
      .then((items) => setState({ phase: 'loaded', items }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ phase: 'error', message: errorMessage(err) });
      });
    return () => controller.abort();
  }

  useEffect(() => load(), []);

  async function createAttribute(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError('');
    if (!name.trim()) {
      setFormError('Enter a name.');
      return;
    }
    setCreating(true);
    try {
      await apiPost<AttributeResponse>('/api/admin/catalogue/attributes', { type, name: name.trim() });
      setName('');
      load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Attributes</h1>

      {state.phase === 'loading' && <p className="text-text-secondary">Loading attributes…</p>}
      {state.phase === 'error' && (
        <div role="alert" className="mb-lg rounded-lg border border-error/30 bg-error/5 p-lg">
          <p className="font-medium text-error">Could not load attributes</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
        </div>
      )}

      {state.phase === 'loaded' && (
        <>
          {state.items.length === 0 && (
            <p className="mb-lg text-sm text-text-secondary">No attributes yet. Add one below, then give it values.</p>
          )}
          {state.items.map((attribute) => (
            <AttributeCard key={attribute.id} attribute={attribute} onChanged={load} />
          ))}
        </>
      )}

      <form onSubmit={(e) => void createAttribute(e)} noValidate className="rounded-lg border border-border bg-surface p-lg">
        <h2 className="mb-md text-base font-bold">New attribute</h2>
        <SelectField
          label="Type"
          id="attribute-type"
          value={type}
          onChange={(e) => setType(e.target.value as AttributeType)}
          disabled={creating}
        >
          {(Object.keys(TYPE_LABELS) as AttributeType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </SelectField>
        <FormField
          label="Name"
          id="attribute-name"
          type="text"
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={creating}
          error={formError || undefined}
        />
        <Button type="submit" loading={creating}>
          Add Attribute
        </Button>
      </form>
    </div>
  );
}
