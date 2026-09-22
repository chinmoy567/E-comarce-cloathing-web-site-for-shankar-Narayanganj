import type { Express } from 'express';
import request from 'supertest';

/**
 * Logs an admin/manager account into a real `createApp()` instance through the
 * real HTTP login route (never signs a token by hand except where a suite is
 * deliberately testing scope separation), and returns a `supertest` agent that
 * persists the resulting `admin_at`/`admin_rt`/`admin_csrf` cookies plus the
 * matching `X-CSRF-Token` header for state-changing calls (spec 03 §Session
 * design; test skill R9's session-handling note).
 */
export type AdminSession = {
  agent: request.Agent;
  csrfToken: string;
  /** Convenience wrapper: adds `X-CSRF-Token` to the state-changing verbs. */
  post: (url: string) => request.Test;
  put: (url: string) => request.Test;
  patch: (url: string) => request.Test;
  del: (url: string) => request.Test;
};

function extractCsrfCookie(setCookieHeader: string[] | undefined): string {
  const raw = (setCookieHeader ?? []).find((c) => c.startsWith('admin_csrf='));
  if (!raw) throw new Error('Login response did not set admin_csrf cookie.');
  const value = raw.split(';')[0]!.split('=')[1]!;
  return decodeURIComponent(value);
}

export async function loginAsAdmin(
  app: Express,
  userIdentifier: string,
  password: string,
): Promise<AdminSession> {
  const agent = request.agent(app);
  const res = await agent.post('/api/admin/auth/login').send({ userIdentifier, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${userIdentifier}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const csrfToken = extractCsrfCookie(res.headers['set-cookie'] as unknown as string[]);

  return {
    agent,
    csrfToken,
    post: (url) => agent.post(url).set('X-CSRF-Token', csrfToken),
    put: (url) => agent.put(url).set('X-CSRF-Token', csrfToken),
    patch: (url) => agent.patch(url).set('X-CSRF-Token', csrfToken),
    del: (url) => agent.delete(url).set('X-CSRF-Token', csrfToken),
  };
}
