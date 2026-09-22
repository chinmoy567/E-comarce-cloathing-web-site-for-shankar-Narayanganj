import * as auditRepository from '../repositories/audit.repository.js';
import type { PaginationQuery } from '../lib/pagination.js';

export async function listAuditLogs(filter: { entityType?: string }, pagination: PaginationQuery) {
  return auditRepository.listAll(filter, pagination);
}
