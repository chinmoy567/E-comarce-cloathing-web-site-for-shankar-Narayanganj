/**
 * Steadfast Courier API adapter (04-courier §4.9).
 *
 * Written against Steadfast's official merchant API guide and webhook page
 * (steadfast.com.bd > API guide / Webhook): base https://portal.packzy.com/api/v1,
 * `Api-Key` + `Secret-Key` headers on every call, no login step and no token.
 *
 * Endpoints used:
 *  - POST /create_order                               create a parcel (invoice = order number)
 *  - GET  /status_with_return_status_by_cid/{cid}     status, including how far a return has got
 *  - GET  /trackings_by_invoice/{invoice}             find an existing parcel by order number
 * The bulk endpoints are unused: the CREATING lock books one parcel at a time.
 *
 * Deliberate limits, each from the documentation rather than assumed:
 *  - No cancel: the API has no cancel endpoint (only a return request, which is a different
 *    operation that can carry a fee), so cancelShipment reports "not cancelled" and the order
 *    cancellation is blocked until the parcel is cancelled in the merchant panel.
 *  - Statuses that need a person (partial delivery, exceptional, unknown) are never mapped to
 *    a shipment status. Polling raises them as an unrecognized-status error (recorded as the
 *    shipment's sync problem); the webhook path returns status null with an attention message.
 *  - Location: Steadfast takes the address as text; no location ids are sent.
 *  - The status endpoints do not return the invoice, so getShipmentDetails cannot report a
 *    merchantReference and the link-parcel mismatch check is skipped for Steadfast.
 *
 * Duplicate safety: Steadfast refuses an invoice it has already booked, so a retry after an
 * unknown outcome cannot create a second parcel. When it says the invoice exists, the existing
 * parcel is looked up by invoice and adopted.
 *
 * Credentials come from env only and never appear in a message, log line or error.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../../../config/env.js';
import type { ShipmentStatus } from '../../../types/orderEnums.js';
import {
  CourierCallError,
  type CourierAdapter,
  type CourierCancelResult,
  type CourierShipmentRequest,
  type CourierShipmentResult,
  type CourierWebhookUpdate,
  type NormalizedTracking,
} from '../types.js';
import { normalizeCourierPhone } from './phone.js';

const REQUEST_TIMEOUT_MS = 25_000;

// Documented storage limits (Steadfast truncates rather than refuses; we cut first so we know what was sent).
const INVOICE_MAX = 100;
const NAME_MAX = 100;
const ADDRESS_MAX = 490;
const NOTE_MAX = 480;
const ITEM_DESCRIPTION_MAX = 255;
const COD_MAX = 1_000_000;
/** Steadfast strips these characters from names, addresses and notes; we replace them up front. */
const STRIPPED_CHARS = /[{};<>$]/g;
const INVOICE_FORMAT = /^[A-Za-z0-9_-]+$/;

type Classified =
  | { kind: 'status'; status: ShipmentStatus }
  | { kind: 'attention'; message: string };

/**
 * Steadfast delivery / return status -> shared shipment vocabulary.
 * `*_approval_pending` is the rider's word only ("do not settle your books on it"), so it is
 * shown as out for delivery and never cascades the order.
 */
const STATUS_MAP: Record<string, ShipmentStatus> = {
  in_review: 'CREATED',
  pending: 'CREATED',
  delivered_approval_pending: 'OUT_FOR_DELIVERY',
  partial_delivered_approval_pending: 'OUT_FOR_DELIVERY',
  cancelled_approval_pending: 'OUT_FOR_DELIVERY',
  unknown_approval_pending: 'OUT_FOR_DELIVERY',
  delivered: 'DELIVERED',
  hold: 'DELIVERY_FAILED',
  cancelled: 'DELIVERY_FAILED',
  cancelled_return_proccessing: 'DELIVERY_FAILED',
  cancelled_return_processing: 'DELIVERY_FAILED',
  cancelled_return_rider_assigned: 'DELIVERY_FAILED',
  cancelled_return_received: 'RETURNED',
};

