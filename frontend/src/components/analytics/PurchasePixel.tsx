'use client';

import { useEffect } from 'react';
import { firePixelPurchase } from '@/lib/analytics';
import type { CustomerOrderView } from '@/lib/account';

const FIRED_KEY = 'fabrillke:purchase-fired';

function readFired(): string[] {
  try {
    const raw = window.localStorage.getItem(FIRED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Opportunistic Pixel copy of Purchase (spec 18). Confirmation happens in the back-office, so
 * the CAPI copy is authoritative; this fires once per browser when the customer later views
 * an order the backend reports as confirmed. It reuses the backend's deterministic
 * `purchaseEventId` so Meta deduplicates, and `amounts.totalAmount` verbatim — no browser maths.
 * Renders nothing; does nothing without a `purchaseEventId`.
 */
export function PurchasePixel({ order }: { order: Pick<CustomerOrderView, 'purchaseEventId' | 'amounts' | 'items'> }): null {
  const eventId = order.purchaseEventId;
  const total = order.amounts.totalAmount;
  const units = order.items.reduce((n, i) => n + i.quantity, 0);

  useEffect(() => {
    if (!eventId) return;
    const fired = readFired();
    if (fired.includes(eventId)) return;
    firePixelPurchase({ eventId, value: total, numItems: units });
    try {
      window.localStorage.setItem(FIRED_KEY, JSON.stringify([...fired, eventId].slice(-50)));
    } catch {
      // Storage may be unavailable; the id still deduplicates on Meta's side.
    }
  }, [eventId, total, units]);

  return null;
}
