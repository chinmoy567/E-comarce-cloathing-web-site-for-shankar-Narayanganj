import type { Metadata } from 'next';
import { pageTitle } from '@/lib/site';
import { requireCustomerSession } from '@/lib/requireCustomerSession';
import { AccountShell } from '@/components/account/AccountShell';
import { OrderHistoryList } from '@/components/account/OrderHistoryList';

export const metadata: Metadata = {
  title: pageTitle('My Orders'),
  robots: 'noindex, nofollow',
};

/** Registered-customer order history (02-customer §2.6). */
export default async function AccountOrdersPage() {
  await requireCustomerSession();
  return (
    <AccountShell title="My Orders" subtitle="Your order history and current status">
      <OrderHistoryList />
    </AccountShell>
  );
}
