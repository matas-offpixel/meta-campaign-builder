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
 */

import { audioRuleException } from "./audio-exceptions.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import path from "node:path";

import type { DriveApi, DriveFile } from "../drive/client.ts";
import { APP_TAG_KEY, FOLDER_MIME, SHORTCUT_MIME } from "../drive/client.ts";
import { ensureAudioFolder, type ClientRow, type EventRow } from "../drive/folders.ts";
import { detectDrop, rmsEnvelope, waveformPeaks } from "./drop.ts";
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
};

/** Download, check, copy and analyse one file. An unusable file is recorded with its reason and not copied. */
export async function readAudioFile(eventId: string, file: DriveFile, deps: IntakeDeps): Promise<ReadResult> {
  return deps.tempDir(async (dir) => {
    const local = path.join(dir, `source.${extensionOf(file.name) || "audio"}`);
    await deps.downloadTo(file.id, local);
    const probe = await deps.probe(local);
    const exception = audioRuleException(eventId, file.id);
    const reason = unusableReason(probe, file.name, { minMp3Kbps: exception?.minMp3Kbps });
    const format = probe ? formatOf(probe, file.name) : null;
    const base = { format, bitrateKbps: probe?.bitrateKbps ?? null, durationS: probe?.durationS ?? null, unusableReason: reason };
    if (reason) return { ...base, storagePath: null, dropS: null, windowStartS: null, waveform: null };
    const storagePath = audioStoragePath(eventId, file.id, file.name);
    await deps.upload(storagePath, local, contentType(format));
    const { full, low } = await deps.envelopes(local);
    const drop = detectDrop(rmsEnvelope(low, ENVELOPE_RATE));
    const waveform = waveformPeaks(rmsEnvelope(full, ENVELOPE_RATE));
    const window = drop && probe?.durationS ? windowForDrop(drop.dropS, probe.durationS, clampLength(null)) : null;
    return { ...base, storagePath, dropS: drop?.dropS ?? null, windowStartS: window?.startS ?? null, waveform };
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

export async function loadAudioRows(db: Db, eventId: string, artistId: string | null): Promise<AudioFileRow[]> {
  let query = db.from("creative_lab_audio_files").select(AUDIO_COLUMNS).eq("event_id", eventId);
  if (artistId) query = query.eq("artist_id", artistId);
  const res = await query.order("created_at", { ascending: true }).range(0, 999);
  if (res.error) throw new Error(`creative_lab_audio_files: ${res.error.message}`);
  return (res.data ?? []) as AudioFileRow[];
}
