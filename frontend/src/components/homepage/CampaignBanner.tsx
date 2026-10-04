import Image from 'next/image';
import type { HomepageSectionResponse } from '@/lib/publicTypes';
import { CtaLink } from './CtaLink';

// Fixed token classes only — a theme never injects raw colours or CSS (§13.13).
const ACCENT_BORDER: Record<string, string> = {
  PRIMARY: 'border-primary',
  DARK: 'border-text-primary',
  ACCENT: 'border-accent',
};

/**
 * CAMPAIGN_BANNER section (13-homepage-cms §13.3, §13.7). Content comes from
 * the linked `campaign`; no per-campaign component exists (§13.9). The
 * campaign's `visualTheme` maps to existing token classes only, and its
 * `heroContent` overrides the section's own fields.
 */
export function CampaignBanner({ section }: { section: HomepageSectionResponse }) {
  const campaign = section.campaign;
  if (!campaign) return null;

  const hero = campaign.heroContent;
  const title = hero?.title ?? section.title ?? campaign.name;
  const subtitle = hero?.subtitle ?? section.subtitle;
  const ctaLabel = hero?.ctaLabel ?? section.ctaLabel;
  const ctaUrl = hero?.ctaUrl ?? section.ctaUrl;
  const desktopImage = hero?.desktopImageUrl ?? section.desktopImageUrl ?? hero?.mobileImageUrl ?? section.mobileImageUrl;
  const mobileImage = hero?.mobileImageUrl ?? section.mobileImageUrl ?? hero?.desktopImageUrl ?? section.desktopImageUrl;

  const theme = campaign.visualTheme;
  const border =
    theme?.treatment === 'BORDERED' ? `border-2 ${ACCENT_BORDER[theme.accent ?? 'PRIMARY'] ?? 'border-primary'}` : 'border border-border';

  return (
    <section className={`relative overflow-hidden rounded-lg bg-surface ${border}`}>
      {(desktopImage || mobileImage) && (
        <div className="relative aspect-[16/9] w-full">
          {mobileImage && <Image src={mobileImage} alt="" fill sizes="100vw" className="object-cover md:hidden" />}
          {desktopImage && <Image src={desktopImage} alt="" fill sizes="100vw" className="hidden object-cover md:block" />}
        </div>
      )}

      <div className="flex flex-col gap-xs p-lg">
        <h2 className="text-xl font-bold tracking-tight md:text-[28px]">{title}</h2>
        {subtitle && <p className="text-sm text-text-secondary">{subtitle}</p>}
        {ctaLabel && ctaUrl && (
          <CtaLink
            href={ctaUrl}
            className="mt-sm inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary px-lg text-sm font-bold text-white hover:bg-primary-hover md:w-fit"
          >
            {ctaLabel}
          </CtaLink>
        )}
      </div>
    </section>
  );
}
