import Image from 'next/image';
import type { HomepageSectionResponse } from '@/lib/publicTypes';
import { CtaLink } from './CtaLink';

/**
 * PROMO_BANNER section (13-homepage-cms §13.3). Only ever links to an
 * existing category/coupon/URL via `ctaUrl` — never computes a discount
 * itself (§13.1, §13.17: no second discount engine). A coupon code is shown
 * as plain text, a reference only.
 */
export function PromoBanner({ section }: { section: HomepageSectionResponse }) {
  const desktopImage = section.desktopImageUrl ?? section.mobileImageUrl;
  const mobileImage = section.mobileImageUrl ?? section.desktopImageUrl;
  const couponCode = (section.contentConfig as { couponCode?: string } | null)?.couponCode;

  const content = (
    <>
      {(desktopImage || mobileImage) && (
        <div className="relative aspect-[2/1] w-full overflow-hidden rounded-lg md:aspect-[3/1]">
          {mobileImage && <Image src={mobileImage} alt="" fill sizes="100vw" className="object-cover md:hidden" />}
          {desktopImage && <Image src={desktopImage} alt="" fill sizes="100vw" className="hidden object-cover md:block" />}
        </div>
      )}
      {(section.title || section.subtitle || couponCode) && (
        <div className="flex flex-col gap-xs p-lg">
          {section.title && <h2 className="text-xl font-bold tracking-tight md:text-[28px]">{section.title}</h2>}
          {section.subtitle && <p className="text-sm text-text-secondary">{section.subtitle}</p>}
          {couponCode && <p className="text-sm font-semibold text-text-primary">Use code {couponCode}</p>}
        </div>
      )}
    </>
  );

  const className = 'flex flex-col overflow-hidden rounded-lg border border-border bg-surface';

  if (section.ctaUrl) {
    const link = (
      <CtaLink href={section.ctaUrl} className={`${className} hover:border-primary`}>
        {content}
      </CtaLink>
    );
    // CtaLink renders nothing for an unsafe URL; fall back to a static block.
    if (section.ctaUrl.startsWith('/') || section.ctaUrl.startsWith('https://')) return link;
  }

  return <section className={className}>{content}</section>;
}
