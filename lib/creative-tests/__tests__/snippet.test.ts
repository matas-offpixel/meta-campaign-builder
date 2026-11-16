/**
 * CT1–CT5, CT10 (docs/design-record/2026-11-16-creative-testing.html): the
 * snippet's pure parts, the Snippet tab's view against CT-A and CT-B, the
 * static list and the filing name.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CTA_PICKS, SNIPPET_FILES, snippetFixtureView } from "../../../scripts/plan-frames/snippet-fixtures.ts";
import { freeSnippetName, wantsSnippetFiling } from "../snippet-filing.ts";
import { SNIPPET, clampWindow, formatOf, makeTestText, mmss, pickable, rightsNote, snippetFileName, spanText, suggestTrack, supplierChoices, unusableReason, windowForDrop, type TopTrack } from "../snippet.ts";
import { buildSnippetView, makeButtonText, pickerHeading } from "../snippet-view.ts";
import { isNineSixteenStill, isStaticsKey, staticSlugForName } from "../statics.ts";

const TRACKS: TopTrack[] = ["Track one", "Track two", "Track three", "Track four", "Track five"].map((title, i) => ({ id: `t${i + 1}`, title, rank: i + 1 }));

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

describe("CT2: the files", () => {
  const probe = (codec: string, container: string, kbps: number | null, s: number | null) => ({ codec, container, bitrateKbps: kbps, durationS: s });

  it("takes WAV, AIFF, FLAC, or MP3 at 256 kbps or more, at least 30 seconds", () => {
    assert.equal(unusableReason(probe("pcm_s16le", "wav", 1411, 192), "a.wav"), null);
    assert.equal(unusableReason(probe("pcm_s24be", "aiff", 2116, 192), "a.aiff"), null);
    assert.equal(unusableReason(probe("flac", "flac", 900, 192), "a.flac"), null);
    assert.equal(unusableReason(probe("mp3", "mp3", 320, 192), "a.mp3"), null);
    assert.equal(unusableReason(probe("mp3", "mp3", 256, 192), "a.mp3"), null);
  });

  it("says why it can't use anything else", () => {
    assert.equal(unusableReason(probe("mp3", "mp3", 192, 192), "a.mp3"), "it's an MP3 under 256 kbps");
    assert.equal(unusableReason(probe("aac", "mov,mp4,m4a,3gp,3g2,mj2", 256, 192), "a.m4a"), "it isn't WAV, AIFF, FLAC or MP3");
    assert.equal(unusableReason(probe("pcm_s16le", "wav", 1411, 29.5), "a.wav"), "it's shorter than 30 seconds");
    assert.equal(unusableReason(null, "a.wav"), "it couldn't be read");
    assert.equal(formatOf(probe("flac", "ogg", 900, 60), "a.ogg"), null);
  });

  it("asks who supplied it: {client} or {artist}'s team, and writes the rights note", () => {
    assert.deepEqual(supplierChoices("Puzzle", "Luke Dean").map((c) => c.label), ["Puzzle", "Luke Dean's team"]);
    assert.equal(rightsNote({ supplier: "Puzzle", fileName: "LD_track-one_master.wav", who: "Matas", at: "2026-11-16T12:00:00Z" }), "Audio supplied by Puzzle · LD_track-one_master.wav · Matas, 16 Nov");
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

  it("only a matched, supplied, unflagged file with a drop can be picked", () => {
    const ok = { matchState: "matched", supplier: "client", unusableReason: null, rightsFlag: null, dropS: 58 };
    assert.equal(pickable(ok), true);
    assert.equal(pickable({ ...ok, matchState: "suggested" }), false);
    assert.equal(pickable({ ...ok, supplier: null }), false);
    assert.equal(pickable({ ...ok, dropS: null }), false);
    assert.equal(pickable({ ...ok, rightsFlag: "Meta muted the audio (rights)" }), false);
  });

  it("CT-A: the rows, the count and the button", () => {
    const view = snippetFixtureView();
    assert.equal(view.eventCode, "P26-BDAY");
    assert.deepEqual(view.acts.map((a) => [a.name, a.open]), [["Luke Dean", true], ["Enzo Siragusa", false]]);
    assert.deepEqual(view.rows.map((r) => r.title), ["1 · Track one", "2 · Track two", "3 · Track three", "4 · Track four", "5 · Track five"]);
    assert.equal(view.rows[0]!.file!.note, "Audio supplied by Puzzle · LD_track-one_master.wav · Matas, 16 Nov");
    assert.equal(view.rows[0]!.file!.dropLabel, "DROP · 1:04");
    assert.equal(view.rows[1]!.file!.note, "Audio supplied by Luke Dean's team · track two (club mix).aiff · Matas, 16 Nov");
    assert.equal(view.rows[1]!.file!.dropLabel, "DROP · 0:58");
    assert.equal(view.rows[2]!.file!.note, "Looks like LD - Track Three.mp3");
    assert.deepEqual(view.rows[2]!.file!.suggestion, { trackId: "t3", title: "Track three" });
    assert.equal(view.rows[3]!.file, null);
    assert.equal(view.rows[3]!.empty, "No file in Drive yet");
    assert.equal(view.rows[4]!.file!.note, "Name who supplied this file before it can run.");
    assert.equal(view.rows[4]!.file!.pickable, false);
    assert.equal(view.rows[4]!.file!.supplierAsk?.question, "Who supplied it?");
    assert.deepEqual(view.extras.map((r) => r.title), ["LD_unreleased-edit.wav · not in Spotify's top tracks"]);
    assert.equal(pickerHeading("Luke Dean", CTA_PICKS.length), "Spotify's top tracks for Luke Dean · 3 of 5 picked");
    assert.deepEqual(view.statics.map((s) => s.label), ["Static: P26-BDAY_puzzle_t2-roll-call-w23nov_9x16"]);
    assert.equal(makeButtonText(3), "Make Test 1 · 3 snippets");
    assert.equal(makeTestText(1, 1), "Make Test 1 · 1 snippet");
  });

  it("CT-A: a held pick (track 5) holds Make Test 1", () => {
    const view = snippetFixtureView();
    const picked = [...view.rows, ...view.extras].filter((r) => r.file && CTA_PICKS.includes(r.file.id));
    assert.equal(picked.some((r) => !r.file!.pickable), true);
  });

  it("when Spotify doesn't answer, the picker says so and lists the Drive files", () => {
    const view = buildSnippetView({
      eventId: "e",
      eventCode: "P26-BDAY",
      clientName: "Puzzle",
      acts: [{ id: "luke-dean", name: "Luke Dean" }],
      actId: "luke-dean",
      tracks: null,
      files: SNIPPET_FILES,
      names: new Map(),
      statics: [],
      renders: [],
      testN: null,
      testState: null,
      variantLabels: new Map(),
    });
    assert.equal(view.spotifyLine, "Spotify didn't answer, so the top tracks can't be listed. Pick from the Drive files below.");
    assert.equal(view.rows.length, 0);
    assert.equal(view.extras.length, SNIPPET_FILES.length);
  });
});

describe("CT4 / CT5: the drop and the preview", () => {
  it("CT-B: Track two, found by the Lab, 0:54–1:10 · 16 s", () => {
    const file = snippetFixtureView().rows[1]!.file!;
    assert.equal(file.dropSource, "Drop found by the Lab");
    assert.equal(file.span, "0:54–1:10 · 16 s");
    assert.equal(file.waveform.length, 400);
  });

  it("a drop the operator set reads Drop set by {first name}", () => {
    const moved = { ...SNIPPET_FILES[1]!, drop_source: "operator" as const, drop_set_by: "frame-operator" };
    const view = buildSnippetView({ eventId: "e", eventCode: null, clientName: "Puzzle", acts: [{ id: "luke-dean", name: "Luke Dean" }], actId: "luke-dean", tracks: TRACKS, files: [moved], names: new Map([["frame-operator", "Matas"]]), statics: [], renders: [], testN: null, testState: null, variantLabels: new Map() });
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
