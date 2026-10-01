import { getEnv } from '../config/env.js';
import { run } from '../repositories/db.js';

/**
 * Dashboard summary counters (spec 13, 05-admin §5.2). Every number is a live
 * count over the same predicates the order list filters use, so a card and the
 * list it links to can never disagree. Nothing here is stored.
 *
 * "New orders since the actor's last view": the page passes the time of its
 * previous visit as `since` (kept in the browser); with none, the last 24
 * hours. The server clamps `since` so a bad value cannot widen the scan.
 */

export type DashboardSummary = {
  newOrders: number;
  awaitingBkashVerification: number;
  codAwaitingConfirmation: number;
  paymentRejectedAwaitingResubmission: number;
  staleUnconfirmed: number;
  shipmentCreationFailed: number;
  codCollectionDiscrepancies: number;
  totalOrders: number;
};

const MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export async function getDashboardSummary(since?: Date): Promise<DashboardSummary> {
  const now = Date.now();
  const floor = new Date(now - MAX_LOOKBACK_MS);
  const effectiveSince =
    since && since.getTime() <= now ? (since.getTime() < floor.getTime() ? floor : since) : new Date(now - 24 * 60 * 60 * 1000);
  const staleHours = getEnv().STALE_ORDER_HOURS;

  return run(undefined, async (client) => {
    const { rows } = await client.query<Record<string, string>>(
      `SELECT
         count(*) FILTER (WHERE o.created_at >= $1)::text AS new_orders,
         count(*) FILTER (WHERE o.payment_method = 'BKASH' AND o.payment_status = 'PENDING_VERIFICATION'
                            AND o.order_status = 'PENDING_CONFIRMATION')::text AS awaiting_bkash,
         count(*) FILTER (WHERE o.order_status = 'COD_VERIFICATION_PENDING')::text AS cod_awaiting,
         count(*) FILTER (WHERE o.payment_method = 'BKASH' AND o.payment_status = 'REJECTED'
                            AND o.order_status = 'PENDING_CONFIRMATION')::text AS rejected_awaiting,
         count(*) FILTER (WHERE o.order_status IN ('PENDING_CONFIRMATION','COD_VERIFICATION_PENDING')
                            AND o.created_at < now() - ($2::int * interval '1 hour'))::text AS stale,
         count(*) FILTER (WHERE sh.shipment_status = 'CREATION_FAILED')::text AS creation_failed,
         count(*) FILTER (WHERE o.payment_method = 'COD' AND o.order_status = 'DELIVERED'
                            AND o.payment_status = 'PENDING_COLLECTION')::text AS cod_discrepancy,
         count(*)::text AS total_orders
       FROM orders o
       LEFT JOIN shipments sh ON sh.order_id = o.id`,
      [effectiveSince, staleHours],
    );
    const r = rows[0]!;
    return {
      newOrders: Number(r.new_orders),
      awaitingBkashVerification: Number(r.awaiting_bkash),
      codAwaitingConfirmation: Number(r.cod_awaiting),
      paymentRejectedAwaitingResubmission: Number(r.rejected_awaiting),
      staleUnconfirmed: Number(r.stale),
      shipmentCreationFailed: Number(r.creation_failed),
      codCollectionDiscrepancies: Number(r.cod_discrepancy),
      totalOrders: Number(r.total_orders),
    };
  });
}
