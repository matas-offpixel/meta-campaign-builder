/**
 * CT2 / CT4: the act's audio files, read from 02 Source / Audio / {artist}
 * and nowhere else. The folder is made on first need (the Snippet tab
 * opening that act). Each new file is downloaded, checked (AU1: WAV, AIFF,
 * FLAC, or MP3 at 128 kbps or more, 30 s or longer), copied as it is to Storage,
 * and read for its drop and waveform. The Drive file is never moved,
 * renamed or deleted: the Lab only reads it (CT2).
 *
 * There is no URL path in: the only source is a Drive file id listed in
 * that folder. creative_lab_audio_files (migration 255).
 *
 * Which drop (TK17, docs/design-record/2026-11-18-creative-lab-top-tracks-2.html):
 * CT4's drop is TK14's drops (the bass returning after a break, on the
 * Demucs bass stem, on Beat This!'s grid) with TK15's choice, CT1's window
 * as the fit: the last in the last third, else the latest earlier one.
 * CT1's window stands (from 4 s before the drop); the hook is Top tracks
 * only. The analysis runs once per file version (TK18), keyed by the Drive
 * id and modified time, and is stored as data. `studio` is the analysis
 * source; with none (the app until its Lambda exists) the file reads TK18's
 * failure line and the marker waits for the operator.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import path from "node:path";

import type { DriveApi, DriveFile } from "../drive/client.ts";
import { APP_TAG_KEY, FOLDER_MIME, SHORTCUT_MIME } from "../drive/client.ts";
import { ensureAudioFolder, type ClientRow, type EventRow } from "../drive/folders.ts";
import { detectDrop, rmsEnvelope, waveformPeaks } from "./drop.ts";
import { analysisKey, type StudioSource } from "./top-tracks/analysis-source.ts";
import { chooseDrop } from "./top-tracks/audio-rules.ts";
import { findBassDrops, studioGrid, type StudioAnalysis } from "./top-tracks/studio.ts";
import { ENVELOPE_RATE } from "./audio-ffmpeg.ts";
import { clampLength, extensionOf, formatOf, looksLikeAudio, unusableReason, windowForDrop, type ProbedAudio } from "./snippet.ts";

type Db = Pick<SupabaseClient, "from">;

export const AUDIO_BUCKET = "campaign-assets";

export type AudioFileRow = {
  id: string;
  event_id: string;
  artist_id: string | null;
  drive_file_id: string;
  drive_file_name: string;
  format: string | null;
  bitrate_kbps: number | null;
  duration_s: number | null;
  storage_path: string | null;
  unusable_reason: string | null;
  spotify_track_id: string | null;
  spotify_title: string | null;
  match_state: "none" | "suggested" | "matched";
  matched_by: string | null;
  matched_at: string | null;
  drop_s: number | null;
  drop_source: "lab" | "operator" | null;
  /** TK15 (migration 260): which rule chose a Lab drop. */
  drop_choice?: "last" | "earlier" | null;
  /** TK18 (migration 260): the stored analysis, its key and state. */
  analysis?: unknown;
  analysis_key?: string | null;
  analysis_state?: "running" | "done" | "failed" | null;
  /** TK3 (migration 260): the HOOK marker (Top tracks only). */
  hook_s?: number | null;
  hook_source?: "lab" | "operator" | "cleared" | null;
  drop_set_by: string | null;
  drop_set_at: string | null;
  window_start_s: number | null;
  length_s: number;
  waveform: number[] | null;
  rights_flag: string | null;
  rights_flagged_at: string | null;
  created_at: string;
};

export type IntakeDeps = {
  drive: DriveApi;
  /** Streams the Drive file to disk (downloadTo), or reads it whole. */
  downloadTo: (fileId: string, filePath: string) => Promise<void>;
  upload: (storagePath: string, filePath: string, contentType: string) => Promise<void>;
  probe: (filePath: string) => Promise<ProbedAudio | null>;
  envelopes: (filePath: string) => Promise<{ full: Uint8Array; low: Uint8Array }>;
  /** TK18: Beat This! + Demucs on the file (analysis-source.ts); none in the app yet. */
  studio?: StudioSource | null;
  tempDir: <T>(fn: (dir: string) => Promise<T>) => Promise<T>;
};

/** The Storage copy's path: the Drive id keeps two files of one name apart. */
export function audioStoragePath(eventId: string, driveFileId: string, fileName: string): string {
  const ext = extensionOf(fileName) || "audio";
  return `audio/creative-lab/${eventId}/${driveFileId}.${ext}`;
}

