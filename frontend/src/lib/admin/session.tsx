'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiGet, apiPost, ApiClientError } from '@/lib/apiClient';
import type { MeResponse } from './types';

/**
 * Back-office session context (spec 03 §Frontend work).
 *
 * Fetches `GET /api/admin/auth/me` once on mount — the backend is the
 * authority on who the actor is and what they may do; this context only
 * caches that response for the render tree. Every permission check here is
 * UX convenience, never enforcement (`frontend` skill §3) — the matching
 * backend check is what actually protects each action.
 */

type SessionState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'unauthenticated' }
  | { phase: 'authenticated'; me: MeResponse };

type SessionContextValue = {
  state: SessionState;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (key: string) => boolean;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ phase: 'loading' });

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const me = await apiGet<MeResponse>('/api/admin/auth/me');
      setState({ phase: 'authenticated', me });
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        setState({ phase: 'unauthenticated' });
        return;
      }
      setState({
        phase: 'error',
        message: err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const logout = useCallback(async () => {
    try {
      await apiPost('/api/admin/auth/logout');
    } finally {
      setState({ phase: 'unauthenticated' });
    }
  }, []);

  const hasPermission = useCallback(
    (key: string) => state.phase === 'authenticated' && state.me.permissions.includes(key),
    [state],
  );

  return (
    <SessionContext.Provider value={{ state, refresh: load, logout, hasPermission }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useAdminSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useAdminSession must be used within AdminSessionProvider');
  }
  return ctx;
}
