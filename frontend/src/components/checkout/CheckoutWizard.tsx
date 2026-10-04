'use client';

import { Icon } from '@/components/ui/Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart, useCartState } from '@/lib/useCart';
import { clearCart } from '@/lib/cart';
import { track } from '@/lib/analytics';
import { META_EVENTS } from '@shared/analytics';
import { apiPost, ApiClientError } from '@/lib/apiClient';
import { Button } from '@/components/admin/Button';
import { AddressFields, EMPTY_ADDRESS, type AddressFieldsValue } from './AddressFields';
import { CouponField, type AppliedCoupon } from './CouponField';
import { ShippingSummaryLine } from './ShippingSummaryLine';
import { FreeShippingHint } from './FreeShippingHint';
import { PaymentProofUpload } from './PaymentProofUpload';
import { useCheckoutPricing } from '@/lib/useCheckoutPricing';
import { buildPricingRequest, describeTotal } from '@/lib/checkoutPricingView';
import { formatMoney } from '@/lib/account';

/**
 * Checkout wizard (02-customer §2.9.1, 03-payment-order §3.1/§3.2).
 *
 * 3 steps per the design skill: delivery address -> payment method ->
 * payment-specific confirmation. Guest fields are shown directly with no
 * "continue as guest" choice screen (§2.9.1 step 2) when `isLoggedIn` is
 * false; a logged-in customer skips straight to payment (§2.3) since their
 * saved profile is used server-side.
 *
 * Never computes/trusts a price, shipping amount or total itself (CLAUDE.md §3).
 * Shipping, discount and Total are the figures `POST /api/checkout/validate`
 * returned (spec 21); the authoritative amounts are whatever the
 * order-creation response returns. The item subtotal row falls back to the
 * display-only add-to-cart snapshot until the backend figure arrives.
 */

type PaymentMethod = 'BKASH' | 'COD';

type OrderResponse = {
  id: string;
  orderNumber: string;
  paymentMethod: PaymentMethod;
  orderStatus: string;
  paymentStatus: string;
  subtotal: number;
  shippingAmount: number;
  discountAmount: number | null;
  couponCode: string | null;
  totalAmount: number;
};

const BKASH_MERCHANT_NUMBER = process.env.NEXT_PUBLIC_BKASH_MERCHANT_NUMBER ?? '01700000000';

function getOrCreateIdempotencyKey(): string {
  const storageKey = 'fabrillke_checkout_idempotency_key';
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const generated = crypto.randomUUID();
    window.sessionStorage.setItem(storageKey, generated);
    return generated;
  } catch {
    return crypto.randomUUID();
  }
}

function clearIdempotencyKey(): void {
  try {
    window.sessionStorage.removeItem('fabrillke_checkout_idempotency_key');
  } catch {
    // ignore
  }
}

