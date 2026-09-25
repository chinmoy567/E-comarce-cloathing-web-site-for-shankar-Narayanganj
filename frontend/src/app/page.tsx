import type { Metadata } from 'next';
import { fetchHomepage } from '@/lib/homepage';
import { HomepageSection } from '@/components/homepage/HomepageSection';
import { absoluteUrl, pageTitle, SITE_DESCRIPTION, SITE_OG_IMAGE_PATH } from '@/lib/site';

/**
 * CMS-driven homepage (13-homepage-cms §13.8, §13.15, plan §6). Replaces the
 * spec-01 placeholder health-check page — this repo has no built spec-07
 * storefront landing page to preserve, so nothing pre-existing is lost.
 *
 * ISR with a 60s revalidation window, matching the public API's own
 * `Cache-Control: max-age=60`, so search engines see fully rendered section
 * content (§13.15).
 */
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const { metadata } = await fetchHomepage();

  return {
    title: pageTitle(metadata?.title ?? undefined),
    description: metadata?.description ?? SITE_DESCRIPTION,
    alternates: { canonical: absoluteUrl('/') },
    openGraph: {
      title: pageTitle(metadata?.title ?? undefined),
      description: metadata?.description ?? SITE_DESCRIPTION,
      url: absoluteUrl('/'),
      images: [absoluteUrl(metadata?.ogImageUrl ?? SITE_OG_IMAGE_PATH)],
    },
  };
}

export default async function HomePage() {
  const { sections } = await fetchHomepage();

  return (
    <div className="flex flex-col gap-2xl">
      {sections.map((section, index) => (
        <HomepageSection key={section.id} section={section} priority={index === 0} />
      ))}
    </div>
  );
}
