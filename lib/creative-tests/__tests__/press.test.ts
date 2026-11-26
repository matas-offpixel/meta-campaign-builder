/**
 * M3d-b: a press on the Snippet tab's one-window waveform places the drop
 * marker there and saves it via edit { kind: "drop" }, the same as releasing
 * a drag — including on a file with no drop (NO_CLEAR_DROP), where nothing
 * used to happen outside Pair.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { AudioFileRow } from "../audio-intake.ts";
import { editPatch } from "../audio-edits.ts";
import { pressSeconds } from "../press.ts";

const row = (extra: Partial<AudioFileRow> = {}): AudioFileRow => ({
  id: "f1", event_id: "e1", artist_id: "a1", drive_file_id: "d1", drive_file_name: "t.wav", format: "wav", bitrate_kbps: 1411,
  duration_s: 192, storage_path: "audio/t.wav", unusable_reason: null, spotify_track_id: null, spotify_title: null, match_state: "matched",
  matched_by: null, matched_at: null, drop_s: null, drop_source: null, drop_set_by: null, drop_set_at: null, window_start_s: null,
  length_s: 16, waveform: null, rights_flag: null, rights_flagged_at: null, created_at: "2026-11-26T00:00:00Z", ...extra,
});

test("a no-drop file, press at 30 % → drop saved at 30 % of the length", () => {
  const box = { left: 40, width: 800 };
  const dropS = pressSeconds(40 + 0.3 * 800, box, 192);
  assert.equal(dropS, 0.3 * 192);
  const patch = editPatch(row(), { kind: "drop", dropS }, "u1", "t");
  assert.ok(!("refused" in patch));
  assert.equal((patch as Record<string, unknown>).drop_s, Math.round(0.3 * 192 * 1000) / 1000);
  assert.equal((patch as Record<string, unknown>).drop_source, "operator");
  // The window moves with it: 4 s before the drop.
  assert.ok(Math.abs(Number((patch as Record<string, unknown>).window_start_s) - (0.3 * 192 - 4)) < 0.01);
});

test("a press is kept inside the track, and a box with no width lands at 0", () => {
  assert.equal(pressSeconds(-10, { left: 0, width: 100 }, 60), 0);
  assert.equal(pressSeconds(500, { left: 0, width: 100 }, 60), 60);
  assert.equal(pressSeconds(50, { left: 0, width: 0 }, 60), 0);
  assert.equal(pressSeconds(50, null, 60), 0);
});

test("the one-window view saves a press as edit { kind: drop }, the same edit releasing a drag sends", () => {
  const src = readFileSync(new URL("../../../components/dashboard/events/creative-lab/snippet.tsx", import.meta.url), "utf8");
  const down = src.slice(src.indexOf("onPointerDown={(e) => {\n            // VP2"), src.indexOf("onPointerMove="));
  assert.match(down, /if \(e\.target !== e\.currentTarget\) return;/);
  assert.match(down, /if \(!pair\) \{\s*onEdit\(\{ kind: "drop", dropS: at \}\);/);
  assert.match(src, /onEdit\(drag\.kind === "drop" \? \{ kind: "drop", dropS: drag\.at \}/);
  assert.match(src, /const secondsAt = \(clientX: number\) => pressSeconds\(clientX, svg\.current\?\.getBoundingClientRect\(\), duration\);/);
});
