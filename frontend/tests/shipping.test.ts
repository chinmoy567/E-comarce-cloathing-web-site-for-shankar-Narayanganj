import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_REQUEST_KEYS,
  buildPricingRequest,
  describeShippingLine,
  describeTotal,
  freeShippingHint,
  isCurrentResponse,
  pricingRequestKey,
} from '@/lib/checkoutPricingView';
import {
  EMPTY_RATE_FORM,
  cleanDistrictRows,
  describeDistrict,
  describeRate,
  findDistrictConflicts,
  findDuplicateDistrict,
  validateRateForm,
  validateZoneCode,
} from '@/lib/admin/shippingView';
import type { CheckoutPricing } from '@/lib/publicTypes';
import type { ShippingZoneView } from '@/lib/admin/types';

/**
 * Spec 21 frontend — the browser only DISPLAYS backend-computed shipping. These cover the pure
 * view-model: when pricing may be requested, that no money field is ever sent, stale-response
 * handling, the shipping-line states, and the admin form's mirror of the backend rate rules.
 */

const lines = [{ productId: 'p1', variantId: 'v1', quantity: 2 }];

const pricing = (overrides: Partial<CheckoutPricing> = {}): CheckoutPricing => ({
  currency: 'BDT',
  subtotal: 1000,
  discountAmount: 0,
  shippingAmount: 60,
  totalAmount: 1060,
  appliedCoupon: null,
  couponMessage: null,
  shipping: { zoneName: 'Inside Dhaka', freeShippingApplied: false, freeShippingRemaining: null },
  ...overrides,
});

describe('buildPricingRequest', () => {
  it('does not request pricing for a guest until a district is chosen (THANA default must not imply Dhaka)', () => {
    expect(buildPricingRequest({ lines, couponCode: null, address: { district: '', areaUnitType: 'THANA' }, isLoggedIn: false })).toBeNull();
    expect(buildPricingRequest({ lines, couponCode: null, address: { district: '   ', areaUnitType: 'THANA' }, isLoggedIn: false })).toBeNull();
  });

  it('does not request pricing for an empty cart', () => {
    expect(buildPricingRequest({ lines: [], couponCode: null, address: { district: 'Dhaka', areaUnitType: 'THANA' }, isLoggedIn: false })).toBeNull();
  });

  it('sends only ids, quantities, the coupon code and district + areaUnitType for a guest', () => {
    const req = buildPricingRequest({
      lines,
      couponCode: 'SAVE10',
      address: { district: ' Dhaka ', areaUnitType: 'THANA' },
      isLoggedIn: false,
    });
    expect(req).toEqual({
      lines: [{ productId: 'p1', variantId: 'v1', quantity: 2 }],
      couponCode: 'SAVE10',
      delivery: { district: 'Dhaka', areaUnitType: 'THANA' },
    });
  });

  it('never sends isMetropolitan or any money field', () => {
    const req = buildPricingRequest({ lines, couponCode: null, address: { district: 'Dhaka', areaUnitType: 'UPAZILA' }, isLoggedIn: false });
    const serialised = JSON.stringify(req);
    expect(serialised).not.toContain('isMetropolitan');
    for (const key of FORBIDDEN_REQUEST_KEYS) expect(serialised).not.toContain(`"${key}"`);
  });

  it('prices a signed-in customer from the profile address: no delivery is sent, even before an address is typed', () => {
    const req = buildPricingRequest({ lines, couponCode: null, address: { district: '', areaUnitType: 'THANA' }, isLoggedIn: true });
    expect(req).toEqual({ lines: [{ productId: 'p1', variantId: 'v1', quantity: 2 }] });
    expect(req).not.toHaveProperty('delivery');
  });

  it('rejects an area type other than UPAZILA/THANA rather than guessing', () => {
    expect(buildPricingRequest({ lines, couponCode: null, address: { district: 'Dhaka', areaUnitType: 'CITY' }, isLoggedIn: false })).toBeNull();
  });
});

