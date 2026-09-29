import type { Metadata } from 'next';
import { pageTitle } from '@/lib/site';
import { requireCustomerSession } from '@/lib/requireCustomerSession';
import { AccountShell } from '@/components/account/AccountShell';
import { ChangePasswordForm } from '@/components/account/ChangePasswordForm';

export const metadata: Metadata = {
  title: pageTitle('Change Password'),
  robots: 'noindex, nofollow',
};

/** Change password while signed in (02-customer §2.6). */
export default async function AccountChangePasswordPage() {
  await requireCustomerSession();
  return (
    <AccountShell title="Change Password">
      <ChangePasswordForm />
    </AccountShell>
  );
}
