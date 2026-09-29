/**
 * Spec 08 — POST /api/analytics/event (08-analytics-meta §6.3, §6.6, §6.8;
 * 11-security-hardening §11.6). The CAPI client is stubbed, so no Meta call and
 * no database is involved.
 */

import type { Express } from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestEnv } from '../helpers/testEnv.ts';

applyTestEnv();

const sendMetaCapiEvent = vi.fn(async () => undefined);
vi.mock('../../src/services/analytics/metaCapi.js', () => ({ sendMetaCapiEvent }));
vi.mock('../../src/repositories/health.repository.js', () => ({
  checkDatabaseReachable: vi.fn(async () => true),
}));

let app: Express;

beforeAll(async () => {
  const { createApp } = await import('../../src/app.js');
  app = createApp();
});

beforeEach(() => {
  sendMetaCapiEvent.mockClear();
});

function body(overrides: Record<string, unknown> = {}) {
  return {
    eventName: 'PageView',
    eventId: randomUUID(),
    eventSourceUrl: 'https://fabrillke.com/',
    payload: {},
    ...overrides,
  };
}

describe('POST /api/analytics/event', () => {
  it('accepts a valid event and forwards it once with the same event_id', async () => {
    const payload = body({ eventName: 'AddToCart', payload: { contentIds: ['abc'] } });
    const res = await request(app).post('/api/analytics/event').send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, eventId: payload.eventId });
    expect(sendMetaCapiEvent).toHaveBeenCalledTimes(1);
    const [sent] = sendMetaCapiEvent.mock.calls[0] as unknown as [{ event_id: string; event_name: string }];
    expect(sent.event_id).toBe(payload.eventId);
    expect(sent.event_name).toBe('AddToCart');
  });

  it('accepts a Search event with a search string', async () => {
    const res = await request(app)
      .post('/api/analytics/event')
      .send(body({ eventName: 'Search', payload: { searchString: 'linen shirt' } }));
    expect(res.status).toBe(200);
  });

  it('rejects Purchase from the client — it is server-initiated only (§6.3)', async () => {
    const res = await request(app).post('/api/analytics/event').send(body({ eventName: 'Purchase' }));
    expect(res.status).toBe(400);
    expect(sendMetaCapiEvent).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied value (economics are never client-trusted)', async () => {
    const res = await request(app).post('/api/analytics/event').send(body({ payload: { value: 1 } }));
    expect(res.status).toBe(400);
    expect(sendMetaCapiEvent).not.toHaveBeenCalled();
  });

  it('rejects unknown top-level fields such as plaintext identifiers (§6.5)', async () => {
    const res = await request(app).post('/api/analytics/event').send(body({ email: 'a@b.com' }));
    expect(res.status).toBe(400);
  });

  it('rejects a missing or non-UUID eventId', async () => {
    expect((await request(app).post('/api/analytics/event').send(body({ eventId: 'x' }))).status).toBe(400);
    const { eventId: _omit, ...withoutId } = body();
    expect((await request(app).post('/api/analytics/event').send(withoutId)).status).toBe(400);
  });

  it('rejects a non-http(s) eventSourceUrl', async () => {
    const res = await request(app)
      .post('/api/analytics/event')
      .send(body({ eventSourceUrl: 'javascript:alert(1)' }));
    expect(res.status).toBe(400);
  });

  it('rejects an oversized searchString and an oversized contentIds list', async () => {
    const long = await request(app)
      .post('/api/analytics/event')
      .send(body({ eventName: 'Search', payload: { searchString: 'a'.repeat(201) } }));
    expect(long.status).toBe(400);

    const many = await request(app)
      .post('/api/analytics/event')
      .send(body({ payload: { contentIds: Array.from({ length: 51 }, (_, i) => `id-${i}`) } }));
    expect(many.status).toBe(400);
  });

  it('answers malformed JSON with 400, not 500', async () => {
    const res = await request(app)
      .post('/api/analytics/event')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('never blocks the customer when the CAPI send fails (§6.8)', async () => {
    sendMetaCapiEvent.mockRejectedValueOnce(new Error('meta down'));
    const res = await request(app).post('/api/analytics/event').send(body());
    expect(res.status).toBe(200);
  });
});
