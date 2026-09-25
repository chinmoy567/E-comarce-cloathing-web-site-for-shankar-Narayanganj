import { withTransaction } from '../../lib/transaction.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import * as couponRepository from '../../repositories/coupon.repository.js';
import * as auditRepository from '../../repositories/audit.repository.js';
import type { PaginationQuery } from '../../lib/pagination.js';
import type {
  CouponRecord,
  CouponUsageRecord,
  CustomerEligibility,
  DiscountType,
} from '../../repositories/coupon.repository.js';

/**
 * Admin coupon CRUD, activate/deactivate, and delete-vs-archive (10-coupon-
 * discount §8.2–8.9, plan §5). Every mutation runs inside `withTransaction`
 * so the change and its `audit_logs` row commit together (06-rbac §5.15
 * rule 10), and every create/update normalizes and validates the fields the
 * database's own CHECK constraints also enforce, so a rejection surfaces as a
 * clean 400/409 rather than a raw constraint-violation 500.
 */

export type Actor = { userId: string; role: 'ADMIN' | 'MANAGER' };

export type CouponDisplayStatus = 'DRAFT' | 'ACTIVE' | 'DISABLED' | 'SCHEDULED' | 'EXPIRED' | 'ARCHIVED';

export type CouponResponse = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  discountType: DiscountType;
  discountValue: number;
  minimumOrderAmount: number | null;
  maximumDiscountAmount: number | null;
  startsAt: string;
  expiresAt: string;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number | null;
  customerEligibility: CustomerEligibility;
  eligibleCustomerId: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'DISABLED';
  displayStatus: CouponDisplayStatus;
  isArchived: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CouponDetailResponse = CouponResponse & {
  distinctCustomerCount: number;
};

