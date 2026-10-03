import { withTransaction } from '../../lib/transaction.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import type { PaginationQuery } from '../../lib/pagination.js';
import * as auditRepository from '../../repositories/audit.repository.js';
import * as shippingRepository from '../../repositories/shipping.repository.js';
import type {
  ShippingDistrictMapping,
  ShippingRate,
  ShippingStrategy,
  ShippingZoneWithDetails,
  UnmatchedDistrict,
} from '../../repositories/shipping.repository.js';
import type pg from 'pg';

/**
 * Admin management of the shipping zone/rate table (spec 21, `system.configure`).
 *
 * Every write runs in one transaction with its `audit_logs` row (06-rbac §5.16, 11-security §11.7):
 * a shipping-rate change moves money and must be attributable. Zones, districts and rates are never
 * hard-deleted — a rate change is an INSERT with a newer `effective_from`, and a district is removed
 * by replacing the zone's district list.
 */

export type Actor = { userId: string };

export type RateInput = { strategy: ShippingStrategy; flatAmount?: number; freeOverAmount?: number };

export type ZoneView = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
  districts: ShippingDistrictMapping[];
  currentRate: {
    id: string;
    strategy: ShippingStrategy;
    flatAmount: number;
    freeOverAmount: number | null;
    effectiveFrom: string;
  } | null;
};

export type RateView = {
  id: string;
  strategy: ShippingStrategy;
  flatAmount: number;
  freeOverAmount: number | null;
  effectiveFrom: string;
  createdBy: string | null;
};

function toRateView(rate: ShippingRate): RateView {
  return {
    id: rate.id,
    strategy: rate.strategy,
    flatAmount: rate.flatAmount,
    freeOverAmount: rate.freeOverAmount,
    effectiveFrom: rate.effectiveFrom.toISOString(),
    createdBy: rate.createdBy,
  };
}

function toZoneView(zone: ShippingZoneWithDetails): ZoneView {
  return {
    id: zone.id,
    code: zone.code,
    name: zone.name,
    isDefault: zone.isDefault,
    sortOrder: zone.sortOrder,
    districts: zone.districts,
    currentRate: zone.currentRate
      ? {
          id: zone.currentRate.id,
          strategy: zone.currentRate.strategy,
          flatAmount: zone.currentRate.flatAmount,
          freeOverAmount: zone.currentRate.freeOverAmount,
          effectiveFrom: zone.currentRate.effectiveFrom.toISOString(),
        }
      : null,
  };
}

function rateSnapshot(rate: Pick<ShippingRate, 'strategy' | 'flatAmount' | 'freeOverAmount'> | null) {
  return rate ? { strategy: rate.strategy, flatAmount: rate.flatAmount, freeOverAmount: rate.freeOverAmount } : null;
}

function normalizeRate(input: RateInput): { strategy: ShippingStrategy; flatAmount: number; freeOverAmount: number | null } {
  return {
    strategy: input.strategy,
    // FREE stores 0 (the schema requires NOT NULL flat_amount).
    flatAmount: input.strategy === 'FREE' ? 0 : (input.flatAmount ?? 0),
    freeOverAmount: input.strategy === 'FREE_OVER_THRESHOLD' ? (input.freeOverAmount ?? null) : null,
  };
}

/** Rejects a list that maps the same district at the same metro specificity twice. */
function assertNoDuplicateDistricts(districts: ShippingDistrictMapping[]): void {
  const seen = new Set<string>();
  for (const d of districts) {
    const key = `${shippingRepository.districtKey(d.district)}|${d.metroOnly}`;
    if (seen.has(key)) {
      throw new ValidationError('A district appears more than once in this list.', [
        { field: 'districts', message: `"${d.district}" is listed twice.` },
      ]);
    }
    seen.add(key);
  }
}

async function requireZone(id: string, client: pg.PoolClient) {
  const zone = await shippingRepository.findZoneById(id, client);
  if (!zone) throw new NotFoundError('Shipping zone not found.');
  return zone;
}

export async function listZones(): Promise<ZoneView[]> {
  const zones = await withTransaction((client) => shippingRepository.listZonesWithDetails(new Date(), client));
  return zones.map(toZoneView);
}

