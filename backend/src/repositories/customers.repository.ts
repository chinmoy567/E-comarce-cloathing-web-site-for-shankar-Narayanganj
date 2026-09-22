import { normalizeBdPhone } from '../lib/phone.js';
import type { PaginationQuery } from '../lib/pagination.js';
import type { AccountType, AreaUnitType, WardUnitType } from '../types/enums.js';
import type { CustomerAddress, CustomerRecord } from '../types/customer.js';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

/**
 * Customer records — registered customers AND guest references, one row per
 * phone number (02-customer §2.9.4, 05-admin-operations §5.7).
 *
 * Every phone value passes through `normalizeBdPhone` here, so a caller cannot
 * create a second record for the same person by passing `+880…` instead of
 * `01…`.
 */

type CustomerRow = {
  id: string;
  account_type: AccountType;
  full_name: string;
  phone_number: string;
  email: string | null;
  division: string;
  district: string;
  area_unit_type: AreaUnitType;
  area_unit_name: string;
  ward_unit_type: WardUnitType;
  ward_unit_name: string;
  detailed_address: string;
  postal_code: string | null;
};

const COLUMNS = `
  id, account_type, full_name, phone_number, email,
  division, district, area_unit_type, area_unit_name,
  ward_unit_type, ward_unit_name, detailed_address, postal_code
`;

function toRecord(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    accountType: row.account_type,
    fullName: row.full_name,
    phoneNumber: row.phone_number,
    email: row.email,
    address: {
      division: row.division,
      district: row.district,
      areaUnitType: row.area_unit_type,
      areaUnitName: row.area_unit_name,
      wardUnitType: row.ward_unit_type,
      wardUnitName: row.ward_unit_name,
      detailedAddress: row.detailed_address,
      postalCode: row.postal_code,
    },
  };
}

export type CustomerInput = {
  fullName: string;
  phoneNumber: string;
  email?: string | null;
  address: CustomerAddress;
};

/** Positional values matching the insert column order used below. */
function toValues(input: CustomerInput, accountType: AccountType): unknown[] {
  const a = input.address;
  return [
    accountType,
    input.fullName,
    normalizeBdPhone(input.phoneNumber),
    input.email ?? null,
    a.division,
    a.district,
    a.areaUnitType,
    a.areaUnitName,
    a.wardUnitType,
    a.wardUnitName,
    a.detailedAddress,
    a.postalCode ?? null,
  ];
}

export async function findByPhoneNumber(
  phoneNumber: string,
  db?: Db,
): Promise<CustomerRecord | null> {
  const normalized = normalizeBdPhone(phoneNumber);
  return run(db, async (client) => {
    const { rows } = await client.query<CustomerRow>(
      `SELECT ${COLUMNS} FROM customers WHERE phone_number = $1`,
      [normalized],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

export async function findById(id: string, db?: Db): Promise<CustomerRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<CustomerRow>(
      `SELECT ${COLUMNS} FROM customers WHERE id = $1`,
      [id],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

/**
 * Creates a GUEST reference. Fails with CUSTOMER_PHONE_EXISTS when the phone
 * number is already known — callers that want reuse want `upsertByPhoneNumber`.
 */
export async function createGuestReference(
  input: CustomerInput,
  db?: Db,
): Promise<CustomerRecord> {
  return run(db, async (client) => {
    try {
      const { rows } = await client.query<CustomerRow>(
        `INSERT INTO customers (
           account_type, full_name, phone_number, email,
           division, district, area_unit_type, area_unit_name,
           ward_unit_type, ward_unit_name, detailed_address, postal_code
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING ${COLUMNS}`,
        toValues(input, 'GUEST'),
      );
      return toRecord(rows[0]!);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/**
 * Creates the customer record, or refreshes the existing one for this phone
 * number (02-customer §2.9.4 "create or reuse").
 *
 * One statement resolved by the `customers_phone_number_key` constraint, never
 * check-then-insert: two concurrent guest checkouts from the same number
 * converge on one row instead of racing to create two.
 *
 * An existing REGISTERED record is never downgraded to GUEST — when someone who
 * already holds an account checks out as a guest, their details are refreshed
 * and the account type is left alone.
 */
export async function upsertByPhoneNumber(
  input: CustomerInput,
  accountType: AccountType = 'GUEST',
  db?: Db,
): Promise<CustomerRecord> {
  return run(db, async (client) => {
    try {
      const { rows } = await client.query<CustomerRow>(
        `INSERT INTO customers (
           account_type, full_name, phone_number, email,
           division, district, area_unit_type, area_unit_name,
           ward_unit_type, ward_unit_name, detailed_address, postal_code
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (phone_number) DO UPDATE SET
           account_type = CASE
             WHEN customers.account_type = 'REGISTERED'
               THEN customers.account_type
             ELSE EXCLUDED.account_type
           END,
           full_name        = EXCLUDED.full_name,
           email            = COALESCE(EXCLUDED.email, customers.email),
           division         = EXCLUDED.division,
           district         = EXCLUDED.district,
           area_unit_type   = EXCLUDED.area_unit_type,
           area_unit_name   = EXCLUDED.area_unit_name,
           ward_unit_type   = EXCLUDED.ward_unit_type,
           ward_unit_name   = EXCLUDED.ward_unit_name,
           detailed_address = EXCLUDED.detailed_address,
           postal_code      = EXCLUDED.postal_code,
           updated_at       = now()
         RETURNING ${COLUMNS}`,
        toValues(input, accountType),
      );
      return toRecord(rows[0]!);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/**
 * Marks an existing record REGISTERED (02-customer §2.9.8 guest -> registered).
 * The login identity itself is created in `users` by spec 08.
 */
export async function promoteToRegistered(id: string, db?: Db): Promise<CustomerRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<CustomerRow>(
      `UPDATE customers
          SET account_type = 'REGISTERED', updated_at = now()
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      [id],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

export async function updateAddress(
  id: string,
  address: CustomerAddress,
  db?: Db,
): Promise<CustomerRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<CustomerRow>(
      `UPDATE customers SET
         division = $2, district = $3,
         area_unit_type = $4, area_unit_name = $5,
         ward_unit_type = $6, ward_unit_name = $7,
         detailed_address = $8, postal_code = $9,
         updated_at = now()
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [
        id,
        address.division,
        address.district,
        address.areaUnitType,
        address.areaUnitName,
        address.wardUnitType,
        address.wardUnitName,
        address.detailedAddress,
        address.postalCode ?? null,
      ],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

/**
 * Paginated listing for the spec 13 admin customer panel.
 *
 * `count(*) OVER()` returns the unfiltered total alongside the page, so the
 * pagination block costs no second round trip.
 */
export async function list(
  pagination: PaginationQuery,
  db?: Db,
): Promise<{ items: CustomerRecord[]; total: number }> {
  const { page, pageSize } = pagination;
  return run(db, async (client) => {
    const { rows } = await client.query<CustomerRow & { total: string }>(
      `SELECT ${COLUMNS}, count(*) OVER()::text AS total
         FROM customers
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize],
    );
    return {
      items: rows.map(toRecord),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  });
}
