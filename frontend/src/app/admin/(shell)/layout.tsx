'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAdminSession } from '@/lib/admin/session';
import { ADMIN_NAV_ITEMS } from '@/lib/admin/nav';
import { SITE_NAME } from '@/lib/site';

/**
 * The admin app shell (spec 03 §Frontend work): header with logout,
 * navigation rendered from the actor's `permissions` array, and the
 * §2.7 forced-password-change redirect applied to every route under it.
 */
export default function AdminShellLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { state, logout, hasPermission } = useAdminSession();

  useEffect(() => {
    if (state.phase === 'unauthenticated') {
      router.replace('/admin/login');
    } else if (state.phase === 'authenticated' && state.me.mustChangePassword) {
      router.replace('/admin/change-password');
    }
  }, [state, router]);

  if (state.phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-text-secondary">Loading…</p>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center px-lg">
        <div className="w-full max-w-sm rounded-lg border border-error/30 bg-error/5 p-lg text-center">
          <p className="font-medium text-error">Could not load your session</p>
          <p className="mt-xs text-sm text-text-secondary">{state.message}</p>
        </div>
      </div>
    );
  }

  // Unauthenticated or pending password-change: the effect above is
  // redirecting; render nothing rather than a flash of the shell.
  if (state.phase !== 'authenticated' || state.me.mustChangePassword) {
    return null;
  }

  const visibleItems = ADMIN_NAV_ITEMS.filter((item) => hasPermission(item.requires));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border px-lg">
        <span className="text-base font-bold">{SITE_NAME} Admin</span>
        <button
          type="button"
          onClick={() => void logout().then(() => router.replace('/admin/login'))}
          className="h-11 rounded-lg px-md text-sm font-semibold text-text-secondary hover:text-primary"
        >
          Logout
        </button>
      </header>

      {visibleItems.length > 0 && (
        <nav className="border-b border-border">
          <ul className="flex overflow-x-auto px-lg">
            {visibleItems.map((item) => {
              const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block px-md py-md text-sm font-semibold ${
                      active ? 'border-b-2 border-primary text-primary' : 'text-text-secondary'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      <main className="flex-1 px-lg py-2xl">{children}</main>
    </div>
  );
}
