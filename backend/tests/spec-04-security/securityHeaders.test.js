import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyTestEnv } from '../helpers/testEnv.ts';
import { resetEnvCache } from '../../src/config/env.ts';
/**
 * Spec 04 §11.5 — transport & header security (test required 12,
 * acceptance 10). `tests/app.test.ts` already covers nosniff, CSP presence,
 * X-Powered-By absence, X-Request-Id, and the CORS allowlist rejection —
 * this file adds only what's missing there: HSTS present in production and
 * absent otherwise, and an explicit Referrer-Policy assertion.
 */
vi.mock('../../src/repositories/health.repository.js', () => ({
    checkDatabaseReachable: vi.fn(async () => true),
}));
describe('security headers (spec 04 §11.5, test 12, acceptance 10)', () => {
    describe('development/test mode', () => {
        let app;
        beforeAll(async () => {
            applyTestEnv();
            process.env.NODE_ENV = 'test';
            resetEnvCache();
            const { createApp } = await import('../../src/app.js');
            app = createApp();
        });
        it('does not set Strict-Transport-Security outside production', async () => {
            const res = await request(app).get('/api/health');
            expect(res.headers['strict-transport-security']).toBeUndefined();
        });
        it('sets Referrer-Policy', async () => {
            const res = await request(app).get('/api/health');
            expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
        });
        it('sets X-Content-Type-Options: nosniff', async () => {
            const res = await request(app).get('/api/health');
            expect(res.headers['x-content-type-options']).toBe('nosniff');
        });
        it('sets a Content-Security-Policy with frame-ancestors none and object-src none', async () => {
            const res = await request(app).get('/api/health');
            const csp = res.headers['content-security-policy'];
            expect(csp).toBeDefined();
            expect(csp).toContain("frame-ancestors 'none'");
            expect(csp).toContain("object-src 'none'");
            expect(csp).toContain("default-src 'self'");
        });
    });
    describe('production mode', () => {
        let app;
        beforeAll(async () => {
            vi.resetModules();
            applyTestEnv();
            process.env.NODE_ENV = 'production';
            resetEnvCache();
            const { createApp } = await import('../../src/app.js');
            app = createApp();
        });
        it('sets Strict-Transport-Security with a one-year max-age and includeSubDomains (acceptance 10)', async () => {
            const res = await request(app).get('/api/health').set('X-Forwarded-Proto', 'https');
            expect(res.headers['strict-transport-security']).toBeDefined();
            expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
            expect(res.headers['strict-transport-security']).toContain('includeSubDomains');
        });
        it('redirects a plain-http request to https (X-Forwarded-Proto: http)', async () => {
            const res = await request(app).get('/api/health').set('X-Forwarded-Proto', 'http').redirects(0);
            expect(res.status).toBe(301);
            expect(res.headers.location).toMatch(/^https:\/\//);
        });
        it('still sets Referrer-Policy and nosniff in production', async () => {
            const res = await request(app).get('/api/health').set('X-Forwarded-Proto', 'https');
            expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
            expect(res.headers['x-content-type-options']).toBe('nosniff');
        });
    });
});