export function CheckoutWizard({ isLoggedIn }: { isLoggedIn: boolean }) {
  const router = useRouter();
  const lines = useCart();
  const { status: cartStatus, cart: serverCart } = useCartState();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [address, setAddress] = useState<AddressFieldsValue>(EMPTY_ADDRESS);
  const [addressErrors, setAddressErrors] = useState<Record<string, string>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('COD');
  const [bkashTransactionId, setBkashTransactionId] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [placedOrder, setPlacedOrder] = useState<OrderResponse | null>(null);

  // Display fallback while the backend quote loads — the server cart's own subtotal, never summed here.
  const subtotal = serverCart?.merchandiseSubtotal ?? 0;
  const lineTotalOf = (variantId: string | null): number =>
    serverCart?.lines.find((sl) => sl.variantId === variantId)?.lineTotal ?? 0;

  // Backend-computed pricing (spec 21). Requested only once the district is known (guest) — the default
  // THANA discriminator alone never implies "metropolitan". The request carries ids/quantities, the coupon
  // code and the district + area type only; never a price, shipping amount or total.
  const pricingRequest = useMemo(
    () =>
      buildPricingRequest({
        lines: lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity })),
        couponCode: appliedCoupon?.couponCode ?? null,
        address,
        isLoggedIn,
      }),
    [lines, appliedCoupon?.couponCode, address, isLoggedIn],
  );
  const { phase: pricingPhase, pricing, retry: retryPricing } = useCheckoutPricing(pricingRequest);

  const shownSubtotal = pricingPhase === 'ready' && pricing ? pricing.subtotal : subtotal;
  const shownDiscount = pricingPhase === 'ready' && pricing ? pricing.discountAmount : (appliedCoupon?.discountAmount ?? 0);
  const totalText = describeTotal(pricingPhase, pricing);

  const couponLines = useMemo(
    () => lines.map((l) => ({ variantId: l.variantId ?? l.productId, quantity: l.quantity })),
    [lines],
  );

  // InitiateCheckout: once per visit, when the cart has items (08-analytics-meta §6.2).
  const checkoutTracked = useRef(false);
  useEffect(() => {
    if (checkoutTracked.current || lines.length === 0) return;
    checkoutTracked.current = true;
    track(META_EVENTS.INITIATE_CHECKOUT, {
      content_ids: lines.map((l) => l.variantId ?? l.productId),
      content_type: 'product',
      contents: lines.map((l) => ({ id: l.variantId ?? l.productId, quantity: l.quantity, item_price: l.displaySnapshot.unitPrice })),
      num_items: lines.reduce((sum, l) => sum + l.quantity, 0),
      // No value: the browser never computes one (spec 18). The backend recomputes its CAPI copy.
    });
  }, [lines]);

  function continueToReview() {
    // AddPaymentInfo: payment method selected and submitted (§6.2). Never sends the bKash Transaction ID (§6.6).
    track(META_EVENTS.ADD_PAYMENT_INFO, {
      content_ids: lines.map((l) => l.variantId ?? l.productId),
      content_type: 'product',
      contents: lines.map((l) => ({ id: l.variantId ?? l.productId, quantity: l.quantity, item_price: l.displaySnapshot.unitPrice })),
    });
    setStep(3);
  }

  function goToPayment() {
    if (isLoggedIn) {
      setStep(2);
      return;
    }
    const required: Array<[keyof AddressFieldsValue, string]> = [
      ['fullName', 'Full name is required.'],
      ['phoneNumber', 'Phone number is required.'],
      ['division', 'Division is required.'],
      ['district', 'District is required.'],
      ['areaUnitName', 'Upazila/Thana is required.'],
      ['wardUnitName', 'Union/Ward is required.'],
      ['detailedAddress', 'Detailed address is required.'],
    ];
    const errors: Record<string, string> = {};
    for (const [field, message] of required) {
      if (!address[field] || String(address[field]).trim().length === 0) {
        errors[field === 'areaUnitName' ? 'areaUnit' : field === 'wardUnitName' ? 'wardUnit' : field] = message;
      }
    }
    setAddressErrors(errors);
    if (Object.keys(errors).length === 0) setStep(2);
  }

  async function handlePlaceOrder() {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const result = await apiPost<OrderResponse>('/api/customer/orders', {
        paymentMethod,
        lines: lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          quantity: l.quantity,
        })),
        couponCode: appliedCoupon?.couponCode ?? null,
        idempotencyKey: getOrCreateIdempotencyKey(),
        guestFields: isLoggedIn
          ? null
          : {
              fullName: address.fullName,
              phoneNumber: address.phoneNumber,
              email: address.email || null,
              division: address.division,
              district: address.district,
              areaUnitType: address.areaUnitType,
              areaUnitName: address.areaUnitName,
              wardUnitType: address.wardUnitType,
              wardUnitName: address.wardUnitName,
              detailedAddress: address.detailedAddress,
              postalCode: address.postalCode || null,
            },
        bkashTransactionId: paymentMethod === 'BKASH' && bkashTransactionId.trim() ? bkashTransactionId.trim() : null,
      });

      void clearCart().catch(() => undefined);
      clearIdempotencyKey();
      setPlacedOrder(result);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.message.match(/profile is incomplete/i)) {
          setSubmitError('Your profile is incomplete. Please complete your profile before placing an order.');
        } else {
          setSubmitError(err.message);
        }
      } else {
        setSubmitError('Something went wrong. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if ((cartStatus === 'idle' || cartStatus === 'loading') && lines.length === 0 && !placedOrder) {
    return <p className="text-text-secondary">Loading your cart…</p>;
  }

  if (lines.length === 0 && !placedOrder) {
    return (
      <div className="py-2xl text-center">
        <p className="text-text-secondary">Your cart is empty.</p>
      </div>
    );
  }

  if (placedOrder) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-border p-xl text-center">
        <span aria-hidden="true" className="mx-auto mb-md flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
          <Icon name="check" className="h-6 w-6" />
        </span>
        <h2 className="mb-sm text-xl font-bold text-text-primary">Order Confirmed</h2>
        <p className="mb-lg font-mono text-lg font-bold text-primary">{placedOrder.orderNumber}</p>

        {!isLoggedIn ? (
          <p className="mb-lg text-sm text-text-secondary">
            Save your Order Number and phone number — you can look up this order any time using both together on the{' '}
            <Link href="/orders/lookup" className="font-semibold text-primary underline">
              order lookup page
            </Link>
            .
          </p>
        ) : (
          <p className="mb-lg text-sm text-text-secondary">
            You can follow this order in{' '}
            <Link href="/account/orders" className="font-semibold text-primary underline">
              My Orders
            </Link>
            .
          </p>
        )}
        {/* §4.14.7: no tracking exists until a courier shipment is created, so none is promised here. */}
        <p className="mb-lg text-sm text-text-secondary">
          You can track your parcel once it has shipped, using the courier&apos;s Order ID or Tracking ID on{' '}
          <Link href="/track-order" className="font-semibold text-primary underline">
            Track Order
          </Link>
          .
        </p>

        <div className="mb-lg space-y-sm rounded-lg bg-surface p-lg text-left text-sm">
          <div className="flex justify-between">
            <span className="text-text-secondary">Subtotal</span>
            <span>{formatMoney(placedOrder.subtotal)}</span>
          </div>
          {placedOrder.discountAmount ? (
            <div className="flex justify-between">
              <span className="text-text-secondary">Discount</span>
              <span>-{formatMoney(placedOrder.discountAmount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between">
            <span className="text-text-secondary">Shipping</span>
            <span>{placedOrder.shippingAmount > 0 ? formatMoney(placedOrder.shippingAmount) : 'Free'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">Total</span>
            <span className="font-bold">{formatMoney(placedOrder.totalAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">Payment method</span>
            <span className="font-medium">{placedOrder.paymentMethod === 'BKASH' ? 'bKash Send Money' : 'Cash on Delivery'}</span>
          </div>
        </div>

        {placedOrder.paymentMethod === 'BKASH' && (
          <PaymentProofUpload
            orderNumber={placedOrder.orderNumber}
            {...(isLoggedIn ? {} : { phoneNumber: address.phoneNumber })}
          />
        )}

        <Button onClick={() => router.push('/')} className="w-full">
          Continue Shopping
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-xl lg:grid-cols-3">
      <div className="lg:col-span-2">
        <p className="mb-lg text-xs font-semibold uppercase tracking-wide text-text-secondary">Step {step} of 3</p>

        {step === 1 && (
          <div>
            <h2 className="mb-lg text-lg font-bold text-text-primary">Delivery Address</h2>
            {isLoggedIn ? (
              <p className="mb-lg text-sm text-text-secondary">
                We&apos;ll deliver to the address saved on your account. You can update it from your profile if needed.
              </p>
            ) : (
              <AddressFields value={address} onChange={setAddress} errors={addressErrors} />
            )}
            <Button onClick={goToPayment} className="mt-md w-full">
              Next
            </Button>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="mb-lg text-lg font-bold text-text-primary">Select Payment Method</h2>
            <div className="space-y-md">
              <label className="flex min-h-[56px] cursor-pointer items-center gap-md rounded-lg border-2 border-border p-lg has-[:checked]:border-primary">
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === 'BKASH'}
                  onChange={() => setPaymentMethod('BKASH')}
                  className="h-5 w-5"
                />
                <div>
                  <p className="font-semibold text-text-primary">bKash Send Money</p>
                  <p className="text-sm text-text-secondary">Send money to our bKash account</p>
                </div>
              </label>
              <label className="flex min-h-[56px] cursor-pointer items-center gap-md rounded-lg border-2 border-border p-lg has-[:checked]:border-primary">
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === 'COD'}
                  onChange={() => setPaymentMethod('COD')}
                  className="h-5 w-5"
                />
                <div>
                  <p className="font-semibold text-text-primary">Cash on Delivery</p>
                  <p className="text-sm text-text-secondary">Pay when you receive your order</p>
                </div>
              </label>
            </div>

            <div className="mt-lg">
              <CouponField lines={couponLines} onApplied={setAppliedCoupon} />
            </div>

            <div className="mt-md flex gap-sm">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="h-11 w-full rounded-lg border-2 border-border text-sm font-bold text-text-primary md:w-auto"
              >
                Back
              </button>
              <Button onClick={continueToReview} className="w-full">
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="mb-lg text-lg font-bold text-text-primary">
              {paymentMethod === 'BKASH' ? 'Complete Payment' : 'Confirm Order'}
            </h2>

            {paymentMethod === 'BKASH' ? (
              <div>
                <div className="mb-lg rounded-lg bg-surface p-lg text-sm text-text-primary">
                  <p className="mb-sm font-semibold">How to pay:</p>
                  <ol className="list-inside list-decimal space-y-xs">
                    <li>Open your bKash app</li>
                    <li>Select &quot;Send Money&quot;</li>
                    <li>Enter the merchant number below</li>
                    <li>
                      Enter amount:{' '}
                      <strong>
                        {pricingPhase === 'ready' && pricing
                          ? formatMoney(pricing.totalAmount)
                          : 'the order total shown after you place your order'}
                      </strong>
                    </li>
                    <li>Complete the transaction</li>
                    <li>Enter the Transaction ID after placing your order</li>
                  </ol>
                </div>
                <div className="mb-lg rounded-lg bg-primary px-lg py-md text-center font-mono text-lg font-bold text-white">
                  {BKASH_MERCHANT_NUMBER}
                </div>
                <div className="mb-lg">
                  <label htmlFor="bkashTransactionId" className="mb-sm block text-xs font-semibold text-text-primary">
                    Transaction ID (optional — you can also submit it after placing the order)
                  </label>
                  <input
                    id="bkashTransactionId"
                    type="text"
                    value={bkashTransactionId}
                    onChange={(e) => setBkashTransactionId(e.target.value)}
                    className="h-11 w-full rounded-lg border border-border bg-background px-md font-mono text-sm text-text-primary focus:border-2 focus:border-primary focus:outline-none"
                    placeholder="e.g. 8N7A6B5C4D"
                  />
                </div>
              </div>
            ) : (
              <div className="mb-lg rounded-lg border border-accent/30 bg-accent/10 p-lg text-sm text-text-primary">
                Your order has been received. Our customer-care representative will call you shortly to confirm your
                order.
              </div>
            )}

            <div className="mb-lg space-y-sm rounded-lg bg-surface p-lg text-sm">
              {lines.map((l) => (
                <div key={`${l.productId}:${l.variantId ?? ''}`} className="flex justify-between">
                  <span className="text-text-secondary">
                    {l.displaySnapshot.productName} × {l.quantity}
                  </span>
                  <span className="font-medium">৳{lineTotalOf(l.variantId).toLocaleString('en-BD')}</span>
                </div>
              ))}
            </div>

            <label className="mb-lg flex cursor-pointer items-start gap-sm text-sm text-text-primary">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-1 h-5 w-5"
              />
              <span>I agree to the terms &amp; conditions</span>
            </label>

            {submitError && (
              <p role="alert" className="mb-lg text-sm text-error">
                {submitError}
              </p>
            )}

            <div className="flex gap-sm">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="h-11 w-full rounded-lg border-2 border-border text-sm font-bold text-text-primary md:w-auto"
              >
                Back
              </button>
              <Button
                onClick={() => void handlePlaceOrder()}
                disabled={!agreedToTerms}
                loading={isSubmitting}
                className="w-full"
              >
                Place Order
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="h-fit rounded-lg bg-surface p-lg lg:sticky lg:top-24">
        <h2 className="mb-md text-lg font-bold text-text-primary">Order Summary</h2>
        <div className="mb-md max-h-64 space-y-sm overflow-y-auto border-b border-border pb-md">
          {lines.map((l) => (
            <div key={`${l.productId}:${l.variantId ?? ''}`} className="flex justify-between text-sm">
              <span className="text-text-secondary">
                {l.displaySnapshot.productName} × {l.quantity}
              </span>
              <span className="font-medium">৳{lineTotalOf(l.variantId).toLocaleString('en-BD')}</span>
            </div>
          ))}
        </div>
        <dl className="mb-md space-y-sm border-b border-border pb-md" aria-live="polite">
          <div className="flex justify-between text-sm">
            <dt className="text-text-secondary">Subtotal</dt>
            <dd className="font-medium">{formatMoney(shownSubtotal)}</dd>
          </div>
          {(appliedCoupon || shownDiscount > 0) && (
            <div className="flex justify-between text-sm">
              <dt className="text-text-secondary">Discount</dt>
              <dd className="font-medium text-accent">-{formatMoney(shownDiscount)}</dd>
            </div>
          )}
          <ShippingSummaryLine phase={pricingPhase} pricing={pricing} onRetry={retryPricing} />
        </dl>
        <FreeShippingHint remaining={pricingPhase === 'ready' ? (pricing?.shipping.freeShippingRemaining ?? null) : null} />
        {pricingPhase === 'ready' && pricing?.couponMessage && appliedCoupon && (
          <p role="status" className="mt-sm text-xs text-error">
            {pricing.couponMessage}
          </p>
        )}
        <div className="mt-md flex justify-between gap-md">
          <span className="font-semibold">Total</span>
          <span className={pricingPhase === 'ready' ? 'text-xl font-bold' : 'text-right text-sm text-text-secondary'}>
            {totalText}
          </span>
        </div>
      </div>
    </div>
  );
}
