/**
 * The admin order-information form (05-admin §5.2, spec 13). The field set and limits mirror the
 * backend's `PATCH /orders/:id` whitelist; the backend is the authority and re-validates everything.
 */

export type OrderInfoForm = {
  contactName: string;
  contactPhone: string;
  detailedAddress: string;
  postalCode: string;
  deliveryInstructions: string;
  internalNote: string;
};

/** Fields locked once a shipment exists (they are already with the courier); the note never locks. */
const LOCKED_AFTER_SHIPMENT: Array<keyof OrderInfoForm> = [
  'contactName',
  'contactPhone',
  'detailedAddress',
  'postalCode',
  'deliveryInstructions',
];

/** Field-level messages for what cannot be sent; an empty object means the form may be submitted. */
export function validateOrderInfo(form: OrderInfoForm, locked: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  const check = (key: keyof OrderInfoForm, ok: boolean, message: string) => {
    if (!ok && !(locked && LOCKED_AFTER_SHIPMENT.includes(key))) errors[key] = message;
  };
  check('contactName', form.contactName.trim().length >= 1 && form.contactName.trim().length <= 120, 'Enter a name (up to 120 characters).');
  check('contactPhone', form.contactPhone.trim().length >= 6 && form.contactPhone.trim().length <= 20, 'Enter a valid phone number.');
  check('detailedAddress', form.detailedAddress.trim().length >= 1 && form.detailedAddress.trim().length <= 500, 'Enter an address (up to 500 characters).');
  check('postalCode', form.postalCode.trim().length <= 20, 'Up to 20 characters.');
  check('deliveryInstructions', form.deliveryInstructions.trim().length <= 250, 'Up to 250 characters.');
  check('internalNote', form.internalNote.trim().length <= 1000, 'Up to 1000 characters.');
  return errors;
}

export type OrderInfoPatch = {
  contactName?: string;
  contactPhone?: string;
  detailedAddress?: string;
  postalCode?: string | null;
  deliveryInstructions?: string | null;
  internalNote?: string | null;
};

/**
 * Only what actually changed, so an untouched field is never re-sent (and the audit trail records
 * real edits only). Blank optional fields clear the value (null); locked fields are never sent.
 */
export function buildOrderInfoPatch(before: OrderInfoForm, after: OrderInfoForm, locked: boolean): OrderInfoPatch {
  const patch: OrderInfoPatch = {};
  const changed = (key: keyof OrderInfoForm) => after[key].trim() !== before[key].trim();
  const open = (key: keyof OrderInfoForm) => !(locked && LOCKED_AFTER_SHIPMENT.includes(key));

  if (open('contactName') && changed('contactName')) patch.contactName = after.contactName.trim();
  if (open('contactPhone') && changed('contactPhone')) patch.contactPhone = after.contactPhone.trim();
  if (open('detailedAddress') && changed('detailedAddress')) patch.detailedAddress = after.detailedAddress.trim();
  if (open('postalCode') && changed('postalCode')) patch.postalCode = after.postalCode.trim() || null;
  if (open('deliveryInstructions') && changed('deliveryInstructions')) {
    patch.deliveryInstructions = after.deliveryInstructions.trim() || null;
  }
  if (changed('internalNote')) patch.internalNote = after.internalNote.trim() || null;
  return patch;
}
