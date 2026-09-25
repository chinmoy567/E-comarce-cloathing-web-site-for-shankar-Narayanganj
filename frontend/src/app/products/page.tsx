import type { Metadata } from 'next';
import { pageTitle, absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: pageTitle('Shop'),
  description: 'Browse our collection of fashion and clothing',
  alternates: {
    canonical: absoluteUrl('/products'),
  },
};

/**
 * Products browse page (07-catalogue §7).
 * Shows searchable, filterable product grid.
 *
 * TODO: Implement product search/filter UI
 * TODO: Fetch products from /api/public/products endpoint
 * TODO: Add pagination
 */
export default async function ProductsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Shop</h1>
          <p className="text-gray-600 mt-2">Browse our collection of fashion and clothing</p>
        </div>

        {/* TODO: Search bar */}
        <div className="mb-6 flex gap-4">
          {/* TODO: Category filter sidebar */}
          <div className="flex-1">
            {/* TODO: Product grid */}
            <div className="text-center py-12 text-gray-600">
              <p>Product browsing feature coming soon</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
