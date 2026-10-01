import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapBdCourierResponse } from '../../src/services/fraud/providers/bdCourierProvider.ts';
import { RiskProviderError } from '../../src/services/fraud/providers/types.ts';

/**
 * BD Courier response mapping (implementation spec 16, tests 5, 6, 7; acceptance 9, 10;
 * 09-fraud-risk-check §7.5 "must not invent fields the API does not return", §7.8).
 *
 * S4, no database: mapBdCourierResponse is a pure function.
 *
 * Provenance: no recorded official BD Courier payload exists in this repo (CLAUDE.md §6 allows
 * recorded fixtures only, and none were available to this session). The bodies below are built
 * ONLY from the response contract the adapter documents for itself (status, data.summary.
 * {total_parcel, success_parcel, cancelled_parcel, success_ratio}, risk_verdict.level) and carry
 * no invented extra provider fields. The band table is transcribed from the adapter's documented
 * contract: safe/low -> LOW, medium -> MEDIUM, high/danger -> HIGH, anything else -> UNKNOWN.
 */
// The shared logger is a lazy Proxy that cannot be spied on, so it is replaced at the module boundary.
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('../../src/lib/logger.ts', () => ({ logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

type Summary = { total_parcel?: unknown; success_parcel?: unknown; cancelled_parcel?: unknown; success_ratio?: unknown };

const body = (summary: Summary, level?: unknown, extra: Record<string, unknown> = {}) => ({
  status: 'success',
  data: { summary },
  ...(level === undefined ? {} : { risk_verdict: { level } }),
  ...extra,
});
const FULL: Summary = { total_parcel: 25, success_parcel: 22, cancelled_parcel: 3, success_ratio: 88 };

describe('mapBdCourierResponse (spec 16)', () => {
  beforeEach(() => warn.mockReset());

  describe('provider band -> our level', () => {
    it.each([
      ['safe', 'LOW'],
      ['low', 'LOW'],
      ['medium', 'MEDIUM'],
      ['high', 'HIGH'],
      ['danger', 'HIGH'],
    ])('band %s maps to %s', (band, level) => {
      expect(mapBdCourierResponse(body(FULL, band)).riskLevel).toBe(level);
    });

    it.each(['extreme', 'critical', '', 'null', 42, null, {}, ['high']])('unrecognised band %j maps to UNKNOWN, never guessed (test 7)', (band) => {
      const out = mapBdCourierResponse(body(FULL, band));
      expect(out.riskLevel).toBe('UNKNOWN');
      expect(out.riskLevel).not.toBe('HIGH');
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('a missing risk_verdict is UNKNOWN and logged', () => {
      expect(mapBdCourierResponse(body(FULL)).riskLevel).toBe('UNKNOWN');
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('a recognised band is not logged as unrecognised', () => {
      mapBdCourierResponse(body(FULL, 'medium'));
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('counts', () => {
    it('maps total_parcel / success_parcel / cancelled_parcel to totalOrders / successfulOrders / returnedOrders', () => {
      expect(mapBdCourierResponse(body(FULL, 'safe'))).toMatchObject({ totalOrders: 25, successfulOrders: 22, returnedOrders: 3 });
    });

    it('riskScore is always null: the provider returns no numeric score, and stray numeric fields are not promoted to one', () => {
      const out = mapBdCourierResponse(body(FULL, 'high', { risk_score: 77, score: 12 }));
      expect(out.riskScore).toBeNull();
    });

    it('success_ratio is not mapped to any result field (it is derived for display, not stored)', () => {
      const out = mapBdCourierResponse(body(FULL, 'safe'));
      expect(Object.keys(out).sort()).toEqual(['raw', 'returnedOrders', 'riskLevel', 'riskScore', 'successfulOrders', 'totalOrders']);
    });

    it.each([
      ['success_parcel absent', { total_parcel: 10, cancelled_parcel: 2 }, { totalOrders: 10, successfulOrders: null, returnedOrders: 2 }],
      ['cancelled_parcel absent', { total_parcel: 10, success_parcel: 8 }, { totalOrders: 10, successfulOrders: 8, returnedOrders: null }],
      ['total_parcel absent (acceptance 10)', { success_parcel: 8, cancelled_parcel: 2 }, { totalOrders: null, successfulOrders: 8, returnedOrders: 2 }],
      ['every count absent', {}, { totalOrders: null, successfulOrders: null, returnedOrders: null }],
    ])('absent fields stay null, never 0 (test 6, §7.5): %s', (_name, summary, expected) => {
      expect(mapBdCourierResponse(body(summary, 'medium'))).toMatchObject({ riskLevel: 'MEDIUM', ...expected });
    });

    it.each([
      ['a numeric string', '5'],
      ['a negative number', -1],
      ['a fraction', 2.5],
      ['NaN', Number.NaN],
      ['null', null],
      ['a boolean', true],
    ])('a count that is %s becomes null rather than a coerced or fabricated number', (_name, bad) => {
      const out = mapBdCourierResponse(body({ total_parcel: 10, success_parcel: bad, cancelled_parcel: bad }, 'low'));
      expect(out.successfulOrders).toBeNull();
      expect(out.returnedOrders).toBeNull();
    });
  });

  describe('no courier history (test 5; acceptance 9; §7.8)', () => {
    it('total_parcel 0 maps to UNKNOWN with null counts', () => {
      expect(mapBdCourierResponse(body({ total_parcel: 0, success_parcel: 0, cancelled_parcel: 0, success_ratio: 0 }, 'safe'))).toMatchObject({
        riskLevel: 'UNKNOWN', riskScore: null, totalOrders: null, successfulOrders: null, returnedOrders: null,
      });
    });

    it.each(['high', 'danger', 'medium'])('no history is UNKNOWN even if the provider band says %s — absence of history is never high risk', (band) => {
      expect(mapBdCourierResponse(body({ total_parcel: 0 }, band)).riskLevel).toBe('UNKNOWN');
    });

    it('a history-less answer is not logged as an unrecognised band', () => {
      mapBdCourierResponse(body({ total_parcel: 0 }));
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('raw payload', () => {
    it('returns the parsed body untouched as `raw` (stored for audit, never returned to the frontend)', () => {
      const input = body(FULL, 'safe', { providerOnly: 'x' });
      expect(mapBdCourierResponse(input).raw).toBe(input);
    });
  });

  describe('malformed answers are failures, not results', () => {
    it.each([
      ['not an object', 'oops'],
      ['null', null],
      ['an array', []],
      ['status is not success', { status: 'error', data: { summary: FULL } }],
      ['status missing', { data: { summary: FULL } }],
      ['data missing', { status: 'success' }],
      ['data is not an object', { status: 'success', data: 'x' }],
      ['summary missing', { status: 'success', data: {} }],
      ['summary is not an object', { status: 'success', data: { summary: [] } }],
    ])('%s throws RiskProviderError', (_name, input) => {
      expect(() => mapBdCourierResponse(input)).toThrow(RiskProviderError);
    });
  });
});
