import { withTransaction } from '../../lib/transaction.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { sanitizeHtml } from '../../lib/sanitizeHtml.js';
import * as homepageSectionsRepository from '../../repositories/homepageSections.repository.js';
import * as homepageSectionProductsRepository from '../../repositories/homepageSectionProducts.repository.js';
import * as homepageSectionCategoriesRepository from '../../repositories/homepageSectionCategories.repository.js';
import * as auditRepository from '../../repositories/audit.repository.js';
import { contentConfigSchemaFor } from './contentConfig.schemas.js';
import { computeVisibility } from './visibility.js';
import type { PaginationQuery } from '../../lib/pagination.js';
import type { SectionType } from '../../types/homepageCms.js';
import type { HomepageSectionRecord } from '../../repositories/homepageSections.repository.js';
import type {
  CreateSectionRequest,
  UpdateSectionRequest,
} from '../../validation/homepageCms.validation.js';

/**
 * Admin homepage-section CRUD, atomic reorder, and atomic product/category
 * attachment (13-homepage-cms §13.4, §13.6, §13.12, plan §3.5). Every
 * mutation runs inside `withTransaction` so the change and its `audit_logs`
 * row commit together (§5.15 rule 10).
 */

export type Actor = { userId: string; role: 'ADMIN' | 'MANAGER' };

