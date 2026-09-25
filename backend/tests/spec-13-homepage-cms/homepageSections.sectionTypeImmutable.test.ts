import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { TEST_DATABASE_URL, dropSchema, resetSchema, scopedUrl } from '../helpers/schemaFixture.js';

/**
 * Spec 13 — section_type immutability (§13.4). Direct SQL: a schema/trigger
 * guarantee, not something a mock would prove either way.
 */
const SCHEMA = 'spec13_section_type_immutable';

describe.skipIf(!TEST_DATABASE_URL)('homepage_sections.section_type immutability (13-homepage-cms §13.4)', () => {
  let client: pg.Client;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    client = new pg.Client({ connectionString: scopedUrl(SCHEMA) });
    await client.connect();
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    await dropSchema(SCHEMA);
  });

  it('a direct UPDATE changing section_type is rejected by the trigger', async () => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO homepage_sections (section_type, display_order) VALUES ('HERO', 0) RETURNING id`,
    );
    const id = rows[0]!.id;

    await expect(client.query(`UPDATE homepage_sections SET section_type = 'PROMO_BANNER' WHERE id = $1`, [id])).rejects.toThrow(
      /immutable/i,
    );
  });

  it('an UPDATE leaving section_type unchanged succeeds', async () => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO homepage_sections (section_type, display_order) VALUES ('HERO', 1) RETURNING id`,
    );
    const id = rows[0]!.id;

    await expect(client.query(`UPDATE homepage_sections SET title = 'New title' WHERE id = $1`, [id])).resolves.toBeDefined();
  });
});
