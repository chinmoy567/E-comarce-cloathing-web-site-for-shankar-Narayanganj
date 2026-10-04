/** Loading placeholder shaped like a product listing; matches the product grid used by listing/search pages. */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading products">
      <div className="mb-xl h-8 w-48 animate-pulse rounded bg-surface" />
      <div className="grid grid-cols-2 gap-x-sm gap-y-xl md:grid-cols-3 md:gap-x-md lg:grid-cols-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex flex-col gap-sm">
            <div className="aspect-[3/4] w-full animate-pulse rounded-lg bg-surface" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-surface" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-surface" />
          </div>
        ))}
      </div>
    </div>
  );
}
