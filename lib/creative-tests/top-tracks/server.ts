/**
 * Top tracks in the app (TK10, HK2, HK7): each track's TK3 plan read from
 * the Lab's Storage copy of its file, the reel queued as a render row
 * (creative_lab_top_tracks_renders, migration 260), and the render tick's
 * handler. Audio only ever comes from that copy of the Drive file (CT2).
 *
 * The render needs three things the app has to find for the client's kit:
 * the face (kit-fonts bucket, O52), and the kit's event lockup and date
 * line (TK9, O54). The face is there for Puzzle; the lockup and date line
 * are not stored anywhere the app can read yet (T1's drafts read them from
 * a local PSD export). Until `{client id}/pieces/pieces.json` and its PNGs
 * are in the kit-fonts bucket, a date-end reel is held with
 * KIT_PIECES_MISSING and the drafts script is the way to make one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { AUDIO_BUCKET, AUDIO_COLUMNS, type AudioFileRow } from "../audio-intake.ts";
import { findDrops, findKicks, pcm16ToFloat, trackFeatures } from "./analysis.ts";
import { planTrack, type OperatorMarks, type TrackPlan } from "./audio-rules.ts";
import { decodeForAnalysis } from "./ffmpeg.ts";
import { DEFAULT_OPTIONS, canTick, type ReelOptions } from "./reel.ts";

type Db = Pick<SupabaseClient, "from">;

export const TOP_TRACKS_TABLE = "creative_lab_top_tracks_renders";
export const KIT_PIECES_MISSING = "Held — the kit's lockup and date line aren't uploaded for this client, so the date end can't be set · make the no-CTA version or upload the kit";
export const MAX_TOP_TRACKS_RENDERS_AT_ONCE = 1;

/** The operator's marks on a file (TK3: "Drop set by", "Hook set by"). */
export function marksOf(file: Pick<AudioFileRow, "drop_s" | "drop_source" | "hook_s" | "hook_source">, names: ReadonlyMap<string, string> = new Map(), setBy?: { drop?: string | null; hook?: string | null }): OperatorMarks {
  const marks: OperatorMarks = {};
  if (file.drop_source === "operator" && file.drop_s != null) {
    marks.dropS = Number(file.drop_s);
    marks.dropSetBy = setBy?.drop ? names.get(setBy.drop) ?? null : null;
  }
  if (file.hook_source === "operator" && file.hook_s != null) {
    marks.hookS = Number(file.hook_s);
    marks.hookSetBy = setBy?.hook ? names.get(setBy.hook) ?? null : null;
  }
  if (file.hook_source === "cleared") {
    marks.hookS = null;
    marks.hookSetBy = setBy?.hook ? names.get(setBy.hook) ?? null : null;
  }
  return marks;
}

export type StorageRead = (bucket: string, storagePath: string) => Promise<Uint8Array>;

/** TK3 for one file: download the Lab's copy, decode at 16 kHz, find the drops and the hook, and plan the window. */
export async function planFile(file: AudioFileRow, download: StorageRead, opts: { title: string; marks?: OperatorMarks; bassStemTop2?: number[] | null }): Promise<{ plan: TrackPlan; drops: number[] }> {
  if (!file.storage_path) throw new Error(`${opts.title}: no Storage copy`);
  const dir = await mkdtemp(path.join(tmpdir(), "tt-plan-"));
  try {
    const local = path.join(dir, path.basename(file.storage_path));
    await writeFile(local, await download(AUDIO_BUCKET, file.storage_path));
    const f = trackFeatures(pcm16ToFloat(await decodeForAnalysis(local)));
    const kicks = findKicks(f);
    const drops = findDrops(f, kicks);
    return { plan: planTrack({ title: opts.title, features: f, kicks, drops, bassStemTop2: opts.bassStemTop2 ?? null, marks: opts.marks }), drops: drops.map((d) => d.tS) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type PickedTrack = { audioFileId: string; title: string; artists: string[]; spotifyRank: number | null };

export type QueueInput = { userId: string; eventId: string; artistId: string; options: ReelOptions; tracks: PickedTrack[]; background: Record<string, unknown>; stage: string; roundNo?: number; testId?: string | null };

/** The checks TK2/TK10 make before "Make the reel": 3–5 tracks, the count matches, no Drive-only track under Ranked or Level. */
export function queueRefusal(input: Pick<QueueInput, "options" | "tracks">): string | null {
  const o = { ...DEFAULT_OPTIONS, ...input.options };
  if (input.tracks.length < 3 || input.tracks.length > 5) return "Pick 3 to 5 tracks.";
  if (input.tracks.length !== o.tracks) return `${o.tracks} tracks are set under Edit and ${input.tracks.length} are picked.`;
  for (const t of input.tracks) {
    const tick = canTick(o.framing, t);
    if (!tick.ok) return tick.line;
  }
  return null;
}

/** Queues a reel (TK10's "Make the reel"): one render row; the tick renders it. */
export async function queueReel(db: Db, input: QueueInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const refusal = queueRefusal(input);
  if (refusal) return { ok: false, error: refusal };
  const files = await db.from("creative_lab_audio_files").select(AUDIO_COLUMNS).in("id", input.tracks.map((t) => t.audioFileId));
  if (files.error) return { ok: false, error: files.error.message };
  const rows = (files.data ?? []) as unknown as AudioFileRow[];
  for (const t of input.tracks) {
    const f = rows.find((r) => r.id === t.audioFileId);
    if (!f || f.event_id !== input.eventId) return { ok: false, error: `${t.title}: not this event's file` };
    if (f.unusable_reason || !f.storage_path || f.match_state !== "matched") return { ok: false, error: `${t.title}: match a usable file first` };
    if (f.rights_flag) return { ok: false, error: `${t.title}: Meta muted the audio (rights)` };
  }
  const ins = await db
    .from(TOP_TRACKS_TABLE)
    .insert({
      user_id: input.userId,
      event_id: input.eventId,
      artist_id: input.artistId,
      framing: input.options.framing,
      track_count: input.options.tracks,
      options: input.options,
      tracks: input.tracks,
      background: input.background,
      stage: input.stage,
      round_no: input.roundNo ?? 1,
      test_id: input.testId ?? null,
      status: "queued",
    })
    .select("id")
    .single();
  if (ins.error) return { ok: false, error: ins.error.message };
  return { ok: true, id: (ins.data as { id: string }).id };
}

/** AU3 / TK3: when Meta mutes a reel, every file in it is flagged ("Meta muted the audio (rights) · {n} files flagged"). */
export async function flagReelFiles(db: Db, renderId: string, at: string): Promise<number> {
  const r = await db.from(TOP_TRACKS_TABLE).select("tracks").eq("id", renderId).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  const ids = (((r.data as { tracks?: PickedTrack[] } | null)?.tracks ?? []) as PickedTrack[]).map((t) => t.audioFileId);
  if (!ids.length) return 0;
  const up = await db.from("creative_lab_audio_files").update({ rights_flag: "meta_muted", rights_flagged_at: at }).in("id", ids);
  if (up.error) throw new Error(up.error.message);
  const mark = await db.from(TOP_TRACKS_TABLE).update({ rights_muted_at: at }).eq("id", renderId);
  if (mark.error) throw new Error(mark.error.message);
  return ids.length;
}

export async function readText(file: string): Promise<string> {
  return readFile(file, "utf8");
}
