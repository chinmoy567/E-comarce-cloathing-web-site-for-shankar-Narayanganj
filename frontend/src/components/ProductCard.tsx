import Image from 'next/image';
import Link from 'next/link';
import type { PublicProductSummary } from '@/lib/publicTypes';
import { WishlistButton } from '@/components/WishlistButton';

/**
 * Shared product card (13-homepage-cms §13.9, plan §6). Used by `<ProductCarousel/>` and every other place
 * products are listed (category pages, search, wishlist) — never reimplemented per section.
 *
 * The wishlist action (§13.9) is a sibling of the product link, not nested in it: a button inside an
 * anchor is invalid HTML and would navigate on click.
 */
export function ProductCard({ product, priority = false }: { product: PublicProductSummary; priority?: boolean }) {
  return (
    <div className="relative">
      <Link
        href={`/product/${product.slug}`}
        className="group flex flex-col gap-sm"
      >
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-surface">
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.name}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition-transform duration-300 ease-out motion-safe:group-hover:scale-105"
              priority={priority}
              loading={priority ? undefined : 'lazy'}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-text-tertiary text-xs">No image</div>
          )}

          {product.isFeatured && (
            <span className="absolute left-sm top-sm rounded bg-primary px-sm py-xs text-xs font-semibold uppercase tracking-wide text-white">Featured</span>
          )}
          {product.outOfStock && (
            <span className="absolute bottom-sm left-sm rounded bg-secondary/90 px-sm py-xs text-xs font-semibold text-white">
              Out of stock
            </span>
          )}
        </div>

        <p className="line-clamp-2 text-sm text-text-secondary transition-colors group-hover:text-text-primary">{product.name}</p>

        <div className="flex items-baseline gap-sm">
          <span className="text-base font-bold text-text-primary">৳{product.price.toLocaleString('en-BD')}</span>
          {product.compareAtPrice !== null && product.compareAtPrice > product.price && (
            <span className="text-sm text-text-tertiary line-through">৳{product.compareAtPrice.toLocaleString('en-BD')}</span>
          )}
        </div>
      </Link>

      {/* Top-right of the image (the card's p-sm padding aligns it); the stock badge sits bottom-left instead. */}
      <div className="absolute right-sm top-sm">
        <WishlistButton productId={product.id} productName={product.name} />
      </div>
    </div>
  );
}
