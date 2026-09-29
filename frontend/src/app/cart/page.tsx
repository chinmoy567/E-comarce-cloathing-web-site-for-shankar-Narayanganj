import type { Metadata } from 'next';
import { pageTitle, absoluteUrl } from '@/lib/site';
import { CartView } from './CartView';

export const metadata: Metadata = {
  title: pageTitle('Shopping Cart'),
  description: 'Review your shopping cart',
  alternates: {
    canonical: absoluteUrl('/cart'),
  },
};

/** Shopping cart page (02-customer §"Add products to the shopping cart"). */
export default function CartPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-text-primary mb-xl">Shopping Cart</h1>
      <CartView />
    </div>
  );
}
