import type { CourierLocationMapping, GeoLevel, ResolvedGeography } from '../../types/geography.js';

/**
 * The courier location-mapping boundary (task §7, §10, §16).
 *
 * Internal Address -> Courier Adapter -> Courier-specific mapping -> Courier API
 *
 * A customer never sees, supplies, or stores a Pathao or Steadfast identifier
 * (task §16). They choose internal geography only; translating it is entirely
 * the adapter's job, behind this contract.
 *
 * This file fixes the SHAPE of that translation. It deliberately fixes no
 * provider field names, no id formats, and no endpoint behaviour — those come
 * from each provider's current official documentation when spec 14 is
 * implemented (CLAUDE.md §6, spec 14 assumptions 1-2).
 */

/** Which internal levels a provider needs, declared by each adapter. */
export type RequiredGeoLevels = readonly GeoLevel[];

/**
 * What an adapter gets back when it asks for a translated address.
 *
 * `missing` names the internal entities that have no mapping yet, so a failure
 * is actionable ("Cumilla has no Pathao city mapping") rather than a bare
 * error. Nothing is guessed: an unmapped location fails shipment creation
 * instead of sending a wrong zone (spec 14 assumption 2).
 */
export type CourierLocationResolution =
  | { resolved: true; mappings: Record<GeoLevel, CourierLocationMapping | undefined> }
  | { resolved: false; missing: Array<{ level: GeoLevel; name: string }> };

/**
 * Implemented once per provider, in `mappings/<provider>.mapping.ts`.
 *
 * Keeping this separate from the shipment adapter itself means a provider's
 * location catalogue can be re-synced without touching shipment creation.
 */
export type CourierLocationMapper = {
  /** Registry code, e.g. 'PATHAO'. Matches `courier_location_mappings.courier_code`. */
  readonly courierCode: string;

  /** The levels this provider requires a mapping for. */
  readonly requiredLevels: RequiredGeoLevels;

  /** Translates one validated internal address into this provider's locations. */
  resolve(geography: ResolvedGeography): Promise<CourierLocationResolution>;
};
