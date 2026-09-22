import { NotFoundError, ValidationError } from '../lib/errors.js';
import {
  listDistrictsByDivision,
  listDivisions,
  listUpazilasByDistrict,
  resolveGeography,
} from '../repositories/geography.repository.js';
import type { GeoNode, ResolvedGeography } from '../types/geography.js';

/**
 * Geography reads and address-consistency validation.
 *
 * This service is the single place that answers "is this a real, internally
 * consistent Bangladesh address?", so checkout (spec 11), profile save
 * (spec 08) and the admin customer editor (spec 13) cannot each grow their own
 * slightly different version of the rule.
 */

export async function getDivisions(): Promise<GeoNode[]> {
  return listDivisions();
}

export async function getDistricts(divisionId: string): Promise<GeoNode[]> {
  const districts = await listDistrictsByDivision(divisionId);
  // `undefined` means the parent itself does not exist — a 404, not an empty
  // list, so an invalid id can never be mistaken for a childless division.
  if (!districts) throw new NotFoundError('Division not found.');
  return districts;
}

export async function getUpazilas(districtId: string): Promise<GeoNode[]> {
  const upazilas = await listUpazilasByDistrict(districtId);
  if (!upazilas) throw new NotFoundError('District not found.');
  return upazilas;
}

export type GeographySelection = {
  divisionId: string;
  districtId: string;
  upazilaId: string;
};

/**
 * Validates a submitted geography selection server-side.
 *
 * Called on every write path that stores an address. The frontend having
 * populated its dropdowns from these same endpoints proves nothing about what
 * was actually submitted (02-customer §2.3, CLAUDE.md §3), so this re-checks
 * the whole chain against the database regardless.
 *
 * A mismatched-but-individually-valid combination fails exactly like an unknown
 * id: the response never confirms that some other part of the chain was real,
 * which keeps the endpoint from being used to probe the dataset shape.
 */
export async function validateGeographySelection(
  selection: GeographySelection,
): Promise<ResolvedGeography> {
  const resolved = await resolveGeography(selection);

  if (!resolved) {
    throw new ValidationError('The selected address is not a valid Bangladesh location.', [
      {
        field: 'upazilaId',
        message:
          'Division, district and upazila/thana must be real and must belong to one another.',
      },
    ]);
  }

  return resolved;
}
