'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/admin/Button';
import { apiGet, apiList, apiPost, ApiClientError } from '@/lib/apiClient';
import { useAdminSession } from '@/lib/admin/session';
import { formatDate, formatPrice, statusLabel } from '@/lib/admin/orders';
import type { CourierCallEntry, CourierOption, ShipmentView } from '@/lib/admin/types';
import { ShipmentStatusBadge } from '@/components/admin/orders/OrderStatusBadges';
import { CourierPicker } from './CourierPicker';
import { ShipmentFailureNotice } from './ShipmentFailureNotice';

const POLL_MS = 5_000;
const POLL_MAX_MS = 2 * 60_000;

type OrderInfo = {
  paymentMethod: string;
  orderStatus: string;
  totalAmount: number;
  addressLines: string[];
};

type Mode = 'view' | 'change';

/**
 * Shipment section of the admin order page (spec 14). Shows backend state only:
 * buttons come from `allowedActions` (the backend's own readiness + permission
 * evaluation) and the backend's refusal is displayed — readiness rules are never
 * re-derived here.
 */
export function ShipmentSection({
  orderId,
  order,
  onOrderChanged,
}: {
  orderId: string;
  order: OrderInfo;
  onOrderChanged: () => void;
}) {
  const { hasPermission } = useAdminSession();
  const base = `/api/admin/orders/${orderId}/shipment`;

  const [shipment, setShipment] = useState<ShipmentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [couriers, setCouriers] = useState<CourierOption[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [confirmingRetry, setConfirmingRetry] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const inFlightRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const refetch = useCallback(async (): Promise<ShipmentView | null> => {
    try {
      const view = await apiGet<ShipmentView>(base);
      setShipment(view);
      setForbidden(false);
      return view;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiClientError ? err.message : 'Could not reach the server.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const needsCouriers =
    shipment?.allowedActions.includes('CREATE_SHIPMENT') || shipment?.allowedActions.includes('CHANGE_COURIER');
  const loadCouriers = useCallback(async () => {
    if (!hasPermission('courier.select')) return;
    try {
      setCouriers(await apiGet<CourierOption[]>('/api/admin/couriers'));
    } catch {
      setCouriers([]);
    }
  }, [hasPermission]);
  useEffect(() => {
    if (needsCouriers && couriers === null) void loadCouriers();
  }, [needsCouriers, couriers, loadCouriers]);

  // CREATING: re-fetch every 5 s for up to 2 minutes (covers a second tab or a reload mid-call).
  const status = shipment?.status;
  useEffect(() => {
    if (status !== 'CREATING') return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > POLL_MAX_MS) {
        clearInterval(timer);
        return;
      }
      void refetch().then((v) => {
        if (v && v.status !== 'CREATING') onOrderChanged();
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [status, refetch, onOrderChanged]);

  async function act(path: string, body: unknown, doneMessage: string) {
    if (inFlightRef.current) return; // single in-flight flag: Create/Retry/Change/Mark cannot overlap
    inFlightRef.current = true;
    setInFlight(true);
    setError(null);
    try {
      const view = await apiPost<ShipmentView>(path, body);
      setShipment(view);
      setMode('view');
      setConfirmingRetry(false);
      setAnnounce(doneMessage);
      headingRef.current?.focus();
      onOrderChanged();
    } catch (err) {
      await handleActionError(err);
    } finally {
      inFlightRef.current = false;
      setInFlight(false);
    }
  }

  async function handleActionError(err: unknown) {
    setConfirmingRetry(false);
    if (!(err instanceof ApiClientError)) {
      setError('Could not reach the server. Please try again.');
      return;
    }
    switch (err.code) {
      case 'SHIPMENT_CREATION_IN_PROGRESS':
      case 'SHIPMENT_ALREADY_EXISTS':
      case 'INVALID_TRANSITION':
        await refetch(); // reflect the existing state; never resubmit (§4.11)
        setError(err.message);
        return;
      case 'COURIER_REQUEST_FAILED':
        await refetch(); // the shipment is now CREATION_FAILED
        onOrderChanged();
        setError(err.message);
        return;
      case 'COURIER_UNAVAILABLE':
        setSelected(null);
        await loadCouriers();
        setError('That courier is no longer available. Choose another.');
        return;
      case 'ORDER_NOT_READY_FOR_SHIPMENT':
      case 'PAYMENT_NOT_VERIFIED':
        setError(err.message);
        return;
      default:
        if (err.status === 403) setError('You do not have permission to do this.');
        else if (err.status === 429) {
          setLockedUntil(Date.now() + (err.retryAfter ?? 30) * 1000);
          setError(`${err.message} Try again in ${err.retryAfter ?? 30} seconds.`);
        } else setError(err.message);
    }
  }

  const busy = inFlight || Date.now() < lockedUntil;
  const actions = shipment?.allowedActions ?? [];
  const canCreate = actions.includes('CREATE_SHIPMENT');
  const canRetry = actions.includes('RETRY_SHIPMENT');
  const canChange = actions.includes('CHANGE_COURIER');
  const canMarkShipped = actions.includes('MARK_SHIPPED');

  return (
    <section
      className="min-h-24 rounded-lg border border-border bg-surface p-lg"
      aria-labelledby="shipment-heading"
      aria-busy={loading}
    >
      <h2 id="shipment-heading" ref={headingRef} tabIndex={-1} className="mb-md text-lg font-bold outline-none">
        Shipment
      </h2>

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>

      {loading && <p className="text-sm text-text-secondary">Loading shipment…</p>}

      {forbidden && (
        <p role="alert" className="text-sm text-error">
          You do not have permission to do this.
        </p>
      )}

      {!loading && !forbidden && shipment && (
        <div className="space-y-md">
          <div className="flex flex-wrap items-center gap-sm">
            <ShipmentStatusBadge value={shipment.status} />
            {shipment.status === 'CREATING' && (
              <Button variant="secondary" disabled={inFlight} onClick={() => void refetch()}>
                Refresh
              </Button>
            )}
          </div>

          {shipment.status === 'CREATING' && <p className="text-sm text-text-secondary">Creating shipment…</p>}

          {/* Before creation: pick a courier. */}
          {shipment.status === 'NOT_CREATED' && canCreate && (
            <CreatePanel
              couriers={couriers}
              order={order}
              selected={selected}
              onSelect={setSelected}
              busy={busy}
              submitLabel="Create shipment"
              canManage={hasPermission('courier.manage')}
              onSubmit={() => selected && void act(base, { courierCode: selected }, 'Shipment created.')}
            />
          )}
          {shipment.status === 'NOT_CREATED' && !canCreate && (
            <p className="text-sm text-text-secondary">No shipment has been created for this order yet.</p>
          )}

          {/* Failure: error + Retry / Change courier. */}
          {shipment.status === 'CREATION_FAILED' && mode === 'view' && (
            <ShipmentFailureNotice
              shipment={shipment}
              orderStatusLabel={statusLabel(order.orderStatus)}
              canRetry={canRetry}
              canChangeCourier={canChange}
              disabled={busy}
              confirmingRetry={confirmingRetry}
              onRetry={() =>
                shipment.retryMayDuplicate
                  ? setConfirmingRetry(true)
                  : void act(`${base}/retry`, undefined, 'Shipment created.')
              }
              onConfirmRetry={() => void act(`${base}/retry`, undefined, 'Shipment created.')}
              onCancelRetry={() => setConfirmingRetry(false)}
              onChangeCourier={() => {
                setSelected(null);
                setMode('change');
              }}
            />
          )}
          {shipment.status === 'CREATION_FAILED' && mode === 'change' && canChange && (
            <div>
              <CreatePanel
                couriers={couriers}
                order={order}
                selected={selected}
                onSelect={setSelected}
                busy={busy}
                disabledCode={shipment.courierCode}
                submitLabel="Create shipment with this courier"
                canManage={hasPermission('courier.manage')}
                onSubmit={() =>
                  selected && void act(`${base}/change-courier`, { courierCode: selected }, 'Shipment created.')
                }
              />
              <Button variant="secondary" className="mt-sm" disabled={busy} onClick={() => setMode('view')}>
                Back
              </Button>
            </div>
          )}

          {/* Created and later: read-only card. */}
          {!['NOT_CREATED', 'CREATING', 'CREATION_FAILED'].includes(shipment.status) && (
            <StatusCard shipment={shipment} />
          )}

          {canMarkShipped && (
            <Button
              disabled={busy}
              loading={inFlight}
              onClick={() => void act(`${base}/mark-shipped`, undefined, 'Marked as shipped.')}
            >
              Mark as shipped
            </Button>
          )}

          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}

          {shipment.status !== 'NOT_CREATED' && <CallHistory orderId={orderId} refreshKey={shipment.status} />}
        </div>
      )}
    </section>
  );
}

function CreatePanel({
  couriers,
  order,
  selected,
  onSelect,
  busy,
  disabledCode,
  submitLabel,
  canManage,
  onSubmit,
}: {
  couriers: CourierOption[] | null;
  order: OrderInfo;
  selected: string | null;
  onSelect: (code: string) => void;
  busy: boolean;
  disabledCode?: string | null;
  submitLabel: string;
  canManage: boolean;
  onSubmit: () => void;
}) {
  return (
    <div>
      <div className="mb-md rounded-lg bg-background p-md text-sm">
        <p className="mb-xs text-xs font-semibold text-text-secondary">Delivery address</p>
        <p>{order.addressLines.join(', ') || '—'}</p>
        {order.paymentMethod === 'COD' && (
          <p className="mt-sm">
            <span className="text-text-secondary">COD amount to collect: </span>
            <span className="font-semibold">{formatPrice(order.totalAmount)}</span>
          </p>
        )}
      </div>

      {couriers === null ? (
        <p className="text-sm text-text-secondary">Loading couriers…</p>
      ) : couriers.length === 0 ? (
        <p className="text-sm text-text-secondary">
          No couriers are enabled. Ask an administrator to enable one in{' '}
          {canManage ? (
            <Link href="/admin/settings/couriers" className="font-medium text-primary hover:underline">
              Courier Settings
            </Link>
          ) : (
            'Courier Settings'
          )}
          .
        </p>
      ) : (
        <>
          <CourierPicker couriers={couriers} value={selected} onChange={onSelect} disabled={busy} disabledCode={disabledCode} />
          <Button className="h-12" disabled={!selected || busy} loading={busy} onClick={onSubmit}>
            {submitLabel}
          </Button>
        </>
      )}
    </div>
  );
}

function StatusCard({ shipment }: { shipment: ShipmentView }) {
  const safeTrackUrl = shipment.trackingUrl?.startsWith('https://') ? shipment.trackingUrl : null;
  return (
    <dl className="space-y-xs text-sm">
      <div className="flex gap-sm">
        <dt className="text-text-secondary">Courier:</dt>
        <dd className="font-medium">{shipment.courierName ?? shipment.courierCode ?? '—'}</dd>
      </div>
      {shipment.courierOrderId && (
        <div className="flex gap-sm">
          <dt className="text-text-secondary">Parcel / Tracking ID:</dt>
          <dd className="break-all font-mono">{shipment.courierOrderId}</dd>
        </div>
      )}
      {shipment.codAmount !== null && (
        <div className="flex gap-sm">
          <dt className="text-text-secondary">COD amount sent:</dt>
          <dd className="font-medium">{formatPrice(shipment.codAmount)}</dd>
        </div>
      )}
      {shipment.createdWithCourierAt && (
        <div className="flex gap-sm">
          <dt className="text-text-secondary">Created:</dt>
          <dd>{formatDate(shipment.createdWithCourierAt, true)}</dd>
        </div>
      )}
      {shipment.shippedAt && (
        <div className="flex gap-sm">
          <dt className="text-text-secondary">Handed over:</dt>
          <dd>{formatDate(shipment.shippedAt, true)}</dd>
        </div>
      )}
      {shipment.cancelledWithCourierAt && (
        <div className="flex gap-sm">
          <dt className="text-text-secondary">Cancelled with courier:</dt>
          <dd>{formatDate(shipment.cancelledWithCourierAt, true)}</dd>
        </div>
      )}
      {safeTrackUrl && (
        <p className="pt-xs">
          <a href={safeTrackUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
            {shipment.courierName ? `Track on ${shipment.courierName}` : 'Track parcel'}
          </a>
        </p>
      )}
    </dl>
  );
}

function CallHistory({ orderId, refreshKey }: { orderId: string; refreshKey: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CourierCallEntry[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiList<CourierCallEntry>(`/api/admin/orders/${orderId}/shipment/requests?page=${page}&pageSize=10`)
      .then((res) => {
        if (cancelled) return;
        setItems((prev) => (page === 1 ? res.data : [...prev, ...res.data]));
        setTotalPages(res.pagination.totalPages);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, page, orderId, refreshKey]);

  return (
    <div className="border-t border-border pt-md">
      <button
        type="button"
        className="text-sm font-medium text-primary hover:underline"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide courier call history' : 'Courier call history'}
      </button>
      {open && (
        <div className="mt-sm">
          {failed && <p className="text-sm text-error">Could not load call history.</p>}
          {!failed && items.length === 0 && <p className="text-sm text-text-secondary">No courier calls yet.</p>}
          <ul className="space-y-xs text-sm">
            {items.map((c, i) => (
              <li key={i}>
                <span className="font-medium">{statusLabel(c.operation)}</span> · {c.succeeded ? 'Succeeded' : 'Failed'}
                {c.durationMs !== null ? ` · ${c.durationMs} ms` : ''} · {formatDate(c.createdAt, true)}
                {c.errorMessage && <span className="block text-text-secondary">{c.errorMessage}</span>}
              </li>
            ))}
          </ul>
          {page < totalPages && (
            <Button variant="secondary" className="mt-sm" onClick={() => setPage((p) => p + 1)}>
              Load more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
