import type { Metadata } from 'next';
import { pageTitle, absoluteUrl } from '@/lib/site';
import { notFound } from 'next/navigation';

/**
 * Product detail page (07-catalogue §7).
 * Shows product info, variants, pricing, and add-to-cart.
 *
 * TODO: Fetch product from /api/public/products/:id
 * TODO: Generate metadata from product data
 * TODO: Implement variant selector
 * TODO: Implement add-to-cart
 * TODO: Implement wishlist toggle
 */

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  // TODO: Fetch product data
  // TODO: Return proper metadata with og:image, og:title, etc.

  return {
    title: pageTitle('Product'),
    description: 'View product details',
    alternates: {
      canonical: absoluteUrl(`/products/${params.id}`),
    },
  };
}

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  // TODO: Fetch product from API
  // const product = await fetchProduct(params.id);
  // if (!product) notFound();

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Product images */}
          <div className="bg-gray-200 rounded-lg aspect-square flex items-center justify-center">
            <span className="text-gray-600">Product image</span>
          </div>

          {/* Product info */}
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Product Name</h1>
              <p className="text-gray-600 mt-2">Category</p>
            </div>

            {/* Price */}
            <div className="text-3xl font-bold text-gray-900">
              ৳0
              <span className="text-lg font-normal text-gray-600 ml-2">per item</span>
            </div>

            {/* Description */}
            <div className="prose prose-sm max-w-none">
              <p className="text-gray-600">Product description goes here</p>
            </div>

            {/* Variants selector */}
            <div className="space-y-4">
              {/* TODO: Variant selector component */}
            </div>

            {/* Actions */}
            <div className="flex gap-4 pt-4">
              <button className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition">
                Add to Cart
              </button>
              <button className="flex-1 border border-gray-300 text-gray-900 py-3 rounded-lg font-medium hover:border-gray-400 transition">
                ♡ Wishlist
              </button>
            </div>
          </div>
        </div>

        {/* Related products */}
        <div className="mt-16 pt-8 border-t border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Related Products</h2>
          <div className="text-center py-8 text-gray-600">
            <p>Related products coming soon</p>
          </div>
        </div>
      </div>
    </div>
  );
}
