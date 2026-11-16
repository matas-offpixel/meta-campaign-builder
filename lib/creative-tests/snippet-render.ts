/**
 * CT1 / CT5 / CT10: the snippet's preview and its render.
 *
 * Preview (CT5): the cut itself, faded and normalised exactly as it will
 * run, stored in Storage and played beside the static at phone size. Each
 * window, marker or length change re-cuts it after a 1-second pause (the
 * panel debounces). No Lambda call: the still is the static, unchanged.
 *
 * Render (CT1, CT10): the static rendered silent on Remotion Lambda
 * (StillWithAudio, 1080 × 1920, the snippet's length), then the same cut
 * muxed on with no re-encode. Queued rows run from the render tick, at most
 * MAX_SNIPPET_RENDERS_AT_ONCE at a time, failed after 15 minutes stuck.
 *
 * A render needs a matched file that passes AU1, a placed drop and no
 * rights flag (AU4, CT4, TT5): `renderRefusal` says which is missing. The
 * audio only ever comes from the file's Storage copy of the Drive file.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { AudioFileRow } from "./audio-intake.ts";
import { AUDIO_BUCKET, AUDIO_COLUMNS } from "./audio-intake.ts";
import { NO_CLEAR_DROP, REASON_UNREADABLE, cantUseText, clampLength } from "./snippet.ts";
import { RIGHTS_MUTED } from "./words.ts";

type Db = Pick<SupabaseClient, "from">;

export const MAX_SNIPPET_RENDERS_AT_ONCE = 2;
export const SNIPPET_STUCK_MS = 15 * 60 * 1000;

export type SnippetRenderRow = {
  id: string;
  user_id: string;
  event_id: string;
  audio_file_id: string;
  purpose: "preview" | "final";
  static_drive_file_id: string;
  static_name: string;
  start_s: number;
  length_s: number;
  test_id: string | null;
  status: "queued" | "rendering" | "done" | "failed";
  attempt: number;
  error: string | null;
  storage_path: string | null;
  file_name: string | null;
  updated_at: string;
};

/**
 * Why this file can't make a snippet yet, or null: a confirmed match, a file
 * that passes AU1 and a placed drop marker (AU4), and no rights flag (TT5).
 */
export function renderRefusal(file: Pick<AudioFileRow, "match_state" | "drop_s" | "unusable_reason" | "rights_flag" | "storage_path">): string | null {
  if (file.unusable_reason) return cantUseText(file.unusable_reason);
  if (!file.storage_path) return cantUseText(REASON_UNREADABLE);
  if (file.rights_flag) return RIGHTS_MUTED;
  if (file.match_state !== "matched") return "Match this file to a track first.";
  if (file.drop_s == null) return NO_CLEAR_DROP;
  return null;
}

export { fileWindow } from "./snippet.ts";

/** The preview cut's Storage path: one per file, start and length, so a window seen before costs nothing. */
export function previewPath(eventId: string, fileId: string, startS: number, lengthS: number): string {
  return `audio/creative-lab/${eventId}/preview/${fileId}-${Math.round(startS * 1000)}-${lengthS}.m4a`;
}

export function finalPath(renderId: string, attempt: number): string {
  return `videos/creative-lab/snippet/${renderId}${attempt > 1 ? `-a${attempt}` : ""}-9x16.mp4`;
}

export type CutDeps = {
  download: (bucket: string, storagePath: string) => Promise<Uint8Array>;
  exists: (bucket: string, storagePath: string) => Promise<boolean>;
  upload: (bucket: string, storagePath: string, filePath: string, contentType: string) => Promise<void>;
  cut: (input: string, output: string, win: { startS: number; lengthS: number }) => Promise<void>;
  tempDir: <T>(fn: (dir: string) => Promise<T>) => Promise<T>;
};

/** CT5's preview: the cut for this window, made once and stored. Returns its Storage path. */
export async function makePreview(file: AudioFileRow, win: { startS: number; lengthS: number }, deps: CutDeps): Promise<string> {
  const target = previewPath(file.event_id, file.id, win.startS, win.lengthS);
  if (await deps.exists(AUDIO_BUCKET, target)) return target;
  await deps.tempDir(async (dir) => {
    const source = path.join(dir, `source${path.extname(file.storage_path ?? "") || ".audio"}`);
    const out = path.join(dir, "cut.m4a");
    await writeFile(source, await deps.download(AUDIO_BUCKET, String(file.storage_path)));
    await deps.cut(source, out, win);
    await deps.upload(AUDIO_BUCKET, target, out, "audio/mp4");
  });
  return target;
}

export type RenderDeps = CutDeps & {
  /** The static's signed URL for Lambda (the Storage copy of the Drive file). */
  staticUrl: (row: SnippetRenderRow) => Promise<string>;
  /** Remotion Lambda, StillWithAudio, silent: the mp4's bytes. */
  renderStill: (input: { imageUrl: string; lengthS: number }) => Promise<{ bytes: Uint8Array; renderMs: number }>;
  mux: (video: string, audio: string, output: string) => Promise<void>;
  /** Registers the finished mp4 as a creative asset (for launch, PR D). Returns its id. */
  register: (row: SnippetRenderRow, storagePath: string, filePath: string) => Promise<string | null>;
};

