/**
 * Spec 07 — Order State Machine: Unit Tests for Transition Tables
 *
 * Pure tests of the transition-validation logic in orderStateMachine.ts.
 * No database access — validates that the spec's tables (§5.21.1–5.21.8)
 * are correctly encoded, and that the invalid examples from §5.21.10 are
 * properly rejected.
 */

import { describe, expect, it } from 'vitest';
import {
  isValidOrderTransition,
  isValidPaymentTransition,
  isValidShipmentTransition,
  initialOrderStatus,
  initialPaymentStatus,
  initialShipmentStatus,
} from '../../src/services/orderStateMachine.js';

describe('Order Status Transitions (§5.21.1, §5.21.3, §5.21.8)', () => {
  describe('bKash (§5.21.1)', () => {
    it('allows PENDING_CONFIRMATION → CONFIRMED', () => {
      const transition = isValidOrderTransition('BKASH', 'PENDING_CONFIRMATION', 'CONFIRMED');
      expect(transition).toBeDefined();
      expect(transition?.permission).toBe('order.confirm');
      expect(transition?.trigger).toBe('ADMIN');
    });

    it('allows PENDING_CONFIRMATION → CANCELLED', () => {
      const transition = isValidOrderTransition('BKASH', 'PENDING_CONFIRMATION', 'CANCELLED');
      expect(transition).toBeDefined();
      expect(transition?.permission).toBe('order.cancel');
    });

    it('allows CONFIRMED → PROCESSING', () => {
      const transition = isValidOrderTransition('BKASH', 'CONFIRMED', 'PROCESSING');
      expect(transition).toBeDefined();
      expect(transition?.permission).toBe('order.confirm');
    });

    it('allows CONFIRMED → CANCELLED', () => {
      const transition = isValidOrderTransition('BKASH', 'CONFIRMED', 'CANCELLED');
      expect(transition).toBeDefined();
    });

    it('allows PROCESSING → DELIVERED', () => {
      const transition = isValidOrderTransition('BKASH', 'PROCESSING', 'DELIVERED');
      expect(transition).toBeDefined();
      expect(transition?.permission).toBe('shipment.track');
      expect(transition?.trigger).toBe('SYSTEM');
    });

    it('allows PROCESSING → CANCELLED', () => {
      const transition = isValidOrderTransition('BKASH', 'PROCESSING', 'CANCELLED');
      expect(transition).toBeDefined();
    });

    it('allows PROCESSING → RETURNED', () => {
      const transition = isValidOrderTransition('BKASH', 'PROCESSING', 'RETURNED');
      expect(transition).toBeDefined();
      expect(transition?.trigger).toBe('SYSTEM');
    });
  });

  describe('COD (§5.21.3)', () => {
    it('allows COD_VERIFICATION_PENDING → CONFIRMED', () => {
      const transition = isValidOrderTransition('COD', 'COD_VERIFICATION_PENDING', 'CONFIRMED');
      expect(transition).toBeDefined();
      expect(transition?.permission).toBe('order.cod.confirm');
    });

    it('allows COD_VERIFICATION_PENDING → CANCELLED', () => {
      const transition = isValidOrderTransition('COD', 'COD_VERIFICATION_PENDING', 'CANCELLED');
      expect(transition).toBeDefined();
    });

    it('allows CONFIRMED → PROCESSING', () => {
      const transition = isValidOrderTransition('COD', 'CONFIRMED', 'PROCESSING');
      expect(transition).toBeDefined();
    });
  });

  describe('Invalid transitions (§5.21.10)', () => {
    it('rejects PENDING_CONFIRMATION → PROCESSING (bKash)', () => {
      const transition = isValidOrderTransition('BKASH', 'PENDING_CONFIRMATION', 'PROCESSING');
      expect(transition).toBeUndefined();
    });

    it('rejects PENDING_CONFIRMATION → DELIVERED (bKash)', () => {
      const transition = isValidOrderTransition('BKASH', 'PENDING_CONFIRMATION', 'DELIVERED');
      expect(transition).toBeUndefined();
    });

    it('rejects CONFIRMED → DELIVERED (bKash)', () => {
      const transition = isValidOrderTransition('BKASH', 'CONFIRMED', 'DELIVERED');
      expect(transition).toBeUndefined();
    });

    it('rejects DELIVERED → CANCELLED', () => {
      const transition = isValidOrderTransition('BKASH', 'DELIVERED', 'CANCELLED');
      expect(transition).toBeUndefined();
    });

    it('rejects COD_VERIFICATION_PENDING → SHIPPED (COD)', () => {
      const transition = isValidOrderTransition('COD', 'COD_VERIFICATION_PENDING', 'SHIPPED' as any);
      expect(transition).toBeUndefined();
    });
  });
});

