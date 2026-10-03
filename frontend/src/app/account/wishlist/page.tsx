import type { Metadata } from 'next';
import { pageTitle } from '@/lib/site';
import { requireCustomerSession } from '@/lib/requireCustomerSession';
import { AccountShell } from '@/components/account/AccountShell';
import { WishlistGrid } from '@/components/account/WishlistGrid';

export const metadata: Metadata = {
  title: pageTitle('My Wishlist'),
  robots: 'noindex, nofollow',
};

/** Registered-customer wishlist (spec 09). */
export default async function AccountWishlistPage() {
  await requireCustomerSession();
  return (
    <AccountShell title="My Wishlist" subtitle="Products you have saved for later">
      <WishlistGrid />
    </AccountShell>
  );
}
