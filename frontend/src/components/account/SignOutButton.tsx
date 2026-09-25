'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiPost } from '@/lib/apiClient';

/** Signs the customer out (02-customer §2.4 session) and returns to login. */
export function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleSignOut() {
    setIsPending(true);
    try {
      await apiPost('/customer/auth/logout');
    } finally {
      router.push('/auth/login');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      className="text-red-600 hover:text-red-700 font-medium text-sm disabled:opacity-50"
      onClick={handleSignOut}
      disabled={isPending}
    >
      Sign Out
    </button>
  );
}