const PARTIAL_MESSAGE =
  'Steadfast reports a partial delivery. Check the parcel in the Steadfast panel and update this order by hand.';

export function classifySteadfastStatus(raw: unknown): Classified {
  const key = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/[-\s]+/g, '_') : '';
  const status = STATUS_MAP[key];
  if (status) return { kind: 'status', status };
  if (key.startsWith('partial_delivered')) return { kind: 'attention', message: PARTIAL_MESSAGE };
  if (key === 'exceptional') {
    return { kind: 'attention', message: 'Steadfast reports this parcel as exceptional (lost, damaged or off the normal path). Contact Steadfast support.' };
  }
  if (key === 'unknown') {
    return { kind: 'attention', message: 'Steadfast reports this parcel status as unknown. Check it in the Steadfast panel.' };
  }
  // Provider vocabulary, not PII or a secret; sanitized and bounded anyway.
  const shown = key.replace(/[^a-z0-9_]/g, '').slice(0, 40) || 'empty';
  return { kind: 'attention', message: `Steadfast returned a status this platform does not recognise (${shown}).` };
}

/** Polling form: a status, or an unrecognized-status error that the poller flags as a sync problem. */
export function mapSteadfastStatus(raw: unknown): ShipmentStatus {
  const c = classifySteadfastStatus(raw);
  if (c.kind === 'status') return c.status;
  throw new CourierCallError(c.message, null, { unrecognizedStatus: true });
}

type Credentials = { baseUrl: string; apiKey: string; secretKey: string };

function credentials(): Credentials | null {
  const e = getEnv();
  if (!e.STEADFAST_API_KEY || !e.STEADFAST_SECRET_KEY) return null;
  return { baseUrl: e.STEADFAST_BASE_URL.replace(/\/+$/, ''), apiKey: e.STEADFAST_API_KEY, secretKey: e.STEADFAST_SECRET_KEY };
}

function requireCredentials(): Credentials {
  const c = credentials();
  if (!c) throw new CourierCallError('Steadfast is not configured.', null, { outcome: 'NOT_CREATED' });
  return c;
}

/** Collects provider error text: `errors` (field -> [text] or text), `error`, or `message`. Never the request. */
function failureDetail(body: unknown): string {
  const b = (body ?? {}) as { message?: unknown; errors?: unknown; error?: unknown };
  const parts: string[] = [];
  const take = (v: unknown): void => {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) v.forEach(take);
  };
  if (b.errors && typeof b.errors === 'object') Object.values(b.errors as Record<string, unknown>).forEach(take);
  take(b.error);
  if (parts.length === 0) take(b.message);
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function describeFailure(status: number, body: unknown): string {
  // Steadfast answers 401 both for wrong keys and for a parcel this account does not own.
  if (status === 401) return 'Steadfast refused access: the API keys are wrong, or this parcel does not belong to this Steadfast account.';
  if (status === 403) return 'Steadfast refused the request: the merchant account is inactive or needs its KYC details resubmitted.';
  if (status === 429) return 'Steadfast is rate-limiting requests. Wait a few minutes before trying again.';
  const detail = failureDetail(body);
  return detail ? `Steadfast rejected the request: ${detail}` : `Steadfast request failed (HTTP ${status}).`;
}

/** Some Steadfast endpoints report failure inside an HTTP 200, so the body's own status wins when present. */
function effectiveStatus(httpStatus: number, json: unknown): number {
  const s = (json as { status?: unknown } | null)?.status;
  return httpStatus === 200 && typeof s === 'number' && s >= 400 ? s : httpStatus;
}

