"use client";

import { CaptionOverlay } from "@/components/dashboard/events/creative-lab/caption-overlay";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { renderRefusalSentence } from "@/lib/creative-lab/surface";

type Render = CreativeLabCardData["renders"][number];

function averageMs(rows: readonly Render[]): number | null {
  const done = rows.map((row) => row.renderMs).filter((ms): ms is number => ms != null && ms > 0);
  if (done.length === 0) return null;
  return done.reduce((sum, ms) => sum + ms, 0) / done.length;
}

function place(rows: readonly Render[], row: Render, now: string): string {
  if (row.status === "done") return "Ready";
  if (row.status === "failed") return renderRefusalSentence(row.error) ?? "This render failed — try it again.";
  const waiting = rows.filter((item) => item.status === "queued" || item.status === "rendering");
  const index = waiting.findIndex((item) => item.id === row.id);
  if (row.status === "queued") {
    const nth = index + 1;
    const word = nth === 1 ? "1st" : nth === 2 ? "2nd" : nth === 3 ? "3rd" : `${nth}th`;
    return `queued · ${word}`;
  }
  const mean = averageMs(rows);
  if (mean == null) return "Rendering";
  const elapsed = Math.max(0, Date.parse(now) - Date.parse(row.updatedAt || ""));
  if (!Number.isFinite(elapsed)) return "Rendering";
  const remain = Math.max(1, Math.round((mean - elapsed) / 60_000));
  return `~${remain} min`;
}

function bar(rows: readonly Render[], row: Render, now: string): number {
  if (row.status === "done") return 1;
  if (row.status !== "rendering") return 0;
  const mean = averageMs(rows);
  if (mean == null) return 0;
  const elapsed = Math.max(0, Date.parse(now) - Date.parse(row.updatedAt || ""));
  if (!Number.isFinite(elapsed)) return 0;
  return Math.min(0.95, elapsed / mean);
}

/** One row per render. A passed check draws nothing. A finished row plays the 9:16 preview. */
export function RenderRows({ rows, now }: { rows: readonly Render[]; now: string }) {
  const shown = rows.filter((row) => row.status === "queued" || row.status === "rendering" || row.status === "done" || row.status === "failed");
  if (shown.length === 0) return null;
  const ready = shown.filter((row) => row.status === "done").length;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{ready} of {shown.length} ready</p>
      {shown.map((row) => {
        const fraction = bar(shown, row, now);
        const label = place(shown, row, now);
        return (
          <article key={row.id} className="grid items-center gap-2 sm:grid-cols-[4.5rem_1fr_8rem]">
            {row.status === "done" && row.playing ? (
              <div className="w-16">
                <CaptionOverlay lines={row.lines} src={row.previewUrl} poster={row.posterUrl} />
              </div>
            ) : (
              <div className="aspect-[9/16] w-16 rounded bg-black" />
            )}
            <div>
              <p className="text-sm">{row.label}</p>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-muted">
                <div className="h-full bg-foreground" style={{ width: `${Math.round(fraction * 100)}%` }} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{label}</p>
          </article>
        );
      })}
    </div>
  );
}
