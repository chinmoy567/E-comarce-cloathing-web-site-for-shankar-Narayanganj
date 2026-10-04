import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CUSTOMER_ACCESS_COOKIE, CUSTOMER_REFRESH_COOKIE } from '@/lib/constants';

/**
 * Server-side gate for account pages — same check as `account/page.tsx`: no
 * customer session cookie means redirect to login. This is only a UX gate;
 * every API call behind these pages is authorized again by the backend.
 */
export async function requireCustomerSession(): Promise<void> {
  const cookieStore = await cookies();
  // The access cookie lives 15 minutes; the refresh cookie lasts days. With only the refresh cookie the
  // page still renders, and its first API call renews the session (apiClient), or the page sends the
  // customer to log in if that refresh fails.
  if (!cookieStore.has(CUSTOMER_ACCESS_COOKIE) && !cookieStore.has(CUSTOMER_REFRESH_COOKIE)) {
    redirect('/auth/login');
  }
}
