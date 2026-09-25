import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { pageTitle, absoluteUrl } from '@/lib/site';
import { CUSTOMER_ACCESS_COOKIE } from '@/lib/constants';

export const metadata: Metadata = {
  title: pageTitle('Checkout'),
  description: 'Complete your purchase',
  alternates: {
    canonical: absoluteUrl('/checkout'),
  },
  robots: 'noindex, nofollow',
};

/**
 * Checkout flow (11-checkout §11).
 * Supports both guest and registered customer checkout.
 *
 * Guest path: name, phone, address fields
 * Registered path: load from profile, validate completeness
 *
 * TODO: Detect logged-in status
 * TODO: Show appropriate checkout form
 * TODO: Implement address entry/selection
 * TODO: Implement payment method selection
 * TODO: Implement order creation
 */
export default async function CheckoutPage() {
  const cookieStore = await cookies();
  const isLoggedIn = cookieStore.has(CUSTOMER_ACCESS_COOKIE);

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">Checkout</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Checkout form */}
          <div className="lg:col-span-2 space-y-8">
            {/* Step 1: Delivery Address */}
            <div className="border border-gray-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Delivery Address</h2>
              {isLoggedIn ? (
                <div className="text-gray-600">
                  {/* TODO: Load customer addresses, show selector */}
                  Registered customer address selection
                </div>
              ) : (
                <div className="text-gray-600">
                  {/* TODO: Show guest address form */}
                  Guest address form
                </div>
              )}
            </div>

            {/* Step 2: Payment Method */}
            <div className="border border-gray-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Payment Method</h2>
              <div className="space-y-4">
                <label className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg cursor-pointer hover:border-blue-500">
                  <input type="radio" name="payment" value="bkash" defaultChecked />
                  <div>
                    <div className="font-medium">bKash Send Money</div>
                    <div className="text-sm text-gray-600">Manual payment via bKash</div>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg cursor-pointer hover:border-blue-500">
                  <input type="radio" name="payment" value="cod" />
                  <div>
                    <div className="font-medium">Cash on Delivery</div>
                    <div className="text-sm text-gray-600">Pay when you receive your order</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Step 3: Coupon (optional) */}
            <div className="border border-gray-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Promo Code (Optional)</h2>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter coupon code"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button className="px-6 py-2 border border-gray-300 rounded-lg hover:border-gray-400 font-medium">
                  Apply
                </button>
              </div>
            </div>
          </div>

          {/* Order summary */}
          <div className="bg-gray-50 rounded-lg p-6 h-fit">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Summary</h2>

            <div className="space-y-3 mb-4 pb-4 border-b border-gray-200 max-h-64 overflow-y-auto">
              {/* TODO: Show cart items */}
              <div className="text-sm text-gray-600">Cart items will appear here</div>
            </div>

            <div className="space-y-3 mb-4 pb-4 border-b border-gray-200">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotal</span>
                <span className="font-medium">৳0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Discount</span>
                <span className="font-medium text-green-600">-৳0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Shipping</span>
                <span className="font-medium">৳0</span>
              </div>
            </div>

            <div className="flex justify-between mb-6">
              <span className="font-semibold">Total</span>
              <span className="text-xl font-bold">৳0</span>
            </div>

            <button className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition">
              Place Order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
