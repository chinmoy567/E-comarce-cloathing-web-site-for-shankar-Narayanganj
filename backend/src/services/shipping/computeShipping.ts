import type pg from 'pg';
import { logger } from '../../lib/logger.js';
import { ServiceUnavailableError } from '../../lib/errors.js';
import * as shippingRepository from '../../repositories/shipping.repository.js';
import type { ShippingRate, ShippingZoneRow } from '../../repositories/shipping.repository.js';

/**
 * The single authority for "what does delivery cost" (spec 21).
 *
 * Deterministic for a given (address, subtotal, rate-table state, `now`): called twice in one
 * transaction it returns the same number. It reads the rate tables, so it takes the caller's
 * transaction client — that is what lets createOrder() compute and write the amount atomically.
 *
 * All arithmetic is integer poisha (1 BDT = 100 poisha), the same discipline as the coupon engine
 * (validateCoupon.ts), so rounding is exact and identical at preview and at order creation.
 */

export type ShippingInput = {
  address: { division: string; district: string; isMetropolitan: boolean };
  /** Merchandise subtotal AFTER the coupon discount (spec 21 ordering note). */
  merchandiseSubtotal: number;
  /** Server clock only (§8.5) — never a client-supplied timestamp. */
  now: Date;
  /**
   * Log + tally a district that falls through to the default zone. True ONLY at order creation:
   * advisory public endpoints must not let anonymous callers grow the unmatched table with junk.
   */
  recordUnmatched?: boolean;
};

export type ShippingQuote = {
  zoneCode: string;
  zoneName: string;
  /** >= 0, 2dp. */
  amount: number;
  freeShippingApplied: boolean;
  /** For the "Add ৳X more for free delivery" hint; null unless a threshold rate has not been reached. */
  freeShippingRemaining: number | null;
};

const toPoisha = (amount: number): number => Math.round(amount * 100);
const fromPoisha = (poisha: number): number => poisha / 100;

/** metro match -> non-metro match -> default zone. The last step cannot fail (partial unique index). */
async function resolveZone(
  district: string,
  isMetropolitan: boolean,
  client: pg.PoolClient,
): Promise<{ zone: ShippingZoneRow; matched: boolean }> {
  if (isMetropolitan) {
    const metro = await shippingRepository.findZoneByDistrict(district, true, client);
    if (metro) return { zone: metro, matched: true };
  }
  const general = await shippingRepository.findZoneByDistrict(district, false, client);
  if (general) return { zone: general, matched: true };

  const fallback = await shippingRepository.findDefaultZone(client);
  if (!fallback) {
    // Structurally impossible once migration 0018 has seeded a default zone; never charge 0 silently.
    throw new ServiceUnavailableError('Delivery charge is not configured.', undefined, 'SHIPPING_NOT_CONFIGURED');
  }
  return { zone: fallback, matched: false };
}

function applyRate(rate: ShippingRate, merchandiseSubtotal: number): Omit<ShippingQuote, 'zoneCode' | 'zoneName'> {
  const flat = toPoisha(rate.flatAmount);
  const subtotal = toPoisha(merchandiseSubtotal);

  switch (rate.strategy) {
    case 'FREE':
      return { amount: 0, freeShippingApplied: true, freeShippingRemaining: null };
    case 'FREE_OVER_THRESHOLD': {
      const threshold = toPoisha(rate.freeOverAmount ?? 0);
      // Exactly at the threshold ships free; one taka below pays the flat amount.
      if (subtotal >= threshold) return { amount: 0, freeShippingApplied: true, freeShippingRemaining: null };
      return { amount: fromPoisha(flat), freeShippingApplied: false, freeShippingRemaining: fromPoisha(threshold - subtotal) };
    }
    case 'FLAT':
    default:
      return { amount: fromPoisha(flat), freeShippingApplied: false, freeShippingRemaining: null };
  }
}

export async function computeShipping(input: ShippingInput, client: pg.PoolClient): Promise<ShippingQuote> {
  const { zone, matched } = await resolveZone(input.address.district, input.address.isMetropolitan, client);

  if (!matched && input.recordUnmatched) {
    // Never silent: log it and tally it so the admin screen can list the spelling to map. Checkout is
    // never blocked by an unmatched district — failing an order over a spelling is worse than the default rate.
    logger.warn({ district: input.address.district }, 'shipping.zone_unmatched');
    await client.query('SAVEPOINT shipping_unmatched');
    try {
      await shippingRepository.recordUnmatchedDistrict(input.address.district, client);
      await client.query('RELEASE SAVEPOINT shipping_unmatched');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT shipping_unmatched');
      logger.error({ err }, 'shipping.unmatched_district_record_failed');
    }
  }

  const rate = await shippingRepository.findCurrentRate(zone.id, input.now, client);
  if (!rate) {
    throw new ServiceUnavailableError('Delivery charge is not configured.', undefined, 'SHIPPING_NOT_CONFIGURED');
  }

  return { zoneCode: zone.code, zoneName: zone.name, ...applyRate(rate, input.merchandiseSubtotal) };
}
