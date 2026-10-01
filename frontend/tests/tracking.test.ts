import { describe, expect, it } from 'vitest';
import {
  TRACK_PREFILL_KEY,
  TRACKING_ID_ERROR,
  buildProgressTrail,
  safeHttpsUrl,
  validateTrackingId,
} from '../src/lib/tracking';
import { orderStatusLabel, paymentStatusLabel, shipmentStatusLabel } from '../src/lib/account';

/**
 * Pure-logic coverage for spec 15's storefront (the frontend test environment is node-only, so no
 * component rendering): the Track Order input rule, link safety, the shipment progress trail and
 * the three independent label maps.
 */
describe('validateTrackingId (04-courier §4.16 — UX mirror of the backend rule)', () => {
  it.each(['abcd', 'TRK-12345', 'a_b-c_d-1234', 'A'.repeat(64), '  TRK-12345  '])('accepts %j', (value) => {
    expect(validateTrackingId(value)).toBeNull();
  });

  it.each(['', 'abc', 'A'.repeat(65), 'TRK 12345', "TRK-1'; DROP", 'TRK/12345', 'টেস্ট১২৩৪'])('rejects %j', (value) => {
    expect(validateTrackingId(value)).toBe(TRACKING_ID_ERROR);
  });
});

describe('safeHttpsUrl', () => {
  it('passes https links through and rejects everything else', () => {
    expect(safeHttpsUrl('https://track.example.test/ABC123')).toBe('https://track.example.test/ABC123');
    expect(safeHttpsUrl('http://track.example.test/ABC123')).toBeNull();
    expect(safeHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpsUrl('//evil.example')).toBeNull();
    expect(safeHttpsUrl('not a url')).toBeNull();
    expect(safeHttpsUrl(null)).toBeNull();
    expect(safeHttpsUrl('')).toBeNull();
  });
});

describe('prefill hand-off', () => {
  it('uses a storage key, never a URL (the root PixelInit reports page URLs to Meta)', () => {
    expect(TRACK_PREFILL_KEY).not.toMatch(/[/?=]/);
  });
});

describe('buildProgressTrail (§4.14.3, §4.14.6)', () => {
  const at = '2026-10-01T10:00:00.000Z';

  it('walks the five lifecycle nodes and marks the current one', () => {
    const trail = buildProgressTrail([{ status: 'IN_TRANSIT', occurredAt: at, description: '' }], 'IN_TRANSIT');
    expect(trail.map((n) => n.status)).toEqual(['CREATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED']);
    expect(trail.map((n) => n.reached)).toEqual([true, true, true, false, false]);
    expect(trail.filter((n) => n.current).map((n) => n.status)).toEqual(['IN_TRANSIT']);
  });

  it('shows a time only when an event supplied one — never an invented timestamp', () => {
    const trail = buildProgressTrail([{ status: 'IN_TRANSIT', occurredAt: at, description: '' }], 'IN_TRANSIT');
    expect(trail.find((n) => n.status === 'IN_TRANSIT')!.occurredAt).toBe(at);
    expect(trail.find((n) => n.status === 'CREATED')!.occurredAt).toBeNull();
    expect(trail.find((n) => n.status === 'OUT_FOR_DELIVERY')!.occurredAt).toBeNull();
  });

  it('uses no event time for a node the courier never reported, and takes the latest time for a repeated status', () => {
    const trail = buildProgressTrail(
      [
        { status: 'SHIPPED', occurredAt: '2026-10-01T08:00:00.000Z', description: '' },
        { status: 'SHIPPED', occurredAt: '2026-10-01T09:00:00.000Z', description: '' },
      ],
      'SHIPPED',
    );
    expect(trail.find((n) => n.status === 'SHIPPED')!.occurredAt).toBe('2026-10-01T09:00:00.000Z');
  });

  it('marks every node reached when delivered', () => {
    const trail = buildProgressTrail([], 'DELIVERED');
    expect(trail.every((n) => n.reached)).toBe(true);
    expect(trail.at(-1)).toMatchObject({ status: 'DELIVERED', current: true });
  });

  it('renders DELIVERY_FAILED as one terminal exception node in place of the remaining nodes, not a second trail', () => {
    const trail = buildProgressTrail([], 'DELIVERY_FAILED');
    expect(trail.map((n) => n.status)).toEqual(['CREATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED']);
    expect(trail.at(-1)).toMatchObject({ exception: true, current: true, reached: true });
    expect(trail.some((n) => n.status === 'DELIVERED')).toBe(false);
  });

  it('renders RETURNED after a reported delivery failure as two exception nodes', () => {
    const trail = buildProgressTrail([{ status: 'DELIVERY_FAILED', occurredAt: at, description: '' }], 'RETURNED');
    expect(trail.filter((n) => n.exception).map((n) => n.status)).toEqual(['DELIVERY_FAILED', 'RETURNED']);
    expect(trail.at(-1)).toMatchObject({ status: 'RETURNED', current: true });
  });

  it('contains no order-status value (§4.14.6) — only shipment lifecycle statuses', () => {
    const orderOnly = ['PENDING_CONFIRMATION', 'COD_VERIFICATION_PENDING', 'CONFIRMED', 'PROCESSING', 'CANCELLED'];
    for (const status of ['CREATED', 'IN_TRANSIT', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNED']) {
      const nodes = buildProgressTrail([], status).map((n) => n.status);
      expect(nodes.filter((n) => orderOnly.includes(n))).toEqual([]);
    }
  });
});

describe('three independent status label maps (07 §5.21.11)', () => {
  it('maps each enum through its own Title Case label', () => {
    expect(orderStatusLabel('DELIVERED')).toBe('Delivered');
    expect(paymentStatusLabel('PENDING_COLLECTION')).toBe('Pending Collection');
    expect(shipmentStatusLabel('OUT_FOR_DELIVERY')).toBe('Out for Delivery');
  });

  it('never shows a raw SCREAMING_SNAKE value for an unmapped status', () => {
    expect(shipmentStatusLabel('SOME_NEW_STATUS')).toBe('Some New Status');
  });
});
