/**
 * Pathao Courier Merchant API adapter (spec 14, 04-courier §4.9).
 *
 * Endpoints and field shapes were confirmed against Pathao's sandbox
 * (https://courier-api-sandbox.pathao.com): POST /aladdin/api/v1/issue-token,
 * POST /aladdin/api/v1/orders and GET /aladdin/api/v1/orders/{consignment_id}/info.
 *
 * Deliberate limits, each confirmed or documented rather than assumed:
 *  - No cancel: the merchant API has no working cancel endpoint (the sandbox answers
 *    `Unauthorized!` to POST .../cancel), so cancelShipment reports "not cancelled".
 *  - No lookup by merchant reference: findShipmentByReference is omitted, so a retry after
 *    a failed creation can duplicate a parcel and the Order Panel warns about it (§4.11).
 *  - No webhook: verifyWebhook/parseWebhook are omitted; status comes from polling (spec 15).
 *  - Location: city/zone/area ids are omitted and Pathao resolves the area from the address
 *    text, which the sandbox accepts. courier_location_mappings is not consulted.
 *
 * Credentials come from env only and never appear in a message, log line or error.
 */

import { getEnv } from '../../../config/env.js';
import type { ShipmentStatus } from '../../../types/orderEnums.js';
import {
  CourierCallError,
  type CourierAdapter,
  type CourierCancelResult,
  type CourierShipmentRequest,
  type CourierShipmentResult,
  type NormalizedTracking,
} from '../types.js';

const API = '/aladdin/api/v1';
const REQUEST_TIMEOUT_MS = 25_000;
const TOKEN_SAFETY_MARGIN_MS = 60_000;

const DELIVERY_TYPE_NORMAL = 48;
const ITEM_TYPE_PARCEL = 2;
const MIN_WEIGHT_KG = 0.5;
const MAX_WEIGHT_KG = 10;
const ADDRESS_MIN = 10;
const ADDRESS_MAX = 220;
const NAME_MIN = 3;
const NAME_MAX = 100;

/**
 * Pathao order_status_slug -> shared shipment vocabulary. Slugs are compared with `-`/`_`
 * folded together. An unlisted slug is an error, never a guess (§4.9): the sync logs it
 * and leaves the shipment unchanged.
 */
const STATUS_MAP: Record<string, ShipmentStatus> = {
  pending: 'CREATED',
  pickup_requested: 'CREATED',
  assigned_for_pickup: 'CREATED',
  picked: 'IN_TRANSIT',
  picked_up: 'IN_TRANSIT',
  at_the_sorting_hub: 'IN_TRANSIT',
  in_transit: 'IN_TRANSIT',
  received_at_last_mile_hub: 'IN_TRANSIT',
  assigned_for_delivery: 'OUT_FOR_DELIVERY',
  out_for_delivery: 'OUT_FOR_DELIVERY',
  delivered: 'DELIVERED',
  delivery_failed: 'DELIVERY_FAILED',
  on_hold: 'DELIVERY_FAILED',
  return: 'RETURNED',
  returned: 'RETURNED',
  return_in_transit: 'RETURNED',
  return_id_created: 'RETURNED',
  returned_to_merchant: 'RETURNED',
  paid_return: 'RETURNED',
};

type Token = { value: string; expiresAt: number };
let cachedToken: Token | null = null;

type Credentials = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  storeId: number;
};

function credentials(): Credentials | null {
  const e = getEnv();
  if (!e.PATHAO_CLIENT_ID || !e.PATHAO_CLIENT_SECRET || !e.PATHAO_USERNAME || !e.PATHAO_PASSWORD || !e.PATHAO_STORE_ID) {
    return null;
  }
  return {
    baseUrl: e.PATHAO_BASE_URL.replace(/\/+$/, ''),
    clientId: e.PATHAO_CLIENT_ID,
    clientSecret: e.PATHAO_CLIENT_SECRET,
    username: e.PATHAO_USERNAME,
    password: e.PATHAO_PASSWORD,
    storeId: e.PATHAO_STORE_ID,
  };
}

function requireCredentials(): Credentials {
  const c = credentials();
  if (!c) throw new CourierCallError('Pathao is not configured.');
  return c;
}

/** Pathao validation errors are `{ message, errors: { field: [text] } }` — field text only, never the request. */
function describeFailure(status: number, body: unknown): string {
  const b = (body ?? {}) as { message?: unknown; errors?: unknown };
  const parts: string[] = [];
  if (b.errors && typeof b.errors === 'object') {
    for (const v of Object.values(b.errors as Record<string, unknown>)) {
      if (Array.isArray(v)) parts.push(...v.filter((x): x is string => typeof x === 'string'));
    }
  }
  if (parts.length === 0 && typeof b.message === 'string') parts.push(b.message);
  const detail = parts.join(' ').slice(0, 200);
  return detail ? `Pathao rejected the request: ${detail}` : `Pathao request failed (HTTP ${status}).`;
}

async function send(
  c: Credentials,
  method: 'GET' | 'POST',
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${c.baseUrl}${API}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
    });
  } catch {
    throw new CourierCallError('Pathao could not be reached.');
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // Non-JSON body: fall through with null.
  }
  return { status: response.status, json };
}