describe('stale responses', () => {
  const a = pricingRequestKey(buildPricingRequest({ lines, couponCode: null, address: { district: 'Dhaka', areaUnitType: 'THANA' }, isLoggedIn: false }));
  const b = pricingRequestKey(buildPricingRequest({ lines, couponCode: null, address: { district: 'Sylhet', areaUnitType: 'UPAZILA' }, isLoggedIn: false }));

  it('gives different keys for different addresses and equal keys for equal requests', () => {
    expect(a).not.toBe(b);
    expect(a).toBe(
      pricingRequestKey(buildPricingRequest({ lines, couponCode: null, address: { district: 'Dhaka', areaUnitType: 'THANA' }, isLoggedIn: false })),
    );
    expect(pricingRequestKey(null)).toBeNull();
  });

  it('applies a response only while its request is still the current one', () => {
    expect(isCurrentResponse(a, a)).toBe(true);
    expect(isCurrentResponse(a, b)).toBe(false); // the slow earlier response must not overwrite the newer one
    expect(isCurrentResponse(a, null)).toBe(false);
    expect(isCurrentResponse(null, null)).toBe(false);
  });
});

describe('describeShippingLine', () => {
  it('shows no number before a district is known', () => {
    const v = describeShippingLine('idle', null);
    expect(v.value).toBe('Calculated once you choose your district');
    expect(v.value).not.toMatch(/৳|\d/);
  });

  it('clears the amount while loading so a stale figure is never shown', () => {
    const v = describeShippingLine('loading', pricing());
    expect(v).toMatchObject({ value: 'Calculating…', busy: true });
    expect(v.value).not.toContain('60');
  });

  it('shows the zone and the formatted amount when ready', () => {
    const v = describeShippingLine('ready', pricing());
    expect(v.label).toBe('Delivery to Inside Dhaka');
    expect(v.value).toBe('৳ 60.00');
    expect(v.busy).toBe(false);
  });

  it('shows "Free" with the zone name when free shipping applied', () => {
    const v = describeShippingLine('ready', pricing({ shippingAmount: 0, shipping: { zoneName: 'Inside Dhaka', freeShippingApplied: true, freeShippingRemaining: null } }));
    expect(v).toMatchObject({ label: 'Delivery to Inside Dhaka', value: 'Free' });
  });

  it('offers retry on error and never shows a number; checkout is not blocked by it', () => {
    const v = describeShippingLine('error', null);
    expect(v.retryable).toBe(true);
    expect(v.value).toBe('Delivery charge unavailable right now. It will be calculated when you place your order.');
    expect(v.value).not.toMatch(/৳/);
  });
});

describe('freeShippingHint', () => {
  it('renders the exact copy from the backend value, and nothing when there is no gap', () => {
    expect(freeShippingHint(50)).toBe('Add ৳50 more for free delivery');
    expect(freeShippingHint(1500)).toBe('Add ৳1,500 more for free delivery');
    expect(freeShippingHint(null)).toBeNull();
    expect(freeShippingHint(undefined)).toBeNull();
    expect(freeShippingHint(0)).toBeNull();
  });
});

describe('describeTotal', () => {
  it('is a backend figure only — never a browser-computed sum', () => {
    expect(describeTotal('ready', pricing({ totalAmount: 1060 }))).toBe('৳1,060');
    expect(describeTotal('loading', null)).toBe('Calculating…');
    expect(describeTotal('idle', null)).toBe('Calculated when you place your order');
    expect(describeTotal('error', null)).toBe('Calculated when you place your order');
  });
});

describe('describeRate / describeDistrict', () => {
  it('renders rates in words', () => {
    expect(describeRate({ strategy: 'FLAT', flatAmount: 60, freeOverAmount: null })).toBe('Flat ৳ 60.00');
    expect(describeRate({ strategy: 'FREE', flatAmount: 0, freeOverAmount: null })).toBe('Free');
    expect(describeRate({ strategy: 'FREE_OVER_THRESHOLD', flatAmount: 100, freeOverAmount: 2000 })).toBe(
      'Free over ৳ 2,000.00, otherwise ৳ 100.00',
    );
    expect(describeRate(null)).toBe('No rate set');
  });

  it('marks metro-only districts', () => {
    expect(describeDistrict({ district: 'Dhaka', metroOnly: true })).toBe('Dhaka (metro only)');
    expect(describeDistrict({ district: 'Gazipur', metroOnly: false })).toBe('Gazipur');
  });
});

