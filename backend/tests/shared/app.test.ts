import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { applyTestEnv, VALID_ENV } from '../helpers/testEnv.ts';

applyTestEnv();

// The repository layer is the only Supabase consumer; stub it so these tests
// exercise the middleware stack without a live database.
vi.mock('../../src/repositories/health.repository.js', () => ({
  checkDatabaseReachable: vi.fn(async () => true),
}));

let app: Express;
let createApp: () => Express;
let validate: typeof import('../../src/middleware/validate.js').validate;
let errorHandler: typeof import('../../src/middleware/errorHandler.js').errorHandler;
let requestId: typeof import('../../src/middleware/requestId.js').requestId;

beforeAll(async () => {
  ({ createApp } = await import('../../src/app.js'));
  ({ validate } = await import('../../src/middleware/validate.js'));
  ({ errorHandler } = await import('../../src/middleware/errorHandler.js'));
  ({ requestId } = await import('../../src/middleware/requestId.js'));
  app = createApp();
});

describe('GET /api/health (spec 01 acceptance 2)', () => {
  it('returns 200 and the documented shape', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.database).toBe('ok');
    expect(typeof res.body.data.uptimeSeconds).toBe('number');
  });

  it('never leaks version strings or connection details', async () => {
    const res = await request(app).get('/api/health');
    const body = JSON.stringify(res.body);

    expect(body).not.toContain(VALID_ENV.SUPABASE_URL);
    expect(body).not.toContain(VALID_ENV.SUPABASE_SERVICE_ROLE_KEY);
  });
});

describe('security headers (spec 01 acceptance 11)', () => {
  it('sets nosniff and a Content-Security-Policy', async () => {
    const res = await request(app).get('/api/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('echoes an X-Request-Id header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
  });
});

describe('CORS allowlist (spec 01 acceptance 4, §11.5)', () => {
  it('permits an allowlisted origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:3000');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects a non-allowlisted origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never returns a wildcard origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});

describe('body size limit (spec 01 acceptance 5, §11.4)', () => {
  it('rejects a body larger than 100kb with 413', async () => {
    const oversized = { blob: 'x'.repeat(150 * 1024) };
    const res = await request(app).post('/api/health').send(oversized);

    expect(res.status).toBe(413);
  });
});

describe('404 handling', () => {
  it('returns the standard error envelope for an unknown route', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
});

describe('validation middleware (spec 01 acceptance 6, §11.6)', () => {
  function buildProbe(): Express {
    const probe = express();
    probe.use(requestId);
    probe.use(express.json());
    probe.post('/probe', validate({ body: z.object({ a: z.string() }).strict() }), (_req, res) => {
      res.status(200).json({ data: 'ok' });
    });
    probe.use(errorHandler);
    return probe;
  }

  it('rejects an unknown field, naming it', async () => {
    const res = await request(buildProbe()).post('/probe').send({ a: 'x', b: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.some((d: { field: string }) => d.field === 'b')).toBe(true);
  });

  it('accepts a valid body', async () => {
    const res = await request(buildProbe()).post('/probe').send({ a: 'x' });
    expect(res.status).toBe(200);
  });
});

describe('error handler hygiene (spec 01 acceptance 7)', () => {
  it('returns the generic message and never the original error text', async () => {
    const probe = express();
    probe.use(requestId);
    probe.get('/boom', (_req, _res, next) => next(new Error('boom')));
    probe.use(errorHandler);

    const res = await request(probe).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(res.body)).not.toContain('boom');
  });

  it('includes a requestId matching the X-Request-Id header (acceptance 8)', async () => {
    const probe = express();
    probe.use(requestId);
    probe.get('/boom', (_req, _res, next) => next(new Error('boom')));
    probe.use(errorHandler);

    const res = await request(probe).get('/boom');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
});
