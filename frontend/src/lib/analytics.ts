'use client';

import { META_EVENTS, MetaEventName, MetaEventPayload, newEventId } from '@shared/analytics';

/**
 * Track a Meta Pixel and Conversions API event simultaneously.
 * Both channels send the same event with the same event_id so Meta can deduplicate.
 * (§6.4, §6.9 — shared contract, single call site for both channels).
 *
 * Note: Purchase events cannot be sent from the client — only the backend can
 * send them (§6.3, protected by the ingestion endpoint validation).
 */
export function track(
  eventName: Exclude<MetaEventName, typeof META_EVENTS.PURCHASE>,
  payload: Partial<MetaEventPayload>
): void {
  const eventId = newEventId();
  const eventTime = Math.floor(Date.now() / 1000);

  // Fire the Pixel-side copy (if Pixel is loaded).
  // fbq is declared by the Meta Pixel script in the <head>.
  if (typeof window !== 'undefined' && typeof (window as any).fbq === 'function') {
    const params: Record<string, any> = {};

    if (payload.content_ids?.length) params.content_ids = payload.content_ids;
    if (payload.contents?.length) params.contents = payload.contents;
    if (payload.content_name) params.content_name = payload.content_name;
    if (payload.content_category) params.content_category = payload.content_category;
    if (payload.search_string) params.search_string = payload.search_string;
    if (payload.value) params.value = payload.value;
    if (payload.currency) params.currency = payload.currency;
    if (payload.num_items) params.num_items = payload.num_items;
    if (payload.content_type) params.content_type = payload.content_type;

    (window as any).fbq('track', eventName, params, { eventID: eventId });
  }

  // Fire the CAPI copy (server-forwarded) with the same event_id.
  void sendAnalyticsEventToBackend({
    eventName,
    eventId,
    eventTime,
    payload,
  });
}

interface SendEventInput {
  eventName: Exclude<MetaEventName, typeof META_EVENTS.PURCHASE>;
  eventId: string;
  eventTime: number;
  payload: Partial<MetaEventPayload>;
}

async function sendAnalyticsEventToBackend(input: SendEventInput): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const url = new URL('/api/analytics/event', window.location.origin);

    await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventName: input.eventName,
        eventId: input.eventId,
        eventSourceUrl: window.location.href,
        payload: {
          contentIds: input.payload.content_ids,
          searchString: input.payload.search_string,
        },
      }),
    });
  } catch (err) {
    // Silently ignore failures — analytics must never break the user experience.
    console.error('Analytics event send failed:', err);
  }
}

/**
 * Initialize the Meta Pixel script (if NEXT_PUBLIC_META_PIXEL_ID is set).
 * Call this once at app startup (e.g., in the root layout component).
 */
export function initPixel(): void {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  if (!pixelId) return; // Pixel is disabled

  if (typeof window !== 'undefined') {
    // Declare fbq globally
    (window as any).fbq =
      (window as any).fbq ||
      function () {
        ((window as any).fbq.q = (window as any).fbq.q || []).push(arguments);
      };

    // Initialize Pixel
    (window as any).fbq('init', pixelId);
    (window as any).fbq('track', 'PageView');

    // Load the Pixel script from Meta
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://connect.facebook.net/en_US/fbevents.js`;
    document.head.appendChild(script);
  }
}
