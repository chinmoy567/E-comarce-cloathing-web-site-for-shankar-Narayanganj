'use client';

import { useRouter } from 'next/navigation';
import { TRACK_PREFILL_KEY } from '@/lib/tracking';

/**
 * §4.14.5: a Track Order action reflecting current shipment availability — additional to, not a replacement
 * for, the public page. The id is handed over through sessionStorage (not the URL), and the public form
 * pre-fills without submitting. Before a shipment exists there is no button, only the honest wording.
 */
export function TrackOrderAction({ trackOrder }: { trackOrder: { available: boolean; trackingId: string | null } }) {
  const router = useRouter();

  if (!trackOrder.available || !trackOrder.trackingId) {
    return (
      <div className="space-y-xs text-sm text-text-secondary">
        <p>Shipment: Not yet created</p>
        <p>Tracking: Not available yet</p>
      </div>
    );
  }

  const trackingId = trackOrder.trackingId;
  return (
    <button
      type="button"
      onClick={() => {
        try {
          window.sessionStorage.setItem(TRACK_PREFILL_KEY, trackingId);
        } catch {
          // storage unavailable — the Track Order page still opens, the customer pastes the id
        }
        router.push('/track-order');
      }}
      className="h-12 w-full rounded-lg bg-primary text-sm font-bold text-white hover:bg-primary-hover md:w-auto md:px-xl"
    >
      Track Order
    </button>
  );
}