describe('validateRateForm (mirrors the backend rules)', () => {
  it('requires a charge for FLAT and builds the body', () => {
    expect(validateRateForm({ ...EMPTY_RATE_FORM, strategy: 'FLAT', flatAmount: '' }).errors.flatAmount).toBe('Required.');
    expect(validateRateForm({ ...EMPTY_RATE_FORM, strategy: 'FLAT', flatAmount: '60' }).body).toEqual({ strategy: 'FLAT', flatAmount: 60 });
  });

  it('FREE hides both amounts and sends neither', () => {
    const result = validateRateForm({ strategy: 'FREE', flatAmount: 'ignored', freeOverAmount: 'ignored' });
    expect(result.errors).toEqual({});
    expect(result.body).toEqual({ strategy: 'FREE' });
  });

  it('requires the threshold for FREE_OVER_THRESHOLD and omits it for FLAT (all-or-nothing)', () => {
    const missing = validateRateForm({ strategy: 'FREE_OVER_THRESHOLD', flatAmount: '100', freeOverAmount: '' });
    expect(missing.errors.freeOverAmount).toBe('Required.');
    expect(missing.body).toBeNull();

    const ok = validateRateForm({ strategy: 'FREE_OVER_THRESHOLD', flatAmount: '100', freeOverAmount: '2000' });
    expect(ok.body).toEqual({ strategy: 'FREE_OVER_THRESHOLD', flatAmount: 100, freeOverAmount: 2000 });

    const flat = validateRateForm({ strategy: 'FLAT', flatAmount: '100', freeOverAmount: '2000' });
    expect(flat.body).toEqual({ strategy: 'FLAT', flatAmount: 100 });
  });

  it('rejects negatives, non-numbers and more than 2 decimal places', () => {
    for (const bad of ['-1', 'abc', '1e3', '10.123', '1,000']) {
      expect(validateRateForm({ strategy: 'FLAT', flatAmount: bad, freeOverAmount: '' }).body, bad).toBeNull();
    }
    expect(validateRateForm({ strategy: 'FLAT', flatAmount: '0', freeOverAmount: '' }).body).toEqual({ strategy: 'FLAT', flatAmount: 0 });
    expect(validateRateForm({ strategy: 'FLAT', flatAmount: '10.5', freeOverAmount: '' }).body).toEqual({ strategy: 'FLAT', flatAmount: 10.5 });
  });
});

describe('zone helpers', () => {
  const zone = (id: string, name: string, districts: ShippingZoneView['districts'], isDefault = false): ShippingZoneView => ({
    id, code: name.toUpperCase().replace(/ /g, '_'), name, isDefault, sortOrder: 0, districts, currentRate: null,
  });
  const zones = [
    zone('z1', 'Inside Dhaka', [{ district: 'Dhaka', metroOnly: true }]),
    zone('z2', 'Suburbs', [{ district: 'Gazipur', metroOnly: false }]),
    zone('z3', 'Outside', [], true),
  ];

  it('validates the zone code format as a UX hint', () => {
    expect(validateZoneCode('SYLHET_ZONE')).toBeUndefined();
    expect(validateZoneCode('sylhet zone')).toBeDefined();
    expect(validateZoneCode('A')).toBeDefined();
  });

  it('flags a district already assigned to ANOTHER zone, case-insensitively, but not to the zone being edited', () => {
    expect(findDistrictConflicts(zones, 'z2', [{ district: ' DHAKA ', metroOnly: true }])).toEqual([{ district: 'DHAKA', zoneName: 'Inside Dhaka' }]);
    expect(findDistrictConflicts(zones, 'z2', [{ district: 'Gazipur', metroOnly: false }])).toEqual([]);
    expect(findDistrictConflicts(zones, null, [{ district: 'Dhaka', metroOnly: false }])).toEqual([]); // different metro specificity
  });

  it('drops blank rows, trims, and finds duplicates', () => {
    expect(cleanDistrictRows([{ district: ' Khulna ', metroOnly: false }, { district: '  ', metroOnly: true }])).toEqual([
      { district: 'Khulna', metroOnly: false },
    ]);
    expect(findDuplicateDistrict([{ district: 'Rangpur', metroOnly: false }, { district: ' rangpur ', metroOnly: false }])).toBe('rangpur');
    expect(findDuplicateDistrict([{ district: 'Rangpur', metroOnly: false }, { district: 'Rangpur', metroOnly: true }])).toBeUndefined();
  });
});
