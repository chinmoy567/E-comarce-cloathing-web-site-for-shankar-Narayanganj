import { describe, expect, it } from 'vitest';
import { buildOrderInfoPatch, validateOrderInfo, type OrderInfoForm } from '../src/lib/admin/orderInfo';

const base: OrderInfoForm = {
  contactName: 'Rahim Uddin',
  contactPhone: '01711111111',
  detailedAddress: 'House 7, Road 2',
  postalCode: '1212',
  deliveryInstructions: '',
  internalNote: '',
};

describe('buildOrderInfoPatch', () => {
  it('sends only what changed, trimmed', () => {
    expect(buildOrderInfoPatch(base, { ...base, contactName: '  Karim Uddin ' }, false)).toEqual({ contactName: 'Karim Uddin' });
    expect(buildOrderInfoPatch(base, { ...base }, false)).toEqual({});
  });

  it('clears an optional field with null when it is blanked', () => {
    const before = { ...base, postalCode: '1212', deliveryInstructions: 'Call first', internalNote: 'VIP' };
    expect(buildOrderInfoPatch(before, { ...before, postalCode: '', deliveryInstructions: ' ', internalNote: '' }, false)).toEqual({
      postalCode: null,
      deliveryInstructions: null,
      internalNote: null,
    });
  });

  it('never sends contact, address or delivery instructions once a shipment exists, but still sends the note', () => {
    const after = { ...base, contactName: 'Changed', detailedAddress: 'Elsewhere', deliveryInstructions: 'x', internalNote: 'Called him' };
    expect(buildOrderInfoPatch(base, after, true)).toEqual({ internalNote: 'Called him' });
  });
});

describe('validateOrderInfo', () => {
  it('accepts the unchanged form', () => {
    expect(validateOrderInfo(base, false)).toEqual({});
  });

  it('flags a blank name, a short phone, a blank address and over-long text', () => {
    const errors = validateOrderInfo(
      { ...base, contactName: ' ', contactPhone: '123', detailedAddress: '', deliveryInstructions: 'x'.repeat(251), internalNote: 'y'.repeat(1001) },
      false,
    );
    expect(Object.keys(errors).sort()).toEqual(['contactName', 'contactPhone', 'deliveryInstructions', 'detailedAddress', 'internalNote']);
  });

  it('ignores locked fields once a shipment exists, but still checks the note', () => {
    expect(validateOrderInfo({ ...base, contactName: '', contactPhone: '1' }, true)).toEqual({});
    expect(Object.keys(validateOrderInfo({ ...base, internalNote: 'y'.repeat(1001) }, true))).toEqual(['internalNote']);
  });
});
