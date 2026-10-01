/**
 * Pure helpers for the public Track Order page and the shipment progress trail
 * (04-courier §4.14, §4.16). No React, no network — unit-testable in the node test env.
 */

/** Track Order input rule (§4.16): 4–64 characters, letters, digits, `-` and `_`. UX only — the backend re-validates. */
const TRACKING_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;
export const TRACKING_ID_ERROR = 'Enter a valid Order ID / Tracking ID.';

/** Returns an error message, or null when the (trimmed) value is acceptable. */
export function validateTrackingId(raw: string): string | null {
  return TRACKING_ID_PATTERN.test(raw.trim()) ? null : TRACKING_ID_ERROR;
}

/**
 * sessionStorage key used to hand a tracking id from the account order page to /track-order.
 * Not a query string: the root PixelInit reports page URLs to Meta, and a tracking id must not travel there.
 */
export const TRACK_PREFILL_KEY = 'fabrillke.trackOrder.prefill';

/** Courier links are rendered only when https (the backend already enforces this; this is defence in depth). */
export function safeHttpsUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export type TrackingEvent = { status: string; occurredAt: string | null; description: string };

export type TrailNode = {
  status: string;
  reached: boolean;
  current: boolean;
  /** Only ever an event-supplied time — never invented. */
  occurredAt: string | null;
  exception: boolean;
};

const MAIN_TRAIL = ['CREATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;

/**
 * The shipment lifecycle as an ordered trail, built from the normalized events and the shipment status only
 * (§4.14.6 — no order-status value appears here). DELIVERY_FAILED / RETURNED are terminal exception nodes in
 * place of the remaining nodes, not a second trail.
 */
export function buildProgressTrail(events: TrackingEvent[], currentStatus: string): TrailNode[] {
  const timeOf = (status: string): string | null => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i]!.status === status) return events[i]!.occurredAt;
    }
    return null;
  };
  const isException = currentStatus === 'DELIVERY_FAILED' || currentStatus === 'RETURNED';

  let reachedIndex = MAIN_TRAIL.indexOf(currentStatus as (typeof MAIN_TRAIL)[number]);
  if (isException) {
    // A failure can only follow Out for Delivery, so that is the last normal node reached unless events say otherwise.
    reachedIndex = 3;
  }

  const nodes: TrailNode[] = (isException ? MAIN_TRAIL.slice(0, reachedIndex + 1) : MAIN_TRAIL).map((status, i) => ({
    status,
    reached: i <= reachedIndex,
    current: status === currentStatus,
    occurredAt: i <= reachedIndex ? timeOf(status) : null,
    exception: false,
  }));

  if (isException) {
    const exceptions =
      currentStatus === 'RETURNED' && events.some((e) => e.status === 'DELIVERY_FAILED')
        ? ['DELIVERY_FAILED', 'RETURNED']
        : [currentStatus];
    for (const status of exceptions) {
      nodes.push({ status, reached: true, current: status === currentStatus, occurredAt: timeOf(status), exception: true });
    }
  }
  return nodes;
}