export async function createZone(
  actor: Actor,
  input: { code: string; name: string; sortOrder?: number; districts: ShippingDistrictMapping[]; rate?: RateInput },
): Promise<ZoneView> {
  assertNoDuplicateDistricts(input.districts);
  if (input.districts.length > 0 && !input.rate) {
    throw new ValidationError('A rate is required when districts are assigned.', [
      { field: 'rate', message: 'Required when districts are assigned.' },
    ]);
  }

  return withTransaction(async (client) => {
    const zone = await shippingRepository.createZone(
      { code: input.code, name: input.name, sortOrder: input.sortOrder ?? 0 },
      client,
    );
    let rate: ShippingRate | null = null;
    if (input.rate) {
      rate = await shippingRepository.insertRate(
        { zoneId: zone.id, ...normalizeRate(input.rate), createdBy: actor.userId },
        client,
      );
    }
    if (input.districts.length > 0) {
      await shippingRepository.replaceDistricts(zone.id, input.districts, client);
    }

    await auditRepository.append(
      {
        entityType: 'shipping_zone',
        entityId: zone.id,
        action: 'shipping_zone_created',
        newValue: { code: zone.code, name: zone.name, districts: input.districts, rate: rateSnapshot(rate) },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    return toZoneView({ ...zone, districts: input.districts, currentRate: rate });
  });
}

export async function updateZone(
  actor: Actor,
  id: string,
  input: { name?: string; sortOrder?: number; districts?: ShippingDistrictMapping[] },
): Promise<ZoneView> {
  if (input.districts) assertNoDuplicateDistricts(input.districts);

  return withTransaction(async (client) => {
    const existing = await requireZone(id, client);
    const previousDistricts = await shippingRepository.listDistricts(id, client);

    const now = new Date();
    if (input.districts && input.districts.length > 0) {
      const current = await shippingRepository.findCurrentRate(id, now, client);
      if (!current) {
        throw new ValidationError('Set a rate before assigning districts to this zone.', [
          { field: 'districts', message: 'This zone has no rate yet.' },
        ]);
      }
    }

    if (input.name !== undefined || input.sortOrder !== undefined) {
      await shippingRepository.updateZone(id, { name: input.name, sortOrder: input.sortOrder }, client);
    }
    if (input.districts) {
      await shippingRepository.replaceDistricts(id, input.districts, client);
    }

    const [after] = (await shippingRepository.listZonesWithDetails(now, client)).filter((z) => z.id === id);
    if (!after) throw new NotFoundError('Shipping zone not found.');

    await auditRepository.append(
      {
        entityType: 'shipping_zone',
        entityId: id,
        action: 'shipping_zone_updated',
        previousValue: { name: existing.name, sortOrder: existing.sortOrder, districts: previousDistricts },
        newValue: { name: after.name, sortOrder: after.sortOrder, districts: after.districts },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    return toZoneView(after);
  });
}

export async function makeDefault(actor: Actor, id: string): Promise<ZoneView> {
  return withTransaction(async (client) => {
    const target = await requireZone(id, client);
    if (target.isDefault) {
      const [same] = (await shippingRepository.listZonesWithDetails(new Date(), client)).filter((z) => z.id === id);
      return toZoneView(same!);
    }

    const now = new Date();
    const rate = await shippingRepository.findCurrentRate(id, now, client);
    if (!rate) {
      throw new ValidationError('Set a rate before making this zone the default.', [
        { field: 'id', message: 'This zone has no rate yet.' },
      ]);
    }

    const previousDefault = await shippingRepository.findDefaultZone(client);
    await shippingRepository.makeDefault(id, client);

    await auditRepository.append(
      {
        entityType: 'shipping_zone',
        entityId: id,
        action: 'shipping_default_zone_changed',
        previousValue: previousDefault ? { code: previousDefault.code } : null,
        newValue: { code: target.code },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    const [after] = (await shippingRepository.listZonesWithDetails(now, client)).filter((z) => z.id === id);
    return toZoneView(after!);
  });
}

/** Supersedes the zone's rate: an INSERT with a newer `effective_from`, never a mutation. */
export async function createRate(actor: Actor, zoneId: string, input: RateInput): Promise<RateView> {
  return withTransaction(async (client) => {
    const zone = await requireZone(zoneId, client);
    const previous = await shippingRepository.findCurrentRate(zoneId, new Date(), client);
    const created = await shippingRepository.insertRate(
      { zoneId, ...normalizeRate(input), createdBy: actor.userId },
      client,
    );

    await auditRepository.append(
      {
        entityType: 'shipping_rate',
        entityId: created.id,
        action: 'shipping_rate_changed',
        previousValue: { zoneCode: zone.code, ...rateSnapshot(previous) },
        newValue: { zoneCode: zone.code, ...rateSnapshot(created) },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    return toRateView(created);
  });
}

export async function listRates(zoneId: string, pagination: PaginationQuery): Promise<{ items: RateView[]; total: number }> {
  return withTransaction(async (client) => {
    await requireZone(zoneId, client);
    const { items, total } = await shippingRepository.listRates(zoneId, pagination, client);
    return { items: items.map(toRateView), total };
  });
}

export async function listUnmatchedDistricts(
  pagination: PaginationQuery,
): Promise<{ items: Array<Omit<UnmatchedDistrict, 'firstSeenAt' | 'lastSeenAt'> & { firstSeenAt: string; lastSeenAt: string }>; total: number }> {
  const { items, total } = await withTransaction((client) => shippingRepository.listUnmatchedDistricts(pagination, client));
  return {
    items: items.map((u) => ({
      district: u.district,
      occurrences: u.occurrences,
      firstSeenAt: u.firstSeenAt.toISOString(),
      lastSeenAt: u.lastSeenAt.toISOString(),
    })),
    total,
  };
}