/** One render: still on Lambda, the cut muxed on, stored, registered. */
export async function renderSnippet(db: Db, row: SnippetRenderRow, deps: RenderDeps): Promise<void> {
  const fileRes = await db.from("creative_lab_audio_files").select(AUDIO_COLUMNS).eq("id", row.audio_file_id).maybeSingle();
  if (fileRes.error) throw new Error(`creative_lab_audio_files: ${fileRes.error.message}`);
  const file = fileRes.data as AudioFileRow | null;
  if (!file) throw new Error("the audio file is gone");
  const refusal = renderRefusal(file);
  if (refusal) throw new Error(refusal);
  const win = { startS: Number(row.start_s), lengthS: clampLength(row.length_s) };
  const attempt = Number(row.attempt ?? 0) + 1;
  const storagePath = finalPath(row.id, attempt);
  const started = Date.now();
  let assetId: string | null = null;
  let renderMs = 0;
  await deps.tempDir(async (dir) => {
    const source = path.join(dir, `source${path.extname(file.storage_path ?? "") || ".audio"}`);
    const cut = path.join(dir, "cut.m4a");
    const still = path.join(dir, "still.mp4");
    const out = path.join(dir, "snippet.mp4");
    await writeFile(source, await deps.download(AUDIO_BUCKET, String(file.storage_path)));
    await deps.cut(source, cut, win);
    const rendered = await deps.renderStill({ imageUrl: await deps.staticUrl(row), lengthS: win.lengthS });
    renderMs = rendered.renderMs;
    await writeFile(still, rendered.bytes);
    await deps.mux(still, cut, out);
    await deps.upload(AUDIO_BUCKET, storagePath, out, "video/mp4");
    assetId = await deps.register(row, storagePath, out);
  });
  const done = await db
    .from("creative_lab_snippet_renders")
    .update({ status: "done", error: null, attempt, storage_path: storagePath, creative_asset_id: assetId, render_ms: renderMs || Date.now() - started })
    .eq("id", row.id)
    .eq("status", "rendering");
  if (done.error) throw new Error(`creative_lab_snippet_renders: ${done.error.message}`);
}

export type SnippetTickResult = { claimed: number; timedOut: number; failed: number; busy: boolean };

/** The render tick's snippet part: time out the stuck, claim queued finals, render them side by side. */
export async function runSnippetRenderTick(db: Db, deps: RenderDeps, opts: { now?: Date; archivedEventIds?: ReadonlySet<string>; maxAtOnce?: number } = {}): Promise<SnippetTickResult> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - SNIPPET_STUCK_MS).toISOString();
  const rendering = await db.from("creative_lab_snippet_renders").select("id, updated_at").eq("status", "rendering");
  if (rendering.error) throw new Error(`creative_lab_snippet_renders: ${rendering.error.message}`);
  let timedOut = 0;
  for (const row of (rendering.data ?? []) as { id: string; updated_at: string }[]) {
    if (row.updated_at >= cutoff) continue;
    const res = await db.from("creative_lab_snippet_renders").update({ status: "failed", error: "timeout" }).eq("id", row.id).eq("status", "rendering");
    if (res.error) throw new Error(`creative_lab_snippet_renders: ${res.error.message}`);
    timedOut += 1;
  }
  const inFlight = ((rendering.data ?? []) as unknown[]).length - timedOut;
  const slots = Math.max(0, (opts.maxAtOnce ?? MAX_SNIPPET_RENDERS_AT_ONCE) - inFlight);
  if (!slots) return { claimed: 0, timedOut, failed: 0, busy: true };
  const queued = await db.from("creative_lab_snippet_renders").select("*").eq("status", "queued").eq("purpose", "final").order("created_at", { ascending: true }).range(0, 49);
  if (queued.error) throw new Error(`creative_lab_snippet_renders: ${queued.error.message}`);
  const claimed: SnippetRenderRow[] = [];
  for (const row of (queued.data ?? []) as SnippetRenderRow[]) {
    if (claimed.length >= slots) break;
    if (opts.archivedEventIds?.has(row.event_id)) continue;
    const claim = await db.from("creative_lab_snippet_renders").update({ status: "rendering", error: null }).eq("id", row.id).eq("status", "queued").select("id");
    if (claim.error) throw new Error(`creative_lab_snippet_renders: ${claim.error.message}`);
    if (((claim.data ?? []) as unknown[]).length) claimed.push(row);
  }
  let failed = 0;
  await Promise.all(
    claimed.map(async (row) => {
      try {
        await renderSnippet(db, row, deps);
      } catch (err) {
        failed += 1;
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        await db.from("creative_lab_snippet_renders").update({ status: "failed", error: message }).eq("id", row.id).eq("status", "rendering");
      }
    }),
  );
  return { claimed: claimed.length, timedOut, failed, busy: false };
}