/** Files in the folder the Lab reads: audio, not a folder or shortcut, not trashed, not one the app made. */
export function audioFilesIn(files: readonly DriveFile[]): DriveFile[] {
  return files.filter((f) => !f.trashed && f.mimeType !== FOLDER_MIME && f.mimeType !== SHORTCUT_MIME && !f.appProperties?.[APP_TAG_KEY] && looksLikeAudio(f));
}

function contentType(format: string | null): string {
  if (format === "wav") return "audio/wav";
  if (format === "aiff") return "audio/aiff";
  if (format === "flac") return "audio/flac";
  if (format === "mp3") return "audio/mpeg";
  return "application/octet-stream";
}

export type ReadResult = {
  format: string | null;
  bitrateKbps: number | null;
  durationS: number | null;
  unusableReason: string | null;
  storagePath: string | null;
  dropS: number | null;
  windowStartS: number | null;
  waveform: number[] | null;
  dropChoice: "last" | "earlier" | null;
  analysis: unknown;
  analysisKey: string | null;
  analysisState: "done" | "failed" | null;
};

/** CT1's window around a drop fits the file: from 4 s before it, 16 s long (the snippet static's own fit, TK3's amendment). */
export function snippetStaticFits(dropS: number, durationS: number): boolean {
  const w = windowForDrop(dropS, durationS, clampLength(null));
  return dropS - 4 >= -1e-6 && Math.abs(w.startS - (dropS - 4)) < 1e-3 && w.startS + w.lengthS <= durationS + 1e-6;
}

/** TK17: TK14's drops with TK15's choice, CT1's window as the fit. */
export function snippetDropFrom(analysis: StudioAnalysis): { dropS: number | null; choice: "last" | "earlier" | null; stored: unknown } {
  const found = findBassDrops(analysis);
  const c = chooseDrop({ drops: found.drops.map((d) => d.tS), durationS: analysis.durationS, downbeats: analysis.downbeats, fits: (t) => snippetStaticFits(t, analysis.durationS) });
  const dropS = "dropS" in c ? c.dropS : null;
  const grid = dropS != null ? studioGrid(analysis.downbeats, dropS) : null;
  return {
    dropS,
    choice: c.kind === "last" || c.kind === "earlier" ? c.kind : null,
    // TK18: the beats, downbeats, per-beat bass levels, R and the drops. Never the stem's audio.
    stored: { v: 2, ...analysis, R: found.R, drops: found.drops, breaks: found.breaks, grid: grid ? (grid.steady ? { steady: true, barS: grid.barS } : { steady: false, reason: grid.reason }) : null },
  };
}

