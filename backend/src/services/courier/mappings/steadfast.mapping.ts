import type { ResolvedGeography } from '../../../types/geography.js';
import { resolveLevels } from '../courierLocation.service.js';
import type { CourierLocationMapper, CourierLocationResolution } from '../courierLocation.types.js';

/**
 * Steadfast's location-mapping boundary.
 *
 * STATUS: structure only — the mapping table is EMPTY and must be populated
 * from Steadfast's current official API/integration documentation before
 * shipment creation can work.
 *
 * Steadfast's required location fields are NOT asserted here. CLAUDE.md §6 and
 * spec 14 assumption 1 both forbid guessing them, and the PRDs deliberately
 * supply no Steadfast payload shape. If Steadfast turns out to accept address
 * text rather than location ids, `requiredLevels` becomes an empty list and no
 * mapping rows are ever needed — that is a legitimate outcome of reading the
 * official documentation, and the interface already supports it.
 *
 * WHAT REMAINS: confirm from the official documentation whether Steadfast needs
 * location identifiers at all, then either populate the mapping through
 * `upsertMapping` or set `requiredLevels` to `[]`.
 */
export const steadfastLocationMapper: CourierLocationMapper = {
  courierCode: 'STEADFAST',

  // Provisional — confirm against the official Steadfast documentation (spec 14).
  requiredLevels: ['DISTRICT'] as const,

  async resolve(geography: ResolvedGeography): Promise<CourierLocationResolution> {
    return resolveLevels(
      steadfastLocationMapper.courierCode,
      steadfastLocationMapper.requiredLevels,
      geography,
    );
  },
};
