import { formatMoney, type OrderAmounts, type OrderLine } from '@/lib/account';

/** Item list and amount breakdown, shared by the guest lookup result and the account order detail. */
export function OrderItemsAndAmounts({
  items,
  amounts,
  appliedCouponCode,
}: {
  items: OrderLine[];
  amounts: OrderAmounts;
  appliedCouponCode: string | null;
}) {
  return (
    <section className="rounded-lg border border-border p-lg">
      <h2 className="mb-md text-base font-bold text-text-primary">Items</h2>
      <ul className="divide-y divide-border">
        {items.map((item, i) => (
          <li key={i} className="flex justify-between gap-md py-md text-sm first:pt-0">
            <div className="min-w-0">
              <p className="font-medium text-text-primary">{item.productName}</p>
              {item.variantLabel && <p className="text-xs text-text-secondary">{item.variantLabel}</p>}
              <p className="text-xs text-text-secondary">
                {formatMoney(item.unitPrice)} × {item.quantity}
              </p>
            </div>
            <p className="font-medium">{formatMoney(item.lineTotal)}</p>
          </li>
        ))}
      </ul>
      <dl className="mt-md space-y-sm border-t border-border pt-md text-sm">
        <div className="flex justify-between">
          <dt className="text-text-secondary">Subtotal</dt>
          <dd>{formatMoney(amounts.subtotal)}</dd>
        </div>
        {amounts.discountAmount > 0 && (
          <div className="flex justify-between">
            <dt className="text-text-secondary">Discount{appliedCouponCode ? ` (${appliedCouponCode})` : ''}</dt>
            <dd className="text-accent">-{formatMoney(amounts.discountAmount)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-text-secondary">Shipping</dt>
          <dd>{formatMoney(amounts.shippingAmount)}</dd>
        </div>
        <div className="flex justify-between text-base font-bold">
          <dt>Total</dt>
          <dd>{formatMoney(amounts.totalAmount)}</dd>
        </div>
      </dl>
    </section>
  );
}
