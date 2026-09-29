'use client';

import { useState } from 'react';
import { apiGet, ApiClientError } from '@/lib/apiClient';
import {
  courierLabel,
  orderStatusLabel,
  paymentStatusLabel,
  shipmentStatusLabel,
  type ShipmentInfo,
} from '@/lib/account';

const NOT_FOUND_MESSAGE = 'We could not find an order matching that Order Number and phone number.';

/**
 * Guest order lookup by (Order Number, Phone Number) pair (02-customer
 * §2.9.5-2.9.7). Shows the exact §2.9.6 fields only; a mismatch on either
 * field returns the same generic "not found" the backend already enforces —
 * this form never tries to distinguish which field was wrong.
 */

type LookupResult = {
  orderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  deliveryAddressSummary: {
    fullName: string;
    division: string;
    district: string;
    areaUnitType: string;
    areaUnitName: string;
    wardUnitType: string;
    wardUnitName: string;
  };
  shipment: ShipmentInfo;
};

export function GuestOrderLookupForm() {
  const [orderNumber, setOrderNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const query = new URLSearchParams({
        order_number: orderNumber.trim(),
        phone_number: phoneNumber.trim(),
      });
      const data = await apiGet<LookupResult>(`/api/customer/orders/lookup?${query.toString()}`);
      setResult(data);
    } catch (err) {
      // Any rejected pair — wrong order number, wrong phone, malformed input —
      // gets the same message (§2.9.7). Only a rate-limit lockout or a
      // connection problem is told apart, because the customer must act on it.
      if (err instanceof ApiClientError && (err.status === 429 || err.status === 0)) {
        setError(err.message);
      } else {
        setError(NOT_FOUND_MESSAGE);
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-lg">
        <div>
          <label htmlFor="orderNumber" className="mb-sm block text-xs font-semibold text-text-primary">
            Order Number
          </label>
          <input
            id="orderNumber"
            type="text"
            required
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            className="h-11 w-full rounded-lg border border-border bg-background px-md text-base text-text-primary focus:border-2 focus:border-primary focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="phoneNumber" className="mb-sm block text-xs font-semibold text-text-primary">
            Phone Number
          </label>
          <input
            id="phoneNumber"
            type="tel"
            required
            placeholder="01XXXXXXXXX"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            className="h-11 w-full rounded-lg border border-border bg-background px-md text-base text-text-primary focus:border-2 focus:border-primary focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="h-11 w-full rounded-lg bg-primary text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {isLoading ? 'Looking up…' : 'Find My Order'}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-lg text-sm text-error">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-xl space-y-md rounded-lg border border-border p-lg">
          <div>
            <p className="text-xs text-text-secondary">Order Number</p>
            <p className="font-mono text-base font-bold text-primary">{result.orderNumber}</p>
          </div>
          <div>
            <p className="text-xs text-text-secondary">Order Status</p>
            <p className="text-sm font-semibold text-text-primary">{orderStatusLabel(result.orderStatus)}</p>
          </div>
          <div>
            <p className="text-xs text-text-secondary">Payment Status</p>
            <p className="text-sm font-semibold text-text-primary">{paymentStatusLabel(result.paymentStatus)}</p>
          </div>
          <div>
            <p className="text-xs text-text-secondary">Delivery Address</p>
            <p className="text-sm text-text-primary">
              {result.deliveryAddressSummary.fullName}, {result.deliveryAddressSummary.areaUnitName},{' '}
              {result.deliveryAddressSummary.district}, {result.deliveryAddressSummary.division}
            </p>
          </div>
          <div>
            <p className="text-xs text-text-secondary">Shipment Status</p>
            <p className="text-sm font-semibold text-text-primary">
              {shipmentStatusLabel(result.shipment.shipmentStatus)}
            </p>
          </div>
          {result.shipment.courier && (
            <div>
              <p className="text-xs text-text-secondary">Courier</p>
              <p className="text-sm text-text-primary">{courierLabel(result.shipment.courier)}</p>
            </div>
          )}
          {result.shipment.trackingId && (
            <div>
              <p className="text-xs text-text-secondary">Parcel / Tracking ID</p>
              <p className="font-mono text-sm text-text-primary">{result.shipment.trackingId}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
