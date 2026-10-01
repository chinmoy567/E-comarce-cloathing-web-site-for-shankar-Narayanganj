import { RateLimiterRes } from 'rate-limiter-flexible';
import { getEnv } from '../../config/env.js';
import type { RateLimiterDefinition } from '../../config/rateLimits.js';
import {
  ConflictError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  UnprocessableError,
} from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { normalizeBdPhone } from '../../lib/phone.js';
import { getLimiterInstance } from '../../lib/rateLimiterStore.js';
import { withTransaction } from '../../lib/transaction.js';
import * as auditRepository from '../../repositories/audit.repository.js';
import * as customersRepository from '../../repositories/customers.repository.js';
import * as ordersRepository from '../../repositories/orders.repository.js';
import * as riskRepository from '../../repositories/customerRiskChecks.repository.js';
import type { RiskCheckRecord, RiskLevelValue } from '../../repositories/customerRiskChecks.repository.js';
import { getRiskProvider } from './providers/registry.js';
import { RiskProviderError, type RiskCheckResult } from './providers/types.js';

/**
 * Customer risk check (spec 16, 09-fraud-risk-check §7).
 *
 * A review step, not a gate: it advises the Admin/Manager and never blocks,
 * holds, cancels or flags an order, and writes no order/payment/shipment
 * status (§7.8, §7.11). The cache key is `customer_id` (§7.6) — `getRiskCheck`
 * never calls the provider; only `runRiskCheck`, an explicit action, does.
 *
 * Lives under services/fraud/ and never imports services/courier/ (§7.3).
 */

/** The order statuses in which a (fresh) check may run — enforced server-side (§7.2). */
const CHECKABLE_STATUSES = ['CONFIRMED', 'PROCESSING'] as const;

const MSG_NEVER_CHECKED = 'No risk check has been run for this customer yet.';
const MSG_CHECK_FAILED = 'Risk check unavailable — please try again.';
const MSG_NO_HISTORY = 'No courier history found.';
const MSG_LEVEL_UNDETERMINED = 'A risk level could not be determined from the courier data.';
const MSG_BLOCKED = 'A new check can be run while the order is Confirmed or Processing.';
const MSG_BAD_PHONE = "This customer's phone number could not be checked.";
const MSG_UNCONFIGURED = 'Risk check is not configured.';

/**
 * The ONLY shape returned to the frontend. It has no representation for
 * `raw_result` or any provider-specific key — that is structural (§7.6, §7.8).
 */
export type RiskCheckResponse = {
  available: boolean;
  phoneNumber: string;
  riskLevel: RiskLevelValue;
  riskScore: number | null;
  totalOrders: number | null;
  successfulOrders: number | null;
  returnedOrders: number | null;
  successRatePercent: number | null;
  checkedAt: string | null;
  checkedByUserIdentifier: string | null;
  canTriggerFreshCheck: boolean;
  triggerBlockedReason: string | null;
  message: string | null;
};

export type RiskActor = { userId: string };

/** 429 from the per-customer limiter; carries the Retry-After the controller must set. */
export class CustomerRiskRateLimitError extends RateLimitError {
  constructor(readonly retryAfterSec: number) {
    super('Too many checks for this customer. Please try again later.');
  }
}

function isCheckable(status: string): boolean {
  return (CHECKABLE_STATUSES as readonly string[]).includes(status);
}

/** Computed for display only, when both inputs exist and total > 0; never stored (§7.5). */
function successRatePercent(total: number | null, success: number | null): number | null {
  if (total === null || success === null || total <= 0) return null;
  return Math.round((success / total) * 100);
}

function messageFor(record: RiskCheckRecord): string | null {
  if (record.riskLevel === 'CHECK_FAILED') return MSG_CHECK_FAILED;
  if (record.riskLevel === 'UNKNOWN') return record.totalOrders === null ? MSG_NO_HISTORY : MSG_LEVEL_UNDETERMINED;
  return null;
}

function toResponse(record: RiskCheckRecord | null, customerPhone: string, orderStatus: string): RiskCheckResponse {
  const canTrigger = isCheckable(orderStatus);
  const gate = { canTriggerFreshCheck: canTrigger, triggerBlockedReason: canTrigger ? null : MSG_BLOCKED };

  if (!record) {
    return {
      available: false,
      phoneNumber: customerPhone,
      riskLevel: 'UNKNOWN',
      riskScore: null,
      totalOrders: null,
      successfulOrders: null,
      returnedOrders: null,
      successRatePercent: null,
      checkedAt: null,
      checkedByUserIdentifier: null,
      ...gate,
      message: MSG_NEVER_CHECKED,
    };
  }

  return {
    available: true,
    phoneNumber: record.phoneNumber,
    riskLevel: record.riskLevel,
    riskScore: record.riskScore,
    totalOrders: record.totalOrders,
    successfulOrders: record.successfulOrders,
    returnedOrders: record.returnedOrders,
    successRatePercent: successRatePercent(record.totalOrders, record.successfulOrders),
    checkedAt: record.checkedAt.toISOString(),
    checkedByUserIdentifier: record.checkedByUserIdentifier,
    ...gate,
    message: messageFor(record),
  };
}

