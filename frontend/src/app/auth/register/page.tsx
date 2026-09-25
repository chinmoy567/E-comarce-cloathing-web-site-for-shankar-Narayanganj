import type { Metadata } from 'next';
import Link from 'next/link';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { pageTitle, absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: pageTitle('Sign Up'),
  description: 'Create a new Fabrillke account',
  alternates: {
    canonical: absoluteUrl('/auth/register'),
  },
};

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Create Account</h1>
          <p className="mt-2 text-gray-600">Join Fabrillke and start shopping</p>
        </div>

        <RegisterForm />

        <div className="flex items-center gap-2 justify-center text-sm">
          <span className="text-gray-600">Already have an account?</span>
          <Link href="/auth/login" className="text-blue-600 hover:text-blue-700 font-medium">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
