import Image from 'next/image';
import Link from 'next/link';
import type { HomepageSectionResponse } from '@/lib/publicTypes';

/**
 * HERO section (13-homepage-cms §13.3, §13.4, plan §6). A section with no
 * title/subtitle/CTA renders without that element — no empty heading, no
 * broken button (§13.4). Desktop/mobile images fall back to whichever one is
 * supplied (§13.11).
 */
export function HeroSection({ section, priority = false }: { section: HomepageSectionResponse; priority?: boolean }) {
  const desktopImage = section.desktopImageUrl ?? section.mobileImageUrl;
  const mobileImage = section.mobileImageUrl ?? section.desktopImageUrl;

  return (
    <section className="relative overflow-hidden rounded-lg bg-surface">
      {(desktopImage || mobileImage) && (
        <div className="relative aspect-[16/9] w-full sm:aspect-[21/9]">
          {mobileImage && (
            <Image src={mobileImage} alt={section.title ?? ''} fill priority={priority} className="object-cover sm:hidden" />
          )}
          {desktopImage && (
            <Image src={desktopImage} alt={section.title ?? ''} fill priority={priority} className="hidden object-cover sm:block" />
          )}
        </div>
      )}

      {(section.title || section.subtitle || section.ctaLabel || section.secondaryCtaLabel) && (
        <div className="flex flex-col gap-sm p-lg">
          {section.title && <h1 className="text-[28px] font-bold leading-tight md:text-[36px]">{section.title}</h1>}
          {section.subtitle && <p className="text-base text-text-secondary">{section.subtitle}</p>}

          {(section.ctaLabel || section.secondaryCtaLabel) && (
            <div className="mt-sm flex flex-col gap-sm sm:flex-row">
              {section.ctaLabel && section.ctaUrl && (
                <Link
                  href={section.ctaUrl}
                  className="flex h-11 items-center justify-center rounded-lg bg-primary px-lg text-sm font-bold text-white hover:bg-primary-hover"
                >
                  {section.ctaLabel}
                </Link>
              )}
              {section.secondaryCtaLabel && section.secondaryCtaUrl && (
                <Link
                  href={section.secondaryCtaUrl}
                  className="flex h-11 items-center justify-center rounded-lg border-2 border-primary bg-background px-lg text-sm font-bold text-primary hover:bg-surface"
                >
                  {section.secondaryCtaLabel}
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
