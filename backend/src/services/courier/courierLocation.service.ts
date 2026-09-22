import { findMapping } from '../../repositories/courierLocationMapping.repository.js';
import type { GeoLevel, ResolvedGeography } from '../../types/geography.js';
import type { CourierLocationResolution, RequiredGeoLevels } from './courierLocation.types.js';

/**
 * The shared resolution routine every provider mapper delegates to.
 *
 * Each provider differs only in WHICH levels it needs; the lookup itself is
 * identical, so it lives here once rather than being copied per adapter.
 */
export async function resolveLevels(
  courierCode: string,
  levels: RequiredGeoLevels,
  geography: ResolvedGeography,
): Promise<CourierLocationResolution> {
  const entity: Record<GeoLevel, { id: string; name: string }> = {
    DIVISION: geography.division,
    DISTRICT: geography.district,
    UPAZILA: geography.upazila,
  };

  const mappings: Record<GeoLevel, Awaited<ReturnType<typeof findMapping>>> = {
    DIVISION: undefined,
    DISTRICT: undefined,
    UPAZILA: undefined,
  };
  const missing: Array<{ level: GeoLevel; name: string }> = [];

  for (const level of levels) {
    const found = await findMapping(courierCode, level, entity[level].id);
    if (found) {
      mappings[level] = found;
    } else {
      // Reported, never guessed — a wrong zone silently delivers a parcel to
      // the wrong place, which is worse than a failed creation the operator
      // can act on (spec 14 assumption 2).
      missing.push({ level, name: entity[level].name });
    }
  }

  return missing.length > 0 ? { resolved: false, missing } : { resolved: true, mappings };
}
