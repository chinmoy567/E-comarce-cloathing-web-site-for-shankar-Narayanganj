import { withTransaction } from '../../lib/transaction.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import * as campaignsRepository from '../../repositories/campaigns.repository.js';
import * as campaignProductsRepository from '../../repositories/campaignProducts.repository.js';
import * as campaignCategoriesRepository from '../../repositories/campaignCategories.repository.js';
import * as auditRepository from '../../repositories/audit.repository.js';
import { computeVisibility } from './visibility.js';
import { heroContentSchema } from './contentConfig.schemas.js';
import type { PaginationQuery } from '../../lib/pagination.js';
import type { CampaignRecord } from '../../repositories/campaigns.repository.js';
import type { CreateCampaignRequest, UpdateCampaignRequest } from '../../validation/homepageCms.validation.js';

/** Admin campaign CRUD and atomic product/category attachment (13-homepage-cms §13.7, §13.6a, plan §3). */

export type Actor = { userId: string; role: 'ADMIN' | 'MANAGER' };

export type CampaignResponse = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'DISABLED';
  displayStatus: string;
  heroContent: unknown;
  visualTheme: unknown;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignDetailResponse = CampaignResponse & { linkedSectionCount: number };

function toResponse(record: CampaignRecord, now: Date = new Date()): CampaignResponse {
  const { displayStatus } = computeVisibility({ status: record.status, startsAt: record.startsAt, endsAt: record.endsAt }, now);
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    description: record.description,
    startsAt: record.startsAt ? record.startsAt.toISOString() : null,
    endsAt: record.endsAt ? record.endsAt.toISOString() : null,
    status: record.status,
    displayStatus,
    heroContent: record.heroContent,
    visualTheme: record.visualTheme,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** §13.7's `hero_content` holds the same optional fields a HERO section's common fields use (plan §3.9 item 3). */
function validateHeroContent(heroContent: unknown): unknown {
  if (heroContent === undefined) return undefined;
  if (heroContent === null) return null;
  const result = heroContentSchema.safeParse(heroContent);
  if (!result.success) {
    throw new ValidationError(
      'The hero content is invalid.',
      result.error.issues.map((issue) => ({ field: issue.path.join('.') || '(root)', message: issue.message })),
    );
  }
  return result.data;
}

export async function listCampaigns(pagination: PaginationQuery): Promise<{ items: CampaignResponse[]; total: number }> {
  const { items, total } = await campaignsRepository.list(pagination);
  const now = new Date();
  return { items: items.map((r) => toResponse(r, now)), total };
}

export async function getCampaign(id: string): Promise<CampaignDetailResponse> {
  const record = await campaignsRepository.findById(id);
  if (!record) throw new NotFoundError('Campaign not found.');
  const linkedSectionCount = await campaignsRepository.countLinkedSections(id);
  return { ...toResponse(record), linkedSectionCount };
}

export async function createCampaign(actor: Actor, input: CreateCampaignRequest): Promise<CampaignResponse> {
  const heroContent = validateHeroContent(input.heroContent);

  if (input.startsAt && input.endsAt && input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw new ValidationError('The campaign fields are invalid.', [{ field: 'endsAt', message: 'Must be after the start date/time.' }]);
  }

  return withTransaction(async (client) => {
    const created = await campaignsRepository.create(
      {
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        status: input.status ?? 'ACTIVE',
        heroContent,
        visualTheme: input.visualTheme,
        createdBy: actor.userId,
      },
      client,
    );

    await auditRepository.append(
      {
        entityType: 'campaign',
        entityId: created.id,
        action: 'campaign_created',
        newValue: { slug: created.slug, status: created.status },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    return toResponse(created);
  });
}

export async function updateCampaign(actor: Actor, id: string, input: UpdateCampaignRequest): Promise<CampaignResponse> {
  return withTransaction(async (client) => {
    const existing = await campaignsRepository.findById(id, client);
    if (!existing) throw new NotFoundError('Campaign not found.');

    const heroContent = input.heroContent !== undefined ? validateHeroContent(input.heroContent) : undefined;

    const startsAt = input.startsAt !== undefined ? input.startsAt : existing.startsAt;
    const endsAt = input.endsAt !== undefined ? input.endsAt : existing.endsAt;
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw new ValidationError('The campaign fields are invalid.', [{ field: 'endsAt', message: 'Must be after the start date/time.' }]);
    }

    const previousValue = { status: existing.status };

    const updated = await campaignsRepository.update(
      id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(heroContent !== undefined ? { heroContent } : {}),
        ...(input.visualTheme !== undefined ? { visualTheme: input.visualTheme } : {}),
        updatedBy: actor.userId,
      },
      client,
    );
    if (!updated) throw new NotFoundError('Campaign not found.');

    await auditRepository.append(
      {
        entityType: 'campaign',
        entityId: id,
        action: 'campaign_updated',
        previousValue,
        newValue: { status: updated.status },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    return toResponse(updated);
  });
}

/** Linked sections' `campaign_id` are set NULL by the FK, never deleted alongside the campaign (§13.4). */
export async function deleteCampaign(actor: Actor, id: string): Promise<void> {
  return withTransaction(async (client) => {
    const existing = await campaignsRepository.findById(id, client);
    if (!existing) throw new NotFoundError('Campaign not found.');

    await campaignsRepository.remove(id, client);

    await auditRepository.append(
      {
        entityType: 'campaign',
        entityId: id,
        action: 'campaign_deleted',
        previousValue: { slug: existing.slug },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );
  });
}

export async function replaceCampaignProducts(actor: Actor, campaignId: string, productIds: string[]): Promise<void> {
  return withTransaction(async (client) => {
    const existing = await campaignsRepository.findById(campaignId, client);
    if (!existing) throw new NotFoundError('Campaign not found.');

    await campaignProductsRepository.replaceAll(campaignId, productIds, client);

    await auditRepository.append(
      {
        entityType: 'campaign',
        entityId: campaignId,
        action: 'campaign_products_replaced',
        newValue: { productIds },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );
  });
}

export async function replaceCampaignCategories(actor: Actor, campaignId: string, categoryIds: string[]): Promise<void> {
  return withTransaction(async (client) => {
    const existing = await campaignsRepository.findById(campaignId, client);
    if (!existing) throw new NotFoundError('Campaign not found.');

    await campaignCategoriesRepository.replaceAll(campaignId, categoryIds, client);

    await auditRepository.append(
      {
        entityType: 'campaign',
        entityId: campaignId,
        action: 'campaign_categories_replaced',
        newValue: { categoryIds },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );
  });
}
