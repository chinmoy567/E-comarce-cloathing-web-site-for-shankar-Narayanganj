import type { Metadata } from 'next';
import Link from 'next/link';
import { pageTitle } from '@/lib/site';
import { requireCustomerSession } from '@/lib/requireCustomerSession';
import { AccountShell } from '@/components/account/AccountShell';
import { SignOutButton } from '@/components/account/SignOutButton';

export const metadata: Metadata = {
  title: pageTitle('My Account'),
  description: 'Manage your Fabrillke account',
  robots: 'noindex, nofollow',
};

const SECTIONS = [
  { href: '/account/orders', title: 'My Orders', description: 'View your order history and status' },
  { href: '/account/profile', title: 'Profile', description: 'View and edit your personal information' },
  { href: '/account/addresses', title: 'Addresses', description: 'Manage your delivery address' },
  { href: '/account/change-password', title: 'Password', description: 'Change your account password' },
] as const;

/** Customer account dashboard (02-customer §2.6). Redirects to login without a session. */
export default async function AccountPage() {
  await requireCustomerSession();

  return (
    <AccountShell title="My Account" subtitle="Manage your profile, address, and orders" backHref="/" backLabel="Home">
      <ul className="grid gap-md sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className="block h-full rounded-lg border border-border bg-surface p-lg hover:border-primary"
            >
              <span className="block font-semibold text-text-primary">{section.title}</span>
              <span className="mt-xs block text-sm text-text-secondary">{section.description}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-xl border-t border-border pt-lg">
        <SignOutButton />
      </div>
    </AccountShell>
  );
}
