import type { ReactNode } from 'react';
import { AdminSessionProvider } from '@/lib/admin/session';

/**
 * Root of the back-office tree (spec 03 §Frontend work). Provides the session
 * context to every admin route, including `/admin/login`, which needs it to
 * refresh the session on a successful sign-in. No visible chrome here — the
 * header/nav/redirect guards live in `(shell)/layout.tsx`, so `/admin/login`
 * and `/admin/change-password` render with none of it.
 */
export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return <AdminSessionProvider>{children}</AdminSessionProvider>;
}
