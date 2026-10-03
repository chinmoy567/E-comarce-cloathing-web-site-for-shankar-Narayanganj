import type { PublicProductListItem, PublicProductSummary } from './publicTypes';

/** Maps an API list item to the shared `<ProductCard />` shape (13-homepage-cms §13.9). */
export function toProductSummary(
  item: Pick<
    PublicProductListItem,
    'id' | 'name' | 'slug' | 'imageUrl' | 'basePrice' | 'compareAtPrice' | 'isFeatured' | 'outOfStock'
  >,
): PublicProductSummary {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    imageUrl: item.imageUrl,
    price: item.basePrice,
    compareAtPrice: item.compareAtPrice,
    isFeatured: item.isFeatured,
    outOfStock: item.outOfStock,
  };
}
