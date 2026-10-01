import type { TrackingEvent } from './tracking';

/** POST /api/track-order response (customer-safe: shipment status only, never an order-status value — §4.14.6). */
export type TrackOrderFound = {
  found: true;
  trackingId: string;
  courierName: string;
  /** The ShipmentStatus enum — labels are mapped here, never trusted as pre-formatted. */
  shipmentStatus: string;
  events: TrackingEvent[];
  estimatedDeliveryAt: string | null;
  deliveryAreaSummary: string | null;
  courierTrackingUrl: string | null;
};

export type TrackOrderNotFound = {
  found: false;
  reason: 'GENERIC' | 'NOT_AVAILABLE_YET';
  message: string;
};

export type TrackOrderResponse = TrackOrderFound | TrackOrderNotFound;
