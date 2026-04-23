/**
 * components/share/share-active-creatives-warming.tsx
 *
 * Friendly fallback rendered when the share RSC's "no snapshot
 * ever" branch (cold cache for a brand-new event) raced its
 * 20-second cap before the live Meta fetch resolved. The cron is
 * still going to populate `active_creatives_snapshots` on the
 * next tick, AND the RSC fired the fire-and-forget internal
 * refresh kick when it took the cold-cache branch — so the next
 * page render will hit a real snapshot. This placeholder only
 * exists so the visitor doesn't sit watching the
 * `<ShareActiveCreativesSkeleton>` spin past the 30s mark and
 * conclude the report is broken.
 *
 * Distinct from the skeleton because:
 *   - The skeleton's copy is "Loading creative breakdown — this
 *     can take up to 30 seconds" which becomes a lie past 30s.
 *   - The warming copy reframes as "we're populating the cache,
 *     give it a minute" — accurate, encourages a refresh, and
 *     doesn't blame Meta.
 *
 * Pure server component — no interactivity. The "Refresh"
 * affordance is the page's own refresh button (top-right of the
 * Meta block); we don't duplicate it inside the placeholder
 * because clicking it after a cold-cache miss usually just hits
 * the same in-flight fetch a second time.
 */

export function ShareActiveCreativesWarming() {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-heading text-base tracking-wide text-foreground">
          Active creatives
        </h2>
      </div>
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/30 px-4 py-6 text-center">
        <p className="text-sm font-medium text-foreground">
          Numbers warming up
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          We&apos;re building this report&apos;s creative breakdown for the
          first time. Refresh in a minute and the cards will appear here.
        </p>
      </div>
    </section>
  );
}
