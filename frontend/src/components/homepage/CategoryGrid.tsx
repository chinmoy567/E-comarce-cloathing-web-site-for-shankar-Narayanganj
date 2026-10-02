import Image from 'next/image';
import Link from 'next/link';
import type { HomepageSectionResponse } from '@/lib/publicTypes';

/**
 * CATEGORY_GRID section (13-homepage-cms §13.9). No component is named after a
 * specific category — a new category the Admin adds to the catalogue appears
 * here automatically (§13.1) with no frontend code change.
 */
export function CategoryGrid({ section }: { section: HomepageSectionResponse }) {
  const categories = section.categories ?? [];
  if (categories.length === 0) return null;

  const columns = (section.contentConfig as { columns?: number } | null)?.columns;
  const largeCols = columns === 2 ? 'lg:grid-cols-2' : columns === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4';

  return (
    <section className="flex flex-col gap-md">
      {section.title && <h2 className="text-xl font-semibold md:text-[28px]">{section.title}</h2>}
      {section.subtitle && <p className="text-sm text-text-secondary">{section.subtitle}</p>}

      <div className={`grid grid-cols-2 gap-sm ${largeCols}`}>
        {categories.map((category) => (
          <Link
            key={category.id}
            href={`/category/${category.slug}`}
            className="flex flex-col items-center gap-xs rounded-lg border border-border bg-background p-sm text-center hover:border-primary"
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-surface">
              {category.imageUrl && (
                <Image src={category.imageUrl} alt="" fill sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover" />
              )}
            </div>
            <p className="text-sm font-medium text-text-primary">{category.name}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
