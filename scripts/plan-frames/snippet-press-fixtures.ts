/**
 * SNP-A / SNP-B: the Lab's Snippet tab, one window, on a file with no drop
 * (NO_CLEAR_DROP), before and after a press on the waveform at 30 % of the
 * track (CT4's marker, the M3d-b fix: a press places the marker there and
 * saves it via edit { kind: "drop" }, the same as releasing a drag). The
 * "after" file is the "before" row with the press's own patch applied
 * (pressSeconds → editPatch), so the frame shows what the save writes.
 * Show and act names only; no new words.
 */

import type { AudioFileRow } from "../../lib/creative-tests/audio-intake.ts";
import { editPatch } from "../../lib/creative-tests/audio-edits.ts";
import { pressSeconds } from "../../lib/creative-tests/press.ts";
import { buildSnippetView, type FileView } from "../../lib/creative-tests/snippet-view.ts";
import type { TopTrack } from "../../lib/creative-tests/snippet.ts";
import { fixtureWaveform } from "./snippet-fixtures.ts";

export const SNIPPET_PRESS_FRAME_IDS = ["SNPA", "SNPB"] as const;

const OPERATOR = "frame-operator";
const AT = "2026-11-26T09:00:00.000Z";
const LUKE = "luke-dean";
const DURATION = 192;
/** The press: 30 % across a 1000 px waveform. */
export const PRESS = { box: { left: 0, width: 1000 }, clientX: 300 } as const;

const TRACKS: TopTrack[] = [{ id: "t2", title: "Track two", rank: 1 }];

export const NO_DROP_FILE: AudioFileRow = {
  id: "f-nodrop",
  event_id: "frame-event",
  artist_id: LUKE,
  drive_file_id: "drive-f-nodrop",
  drive_file_name: "track two (club mix).aiff",
  format: "aiff",
  bitrate_kbps: 1411,
  duration_s: DURATION,
  storage_path: "audio/creative-lab/frame-event/drive-f-nodrop.aiff",
  unusable_reason: null,
  spotify_track_id: "t2",
  spotify_title: "Track two",
  match_state: "matched",
  matched_by: OPERATOR,
  matched_at: AT,
  drop_s: null,
  drop_source: null,
  drop_set_by: null,
  drop_set_at: null,
  window_start_s: null,
  length_s: 16,
  waveform: fixtureWaveform(400, DURATION, 58),
  rights_flag: null,
  rights_flagged_at: null,
  created_at: AT,
};

/** The row after the press, as saveAudioEdit writes it. */
export function pressedFile(): AudioFileRow {
  const dropS = pressSeconds(PRESS.clientX, PRESS.box, DURATION);
  const patch = editPatch(NO_DROP_FILE, { kind: "drop", dropS }, OPERATOR, AT);
  if ("refused" in patch) throw new Error(String(patch.refused));
  return { ...NO_DROP_FILE, ...(patch as Partial<AudioFileRow>) };
}

export function snippetPressFile(id: string): FileView {
  const row = id === "SNPB" ? pressedFile() : NO_DROP_FILE;
  const view = buildSnippetView({
    eventId: "frame-event",
    eventCode: "P26-BDAY",
    acts: [{ id: LUKE, name: "Luke Dean" }],
    actId: LUKE,
    tracks: TRACKS,
    files: [row],
    names: new Map([[OPERATOR, "Matas"]]),
    statics: [],
    renders: [],
    testN: null,
    testState: null,
    variantLabels: new Map(),
  });
  return view.rows[0]!.file!;
}
