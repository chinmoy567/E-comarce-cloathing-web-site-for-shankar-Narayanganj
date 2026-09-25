import type { Metadata } from 'next';
import Link from 'next/link';
import { pageTitle, absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: pageTitle('Shopping Cart'),
  description: 'Review your shopping cart',
  alternates: {
    canonical: absoluteUrl('/cart'),
  },
};

/**
 * Shopping cart page (09-cart §9).
 * Displays cart items, quantities, totals, and checkout button.
 *
 * TODO: Fetch cart from localStorage or /api/customer/cart
 * TODO: Display items with quantity controls
 * TODO: Calculate totals
 * TODO: Implement remove/update quantity
 * TODO: Add empty cart message
 */
export default function CartPage() {
  // TODO: Load cart from state
  const cartItems: any[] = [];

  if (cartItems.length === 0) {
    return (
      <div className="min-h-screen bg-white">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <h1 className="text-2xl font-bold text-gray-900 mb-8">Shopping Cart</h1>

          <div className="text-center py-12">
            <p className="text-gray-600 mb-4">Your cart is empty</p>
            <Link href="/products" className="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700">
              Continue Shopping
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">Shopping Cart</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Cart items */}
          <div className="lg:col-span-2">
            {/* TODO: Cart items list */}
            <div className="text-gray-600">Cart items will appear here</div>
          </div>

          {/* Cart summary */}
          <div className="bg-gray-50 rounded-lg p-6 h-fit">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Summary</h2>

            <div className="space-y-3 mb-4 pb-4 border-b border-gray-200">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotal</span>
                <span className="font-medium">৳0</span>
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

            <button className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition mb-3">
              Proceed to Checkout
            </button>

            <Link href="/products" className="block text-center text-blue-600 hover:text-blue-700 font-medium">
              Continue Shopping
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
