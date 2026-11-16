"use client";

import { CTA_PICKS, snippetFixtureView } from "@/scripts/plan-frames/snippet-fixtures";

import { LabSnippet, TrackEditor } from "./snippet";

/**
 * CT-A (the track picker) and CT-B (the drop marker and preview) from
 * fixtures, at whatever width the runner opens: 1280 or 393.
 */
export function SnippetFrameMount({ id }: { id: string }) {
  const view = snippetFixtureView();
  return (
    <main className="min-h-screen bg-background p-4 text-sm text-foreground sm:p-8">
      <div className="mx-auto max-w-[72rem] rounded-lg border border-border bg-card p-4">
        {id === "CTA" ? (
          <LabSnippet eventId="frame-event" initial={view} initialPicks={CTA_PICKS} initialStatic="static-1" />
        ) : (
          <TrackEditor title="Track two" file={view.rows[1]!.file!} preview={{ audioUrl: null, imageUrl: null, failed: false }} onEdit={() => {}} />
        )}
      </div>
    </main>
  );
}
