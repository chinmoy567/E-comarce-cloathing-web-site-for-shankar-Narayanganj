import Image from 'next/image';
import type { HomepageSectionResponse } from '@/lib/publicTypes';
import { CtaLink } from './CtaLink';

const OVERLAY_POSITION_CLASS: Record<string, string> = {
  left: 'md:left-lg md:items-start md:text-left',
  center: 'md:left-1/2 md:-translate-x-1/2 md:items-center md:text-center',
  right: 'md:right-lg md:items-end md:text-right',
};

/**
 * HERO section (13-homepage-cms §13.3, §13.4, §13.11). A section with no
 * title/subtitle/CTA renders without that element. Desktop/mobile images fall
 * back to whichever one is supplied. Text sits below the image on mobile and
 * over it from `md` in a solid panel (no gradient scrim). A linked campaign's
 * `heroContent` overrides the section's own fields (spec 17).
 *
 * `asH1` marks the page's single `<h1>` — the first hero with a title.
 */
export function HeroSection({
  section,
  priority = false,
  asH1 = false,
}: {
  section: HomepageSectionResponse;
  priority?: boolean;
  asH1?: boolean;
}) {
  const override = section.campaign?.heroContent ?? null;
  const title = override?.title ?? section.title;
  const subtitle = override?.subtitle ?? section.subtitle;
  const ctaLabel = override?.ctaLabel ?? section.ctaLabel;
  const ctaUrl = override?.ctaUrl ?? section.ctaUrl;
  const secondaryCtaLabel = override?.secondaryCtaLabel ?? section.secondaryCtaLabel;
  const secondaryCtaUrl = override?.secondaryCtaUrl ?? section.secondaryCtaUrl;
  const desktopImage = override?.desktopImageUrl ?? section.desktopImageUrl ?? override?.mobileImageUrl ?? section.mobileImageUrl;
  const mobileImage = override?.mobileImageUrl ?? section.mobileImageUrl ?? override?.desktopImageUrl ?? section.desktopImageUrl;

  const overlay = (section.contentConfig as { overlayPosition?: string } | null)?.overlayPosition ?? 'left';
  const hasImage = Boolean(desktopImage || mobileImage);
  const Heading = asH1 ? 'h1' : 'h2';
  const hasPrimaryCta = Boolean(ctaLabel && ctaUrl);
  const hasSecondaryCta = Boolean(secondaryCtaLabel && secondaryCtaUrl);
  const hasText = Boolean(title || subtitle || hasPrimaryCta || hasSecondaryCta);
  const panelClass = hasImage
    ? `md:absolute md:top-1/2 md:max-w-[480px] md:-translate-y-1/2 md:rounded-lg md:bg-background ${OVERLAY_POSITION_CLASS[overlay] ?? OVERLAY_POSITION_CLASS.left}`
    : '';

  return (
    <section className="relative overflow-hidden rounded-lg bg-surface">
      {hasImage && (
        <div className="relative aspect-[16/9] w-full md:aspect-[21/9]">
          {mobileImage && <Image src={mobileImage} alt="" fill sizes="100vw" priority={priority} className="object-cover md:hidden" />}
          {desktopImage && (
            <Image src={desktopImage} alt="" fill sizes="100vw" priority={priority} className="hidden object-cover md:block" />
          )}
        </div>
      )}

      {hasText && (
        <div className={`flex flex-col gap-sm p-lg md:p-2xl ${panelClass}`}>
          {title && <Heading className="text-[28px] font-bold leading-tight md:text-[36px]">{title}</Heading>}
          {subtitle && <p className="text-base leading-relaxed text-text-secondary">{subtitle}</p>}

          {(hasPrimaryCta || hasSecondaryCta) && (
            <div className="mt-sm flex flex-col gap-sm md:flex-row">
              {hasPrimaryCta && (
                <CtaLink
                  href={ctaUrl!}
                  className="flex h-12 items-center justify-center rounded-lg bg-primary px-xl text-sm font-bold text-white transition-colors duration-200 hover:bg-primary-hover active:bg-primary-active"
                >
                  {ctaLabel}
                </CtaLink>
              )}
              {hasSecondaryCta && (
                <CtaLink
                  href={secondaryCtaUrl!}
                  className="flex h-12 items-center justify-center rounded-lg border-2 border-primary bg-background px-xl text-sm font-bold text-primary transition-colors duration-200 hover:bg-surface"
                >
                  {secondaryCtaLabel}
                </CtaLink>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
