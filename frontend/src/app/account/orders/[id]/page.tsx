import type { Metadata } from 'next';
import { pageTitle } from '@/lib/site';
import { requireCustomerSession } from '@/lib/requireCustomerSession';
import { AccountShell } from '@/components/account/AccountShell';
import { OrderDetailView } from '@/components/account/OrderDetailView';

export const metadata: Metadata = {
  title: pageTitle('Order Details'),
  robots: 'noindex, nofollow',
};

/** One order of the signed-in customer (02-customer §2.9.6 field set). */
export default async function AccountOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCustomerSession();
  const { id } = await params;
  return (
    <AccountShell title="Order Details" backHref="/account/orders" backLabel="My Orders">
      <OrderDetailView orderId={id} />
    </AccountShell>
  );
}
