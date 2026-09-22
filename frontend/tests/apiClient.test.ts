import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, apiGet } from '../src/lib/apiClient';

process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:4000';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiClient (spec 01 §Frontend work)', () => {
  it('unwraps the ApiSuccess envelope', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { data: { status: 'ok' } }));

    await expect(apiGet<{ status: string }>('/api/health')).resolves.toEqual({ status: 'ok' });
  });

  it('sends credentials so either session transport works', async () => {
    const fetchMock = mockFetch(200, { data: null });
    vi.stubGlobal('fetch', fetchMock);

    await apiGet('/api/health');

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
  });

  it('throws a typed ApiClientError carrying code, message and field details', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request contains invalid fields.',
          details: [{ field: 'phone', message: 'Unrecognized field.' }],
        },
        requestId: 'req-1',
      }),
    );

    await expect(apiGet('/api/thing')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      requestId: 'req-1',
    });
  });

  it('exposes a per-field error message for rendering beside an input', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request contains invalid fields.',
          details: [{ field: 'phone', message: 'Invalid phone number.' }],
        },
        requestId: 'req-2',
      }),
    );

    try {
      await apiGet('/api/thing');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).fieldError('phone')).toBe('Invalid phone number.');
    }
  });

  it('converts a network failure into a readable message, not a raw error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));

    await expect(apiGet('/api/health')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
