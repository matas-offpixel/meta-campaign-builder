/**
 * The audio snippet static, pure parts (docs/design-record/2026-11-16-creative-testing.html,
 * CT1–CT5, CT10, and TT5's flag):
 *
 * - CT1 the format: one 9:16 static held for the snippet, 1080 × 1920, the
 *   snippet its only sound. 15 to 20 seconds, 16 by default, from 4 s before
 *   the drop to 12 s after. A 0.25 s fade in, a 1.5 s fade out, −14 LUFS with
 *   peaks no higher than −1 dBTP, AAC at 256 kbps. The S14 file name.
 * - CT2 the source: 02 Source / Audio / {artist} only. AU1 (2026-11-16-creative-testing-4.html):
 *   WAV, AIFF, FLAC, or MP3 at 128 kbps or more, at least 30 seconds, with
 *   three reasons worded exactly. AU2: no supplier step; the file line
 *   "{file name} · {format}" (an MP3 adds its bitrate) replaces the rights
 *   note. AU3: a flagged file's line adds " · Meta muted the audio (rights)".
 * - CT3 the picker: Spotify's top tracks in Spotify's order, the file state
 *   per row, "{n} of 5 picked", and Drive files that match no top track.
 * - CT4 / CT5 the drop marker, the window and the preview span.
 *
 * Every string here is the record's. Pure: no Drive, no ffmpeg, no database.
 */

import { artistSlug } from "../drive/tree.ts";

export const SNIPPET = {
  width: 1080,
  height: 1920,
  fps: 30,
  minLength: 15,
  maxLength: 20,
  defaultLength: 16,
  /** The window starts this long before the drop. */
  preDrop: 4,
  fadeIn: 0.25,
  fadeOut: 1.5,
  lufs: -14,
  truePeak: -1,
  audioBitrateK: 256,
  /** CT2: the least a file may run; AU1: an MP3's least bitrate. */
  minFileSeconds: 30,
  minMp3Kbps: 128,
  /** CT4: no drop is looked for in the first 20 seconds. */
  dropSearchFrom: 20,
  /** CT3: Spotify's top tracks shown, and the most Test 1 takes. */
  topTracks: 10,
  maxPicks: 5,
  minPicks: 2,
  /** CT5: the preview re-renders after this pause. */
  previewDebounceMs: 1000,
  /** CT3: Spotify is read once a day per act. */
  spotifyCacheMs: 24 * 60 * 60 * 1000,
} as const;

/** CT2: the audio folder's path under the event folder. */
export const AUDIO_FOLDER = "Audio";

export const LENGTHS: readonly number[] = [15, 16, 17, 18, 19, 20];

// ── CT2: files ──────────────────────────────────────────────────────────────

export type AudioFormat = "wav" | "aiff" | "flac" | "mp3";

export type ProbedAudio = {
  /** ffmpeg's decoder name (pcm_s16le, flac, mp3, …). */
  codec: string | null;
  /** The container ffmpeg read (wav, aiff, flac, mp3, mov,mp4,…). */
  container: string | null;
  bitrateKbps: number | null;
  durationS: number | null;
};

const EXT_FORMAT: Record<string, AudioFormat> = { wav: "wav", wave: "wav", aif: "aiff", aiff: "aiff", aifc: "aiff", flac: "flac", mp3: "mp3" };

export function extensionOf(name: string): string {
  return /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
}

/** Whether a Drive file is audio worth reading at all (by type or extension). */
export function looksLikeAudio(file: { name: string; mimeType?: string | null }): boolean {
  return (file.mimeType ?? "").toLowerCase().startsWith("audio/") || extensionOf(file.name) in EXT_FORMAT || ["m4a", "aac", "ogg", "opus", "wma"].includes(extensionOf(file.name));
}

/** The format ffmpeg found, from the container first and the codec second. */
export function formatOf(probe: ProbedAudio, fileName: string): AudioFormat | null {
  const container = (probe.container ?? "").toLowerCase();
  const codec = (probe.codec ?? "").toLowerCase();
  if (container.split(",").includes("wav")) return "wav";
  if (container.split(",").includes("aiff")) return "aiff";
  if (container.split(",").includes("flac") || codec === "flac") return container.includes("mp4") || container.includes("ogg") ? null : "flac";
  if (container.split(",").includes("mp3") || codec === "mp3" || codec === "mp3float") return "mp3";
  if (!container && !codec) return EXT_FORMAT[extensionOf(fileName)] ?? null;
  return null;
}

