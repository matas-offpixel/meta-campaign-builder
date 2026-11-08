"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CaptionOverlay } from "@/components/dashboard/events/creative-lab/caption-overlay";
import { PosterVideo } from "@/components/dashboard/events/creative-lab/poster-video";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { renderFailureLine, renderRowFraction, renderRowWord, visibleRenderRows } from "@/lib/creative-lab/surface";

type Render = CreativeLabCardData["renders"][number];

/**
 * One row per render. The finished one plays beside the rows, not in the
 * mini frame. A superseded render (an old path kept for the record) is not
 * listed. A failed row says what went wrong in one sentence under its label.
 * When a fresh try can fix it and its round is still being built, "try it
 * again" is the link: it re-queues that one render.
 */
export function RenderRows({ rows, now }: { rows: readonly Render[]; now: string }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState<string | null>(null);
  const [refused, setRefused] = useState<Record<string, string>>({});
  const shown = visibleRenderRows(rows);

  async function retry(id: string) {
    setRetrying(id);
    setRefused((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    try {
      const res = await fetch(`/api/creative-lab/renders/${id}/retry`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setRefused((current) => ({ ...current, [id]: json.error || "The queue didn't take this render — reload the page." }));
        return;
      }
      router.refresh();
    } catch {
      setRefused((current) => ({ ...current, [id]: "The queue didn't take this render — reload the page." }));
    } finally {
      setRetrying(null);
    }
  }

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
            const failed = row.status === "failed";
            return (
              <article key={row.id} data-render-row={row.status} className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-border py-1.5">
                <div className="h-7 w-4 overflow-hidden rounded bg-black">
                  {row.clipPreviewUrl ? <PosterVideo src={row.clipPreviewUrl} at={0.5} className="h-full w-full object-cover" /> : null}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm">{row.label}</p>
                  {failed ? (
                    <FailureLine
                      sentence={refused[row.id] ?? label}
                      roundOpen={row.roundOpen && !refused[row.id]}
                      busy={retrying === row.id}
                      onRetry={() => void retry(row.id)}
                    />
                  ) : (
                    <div className="mt-1 h-1.5 overflow-hidden rounded bg-muted">
                      <div className={`h-full ${done ? "bg-success" : "bg-foreground"}`} style={{ width: `${Math.round(fraction * 100)}%` }} />
                    </div>
                  )}
                </div>
                {done ? (
                  <span className="inline-flex items-center rounded border border-success px-1.5 py-0.5 text-xs text-success">Ready</span>
                ) : failed ? (
                  <span aria-hidden />
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

function FailureLine({ sentence, roundOpen, busy, onRetry }: { sentence: string; roundOpen: boolean; busy: boolean; onRetry: () => void }) {
  const line = renderFailureLine(sentence, roundOpen);
  return (
    <p data-render-failure className="mt-0.5 text-xs text-destructive">
      {line.lead}
      {line.link ? (
        <button
          type="button"
          data-render-retry
          aria-busy={busy || undefined}
          disabled={busy}
          onClick={onRetry}
          className="underline underline-offset-2 hover:no-underline disabled:opacity-60"
        >
          {line.link}
        </button>
      ) : null}
      {line.tail}
    </p>
  );
}
