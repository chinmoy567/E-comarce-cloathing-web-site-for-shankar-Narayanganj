import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, connect, dropSchema, resetSchema } from '../helpers/schemaFixture.ts';

/**
 * Spec 02 acceptance 2–6, 8 — the identity constraints, asserted against a real
 * PostgreSQL.
 *
 * These are database-level guarantees (06-rbac §5.19: an invalid role must be
 * rejected "whether by application error or direct database access"), so every
 * statement here is raw SQL that bypasses the repository layer entirely. A test
 * that went through the repositories would prove only that the repositories
 * behave, which is not the claim.
 */
const SCHEMA = 'spec02_identity';

const INSERT_CUSTOMER = `
  INSERT INTO customers (
    full_name, phone_number, division, district,
    area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address
  ) VALUES ($1,$2,'Dhaka','Dhaka','THANA','Gulshan','WARD','Ward 19','House 1')
  RETURNING id
`;

describe.skipIf(!TEST_DATABASE_URL)('spec 02 identity schema constraints', () => {
  let db: pg.Client;

  beforeAll(async () => {
    await resetSchema(SCHEMA);
    db = await connect(SCHEMA);
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    await dropSchema(SCHEMA);
  });

  /** Isolates each case, so one failed constraint cannot cascade into the next. */
  const inTx = async (fn: (c: pg.Client) => Promise<void>): Promise<void> => {
    await db.query('BEGIN');
    try {
      await fn(db);
    } finally {
      await db.query('ROLLBACK');
    }
  };

  describe('user_role enum (acceptance 2, test 1)', () => {
    it.each(['SUPER_ADMIN', 'STAFF'])('rejects a direct write of %s', async (role) => {
      await inTx(async (c) => {
        await expect(
          c.query(
            `INSERT INTO users (role, user_identifier, password_hash) VALUES ($1, 'x', 'h')`,
            [role],
          ),
        ).rejects.toThrow(/invalid input value for enum user_role/i);
      });
    });

    it('accepts the three documented roles', async () => {
      await inTx(async (c) => {
        for (const role of ['ADMIN', 'MANAGER']) {
          await expect(
            c.query(
              `INSERT INTO users (role, user_identifier, password_hash) VALUES ($1, $2, 'h')`,
              [role, `id-${role}`],
            ),
          ).resolves.toBeDefined();
        }
      });
    });
  });

  describe('customers phone number (acceptance 3, 4; test 3)', () => {
    it('rejects a duplicate phone number', async () => {
      await inTx(async (c) => {
        await c.query(INSERT_CUSTOMER, ['First', '01712345678']);
        await expect(c.query(INSERT_CUSTOMER, ['Second', '01712345678'])).rejects.toThrow(
          /customers_phone_number_key/,
        );
      });
    });

    it('rejects a 9-digit number and accepts the canonical 11-digit form', async () => {
      await inTx(async (c) => {
        await expect(c.query(INSERT_CUSTOMER, ['Short', '0171234567'])).rejects.toThrow(
          /customers_phone_number_format/,
        );
      });
      await inTx(async (c) => {
        await expect(c.query(INSERT_CUSTOMER, ['Valid', '01712345678'])).resolves.toBeDefined();
      });
    });
  });

  describe('users phone number (test 2)', () => {
    it('rejects a second account on the same mobile number', async () => {
      await inTx(async (c) => {
        const { rows } = await c.query<{ id: string }>(INSERT_CUSTOMER, ['A', '01712345678']);
        const { rows: rows2 } = await c.query<{ id: string }>(INSERT_CUSTOMER, ['B', '01812345678']);

        await c.query(
          `INSERT INTO users (role, phone_number, password_hash, customer_id)
           VALUES ('CUSTOMER', '01712345678', 'h', $1)`,
          [rows[0]!.id],
        );

        // A different customer row, but the same login phone number.
        await expect(
          c.query(
            `INSERT INTO users (role, phone_number, password_hash, customer_id)
             VALUES ('CUSTOMER', '01712345678', 'h', $1)`,
            [rows2[0]!.id],
          ),
        ).rejects.toThrow(/users_phone_number_key/);
      });
    });
  });

  describe('customer/back-office domain separation (acceptance 6, test 4)', () => {
    it('rejects a CUSTOMER row without a customer_id', async () => {
      await inTx(async (c) => {
        await expect(
          c.query(
            `INSERT INTO users (role, phone_number, password_hash)
             VALUES ('CUSTOMER', '01712345678', 'h')`,
          ),
        ).rejects.toThrow(/users_role_shape/);
      });
    });

    it('rejects an ADMIN row carrying a customer_id', async () => {
      await inTx(async (c) => {
        const { rows } = await c.query<{ id: string }>(INSERT_CUSTOMER, ['A', '01712345678']);
        await expect(
          c.query(
            `INSERT INTO users (role, user_identifier, password_hash, customer_id)
             VALUES ('ADMIN', 'admin1', 'h', $1)`,
            [rows[0]!.id],
          ),
        ).rejects.toThrow(/users_role_shape/);
      });
    });

    it('rejects a MANAGER row without a user_identifier', async () => {
      await inTx(async (c) => {
        await expect(
          c.query(`INSERT INTO users (role, password_hash) VALUES ('MANAGER', 'h')`),
        ).rejects.toThrow(/users_role_shape/);
      });
    });

    it('rejects a second login identity for one customer record', async () => {
      await inTx(async (c) => {
        const { rows } = await c.query<{ id: string }>(INSERT_CUSTOMER, ['A', '01712345678']);
        const id = rows[0]!.id;

        await c.query(
          `INSERT INTO users (role, phone_number, password_hash, customer_id)
           VALUES ('CUSTOMER', '01712345678', 'h', $1)`,
          [id],
        );
        await expect(
          c.query(
            `INSERT INTO users (role, phone_number, password_hash, customer_id)
             VALUES ('CUSTOMER', '01812345678', 'h', $1)`,
            [id],
          ),
        ).rejects.toThrow(/users_customer_id_key/);
      });
    });
  });

  describe('single system admin (acceptance 5, test 5)', () => {
    it('rejects a second is_system_admin row', async () => {
      await inTx(async (c) => {
        await c.query(
          `INSERT INTO users (role, user_identifier, password_hash, is_system_admin)
           VALUES ('ADMIN', 'admin1', 'h', true)`,
        );
        await expect(
          c.query(
            `INSERT INTO users (role, user_identifier, password_hash, is_system_admin)
             VALUES ('ADMIN', 'admin2', 'h', true)`,
          ),
        ).rejects.toThrow(/users_single_system_admin_key/);
      });
    });

    it('rejects a system designation on a non-Admin role', async () => {
      await inTx(async (c) => {
        await expect(
          c.query(
            `INSERT INTO users (role, user_identifier, password_hash, is_system_admin)
             VALUES ('MANAGER', 'mgr1', 'h', true)`,
          ),
        ).rejects.toThrow(/users_system_admin_is_admin/);
      });
    });
  });

  describe('address discriminators (acceptance criteria, test 8)', () => {
    it('stores THANA as THANA rather than coercing it to UPAZILA', async () => {
      await inTx(async (c) => {
        const { rows } = await c.query<{ id: string }>(INSERT_CUSTOMER, ['A', '01712345678']);
        const { rows: read } = await c.query<{
          area_unit_type: string;
          ward_unit_type: string;
        }>('SELECT area_unit_type, ward_unit_type FROM customers WHERE id = $1', [rows[0]!.id]);

        expect(read[0]).toEqual({ area_unit_type: 'THANA', ward_unit_type: 'WARD' });
      });
    });

    it('stores the UPAZILA/UNION convention just as faithfully', async () => {
      await inTx(async (c) => {
        const { rows } = await c.query<{ area_unit_type: string; ward_unit_type: string }>(
          `INSERT INTO customers (
             full_name, phone_number, division, district,
             area_unit_type, area_unit_name, ward_unit_type, ward_unit_name, detailed_address
           ) VALUES ('Rural','01912345678','Khulna','Jessore','UPAZILA','Abhaynagar','UNION','Prembag','Village road')
           RETURNING area_unit_type, ward_unit_type`,
        );
        expect(rows[0]).toEqual({ area_unit_type: 'UPAZILA', ward_unit_type: 'UNION' });
      });
    });
  });

  describe('audit_logs actor', () => {
    it('rejects an actor_type outside USER/SYSTEM', async () => {
      await inTx(async (c) => {
        await expect(
          c.query(
            `INSERT INTO audit_logs (entity_type, action, actor_type)
             VALUES ('order', 'status_change', 'ROBOT')`,
          ),
        ).rejects.toThrow(/audit_logs_actor_type_check/);
      });
    });
  });
});
