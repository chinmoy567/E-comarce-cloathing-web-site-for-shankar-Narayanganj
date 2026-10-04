import type { Metadata } from 'next';
import Link from 'next/link';
import { pageTitle } from '@/lib/site';
import { VerifyEmail } from '@/components/account/VerifyEmail';

export const metadata: Metadata = {
  title: pageTitle('Confirm Email'),
  robots: 'noindex, nofollow',
};

/** Landing page for the email-change confirmation link (spec 08 §Email change). The token is the credential. */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="mx-auto max-w-md py-2xl text-center">
      <h1 className="mb-lg text-2xl font-bold text-text-primary">Confirm your email</h1>
      {token ? (
        <VerifyEmail token={token} />
      ) : (
        <p role="alert" className="text-sm text-error">
          This link is incomplete. Open the link from the email exactly as it was sent.
        </p>
      )}
      <Link href="/account/profile" className="mt-xl inline-block text-sm font-semibold text-primary hover:underline">
        Go to my profile
      </Link>
    </div>
  );
}
