import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Win = { fbq?: ReturnType<typeof vi.fn>; location: { origin: string; pathname: string } };

let win: Win;
const firstCall = () => (win.fbq!.mock.calls[0] ?? []) as unknown[];
const fetchMock = vi.fn(async () => ({ ok: true }));

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockClear();
  win = { fbq: vi.fn(), location: { origin: 'https://fabrillke.com', pathname: '/products/x' } };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { cookie: '_fbp=fb.1.123.456; _fbc=fb.1.123.abc', createElement: vi.fn(() => ({})), head: { appendChild: vi.fn() } });
  vi.stubGlobal('fetch', fetchMock);
  process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.example.test';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
});

describe('track()', () => {
  it('uses the same event_id for the Pixel and the backend copy (§6.4)', async () => {
    const { track } = await import('../src/lib/analytics');
    track('ViewContent', { content_ids: ['p1'] });
    const pixelId = (firstCall()[3] as { eventID: string }).eventID;
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.eventId).toBe(pixelId);
    expect(body.eventName).toBe('ViewContent');
  });

  it('never posts a value or price to the backend, and forwards fbp/fbc', async () => {
    const { track } = await import('../src/lib/analytics');
    track('AddToCart', { contents: [{ id: 'v1', quantity: 2, item_price: 500 }], value: 1000 });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(JSON.stringify(body)).not.toMatch(/value|item_price|1000|500/);
    expect(body.payload.contents).toEqual([{ id: 'v1', quantity: 2 }]);
    expect(body.fbp).toBe('fb.1.123.456');
    expect(body.fbc).toBe('fb.1.123.abc');
  });

  it('drops params outside the allowlist from the Pixel call', async () => {
    const { track } = await import('../src/lib/analytics');
    track('Search', { search_string: 'shirt', event_source_url: 'x' } as never);
    const params = firstCall()[2] as Record<string, unknown>;
    expect(params).toEqual({ search_string: 'shirt' });
  });

  it('never throws when the backend call fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const { track } = await import('../src/lib/analytics');
    expect(() => track('PageView', {})).not.toThrow();
  });
});

describe('firePixelPurchase()', () => {
  it('fires the Pixel with the supplied deterministic id and never posts to the backend', async () => {
    const { firePixelPurchase } = await import('../src/lib/analytics');
    firePixelPurchase({ eventId: 'purchase:FB-1', value: 850, numItems: 2 });
    expect(firstCall()[1]).toBe('Purchase');
    expect((firstCall()[3] as { eventID: string }).eventID).toBe('purchase:FB-1');
    expect(firstCall()[2]).toMatchObject({ value: 850, currency: 'BDT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('initPixel()', () => {
  it('is a no-op without a Pixel ID', async () => {
    delete win.fbq;
    const { initPixel } = await import('../src/lib/analytics');
    initPixel();
    expect(win.fbq).toBeUndefined();
  });

  it('is idempotent: a second call does not re-init', async () => {
    process.env.NEXT_PUBLIC_META_PIXEL_ID = '123';
    delete win.fbq;
    const { initPixel } = await import('../src/lib/analytics');
    initPixel();
    const first = win.fbq;
    initPixel();
    expect(win.fbq).toBe(first);
    expect((document.head.appendChild as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});