/** Download, check, copy and analyse one file. An unusable file is recorded with its reason and not copied. */
export async function readAudioFile(eventId: string, file: DriveFile, deps: IntakeDeps): Promise<ReadResult> {
  return deps.tempDir(async (dir) => {
    const local = path.join(dir, `source.${extensionOf(file.name) || "audio"}`);
    await deps.downloadTo(file.id, local);
    const probe = await deps.probe(local);
    const reason = unusableReason(probe, file.name);
    const format = probe ? formatOf(probe, file.name) : null;
    const base = { format, bitrateKbps: probe?.bitrateKbps ?? null, durationS: probe?.durationS ?? null, unusableReason: reason };
    if (reason) return { ...base, storagePath: null, dropS: null, windowStartS: null, waveform: null, dropChoice: null, analysis: null, analysisKey: null, analysisState: null };
    const storagePath = audioStoragePath(eventId, file.id, file.name);
    await deps.upload(storagePath, local, contentType(format));
    const { full, low } = await deps.envelopes(local);
    const waveform = waveformPeaks(rmsEnvelope(full, ENVELOPE_RATE));
    let dropS: number | null = null;
    let dropChoice: ReadResult["dropChoice"] = null;
    let analysis: unknown = null;
    let analysisState: ReadResult["analysisState"] = null;
    const key = analysisKey(file.id, file.modifiedTime);
    if (deps.studio === undefined) {
      // A deps with no studio field at all (older callers, fakes): CT4's single best rise, as before #1340.
      dropS = detectDrop(rmsEnvelope(low, ENVELOPE_RATE))?.dropS ?? null;
    } else {
      try {
        if (!deps.studio) throw new Error("no analysis source");
        const tk = snippetDropFrom(await deps.studio.analyse(local));
        dropS = tk.dropS;
        dropChoice = tk.choice;
        analysis = tk.stored;
        analysisState = "done";
      } catch (err) {
        // TK18: "Couldn't read this track's beat — drag the drop marker to it."
        analysis = { v: 2, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
        analysisState = "failed";
      }
    }
    const window = dropS != null && probe?.durationS ? windowForDrop(dropS, probe.durationS, clampLength(null)) : null;
    return { ...base, storagePath, dropS, windowStartS: window?.startS ?? null, waveform, dropChoice, analysis, analysisKey: deps.studio === undefined ? null : key, analysisState };
  });
}

export type ScanResult = { folderId: string | null; files: AudioFileRow[]; added: number; failed: { name: string; error: string }[] };

/**
 * The act's folder (made on first need) and its audio files, new ones read
 * in. A renamed Drive file keeps its row and takes the new name.
 */
export async function scanArtistAudio(
  db: Db,
  deps: IntakeDeps & { ensureFolder?: typeof ensureAudioFolder },
  input: { event: EventRow; client: ClientRow; artist: { libraryArtistId: string; name: string }; userId: string },
): Promise<ScanResult> {
  const ensure = deps.ensureFolder ?? ensureAudioFolder;
  const folderId = await ensure(db as never, deps.drive, input.event, input.client, input.artist);
  if (!folderId) return { folderId: null, files: await loadAudioRows(db, input.event.id, input.artist.libraryArtistId), added: 0, failed: [] };
  const inFolder = audioFilesIn(await deps.drive.listChildren(folderId));
  const known = new Map((await loadAudioRows(db, input.event.id, null)).map((row) => [row.drive_file_id, row]));
  let added = 0;
  const failed: ScanResult["failed"] = [];
  for (const file of inFolder) {
    const row = known.get(file.id);
    if (row) {
      if (row.drive_file_name !== file.name) {
        const res = await db.from("creative_lab_audio_files").update({ drive_file_name: file.name }).eq("id", row.id);
        if (res.error) throw new Error(`creative_lab_audio_files: ${res.error.message}`);
      }
      continue;
    }
    try {
      const read = await readAudioFile(input.event.id, file, deps);
      const insert = await db.from("creative_lab_audio_files").insert({
        user_id: input.userId,
        event_id: input.event.id,
        artist_id: input.artist.libraryArtistId,
        drive_file_id: file.id,
        drive_file_name: file.name,
        drive_folder_id: folderId,
        mime_type: file.mimeType,
        format: read.format,
        bitrate_kbps: read.bitrateKbps,
        duration_s: read.durationS,
        storage_path: read.storagePath,
        unusable_reason: read.unusableReason,
        drop_s: read.dropS,
        drop_source: read.dropS != null ? "lab" : null,
        ...(read.analysisState != null ? { analysis: read.analysis, analysis_key: read.analysisKey, analysis_state: read.analysisState, drop_choice: read.dropChoice } : {}),
        window_start_s: read.windowStartS,
        waveform: read.waveform,
      });
      if (insert.error) throw new Error(`creative_lab_audio_files: ${insert.error.message}`);
      added += 1;
    } catch (err) {
      failed.push({ name: file.name, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
    }
  }
  return { folderId, files: await loadAudioRows(db, input.event.id, input.artist.libraryArtistId), added, failed };
}

/**
 * The columns the Lab reads. AU2 withdrew the supplier step: migration 255's
 * supplier columns stay in the table unused and are never read.
 */
export const AUDIO_COLUMNS =
  "id, event_id, artist_id, drive_file_id, drive_file_name, format, bitrate_kbps, duration_s, storage_path, unusable_reason, spotify_track_id, spotify_title, match_state, matched_by, matched_at, drop_s, drop_source, drop_set_by, drop_set_at, window_start_s, length_s, waveform, rights_flag, rights_flagged_at, created_at";

/** Migration 260's columns (TK15–TK18), read only where Top tracks needs them, so the Snippet tab works before 260 is applied. */
export const AUDIO_COLUMNS_260 = `${AUDIO_COLUMNS}, analysis, analysis_key, analysis_state, drop_choice, hook_s, hook_source, hook_set_by, hook_set_at`;

export async function loadAudioRows(db: Db, eventId: string, artistId: string | null): Promise<AudioFileRow[]> {
  let query = db.from("creative_lab_audio_files").select(AUDIO_COLUMNS).eq("event_id", eventId);
  if (artistId) query = query.eq("artist_id", artistId);
  const res = await query.order("created_at", { ascending: true }).range(0, 999);
  if (res.error) throw new Error(`creative_lab_audio_files: ${res.error.message}`);
  return (res.data ?? []) as AudioFileRow[];
}