/** §8.6/§8.29 derived display status — never touches the stored `status` column. */
export function computeDisplayStatus(coupon: CouponRecord, now: Date): CouponDisplayStatus {
  if (coupon.isArchived) return 'ARCHIVED';
  if (coupon.status !== 'ACTIVE') return coupon.status;
  if (now.getTime() < coupon.startsAt.getTime()) return 'SCHEDULED';
  if (now.getTime() > coupon.expiresAt.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

function toResponse(record: CouponRecord, now: Date = new Date()): CouponResponse {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    description: record.description,
    discountType: record.discountType,
    discountValue: record.discountValue,
    minimumOrderAmount: record.minimumOrderAmount,
    maximumDiscountAmount: record.maximumDiscountAmount,
    startsAt: record.startsAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    usageLimit: record.usageLimit,
    usageCount: record.usageCount,
    perCustomerLimit: record.perCustomerLimit,
    customerEligibility: record.customerEligibility,
    eligibleCustomerId: record.eligibleCustomerId,
    status: record.status,
    displayStatus: computeDisplayStatus(record, now),
    isArchived: record.isArchived,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Shared field validation for create/update — mirrors the migration's own CHECK constraints (§8.4b, §8.5). */
function assertFieldsValid(fields: {
  discountType: DiscountType;
  discountValue: number;
  maximumDiscountAmount: number | null | undefined;
  startsAt: Date;
  expiresAt: Date;
}): void {
  const details: Array<{ field: string; message: string }> = [];

  if (fields.discountValue <= 0) {
    details.push({ field: 'discountValue', message: 'Must be greater than zero.' });
  }
  if (fields.discountType === 'PERCENTAGE' && fields.discountValue > 100) {
    details.push({ field: 'discountValue', message: 'A percentage discount cannot exceed 100.' });
  }
  if (fields.maximumDiscountAmount != null && fields.discountType !== 'PERCENTAGE') {
    details.push({
      field: 'maximumDiscountAmount',
      message: 'A maximum discount amount only applies to percentage coupons.',
    });
  }
  if (fields.expiresAt.getTime() <= fields.startsAt.getTime()) {
    details.push({ field: 'expiresAt', message: 'Must be after the start date/time.' });
  }

  if (details.length > 0) {
    throw new ValidationError('The coupon fields are invalid.', details);
  }
}

export async function listCoupons(
  filter: couponRepository.ListCouponsFilter,
  pagination: PaginationQuery,
): Promise<{ items: CouponResponse[]; total: number }> {
  const { items, total } = await couponRepository.list(filter, pagination);
  const now = new Date();
  return { items: items.map((record) => toResponse(record, now)), total };
}

export async function getCoupon(id: string): Promise<CouponDetailResponse> {
  const record = await couponRepository.findById(id);
  if (!record) throw new NotFoundError('Coupon not found.');
  const distinctCustomerCount = await couponRepository.countDistinctCustomers(id);
  return { ...toResponse(record), distinctCustomerCount };
}

export async function listUsages(
  couponId: string,
  pagination: PaginationQuery,
): Promise<{ items: CouponUsageRecord[]; total: number }> {
  const coupon = await couponRepository.findById(couponId);
  if (!coupon) throw new NotFoundError('Coupon not found.');
  return couponRepository.listUsages(couponId, pagination);
}

export type CreateCouponInput = {
  code: string;
  name: string;
  description?: string | null;
  discountType: DiscountType;
  discountValue: number;
  minimumOrderAmount?: number | null;
  maximumDiscountAmount?: number | null;
  startsAt: string;
  expiresAt: string;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  customerEligibility?: CustomerEligibility;
  eligibleCustomerId?: string | null;
  status?: 'DRAFT' | 'ACTIVE' | 'DISABLED';
};

export async function createCoupon(actor: Actor, input: CreateCouponInput): Promise<CouponResponse> {
  const startsAt = new Date(input.startsAt);
  const expiresAt = new Date(input.expiresAt);

  assertFieldsValid({
    discountType: input.discountType,
    discountValue: input.discountValue,
    maximumDiscountAmount: input.maximumDiscountAmount,
    startsAt,
    expiresAt,
  });

  if (input.customerEligibility === 'SPECIFIC_CUSTOMER' && !input.eligibleCustomerId) {
    throw new ValidationError('The coupon fields are invalid.', [
      { field: 'eligibleCustomerId', message: 'Required when customer eligibility is SPECIFIC_CUSTOMER.' },
    ]);
  }

  return withTransaction(async (client) => {
    const created = await couponRepository.create(
      {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        discountType: input.discountType,
        discountValue: input.discountValue,
        minimumOrderAmount: input.minimumOrderAmount ?? null,
        maximumDiscountAmount: input.maximumDiscountAmount ?? null,
        startsAt,
        expiresAt,
        usageLimit: input.usageLimit ?? null,
        perCustomerLimit: input.perCustomerLimit ?? null,
        customerEligibility: input.customerEligibility ?? 'ALL_CUSTOMERS',
        eligibleCustomerId: input.eligibleCustomerId ?? null,
        status: input.status ?? 'DRAFT',
        createdBy: actor.userId,
      },
      client,
    );

    await auditRepository.append(
      {
        entityType: 'coupon',
        entityId: created.id,
        action: 'coupon_created',
        newValue: { code: created.code, discountType: created.discountType, discountValue: created.discountValue },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    return toResponse(created);
  });
}

export type UpdateCouponInput = Partial<Omit<CreateCouponInput, 'status'>>;

export async function updateCoupon(actor: Actor, id: string, input: UpdateCouponInput): Promise<CouponResponse> {
  return withTransaction(async (client) => {
    const existing = await couponRepository.findById(id, client);
    if (!existing) throw new NotFoundError('Coupon not found.');

    const discountType = input.discountType ?? existing.discountType;
    const discountValue = input.discountValue ?? existing.discountValue;
    const maximumDiscountAmount =
      input.maximumDiscountAmount !== undefined ? input.maximumDiscountAmount : existing.maximumDiscountAmount;
    const startsAt = input.startsAt !== undefined ? new Date(input.startsAt) : existing.startsAt;
    const expiresAt = input.expiresAt !== undefined ? new Date(input.expiresAt) : existing.expiresAt;

    assertFieldsValid({ discountType, discountValue, maximumDiscountAmount, startsAt, expiresAt });

    const previousValue = {
      code: existing.code,
      name: existing.name,
      discountType: existing.discountType,
      discountValue: existing.discountValue,
    };

    const updated = await couponRepository.update(
      id,
      {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.discountType !== undefined ? { discountType: input.discountType } : {}),
        ...(input.discountValue !== undefined ? { discountValue: input.discountValue } : {}),
        ...(input.minimumOrderAmount !== undefined ? { minimumOrderAmount: input.minimumOrderAmount } : {}),
        ...(input.maximumDiscountAmount !== undefined
          ? { maximumDiscountAmount: input.maximumDiscountAmount }
          : {}),
        ...(input.startsAt !== undefined ? { startsAt } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt } : {}),
        ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit } : {}),
        ...(input.perCustomerLimit !== undefined ? { perCustomerLimit: input.perCustomerLimit } : {}),
        ...(input.customerEligibility !== undefined ? { customerEligibility: input.customerEligibility } : {}),
        ...(input.eligibleCustomerId !== undefined ? { eligibleCustomerId: input.eligibleCustomerId } : {}),
        updatedBy: actor.userId,
      },
      client,
    );
    if (!updated) throw new NotFoundError('Coupon not found.');

    await auditRepository.append(
      {
        entityType: 'coupon',
        entityId: id,
        action: 'coupon_updated',
        previousValue,
        newValue: { code: updated.code, name: updated.name, discountType: updated.discountType, discountValue: updated.discountValue },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    return toResponse(updated);
  });
}

export async function setCouponStatus(
  actor: Actor,
  id: string,
  status: 'ACTIVE' | 'DISABLED',
): Promise<CouponResponse> {
  return withTransaction(async (client) => {
    const existing = await couponRepository.findById(id, client);
    if (!existing) throw new NotFoundError('Coupon not found.');

    const updated = await couponRepository.setStatus(id, status, actor.userId, client);
    if (!updated) throw new NotFoundError('Coupon not found.');

    await auditRepository.append(
      {
        entityType: 'coupon',
        entityId: id,
        action: 'coupon_status_changed',
        previousValue: { status: existing.status },
        newValue: { status: updated.status },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    return toResponse(updated);
  });
}

export type DeleteCouponResult = { deleted: true } | { archived: true };

/** §8.9: zero usages -> hard delete (audited); one or more -> archive instead (200, not an error). */
export async function deleteOrArchiveCoupon(actor: Actor, id: string): Promise<DeleteCouponResult> {
  return withTransaction(async (client) => {
    const existing = await couponRepository.findById(id, client);
    if (!existing) throw new NotFoundError('Coupon not found.');

    const usageCount = await couponRepository.countUsages(id, client);

    if (usageCount === 0) {
      await couponRepository.remove(id, client);
      await auditRepository.append(
        {
          entityType: 'coupon',
          entityId: id,
          action: 'coupon_deleted',
          previousValue: { code: existing.code },
          actorUserId: actor.userId,
          actorType: 'USER',
        },
        client,
      );
      return { deleted: true };
    }

    await couponRepository.setArchived(id, true, client);
    await auditRepository.append(
      {
        entityType: 'coupon',
        entityId: id,
        action: 'coupon_archived',
        previousValue: { isArchived: false },
        newValue: { isArchived: true },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );
    return { archived: true };
  });
}

// Re-exported so callers that only need the conflict-detection type don't
// need to import the repository module directly.
export { ConflictError };
