/**
 * Skeleton for the internal venue report shell
 * (`/clients/[id]/venues/[event_code]`). Mirrors the sticky
 * VenueReportHeader (title row, sub-tab strip, timeframe + platform
 * controls) plus the topline stats grid and the trend chart so the
 * layout-shift between fallback and real content stays under the
 * CLS < 0.05 target.
 *
 * Used by `app/(dashboard)/clients/[id]/venues/[event_code]/loading.tsx`.
 */
export function VenueShellSkeleton() {
  return (
    <div className="space-y-6 p-6">
      {/* Sticky VenueReportHeader stand-in */}
      <header className="sticky top-0 z-10 -m-6 mb-0 border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto max-w-7xl space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <div className="h-6 w-72 rounded bg-stone-900 animate-pulse" />
              <div className="h-3 w-32 rounded bg-stone-900/70 animate-pulse" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-24 rounded bg-stone-900 animate-pulse" />
              <div className="h-8 w-32 rounded bg-stone-900 animate-pulse" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            {/* Sub-tab row */}
            <div className="flex gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-9 w-28 rounded bg-stone-900 animate-pulse"
                />
              ))}
            </div>
            {/* Timeframe + Platform controls */}
            <div className="flex gap-2">
              <div className="h-9 w-32 rounded bg-stone-900 animate-pulse" />
              <div className="h-9 w-28 rounded bg-stone-900 animate-pulse" />
            </div>
          </div>
        </div>
      </header>

      {/* 6-cell topline stats grid */}
      <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded bg-stone-900 animate-pulse" />
        ))}
      </div>

      {/* Single full-width chart */}
      <div className="h-72 rounded bg-stone-900 animate-pulse" />
    </div>
  );
}
