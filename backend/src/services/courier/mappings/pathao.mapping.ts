import type { ResolvedGeography } from '../../../types/geography.js';
import { resolveLevels } from '../courierLocation.service.js';
import type { CourierLocationMapper, CourierLocationResolution } from '../courierLocation.types.js';

/**
 * Pathao's location-mapping boundary.
 *
 * STATUS: structure only — the mapping table is EMPTY and must be populated
 * from Pathao's current official API before shipment creation can work.
 *
 * Pathao's API has historically required numeric city/zone/area identifiers
 * rather than address text (spec 14 assumption 2), which is why this boundary
 * exists at all. But the exact levels, endpoint names and id formats are NOT
 * asserted here: CLAUDE.md §6 forbids guessing an external API, and spec 14
 * assumption 1 states the payload shapes come from the official documentation
 * at implementation time.
 *
 * `requiredLevels` below is therefore a provisional declaration to be confirmed
 * against Pathao's live location endpoints when spec 14 is implemented — not a
 * claim about Pathao's schema. No Pathao identifier appears anywhere in this
 * repository, and none may be invented.
 *
 * WHAT REMAINS: a sync routine that calls Pathao's own location endpoints and
 * writes the results through `upsertMapping`, so the ids come from Pathao
 * rather than from a developer.
 */
export const pathaoLocationMapper: CourierLocationMapper = {
  courierCode: 'PATHAO',

  // Provisional — confirm against the official Pathao location API (spec 14).
  requiredLevels: ['DISTRICT', 'UPAZILA'] as const,

  async resolve(geography: ResolvedGeography): Promise<CourierLocationResolution> {
    return resolveLevels(pathaoLocationMapper.courierCode, pathaoLocationMapper.requiredLevels, geography);
  },
};
