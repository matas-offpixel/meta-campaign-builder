"use client";

import { useAddedClusters } from "@/components/insights-rail/use-added-clusters";

/** The chip the builder puts on a cluster the rail added (IR5, cluster row component). */
export function AddedFromInsightsChip() {
  return (
    <span data-added-from-insights className="inline-flex h-[19px] items-center rounded border border-border-strong px-1.5 text-[10.5px] leading-none font-semibold whitespace-nowrap text-foreground/80">
      added from Insights
    </span>
  );
}

/**
 * The interests the rail added to this draft (IR5). Rendered by the
 * audience builder; empty until the first Add cluster. The list is the
 * draft: it lives for the page and is not written anywhere until the
 * audience is.
 */
export function AddedClustersFromInsights({ title = "Interests in this audience" }: { title?: string }) {
  const clusters = useAddedClusters();
  if (!clusters.length) return null;
  return (
    <section data-added-clusters className="rounded-md border border-border bg-card p-3.5">
      <p className="mb-1.5 text-[9px] font-bold tracking-[.16em] text-muted-foreground uppercase">{title}</p>
      <ul className="flex flex-col gap-1.5">
        {clusters.map((cluster) => (
          <li key={cluster.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-2.5 py-2 text-xs">
            <span className="min-w-0 truncate">
              {cluster.name}
              {cluster.interests.length ? <span className="text-muted-foreground"> · {cluster.interests.length} interest{cluster.interests.length === 1 ? "" : "s"}</span> : null}
            </span>
            <AddedFromInsightsChip />
          </li>
        ))}
      </ul>
    </section>
  );
}
