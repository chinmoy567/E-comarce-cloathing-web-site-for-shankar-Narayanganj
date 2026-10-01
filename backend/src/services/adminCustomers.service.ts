import { withTransaction } from '../lib/transaction.js';
import { NotFoundError } from '../lib/errors.js';
import type { PaginationQuery } from '../lib/pagination.js';
import { append as appendAudit } from '../repositories/audit.repository.js';
import * as customersRepo from '../repositories/adminCustomers.repository.js';
import * as ordersRepository from '../repositories/orders.repository.js';
import type { AccountType } from '../types/enums.js';

/**
 * Admin customer management (spec 13, 05-admin §5.7).
 *
 * Payment-related data is OMITTED (not nulled) from payloads when the actor
 * lacks `payment.view`, so the absence of the key is not itself informative.
 */

type ContactPatch = { fullName?: string; email?: string | null; detailedAddress?: string; postalCode?: string | null };

function toCustomer(row: customersRepo.AdminCustomerRow) {
  return {
    id: row.id,
    accountType: row.account_type,
    isGuest: row.account_type === 'GUEST',
    fullName: row.full_name,
    phoneNumber: row.phone_number,
    email: row.email,
    address: {
      division: row.division,
      district: row.district,
      areaUnitType: row.area_unit_type,
      areaUnitName: row.area_unit_name,
      wardUnitType: row.ward_unit_type,
      wardUnitName: row.ward_unit_name,
      detailedAddress: row.detailed_address,
      postalCode: row.postal_code,
    },
    orderCount: row.order_count,
    lastOrderAt: row.last_order_at ? row.last_order_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listCustomers(filter: { q?: string; accountType?: AccountType }, pagination: PaginationQuery) {
  const { items, total } = await customersRepo.list(filter, pagination);
  return { items: items.map(toCustomer), total };
}

export async function getCustomer(id: string, permissions: readonly string[]) {
  const row = await customersRepo.findById(id);
  if (!row) throw new NotFoundError('Customer not found.');
  const customer = toCustomer(row);
  if (!permissions.includes('payment.view')) return customer;
  return { ...customer, paymentSummary: await customersRepo.paymentStats(id) };
}

/**
 * Every order under this customer record. Guest and registered orders share
 * one `customers` row (§2.9.4), so both sets come back together.
 */
export async function listCustomerOrders(id: string, pagination: PaginationQuery, permissions: readonly string[]) {
  const row = await customersRepo.findById(id);
  if (!row) throw new NotFoundError('Customer not found.');
  const { items, total } = await ordersRepository.listOrders({ customer_id: id }, pagination);
  const canSeePayments = permissions.includes('payment.view');
  return {
    total,
    items: items.map((o) => {
      const base = {
        id: o.id,
        order_number: o.order_number,
        order_status: o.order_status,
        shipment_status: o.shipment_status,
        total_amount: o.total_amount,
        created_at: o.created_at,
        is_guest_order: o.is_guest_order,
      };
      return canSeePayments
        ? { ...base, payment_method: o.payment_method, payment_status: o.payment_status, bkash_transaction_id: o.bkash_transaction_id }
        : base;
    }),
  };
}

export async function updateCustomer(id: string, patch: ContactPatch, actor: { userId: string }, requestId?: string) {
  return withTransaction(async (client) => {
    const before = await customersRepo.findById(id, client);
    if (!before) throw new NotFoundError('Customer not found.');
    const after = await customersRepo.updateContact(id, patch, client);

    const prevMap: Record<keyof ContactPatch, unknown> = {
      fullName: before.full_name,
      email: before.email,
      detailedAddress: before.detailed_address,
      postalCode: before.postal_code,
    };
    const previous: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};
    for (const key of Object.keys(patch) as Array<keyof ContactPatch>) {
      if (patch[key] !== undefined && patch[key] !== prevMap[key]) {
        previous[key] = prevMap[key];
        next[key] = patch[key];
      }
    }
    if (Object.keys(next).length > 0) {
      await appendAudit(
        {
          entityType: 'customer',
          entityId: id,
          action: 'customer_updated',
          previousValue: previous,
          newValue: next,
          actorUserId: actor.userId,
          actorType: 'USER',
          requestId,
        },
        client,
      );
    }
    return toCustomer(after!);
  });
}
