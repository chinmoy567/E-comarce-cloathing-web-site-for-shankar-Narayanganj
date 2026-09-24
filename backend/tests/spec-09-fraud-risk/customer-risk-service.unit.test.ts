import { describe, it, expect } from 'vitest';
import { customerRiskService } from '../../src/services/fraud/customerRiskService.js';

describe('CustomerRiskService Unit Tests', () => {
  describe('Phone Number Normalization', () => {
    it('should normalize 01XXXXXXXXX format (existing format)', () => {
      const result = (customerRiskService as any).normalizePhoneNumber('01912345678');
      expect(result).toBe('01912345678');
    });

    it('should convert +880XXXXXXXXX to 01XXXXXXXXX', () => {
      const result = (customerRiskService as any).normalizePhoneNumber('+8801912345678');
      expect(result).toBe('01912345678');
    });

    it('should convert 880XXXXXXXXX to 01XXXXXXXXX', () => {
      const result = (customerRiskService as any).normalizePhoneNumber('8801912345678');
      expect(result).toBe('01912345678');
    });

    it('should handle phone with spaces', () => {
      const result = (customerRiskService as any).normalizePhoneNumber('019 1234 5678');
      expect(result).toBe('01912345678');
    });

    it('should handle phone with dashes', () => {
      const result = (customerRiskService as any).normalizePhoneNumber('019-1234-5678');
      expect(result).toBe('01912345678');
    });

    it('should return empty string for invalid format', () => {
      expect((customerRiskService as any).normalizePhoneNumber('invalid')).toBe('');
      expect((customerRiskService as any).normalizePhoneNumber('1234567890')).toBe('');
      expect((customerRiskService as any).normalizePhoneNumber('02912345678')).toBe('');
    });

    it('should return empty string for wrong length (too short)', () => {
      expect((customerRiskService as any).normalizePhoneNumber('0191234567')).toBe('');
    });

    it('should return empty string for wrong length (too long)', () => {
      expect((customerRiskService as any).normalizePhoneNumber('019123456789')).toBe('');
    });

    it('should return empty string for empty input', () => {
      expect((customerRiskService as any).normalizePhoneNumber('')).toBe('');
    });

    it('should return empty string for null input', () => {
      expect((customerRiskService as any).normalizePhoneNumber(null)).toBe('');
    });
  });

  describe('Risk Level Calculation', () => {
    it('should return HIGH for risk_score >= 70', () => {
      const result = (customerRiskService as any).calculateRiskLevel({ risk_score: 75 });
      expect(result).toBe('HIGH');
    });

    it('should return HIGH for risk_score = 70', () => {
      const result = (customerRiskService as any).calculateRiskLevel({ risk_score: 70 });
      expect(result).toBe('HIGH');
    });

    it('should return HIGH for risk_score = 100', () => {
      const result = (customerRiskService as any).calculateRiskLevel({ risk_score: 100 });
      expect(result).toBe('HIGH');
    });

    it('should return MEDIUM for risk_score 40-69', () => {
      expect((customerRiskService as any).calculateRiskLevel({ risk_score: 40 })).toBe('MEDIUM');
      expect((customerRiskService as any).calculateRiskLevel({ risk_score: 55 })).toBe('MEDIUM');
      expect((customerRiskService as any).calculateRiskLevel({ risk_score: 69 })).toBe('MEDIUM');
    });

    it('should return LOW for risk_score 0-39', () => {
      expect((customerRiskService as any).calculateRiskLevel({ risk_score: 0 })).toBe('LOW');
      expect((customerRiskService as any).calculateRiskLevel({ risk_score: 20 })).toBe('LOW');
      expect((customerRiskService as any).calculateRiskLevel({ risk_score: 39 })).toBe('LOW');
    });

    it('should use provided risk_level if score is null', () => {
      const result = (customerRiskService as any).calculateRiskLevel({
        risk_score: null,
        risk_level: 'HIGH',
      });
      expect(result).toBe('HIGH');
    });

    it('should return UNKNOWN if no risk data provided', () => {
      expect((customerRiskService as any).calculateRiskLevel({})).toBe('UNKNOWN');
      expect((customerRiskService as any).calculateRiskLevel(null)).toBe('UNKNOWN');
    });

    it('should prefer risk_level when risk_score is missing', () => {
      const result = (customerRiskService as any).calculateRiskLevel({
        risk_level: 'MEDIUM',
      });
      expect(result).toBe('MEDIUM');
    });
  });

  describe('Result Formatting', () => {
    it('should calculate success rate correctly (full success)', () => {
      const record = {
        id: 'test-id',
        customer_id: 'cust-id',
        order_id: 'order-id',
        phone_number: '01912345678',
        provider: 'BD_COURIER',
        risk_score: 10,
        risk_level: 'LOW',
        total_orders: 10,
        successful_orders: 10,
        returned_orders: 0,
        raw_result: {},
        checked_at: '2026-09-25T00:00:00Z',
        checked_by: 'user-id',
      };

      const result = (customerRiskService as any).formatResult(record);
      expect(result.successRate).toBe(100);
    });

    it('should calculate success rate correctly (partial success)', () => {
      const record = {
        id: 'test-id',
        customer_id: 'cust-id',
        order_id: 'order-id',
        phone_number: '01912345678',
        provider: 'BD_COURIER',
        risk_score: 50,
        risk_level: 'MEDIUM',
        total_orders: 10,
        successful_orders: 8,
        returned_orders: 2,
        raw_result: {},
        checked_at: '2026-09-25T00:00:00Z',
        checked_by: 'user-id',
      };

      const result = (customerRiskService as any).formatResult(record);
      expect(result.successRate).toBe(80);
    });

    it('should calculate success rate correctly (no success)', () => {
      const record = {
        id: 'test-id',
        customer_id: 'cust-id',
        order_id: 'order-id',
        phone_number: '01912345678',
        provider: 'BD_COURIER',
        risk_score: 100,
        risk_level: 'HIGH',
        total_orders: 10,
        successful_orders: 0,
        returned_orders: 10,
        raw_result: {},
        checked_at: '2026-09-25T00:00:00Z',
        checked_by: 'user-id',
      };

      const result = (customerRiskService as any).formatResult(record);
      expect(result.successRate).toBe(0);
    });

    it('should handle zero total orders', () => {
      const record = {
        id: 'test-id',
        customer_id: 'cust-id',
        order_id: 'order-id',
        phone_number: '01912345678',
        provider: 'BD_COURIER',
        risk_score: 50,
        risk_level: 'MEDIUM',
        total_orders: 0,
        successful_orders: 0,
        returned_orders: 0,
        raw_result: {},
        checked_at: '2026-09-25T00:00:00Z',
        checked_by: 'user-id',
      };

      const result = (customerRiskService as any).formatResult(record);
      expect(result.successRate).toBeNull();
    });

    it('should format all required fields', () => {
      const record = {
        id: 'test-id',
        customer_id: 'cust-id',
        order_id: 'order-id',
        phone_number: '01912345678',
        provider: 'BD_COURIER',
        risk_score: 50,
        risk_level: 'MEDIUM',
        total_orders: 25,
        successful_orders: 22,
        returned_orders: 3,
        raw_result: {},
        checked_at: '2026-09-25T10:30:00Z',
        checked_by: 'user-id',
      };

      const result = (customerRiskService as any).formatResult(record);

      expect(result).toHaveProperty('phoneNumber', '01912345678');
      expect(result).toHaveProperty('totalOrders', 25);
      expect(result).toHaveProperty('successfulOrders', 22);
      expect(result).toHaveProperty('returnedOrders', 3);
      expect(result).toHaveProperty('successRate', 88);
      expect(result).toHaveProperty('riskScore', 50);
      expect(result).toHaveProperty('riskLevel', 'MEDIUM');
      expect(result).toHaveProperty('checkedAt', '2026-09-25T10:30:00Z');
    });

    it('should handle null values in record', () => {
      const record = {
        id: 'test-id',
        customer_id: 'cust-id',
        order_id: 'order-id',
        phone_number: '01912345678',
        provider: 'BD_COURIER',
        risk_score: null,
        risk_level: null,
        total_orders: null,
        successful_orders: null,
        returned_orders: null,
        raw_result: {},
        checked_at: '2026-09-25T00:00:00Z',
        checked_by: 'user-id',
      };

      const result = (customerRiskService as any).formatResult(record);

      expect(result.phoneNumber).toBe('01912345678');
      expect(result.totalOrders).toBeNull();
      expect(result.successRate).toBeNull();
      expect(result.riskScore).toBeNull();
    });
  });

  describe('Service Configuration', () => {
    it('should have correct rate limit window (5 minutes)', () => {
      const service = customerRiskService as any;
      expect(service.RATE_LIMIT_WINDOW_MS).toBe(5 * 60 * 1000);
    });

    it('should have correct API timeout (10 seconds)', () => {
      const service = customerRiskService as any;
      expect(service.API_TIMEOUT_MS).toBe(10000);
    });

    it('should have rate limit cache map', () => {
      const service = customerRiskService as any;
      expect(service.rateLimitCache).toBeDefined();
      expect(service.rateLimitCache instanceof Map).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle fractional success rates (rounding)', () => {
      const record = {
        id: 'test-id',
        customer_id: 'cust-id',
        order_id: 'order-id',
        phone_number: '01912345678',
        provider: 'BD_COURIER',
        risk_score: 50,
        risk_level: 'MEDIUM',
        total_orders: 3,
        successful_orders: 1,
        returned_orders: 2,
        raw_result: {},
        checked_at: '2026-09-25T00:00:00Z',
        checked_by: 'user-id',
      };

      const result = (customerRiskService as any).formatResult(record);
      // 1/3 = 0.333... → rounds to 33
      expect(result.successRate).toBe(33);
    });

    it('should handle phone numbers with multiple spaces', () => {
      const result = (customerRiskService as any).normalizePhoneNumber('019  12  34  56  78');
      expect(result).toBe('01912345678');
    });

    it('should handle phone numbers with multiple dashes', () => {
      const result = (customerRiskService as any).normalizePhoneNumber('019--1234--5678');
      expect(result).toBe('01912345678');
    });

    it('should handle mixed whitespace and dashes', () => {
      const result = (customerRiskService as any).normalizePhoneNumber('019 - 1234 - 5678');
      expect(result).toBe('01912345678');
    });
  });
});
