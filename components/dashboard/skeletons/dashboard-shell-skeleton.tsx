/**
 * Skeleton for the internal client dashboard shell. Mirrors the
 * actual layout (PageHeader strip + breadcrumb + sticky tab row +
 * stats grid + chart) so the layout-shift between fallback and
 * real content is minimal (CLS < 0.05 target).
 *
 * Used by `app/(dashboard)/clients/[id]/dashboard/loading.tsx`. All
 * pulse blocks use the stone palette to match the existing dark
 * dashboard chrome.
 */
export function DashboardShellSkeleton() {
  return (
    <>
      {/* PageHeader-shaped strip */}
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="h-6 w-72 rounded bg-stone-900 animate-pulse" />
            <div className="h-3 w-96 rounded bg-stone-900/70 animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-28 rounded bg-stone-900 animate-pulse" />
            <div className="h-8 w-32 rounded bg-stone-900 animate-pulse" />
            <div className="h-8 w-28 rounded bg-stone-900 animate-pulse" />
          </div>
        </div>
      </header>

      {/* Breadcrumb stub */}
      <nav
        aria-label="Breadcrumb (loading)"
        className="mx-auto max-w-7xl px-6 pt-4"
      >
        <div className="h-3 w-48 rounded bg-stone-900/70 animate-pulse" />
      </nav>

      {/* Sticky tab row */}
      <div className="mx-auto max-w-7xl px-6 pt-4">
        <div className="h-10 w-full rounded bg-stone-900 animate-pulse" />
      </div>

      {/* 6-cell stats grid */}
      <div className="mx-auto max-w-7xl px-6 pt-6">
        <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded bg-stone-900 animate-pulse"
            />
          ))}
        </div>
      </div>

      {/* Single full-width chart */}
      <div className="mx-auto max-w-7xl px-6 pt-6 pb-12">
        <div className="h-72 rounded bg-stone-900 animate-pulse" />
      </div>
    </>
  );
}
