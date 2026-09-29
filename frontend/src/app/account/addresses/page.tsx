import type { Metadata } from 'next';
import { pageTitle } from '@/lib/site';
import { requireCustomerSession } from '@/lib/requireCustomerSession';
import { AccountShell } from '@/components/account/AccountShell';
import { AddressForm } from '@/components/account/AddressForm';

export const metadata: Metadata = {
  title: pageTitle('My Address'),
  robots: 'noindex, nofollow',
};

/** Delivery address used at checkout (02-customer §2.2/§2.6). */
export default async function AccountAddressesPage() {
  await requireCustomerSession();
  return (
    <AccountShell title="Delivery Address" subtitle="Where we deliver your orders">
      <AddressForm />
    </AccountShell>
  );
}
