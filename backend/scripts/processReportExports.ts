import { resetTransactionPool } from '../src/lib/transaction.js';
import { processPendingExports } from '../src/services/reportExport.service.js';

/**
 * Processes queued report CSV exports (spec 20, §11.4: no heavy generation in the request path).
 * Run by the deployment's scheduler every minute or so. Each job is claimed with FOR UPDATE SKIP
 * LOCKED, so overlapping runs never process the same export. Output is counts only.
 */
processPendingExports()
  .then((n) => console.log(`report exports: processed=${n}`))
  .catch((err: unknown) => {
    console.error('report exports failed:', err instanceof Error ? err.message : 'unknown error');
    process.exitCode = 1;
  })
  .finally(() => resetTransactionPool());
