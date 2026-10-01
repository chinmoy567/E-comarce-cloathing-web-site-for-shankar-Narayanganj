import { describe, expect, it } from 'vitest';
import { makeFakeCourierAdapter } from './helpers/fakeCourierAdapter.ts';
import { runCourierAdapterContract } from './helpers/courierAdapterContract.ts';
import { getAdapter, registerAdapter, unregisterAdapter } from '../../src/services/courier/registry.js';

/**
 * Spec 14 tests 10 and 12 (04-courier §4.9): every adapter satisfies one shared
 * contract. No database. Only fake adapters are listed because the real Pathao and
 * Steadfast adapters do not exist yet (waiting on official documentation,
 * CLAUDE.md §6). When they land, add:
 *
 *   runCourierAdapterContract('pathao', pathaoAdapter, installRecordedFixtureStub);
 *
 * and they inherit every case below. Status normalization (test 11) and provider
 * field mapping (test 18) need recorded provider fixtures and are deferred.
 */
runCourierAdapterContract('fake', makeFakeCourierAdapter('fake'));
runCourierAdapterContract('fake with reference lookup', makeFakeCourierAdapter('fake2', { withReferenceLookup: true }));

describe('adapter registry (§4.9)', () => {
  it('resolves an adapter by key, and a removed key resolves to undefined', () => {
    const a = makeFakeCourierAdapter('registrytest');
    registerAdapter(a);
    try {
      expect(getAdapter('registrytest')).toBe(a);
    } finally {
      unregisterAdapter('registrytest');
    }
    expect(getAdapter('registrytest')).toBeUndefined();
  });
});
