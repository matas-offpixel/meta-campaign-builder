"use client";

import { AUA_PICKS, snippetFixtureView } from "@/scripts/plan-frames/snippet-fixtures";

import { LabSnippet, TrackEditor } from "./snippet";

/**
 * AU-A (the track picker, redrawing CT-A) and CT-B (the drop marker and
 * preview) from fixtures, at whatever width the runner opens: 1280 or 393.
 * data-frame-ready carries the shot's frame ("creative-tests/AUA"), which
 * scripts/plan-frames/run.mjs waits for before it captures.
 */
export function SnippetFrameMount({ id }: { id: string }) {
  const view = snippetFixtureView();
  return (
    <main data-frame-ready={`creative-tests/${id}`} className="min-h-screen bg-background p-4 text-sm text-foreground sm:p-8">
      <div className="mx-auto max-w-[72rem] rounded-lg border border-border bg-card p-4">
        {id === "AUA" ? (
          <LabSnippet eventId="frame-event" initial={view} initialPicks={AUA_PICKS} initialStatic="static-1" />
        ) : (
          <TrackEditor title="Track two" file={view.rows[1]!.file!} preview={{ audioUrl: null, imageUrl: null, failed: false }} onEdit={() => {}} />
        )}
      </div>
    </main>
  );
}
