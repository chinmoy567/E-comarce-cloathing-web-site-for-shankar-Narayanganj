import type { ResolvedGeography } from '../../../types/geography.js';
import { resolveLevels } from '../courierLocation.service.js';
import type { CourierLocationMapper, CourierLocationResolution } from '../courierLocation.types.js';

/**
 * Steadfast's location-mapping boundary.
 *
 * Steadfast's official API guide (POST /create_order) takes the delivery address as
 * free text (`recipient_address`) and has no city/zone/area identifiers, so no
 * location levels are required and no mapping rows are ever needed. The adapter
 * (adapters/steadfast.adapter.ts) builds the address text from the resolved geography.
 */
export const steadfastLocationMapper: CourierLocationMapper = {
  courierCode: 'STEADFAST',

  requiredLevels: [] as const,

  async resolve(geography: ResolvedGeography): Promise<CourierLocationResolution> {
    return resolveLevels(
      steadfastLocationMapper.courierCode,
      steadfastLocationMapper.requiredLevels,
      geography,
    );
  },
};
