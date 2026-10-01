import type { Metadata } from 'next';
import { pageTitle } from '@/lib/site';
import { GuestOrderLookupForm } from '@/components/orders/GuestOrderLookupForm';

export const metadata: Metadata = {
  title: pageTitle('Find Your Order'),
  description: 'Look up your order using your Order Number and phone number',
  robots: 'noindex, nofollow',
};

/** Guest order lookup page (02-customer §2.9.5-2.9.7). */
export default function GuestOrderLookupPage() {
  return (
    <div>
      <h1 className="mb-sm text-center text-2xl font-bold text-text-primary">Find Your Order</h1>
      <p className="mb-xl text-center text-sm text-text-secondary">
        Enter the Order Number and phone number used at checkout.
      </p>
      <GuestOrderLookupForm />
    </div>
  );
}
