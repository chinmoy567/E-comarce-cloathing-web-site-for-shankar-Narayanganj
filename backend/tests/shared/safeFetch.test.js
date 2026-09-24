import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
/**
 * Spec 04 — SSRF-guarded outbound fetch (test required 11, acceptance 13).
 *
 * A local loopback `https.Server`, using the self-signed fixture in
 * `tests/fixtures/tls/` (SOURCE.md), stands in for "an allowlisted host" and
 * for "a target that redirects off-allowlist" — no real network call is made
 * (CLAUDE.md §6).
 *
 * `assertUrlIsSafe` takes two different paths depending on the URL:
 *   - an IP literal is checked directly with no DNS lookup (`isIP()`
 *     short-circuits `lookup()`), so the private/loopback/link-local cases
 *     below use IP literals and need no server or mocking at all;
 *   - a hostname goes through `dns/promises.lookup()` for the guard's own
 *     private-address check, but the ACTUAL outbound connection is still
 *     made by the real `fetch()` against whatever the hostname really
 *     resolves to at the OS level — a fake hostname would fail to connect.
 *     So the "succeeds" and "redirect not followed" cases below use the
 *     hostname `localhost` (which Node's own resolver — not mocked —
 *     genuinely resolves to `127.0.0.1`, letting `fetch()` reach the real
 *     loopback test server with no live network call) while mocking only
 *     `dns/promises.lookup`, the guard's OWN resolution call, to return a
 *     NON-private address. This isolates "does the guard's private-address
 *     check gate the request" (mocked, asserted false-positive-free) from
 *     "can the request physically reach a server" (real, via `localhost`).
 *
 * The self-signed cert requires `NODE_TLS_REJECT_UNAUTHORIZED=0` for the
 * loopback-server tests only; it is set in `beforeAll` and restored in
 * `afterAll` so it never leaks into another suite.
 */
const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/tls', import.meta.url));
const dnsMock = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dnsMock.lookup }));
describe('safeFetch (spec 04, test 11, acceptance 13)', () => {
    let server;
    let port;
    let originalTlsReject;
    let safeFetch;
    beforeAll(async () => {
        originalTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        const cert = readFileSync(`${FIXTURES_DIR}/cert.pem`);
        const key = readFileSync(`${FIXTURES_DIR}/key.pem`);
        server = createServer({ cert, key }, (req, res) => {
            if (req.url === '/ok') {
                res.writeHead(200, { 'content-type': 'text/plain' });
                res.end('ok');
                return;
            }
            if (req.url === '/redirect-offlist') {
                res.writeHead(302, { location: `https://off-allowlist.invalid:${port}/ok` });
                res.end();
                return;
            }
            res.writeHead(404);
            res.end();
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = server.address().port;
        ({ safeFetch } = await import('../../src/lib/safeFetch.js'));
    });
    afterAll(async () => {
        await new Promise((resolve) => server.close(() => resolve()));
        if (originalTlsReject === undefined) {
            delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        }
        else {
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsReject;
        }
    });
    afterEach(() => {
        dnsMock.lookup.mockReset();
    });
    it('rejects a private/loopback address given as an IP literal (169.254.169.254, acceptance 13)', async () => {
        await expect(safeFetch('https://169.254.169.254/latest/meta-data/', { allowedHosts: ['169.254.169.254'] })).rejects.toMatchObject({ status: 502, code: 'UPSTREAM_ERROR' });
        expect(dnsMock.lookup).not.toHaveBeenCalled();
    });
    it('rejects a loopback IP literal (127.0.0.1) with no DNS lookup performed', async () => {
        await expect(safeFetch('https://127.0.0.1:9999/', { allowedHosts: ['127.0.0.1'] })).rejects.toMatchObject({
            status: 502,
            code: 'UPSTREAM_ERROR',
        });
        expect(dnsMock.lookup).not.toHaveBeenCalled();
    });
    it('rejects an RFC1918 private address literal (10.0.0.5)', async () => {
        await expect(safeFetch('https://10.0.0.5/', { allowedHosts: ['10.0.0.5'] })).rejects.toMatchObject({
            status: 502,
            code: 'UPSTREAM_ERROR',
        });
    });
    it('rejects a link-local address literal (169.254.1.1)', async () => {
        await expect(safeFetch('https://169.254.1.1/', { allowedHosts: ['169.254.1.1'] })).rejects.toMatchObject({
            status: 502,
            code: 'UPSTREAM_ERROR',
        });
    });
    it("rejects a host that is not on the caller's allowlist (no DNS lookup performed)", async () => {
        await expect(safeFetch('https://pathao.example.com/api', { allowedHosts: ['steadfast.example.com'] })).rejects.toMatchObject({ status: 502, code: 'UPSTREAM_ERROR' });
        expect(dnsMock.lookup).not.toHaveBeenCalled();
    });
    it('rejects a non-https URL', async () => {
        await expect(safeFetch('http://pathao.example.com/api', { allowedHosts: ['pathao.example.com'] })).rejects.toMatchObject({
            status: 502,
            code: 'UPSTREAM_ERROR',
        });
    });
    it('rejects a hostname that resolves (via DNS) to a private address, even though the hostname itself is allowlisted', async () => {
        dnsMock.lookup.mockResolvedValue({ address: '10.1.2.3', family: 4 });
        await expect(safeFetch('https://internal-provider.example.com/api', { allowedHosts: ['internal-provider.example.com'] })).rejects.toMatchObject({
            status: 502,
            code: 'UPSTREAM_ERROR',
        });
    });
    it('does not follow a redirect whose target host is not on the allowlist', async () => {
        dnsMock.lookup.mockResolvedValue({ address: '203.0.113.50', family: 4 });
        await expect(safeFetch(`https://localhost:${port}/redirect-offlist`, { allowedHosts: ['localhost'] })).rejects.toMatchObject({ status: 502, code: 'UPSTREAM_ERROR' });
    });
    it('succeeds against an allowlisted https host whose DNS resolution (per the guard) is non-private', async () => {
        dnsMock.lookup.mockResolvedValue({ address: '203.0.113.50', family: 4 });
        const res = await safeFetch(`https://localhost:${port}/ok`, { allowedHosts: ['localhost'] });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('ok');
    });
});
