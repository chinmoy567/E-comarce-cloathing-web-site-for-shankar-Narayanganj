import type { CheckoutPricing } from '@/lib/publicTypes';
import { describeShippingLine, type PricingPhase } from '@/lib/checkoutPricingView';

/**
 * The Shipping row of the §8.15c breakdown (spec 21). Displays only what the backend returned: it
 * never shows a number before a district is known and clears the amount while a new quote loads.
 */
export function ShippingSummaryLine({
  phase,
  pricing,
  onRetry,
}: {
  phase: PricingPhase;
  pricing: CheckoutPricing | null;
  onRetry?: () => void;
}) {
  const view = describeShippingLine(phase, pricing);
  return (
    <div className="flex justify-between gap-md text-sm" aria-busy={view.busy}>
      <dt className="text-text-secondary">{view.label}</dt>
      <dd className="text-right font-medium">
        {view.value}
        {view.retryable && onRetry && (
          <>
            {' '}
            <button type="button" onClick={onRetry} className="font-semibold text-primary underline">
              Retry
            </button>
          </>
        )}
      </dd>
    </div>
  );
}
