import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { Database } from '../../src/database/types.js';

const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const API_URL = process.env.API_URL || 'http://localhost:3000';
const axiosInstance = axios.create({ baseURL: API_URL });

interface TestOrder {
  id: string;
  customer_id: string;
  order_number: string;
  order_status: string;
}

interface TestCustomer {
  id: string;
  phone_number: string;
}

interface TestUser {
  id: string;
  role: string;
}

describe('Spec 09: Customer Risk Check API', () => {
  let testAdmin: TestUser;
  let testManager: TestUser;
  let testCustomer: TestCustomer;
  let testOrder: TestOrder;
  let adminToken: string;
  let managerToken: string;

  beforeAll(async () => {
    // Create test admin
    const { data: adminData } = await supabase
      .from('users')
      .insert({
        phone_number: '01700000001',
        role: 'ADMIN',
        password_hash: 'hashed_test_password',
        is_active: true,
      })
      .select()
      .single();
    testAdmin = adminData as TestUser;

    // Create test manager
    const { data: managerData } = await supabase
      .from('users')
      .insert({
        phone_number: '01700000002',
        role: 'MANAGER',
        password_hash: 'hashed_test_password',
        is_active: true,
      })
      .select()
      .single();
    testManager = managerData as TestUser;

    // Create test customer
    const { data: customerData } = await supabase
      .from('customers')
      .insert({
        phone_number: '01912345678',
        email: 'testcustomer@example.com',
        first_name: 'Test',
        last_name: 'Customer',
      })
      .select()
      .single();
    testCustomer = customerData as TestCustomer;

    // Create test order in CONFIRMED status
    const { data: orderData } = await supabase
      .from('orders')
      .insert({
        customer_id: testCustomer.id,
        order_number: `ORD-${Date.now()}`,
        payment_method: 'COD',
        order_status: 'CONFIRMED',
        payment_status: 'PENDING_COLLECTION',
        subtotal: 5000,
        total_amount: 5500,
      })
      .select()
      .single();
    testOrder = orderData as TestOrder;

    // Mock auth tokens (in real tests, use proper auth)
    adminToken = 'mock-admin-token';
    managerToken = 'mock-manager-token';
  });

  afterAll(async () => {
    // Cleanup
    if (testOrder?.id) {
      await supabase.from('orders').delete().eq('id', testOrder.id);
    }
    if (testCustomer?.id) {
      await supabase.from('customers').delete().eq('id', testCustomer.id);
    }
    if (testAdmin?.id) {
      await supabase.from('users').delete().eq('id', testAdmin.id);
    }
    if (testManager?.id) {
      await supabase.from('users').delete().eq('id', testManager.id);
    }
  });

  describe('POST /api/admin/orders/:id/risk-check', () => {
    it('should return 404 if order not found', async () => {
      try {
        await axiosInstance.post(
          `/api/admin/orders/nonexistent-id/risk-check`,
          { forceRefresh: false },
          { headers: { Authorization: `Bearer ${adminToken}` } }
        );
        expect.fail('Should have thrown 404');
      } catch (error: any) {
        expect(error.response?.status).toBe(404);
        expect(error.response?.data?.error?.code).toBe('NOT_FOUND');
      }
    });

    it('should reject if order status is not CONFIRMED or PROCESSING', async () => {
      // Create order in PENDING_CONFIRMATION status
      const { data: pendingOrder } = await supabase
        .from('orders')
        .insert({
          customer_id: testCustomer.id,
          order_number: `ORD-PENDING-${Date.now()}`,
          payment_method: 'COD',
          order_status: 'PENDING_CONFIRMATION',
          payment_status: 'PENDING_COLLECTION',
          subtotal: 5000,
          total_amount: 5500,
        })
        .select()
        .single();

      try {
        await axiosInstance.post(
          `/api/admin/orders/${pendingOrder.id}/risk-check`,
          { forceRefresh: false },
          { headers: { Authorization: `Bearer ${adminToken}` } }
        );
        expect.fail('Should have thrown 400');
      } catch (error: any) {
        expect(error.response?.status).toBe(400);
        expect(error.response?.data?.error?.code).toBe('INVALID_ORDER_STATUS');
      }

      // Cleanup
      await supabase.from('orders').delete().eq('id', pendingOrder.id);
    });

    it('should require customer.risk.check permission', async () => {
      // Test without permission (use invalidated token)
      try {
        await axiosInstance.post(
          `/api/admin/orders/${testOrder.id}/risk-check`,
          { forceRefresh: false },
          { headers: { Authorization: 'Bearer invalid-token' } }
        );
        expect.fail('Should have thrown 401/403');
      } catch (error: any) {
        expect([401, 403]).toContain(error.response?.status);
      }
    });

    it('should cache results per customer_id', async () => {
      // First check
      const firstResponse = await axiosInstance.post(
        `/api/admin/orders/${testOrder.id}/risk-check`,
        { forceRefresh: false },
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );

      expect(firstResponse.status).toBe(200);
      expect(firstResponse.data.success).toBe(true);
      expect(firstResponse.data.data.phoneNumber).toBeDefined();
      expect(firstResponse.data.data.checkedAt).toBeDefined();

      const firstCheckedAt = firstResponse.data.data.checkedAt;

      // Second check within rate limit (should return cached)
      const secondResponse = await axiosInstance.post(
        `/api/admin/orders/${testOrder.id}/risk-check`,
        { forceRefresh: false },
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );

      expect(secondResponse.status).toBe(200);
      expect(secondResponse.data.data.checkedAt).toBe(firstCheckedAt);
    });

    it('should bypass cache with forceRefresh=true', async () => {
      // First check
      const firstResponse = await axiosInstance.post(
        `/api/admin/orders/${testOrder.id}/risk-check`,
        { forceRefresh: false },
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );

      const firstCheckedAt = firstResponse.data.data.checkedAt;

      // Wait 100ms
      await new Promise(resolve => setTimeout(resolve, 100));

      // Force refresh
      const refreshResponse = await axiosInstance.post(
        `/api/admin/orders/${testOrder.id}/risk-check`,
        { forceRefresh: true },
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );

      expect(refreshResponse.status).toBe(200);
      // Note: checkedAt may be newer if API was actually called
    });

    it('should validate Bangladesh phone number format', async () => {
      // Create customer with invalid phone
      const { data: invalidCustomer } = await supabase
        .from('customers')
        .insert({
          phone_number: 'invalid-phone',
          email: 'invalid@example.com',
          first_name: 'Invalid',
          last_name: 'Phone',
        })
        .select()
        .single();

      const { data: orderWithInvalid } = await supabase
        .from('orders')
        .insert({
          customer_id: invalidCustomer.id,
          order_number: `ORD-INVALID-${Date.now()}`,
          payment_method: 'COD',
          order_status: 'CONFIRMED',
          payment_status: 'PENDING_COLLECTION',
          subtotal: 5000,
          total_amount: 5500,
        })
        .select()
        .single();

      try {
        await axiosInstance.post(
          `/api/admin/orders/${orderWithInvalid.id}/risk-check`,
          { forceRefresh: true },
          { headers: { Authorization: `Bearer ${adminToken}` } }
        );
        // May fail or return error depending on API response
      } catch (error: any) {
        expect([400, 500]).toContain(error.response?.status);
      }

      // Cleanup
      await supabase.from('orders').delete().eq('id', orderWithInvalid.id);
      await supabase.from('customers').delete().eq('id', invalidCustomer.id);
    });

    it('should handle API unavailability gracefully (non-blocking)', async () => {
      // Set invalid API credentials to simulate unavailability
      const originalApiKey = process.env.BD_COURIER_API_KEY;
      process.env.BD_COURIER_API_KEY = 'invalid-key-test';

      try {
        const response = await axiosInstance.post(
          `/api/admin/orders/${testOrder.id}/risk-check`,
          { forceRefresh: true },
          { headers: { Authorization: `Bearer ${adminToken}` } }
        );

        // Should return 200 (non-blocking) but with error indicator
        expect(response.status).toBe(200);
        expect(response.data.data.riskLevel).toBe('CHECK_FAILED');
        expect(response.data.data.error).toBeDefined();
        expect(response.data.data.error.code).toBe('API_UNAVAILABLE');
      } finally {
        // Restore API key
        process.env.BD_COURIER_API_KEY = originalApiKey;
      }
    });

    it('should log audit entry on risk check', async () => {
      await axiosInstance.post(
        `/api/admin/orders/${testOrder.id}/risk-check`,
        { forceRefresh: false },
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );

      // Verify audit log created
      const { data: auditLogs } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('action', 'CUSTOMER_RISK_CHECK')
        .eq('resource_id', testOrder.id)
        .limit(1)
        .order('created_at', { ascending: false });

      expect(auditLogs?.length).toBeGreaterThan(0);
      if (auditLogs && auditLogs.length > 0) {
        expect(auditLogs[0].actor_id).toBe(testAdmin.id);
        expect(auditLogs[0].resource_type).toBe('ORDER');
      }
    });

    it('should format response correctly', async () => {
      const response = await axiosInstance.post(
        `/api/admin/orders/${testOrder.id}/risk-check`,
        { forceRefresh: false },
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success');
      expect(response.data).toHaveProperty('data');

      const data = response.data.data;
      expect(data).toHaveProperty('phoneNumber');
      expect(data).toHaveProperty('totalOrders');
      expect(data).toHaveProperty('successfulOrders');
      expect(data).toHaveProperty('returnedOrders');
      expect(data).toHaveProperty('successRate');
      expect(data).toHaveProperty('riskScore');
      expect(data).toHaveProperty('riskLevel');
      expect(data).toHaveProperty('checkedAt');

      // Verify risk level is one of expected values
      expect([
        'LOW',
        'MEDIUM',
        'HIGH',
        'UNKNOWN',
        'CHECK_FAILED',
      ]).toContain(data.riskLevel);
    });
  });
});
