import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { UpstreamError } from './errors.js';

/**
 * SSRF-guarded outbound fetch (spec 04, `security` skill §6; used by specs
 * 14, 16, 18 — every call to an external provider). No handler fetches a
 * caller-supplied URL directly.
 *
 * Guards, in order: `https:` only; host on the caller's allowlist; resolved
 * address not private/loopback/link-local; fixed connect/total timeout;
 * bounded response size; a redirect is only followed if its target is ALSO
 * https and on the allowlist — an off-allowlist redirect target is rejected
 * rather than followed.
 *
 * Provider credentials (headers, query params) are attached by the caller and
 * are never logged by this wrapper.
 */

export type SafeFetchOptions = {
  /** Allowed hostnames, built from the calling provider's own base-URL env var — never a wildcard. */
  allowedHosts: string[];
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Total time budget for the whole request, including redirects. Default 10s. */
  timeoutMs?: number;
  /** Response body size cap, in bytes. Default 5 MB. */
  maxResponseBytes?: number;
  /** Maximum redirects to follow. Default 3. */
  maxRedirects?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

export async function safeFetch(url: string, opts: SafeFetchOptions): Promise<Response> {
  let currentUrl = url;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertUrlIsSafe(currentUrl, opts.allowedHosts);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: opts.method ?? 'GET',
        headers: opts.headers,
        body: opts.body,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (err) {
      throw new UpstreamError('The external service could not be reached.', undefined, 'UPSTREAM_UNREACHABLE');
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new UpstreamError('The external service returned an invalid redirect.', undefined, 'UPSTREAM_ERROR');
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return await boundResponseSize(response, opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
  }

  throw new UpstreamError('Too many redirects.', undefined, 'UPSTREAM_ERROR');
}

async function assertUrlIsSafe(rawUrl: string, allowedHosts: string[]): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UpstreamError('Invalid outbound URL.', undefined, 'UPSTREAM_ERROR');
  }

  if (parsed.protocol !== 'https:') {
    throw new UpstreamError('Outbound requests must use https.', undefined, 'UPSTREAM_ERROR');
  }

  if (!allowedHosts.includes(parsed.hostname)) {
    throw new UpstreamError('Outbound host is not allowlisted.', undefined, 'UPSTREAM_ERROR');
  }

  const address = isIP(parsed.hostname) ? parsed.hostname : (await lookup(parsed.hostname)).address;
  if (isPrivateOrLoopbackOrLinkLocal(address)) {
    throw new UpstreamError('Outbound target resolves to a disallowed address.', undefined, 'UPSTREAM_ERROR');
  }
}

/** Rejects RFC1918/loopback/link-local IPv4 and the IPv6 equivalents. */
function isPrivateOrLoopbackOrLinkLocal(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number);
    const a = octets[0] ?? 0;
    const b = octets[1] ?? 0;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local
    if (a === 0) return true; // "this network"
    return false;
  }

  const lower = address.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower.startsWith('fe80:')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 — re-check the embedded IPv4 address.
    return isPrivateOrLoopbackOrLinkLocal(lower.replace('::ffff:', ''));
  }
  return false;
}

async function boundResponseSize(response: Response, maxBytes: number): Promise<Response> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new UpstreamError('The external service response was too large.', undefined, 'UPSTREAM_ERROR');
  }

  if (!response.body) return response;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new UpstreamError('The external service response was too large.', undefined, 'UPSTREAM_ERROR');
    }
    chunks.push(value);
  }

  return new Response(new Blob(chunks), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
