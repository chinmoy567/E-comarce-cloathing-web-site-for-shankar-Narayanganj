import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { pageTitle } from '@/lib/site';

export const metadata: Metadata = {
  title: pageTitle('Forgot Password'),
  description: 'Reset your Fabrillke account password',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-[28px] font-bold leading-tight text-text-primary">Reset Password</h1>
          <p className="mt-2 text-text-secondary">We will email you a code to set a new password</p>
        </div>

        <ForgotPasswordForm />

        <div className="text-center text-sm">
          <Link href="/auth/login" className="inline-flex min-h-11 items-center font-medium text-primary hover:text-primary-hover">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
