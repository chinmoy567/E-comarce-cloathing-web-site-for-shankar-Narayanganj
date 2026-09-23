import type { AttributeType } from '../types/catalogue.js';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

/**
 * Product attributes (Size / Colour / Age group / Other) and their values
 * (spec 05 §Database changes — `product_attributes`, `product_attribute_values`).
 */

type AttributeRow = {
  id: string;
  type: AttributeType;
  name: string;
  display_order: number;
  created_at: Date;
  updated_at: Date;
};

export type AttributeRecord = {
  id: string;
  type: AttributeType;
  name: string;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type AttributeValueRow = {
  id: string;
  attribute_id: string;
  value: string;
  display_order: number;
  created_at: Date;
};

export type AttributeValueRecord = {
  id: string;
  attributeId: string;
  value: string;
  displayOrder: number;
  createdAt: Date;
};

const ATTRIBUTE_COLUMNS = `id, type, name, display_order, created_at, updated_at`;
const VALUE_COLUMNS = `id, attribute_id, value, display_order, created_at`;

function toAttributeRecord(row: AttributeRow): AttributeRecord {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toValueRecord(row: AttributeValueRow): AttributeValueRecord {
  return {
    id: row.id,
    attributeId: row.attribute_id,
    value: row.value,
    displayOrder: row.display_order,
    createdAt: row.created_at,
  };
}

export async function listAll(db?: Db): Promise<AttributeRecord[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<AttributeRow>(
      `SELECT ${ATTRIBUTE_COLUMNS} FROM product_attributes ORDER BY display_order, name`,
    );
    return rows.map(toAttributeRecord);
  });
}

export async function findById(id: string, db?: Db): Promise<AttributeRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<AttributeRow>(
      `SELECT ${ATTRIBUTE_COLUMNS} FROM product_attributes WHERE id = $1`,
      [id],
    );
    return rows[0] ? toAttributeRecord(rows[0]) : null;
  });
}

export type CreateAttributeInput = {
  type: AttributeType;
  name: string;
  displayOrder?: number;
};

export async function create(input: CreateAttributeInput, db?: Db): Promise<AttributeRecord> {
  return run(db, async (client) => {
    try {
      const { rows } = await client.query<AttributeRow>(
        `INSERT INTO product_attributes (type, name, display_order)
         VALUES ($1,$2,$3)
         RETURNING ${ATTRIBUTE_COLUMNS}`,
        [input.type, input.name, input.displayOrder ?? 0],
      );
      return toAttributeRecord(rows[0]!);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

export async function listValuesForAttribute(
  attributeId: string,
  db?: Db,
): Promise<AttributeValueRecord[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<AttributeValueRow>(
      `SELECT ${VALUE_COLUMNS} FROM product_attribute_values
        WHERE attribute_id = $1
        ORDER BY display_order, value`,
      [attributeId],
    );
    return rows.map(toValueRecord);
  });
}

/** Bulk fetch, used to validate a set of `attributeValueIds` in one query. */
export async function findValuesByIds(
  ids: string[],
  db?: Db,
): Promise<AttributeValueRecord[]> {
  if (ids.length === 0) return [];
  return run(db, async (client) => {
    const { rows } = await client.query<AttributeValueRow>(
      `SELECT ${VALUE_COLUMNS} FROM product_attribute_values WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return rows.map(toValueRecord);
  });
}

export type CreateAttributeValueInput = {
  attributeId: string;
  value: string;
  displayOrder?: number;
};

export async function createValue(
  input: CreateAttributeValueInput,
  db?: Db,
): Promise<AttributeValueRecord> {
  return run(db, async (client) => {
    try {
      const { rows } = await client.query<AttributeValueRow>(
        `INSERT INTO product_attribute_values (attribute_id, value, display_order)
         VALUES ($1,$2,$3)
         RETURNING ${VALUE_COLUMNS}`,
        [input.attributeId, input.value, input.displayOrder ?? 0],
      );
      return toValueRecord(rows[0]!);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

export async function removeValue(attributeId: string, valueId: string, db?: Db): Promise<void> {
  return run(db, async (client) => {
    try {
      await client.query(
        `DELETE FROM product_attribute_values WHERE id = $1 AND attribute_id = $2`,
        [valueId, attributeId],
      );
    } catch (err) {
      throw toDomainError(err);
    }
  });
}
