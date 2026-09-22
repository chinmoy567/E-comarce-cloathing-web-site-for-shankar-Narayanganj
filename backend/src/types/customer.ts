import type { AccountType, AreaUnitType, WardUnitType } from './enums.js';

/**
 * The shared Bangladesh address model (02-customer §2.2).
 *
 * Guest and registered customers use this same shape — there is no reduced
 * guest variant (§2.9.2, database skill §3), so admin views and courier
 * mapping (spec 14) behave identically for both.
 *
 * `areaUnitType`/`areaUnitName` is ONE field with a naming discriminator, and
 * likewise `wardUnitType`/`wardUnitName` — not four independent fields. The
 * courier adapters in spec 14 map these onto each provider's own schema;
 * nothing else in the system reinterprets them.
 */
export type CustomerAddress = {
  division: string;
  district: string;
  /** UPAZILA | THANA */
  areaUnitType: AreaUnitType;
  areaUnitName: string;
  /** UNION | WARD */
  wardUnitType: WardUnitType;
  wardUnitName: string;
  detailedAddress: string;
  postalCode: string | null;
};

/**
 * A customer record — registered or guest, one per phone number (§2.9.4).
 *
 * `phoneNumber` is always the canonical normalized form produced by
 * `normalizeBdPhone`; record reuse, the spec-16 risk cache, and the spec-10
 * per-customer coupon limit all depend on two phone strings comparing equal.
 */
export type CustomerRecord = {
  id: string;
  accountType: AccountType;
  fullName: string;
  phoneNumber: string;
  email: string | null;
  address: CustomerAddress;
};
