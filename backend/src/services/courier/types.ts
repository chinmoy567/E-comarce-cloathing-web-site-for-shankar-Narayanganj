/**
 * Courier adapter contract (04-courier-shipment §4.9).
 *
 * Every provider implements the same four operations with the same input and
 * return shapes. Provider-specific fields and statuses are normalized INSIDE the
 * adapter; no raw provider response ever crosses this boundary, so the core
 * order-management code never needs to know which courier handled a shipment.
 */

import type { ShipmentStatus } from '../../types/orderEnums.js';

export type CourierShipmentRequest = {
  /** orders.order_number — the store reference, never confused with the courier id (§4.15). */
  orderReference: string;
  recipient: {
    name: string;
    phone: string;
    division: string;
    district: string;
    areaUnitType: 'UPAZILA' | 'THANA';
    areaUnitName: string;
    wardUnitType: 'UNION' | 'WARD';
    wardUnitName: string;
    detailedAddress: string;
    postalCode: string | null;
  };
  items: Array<{ name: string; quantity: number }>;
  /** orders.total_amount — the server-computed, discounted final total (§4.2). */
  orderAmount: number;
  /** total_amount for a COD order, 0 for a prepaid bKash order (§4.4). */
  codAmount: number;
  weightGrams: number;
  deliveryInstructions: string | null;
};

export type CourierShipmentResult = {
  /** The courier's Parcel / Consignment / Tracking id — one identifier (§4.5, §4.15). */
  courierOrderId: string;
  trackingUrl: string | null;
  rawProviderReference: string | null;
};

export type NormalizedTracking = {
  status: ShipmentStatus;
  events: Array<{ status: ShipmentStatus; occurredAt: string | null; description: string }>;
  estimatedDeliveryAt: string | null;
  /** Area only — never the full address (§4.16). */
  deliveryAreaSummary: string | null;
};

export type CourierCancelResult = { cancelled: boolean; reason?: string };

/**
 * One status update parsed from an inbound courier webhook (spec 15, §4.6). The
 * status is already in the shared vocabulary; `null` means the provider sent a
 * status this platform does not recognise — logged and ignored, never guessed (§4.9).
 */
export type CourierWebhookUpdate = {
  courierOrderId: string;
  status: ShipmentStatus | null;
  /** Provider's own event id when it supplies one — the strongest duplicate key. */
  providerEventId: string | null;
  occurredAt: string | null;
};

/** One non-secret setting an adapter accepts in couriers.config. Secrets are never declared. */
export type CourierConfigField = { key: string; label: string; type: 'string' | 'number' };

export interface CourierAdapter {
  readonly key: string;
  /** Non-secret settings this adapter reads from couriers.config (allowlist). */
  readonly configSchema: readonly CourierConfigField[];
  /** True when the adapter's env credentials are present (never exposes a value). */
  isConfigured(): boolean;
  createShipment(req: CourierShipmentRequest, config: Record<string, unknown>): Promise<CourierShipmentResult>;
  /**
   * Looks a parcel up by the store's order reference to detect an already-created
   * shipment before a retry. Only meaningful when the courier row has
   * supports_reference_lookup = true; adapters without it omit the method.
   */
  findShipmentByReference?(orderReference: string, config: Record<string, unknown>): Promise<CourierShipmentResult | null>;
  getShipmentDetails(courierOrderId: string, config: Record<string, unknown>): Promise<NormalizedTracking>;
  trackShipment(courierOrderId: string, config: Record<string, unknown>): Promise<NormalizedTracking>;
  cancelShipment(courierOrderId: string, config: Record<string, unknown>): Promise<CourierCancelResult>;
  /**
   * Webhook support is optional and provider-defined (§4.6: "depending on what the
   * selected courier API supports"). An adapter implements BOTH or NEITHER, and only
   * from the provider's current official documentation (CLAUDE.md §6). The secret is
   * read from the adapter's own env variables, never from the database.
   * `verifyWebhook` receives the exact raw bytes and must compare in constant time.
   */
  verifyWebhook?(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;
  /** Parses a VERIFIED payload into zero or more normalized updates. Throws on malformed input. */
  parseWebhook?(rawBody: Buffer): CourierWebhookUpdate[];
}

/** A provider call failed. `message` is already sanitized and safe to show in the Order Panel. */
export class CourierCallError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = 'CourierCallError';
  }
}
