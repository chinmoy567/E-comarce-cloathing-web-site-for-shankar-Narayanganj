import type { HomepageSectionResponse } from '@/lib/publicTypes';
import { HeroSection } from './HeroSection';
import { CategoryGrid } from './CategoryGrid';
import { ProductCarousel } from './ProductCarousel';
import { CampaignBanner } from './CampaignBanner';
import { PromoBanner } from './PromoBanner';
import { CustomContentBlock } from './CustomContentBlock';

/**
 * Dispatches on `sectionType` (13-homepage-cms §13.8, §13.9, plan §6). This
 * is the ONLY place that switches on section type — the homepage page itself
 * never assumes a fixed set/count of sections, so adding, removing, or
 * reordering a section in the Admin requires no frontend code change (§13.1).
 */
export function HomepageSection({ section, priority = false }: { section: HomepageSectionResponse; priority?: boolean }) {
  switch (section.sectionType) {
    case 'HERO':
      return <HeroSection section={section} priority={priority} />;
    case 'CATEGORY_GRID':
      return <CategoryGrid section={section} />;
    case 'PRODUCT_CAROUSEL':
      return <ProductCarousel section={section} />;
    case 'CAMPAIGN_BANNER':
      return <CampaignBanner section={section} />;
    case 'PROMO_BANNER':
      return <PromoBanner section={section} />;
    case 'CUSTOM_CONTENT':
      return <CustomContentBlock section={section} />;
  }
}