/** AU1's three reasons, worded exactly ("Can't use this file: {reason}"). */
export const REASON_MP3_LOW = "MP3 under 128 kbps";
export const REASON_SHORT = "shorter than 30 seconds";
export const REASON_UNREADABLE = "it can't be read";

/**
 * AU1's check: WAV, AIFF, FLAC, or MP3 at 128 kbps or more, at least 30
 * seconds. Anything the Lab can't open or doesn't recognise as one of those
 * is "it can't be read".
 */
export function unusableReason(probe: ProbedAudio | null, fileName: string): string | null {
  if (!probe || (probe.durationS == null && !probe.codec)) return REASON_UNREADABLE;
  const format = formatOf(probe, fileName);
  if (!format) return REASON_UNREADABLE;
  if (format === "mp3" && (probe.bitrateKbps == null || probe.bitrateKbps < SNIPPET.minMp3Kbps)) return REASON_MP3_LOW;
  if (probe.durationS == null || probe.durationS < SNIPPET.minFileSeconds) return REASON_SHORT;
  return null;
}

export function cantUseText(reason: string): string {
  return `Can't use this file: ${reason}`;
}

const FORMAT_WORD: Record<AudioFormat, string> = { wav: "WAV", aiff: "AIFF", flac: "FLAC", mp3: "MP3" };

/** AU2's file line: "track two (club mix).aiff · AIFF", "LD - Track Three.mp3 · MP3 128 kbps". */
export function fileLine(input: { fileName: string; format: string | null; bitrateKbps: number | null }): string {
  const format = (input.format ?? "") as AudioFormat;
  const word = FORMAT_WORD[format] ?? (input.format ?? "").toUpperCase();
  const bitrate = format === "mp3" && input.bitrateKbps ? ` ${Math.round(input.bitrateKbps)} kbps` : "";
  return word ? `${input.fileName} · ${word}${bitrate}` : input.fileName;
}

/** AU3: a flagged file's line. */
export function mutedLine(line: string): string {
  return `${line} · Meta muted the audio (rights)`;
}

// ── CT3: the picker ─────────────────────────────────────────────────────────

export type TopTrack = { id: string; title: string; rank: number };

/** "{n} · {title}". */
export function trackRowTitle(track: TopTrack): string {
  return `${track.rank} · ${track.title}`;
}

export function pickedText(n: number): string {
  return `${n} of ${SNIPPET.maxPicks} picked`;
}

export const NO_FILE_YET = "No file in Drive yet";
export const MATCH = "Match";
export const SPOTIFY_NO_ANSWER = "Spotify didn't answer, so the top tracks can't be listed. Pick from the Drive files below.";

export function looksLikeText(fileName: string): string {
  return `Looks like ${fileName}`;
}

export function notInTopText(fileName: string): string {
  return `${fileName} · not in Spotify's top tracks`;
}

/** Words of a title or file name, for matching: lower case, accents off, brackets, mixes and the act's name kept out. */
export function titleWords(text: string, artistName = ""): string[] {
  const drop = new Set(["the", "a", "an", "and", "feat", "ft", "featuring", "x", "vs", "original", "mix", "edit", "extended", "radio", "club", "master", "final", "wav", "aiff", "aif", "flac", "mp3"]);
  const artist = new Set(norm(artistName).split(" ").filter(Boolean));
  return norm(text.replace(/\.[a-z0-9]{2,5}$/i, ""))
    .split(" ")
    .filter((w) => w && !drop.has(w) && !artist.has(w) && !/^\d+$/.test(w));
}

