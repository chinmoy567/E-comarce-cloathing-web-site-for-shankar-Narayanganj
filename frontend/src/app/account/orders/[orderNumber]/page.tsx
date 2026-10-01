import type { Metadata } from 'next';
import { pageTitle } from '@/lib/site';
import { requireCustomerSession } from '@/lib/requireCustomerSession';
import { AccountShell } from '@/components/account/AccountShell';
import { OrderDetailView } from '@/components/account/OrderDetailView';

export const metadata: Metadata = {
  title: pageTitle('Order Details'),
  robots: 'noindex, nofollow',
};

/** One order of the signed-in customer, addressed by Order Number (never an internal id). */
export default async function AccountOrderDetailPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  await requireCustomerSession();
  const { orderNumber } = await params;
  return (
    <AccountShell title="Order Details" backHref="/account/orders" backLabel="My Orders">
      <OrderDetailView orderNumber={decodeURIComponent(orderNumber)} />
    </AccountShell>
  );
}
