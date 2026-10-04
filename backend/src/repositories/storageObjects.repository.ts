import { run, type Db } from './db.js';

/**
 * Registry of stored objects (spec 06). Rows are only ever inserted and
 * soft-deleted (`deleted_at`); the registry never claims an object is gone
 * while it is still served, so `markDeleted` is called only after the bucket
 * delete succeeded.
 */

export type StorageObjectRecord = {
  id: string;
  bucket: string;
  objectPath: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  checksumSha256: string;
  ownerEntityType: string | null;
  ownerEntityId: string | null;
  createdAt: Date;
  deletedAt: Date | null;
};

type Row = {
  id: string;
  bucket: string;
  object_path: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  checksum_sha256: string;
  owner_entity_type: string | null;
  owner_entity_id: string | null;
  created_at: Date;
  deleted_at: Date | null;
};

const COLUMNS = `
  id, bucket, object_path, visibility, mime_type, byte_size, width, height,
  checksum_sha256, owner_entity_type, owner_entity_id, created_at, deleted_at
`;

function toRecord(row: Row): StorageObjectRecord {
  return {
    id: row.id,
    bucket: row.bucket,
    objectPath: row.object_path,
    visibility: row.visibility,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    checksumSha256: row.checksum_sha256,
    ownerEntityType: row.owner_entity_type,
    ownerEntityId: row.owner_entity_id,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

export type InsertStorageObject = {
  bucket: string;
  objectPath: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  checksumSha256: string;
  uploadedBy: string | null;
  ownerEntityType: string | null;
  ownerEntityId: string | null;
};

export async function insert(input: InsertStorageObject, db?: Db): Promise<StorageObjectRecord> {
  return run(db, async (client) => {
    const { rows } = await client.query<Row>(
      `INSERT INTO storage_objects (
         bucket, object_path, visibility, mime_type, byte_size, width, height,
         checksum_sha256, uploaded_by, owner_entity_type, owner_entity_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${COLUMNS}`,
      [
        input.bucket,
        input.objectPath,
        input.visibility,
        input.mimeType,
        input.byteSize,
        input.width,
        input.height,
        input.checksumSha256,
        input.uploadedBy,
        input.ownerEntityType,
        input.ownerEntityId,
      ],
    );
    return toRecord(rows[0]!);
  });
}

export async function findById(id: string, db?: Db): Promise<StorageObjectRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<Row>(`SELECT ${COLUMNS} FROM storage_objects WHERE id = $1`, [id]);
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

export async function markDeleted(id: string, db?: Db): Promise<void> {
  await run(db, (client) =>
    client.query(`UPDATE storage_objects SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]),
  );
}

/** The live (not soft-deleted) payment proof object of an order, if any. */
export async function findPaymentProofForOrder(orderId: string, db?: Db): Promise<StorageObjectRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT ${COLUMNS.split(',').map((c) => `so.${c.trim()}`).join(', ')}
         FROM orders o
         JOIN storage_objects so ON so.id = o.payment_proof_object_id
        WHERE o.id = $1 AND so.deleted_at IS NULL`,
      [orderId],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

/** Points an order at its (new) payment proof; returns the id it pointed at before, if any. */
export async function setOrderPaymentProof(orderId: string, objectId: string, db?: Db): Promise<string | null> {
  return run(db, async (client) => {
    const prev = await client.query<{ payment_proof_object_id: string | null }>(
      `SELECT payment_proof_object_id FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    await client.query(`UPDATE orders SET payment_proof_object_id = $2, updated_at = now() WHERE id = $1`, [orderId, objectId]);
    return prev.rows[0]?.payment_proof_object_id ?? null;
  });
}
