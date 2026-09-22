import { checkDatabaseReachable } from '../repositories/health.repository.js';

export type HealthResult = {
  status: 'ok';
  uptimeSeconds: number;
  database: 'ok' | 'unavailable';
};

/** Business layer for the health check. Never queries the database directly. */
export async function getHealth(): Promise<HealthResult> {
  const reachable = await checkDatabaseReachable();

  return {
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    database: reachable ? 'ok' : 'unavailable',
  };
}