function norm(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * CT3: "Matching is by title, and an operator confirms it." A file suggests a
 * track when every word of the track's title is in the file name. The best
 * suggestion is the longest such title; a tie suggests nothing.
 */
export function suggestTrack(fileName: string, tracks: readonly TopTrack[], artistName = ""): TopTrack | null {
  const fileWords = new Set(titleWords(fileName, artistName));
  const hits = tracks
    .map((track) => ({ track, words: titleWords(track.title, artistName) }))
    .filter(({ words }) => words.length > 0 && words.every((w) => fileWords.has(w)))
    .sort((a, b) => b.words.length - a.words.length);
  if (!hits.length) return null;
  if (hits.length > 1 && hits[0]!.words.length === hits[1]!.words.length) return null;
  return hits[0]!.track;
}

export type FileState = "matched" | "suggested" | "none" | "held" | "unusable" | "flagged";

/**
 * What a picker row can do (AU2): only a matched file that passes AU1, and
 * isn't flagged (AU3), can be picked. A Drive file that matches no top track
 * can still be picked (CT3): ticking it is its match, stored with no Spotify
 * track (matched, spotify_track_id null). A snippet also needs its drop
 * marker before it renders (CT4).
 */
export function pickable(file: { matchState: string; unusableReason: string | null; rightsFlag: string | null }): boolean {
  return file.matchState === "matched" && !file.unusableReason && !file.rightsFlag;
}

// ── CT4 / CT5: the drop and the window ─────────────────────────────────────

/** "1:04". */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function dropLabel(dropS: number): string {
  return `DROP · ${mmss(dropS)}`;
}

export const DROP_FOUND = "Drop found by the Lab";
export const NO_CLEAR_DROP = "No clear drop found. Pick where it lands.";
export const PREVIEW_FAILED = "Preview didn't render. Try again.";

export function dropSetBy(firstName: string): string {
  return `Drop set by ${firstName}`;
}

export function clampLength(length: number | null | undefined): number {
  const n = Math.round(Number(length ?? SNIPPET.defaultLength));
  if (!Number.isFinite(n)) return SNIPPET.defaultLength;
  return Math.min(SNIPPET.maxLength, Math.max(SNIPPET.minLength, n));
}

/** CT4: the window starts 4 s before the drop, inside the track. */
export function windowForDrop(dropS: number, durationS: number, length: number = SNIPPET.defaultLength): { startS: number; lengthS: number } {
  return clampWindow(dropS - SNIPPET.preDrop, durationS, length);
}

/** A window moved alone (CT4: "Drag the window to move the start alone"), kept inside the track. */
export function clampWindow(startS: number, durationS: number, length: number): { startS: number; lengthS: number } {
  const lengthS = clampLength(length);
  const max = Math.max(0, durationS - lengthS);
  const start = Math.min(max, Math.max(0, startS));
  return { startS: Math.round(start * 1000) / 1000, lengthS };
}

/** CT5: "{start}–{end} · {length} s". */
export function spanText(startS: number, lengthS: number): string {
  return `${mmss(startS)}–${mmss(startS + lengthS)} · ${lengthS} s`;
}

/** The window a file runs: its stored start and length, kept inside the track. */
export function fileWindow(file: { window_start_s: number | null; length_s: number | null; duration_s: number | null; drop_s: number | null }): { startS: number; lengthS: number } {
  const duration = Number(file.duration_s ?? 0);
  const start = file.window_start_s ?? (file.drop_s != null ? Number(file.drop_s) - SNIPPET.preDrop : 0);
  return clampWindow(Number(start), duration, clampLength(file.length_s));
}

// ── CT1: the file name ──────────────────────────────────────────────────────

export type SnippetNameInput = {
  eventCode: string | null;
  artistName: string;
  /** The track's place in the picker (CT1's {track n}). */
  trackN: number;
  /** The static's own S14 name (without extension). */
  staticName: string;
  stage: string;
  roundNo: number;
};

/** {event code}_{artist}-{track n}_snippet-{static}-{stage}_r{n}_9x16.mp4 (CT1). */
export function snippetFileName(input: SnippetNameInput): string {
  const code = input.eventCode?.trim();
  const staticName = input.staticName.replace(/\.[a-z0-9]{2,5}$/i, "");
  const body = `${artistSlug(input.artistName)}-${input.trackN}_snippet-${staticName}-${input.stage}_r${input.roundNo}_9x16.mp4`;
  return code ? `${code}_${body}` : body;
}

// ── CT10 / TT5 ──────────────────────────────────────────────────────────────

export const SNIPPET_TAB = "Snippet";

export function staticLabel(name: string): string {
  return `Static: ${name}`;
}

/** The button: "Make Test 1 · 3 snippets" (CT-A). */
export function makeTestText(n: number, count: number): string {
  return `Make Test ${n} · ${count} snippet${count === 1 ? "" : "s"}`;
}

/** CT10: render rows carry "Test {n} · {variant}". */
export function testTag(n: number, variant: string): string {
  return `Test ${n} · ${variant}`;
}
