/**
 * The Snippet tab's view (CT3–CT5, CT10, TT5, as AU1–AU4 re-rule them), built from rows. Pure, no
 * server imports: the route builds it, the panel and the CT-A / CT-B frames
 * draw it.
 */

import type { AudioFileRow } from "./audio-intake.ts";
import {
  DROP_FOUND,
  NO_FILE_YET,
  SPOTIFY_NO_ANSWER,
  cantUseText,
  dropLabel,
  dropSetBy,
  fileLine,
  fileWindow,
  looksLikeText,
  makeTestText,
  mutedLine,
  notInTopText,
  pickable,
  pickedText,
  spanText,
  staticLabel,
  suggestTrack,
  testTag,
  trackRowTitle,
  type TopTrack,
} from "./snippet.ts";

export type ActChip = { id: string; name: string; open: boolean };

export type FileView = {
  id: string;
  fileName: string;
  /** The row's line under the title (AU2–AU3): the file line, "Looks like …", why it can't be used, or the muted file line. */
  note: string | null;
  noteTone: "plain" | "failed";
  /** "Match" on a suggested file. */
  suggestion: { trackId: string; title: string } | null;
  pickable: boolean;
  flagged: boolean;
  durationS: number;
  dropS: number | null;
  dropLabel: string | null;
  dropSource: string | null;
  startS: number;
  lengthS: number;
  span: string;
  waveform: number[];
};

export type PickerRow = { key: string; title: string; trackId: string | null; file: FileView | null; empty: string | null };

export type RenderView = { id: string; tag: string | null; fileName: string | null; status: string; note: string | null; approved: boolean; driveFailed: boolean };

export type SnippetView = {
  eventId: string;
  eventCode: string | null;
  acts: ActChip[];
  actName: string | null;
  heading: string | null;
  spotifyLine: string | null;
  rows: PickerRow[];
  extras: PickerRow[];
  statics: { driveFileId: string; name: string; fileName: string; label: string }[];
  renders: RenderView[];
  testState: string | null;
};

export type ViewInput = {
  eventId: string;
  eventCode: string | null;
  acts: { id: string; name: string }[];
  actId: string | null;
  tracks: TopTrack[] | null;
  files: AudioFileRow[];
  names: ReadonlyMap<string, string>;
  statics: { driveFileId: string; name: string; fileName: string }[];
  renders: { id: string; audio_file_id: string; status: string; file_name: string | null; approved_at: string | null; drive_status: string | null; test_id: string | null; error: string | null }[];
  testN: number | null;
  testState: string | null;
  variantLabels: ReadonlyMap<string, string>;
};

/** Spotify's heading in AU-A: "Spotify's top tracks for {act} · {n} of 5 picked". */
export function pickerHeading(actName: string, picked: number): string {
  return `Spotify's top tracks for ${actName} · ${pickedText(picked)}`;
}

/** AU-A at 393: "{act} · {n} of 5 picked". */
export function pickerHeadingShort(actName: string, picked: number): string {
  return `${actName} · ${pickedText(picked)}`;
}

