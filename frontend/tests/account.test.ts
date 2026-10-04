import { describe, expect, it } from 'vitest';
import { describeMissingFields } from '../src/lib/account';

describe('describeMissingFields', () => {
  it('maps known profile fields to readable names', () => {
    expect(describeMissingFields(['full_name', 'area_unit', 'detailed_address'])).toEqual([
      'full name',
      'thana or upazila',
      'detailed address',
    ]);
  });

  it('falls back to a spaced name for unknown fields and returns [] when complete', () => {
    expect(describeMissingFields(['some_new_field'])).toEqual(['some new field']);
    expect(describeMissingFields([])).toEqual([]);
  });
});