export type SectionResponse = {
  id: string;
  sectionType: SectionType;
  title: string | null;
  subtitle: string | null;
  displayOrder: number;
  status: 'DRAFT' | 'ACTIVE' | 'DISABLED';
  displayStatus: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  secondaryCtaLabel: string | null;
  secondaryCtaUrl: string | null;
  desktopImageUrl: string | null;
  mobileImageUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  campaignId: string | null;
  contentConfig: unknown;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

function toResponse(record: HomepageSectionRecord, now: Date = new Date()): SectionResponse {
  const { displayStatus } = computeVisibility(
    { status: record.status, startsAt: record.startsAt, endsAt: record.endsAt },
    now,
  );
  return {
    id: record.id,
    sectionType: record.sectionType,
    title: record.title,
    subtitle: record.subtitle,
    displayOrder: record.displayOrder,
    status: record.status,
    displayStatus,
    ctaLabel: record.ctaLabel,
    ctaUrl: record.ctaUrl,
    secondaryCtaLabel: record.secondaryCtaLabel,
    secondaryCtaUrl: record.secondaryCtaUrl,
    desktopImageUrl: record.desktopImageUrl,
    mobileImageUrl: record.mobileImageUrl,
    startsAt: record.startsAt ? record.startsAt.toISOString() : null,
    endsAt: record.endsAt ? record.endsAt.toISOString() : null,
    campaignId: record.campaignId,
    contentConfig: record.contentConfig,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Validates `contentConfig` against the schema for `sectionType`, and cross-field rules a single-type schema can't express (§13.3). Returns the parsed (and for CUSTOM_CONTENT, sanitized) value. */
function validateContentConfig(sectionType: SectionType, contentConfig: unknown, campaignId: string | null | undefined): unknown {
  const schema = contentConfigSchemaFor(sectionType);
  const result = schema.safeParse(contentConfig ?? {});
  if (!result.success) {
    throw new ValidationError(
      'The content configuration is invalid for this section type.',
      result.error.issues.map((issue) => ({ field: issue.path.join('.') || '(root)', message: issue.message })),
    );
  }

  if (sectionType === 'CAMPAIGN_BANNER' && !campaignId) {
    throw new ValidationError('A CAMPAIGN_BANNER section requires a linked campaign.', [
      { field: 'campaignId', message: 'Required for CAMPAIGN_BANNER sections.' },
    ]);
  }

  if (sectionType === 'CUSTOM_CONTENT') {
    const parsed = result.data as { body: string };
    return { body: sanitizeHtml(parsed.body) };
  }

  return result.data;
}

export async function listSections(pagination: PaginationQuery): Promise<{ items: SectionResponse[]; total: number }> {
  const { items, total } = await homepageSectionsRepository.list(pagination);
  const now = new Date();
  return { items: items.map((r) => toResponse(r, now)), total };
}

export async function getSection(id: string): Promise<SectionResponse> {
  const record = await homepageSectionsRepository.findById(id);
  if (!record) throw new NotFoundError('Section not found.');
  return toResponse(record);
}

export async function createSection(actor: Actor, input: CreateSectionRequest): Promise<SectionResponse> {
  const contentConfig = validateContentConfig(input.sectionType, input.contentConfig, input.campaignId);

  return withTransaction(async (client) => {
    const displayOrder = await homepageSectionsRepository.nextDisplayOrder(client);

    const created = await homepageSectionsRepository.create(
      {
        sectionType: input.sectionType,
        title: input.title ?? null,
        subtitle: input.subtitle ?? null,
        status: input.status ?? 'DRAFT',
        ctaLabel: input.ctaLabel ?? null,
        ctaUrl: input.ctaUrl ?? null,
        secondaryCtaLabel: input.secondaryCtaLabel ?? null,
        secondaryCtaUrl: input.secondaryCtaUrl ?? null,
        desktopImageUrl: input.desktopImageUrl ?? null,
        mobileImageUrl: input.mobileImageUrl ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        campaignId: input.campaignId ?? null,
        contentConfig,
        displayOrder,
        createdBy: actor.userId,
      },
      client,
    );

    await auditRepository.append(
      {
        entityType: 'homepage_section',
        entityId: created.id,
        action: 'homepage_section_created',
        newValue: { sectionType: created.sectionType, status: created.status },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    return toResponse(created);
  });
}

export async function updateSection(actor: Actor, id: string, input: UpdateSectionRequest): Promise<SectionResponse> {
  return withTransaction(async (client) => {
    const existing = await homepageSectionsRepository.findById(id, client);
    if (!existing) throw new NotFoundError('Section not found.');

    const campaignId = input.campaignId !== undefined ? input.campaignId : existing.campaignId;
    const contentConfig =
      input.contentConfig !== undefined ? validateContentConfig(existing.sectionType, input.contentConfig, campaignId) : undefined;

    if (existing.sectionType === 'CAMPAIGN_BANNER' && campaignId === null) {
      throw new ValidationError('A CAMPAIGN_BANNER section requires a linked campaign.', [
        { field: 'campaignId', message: 'Required for CAMPAIGN_BANNER sections.' },
      ]);
    }

    const previousValue = { status: existing.status, displayOrder: existing.displayOrder };

    const updated = await homepageSectionsRepository.update(
      id,
      {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.ctaLabel !== undefined ? { ctaLabel: input.ctaLabel } : {}),
        ...(input.ctaUrl !== undefined ? { ctaUrl: input.ctaUrl } : {}),
        ...(input.secondaryCtaLabel !== undefined ? { secondaryCtaLabel: input.secondaryCtaLabel } : {}),
        ...(input.secondaryCtaUrl !== undefined ? { secondaryCtaUrl: input.secondaryCtaUrl } : {}),
        ...(input.desktopImageUrl !== undefined ? { desktopImageUrl: input.desktopImageUrl } : {}),
        ...(input.mobileImageUrl !== undefined ? { mobileImageUrl: input.mobileImageUrl } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
        ...(input.campaignId !== undefined ? { campaignId: input.campaignId } : {}),
        ...(contentConfig !== undefined ? { contentConfig } : {}),
        updatedBy: actor.userId,
      },
      client,
    );
    if (!updated) throw new NotFoundError('Section not found.');

    await auditRepository.append(
      {
        entityType: 'homepage_section',
        entityId: id,
        action: 'homepage_section_updated',
        previousValue,
        newValue: { status: updated.status, displayOrder: updated.displayOrder },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );

    return toResponse(updated);
  });
}

export async function deleteSection(actor: Actor, id: string): Promise<void> {
  return withTransaction(async (client) => {
    const existing = await homepageSectionsRepository.findById(id, client);
    if (!existing) throw new NotFoundError('Section not found.');

    await homepageSectionsRepository.remove(id, client);

    await auditRepository.append(
      {
        entityType: 'homepage_section',
        entityId: id,
        action: 'homepage_section_deleted',
        previousValue: { sectionType: existing.sectionType },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );
  });
}

/**
 * Atomic reorder (§13.12): the full ordered set applied in one transaction.
 * A list that does not exactly match the existing section set is rejected —
 * a stale client cannot silently drop a section.
 */
export async function reorderSections(actor: Actor, sectionIds: string[]): Promise<void> {
  return withTransaction(async (client) => {
    const currentIds = await homepageSectionsRepository.listAllIdsForUpdate(client);

    const currentSet = new Set(currentIds);
    const requestedSet = new Set(sectionIds);
    const sameSize = currentSet.size === requestedSet.size && sectionIds.length === requestedSet.size;
    const sameMembers = sameSize && [...currentSet].every((id) => requestedSet.has(id));

    if (!sameMembers) {
      throw new ValidationError('The reorder list must contain exactly the current set of sections, with no duplicates.', [
        { field: 'sectionIds', message: 'Must exactly match the current set of section ids.' },
      ]);
    }

    await homepageSectionsRepository.applyOrder(sectionIds, actor.userId, client);

    await auditRepository.append(
      {
        entityType: 'homepage_section',
        entityId: null,
        action: 'homepage_sections_reordered',
        newValue: { order: sectionIds },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );
  });
}

export async function replaceSectionProducts(actor: Actor, sectionId: string, productIds: string[]): Promise<void> {
  return withTransaction(async (client) => {
    const existing = await homepageSectionsRepository.findById(sectionId, client);
    if (!existing) throw new NotFoundError('Section not found.');

    await homepageSectionProductsRepository.replaceAll(sectionId, productIds, client);

    await auditRepository.append(
      {
        entityType: 'homepage_section',
        entityId: sectionId,
        action: 'homepage_section_products_replaced',
        newValue: { productIds },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );
  });
}

export async function replaceSectionCategories(actor: Actor, sectionId: string, categoryIds: string[]): Promise<void> {
  return withTransaction(async (client) => {
    const existing = await homepageSectionsRepository.findById(sectionId, client);
    if (!existing) throw new NotFoundError('Section not found.');

    await homepageSectionCategoriesRepository.replaceAll(sectionId, categoryIds, client);

    await auditRepository.append(
      {
        entityType: 'homepage_section',
        entityId: sectionId,
        action: 'homepage_section_categories_replaced',
        newValue: { categoryIds },
        actorUserId: actor.userId,
        actorType: 'USER',
      },
      client,
    );
  });
}
