import { Request, Response } from 'express';
import { MetaEventPayload, newEventId } from '@shared/analytics';
import { sendMetaCapiEvent } from '../services/analytics/metaCapi.js';
import { buildMetaUserData } from '../services/analytics/metaUserData.js';
import { resolveContents } from '../services/analytics/serverValue.js';
import { AnalyticsEventRequest } from '../validation/analytics.validation.js';
import { logger } from '../lib/logger.js';

/**
 * POST /api/analytics/event — public analytics event ingestion endpoint.
 * Browser-initiated events (PageView, ViewContent, Search, AddToCart, etc.)
 * are forwarded to Meta's Conversions API with the same event_id the Pixel used.
 * §6.8: failures are logged but never block the client request.
 *
 * Validation is done by the middleware before this controller is called.
 */
export async function ingestAnalyticsEvent(req: Request, res: Response): Promise<void> {
  const body = req.body as AnalyticsEventRequest;

  const payload: MetaEventPayload = {
    event_name: body.eventName,
    event_id: body.eventId,
    event_time: Math.floor(Date.now() / 1000),
    event_source_url: body.eventSourceUrl,
    content_ids: body.payload.contentIds,
    search_string: body.payload.searchString,
  };

  // Values are recomputed from catalogue prices — the client never supplies one (§8.31).
  // Resolution failure only drops value; it must never affect the response (§6.8).
  if (body.payload.contents?.length) {
    try {
      const resolved = await resolveContents(body.payload.contents);
      if (resolved) {
        payload.content_type = 'product';
        payload.content_ids = resolved.contents.map((c) => c.id);
        payload.contents = resolved.contents;
        payload.num_items = resolved.contents.reduce((n, c) => n + c.quantity, 0);
        payload.value = resolved.value;
        payload.currency = resolved.currency;
      }
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'meta value resolution failed');
    }
  }

  // Build hashed user data from request context (IP, user agent).
  // No customer account is available at this public endpoint, so only
  // network/browser data is sent (no email/phone/name hashes).
  const userIp = req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0];
  const userAgent = req.get('user-agent');

  const user = buildMetaUserData({
    ip: userIp,
    userAgent: userAgent,
    fbp: body.fbp,
    fbc: body.fbc,
  });

  // Fire-and-forget: send to Meta without awaiting or blocking the response.
  void sendMetaCapiEvent(payload, user, {}).catch((err) => {
    logger.error(
      {
        event_id: payload.event_id,
        error: err instanceof Error ? err.message : String(err),
      },
      'failed to send meta capi event'
    );
  });

  res.status(200).json({ success: true, eventId: body.eventId });
}
