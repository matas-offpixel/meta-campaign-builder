/**
 * CT1–CT5, CT10 (docs/design-record/2026-11-16-creative-testing.html), as
 * AU1–AU4 (2026-11-16-creative-testing-4.html) re-rule them: the snippet's
 * pure parts, the Snippet tab's view against AU-A and CT-B, the static list
 * and the filing name.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AUA_PICKS, EXTRA_FILE, SNIPPET_FILES, snippetFixtureView } from "../../../scripts/plan-frames/snippet-fixtures.ts";
import { freeSnippetName, wantsSnippetFiling } from "../snippet-filing.ts";
import { SNIPPET, cantUseText, clampWindow, fileLine, formatOf, makeTestText, mmss, mutedLine, pickable, snippetFileName, spanText, suggestTrack, unusableReason, windowForDrop, type TopTrack } from "../snippet.ts";
import { buildSnippetView, makeButtonText, pickerHeading, pickerHeadingShort } from "../snippet-view.ts";
import { isNineSixteenStill, isStaticsKey, staticSlugForName } from "../statics.ts";

const TRACKS: TopTrack[] = ["Track one", "Track two", "Track three", "Track four", "Track five", "Track six"].map((title, i) => ({ id: `t${i + 1}`, title, rank: i + 1 }));

describe("CT1: the format", () => {
  it("is 15 to 20 seconds, 16 by default, from 4 s before the drop to 12 s after", () => {
    assert.equal(SNIPPET.defaultLength, 16);
    assert.deepEqual(windowForDrop(58, 192), { startS: 54, lengthS: 16 });
    assert.equal(spanText(54, 16), "0:54–1:10 · 16 s");
    assert.deepEqual(clampWindow(10, 192, 30), { startS: 10, lengthS: 20 });
    assert.deepEqual(clampWindow(10, 192, 3), { startS: 10, lengthS: 15 });
  });

  it("keeps the window inside the track", () => {
    assert.deepEqual(windowForDrop(2, 192), { startS: 0, lengthS: 16 });
    assert.deepEqual(windowForDrop(190, 192), { startS: 176, lengthS: 16 });
  });

  it("names the file {event code}_{artist}-{track n}_snippet-{static}-{stage}_r{n}_9x16.mp4", () => {
    assert.equal(
      snippetFileName({ eventCode: "P26-BDAY", artistName: "Luke Dean", trackN: 2, staticName: "puzzle_t2-roll-call-w23nov", stage: "on-sale", roundNo: 1 }),
      "P26-BDAY_luke-dean-2_snippet-puzzle_t2-roll-call-w23nov-on-sale_r1_9x16.mp4",
    );
    assert.equal(staticSlugForName("P26-BDAY_puzzle_t2-roll-call-w23nov_9x16.png", "P26-BDAY"), "puzzle_t2-roll-call-w23nov");
  });

  it("files never overwrite: _v2, _v3 (S14)", () => {
    const name = "P26-BDAY_luke-dean-2_snippet-x-on-sale_r1_9x16.mp4";
    assert.equal(freeSnippetName(name, new Set()), name);
    assert.equal(freeSnippetName(name, new Set([name])), "P26-BDAY_luke-dean-2_snippet-x-on-sale_r1_v2_9x16.mp4");
    assert.equal(freeSnippetName(name, new Set([name, "P26-BDAY_luke-dean-2_snippet-x-on-sale_r1_v2_9x16.mp4"])), "P26-BDAY_luke-dean-2_snippet-x-on-sale_r1_v3_9x16.mp4");
  });

  it("files only an approved, done render that hasn't been copied", () => {
    const base = { status: "done", approved_at: "2026-11-16T12:00:00Z", drive_status: null, storage_path: "x.mp4", file_name: "a_r1_9x16.mp4" };
    assert.equal(wantsSnippetFiling(base), true);
    assert.equal(wantsSnippetFiling({ ...base, approved_at: null }), false);
    assert.equal(wantsSnippetFiling({ ...base, status: "rendering" }), false);
    assert.equal(wantsSnippetFiling({ ...base, drive_status: "copied" }), false);
    assert.equal(wantsSnippetFiling({ ...base, drive_status: "failed" }), false);
  });
});

describe("AU1 / AU2: the files", () => {
  const probe = (codec: string, container: string, kbps: number | null, sec: number | null) => ({ codec, container, bitrateKbps: kbps, durationS: sec });

  it("takes WAV, AIFF, FLAC, or MP3 at 128 kbps or more, at least 30 seconds", () => {
    assert.equal(SNIPPET.minMp3Kbps, 128);
    assert.equal(unusableReason(probe("pcm_s16le", "wav", 1411, 192), "a.wav"), null);
    assert.equal(unusableReason(probe("pcm_s24be", "aiff", 2116, 192), "a.aiff"), null);
    assert.equal(unusableReason(probe("flac", "flac", 900, 192), "a.flac"), null);
    assert.equal(unusableReason(probe("mp3", "mp3", 128, 192), "a.mp3"), null);
    assert.equal(unusableReason(probe("mp3", "mp3", 320, 30), "a.mp3"), null);
  });

  it("has exactly three reasons, worded as AU1 words them", () => {
    assert.equal(cantUseText(unusableReason(probe("mp3", "mp3", 96, 192), "a.mp3")!), "Can't use this file: MP3 under 128 kbps");
    assert.equal(cantUseText(unusableReason(probe("pcm_s16le", "wav", 1411, 29.5), "a.wav")!), "Can't use this file: shorter than 30 seconds");
    assert.equal(cantUseText(unusableReason(null, "a.wav")!), "Can't use this file: it can't be read");
    // Not one of the four formats: the Lab doesn't recognise it as audio it takes.
    assert.equal(cantUseText(unusableReason(probe("aac", "mov,mp4,m4a,3gp,3g2,mj2", 256, 192), "a.m4a")!), "Can't use this file: it can't be read");
    assert.equal(formatOf(probe("flac", "ogg", 900, 60), "a.ogg"), null);
  });

  it("the file line names the file and its format, an MP3 with its bitrate (AU2)", () => {
    assert.equal(fileLine({ fileName: "track two (club mix).aiff", format: "aiff", bitrateKbps: 2116 }), "track two (club mix).aiff · AIFF");
    assert.equal(fileLine({ fileName: "LD - Track Three.mp3", format: "mp3", bitrateKbps: 128 }), "LD - Track Three.mp3 · MP3 128 kbps");
    assert.equal(fileLine({ fileName: "LD_track-one_master.wav", format: "wav", bitrateKbps: 1411 }), "LD_track-one_master.wav · WAV");
    assert.equal(mutedLine("LD_track-six.mp3 · MP3 320 kbps"), "LD_track-six.mp3 · MP3 320 kbps · Meta muted the audio (rights)");
  });

  it("no supplier field, hold or line exists in the Lab's code or reads (AU2)", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.join(process.cwd(), "lib/creative-tests");
    const files = [
      ...readdirSync(root).filter((f: string) => f.endsWith(".ts")).map((f: string) => path.join(root, f)),
      path.join(process.cwd(), "components/dashboard/events/creative-lab/snippet.tsx"),
      path.join(process.cwd(), "app/api/creative-lab/events/[eventId]/snippet/route.ts"),
    ];
    for (const file of files) {
      const code = readFileSync(file, "utf8").split("\n").filter((l: string) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
      assert.doesNotMatch(code, /supplier|Who supplied|Audio supplied by/i, file);
    }
  });
});

describe("CT3: the picker", () => {
  it("matches by title for an operator to confirm", () => {
    assert.equal(suggestTrack("LD - Track Three.mp3", TRACKS, "Luke Dean")?.title, "Track three");
    assert.equal(suggestTrack("track two (club mix).aiff", TRACKS, "Luke Dean")?.title, "Track two");
    assert.equal(suggestTrack("LD_unreleased-edit.wav", TRACKS, "Luke Dean"), null);
    // Two titles equally good: nothing is suggested.
    assert.equal(suggestTrack("track one track two.wav", TRACKS), null);
  });

  it("only a matched file that passes AU1, and isn't flagged, can be picked (AU2, AU3)", () => {
    const ok = { matchState: "matched", unusableReason: null, rightsFlag: null };
    assert.equal(pickable(ok), true);
    assert.equal(pickable({ ...ok, matchState: "suggested" }), false);
    assert.equal(pickable({ ...ok, unusableReason: "MP3 under 128 kbps" }), false);
    assert.equal(pickable({ ...ok, rightsFlag: "Meta muted the audio (rights)" }), false);
  });

  it("AU-A: the rows, the count and the button", () => {
    const view = snippetFixtureView();
    assert.equal(view.eventCode, "P26-BDAY");
    assert.deepEqual(view.acts.map((a) => [a.name, a.open]), [["Luke Dean", true], ["Enzo Siragusa", false]]);
    assert.deepEqual(view.rows.map((r) => r.title), ["1 · Track one", "2 · Track two", "3 · Track three", "4 · Track four", "5 · Track five", "6 · Track six"]);
    const notes = view.rows.map((r) => r.file?.note ?? r.empty);
    assert.deepEqual(notes, [
      "LD_track-one_master.wav · WAV",
      "track two (club mix).aiff · AIFF",
      "LD - Track Three.mp3 · MP3 128 kbps",
      "Can't use this file: MP3 under 128 kbps",
      "No file in Drive yet",
      "LD_track-six.mp3 · MP3 320 kbps · Meta muted the audio (rights)",
    ]);
    assert.deepEqual(view.rows.map((r) => r.file?.dropLabel ?? null), ["DROP · 1:04", "DROP · 0:58", "DROP · 1:12", null, null, "DROP · 0:49"]);
    assert.deepEqual(view.rows.map((r) => r.file?.pickable ?? false), [true, true, true, false, false, false]);
    assert.equal(view.rows[3]!.file!.suggestion, null);
    assert.equal(view.rows[5]!.file!.flagged, true);
    assert.equal(pickerHeading("Luke Dean", AUA_PICKS.length), "Spotify's top tracks for Luke Dean · 3 of 5 picked");
    assert.equal(pickerHeadingShort("Luke Dean", AUA_PICKS.length), "Luke Dean · 3 of 5 picked");
    assert.deepEqual(view.statics.map((s) => s.label), ["Static: P26-BDAY_puzzle_t2-roll-call-w23nov_9x16"]);
    assert.equal(makeButtonText(3), "Make Test 1 · 3 snippets");
    assert.equal(makeTestText(1, 1), "Make Test 1 · 1 snippet");
  });

  it("a suggested file sits on its track with Match; a Drive file in no top track is listed under them", () => {
    const suggested = { ...SNIPPET_FILES[2]!, match_state: "none" as const, spotify_track_id: null, spotify_title: null };
    const view = buildSnippetView({ eventId: "e", eventCode: null, acts: [{ id: "luke-dean", name: "Luke Dean" }], actId: "luke-dean", tracks: TRACKS, files: [suggested, EXTRA_FILE], names: new Map(), statics: [], renders: [], testN: null, testState: null, variantLabels: new Map() });
    assert.equal(view.rows[2]!.file!.note, "Looks like LD - Track Three.mp3");
    assert.deepEqual(view.rows[2]!.file!.suggestion, { trackId: "t3", title: "Track three" });
    assert.deepEqual(view.extras.map((r) => [r.title, r.file!.note]), [["LD_unreleased-edit.wav · not in Spotify's top tracks", "LD_unreleased-edit.wav · WAV"]]);
  });

  it("when Spotify doesn't answer, the picker says so and lists the Drive files", () => {
    const view = buildSnippetView({
      eventId: "e",
      eventCode: "P26-BDAY",
      acts: [{ id: "luke-dean", name: "Luke Dean" }],
      actId: "luke-dean",
      tracks: null,
      files: [...SNIPPET_FILES, EXTRA_FILE],
      names: new Map(),
      statics: [],
      renders: [],
      testN: null,
      testState: null,
      variantLabels: new Map(),
    });
    assert.equal(view.spotifyLine, "Spotify didn't answer, so the top tracks can't be listed. Pick from the Drive files below.");
    assert.equal(view.rows.length, 0);
    assert.equal(view.extras.length, SNIPPET_FILES.length + 1);
  });
});

describe("CT4 / CT5: the drop and the preview", () => {
  it("CT-B: Track two, found by the Lab, 0:54–1:10 · 16 s, with its file line", () => {
    const file = snippetFixtureView().rows[1]!.file!;
    assert.equal(file.dropSource, "Drop found by the Lab");
    assert.equal(file.note, "track two (club mix).aiff · AIFF");
    assert.equal(file.span, "0:54–1:10 · 16 s");
    assert.equal(file.waveform.length, 400);
  });

  it("a drop the operator set reads Drop set by {first name}", () => {
    const moved = { ...SNIPPET_FILES[1]!, drop_source: "operator" as const, drop_set_by: "frame-operator" };
    const view = buildSnippetView({ eventId: "e", eventCode: null, acts: [{ id: "luke-dean", name: "Luke Dean" }], actId: "luke-dean", tracks: TRACKS, files: [moved], names: new Map([["frame-operator", "Matas"]]), statics: [], renders: [], testN: null, testState: null, variantLabels: new Map() });
    assert.equal(view.rows[1]!.file!.dropSource, "Drop set by Matas");
  });

  it("m:ss", () => {
    assert.equal(mmss(64), "1:04");
    assert.equal(mmss(0), "0:00");
  });
});

describe("CT10: the static", () => {
  it("lists 9:16 stills from {owner} / Statics folders", () => {
    assert.equal(isStaticsKey("03/3/wc/2026-11-23/owner/promoter/statics"), true);
    assert.equal(isStaticsKey("03/3/wc/2026-11-23/owner/artist:abc/statics"), true);
    assert.equal(isStaticsKey("03/3/wc/2026-11-23/owner/promoter/videos"), false);
    assert.equal(isNineSixteenStill({ name: "P26-BDAY_puzzle_t2-roll-call-w23nov_9x16.png", mimeType: "image/png" }), true);
    assert.equal(isNineSixteenStill({ name: "P26-BDAY_puzzle_t2-roll-call-w23nov_4x5.png", mimeType: "image/png" }), false);
    assert.equal(isNineSixteenStill({ name: "x_r1_9x16_winner.jpg", mimeType: "image/jpeg" }), true);
    assert.equal(isNineSixteenStill({ name: "x_r1_9x16.mp4", mimeType: "video/mp4" }), false);
  });
});
