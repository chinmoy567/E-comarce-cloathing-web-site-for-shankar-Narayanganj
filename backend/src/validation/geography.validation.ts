import { z } from 'zod';

/**
 * Geography request schemas (11-security-hardening §11.6).
 *
 * `.strict()` throughout, per the `validate` middleware's contract: an unknown
 * field is rejected rather than ignored.
 *
 * Ids are constrained to UUID form, which is what stops an arbitrary string
 * from ever reaching a parameterized query as a malformed uuid and surfacing a
 * driver error (task §15 — "do not accept arbitrary IDs without validation").
 */

const geoId = z.string().uuid('Must be a valid geography id.');

export const divisionIdParams = z.object({ id: geoId }).strict();

export const districtIdParams = z.object({ id: geoId }).strict();

/**
 * The address-geography block, reused by every spec that stores an address
 * (profile save, guest checkout, admin customer edit) so the three cannot drift.
 *
 * Union/Ward is absent here on purpose: no authoritative ADM4 dataset exists,
 * so it stays the free-text field spec 02 defined and is validated by those
 * specs' own schemas, not as a geography reference.
 */
export const geographySelectionSchema = z
  .object({
    divisionId: geoId,
    districtId: geoId,
    upazilaId: geoId,
  })
  .strict();

export type GeographySelectionInput = z.infer<typeof geographySelectionSchema>;
