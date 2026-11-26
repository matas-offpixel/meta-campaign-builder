"use client";

import { snippetPressFile } from "@/scripts/plan-frames/snippet-press-fixtures";

import { TrackEditor } from "./snippet";

/**
 * SNP-A / SNP-B (M3d-b): the Snippet tab's one window on a file with no drop,
 * before and after a press at 30 % of the track. data-frame-ready carries the
 * shot's frame ("creative-tests/SNPA"), which scripts/plan-frames/run.mjs
 * waits for before it captures. A separate mount from snippet-frame-mount.tsx,
 * which sits in an open PR (#1316).
 */
export function SnippetPressFrameMount({ id }: { id: string }) {
  return (
    <main data-frame-ready={`creative-tests/${id}`} className="min-h-screen bg-background p-4 text-sm text-foreground sm:p-8">
      <div className="mx-auto max-w-[72rem] rounded-lg border border-border bg-card p-4">
        <TrackEditor title="Track two" file={snippetPressFile(id)} preview={{ audioUrl: null, imageUrl: null, failed: false }} onEdit={() => {}} />
      </div>
    </main>
  );
}
