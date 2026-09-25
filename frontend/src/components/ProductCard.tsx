import Image from 'next/image';
import Link from 'next/link';
import type { PublicProductSummary } from '@/lib/publicTypes';

/**
 * Shared product card (13-homepage-cms §13.9, plan §6). Used by
 * `<ProductCarousel/>` and, later, every other place products are listed
 * (category pages, search) — never reimplemented per section.
 *
 * `/product/[slug]` does not exist yet (full spec 07 is out of scope for this
 * slice, per the plan's Follow-up Work section) — the link below is a
 * documented dead route until that page ships, matching spec 12's own
 * integration-contract precedent for a link with no destination yet.
 */
export function ProductCard({ product, priority = false }: { product: PublicProductSummary; priority?: boolean }) {
  return (
    <Link
      href={`/product/${product.slug}`}
      className="flex flex-col gap-xs rounded-lg border border-border bg-background p-sm transition-colors hover:border-primary"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-surface">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover"
            priority={priority}
            loading={priority ? undefined : 'lazy'}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-text-tertiary text-xs">No image</div>
        )}

        {product.isFeatured && (
          <span className="absolute left-sm top-sm rounded-lg bg-primary px-xs py-[2px] text-xs font-semibold text-white">Featured</span>
        )}
        {product.outOfStock && (
          <span className="absolute right-sm top-sm rounded-lg bg-text-secondary/90 px-xs py-[2px] text-xs font-semibold text-white">
            Out of stock
          </span>
        )}
      </div>

      <p className="line-clamp-2 text-sm font-medium text-text-primary">{product.name}</p>

      <div className="flex items-center gap-xs">
        <span className="font-semibold text-text-primary">৳{product.price.toLocaleString('en-BD')}</span>
        {product.compareAtPrice !== null && product.compareAtPrice > product.price && (
          <span className="text-xs text-text-tertiary line-through">৳{product.compareAtPrice.toLocaleString('en-BD')}</span>
        )}
      </div>
    </Link>
  );
}
