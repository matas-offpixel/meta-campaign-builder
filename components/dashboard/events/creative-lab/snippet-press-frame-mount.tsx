"use client";

import type { FileView } from "@/lib/creative-tests/snippet-view";

import { TrackEditor } from "./snippet";

/**
 * SNP-A / SNP-B (M3d-b): the Snippet tab's one window on a file with no drop,
 * before and after a press at 30 % of the track. data-frame-ready carries the
 * shot's frame ("creative-tests/SNPA"), which scripts/plan-frames/run.mjs
 * waits for before it captures. A separate mount from snippet-frame-mount.tsx,
 * which sits in an open PR (#1316). The page builds the file on the server
 * (scripts/plan-frames/snippet-press-fixtures.ts runs the save's own patch,
 * which reads node modules) and passes it in.
 */
export function SnippetPressFrameMount({ id, file }: { id: string; file: FileView }) {
  return (
    <main data-frame-ready={`creative-tests/${id}`} className="min-h-screen bg-background p-4 text-sm text-foreground sm:p-8">
      <div className="mx-auto max-w-[72rem] rounded-lg border border-border bg-card p-4">
        <TrackEditor title="Track two" file={file} preview={{ audioUrl: null, imageUrl: null, failed: false }} onEdit={() => {}} />
      </div>
    </main>
  );
}