async function send(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const c = requireCredentials();
  let response: Response;
  try {
    response = await fetch(`${c.baseUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Api-Key': c.apiKey,
        'Secret-Key': c.secretKey,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
    });
  } catch {
    throw new CourierCallError('Steadfast could not be reached.');
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // Non-JSON body: fall through with null.
  }
  return { status: effectiveStatus(response.status, json), json };
}

function clean(value: string, max: number): string {
  return value.replace(STRIPPED_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function buildAddress(r: CourierShipmentRequest['recipient']): string {
  // Most specific first; Steadfast reads the area from this text.
  const parts = [r.detailedAddress, r.wardUnitName, r.areaUnitName, r.district, r.postalCode ?? '']
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const unique = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
  const address = clean(unique.join(', '), ADDRESS_MAX);
  if (address.length === 0) {
    throw new CourierCallError('The delivery address is empty.', null, { outcome: 'NOT_CREATED' });
  }
  return address;
}

export function buildCreateOrderBody(req: CourierShipmentRequest): Record<string, unknown> {
  const invoice = req.orderReference.trim();
  if (!INVOICE_FORMAT.test(invoice) || invoice.length > INVOICE_MAX) {
    throw new CourierCallError('The order number cannot be used as a Steadfast invoice (letters, digits, - and _ only).', null, {
      outcome: 'NOT_CREATED',
    });
  }
  const name = clean(req.recipient.name, NAME_MAX);
  if (name.length === 0) throw new CourierCallError('The recipient name is empty.', null, { outcome: 'NOT_CREATED' });
  const cod = Math.max(0, Math.round(req.codAmount));
  if (cod > COD_MAX) {
    throw new CourierCallError('The cash-on-delivery amount is above Steadfast\'s 1,000,000 BDT limit.', null, { outcome: 'NOT_CREATED' });
  }
  const quantity = req.items.reduce((n, i) => n + i.quantity, 0);
  const description = clean(req.items.map((i) => `${i.name} x${i.quantity}`).join(', '), ITEM_DESCRIPTION_MAX);
  const note = req.deliveryInstructions ? clean(req.deliveryInstructions, NOTE_MAX) : '';
  return {
    invoice,
    recipient_name: name,
    recipient_phone: normalizeCourierPhone(req.recipient.phone),
    recipient_address: buildAddress(req.recipient),
    // Whole taka; 0 for a prepaid bKash order so the customer is never charged twice (§4.4).
    cod_amount: cod,
    ...(note ? { note } : {}),
    ...(description ? { item_description: description } : {}),
    total_lot: Math.max(1, quantity),
    delivery_type: 0, // home delivery
  };
}

function isDuplicateInvoice(json: unknown): boolean {
  return JSON.stringify(json ?? '').toUpperCase().includes('INVOICE_ALREADY_EXISTS') ||
    /invoice[^"]*already (exists|been taken|used)/i.test(failureDetail(json));
}

function idOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return null;
}

async function lookupByInvoice(invoice: string): Promise<CourierShipmentResult | null> {
  const { status, json } = await send('GET', `/trackings_by_invoice/${encodeURIComponent(invoice)}`);
  // Live-verified 2026-11-06: an invoice this account never booked answers 401 "Unauthorized
  // Access", the same as wrong keys. Treating it as "not found" is safe: the create that follows
  // fails with 401 on wrong keys, and Steadfast refuses a repeated invoice, so no duplicate.
  if (status === 404 || status === 401) return null;
  if (status !== 200) throw new CourierCallError(describeFailure(status, json), status);
  const rows = (json as { tracking?: unknown } | null)?.tracking;
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    const id = idOf((row as { consignment_id?: unknown } | null)?.consignment_id);
    if (id) return { courierOrderId: id, trackingUrl: null, rawProviderReference: id };
  }
  return null;
}

async function fetchTracking(consignmentId: string): Promise<NormalizedTracking> {
  const { status, json } = await send('GET', `/status_with_return_status_by_cid/${encodeURIComponent(consignmentId)}`);
  const raw = (json as { delivery_status?: unknown } | null)?.delivery_status;
  if (status !== 200 || raw === undefined) throw new CourierCallError(describeFailure(status, json), status);
  const normalized = mapSteadfastStatus(raw);
  return {
    status: normalized,
    events: [{ status: normalized, occurredAt: null, description: String(raw).replace(/_/g, ' ').slice(0, 120) }],
    estimatedDeliveryAt: null,
    deliveryAreaSummary: null,
    merchantReference: null,
  };
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string {
  const v = headers[name.toLowerCase()];
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** "YYYY-MM-DD HH:MM:SS" in Bangladesh time (or ISO-8601) -> ISO-8601 UTC, or null when unparsable. */
function toIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
  const d = new Date(m ? `${m[1]}T${m[2]}+06:00` : value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const steadfastAdapter: CourierAdapter = {
  key: 'steadfast',
  configSchema: [],

  isConfigured: () => credentials() !== null,

  async createShipment(req): Promise<CourierShipmentResult> {
    const body = buildCreateOrderBody(req);
    const { status, json } = await send('POST', '/create_order', body);
    const consignment = (json as { consignment?: { consignment_id?: unknown; tracking_link?: unknown } } | null)?.consignment;
    const id = idOf(consignment?.consignment_id);
    if (status === 200 && id) {
      const link = typeof consignment?.tracking_link === 'string' && /^https:\/\//.test(consignment.tracking_link) ? consignment.tracking_link : null;
      return { courierOrderId: id, trackingUrl: link, rawProviderReference: id };
    }
    if (isDuplicateInvoice(json)) {
      // This invoice is our order number, so the parcel Steadfast already holds is this order's.
      let existing: CourierShipmentResult | null = null;
      try {
        existing = await lookupByInvoice(body.invoice as string);
      } catch {
        existing = null;
      }
      if (existing) return existing;
      throw new CourierCallError(
        'Steadfast already has a parcel for this order number. Link that consignment instead of creating a new one.',
        status,
        { outcome: 'UNKNOWN' },
      );
    }
    // A 200 without a consignment id is a malformed success: the parcel may exist.
    throw new CourierCallError(describeFailure(status, json), status, status === 200 ? { outcome: 'UNKNOWN' } : {});
  },

  findShipmentByReference: (orderReference) => lookupByInvoice(orderReference),

  getShipmentDetails: (id) => fetchTracking(id),
  trackShipment: (id) => fetchTracking(id),

  async cancelShipment(): Promise<CourierCancelResult> {
    return {
      cancelled: false,
      reason: 'Steadfast has no cancel API. Cancel the parcel from the Steadfast merchant panel, then cancel the order.',
    };
  },

  /** Authorization: Bearer <token> AND X-Signature = hex HMAC-SHA256(raw body, token), both constant-time. */
  verifyWebhook(rawBody, headers): boolean {
    const token = getEnv().STEADFAST_WEBHOOK_TOKEN;
    if (!token) return false;
    const bearerOk = safeEqual(header(headers, 'authorization'), `Bearer ${token}`);
    const expected = createHmac('sha256', token).update(rawBody).digest('hex');
    const signatureOk = safeEqual(header(headers, 'x-signature').trim().toLowerCase(), expected);
    return bearerOk && signatureOk;
  },

  parseWebhook(rawBody, headers): CourierWebhookUpdate[] {
    const event = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Webhook body is not an object.');
    // Only delivery_status carries a parcel status; every other event is acknowledged and ignored.
    if (event.notification_type !== 'delivery_status') return [];
    const courierOrderId = idOf(event.consignment_id);
    if (!courierOrderId) throw new Error('delivery_status event without consignment_id.');
    const occurredAt = toIso(event.updated_at);
    const idempotencyKey = header(headers, 'idempotency-key').trim().slice(0, 200);
    const providerEventId = idempotencyKey || `${courierOrderId}|${String(event.status ?? '')}|${occurredAt ?? ''}`;
    const c = classifySteadfastStatus(event.status);
    return [
      c.kind === 'status'
        ? { courierOrderId, status: c.status, providerEventId, occurredAt }
        : { courierOrderId, status: null, providerEventId, occurredAt, attention: c.message },
    ];
  },
};