export function fileView(file: AudioFileRow, ctx: { artistName: string; names: ReadonlyMap<string, string>; tracks: TopTrack[] }): FileView {
  const who = (id: string | null) => (id ? ctx.names.get(id) ?? "Someone" : "Someone");
  const win = fileWindow(file);
  const line = fileLine({ fileName: file.drive_file_name, format: file.format, bitrateKbps: file.bitrate_kbps });
  const open = !file.unusable_reason && !file.rights_flag;
  const suggestion = open && file.match_state !== "matched" ? suggestTrack(file.drive_file_name, ctx.tracks, ctx.artistName) : null;
  let note: string;
  let tone: FileView["noteTone"] = "plain";
  if (file.unusable_reason) {
    note = cantUseText(file.unusable_reason);
    tone = "failed";
  } else if (file.rights_flag) {
    note = mutedLine(line);
    tone = "failed";
  } else if (suggestion) {
    note = looksLikeText(file.drive_file_name);
  } else {
    note = line;
  }
  const drop = file.drop_s != null ? Number(file.drop_s) : null;
  return {
    id: file.id,
    fileName: file.drive_file_name,
    note,
    noteTone: tone,
    suggestion: suggestion ? { trackId: suggestion.id, title: suggestion.title } : null,
    pickable: pickable({ matchState: file.match_state, unusableReason: file.unusable_reason, rightsFlag: file.rights_flag }),
    flagged: Boolean(file.rights_flag),
    durationS: Number(file.duration_s ?? 0),
    dropS: drop,
    dropLabel: drop != null ? dropLabel(drop) : null,
    dropSource: drop == null ? null : file.drop_source === "operator" ? dropSetBy(who(file.drop_set_by)) : DROP_FOUND,
    startS: win.startS,
    lengthS: win.lengthS,
    span: spanText(win.startS, win.lengthS),
    waveform: Array.isArray(file.waveform) ? file.waveform : [],
  };
}

export function buildSnippetView(input: ViewInput): SnippetView {
  const act = input.acts.find((a) => a.id === input.actId) ?? input.acts[0] ?? null;
  const acts = input.acts.map((a) => ({ ...a, open: a.id === act?.id }));
  if (!act) return { eventId: input.eventId, eventCode: input.eventCode, acts, actName: null, heading: null, spotifyLine: null, rows: [], extras: [], statics: [], renders: [], testState: input.testState };
  const tracks = input.tracks ?? [];
  const files = input.files.filter((f) => f.artist_id === act.id);
  const ctx = { artistName: act.name, names: input.names, tracks };
  const byTrack = new Map<string, AudioFileRow>();
  for (const f of files) if (f.spotify_track_id && f.match_state === "matched") byTrack.set(f.spotify_track_id, f);
  const used = new Set<string>();
  const rows: PickerRow[] = tracks.map((track) => {
    let file = byTrack.get(track.id) ?? null;
    if (!file) {
      // A suggested file sits on the track it looks like, waiting for "Match"; one that fails AU1 sits there with its reason.
      file = files.find((f) => f.match_state !== "matched" && !used.has(f.id) && suggestTrack(f.drive_file_name, tracks, act.name)?.id === track.id) ?? null;
    }
    if (file) used.add(file.id);
    return { key: track.id, title: trackRowTitle(track), trackId: track.id, file: file ? fileView(file, ctx) : null, empty: file ? null : NO_FILE_YET };
  });
  const extras: PickerRow[] = files
    .filter((f) => !used.has(f.id))
    .map((f) => ({ key: f.id, title: notInTopText(f.drive_file_name), trackId: null, file: fileView(f, ctx), empty: null }));
  const renders: RenderView[] = input.renders
    .filter((r) => files.some((f) => f.id === r.audio_file_id))
    .map((r) => {
      const file = files.find((f) => f.id === r.audio_file_id)!;
      const view = fileView(file, ctx);
      const label = input.variantLabels.get(r.id) ?? null;
      return {
        id: r.id,
        tag: r.test_id && input.testN && label ? testTag(input.testN, label) : null,
        fileName: r.file_name,
        status: r.status,
        note: fileLine({ fileName: file.drive_file_name, format: file.format, bitrateKbps: file.bitrate_kbps }),
        approved: Boolean(r.approved_at),
        driveFailed: r.drive_status === "failed",
      };
    });
  return {
    eventId: input.eventId,
    eventCode: input.eventCode,
    acts,
    actName: act.name,
    heading: tracks.length ? pickerHeading(act.name, 0) : null,
    spotifyLine: input.tracks == null ? SPOTIFY_NO_ANSWER : null,
    rows,
    extras,
    statics: input.statics.map((s) => ({ ...s, label: staticLabel(s.name) })),
    renders,
    testState: input.testState,
  };
}

/** The button's words for the picks the panel holds (CT-A). */
export function makeButtonText(picked: number): string {
  return makeTestText(1, picked);
}
