import { SITE_DOMAIN } from '../config/constants.js';

/**
 * `cta_url` / `secondary_cta_url` validator (13-homepage-cms ยง13.13, used by
 * spec 17). Accepts only:
 *   - a relative storefront path (starts with `/`, never `//` โ€” that is a
 *     protocol-relative URL and effectively external), or
 *   - an `https:` URL on the store's own domain or an explicitly allowlisted
 *     external host.
 *
 * Never accepts `javascript:`, `data:`, `http:`, or an unlisted external host.
 */
export function isValidCtaUrl(value: string, extraAllowedHosts: string[] = []): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;

  if (value.startsWith('/')) {
    return !value.startsWith('//');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();
  if (host === SITE_DOMAIN || host.endsWith(`.${SITE_DOMAIN}`)) return true;

  return extraAllowedHosts.map((h) => h.toLowerCase()).includes(host);
}

/**
 * Homepage/campaign image URL validator (13-homepage-cms ง13.11, ง13.13).
 * Images come from Supabase Storage only, so accept just an `https:` URL on
 * the configured Supabase host. Rejects `javascript:`, `data:`, `http:` and
 * every other host (tracking pixels, hotlinked content).
 */
export function isValidImageUrl(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return false;
    const supabaseHost = new URL(process.env.SUPABASE_URL ?? '').hostname.toLowerCase();
    return supabaseHost.length > 0 && parsed.hostname.toLowerCase() === supabaseHost;
  } catch {
    return false;
  }
}
