import { resetTransactionPool } from '../src/lib/transaction.js';
import { pollCourierStatuses } from '../src/services/courierSync.service.js';

/**
 * One courier status polling pass (spec 15, 04-courier §4.6). Run by the deployment's
 * scheduler (cron / platform scheduled job, roughly every 15 minutes) — deliberately not an
 * in-process timer, so heavy work never shares the request path (§11.4).
 *
 * Every update goes through the same idempotent applier the webhook uses, so overlapping
 * runs or a webhook reporting the same transition apply it once. Output names counts only —
 * never a tracking id, customer detail or credential.
 */
async function main(): Promise<void> {
  const summary = await pollCourierStatuses();
  console.log(
    `courier poll: examined=${summary.examined} providerCalls=${summary.providerCalls} applied=${summary.applied}`,
  );
}

main()
  .catch((err: unknown) => {
    console.error('courier poll failed:', err instanceof Error ? err.message : 'unknown error');
    process.exitCode = 1;
  })
  .finally(() => resetTransactionPool());
