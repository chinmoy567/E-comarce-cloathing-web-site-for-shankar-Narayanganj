import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { pageTitle, absoluteUrl } from '@/lib/site';
import { fetchProductBySlug } from '@/lib/products';
import { ProductDetail } from '@/components/product/ProductDetail';

type ProductPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProductBySlug(slug);
  if (!product) {
    return { title: pageTitle('Product not found') };
  }

  return {
    title: pageTitle(product.name),
    description: product.description ?? `${product.name} — available at Fabrillke.`,
    alternates: {
      canonical: absoluteUrl(`/product/${product.slug}`),
    },
  };
}

/** Product detail page (spec 02 §"View detailed product information"). */
export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await fetchProductBySlug(slug);

  if (!product) {
    notFound();
  }

  return <ProductDetail product={product} canonicalUrl={absoluteUrl(`/product/${product.slug}`)} />;
}
