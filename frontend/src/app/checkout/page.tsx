import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { pageTitle, absoluteUrl } from '@/lib/site';
import { CUSTOMER_ACCESS_COOKIE } from '@/lib/constants';
import { CheckoutWizard } from '@/components/checkout/CheckoutWizard';

export const metadata: Metadata = {
  title: pageTitle('Checkout'),
  description: 'Complete your purchase',
  alternates: {
    canonical: absoluteUrl('/checkout'),
  },
  robots: 'noindex, nofollow',
};

/**
 * Checkout flow (spec 11 — 02-customer §2.3/§2.9, 03-payment-order §3).
 * Supports both guest and registered customer checkout on the same page —
 * checkout never gates on account creation (§2.3 diagram note).
 */
export default async function CheckoutPage() {
  const cookieStore = await cookies();
  const isLoggedIn = cookieStore.has(CUSTOMER_ACCESS_COOKIE);

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-text-primary mb-xl">Checkout</h1>
      <CheckoutWizard isLoggedIn={isLoggedIn} />
    </div>
  );
}
