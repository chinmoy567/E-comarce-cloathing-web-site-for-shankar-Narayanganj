import type pg from 'pg';
import { run } from '../../repositories/db.js';
import * as homepageSectionsRepository from '../../repositories/homepageSections.repository.js';
import * as campaignsRepository from '../../repositories/campaigns.repository.js';
import * as homepageSectionCategoriesRepository from '../../repositories/homepageSectionCategories.repository.js';
import * as campaignCategoriesRepository from '../../repositories/campaignCategories.repository.js';
import { computeVisibility, type VisibilityResult } from './visibility.js';
import { resolveAutomaticProducts, resolveManualProducts, type AutomaticRule } from './productResolution.js';
import { SITE_NAME } from '../../config/constants.js';
import type { HomepageSectionRecord } from '../../repositories/homepageSections.repository.js';
import type { CampaignRecord } from '../../repositories/campaigns.repository.js';
import type {
  HomepageResponse,
  HomepageSectionResponse,
  PublicCategorySummary,
  PreviewResponse,
  PreviewSectionResponse,
  DisplayStatus,
} from '../../types/homepageCms.js';

/**
 * Public homepage assembly (13-homepage-cms §13.8, §13.15, plan §3). Returns
 * every visible section, with resolved products/categories, in one call —
 * the frontend never issues N sequential per-section requests.
 *
 * `getPreview()` (below) reuses the same assembly with the DRAFT filter
 * removed and every entity annotated with its computed `displayStatus` — a
 * genuinely separate function, never a flag on this one, so unpublished
 * content cannot leak through a public-endpoint parameter (§13.12).
 */

type AssembledSection = {
  record: HomepageSectionRecord;
  visibility: VisibilityResult;
  campaign: CampaignRecord | null;
  campaignVisibility: VisibilityResult | null;
};

async function resolveCategories(
  mode: 'section' | 'campaign',
  parentId: string,
  contentConfig: unknown,
  client: pg.PoolClient,
): Promise<PublicCategorySummary[]> {
  const config = (contentConfig ?? {}) as { mode?: string };
  let categoryIds: string[];

  if (config.mode === 'MANUAL') {
    categoryIds =
      mode === 'section'
        ? await homepageSectionCategoriesRepository.listCategoryIds(parentId, client)
        : await campaignCategoriesRepository.listCategoryIds(parentId, client);
  } else {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM categories WHERE parent_id IS NULL AND status = 'ACTIVE' ORDER BY display_order ASC`,
    );
    categoryIds = rows.map((r) => r.id);
  }

  if (categoryIds.length === 0) return [];

  const { rows } = await client.query<{ id: string; name: string; slug: string; image_url: string | null }>(
    `SELECT id, name, slug, image_url FROM categories WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE'`,
    [categoryIds],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return categoryIds
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .map((r) => ({ id: r.id, name: r.name, slug: r.slug, imageUrl: r.image_url }));
}

async function assembleVisibleSections(now: Date, client: pg.PoolClient): Promise<AssembledSection[]> {
  const sections = await homepageSectionsRepository.listNonDraftOrdered(client);

  const campaignIds = [...new Set(sections.map((s) => s.campaignId).filter((id): id is string => id !== null))];
  const campaigns = await campaignsRepository.findByIds(campaignIds, client);
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));

  return sections.map((record) => {
    const visibility = computeVisibility({ status: record.status, startsAt: record.startsAt, endsAt: record.endsAt }, now);
    const campaign = record.campaignId ? (campaignById.get(record.campaignId) ?? null) : null;
    const campaignVisibility = campaign
      ? computeVisibility({ status: campaign.status, startsAt: campaign.startsAt, endsAt: campaign.endsAt }, now)
      : null;
    return { record, visibility, campaign, campaignVisibility };
  });
}

/** §13.4/§13.7a: a section linked to a campaign is visible only when both are visible — a section cannot outlive its ended campaign. */
function isEffectivelyVisible(assembled: AssembledSection): boolean {
  if (!assembled.visibility.visible) return false;
  if (assembled.campaign && !assembled.campaignVisibility?.visible) return false;
  return true;
}

async function buildSectionResponse(
  assembled: AssembledSection,
  client: pg.PoolClient,
): Promise<HomepageSectionResponse | null> {
  const { record, campaign } = assembled;

  let products: HomepageSectionResponse['products'];
  let categories: HomepageSectionResponse['categories'];

  if (record.sectionType === 'PRODUCT_CAROUSEL') {
    const config = (record.contentConfig ?? {}) as { mode?: string; rule?: AutomaticRule; limit?: number; categoryId?: string };
    products =
      config.mode === 'MANUAL'
        ? await resolveManualProducts(record.id, client)
        : await resolveAutomaticProducts({ rule: config.rule ?? 'LATEST', limit: config.limit ?? 12, categoryId: config.categoryId }, client);

    // §13.8: an empty carousel is omitted from the response entirely.
    if (products.length === 0) return null;
  }

  if (record.sectionType === 'CATEGORY_GRID') {
    categories = await resolveCategories('section', record.id, record.contentConfig, client);
  }

  return {
    id: record.id,
    sectionType: record.sectionType,
    title: record.title,
    subtitle: record.subtitle,
    ctaLabel: record.ctaLabel,
    ctaUrl: record.ctaUrl,
    secondaryCtaLabel: record.secondaryCtaLabel,
    secondaryCtaUrl: record.secondaryCtaUrl,
    desktopImageUrl: record.desktopImageUrl,
    mobileImageUrl: record.mobileImageUrl,
    campaign: campaign ? { name: campaign.name, slug: campaign.slug, visualTheme: campaign.visualTheme, heroContent: campaign.heroContent } : null,
    contentConfig: record.contentConfig,
    ...(products !== undefined ? { products } : {}),
    ...(categories !== undefined ? { categories } : {}),
  };
}