describe('Payment Status Transitions (§5.21.2, §5.21.3)', () => {
  describe('bKash', () => {
    it('allows PENDING_VERIFICATION → PAID_VERIFIED', () => {
      const transition = isValidPaymentTransition('BKASH', 'PENDING_VERIFICATION', 'PAID_VERIFIED');
      expect(transition).toBeDefined();
      expect(transition?.permission).toBe('payment.verify');
    });

    it('allows PENDING_VERIFICATION → REJECTED', () => {
      const transition = isValidPaymentTransition('BKASH', 'PENDING_VERIFICATION', 'REJECTED');
      expect(transition).toBeDefined();
      expect(transition?.permission).toBe('payment.reject');
    });

    it('allows REJECTED → PENDING_VERIFICATION (resubmission)', () => {
      const transition = isValidPaymentTransition('BKASH', 'REJECTED', 'PENDING_VERIFICATION');
      expect(transition).toBeDefined();
      expect(transition?.permission).toBe('payment.review');
    });
  });

  describe('COD', () => {
    it('allows PENDING_COLLECTION → PAID_COLLECTED', () => {
      const transition = isValidPaymentTransition('COD', 'PENDING_COLLECTION', 'PAID_COLLECTED');
      expect(transition).toBeDefined();
      expect(transition?.permission).toBe('payment.verify');
    });

    it('allows PENDING_COLLECTION → REJECTED', () => {
      const transition = isValidPaymentTransition('COD', 'PENDING_COLLECTION', 'REJECTED');
      expect(transition).toBeDefined();
      expect(transition?.permission).toBe('payment.reject');
    });
  });

  it('rejects invalid cross-method transitions', () => {
    // bKash payment cannot use COD transitions
    const transition = isValidPaymentTransition('BKASH', 'PENDING_COLLECTION', 'PAID_COLLECTED');
    expect(transition).toBeUndefined();
  });
});

describe('Shipment Status Transitions (§5.21.4, §5.21.5, §5.21.6, §5.21.8)', () => {
  it('allows NOT_CREATED → CREATING', () => {
    const transition = isValidShipmentTransition('NOT_CREATED', 'CREATING');
    expect(transition).toBeDefined();
    expect(transition?.permission).toBe('shipment.create');
    expect(transition?.trigger).toBe('ADMIN');
  });

  it('allows CREATING → CREATED (system)', () => {
    const transition = isValidShipmentTransition('CREATING', 'CREATED');
    expect(transition).toBeDefined();
    expect(transition?.trigger).toBe('SYSTEM');
  });

  it('allows CREATING → CREATION_FAILED (system)', () => {
    const transition = isValidShipmentTransition('CREATING', 'CREATION_FAILED');
    expect(transition).toBeDefined();
    expect(transition?.trigger).toBe('SYSTEM');
  });

  it('allows CREATION_FAILED → CREATING (retry)', () => {
    const transition = isValidShipmentTransition('CREATION_FAILED', 'CREATING');
    expect(transition).toBeDefined();
    expect(transition?.permission).toBe('shipment.retry');
    expect(transition?.trigger).toBe('ADMIN');
  });

  it('allows the full happy path: NOT_CREATED → CREATING → CREATED → SHIPPED → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED', () => {
    const path = ['NOT_CREATED', 'CREATING', 'CREATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
    for (let i = 0; i < path.length - 1; i++) {
      const transition = isValidShipmentTransition(path[i], path[i + 1]);
      expect(transition).toBeDefined();
    }
  });

  it('allows OUT_FOR_DELIVERY → DELIVERED', () => {
    const transition = isValidShipmentTransition('OUT_FOR_DELIVERY', 'DELIVERED');
    expect(transition).toBeDefined();
    expect(transition?.trigger).toBe('SYSTEM');
  });

  it('allows OUT_FOR_DELIVERY → DELIVERY_FAILED', () => {
    const transition = isValidShipmentTransition('OUT_FOR_DELIVERY', 'DELIVERY_FAILED');
    expect(transition).toBeDefined();
    expect(transition?.trigger).toBe('SYSTEM');
  });

  it('allows DELIVERY_FAILED → IN_TRANSIT (retry)', () => {
    const transition = isValidShipmentTransition('DELIVERY_FAILED', 'IN_TRANSIT');
    expect(transition).toBeDefined();
    expect(transition?.permission).toBe('shipment.retry');
  });

  it('allows DELIVERY_FAILED → RETURNED', () => {
    const transition = isValidShipmentTransition('DELIVERY_FAILED', 'RETURNED');
    expect(transition).toBeDefined();
    expect(transition?.trigger).toBe('SYSTEM');
  });
});

describe('Initial Statuses', () => {
  it('returns PENDING_CONFIRMATION for bKash orders', () => {
    expect(initialOrderStatus('BKASH')).toBe('PENDING_CONFIRMATION');
  });

  it('returns COD_VERIFICATION_PENDING for COD orders', () => {
    expect(initialOrderStatus('COD')).toBe('COD_VERIFICATION_PENDING');
  });

  it('returns PENDING_VERIFICATION for bKash payments', () => {
    expect(initialPaymentStatus('BKASH')).toBe('PENDING_VERIFICATION');
  });

  it('returns PENDING_COLLECTION for COD payments', () => {
    expect(initialPaymentStatus('COD')).toBe('PENDING_COLLECTION');
  });

  it('returns NOT_CREATED for all shipments', () => {
    expect(initialShipmentStatus()).toBe('NOT_CREATED');
  });
});
