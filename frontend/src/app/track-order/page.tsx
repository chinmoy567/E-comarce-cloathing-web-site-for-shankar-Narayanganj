import type { Metadata } from 'next';
import { pageTitle } from '@/lib/site';
import { TrackOrderForm } from '@/components/orders/TrackOrderForm';

export const metadata: Metadata = {
  title: pageTitle('Track Order'),
  description: 'Track your parcel with the Order ID or Tracking ID from the courier.',
  robots: 'noindex, nofollow',
};

/** Public Track Order page (04-courier §4.14): courier Order ID / Tracking ID, no login. */
export default function TrackOrderPage() {
  return (
    <div>
      <h1 className="mb-sm text-center text-2xl font-bold text-text-primary">Track Order</h1>
      <p className="mb-xl text-center text-sm text-text-secondary">
        See where your parcel is. No account or login needed.
      </p>
      <TrackOrderForm />
    </div>
  );
}
