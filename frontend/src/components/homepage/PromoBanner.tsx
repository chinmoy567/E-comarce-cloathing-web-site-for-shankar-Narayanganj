import Image from 'next/image';
import Link from 'next/link';
import type { HomepageSectionResponse } from '@/lib/publicTypes';

/**
 * PROMO_BANNER section (13-homepage-cms §13.3, plan §6). Only ever links to
 * an existing category/coupon/URL — never computes a discount itself (§13.1,
 * §13.17: no second discount engine).
 */
export function PromoBanner({ section }: { section: HomepageSectionResponse }) {
  const image = section.desktopImageUrl ?? section.mobileImageUrl;

  const content = (
    <>
      {image && (
        <div className="relative aspect-[3/1] w-full overflow-hidden rounded-lg">
          <Image src={image} alt={section.title ?? ''} fill className="object-cover" />
        </div>
      )}
      {(section.title || section.subtitle) && (
        <div className="flex flex-col gap-xs p-lg">
          {section.title && <h2 className="text-xl font-semibold md:text-[28px]">{section.title}</h2>}
          {section.subtitle && <p className="text-text-secondary text-sm">{section.subtitle}</p>}
        </div>
      )}
    </>
  );

  const className = 'flex flex-col overflow-hidden rounded-lg border border-border bg-surface';

  if (section.ctaUrl) {
    return (
      <Link href={section.ctaUrl} className={`${className} hover:border-primary`}>
        {content}
      </Link>
    );
  }

  return <section className={className}>{content}</section>;
}
