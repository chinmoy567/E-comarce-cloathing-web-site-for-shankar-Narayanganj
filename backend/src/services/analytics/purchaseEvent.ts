import { CURRENCY, META_EVENTS, type MetaEventPayload } from '@shared/analytics';
import { getEnv } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { withTransaction } from '../../lib/transaction.js';
import { claimPurchaseLog } from '../../repositories/analytics.repository.js';
import * as orderItemsRepository from '../../repositories/orderItems.repository.js';
import * as ordersRepository from '../../repositories/orders.repository.js';
import { sendMetaCapiEvent } from './metaCapi.js';
import { buildMetaUserData } from './metaUserData.js';

/**
 * Purchase event (08-analytics-meta §6.3): fired exactly once, only after the
 * write that sets `orderStatus` to CONFIRMED has committed. Called from
 * `confirmOrder` — the single place that performs that transition.
 *
 * Value is the order's stored, coupon-discounted `total_amount` (§6.3, §8.15c),
 * never anything client-supplied. Customer identifiers are hashed by
 * `buildMetaUserData`; bKash Transaction IDs and payment proofs are never read.
 * Fire-and-forget: a Meta failure must never affect the confirmation (§6.8), and
 * the `meta_event_log` unique index is the second guard against a duplicate.
 */
/** Deterministic Purchase event_id; uses the order number, never the internal id. */
export function purchaseEventIdFor(orderNumber: string): string {
  return `purchase:${orderNumber}`;
}

export function emitPurchaseForOrder(orderId: string): void {
  void (async () => {
    try {
      const data = await withTransaction(async (client) => {
        const order = await ordersRepository.getOrderById(orderId, { db: client });
        if (!order) return null;
        const items = await orderItemsRepository.listByOrderId(client, orderId);
        const { rows } = await client.query<{ email: string | null }>(
          'SELECT email FROM customers WHERE id = $1',
          [order.customer_id],
        );
        return { order, items, email: rows[0]?.email ?? undefined };
      });
      if (!data) return;

      const { order, items, email } = data;
      const [firstName, ...rest] = (order.full_name ?? '').trim().split(/\s+/);
      const user = buildMetaUserData({
        email,
        phone: order.phone_number ?? undefined,
        firstName: firstName || undefined,
        lastName: rest.length ? rest.join(' ') : undefined,
      });

      const payload: MetaEventPayload = {
        event_name: META_EVENTS.PURCHASE,
        event_id: purchaseEventIdFor(order.order_number),
        event_time: Math.floor(Date.now() / 1000),
        event_source_url: getEnv().PUBLIC_SITE_URL,
        content_type: 'product',
        content_ids: items.map((i) => i.product_variant_id ?? i.product_id),
        contents: items.map((i) => ({
          id: i.product_variant_id ?? i.product_id,
          quantity: i.quantity,
          item_price: i.unitPrice,
        })),
        num_items: items.reduce((sum, i) => sum + i.quantity, 0),
        value: order.total_amount,
        currency: CURRENCY,
      };

      // Claim the exactly-once slot BEFORE sending (§6.3): a second emission
      // loses the unique-index race and makes no outbound call.
      const logId = await withTransaction((client) =>
        claimPurchaseLog(client, {
          event_id: payload.event_id,
          order_id: order.id,
          value_amount: order.total_amount,
        }),
      );
      if (!logId) return;

      await sendMetaCapiEvent(payload, user, { orderId: order.id, logId, valueAmount: order.total_amount });
    } catch (err) {
      logger.error(
        { orderId, error: err instanceof Error ? err.message : String(err) },
        'failed to emit meta purchase event',
      );
    }
  })();
}
