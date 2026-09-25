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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Welcome Back</h1>
          <p className="mt-2 text-gray-600">Sign in to your Fabrillke account</p>
        </div>

        <LoginForm />

        <div className="flex items-center gap-2 justify-center text-sm">
          <span className="text-gray-600">Don't have an account?</span>
          <Link href="/auth/register" className="text-blue-600 hover:text-blue-700 font-medium">
            Sign up
          </Link>
        </div>

        <div className="text-center text-sm">
          <Link href="/auth/forgot-password" className="text-gray-600 hover:text-gray-700">
            Forgot password?
          </Link>
        </div>
      </div>
    </div>
  );
}