async function issueToken(c: Credentials): Promise<Token> {
  const { status, json } = await send(c, 'POST', '/issue-token', {}, {
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: 'password',
    username: c.username,
    password: c.password,
  });
  const j = json as { access_token?: unknown; expires_in?: unknown } | null;
  if (status !== 200 || typeof j?.access_token !== 'string') {
    // Deliberately generic: the provider's text can name which credential was wrong.
    throw new CourierCallError('Pathao authentication failed. Check the courier credentials.', status);
  }
  const ttlMs = (typeof j.expires_in === 'number' ? j.expires_in : 3600) * 1000;
  return { value: j.access_token, expiresAt: Date.now() + ttlMs - TOKEN_SAFETY_MARGIN_MS };
}

async function getToken(c: Credentials, force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  cachedToken = await issueToken(c);
  return cachedToken.value;
}

/** Authenticated call; re-issues the token once on 401. Never retries any other failure. */
async function authed(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const c = requireCredentials();
  let res = await send(c, method, path, { Authorization: `Bearer ${await getToken(c)}` }, body);
  if (res.status === 401) {
    res = await send(c, method, path, { Authorization: `Bearer ${await getToken(c, true)}` }, body);
  }
  return res;
}

/** Bangladesh mobile -> 01XXXXXXXXX (accepts +880 / 880 prefixes and separators). */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const local = digits.startsWith('880') ? `0${digits.slice(3)}` : digits;
  if (!/^01[3-9]\d{8}$/.test(local)) {
    throw new CourierCallError('The recipient phone number is not a valid Bangladesh mobile number.');
  }
  return local;
}

function buildAddress(r: CourierShipmentRequest['recipient']): string {
  // Most specific first; Pathao resolves city/zone/area from this text.
  const parts = [r.detailedAddress, r.wardUnitName, r.areaUnitName, r.district].map((p) => p.trim()).filter((p) => p.length > 0);
  const unique = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
  const address = unique.join(', ').slice(0, ADDRESS_MAX);
  if (address.length < ADDRESS_MIN) {
    throw new CourierCallError('The delivery address is too short for Pathao (minimum 10 characters).');
  }
  return address;
}

export function buildOrderBody(req: CourierShipmentRequest, storeId: number): Record<string, unknown> {
  const name = req.recipient.name.trim();
  if (name.length < NAME_MIN) throw new CourierCallError('The recipient name is too short for Pathao (minimum 3 characters).');
  const weightKg = Math.min(MAX_WEIGHT_KG, Math.max(MIN_WEIGHT_KG, Math.round(req.weightGrams) / 1000));
  const quantity = req.items.reduce((n, i) => n + i.quantity, 0);
  return {
    store_id: storeId,
    merchant_order_id: req.orderReference,
    recipient_name: name.slice(0, NAME_MAX),
    recipient_phone: normalizePhone(req.recipient.phone),
    recipient_address: buildAddress(req.recipient),
    delivery_type: DELIVERY_TYPE_NORMAL,
    item_type: ITEM_TYPE_PARCEL,
    item_quantity: Math.max(1, quantity),
    item_weight: weightKg,
    item_description: req.items.map((i) => `${i.name} x${i.quantity}`).join(', ').slice(0, 250),
    ...(req.deliveryInstructions ? { special_instruction: req.deliveryInstructions.slice(0, 250) } : {}),
    // Whole taka; 0 for a prepaid bKash order so the customer is never charged twice (§4.4).
    amount_to_collect: Math.max(0, Math.round(req.codAmount)),
  };
}

/** "YYYY-MM-DD HH:MM:SS" in Bangladesh time -> ISO-8601 UTC, or null when unparsable. */
function toIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
  const d = new Date(m ? `${m[1]}T${m[2]}+06:00` : value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function mapPathaoStatus(slug: unknown): ShipmentStatus {
  const key = typeof slug === 'string' ? slug.trim().toLowerCase().replace(/[-\s]+/g, '_') : '';
  const status = STATUS_MAP[key];
  if (!status) throw new CourierCallError('Pathao returned a status this platform does not recognise.');
  return status;
}

async function fetchTracking(consignmentId: string): Promise<NormalizedTracking> {
  const { status, json } = await authed('GET', `/orders/${encodeURIComponent(consignmentId)}/info`);
  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (status !== 200 || !data) throw new CourierCallError(describeFailure(status, json), status);
  const normalized = mapPathaoStatus(data.order_status_slug);
  return {
    status: normalized,
    events: [{ status: normalized, occurredAt: toIso(data.updated_at), description: String(data.order_status ?? '').slice(0, 120) }],
    estimatedDeliveryAt: null,
    deliveryAreaSummary: null,
  };
}

export const pathaoAdapter: CourierAdapter = {
  key: 'pathao',
  configSchema: [],

  isConfigured: () => credentials() !== null,

  async createShipment(req): Promise<CourierShipmentResult> {
    const c = requireCredentials();
    const { status, json } = await authed('POST', '/orders', buildOrderBody(req, c.storeId));
    const data = (json as { data?: { consignment_id?: unknown } } | null)?.data;
    if (status !== 200 || typeof data?.consignment_id !== 'string' || data.consignment_id === '') {
      throw new CourierCallError(describeFailure(status, json), status);
    }
    return { courierOrderId: data.consignment_id, trackingUrl: null, rawProviderReference: data.consignment_id };
  },

  getShipmentDetails: (id) => fetchTracking(id),
  trackShipment: (id) => fetchTracking(id),

  async cancelShipment(): Promise<CourierCancelResult> {
    return {
      cancelled: false,
      reason: 'Pathao does not support cancelling a parcel through the merchant API. Cancel it from the Pathao merchant panel.',
    };
  },
};

/** Test seam: forgets the cached access token. */
export function resetPathaoTokenCache(): void {
  cachedToken = null;
}
