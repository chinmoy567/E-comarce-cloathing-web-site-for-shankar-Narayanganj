/**
 * The internal Bangladesh administrative geography model.
 *
 * Source of truth: the OCHA COD-AB v03 dataset built from Bangladesh Bureau of
 * Statistics live geoservices (see `data/geography/README.md`). Identifiers are
 * official P-codes, never courier ids — internal geography stays independent of
 * Pathao and Steadfast (04-courier-shipment §4.2, §4.9).
 *
 * Level 4 (Union/Ward) has no authoritative machine-readable source and is
 * therefore absent here; it remains the validated free-text field defined in
 * 02-customer §2.2 (`wardUnitType` + `wardUnitName` on `CustomerAddress`).
 */

/** Which level of the hierarchy a courier mapping row points at. */
export const GEO_LEVELS = ['DIVISION', 'DISTRICT', 'UPAZILA'] as const;
export type GeoLevel = (typeof GEO_LEVELS)[number];

export function isGeoLevel(value: unknown): value is GeoLevel {
  return typeof value === 'string' && (GEO_LEVELS as readonly string[]).includes(value);
}

/**
 * The shape every geography endpoint returns.
 *
 * `pcode` is exposed deliberately: it is public reference data, it lets the
 * frontend and courier mappings key off a stable official identifier rather
 * than a database uuid, and it carries no customer information.
 * Nothing else from the row (timestamps, internal parent uuids) is exposed
 * (11-security-hardening — do not expose unnecessary database fields).
 */
export type GeoNode = {
  id: string;
  pcode: string;
  name: string;
};

/** A fully-resolved administrative chain, as validation returns it. */
export type ResolvedGeography = {
  division: GeoNode;
  district: GeoNode;
  upazila: GeoNode;
};

/**
 * The internal→courier translation boundary (task §7-§9).
 *
 * Populated only from a provider's current official API at integration time;
 * no value here is ever invented (CLAUDE.md §6).
 */
export type CourierLocationMapping = {
  id: string;
  courierCode: string;
  geoLevel: GeoLevel;
  geoId: string;
  courierLocationId: string;
  courierLocationName: string | null;
};
