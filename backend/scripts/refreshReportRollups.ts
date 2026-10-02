import { resetTransactionPool } from '../src/lib/transaction.js';
import { defaultRefreshRange, refreshReportRollups } from '../src/services/reportRollup.service.js';

/**
 * Recomputes the daily sales rollup (spec 20, 11-security-hardening §11.4). Run by the deployment's
 * scheduler (roughly hourly) — deliberately not an in-process timer. Idempotent.
 *
 *   npm run refresh:reports                                        # last 35 Dhaka days
 *   npm run refresh:reports -- --from=2026-01-01 --to=2026-03-31   # backfill
 */
function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main(): Promise<void> {
  const from = arg('from');
  const to = arg('to');
  if ((from && !to) || (!from && to)) throw new Error('Pass both --from and --to, or neither.');
  const range = from && to ? { from, to } : defaultRefreshRange();
  const result = await refreshReportRollups(range);
  console.log(`report rollup: ran=${result.ran} days=${result.days} from=${range.from} to=${range.to}`);
}

main()
  .catch((err: unknown) => {
    console.error('report rollup failed:', err instanceof Error ? err.message : 'unknown error');
    process.exitCode = 1;
  })
  .finally(() => resetTransactionPool());
