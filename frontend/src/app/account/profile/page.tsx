import type { Metadata } from 'next';
import { pageTitle } from '@/lib/site';
import { requireCustomerSession } from '@/lib/requireCustomerSession';
import { AccountShell } from '@/components/account/AccountShell';
import { ProfileForm } from '@/components/account/ProfileForm';

export const metadata: Metadata = {
  title: pageTitle('My Profile'),
  robots: 'noindex, nofollow',
};

/** View and edit the customer profile (02-customer §2.6). */
export default async function AccountProfilePage() {
  await requireCustomerSession();
  return (
    <AccountShell title="My Profile" subtitle="Your personal information">
      <ProfileForm />
    </AccountShell>
  );
}
