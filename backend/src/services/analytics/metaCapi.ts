import { MetaEventPayload } from '@shared/analytics';
import type pg from 'pg';
import { getEnv } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { safeFetch } from '../../lib/safeFetch.js';
import { createMetaEventLog } from '../../repositories/analytics.repository.js';
import { withTransaction } from '../../lib/transaction.js';
import { MetaUserData } from './metaUserData.js';

/**
 * Sends an event to Meta's Conversions API (CAPI).
 * Never throws to its caller — all failures are caught, logged, and recorded.
 * Per spec 18 §6.8: a failure to send must never block, delay, fail, or roll back
 * the underlying customer action. There is no retry — a timeout may mean Meta
 * accepted the event, so a blind retry risks double-counting.
 */
export async function sendMetaCapiEvent(
  payload: MetaEventPayload,
  user: MetaUserData,
  ctx: { orderId?: string }
): Promise<void> {
  const env = getEnv();

  if (!env.META_CAPI_ACCESS_TOKEN || !env.META_PIXEL_ID) {
    await recordMetaEventLog({
      eventId: payload.event_id,
      eventName: payload.event_name,
      orderId: ctx.orderId,
      status: 'SKIPPED',
      httpStatus: undefined,
      errorMessage: undefined,
    });
    return;
  }

  const graphApiVersion = env.META_GRAPH_API_VERSION || 'v18.0';
  const endpoint = `https://graph.facebook.com/${graphApiVersion}/${env.META_PIXEL_ID}/events`;

  const body = JSON.stringify({
    data: [
      {
        event_name: payload.event_name,
        event_id: payload.event_id,
        event_time: payload.event_time,
        event_source_url: payload.event_source_url,
        user_data: user,
        custom_data: {
          value: payload.value,
          currency: payload.currency,
          content_name: payload.content_name,
          content_category: payload.content_category,
          content_type: payload.content_type,
          contents: payload.contents,
          content_ids: payload.content_ids,
          num_items: payload.num_items,
          search_string: payload.search_string,
        },
      },
    ],
  });

  try {
    const response = await safeFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.META_CAPI_ACCESS_TOKEN}`,
      },
      body,
      allowedHosts: ['graph.facebook.com'],
      timeoutMs: 3000,
      maxResponseBytes: 1024 * 100, // 100 KB
    });

    if (response.ok) {
      await recordMetaEventLog({
        eventId: payload.event_id,
        eventName: payload.event_name,
        orderId: ctx.orderId,
        status: 'SENT',
        httpStatus: response.status,
        errorMessage: undefined,
      });
    } else {
      const errorText = await response.text();
      const errorMsg = errorText.substring(0, 500); // Truncate to avoid log bloat
      logger.error(
        {
          event_id: payload.event_id,
          event_name: payload.event_name,
          status: response.status,
          error: errorMsg,
        },
        'meta capi request failed'
      );

      await recordMetaEventLog({
        eventId: payload.event_id,
        eventName: payload.event_name,
        orderId: ctx.orderId,
        status: 'FAILED',
        httpStatus: response.status,
        errorMessage: errorMsg,
      });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      {
        event_id: payload.event_id,
        event_name: payload.event_name,
        error: errorMsg.substring(0, 500),
      },
      'meta capi send error'
    );

    await recordMetaEventLog({
      eventId: payload.event_id,
      eventName: payload.event_name,
      orderId: ctx.orderId,
      status: 'FAILED',
      httpStatus: undefined,
      errorMessage: errorMsg.substring(0, 500),
    });
  }
}

interface MetaEventLogInput {
  eventId: string;
  eventName: string;
  orderId?: string;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  httpStatus?: number;
  errorMessage?: string;
}

async function recordMetaEventLog(input: MetaEventLogInput): Promise<void> {
  try {
    await withTransaction(async (db: pg.PoolClient) => {
      await createMetaEventLog(db, {
        event_id: input.eventId,
        event_name: input.eventName,
        order_id: input.orderId,
        channel: 'CAPI',
        status: input.status,
        http_status: input.httpStatus ?? null,
        error_message: input.errorMessage ?? null,
        value_amount: null,
      });
    });
  } catch (err) {
    logger.error(
      {
        event_id: input.eventId,
        error: err instanceof Error ? err.message : String(err),
      },
      'failed to record meta event log'
    );
  }
}
