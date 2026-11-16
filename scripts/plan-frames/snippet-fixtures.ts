/**
 * CT-A and CT-B (docs/design-record/2026-11-16-creative-testing.html): the
 * Lab's Snippet tab for P26-BDAY, with the record's invented tracks. Show
 * and act names only; the operator's first name is the record's.
 *
 * CT-A: the track picker, 3 of 5 picked, track 5 held (no supplier), so
 *       "Make Test 1" waits.
 * CT-B: Track two open: the drop at 0:58, the window 0:54–1:10 · 16 s.
 */

import type { AudioFileRow } from "../../lib/creative-tests/audio-intake.ts";
import { buildSnippetView, type SnippetView } from "../../lib/creative-tests/snippet-view.ts";
import type { TopTrack } from "../../lib/creative-tests/snippet.ts";

export const SNIPPET_FRAME_IDS = ["CTA", "CTB"] as const;

const OPERATOR = "frame-operator";
const AT = "2026-11-16T12:00:00.000Z";
const LUKE = "luke-dean";
const ENZO = "enzo-siragusa";

const TRACKS: TopTrack[] = ["Track one", "Track two", "Track three", "Track four", "Track five"].map((title, i) => ({ id: `t${i + 1}`, title, rank: i + 1 }));

/** A waveform that reads as a track: quiet intro, a build, the drop, a break. */
export function fixtureWaveform(n = 400, durationS = 192, dropS = 58): number[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * durationS;
    const wobble = 0.12 * Math.abs(Math.sin(i * 1.7)) + 0.06 * Math.abs(Math.sin(i * 0.31));
    const body = t < 16 ? 0.25 : t < dropS - 8 ? 0.55 : t < dropS ? 0.3 : t < 130 ? 0.88 : t < 150 ? 0.4 : 0.82;
    return Math.round(Math.min(1, body + wobble) * 1000) / 1000;
  });
}

function file(id: string, extra: Partial<AudioFileRow>): AudioFileRow {
  return {
    id,
    event_id: "frame-event",
    artist_id: LUKE,
    drive_file_id: `drive-${id}`,
    drive_file_name: `${id}.wav`,
    format: "wav",
    bitrate_kbps: 1411,
    duration_s: 192,
    storage_path: `audio/creative-lab/frame-event/drive-${id}.wav`,
    unusable_reason: null,
    supplier: null,
    supplier_set_by: null,
    supplier_set_at: null,
    spotify_track_id: null,
    spotify_title: null,
    match_state: "none",
    matched_by: null,
    matched_at: null,
    drop_s: null,
    drop_source: null,
    drop_set_by: null,
    drop_set_at: null,
    window_start_s: null,
    length_s: 16,
    waveform: null,
    rights_flag: null,
    rights_flagged_at: null,
    created_at: AT,
    ...extra,
  };
}

const supplied = (supplier: "client" | "artist_team") => ({ supplier, supplier_set_by: OPERATOR, supplier_set_at: AT });

export const SNIPPET_FILES: AudioFileRow[] = [
  file("f1", { drive_file_name: "LD_track-one_master.wav", ...supplied("client"), spotify_track_id: "t1", spotify_title: "Track one", match_state: "matched", drop_s: 64, drop_source: "lab", window_start_s: 60, waveform: fixtureWaveform(400, 192, 64) }),
  file("f2", { drive_file_name: "track two (club mix).aiff", format: "aiff", ...supplied("artist_team"), spotify_track_id: "t2", spotify_title: "Track two", match_state: "matched", drop_s: 58, drop_source: "lab", window_start_s: 54, waveform: fixtureWaveform() }),
  file("f3", { drive_file_name: "LD - Track Three.mp3", format: "mp3", bitrate_kbps: 320, drop_s: 71, drop_source: "lab", window_start_s: 67 }),
  file("f5", { drive_file_name: "LD_track-five.wav", spotify_track_id: "t5", spotify_title: "Track five", match_state: "matched", drop_s: 49, drop_source: "lab", window_start_s: 45 }),
  file("fx", { drive_file_name: "LD_unreleased-edit.wav", ...supplied("artist_team"), match_state: "matched", drop_s: 40, drop_source: "lab", window_start_s: 36 }),
];

export function snippetFixtureView(): SnippetView {
  return buildSnippetView({
    eventId: "frame-event",
    eventCode: "P26-BDAY",
    clientName: "Puzzle",
    acts: [
      { id: LUKE, name: "Luke Dean" },
      { id: ENZO, name: "Enzo Siragusa" },
    ],
    actId: LUKE,
    tracks: TRACKS,
    files: SNIPPET_FILES,
    names: new Map([[OPERATOR, "Matas"]]),
    statics: [{ driveFileId: "static-1", name: "P26-BDAY_puzzle_t2-roll-call-w23nov_9x16", fileName: "P26-BDAY_puzzle_t2-roll-call-w23nov_9x16.png" }],
    renders: [],
    testN: null,
    testState: null,
    variantLabels: new Map(),
  });
}

/** CT-A's picks: tracks 1, 2 and 5 (5 held). */
export const CTA_PICKS = ["f1", "f2", "f5"];
