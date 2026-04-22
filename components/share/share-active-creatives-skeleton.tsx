/**
 * components/share/share-active-creatives-skeleton.tsx
 *
 * Suspense fallback for the share page's "Active creatives"
 * section. Owns the section header + caveat (which match the
 * resolved `<ShareActiveCreativesSection>` markup so the layout
 * doesn't reflow on transition), an indeterminate progress bar,
 * and a 6-card placeholder grid sized to the real card.
 *
 * Why this exists (PR #50):
 * On a cache miss, the per-event Meta fan-out + chunked
 * insights fallback can take 20-30s for wide events. Without a
 * fallback, the user sees the previous timeframe's numbers
 * frozen on screen with no signal that a new fetch is in
 * flight, and assumes the report is broken. Suspense lets the
 * rest of the report (headline metrics, campaign breakdown
 * table) paint instantly while only this section streams.
 *
 * The card placeholders mirror the real `ShareCreativeCard`
 * shell:
 *   - Same border / radius / padding
 *   - Same `flex flex-col gap-3` rhythm
 *   - Same grid responsiveness (1-col mobile / 2-col sm /
 *     3-col lg) so the layout doesn't jump on transition
 *
 * Pure server component — no `use client` boundary needed for
 * what is just CSS animation.
 */

const SKELETON_CARD_COUNT = 6;

export function ShareActiveCreativesSkeleton() {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-heading text-base tracking-wide text-foreground">
          Active creatives
        </h2>
      </div>

      {/*
        Real indeterminate progress bar — a sliver of accent colour
        sliding across a muted track, driven by the shared `shimmer`
        keyframe in globals.css. Replaces the previous animate-pulse
        line which read as static at a glance and made wide-event
        loads (15-30s on cache miss) look indistinguishable from a
        timeout. The status copy underneath sets the user's
        expectation ("up to 30s") so they don't bounce.
      */}
      <div className="space-y-2">
        <div
          className="relative h-1 w-full overflow-hidden rounded-full bg-muted"
          aria-hidden
        >
          <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-primary/70 animate-[shimmer_1.4s_ease-in-out_infinite]" />
        </div>
        <p className="text-xs text-muted-foreground">
          Loading creative breakdown — this can take up to 30 seconds on wider
          timeframes.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: SKELETON_CARD_COUNT }).map((_, i) => (
          <div
            key={i}
            className="flex h-56 animate-pulse flex-col gap-3 rounded-md border border-border bg-card p-4"
            aria-hidden
          >
            {/* Top row: thumbnail block + title/body lines */}
            <div className="flex items-start gap-3">
              <div className="h-14 w-14 shrink-0 rounded-md bg-muted" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-3.5 w-3/4 rounded bg-muted" />
                <div className="h-2.5 w-full rounded bg-muted/70" />
                <div className="h-2.5 w-2/3 rounded bg-muted/70" />
              </div>
            </div>
            {/* Badge strip */}
            <div className="flex gap-1.5">
              <div className="h-4 w-16 rounded bg-muted/60" />
              <div className="h-4 w-12 rounded bg-muted/60" />
            </div>
            {/* Headline stat row + funnel rows */}
            <div className="mt-auto space-y-2">
              <div className="flex items-end justify-between">
                <div className="h-5 w-20 rounded bg-muted" />
                <div className="h-4 w-14 rounded bg-muted/60" />
              </div>
              <div className="h-3 w-full rounded bg-muted/50" />
              <div className="h-3 w-full rounded bg-muted/50" />
              <div className="h-3 w-3/4 rounded bg-muted/50" />
            </div>
          </div>
        ))}
      </div>

      {/*
        Caveat strip kept identical to the resolved render so
        the layout doesn't shift when content streams in.
      */}
      <p className="text-xs text-muted-foreground">
        Spend, registrations and reach are summed across the underlying
        ads in each creative concept. Rate metrics (CTR, CPR, frequency)
        are recomputed from the summed totals — not averaged across ads
        — to avoid the usual ratio-of-rates inflation. Reach is summed
        across ads and may over-count audiences that overlap. Click any
        card to see the full creative.
      </p>
    </section>
  );
}
