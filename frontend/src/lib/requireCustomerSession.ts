import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CUSTOMER_ACCESS_COOKIE } from '@/lib/constants';

/**
 * Server-side gate for account pages — same check as `account/page.tsx`: no
 * customer session cookie means redirect to login. This is only a UX gate;
 * every API call behind these pages is authorized again by the backend.
 */
export async function requireCustomerSession(): Promise<void> {
  const cookieStore = await cookies();
  if (!cookieStore.has(CUSTOMER_ACCESS_COOKIE)) {
    redirect('/auth/login');
  }
}
