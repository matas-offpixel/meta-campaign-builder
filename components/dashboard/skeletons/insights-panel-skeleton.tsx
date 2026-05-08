/**
 * Per-island Suspense fallback for the venue page's Insights tab
 * (`<CreativePatternsPanel>`). Smaller than the page-level shell —
 * renders a tile grid (matches the patterns dashboard's typical
 * 3×N grid of pattern cards) so the surrounding header + tabs stay
 * paint-stable while the async server component loads.
 */
export function InsightsPanelSkeleton() {
  return (
    <div className="space-y-4">
      {/* Phase / funnel toggle row */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-9 w-24 rounded bg-stone-900 animate-pulse"
          />
        ))}
      </div>
      {/* Patterns tile grid */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className="h-40 rounded bg-stone-900 animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
