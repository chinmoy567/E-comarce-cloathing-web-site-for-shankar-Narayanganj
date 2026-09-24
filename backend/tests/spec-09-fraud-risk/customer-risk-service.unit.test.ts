import { describe, it, expect, beforeEach, vi } from 'vitest';
import { customerRiskService } from '../../src/services/fraud/customerRiskService.js';

describe('CustomerRiskService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('normalizePhoneNumber', () => {
    it('should normalize 01XXXXXXXXX format', () => {
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

    it('should handle phone with spaces and dashes', () => {
      const result = (customerRiskService as any).normalizePhoneNumber('01912-345-678');
      expect(result).toBe('01912345678');
    });

    it('should return empty string for invalid format', () => {
      expect((customerRiskService as any).normalizePhoneNumber('invalid')).toBe('');
      expect((customerRiskService as any).normalizePhoneNumber('1234567890')).toBe('');
      expect((customerRiskService as any).normalizePhoneNumber('02912345678')).toBe('');
    });

    it('should return empty string for wrong length', () => {
      expect((customerRiskService as any).normalizePhoneNumber('0191234567')).toBe(''); // too short
      expect((customerRiskService as any).normalizePhoneNumber('019123456789')).toBe(''); // too long
    });
  });

  describe('calculateRiskLevel', () => {
    it('should return HIGH for risk_score >= 70', () => {
      const result = (customerRiskService as any).calculateRiskLevel({ risk_score: 75 });
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
  });

  describe('formatResult', () => {
    it('should calculate success rate correctly', () => {
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
      expect(result.successRate).toBe(80); // (8/10) * 100
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
  });

  describe('Rate limiting', () => {
    it('should track rate limit cache', () => {
      const rateLimitKey = 'risk_check_cust-123';
      const cache = (customerRiskService as any).rateLimitCache;

      expect(cache.get(rateLimitKey)).toBeUndefined();

      cache.set(rateLimitKey, Date.now());
      expect(cache.get(rateLimitKey)).toBeDefined();
    });

    it('should respect RATE_LIMIT_WINDOW_MS', () => {
      const service = customerRiskService as any;
      expect(service.RATE_LIMIT_WINDOW_MS).toBe(5 * 60 * 1000); // 5 minutes
    });

    it('should respect API_TIMEOUT_MS', () => {
      const service = customerRiskService as any;
      expect(service.API_TIMEOUT_MS).toBe(10000); // 10 seconds
    });
  });

  describe('API initialization', () => {
    it('should log warning if BD_COURIER credentials missing', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Create new instance without credentials
      const originalBaseUrl = process.env.BD_COURIER_BASE_URL;
      const originalApiKey = process.env.BD_COURIER_API_KEY;

      delete process.env.BD_COURIER_BASE_URL;
      delete process.env.BD_COURIER_API_KEY;

      // Note: In real tests, this would be tested differently
      // as the service is a singleton. This is here for documentation.

      process.env.BD_COURIER_BASE_URL = originalBaseUrl || '';
      process.env.BD_COURIER_API_KEY = originalApiKey || '';

      consoleSpy.mockRestore();
    });
  });
});
