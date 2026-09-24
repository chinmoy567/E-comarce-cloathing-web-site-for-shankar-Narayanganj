import { createClient } from '@supabase/supabase-js';
import axios, { AxiosInstance } from 'axios';
import { Database } from '../../database/types.js';
import { AppError, ErrorCode } from '../../utils/errors.js';

const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface RawRiskCheckResponse {
  phone_number?: string;
  total_orders?: number;
  successful_orders?: number;
  returned_orders?: number;
  delivery_success_rate?: number;
  risk_score?: number;
  risk_level?: string;
  [key: string]: any;
}

export interface RiskCheckResult {
  phoneNumber: string;
  totalOrders: number | null;
  successfulOrders: number | null;
  returnedOrders: number | null;
  successRate: number | null;
  riskScore: number | null;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' | 'CHECK_FAILED';
  checkedAt: string;
  error?: {
    code: string;
    message: string;
  };
}

interface RiskCheckRecord {
  id: string;
  customer_id: string;
  order_id: string;
  phone_number: string;
  provider: string;
  risk_score: number | null;
  risk_level: string | null;
  total_orders: number | null;
  successful_orders: number | null;
  returned_orders: number | null;
  raw_result: RawRiskCheckResponse;
  checked_at: string;
  checked_by: string;
}

class CustomerRiskService {
  private apiClient: AxiosInstance | null = null;
  private rateLimitCache: Map<string, number> = new Map();
  private readonly RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  private readonly API_TIMEOUT_MS = 10000; // 10 seconds

  constructor() {
    this.initializeApiClient();
  }

