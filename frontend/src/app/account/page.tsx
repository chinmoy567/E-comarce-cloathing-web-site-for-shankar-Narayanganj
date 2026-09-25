import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { pageTitle, absoluteUrl } from '@/lib/site';
import { CUSTOMER_ACCESS_COOKIE } from '@/lib/constants';
import { SignOutButton } from '@/components/account/SignOutButton';

export const metadata: Metadata = {
  title: pageTitle('My Account'),
  description: 'Manage your Fabrillke account',
  robots: 'noindex, nofollow',
};

/**
 * Customer account dashboard (02-customer §2.6).
 * Requires authentication; redirects to login if not logged in.
 */
export default async function AccountPage() {
  // Check for customer session
  const cookieStore = await cookies();
  const hasSession = cookieStore.has(CUSTOMER_ACCESS_COOKIE);

  if (!hasSession) {
    redirect('/auth/login');
  }

  // TODO: Fetch customer profile from /api/customer/auth/me

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-white rounded-lg shadow">
          <div className="border-b border-gray-200 p-6">
            <h1 className="text-2xl font-bold text-gray-900">My Account</h1>
            <p className="text-gray-600 mt-1">Manage your profile, addresses, and order history</p>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Profile */}
            <Link
              href="/account/profile"
              className="flex items-start gap-4 p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-md transition"
            >
              <div className="text-2xl">👤</div>
              <div>
                <h3 className="font-semibold text-gray-900">Profile</h3>
                <p className="text-sm text-gray-600">View and edit your personal information</p>
              </div>
            </Link>

            {/* Addresses */}
            <Link
              href="/account/addresses"
              className="flex items-start gap-4 p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-md transition"
            >
              <div className="text-2xl">📍</div>
              <div>
                <h3 className="font-semibold text-gray-900">Addresses</h3>
                <p className="text-sm text-gray-600">Manage your delivery addresses</p>
              </div>
            </Link>

            {/* Orders */}
            <Link
              href="/account/orders"
              className="flex items-start gap-4 p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-md transition"
            >
              <div className="text-2xl">📦</div>
              <div>
                <h3 className="font-semibold text-gray-900">Orders</h3>
                <p className="text-sm text-gray-600">View your order history and status</p>
              </div>
            </Link>

            {/* Change Password */}
            <Link
              href="/account/change-password"
              className="flex items-start gap-4 p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-md transition"
            >
              <div className="text-2xl">🔐</div>
              <div>
                <h3 className="font-semibold text-gray-900">Password</h3>
                <p className="text-sm text-gray-600">Change your account password</p>
              </div>
            </Link>
          </div>

          <div className="border-t border-gray-200 p-6">
            <SignOutButton />
          </div>
        </div>
      </div>
    </div>
  );
}