/**
 * §13.15: metadata comes from the visible campaign with `hero_content` linked
 * to the lowest-`display_order` visible section — a deterministic tie-break
 * for the (undocumented in the PRD) case of several simultaneous campaigns.
 */
function buildMetadata(
  assembledInOrder: AssembledSection[],
): HomepageResponse['metadata'] {
  for (const assembled of assembledInOrder) {
    if (!isEffectivelyVisible(assembled)) continue;
    const campaign = assembled.campaign;
    if (!campaign || !campaign.heroContent) continue;
    const hero = campaign.heroContent as { title?: string; subtitle?: string };
    return {
      title: hero.title ?? null,
      description: hero.subtitle ?? null,
      ogImageUrl: null,
    };
  }
  return null;
}

export async function getHomepage(now: Date = new Date()): Promise<HomepageResponse> {
  return run(undefined, async (client) => {
    const assembled = await assembleVisibleSections(now, client);
    const visible = assembled.filter(isEffectivelyVisible);

    const sections: HomepageSectionResponse[] = [];
    for (const item of visible) {
      const response = await buildSectionResponse(item, client);
      if (response) sections.push(response);
    }

    const metadata = buildMetadata(visible) ?? { title: SITE_NAME, description: null, ogImageUrl: null };

    return { sections, metadata };
  });
}

/**
 * §13.12: includes DRAFT/SCHEDULED/DISABLED content, each annotated with its
 * computed `displayStatus`. A genuinely separate function from `getHomepage`
 * — never a flag/param on the public route.
 */
export async function getPreview(now: Date = new Date()): Promise<PreviewResponse> {
  return run(undefined, async (client) => {
    const sections = await homepageSectionsRepository.listAllOrdered(client);

    const campaignIds = [...new Set(sections.map((s) => s.campaignId).filter((id): id is string => id !== null))];
    const campaigns = await campaignsRepository.findByIds(campaignIds, client);
    const campaignById = new Map(campaigns.map((c) => [c.id, c]));

    const result: PreviewSectionResponse[] = [];
    for (const record of sections) {
      const visibility = computeVisibility({ status: record.status, startsAt: record.startsAt, endsAt: record.endsAt }, now);
      const campaign = record.campaignId ? (campaignById.get(record.campaignId) ?? null) : null;

      let displayStatus: DisplayStatus = visibility.displayStatus;
      if (campaign) {
        const campaignVisibility = computeVisibility(
          { status: campaign.status, startsAt: campaign.startsAt, endsAt: campaign.endsAt },
          now,
        );
        if (visibility.displayStatus === 'ACTIVE' && !campaignVisibility.visible) {
          displayStatus = campaignVisibility.displayStatus;
        }
      }

      let products: HomepageSectionResponse['products'];
      let categories: HomepageSectionResponse['categories'];
      if (record.sectionType === 'PRODUCT_CAROUSEL') {
        const config = (record.contentConfig ?? {}) as { mode?: string; rule?: AutomaticRule; limit?: number; categoryId?: string };
        products =
          config.mode === 'MANUAL'
            ? await resolveManualProducts(record.id, client)
            : await resolveAutomaticProducts(
                { rule: config.rule ?? 'LATEST', limit: config.limit ?? 12, categoryId: config.categoryId },
                client,
              );
      }
      if (record.sectionType === 'CATEGORY_GRID') {
        categories = await resolveCategories('section', record.id, record.contentConfig, client);
      }

      result.push({
        id: record.id,
        sectionType: record.sectionType,
        title: record.title,
        subtitle: record.subtitle,
        ctaLabel: record.ctaLabel,
        ctaUrl: record.ctaUrl,
        secondaryCtaLabel: record.secondaryCtaLabel,
        secondaryCtaUrl: record.secondaryCtaUrl,
        desktopImageUrl: record.desktopImageUrl,
        mobileImageUrl: record.mobileImageUrl,
        campaign: campaign
          ? { name: campaign.name, slug: campaign.slug, visualTheme: campaign.visualTheme, heroContent: campaign.heroContent }
          : null,
        contentConfig: record.contentConfig,
        displayStatus,
        ...(products !== undefined ? { products } : {}),
        ...(categories !== undefined ? { categories } : {}),
      });
    }

    return { sections: result, metadata: null };
  });
}