  private initializeApiClient(): void {
    const baseUrl = process.env.BD_COURIER_BASE_URL;
    const apiKey = process.env.BD_COURIER_API_KEY;

    if (!baseUrl || !apiKey) {
      console.warn(
        '[CustomerRiskService] BD_COURIER_BASE_URL or BD_COURIER_API_KEY not configured'
      );
      return;
    }

    this.apiClient = axios.create({
      baseURL: baseUrl,
      timeout: this.API_TIMEOUT_MS,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async checkCustomerRisk(
    orderId: string,
    customerId: string,
    phoneNumber: string,
    userId: string,
    forceRefresh: boolean = false
  ): Promise<RiskCheckResult> {
    try {
      // Validate inputs
      if (!orderId || !customerId || !phoneNumber || !userId) {
        throw new AppError(
          'Missing required parameters',
          ErrorCode.VALIDATION_ERROR,
          400
        );
      }

      // Normalize phone number
      const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
      if (!normalizedPhone) {
        throw new AppError(
          'Invalid Bangladesh phone number format',
          ErrorCode.VALIDATION_ERROR,
          400
        );
      }

      // Check rate limit if not forcing refresh
      if (!forceRefresh) {
        const rateLimitKey = `risk_check_${customerId}`;
        const lastCheckTime = this.rateLimitCache.get(rateLimitKey);
        if (lastCheckTime && Date.now() - lastCheckTime < this.RATE_LIMIT_WINDOW_MS) {
          // Try to use cached result from database
          const cachedResult = await this.getLatestRiskCheck(customerId);
          if (cachedResult) {
            return this.formatResult(cachedResult);
          }
        }
      }

      // Call external API
      let apiResult: RawRiskCheckResponse;
      try {
        apiResult = await this.callBDCourierAPI(normalizedPhone);
      } catch (apiError: any) {
        console.error('[CustomerRiskService] BD Courier API error:', apiError.message);
        // Non-blocking: return error but don't fail
        return {
          phoneNumber: normalizedPhone,
          totalOrders: null,
          successfulOrders: null,
          returnedOrders: null,
          successRate: null,
          riskScore: null,
          riskLevel: 'CHECK_FAILED',
          checkedAt: new Date().toISOString(),
          error: {
            code: 'API_UNAVAILABLE',
            message: 'Risk check service unavailable. Please try again later.',
          },
        };
      }

      // No delivery history found
      if (!apiResult || Object.keys(apiResult).length === 0) {
        return {
          phoneNumber: normalizedPhone,
          totalOrders: null,
          successfulOrders: null,
          returnedOrders: null,
          successRate: null,
          riskScore: null,
          riskLevel: 'UNKNOWN',
          checkedAt: new Date().toISOString(),
          error: {
            code: 'NO_DELIVERY_HISTORY',
            message: 'No courier delivery history found for this phone number.',
          },
        };
      }

      // Store result in database
      const result = await this.storeRiskCheck(
        orderId,
        customerId,
        normalizedPhone,
        userId,
        apiResult
      );

      // Update rate limit cache
      this.rateLimitCache.set(`risk_check_${customerId}`, Date.now());

      return this.formatResult(result);
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      console.error('[CustomerRiskService] Unexpected error:', error);
      throw new AppError(
        'Failed to check customer risk',
        ErrorCode.INTERNAL_ERROR,
        500
      );
    }
  }

  async getLatestRiskCheck(customerId: string): Promise<RiskCheckRecord | null> {
    try {
      const { data, error } = await supabase
        .from('customer_risk_checks')
        .select('*')
        .eq('customer_id', customerId)
        .order('checked_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
        throw error;
      }

      return data as RiskCheckRecord | null;
    } catch (error: any) {
      console.error('[CustomerRiskService] Error fetching latest risk check:', error);
      return null;
    }
  }

  private async callBDCourierAPI(phoneNumber: string): Promise<RawRiskCheckResponse> {
    if (!this.apiClient) {
      throw new Error('BD Courier API client not initialized');
    }

    try {
      const { data } = await this.apiClient.post('/fraud-check', {
        phone: phoneNumber,
      });

      return data || {};
    } catch (error: any) {
      if (error.response?.status === 404 || error.response?.status === 204) {
        // No history found
        return {};
      }
      throw error;
    }
  }

  private async storeRiskCheck(
    orderId: string,
    customerId: string,
    phoneNumber: string,
    userId: string,
    apiResult: RawRiskCheckResponse
  ): Promise<RiskCheckRecord> {
    const riskLevel = this.calculateRiskLevel(apiResult);

    const { data, error } = await supabase
      .from('customer_risk_checks')
      .insert({
        customer_id: customerId,
        order_id: orderId,
        phone_number: phoneNumber,
        provider: 'BD_COURIER',
        risk_score: apiResult.risk_score || null,
        risk_level: riskLevel,
        total_orders: apiResult.total_orders || null,
        successful_orders: apiResult.successful_orders || null,
        returned_orders: apiResult.returned_orders || null,
        raw_result: apiResult,
        checked_by: userId,
      })
      .select()
      .single();

    if (error) {
      console.error('[CustomerRiskService] Error storing risk check:', error);
      throw new AppError(
        'Failed to store risk check result',
        ErrorCode.INTERNAL_ERROR,
        500
      );
    }

    return data as RiskCheckRecord;
  }

  private calculateRiskLevel(apiResult: RawRiskCheckResponse): string {
    if (!apiResult) return 'UNKNOWN';

    const riskScore = apiResult.risk_score;
    if (riskScore === null || riskScore === undefined) {
      return apiResult.risk_level || 'UNKNOWN';
    }

    if (riskScore >= 70) return 'HIGH';
    if (riskScore >= 40) return 'MEDIUM';
    if (riskScore >= 0) return 'LOW';
    return 'UNKNOWN';
  }

  private normalizePhoneNumber(phone: string): string {
    if (!phone) return '';

    let normalized = phone.trim().replace(/[^\d+]/g, '');

    // BD phone numbers: 01XXXXXXXXX or +880XXXXXXXXX
    if (normalized.startsWith('+880')) {
      normalized = '0' + normalized.slice(4);
    } else if (normalized.startsWith('880')) {
      normalized = '0' + normalized.slice(3);
    }

    // Validate format: 01XXXXXXXXX (11 digits starting with 01)
    if (!/^01\d{9}$/.test(normalized)) {
      return '';
    }

    return normalized;
  }

  private formatResult(record: RiskCheckRecord): RiskCheckResult {
    const totalOrders = record.total_orders || 0;
    const successfulOrders = record.successful_orders || 0;
    const successRate =
      totalOrders > 0 ? Math.round((successfulOrders / totalOrders) * 100) : null;

    return {
      phoneNumber: record.phone_number,
      totalOrders: record.total_orders,
      successfulOrders: record.successful_orders,
      returnedOrders: record.returned_orders,
      successRate,
      riskScore: record.risk_score,
      riskLevel: (record.risk_level as any) || 'UNKNOWN',
      checkedAt: record.checked_at,
    };
  }
}

export const customerRiskService = new CustomerRiskService();
