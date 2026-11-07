"use client";

import { CaptionOverlay } from "@/components/dashboard/events/creative-lab/caption-overlay";
import { PosterVideo } from "@/components/dashboard/events/creative-lab/poster-video";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { renderRowFraction, renderRowWord } from "@/lib/creative-lab/surface";

type Render = CreativeLabCardData["renders"][number];

/** One row per render. The finished one plays beside the rows, not in the mini frame. */
export function RenderRows({ rows, now }: { rows: readonly Render[]; now: string }) {
  const shown = rows.filter((row) => row.status === "queued" || row.status === "rendering" || row.status === "done" || row.status === "failed");
  if (shown.length === 0) return null;
  const ready = shown.filter((row) => row.status === "done").length;
  const playing = shown.find((row) => row.status === "done" && row.playing) ?? null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{ready} of {shown.length} ready</p>
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-[minmax(0,1fr)_11.25rem]">
        <div>
          {shown.map((row) => {
            const fraction = renderRowFraction(row, shown, now);
            const label = renderRowWord(row, shown, now);
            const done = row.status === "done";
            return (
              <article key={row.id} className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-border py-1.5">
                <div className="h-7 w-4 overflow-hidden rounded bg-black">
                  {row.clipPreviewUrl ? <PosterVideo src={row.clipPreviewUrl} at={0.5} className="h-full w-full object-cover" /> : null}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm">{row.label}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded bg-muted">
                    <div className={`h-full ${done ? "bg-success" : "bg-foreground"}`} style={{ width: `${Math.round(fraction * 100)}%` }} />
                  </div>
                </div>
                {done ? (
                  <span className="inline-flex items-center rounded border border-success px-1.5 py-0.5 text-xs text-success">Ready</span>
                ) : (
                  <span className="text-xs text-muted-foreground">{label}</span>
                )}
              </article>
            );
          })}
        </div>
        {playing ? (
          <div className="w-full sm:w-[11.25rem]">
            <CaptionOverlay lines={playing.lines} src={playing.previewUrl} poster={playing.posterUrl} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