async function loadOrderAndCustomer(orderNumber: string) {
  const order = await ordersRepository.findByOrderNumber(orderNumber.toUpperCase());
  if (!order) throw new NotFoundError('Order not found.');
  const customer = await customersRepository.findById(order.customer_id);
  if (!customer) throw new NotFoundError('Order not found.');
  return { order, customer };
}

/**
 * GET — the cached result for this order's CUSTOMER (any order). NEVER calls the provider.
 * Guest and registered customers behave identically: both are phone-keyed `customers` rows (§7.6).
 */
export async function getRiskCheck(orderNumber: string): Promise<RiskCheckResponse> {
  const { order, customer } = await loadOrderAndCustomer(orderNumber);
  const latest = await riskRepository.findLatestForCustomer(customer.id);
  return toResponse(latest, customer.phoneNumber, order.order_status);
}

/** Per-customer limit on FRESH checks (§7.6, §11.3), env-tunable via RL_RISK_CHECK_*. */
async function consumeCustomerBudget(customerId: string): Promise<void> {
  const env = getEnv();
  const definition: RateLimiterDefinition = {
    name: 'riskCheckCustomer',
    keyStrategy: 'identifier+ip',
    identifierSource: 'none',
    max: env.RL_RISK_CHECK_MAX,
    windowSec: env.RL_RISK_CHECK_WINDOW_SEC,
  };
  try {
    await getLimiterInstance(definition, 'identifier').consume(customerId);
  } catch (rejection) {
    if (!(rejection instanceof RateLimiterRes)) throw rejection;
    throw new CustomerRiskRateLimitError(Math.max(1, Math.ceil(rejection.msBeforeNext / 1000)));
  }
}

type Outcome = {
  riskLevel: RiskLevelValue;
  riskScore: number | null;
  totalOrders: number | null;
  successfulOrders: number | null;
  returnedOrders: number | null;
  rawResult: unknown;
};

/**
 * POST — an explicit, Admin/Manager-initiated fresh check (§7.2). Always calls the provider once
 * and appends one row. A provider failure is recorded as CHECK_FAILED and returned as a normal 200
 * result — it never blocks or alters the order (§7.8).
 */
export async function runRiskCheck(orderNumber: string, actor: RiskActor, requestId?: string): Promise<RiskCheckResponse> {
  const { order, customer } = await loadOrderAndCustomer(orderNumber);

  // 1. Server-side status gate (§7.2) — not just a hidden button.
  if (!isCheckable(order.order_status)) {
    throw new ConflictError(MSG_BLOCKED, undefined, 'RISK_CHECK_NOT_ALLOWED');
  }

  // 2. Per-customer limit on fresh checks.
  await consumeCustomerBudget(customer.id);

  // 3. Normalize/validate before any outbound call (§7.9).
  let phone: string;
  try {
    phone = normalizeBdPhone(customer.phoneNumber);
  } catch {
    throw new UnprocessableError(MSG_BAD_PHONE, undefined, 'INVALID_PHONE_NUMBER');
  }

  const provider = getRiskProvider();
  if (!provider.isConfigured()) {
    throw new ServiceUnavailableError(MSG_UNCONFIGURED, undefined, 'RISK_PROVIDER_UNCONFIGURED');
  }

  // 4. Provider call — outside any DB transaction. Only the normalized phone is sent.
  let outcome: Outcome;
  try {
    const result: RiskCheckResult = await provider.check(phone);
    outcome = {
      riskLevel: result.riskLevel,
      riskScore: result.riskScore,
      totalOrders: result.totalOrders,
      successfulOrders: result.successfulOrders,
      returnedOrders: result.returnedOrders,
      rawResult: result.raw,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    const detail = err instanceof RiskProviderError ? err.detail : undefined;
    logger.warn({ orderNumber: order.order_number, reason: message, ...detail }, 'Customer risk check failed');
    outcome = {
      riskLevel: 'CHECK_FAILED',
      riskScore: null,
      totalOrders: null,
      successfulOrders: null,
      returnedOrders: null,
      // Sanitised: message + detail only, never credentials or the request.
      rawResult: { error: message, ...detail },
    };
  }

  // 5 + 8. Append the row and its audit entry atomically (§7.6, §7.9).
  const record = await withTransaction(async (client) => {
    const row = await riskRepository.insert(
      {
        customerId: customer.id,
        orderId: order.id,
        phoneNumber: phone,
        provider: provider.key,
        ...outcome,
        checkedBy: actor.userId,
      },
      client,
    );
    await auditRepository.append(
      {
        entityType: 'order',
        entityId: order.id,
        action: 'customer_risk_check',
        newValue: { orderNumber: order.order_number, customerId: customer.id, riskLevel: row.riskLevel, riskCheckId: row.id },
        actorUserId: actor.userId,
        actorType: 'USER',
        requestId: requestId ?? null,
      },
      client,
    );
    return row;
  });

  return toResponse(record, phone, order.order_status);
}
