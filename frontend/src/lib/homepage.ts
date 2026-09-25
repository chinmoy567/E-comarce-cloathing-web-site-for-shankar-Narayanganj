import type { HomepageResponse } from './publicTypes';

/**
 * Server-side fetch for the public homepage (13-homepage-cms §13.15, plan
 * §6). One request, ISR-cached to match the API's own `max-age=60` — the
 * page never issues N sequential per-section requests.
 */
const EMPTY_HOMEPAGE: HomepageResponse = { sections: [], metadata: null };

/**
 * Falls back to an empty homepage (no sections) rather than throwing when the
 * API is unreachable — this keeps `next build`'s prerender step from failing
 * when the backend isn't running at build time, and keeps the live site
 * degrading gracefully rather than 500ing if the API has a transient outage.
 * ISR's own 60s revalidation retries on the next request either way.
 */
export async function fetchHomepage(): Promise<HomepageResponse> {
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

  try {
    const res = await fetch(`${base}/api/homepage`, { next: { revalidate: 60 } });
    if (!res.ok) return EMPTY_HOMEPAGE;

    const payload = (await res.json()) as { data: HomepageResponse };
    return payload.data;
  } catch {
    return EMPTY_HOMEPAGE;
  }
}
