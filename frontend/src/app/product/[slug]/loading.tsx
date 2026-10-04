export default function Loading() {
  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-xl md:grid-cols-2" aria-busy="true" aria-label="Loading product">
      <div className="aspect-square w-full animate-pulse rounded-lg bg-surface" />
      <div className="flex flex-col gap-md">
        <div className="h-4 w-24 animate-pulse rounded bg-surface" />
        <div className="h-8 w-3/4 animate-pulse rounded bg-surface" />
        <div className="h-8 w-32 animate-pulse rounded bg-surface" />
        <div className="h-12 w-full animate-pulse rounded-lg bg-surface" />
      </div>
    </div>
  );
}
