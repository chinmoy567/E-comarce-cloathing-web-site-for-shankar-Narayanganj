import { withTransaction } from '../lib/transaction.js';
import { refreshDailySales, type Range } from '../repositories/reports.repository.js';

/**
 * Daily sales rollup refresh (spec 20). Recomputes each Asia/Dhaka day in the window from `orders`
 * — recomputed, not incremented — so re-running is idempotent and a late cancellation is reflected
 * on the next run. Run by the deployment's scheduler (`npm run refresh:reports`, hourly), never by an
 * in-process timer (§11.4). A transaction-scoped advisory lock stops two overlapping runs from
 * doing the same work twice; the skipped run simply returns.
 */

/** Arbitrary constant namespace for this job's advisory lock. */
const ROLLUP_LOCK_KEY = 2_020_001;

export const DEFAULT_REFRESH_WINDOW_DAYS = 35;

const MS_PER_DAY = 86_400_000;
const dhakaToday = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function defaultRefreshRange(windowDays = DEFAULT_REFRESH_WINDOW_DAYS): Range {
  const to = dhakaToday();
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (windowDays - 1) * MS_PER_DAY).toISOString().slice(0, 10);
  return { from, to };
}

export async function refreshReportRollups(range: Range = defaultRefreshRange()): Promise<{ ran: boolean; days: number }> {
  return withTransaction(async (client) => {
    const lock = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS locked', [ROLLUP_LOCK_KEY]);
    if (!lock.rows[0]?.locked) return { ran: false, days: 0 };
    const days = await refreshDailySales(range, client);
    return { ran: true, days };
  });
}
