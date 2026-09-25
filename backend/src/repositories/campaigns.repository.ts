import type { PaginationQuery } from '../lib/pagination.js';
import type { CmsStatus } from '../types/homepageCms.js';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

/** Campaign CRUD (13-homepage-cms §13.7, plan §3). */

type CampaignRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  status: CmsStatus;
  hero_content: unknown;
  visual_theme: unknown;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
};

export type CampaignRecord = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  status: CmsStatus;
  heroContent: unknown;
  visualTheme: unknown;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const COLUMNS = `
  id, name, slug, description, starts_at, ends_at, status, hero_content,
  visual_theme, created_by, updated_by, created_at, updated_at
`;

function toRecord(row: CampaignRow): CampaignRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    heroContent: row.hero_content,
    visualTheme: row.visual_theme,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findById(id: string, db?: Db): Promise<CampaignRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<CampaignRow>(`SELECT ${COLUMNS} FROM campaigns WHERE id = $1`, [id]);
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

export async function findByIds(ids: string[], db?: Db): Promise<CampaignRecord[]> {
  if (ids.length === 0) return [];
  return run(db, async (client) => {
    const { rows } = await client.query<CampaignRow>(`SELECT ${COLUMNS} FROM campaigns WHERE id = ANY($1::uuid[])`, [ids]);
    return rows.map(toRecord);
  });
}

export async function list(pagination: PaginationQuery, db?: Db): Promise<{ items: CampaignRecord[]; total: number }> {
  const { page, pageSize } = pagination;
  return run(db, async (client) => {
    const { rows } = await client.query<CampaignRow & { total: string }>(
      `SELECT ${COLUMNS}, count(*) OVER()::text AS total
         FROM campaigns
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize],
    );
    return { items: rows.map(toRecord), total: rows[0] ? Number(rows[0].total) : 0 };
  });
}

export type CreateCampaignInput = {
  name: string;
  slug: string;
  description?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  status?: CmsStatus;
  heroContent?: unknown;
  visualTheme?: unknown;
  createdBy: string;
};

export async function create(input: CreateCampaignInput, db?: Db): Promise<CampaignRecord> {
  return run(db, async (client) => {
    try {
      const { rows } = await client.query<CampaignRow>(
        `INSERT INTO campaigns (name, slug, description, starts_at, ends_at, status, hero_content, visual_theme, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING ${COLUMNS}`,
        [
          input.name,
          input.slug,
          input.description ?? null,
          input.startsAt ?? null,
          input.endsAt ?? null,
          input.status ?? 'ACTIVE',
          input.heroContent === undefined ? null : JSON.stringify(input.heroContent),
          input.visualTheme === undefined ? null : JSON.stringify(input.visualTheme),
          input.createdBy,
        ],
      );
      return toRecord(rows[0]!);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

export type UpdateCampaignInput = {
  name?: string;
  slug?: string;
  description?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  status?: CmsStatus;
  heroContent?: unknown;
  visualTheme?: unknown;
  updatedBy: string;
};

export async function update(id: string, input: UpdateCampaignInput, db?: Db): Promise<CampaignRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];

  const assign = (column: string, value: unknown): void => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (input.name !== undefined) assign('name', input.name);
  if (input.slug !== undefined) assign('slug', input.slug);
  if (input.description !== undefined) assign('description', input.description);
  if (input.startsAt !== undefined) assign('starts_at', input.startsAt);
  if (input.endsAt !== undefined) assign('ends_at', input.endsAt);
  if (input.status !== undefined) assign('status', input.status);
  if (input.heroContent !== undefined) assign('hero_content', input.heroContent === null ? null : JSON.stringify(input.heroContent));
  if (input.visualTheme !== undefined) assign('visual_theme', input.visualTheme === null ? null : JSON.stringify(input.visualTheme));
  assign('updated_by', input.updatedBy);

  return run(db, async (client) => {
    try {
      const { rows } = await client.query<CampaignRow>(
        `UPDATE campaigns SET ${sets.join(', ')}, updated_at = now()
          WHERE id = $1
          RETURNING ${COLUMNS}`,
        values,
      );
      return rows[0] ? toRecord(rows[0]) : null;
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/** Sections referencing this campaign have `campaign_id` set NULL by the FK's `ON DELETE SET NULL` — they are never deleted alongside it. */
export async function remove(id: string, db?: Db): Promise<void> {
  return run(db, async (client) => {
    await client.query(`DELETE FROM campaigns WHERE id = $1`, [id]);
  });
}

export async function countLinkedSections(campaignId: string, db?: Db): Promise<number> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM homepage_sections WHERE campaign_id = $1`, [
      campaignId,
    ]);
    return Number(rows[0]!.count);
  });
}
