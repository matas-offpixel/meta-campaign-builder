import type { ShareActiveCreativesResult } from "@/lib/reporting/share-active-creatives";
import ShareActiveCreativesClient from "@/components/share/share-active-creatives-client";

/**
 * components/share/share-active-creatives-section.tsx
 *
 * Server-rendered "Active creatives" section for the public share
 * report. Owns the discriminated-union narrowing (skip / error /
 * ok), the section header, and the metric-summation caveat. Hands
 * the resolved `groups` array off to a client island
 * (`ShareActiveCreativesClient`) which owns the click-to-expand
 * modal state and the card grid.
 *
 * The split exists so the section can stay server-rendered (cached
 * by the enclosing share page) while the modal — which inherently
 * needs `useState` for open/close — runs client-side without
 * dragging the rest of the page into a "use client" boundary.
 */

interface Props {
  result: ShareActiveCreativesResult;
}

export function ShareActiveCreativesSection({ result }: Props) {
  if (result.kind === "skip") {
    // No section at all — the event simply isn't running anything.
    // Different from `error`, where we want the muted note so the
    // viewer knows there should be data but Meta wasn't reachable.
    return null;
  }

  if (result.kind === "error") {
    return (
      <section className="space-y-3">
        <h2 className="font-heading text-base tracking-wide text-foreground">
          Active creatives
        </h2>
        <p className="text-sm text-muted-foreground">
          Creative breakdown unavailable at the moment.
        </p>
      </section>
    );
  }

  const { groups, meta } = result;
  if (groups.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-heading text-base tracking-wide text-foreground">
          Active creatives
        </h2>
        <span className="text-xs text-muted-foreground">
          {groups.length} concept{groups.length === 1 ? "" : "s"} ·{" "}
          {meta.ads_fetched} ad{meta.ads_fetched === 1 ? "" : "s"} across{" "}
          {meta.campaigns_total} campaign
          {meta.campaigns_total === 1 ? "" : "s"}
        </span>
      </div>

      <ShareActiveCreativesClient groups={groups} />

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
