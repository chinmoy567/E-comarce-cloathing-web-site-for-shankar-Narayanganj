import { describe, expect, it } from 'vitest';
import { computeVisibility } from '../../src/services/homepageCms/visibility.js';

/** Spec 13 — computeVisibility() (§13.7a, §13.10). No DB. */
describe('computeVisibility (13-homepage-cms §13.7a)', () => {
  const now = new Date('2026-06-15T00:00:00.000Z');

  it('DRAFT is never visible', () => {
    expect(computeVisibility({ status: 'DRAFT', startsAt: null, endsAt: null }, now)).toEqual({
      visible: false,
      displayStatus: 'DRAFT',
    });
  });

  it('DISABLED is never visible, even within an open schedule window', () => {
    const startsAt = new Date('2026-01-01T00:00:00.000Z');
    const endsAt = new Date('2026-12-31T00:00:00.000Z');
    expect(computeVisibility({ status: 'DISABLED', startsAt, endsAt }, now)).toEqual({
      visible: false,
      displayStatus: 'DISABLED',
    });
  });

  it('ACTIVE with a future startsAt is SCHEDULED, not visible', () => {
    const startsAt = new Date('2099-01-01T00:00:00.000Z');
    expect(computeVisibility({ status: 'ACTIVE', startsAt, endsAt: null }, now)).toEqual({
      visible: false,
      displayStatus: 'SCHEDULED',
    });
  });

  it('ACTIVE with a past endsAt is EXPIRED, not visible', () => {
    const endsAt = new Date('2020-01-01T00:00:00.000Z');
    expect(computeVisibility({ status: 'ACTIVE', startsAt: null, endsAt }, now)).toEqual({
      visible: false,
      displayStatus: 'EXPIRED',
    });
  });

  it('ACTIVE within an open window (or with no window at all) is visible', () => {
    expect(computeVisibility({ status: 'ACTIVE', startsAt: null, endsAt: null }, now)).toEqual({
      visible: true,
      displayStatus: 'ACTIVE',
    });

    const startsAt = new Date('2026-01-01T00:00:00.000Z');
    const endsAt = new Date('2026-12-31T00:00:00.000Z');
    expect(computeVisibility({ status: 'ACTIVE', startsAt, endsAt }, now)).toEqual({
      visible: true,
      displayStatus: 'ACTIVE',
    });
  });

  it('DISABLED overrides an in-schedule window (§13.7a)', () => {
    const startsAt = new Date('2020-01-01T00:00:00.000Z');
    const endsAt = new Date('2099-01-01T00:00:00.000Z');
    const result = computeVisibility({ status: 'DISABLED', startsAt, endsAt }, now);
    expect(result.visible).toBe(false);
    expect(result.displayStatus).toBe('DISABLED');
  });
});
