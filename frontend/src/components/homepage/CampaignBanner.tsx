import Image from 'next/image';
import Link from 'next/link';
import type { HomepageSectionResponse } from '@/lib/publicTypes';

const ACCENT_CLASS: Record<string, string> = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  accent: 'bg-accent',
};

/**
 * CAMPAIGN_BANNER section (13-homepage-cms §13.3, §13.7, plan §6). Content
 * comes entirely from the linked `campaign` — no `<EidBanner/>`-style
 * per-campaign component exists (§13.9); a `visual_theme.accentColor`
 * restricted to the design system's own tokens is used for a thin accent bar
 * only, never arbitrary CSS (§13.13).
 */
export function CampaignBanner({ section }: { section: HomepageSectionResponse }) {
  const campaign = section.campaign;
  if (!campaign) return null;

  const accentColor = campaign.visualTheme?.accentColor;

  return (
    <section className="relative overflow-hidden rounded-lg border border-border bg-surface">
      {accentColor && <div className={`h-1 w-full ${ACCENT_CLASS[accentColor] ?? ''}`} />}

      {(section.desktopImageUrl || section.mobileImageUrl) && (
        <div className="relative aspect-[16/9] w-full">
          <Image
            src={section.mobileImageUrl ?? section.desktopImageUrl!}
            alt={campaign.name}
            fill
            className="object-cover sm:hidden"
          />
          <Image
            src={section.desktopImageUrl ?? section.mobileImageUrl!}
            alt={campaign.name}
            fill
            className="hidden object-cover sm:block"
          />
        </div>
      )}

      <div className="flex flex-col gap-xs p-lg">
        <h2 className="text-xl font-semibold md:text-[28px]">{section.title ?? campaign.name}</h2>
        {section.subtitle && <p className="text-text-secondary text-sm">{section.subtitle}</p>}
        {section.ctaLabel && section.ctaUrl && (
          <Link
            href={section.ctaUrl}
            className="mt-sm inline-flex h-11 w-fit items-center justify-center rounded-lg bg-primary px-lg text-sm font-bold text-white hover:bg-primary-hover"
          >
            {section.ctaLabel}
          </Link>
        )}
      </div>
    </section>
  );
}
