/**
 * Per-island Suspense fallback for the venue page's Funnel Pacing
 * tab (`<FunnelPacingSection>`). Mirrors the funnel-creative-pacing
 * layout — an overview header, a wide chart strip, and the per-
 * creative pacing rows — so the surrounding header + tabs stay
 * paint-stable while the async server component loads.
 */
export function PacingSectionSkeleton() {
  return (
    <div className="space-y-4">
      {/* Section header / settings row */}
      <div className="flex items-center justify-between gap-3">
        <div className="h-5 w-48 rounded bg-stone-900 animate-pulse" />
        <div className="h-8 w-20 rounded bg-stone-900 animate-pulse" />
      </div>
      {/* Wide pacing chart */}
      <div className="h-72 rounded bg-stone-900 animate-pulse" />
      {/* Per-creative pacing rows */}
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded bg-stone-900 animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
