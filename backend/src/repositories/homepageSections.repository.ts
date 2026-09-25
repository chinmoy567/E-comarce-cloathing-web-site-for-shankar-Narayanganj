import type pg from 'pg';
import type { PaginationQuery } from '../lib/pagination.js';
import type { CmsStatus, SectionType } from '../types/homepageCms.js';
import { run, type Db } from './db.js';
import { toDomainError } from './pgErrors.js';

/** Homepage section CRUD and the atomic reorder primitive (13-homepage-cms §13.4, §13.12, plan §3). */

type HomepageSectionRow = {
  id: string;
  section_type: SectionType;
  title: string | null;
  subtitle: string | null;
  display_order: number;
  status: CmsStatus;
  cta_label: string | null;
  cta_url: string | null;
  secondary_cta_label: string | null;
  secondary_cta_url: string | null;
  desktop_image_url: string | null;
  mobile_image_url: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  campaign_id: string | null;
  content_config: unknown;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
};

export type HomepageSectionRecord = {
  id: string;
  sectionType: SectionType;
  title: string | null;
  subtitle: string | null;
  displayOrder: number;
  status: CmsStatus;
  ctaLabel: string | null;
  ctaUrl: string | null;
  secondaryCtaLabel: string | null;
  secondaryCtaUrl: string | null;
  desktopImageUrl: string | null;
  mobileImageUrl: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  campaignId: string | null;
  contentConfig: unknown;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const COLUMNS = `
  id, section_type, title, subtitle, display_order, status, cta_label, cta_url,
  secondary_cta_label, secondary_cta_url, desktop_image_url, mobile_image_url,
  starts_at, ends_at, campaign_id, content_config, created_by, updated_by,
  created_at, updated_at
`;

function toRecord(row: HomepageSectionRow): HomepageSectionRecord {
  return {
    id: row.id,
    sectionType: row.section_type,
    title: row.title,
    subtitle: row.subtitle,
    displayOrder: row.display_order,
    status: row.status,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    secondaryCtaLabel: row.secondary_cta_label,
    secondaryCtaUrl: row.secondary_cta_url,
    desktopImageUrl: row.desktop_image_url,
    mobileImageUrl: row.mobile_image_url,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    campaignId: row.campaign_id,
    contentConfig: row.content_config,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findById(id: string, db?: Db): Promise<HomepageSectionRecord | null> {
  return run(db, async (client) => {
    const { rows } = await client.query<HomepageSectionRow>(`SELECT ${COLUMNS} FROM homepage_sections WHERE id = $1`, [id]);
    return rows[0] ? toRecord(rows[0]) : null;
  });
}

export async function list(pagination: PaginationQuery, db?: Db): Promise<{ items: HomepageSectionRecord[]; total: number }> {
  const { page, pageSize } = pagination;
  return run(db, async (client) => {
    const { rows } = await client.query<HomepageSectionRow & { total: string }>(
      `SELECT ${COLUMNS}, count(*) OVER()::text AS total
         FROM homepage_sections
        ORDER BY display_order ASC
        LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize],
    );
    return { items: rows.map(toRecord), total: rows[0] ? Number(rows[0].total) : 0 };
  });
}

/** Non-DRAFT sections ordered for public/preview assembly — DRAFT is excluded here as a safe optimization; `computeVisibility` remains the source of truth for every row returned. */
export async function listNonDraftOrdered(db?: Db): Promise<HomepageSectionRecord[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<HomepageSectionRow>(
      `SELECT ${COLUMNS} FROM homepage_sections WHERE status <> 'DRAFT' ORDER BY display_order ASC`,
    );
    return rows.map(toRecord);
  });
}

/** Every section, in order, for preview (§13.12 — preview includes DRAFT). */
export async function listAllOrdered(db?: Db): Promise<HomepageSectionRecord[]> {
  return run(db, async (client) => {
    const { rows } = await client.query<HomepageSectionRow>(`SELECT ${COLUMNS} FROM homepage_sections ORDER BY display_order ASC`);
    return rows.map(toRecord);
  });
}

export type CreateHomepageSectionInput = {
  sectionType: SectionType;
  title?: string | null;
  subtitle?: string | null;
  status?: CmsStatus;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  secondaryCtaLabel?: string | null;
  secondaryCtaUrl?: string | null;
  desktopImageUrl?: string | null;
  mobileImageUrl?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  campaignId?: string | null;
  contentConfig: unknown;
  displayOrder: number;
  createdBy: string;
};

export async function create(input: CreateHomepageSectionInput, db?: Db): Promise<HomepageSectionRecord> {
  return run(db, async (client) => {
    try {
      const { rows } = await client.query<HomepageSectionRow>(
        `INSERT INTO homepage_sections (
           section_type, title, subtitle, display_order, status, cta_label, cta_url,
           secondary_cta_label, secondary_cta_url, desktop_image_url, mobile_image_url,
           starts_at, ends_at, campaign_id, content_config, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING ${COLUMNS}`,
        [
          input.sectionType,
          input.title ?? null,
          input.subtitle ?? null,
          input.displayOrder,
          input.status ?? 'DRAFT',
          input.ctaLabel ?? null,
          input.ctaUrl ?? null,
          input.secondaryCtaLabel ?? null,
          input.secondaryCtaUrl ?? null,
          input.desktopImageUrl ?? null,
          input.mobileImageUrl ?? null,
          input.startsAt ?? null,
          input.endsAt ?? null,
          input.campaignId ?? null,
          JSON.stringify(input.contentConfig),
          input.createdBy,
        ],
      );
      return toRecord(rows[0]!);
    } catch (err) {
      throw toDomainError(err);
    }
  });
}

/** Never accepts `sectionType` — its absence here is the immutability enforcement at the API/service layer; the database trigger backs it at the storage layer too. */
export type UpdateHomepageSectionInput = {
  title?: string | null;
  subtitle?: string | null;
  status?: CmsStatus;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  secondaryCtaLabel?: string | null;
  secondaryCtaUrl?: string | null;
  desktopImageUrl?: string | null;
  mobileImageUrl?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  campaignId?: string | null;
  contentConfig?: unknown;
  updatedBy: string;
};

export async function update(id: string, input: UpdateHomepageSectionInput, db?: Db): Promise<HomepageSectionRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];

  const assign = (column: string, value: unknown): void => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (input.title !== undefined) assign('title', input.title);
  if (input.subtitle !== undefined) assign('subtitle', input.subtitle);
  if (input.status !== undefined) assign('status', input.status);
  if (input.ctaLabel !== undefined) assign('cta_label', input.ctaLabel);
  if (input.ctaUrl !== undefined) assign('cta_url', input.ctaUrl);
  if (input.secondaryCtaLabel !== undefined) assign('secondary_cta_label', input.secondaryCtaLabel);
  if (input.secondaryCtaUrl !== undefined) assign('secondary_cta_url', input.secondaryCtaUrl);
  if (input.desktopImageUrl !== undefined) assign('desktop_image_url', input.desktopImageUrl);
  if (input.mobileImageUrl !== undefined) assign('mobile_image_url', input.mobileImageUrl);
  if (input.startsAt !== undefined) assign('starts_at', input.startsAt);
  if (input.endsAt !== undefined) assign('ends_at', input.endsAt);
  if (input.campaignId !== undefined) assign('campaign_id', input.campaignId);
  if (input.contentConfig !== undefined) assign('content_config', JSON.stringify(input.contentConfig));
  assign('updated_by', input.updatedBy);

  return run(db, async (client) => {
    try {
      const { rows } = await client.query<HomepageSectionRow>(
        `UPDATE homepage_sections SET ${sets.join(', ')}, updated_at = now()
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

export async function remove(id: string, db?: Db): Promise<void> {
  return run(db, async (client) => {
    await client.query(`DELETE FROM homepage_sections WHERE id = $1`, [id]);
  });
}

/** Locks every section row for the duration of the caller's transaction — the reorder/attach atomicity primitive (§13.12). Must run inside `withTransaction`. */
export async function listAllIdsForUpdate(client: pg.PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM homepage_sections ORDER BY display_order ASC FOR UPDATE`);
  return rows.map((r) => r.id);
}

/** Applies a dense `display_order` sequence matching `sectionIds`' order. Caller must have already validated the set equals the current set. Runs only inside a caller-managed transaction. */
export async function applyOrder(sectionIds: string[], updatedBy: string, client: pg.PoolClient): Promise<void> {
  for (let i = 0; i < sectionIds.length; i += 1) {
    await client.query(`UPDATE homepage_sections SET display_order = $2, updated_by = $3, updated_at = now() WHERE id = $1`, [
      sectionIds[i],
      i,
      updatedBy,
    ]);
  }
}

export async function nextDisplayOrder(db?: Db): Promise<number> {
  return run(db, async (client) => {
    const { rows } = await client.query<{ max: number | null }>(`SELECT max(display_order) AS max FROM homepage_sections`);
    return rows[0]?.max === null || rows[0]?.max === undefined ? 0 : rows[0].max + 1;
  });
}
