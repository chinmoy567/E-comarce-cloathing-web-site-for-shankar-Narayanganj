'use client';

import { CURRENCY, META_EVENTS, MetaEventName, MetaEventPayload, newEventId } from '@shared/analytics';

/**
 * Single client analytics module (08-analytics-meta §6.9): one call produces both the
 * Pixel copy and the CAPI copy with ONE event_id (§6.4). Purchase is never sent from a
 * click — the CAPI copy is server-initiated; see `firePixelPurchase` for the Pixel copy.
 *
 * Rules: never throws, never awaited, never retried (§6.8). The browser never computes a
 * value — callers may only pass a `value` copied verbatim from a backend response; the
 * backend recomputes its own copy from ids and quantities (§8.31).
 */
type FbqFunction = ((...args: unknown[]) => void) & {
  q?: unknown[];
  queue?: unknown[];
  loaded?: boolean;
  version?: string;
  callMethod?: (...args: unknown[]) => void;
  push?: unknown;
};
type FbqWindow = Window & { fbq?: FbqFunction; _fbq?: FbqFunction };

type ClientEventName = Exclude<MetaEventName, typeof META_EVENTS.PURCHASE>;

const MAX_CONTENT_IDS = 50;
const MAX_SEARCH_LENGTH = 200;

let pixelInitialised = false;

function getFbq(): FbqFunction | undefined {
  return typeof window === 'undefined' ? undefined : (window as FbqWindow).fbq;
}

/** Pixel parameters come from an allowlist, so a caller cannot leak an extra field. */
function pixelParams(payload: Partial<MetaEventPayload>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (payload.content_ids?.length) params.content_ids = payload.content_ids.slice(0, MAX_CONTENT_IDS);
  if (payload.contents?.length) params.contents = payload.contents;
  if (payload.content_name) params.content_name = payload.content_name;
  if (payload.content_category) params.content_category = payload.content_category;
  if (payload.search_string) params.search_string = payload.search_string.slice(0, MAX_SEARCH_LENGTH);
  if (payload.num_items) params.num_items = payload.num_items;
  if (payload.content_type) params.content_type = payload.content_type;
  if (typeof payload.value === 'number') {
    params.value = payload.value;
    params.currency = CURRENCY;
  }
  return params;
}

function readCookie(name: string): string | undefined {
  try {
    const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
  } catch {
    return undefined;
  }
}

export function track(eventName: ClientEventName, payload: Partial<MetaEventPayload> = {}): void {
  try {
    const eventId = newEventId();

    // Pixel copy (a no-op when the Pixel is not configured or is blocked).
    const fbq = getFbq();
    if (typeof fbq === 'function') {
      fbq('track', eventName, pixelParams(payload), { eventID: eventId });
    }

    // CAPI copy with the same event_id. Fire-and-forget; no value is ever sent.
    void sendToBackend(eventName, eventId, payload);
  } catch {
    // Analytics must never break the user experience.
  }
}

/**
 * Pixel-only Purchase for the opportunistic browser copy (spec 18). Reuses the backend's
 * deterministic purchaseEventId so Meta deduplicates against the server-sent CAPI copy.
 * Never posts to the backend and is not reachable through `track()`.
 */
export function firePixelPurchase(input: {
  eventId: string;
  value: number;
  numItems?: number;
}): void {
  try {
    const fbq = getFbq();
    if (typeof fbq !== 'function') return;
    fbq(
      'track',
      META_EVENTS.PURCHASE,
      {
        value: input.value,
        currency: CURRENCY,
        content_type: 'product',
        num_items: input.numItems,
      },
      { eventID: input.eventId },
    );
  } catch {
    // ignore
  }
}

async function sendToBackend(
  eventName: ClientEventName,
  eventId: string,
  payload: Partial<MetaEventPayload>,
): Promise<void> {
  try {
    // The Express API is a separate origin; the Next app has no /api proxy.
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '');
    if (!apiBase) return;

    const contents = payload.contents?.slice(0, MAX_CONTENT_IDS).map((c) => ({ id: c.id, quantity: c.quantity }));
    const fbp = readCookie('_fbp');
    const fbc = readCookie('_fbc');

    await fetch(`${apiBase}/api/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        eventName,
        eventId,
        eventSourceUrl: window.location.origin + window.location.pathname,
        payload: {
          contentIds: payload.content_ids?.slice(0, MAX_CONTENT_IDS),
          contents: contents?.length ? contents : undefined,
          searchString: payload.search_string?.slice(0, MAX_SEARCH_LENGTH),
        },
        fbp,
        fbc,
      }),
    });
  } catch {
    // Ignored: analytics failures are invisible to the customer (§6.8).
  }
}

/**
 * Initialise the Meta Pixel (only when NEXT_PUBLIC_META_PIXEL_ID is set). Idempotent:
 * StrictMode, hot reload and remounts never inject a second script or a second `init`.
 */
export function initPixel(): void {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  if (!pixelId || typeof window === 'undefined') return;
  const w = window as FbqWindow;
  if (pixelInitialised || w.fbq) return;
  pixelInitialised = true;

  // Standard Pixel stub: calls made before the script loads are queued.
  const stub: FbqFunction = function (...args: unknown[]) {
    if (stub.callMethod) stub.callMethod(...args);
    else (stub.queue as unknown[]).push(args);
  } as FbqFunction;
  stub.push = stub;
  stub.loaded = true;
  stub.version = '2.0';
  stub.queue = [];
  w.fbq = stub;
  w._fbq = stub;

  stub('init', pixelId);

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(script);
}
