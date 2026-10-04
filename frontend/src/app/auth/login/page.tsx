import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from '@/components/auth/LoginForm';
import { pageTitle, absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: pageTitle('Login'),
  description: 'Log in to your Fabrillke account',
  alternates: {
    canonical: absoluteUrl('/auth/login'),
  },
};

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-[28px] font-bold leading-tight text-text-primary">Welcome Back</h1>
          <p className="mt-2 text-text-secondary">Sign in to your Fabrillke account</p>
        </div>

        <LoginForm />

        <div className="flex items-center gap-2 justify-center text-sm">
          <span className="text-text-secondary">Don&apos;t have an account?</span>
          <Link href="/auth/register" className="inline-flex min-h-11 items-center font-medium text-primary hover:text-primary-hover">
            Sign up
          </Link>
        </div>

        <div className="text-center text-sm">
          <Link href="/auth/forgot-password" className="inline-flex min-h-11 items-center text-text-secondary hover:text-text-primary">
            Forgot password?
          </Link>
        </div>
      </div>
    </div>
  );
}
