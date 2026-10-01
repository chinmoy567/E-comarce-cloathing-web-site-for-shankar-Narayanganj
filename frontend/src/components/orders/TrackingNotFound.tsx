import Link from 'next/link';

/**
 * The backend's not-found message, verbatim (§4.14.4, §4.16). The guest-lookup pointer is shown ONLY for the
 * "not available yet" case — the generic message never hints that an order might exist.
 */
export function TrackingNotFound({ message, showLookupLink }: { message: string; showLookupLink: boolean }) {
  return (
    <div role="status" className="mt-xl rounded-lg border border-border p-lg text-sm">
      <p className="text-text-primary">{message}</p>
      {showLookupLink && (
        <p className="mt-md">
          <Link href="/orders/lookup" className="font-semibold text-primary underline">
            Look up your order with your Order Number and phone number
          </Link>
        </p>
      )}
    </div>
  );
}
