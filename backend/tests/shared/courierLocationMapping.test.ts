import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedGeography } from '../scripts/seedGeography.js';
import {
  findMapping,
  upsertMapping,
} from '../src/repositories/courierLocationMapping.repository.js';
import { listDivisions } from '../src/repositories/geography.repository.js';
import { pathaoLocationMapper } from '../src/services/courier/mappings/pathao.mapping.js';
import { steadfastLocationMapper } from '../src/services/courier/mappings/steadfast.mapping.js';
import { dropSchema, resetSchema, scopedUrl, TEST_DATABASE_URL } from './helpers/schemaFixture.js';

/**
 * The courier mapping boundary (task §7-§9, §16).
 *
 * The point of these tests is the SEPARATION, not any provider's values: no
 * Pathao or Steadfast identifier exists in this repository, and none may be
 * invented (CLAUDE.md §6). The fixtures below use obviously synthetic strings
 * and assert only the boundary's behaviour.
 */

const SCHEMA = 'courier_mapping_test';

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('courier location mapping boundary', () => {
  const originalUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    process.env.DATABASE_URL = scopedUrl(SCHEMA);
    await seedGeography(scopedUrl(SCHEMA));
  });

  afterAll(async () => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    await dropSchema(SCHEMA);
  });

  it('ships with no courier mappings populated', async () => {
    const [division] = await listDivisions();

    // Both providers start empty: their real ids come from each provider's
    // official API at spec 14 time, never from this repository.
    await expect(findMapping('PATHAO', 'DIVISION', division!.id)).resolves.toBeUndefined();
    await expect(findMapping('STEADFAST', 'DIVISION', division!.id)).resolves.toBeUndefined();
  });

  it('reports unmapped locations instead of guessing an id', async () => {
    const [division] = await listDivisions();
    const geography = {
      division: division!,
      district: { id: division!.id, pcode: 'BD0000', name: 'Placeholder District' },
      upazila: { id: division!.id, pcode: 'BD00000000', name: 'Placeholder Upazila' },
    };

    const result = await pathaoLocationMapper.resolve(geography);

    // A wrong zone silently misdelivers a parcel; an explicit failure does not.
    expect(result.resolved).toBe(false);
    if (!result.resolved) {
      expect(result.missing.map((m) => m.level)).toEqual([...pathaoLocationMapper.requiredLevels]);
      expect(result.missing[0]).toHaveProperty('name');
    }
  });

  it('keeps each courier in its own namespace', async () => {
    const [division] = await listDivisions();

    await upsertMapping({
      courierCode: 'PATHAO',
      geoLevel: 'DIVISION',
      geoId: division!.id,
      courierLocationId: 'TEST-ONLY-1',
      sourceNote: 'synthetic test fixture, not a real provider id',
    });

    await expect(findMapping('PATHAO', 'DIVISION', division!.id)).resolves.toMatchObject({
      courierLocationId: 'TEST-ONLY-1',
    });
    // Steadfast is unaffected — one courier's catalogue never leaks into another's.
    await expect(findMapping('STEADFAST', 'DIVISION', division!.id)).resolves.toBeUndefined();
    expect(steadfastLocationMapper.courierCode).toBe('STEADFAST');
  });

  it('is idempotent per (courier, level, entity)', async () => {
    const [division] = await listDivisions();

    const first = await upsertMapping({
      courierCode: 'PATHAO',
      geoLevel: 'DIVISION',
      geoId: division!.id,
      courierLocationId: 'TEST-ONLY-A',
    });
    const second = await upsertMapping({
      courierCode: 'PATHAO',
      geoLevel: 'DIVISION',
      geoId: division!.id,
      courierLocationId: 'TEST-ONLY-B',
    });

    // Re-resolving updates in place rather than creating a second, ambiguous
    // mapping that would make shipment creation non-deterministic.
    expect(second.id).toBe(first.id);
    expect(second.courierLocationId).toBe('TEST-ONLY-B');
  });

  it('refuses a mapping that references no real geography entity', async () => {
    await expect(
      upsertMapping({
        courierCode: 'PATHAO',
        geoLevel: 'UPAZILA',
        geoId: '00000000-0000-4000-8000-000000000000',
        courierLocationId: 'TEST-ONLY-X',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('never stores a courier id inside the geography tables', async () => {
    // The architectural invariant, asserted rather than assumed: internal
    // geography columns are P-code/name only (task §7).
    const [division] = await listDivisions();
    expect(Object.keys(division!).sort()).toEqual(['id', 'name', 'pcode']);
  });
});
