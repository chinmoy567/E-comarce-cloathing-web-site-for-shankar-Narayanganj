import { expect, it, describe } from 'vitest';
import { META_EVENTS, MetaEventName, newEventId } from '@shared/analytics';

describe('Meta event contract (spec 08 §6.2)', () => {
  it('exports exactly seven event names', () => {
    const names = Object.values(META_EVENTS);
    expect(names).toHaveLength(7);
    expect(names).toEqual([
      'PageView',
      'ViewContent',
      'Search',
      'AddToCart',
      'InitiateCheckout',
      'AddPaymentInfo',
      'Purchase',
    ]);
  });

  it('generates unique event IDs', () => {
    const id1 = newEventId();
    const id2 = newEventId();
    const id3 = newEventId();

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id3).toBeTruthy();
    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  it('validates event IDs are UUIDs', () => {
    const id = newEventId();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test(id)).toBe(true);
  });

  it('prevents runtime extension of the event taxonomy (§6.2, §8.31, §13.16)', () => {
    const names: MetaEventName[] = Object.values(META_EVENTS);
    // This assertion documents that only these seven names are valid.
    // If a future change tries to add an eighth, this test will fail,
    // preventing silent expansion of the analytics event types.
    expect(names.length).toBe(7);
  });
});
