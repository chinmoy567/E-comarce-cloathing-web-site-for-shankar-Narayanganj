'use client';

import { useAdminSession } from '@/lib/admin/session';

/** Minimal landing page for `/admin` — a real dashboard is a later spec's scope. */
export default function AdminDashboardPage() {
  const { state } = useAdminSession();

  return (
    <div>
      <h1 className="mb-lg text-xl font-bold md:text-[28px]">Dashboard</h1>
      {state.phase === 'authenticated' && (
        <p className="text-text-secondary">
          Signed in as <span className="font-medium text-text-primary">{state.me.userIdentifier}</span> (
          {state.me.role === 'ADMIN' ? 'Admin' : 'Manager'}).
        </p>
      )}
    </div>
  );
}
