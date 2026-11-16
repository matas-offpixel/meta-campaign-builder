/**
 * AU-A (docs/design-record/2026-11-16-creative-testing-4.html, redrawing
 * CT-A) and CT-B (2026-11-16-creative-testing.html): the Lab's Snippet tab
 * for P26-BDAY, with the records' invented tracks. Show and act names only.
 *
 * AU-A: the track picker, 3 of 5 picked (tracks 1–3; track 3 a 128 kbps MP3
 *       that passes), track 4's MP3 under 128 kbps, track 5 no file, track 6
 *       muted by Meta in an earlier test (flagged, tick off).
 * CT-B: Track two open: the drop at 0:58, the window 0:54–1:10 · 16 s, the
 *       file line under it (AU2).
 */

import type { AudioFileRow } from "../../lib/creative-tests/audio-intake.ts";
import { buildSnippetView, type SnippetView } from "../../lib/creative-tests/snippet-view.ts";
import type { TopTrack } from "../../lib/creative-tests/snippet.ts";

export const SNIPPET_FRAME_IDS = ["AUA", "CTB"] as const;

const OPERATOR = "frame-operator";
const AT = "2026-11-16T12:00:00.000Z";
const LUKE = "luke-dean";
const ENZO = "enzo-siragusa";

const TRACKS: TopTrack[] = ["Track one", "Track two", "Track three", "Track four", "Track five", "Track six"].map((title, i) => ({ id: `t${i + 1}`, title, rank: i + 1 }));

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

export const SNIPPET_FILES: AudioFileRow[] = [
  file("f1", { drive_file_name: "LD_track-one_master.wav", spotify_track_id: "t1", spotify_title: "Track one", match_state: "matched", matched_by: OPERATOR, drop_s: 64, drop_source: "lab", window_start_s: 60, waveform: fixtureWaveform(400, 192, 64) }),
  file("f2", { drive_file_name: "track two (club mix).aiff", format: "aiff", spotify_track_id: "t2", spotify_title: "Track two", match_state: "matched", matched_by: OPERATOR, drop_s: 58, drop_source: "lab", window_start_s: 54, waveform: fixtureWaveform() }),
  file("f3", { drive_file_name: "LD - Track Three.mp3", format: "mp3", bitrate_kbps: 128, spotify_track_id: "t3", spotify_title: "Track three", match_state: "matched", matched_by: OPERATOR, drop_s: 72, drop_source: "lab", window_start_s: 68 }),
  file("f4", { drive_file_name: "LD - Track Four.mp3", format: "mp3", bitrate_kbps: 96, storage_path: null, unusable_reason: "MP3 under 128 kbps" }),
  file("f6", { drive_file_name: "LD_track-six.mp3", format: "mp3", bitrate_kbps: 320, spotify_track_id: "t6", spotify_title: "Track six", match_state: "matched", matched_by: OPERATOR, drop_s: 49, drop_source: "lab", window_start_s: 45, rights_flag: "Meta muted the audio (rights)", rights_flagged_at: AT }),
];

/** A Drive file in no top track (CT3), for the view's tests: listed under the top tracks. */
export const EXTRA_FILE: AudioFileRow = file("fx", { drive_file_name: "LD_unreleased-edit.wav", match_state: "matched", drop_s: 40, drop_source: "lab", window_start_s: 36 });

export function snippetFixtureView(): SnippetView {
  return buildSnippetView({
    eventId: "frame-event",
    eventCode: "P26-BDAY",
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

/** AU-A's picks: tracks 1, 2 and 3. */
export const AUA_PICKS = ["f1", "f2", "f3"];
