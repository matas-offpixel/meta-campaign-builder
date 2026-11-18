/**
 * TK10 (docs/design-record/2026-11-18-creative-lab-top-tracks.html, frame
 * TK-G): the Lab tab's view model on the record's fixture. Strings, defaults,
 * the Drive-only row under Ranked and Level, and the Edit rows that show.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FIXTURE_TRACKS, fixtureAnalysis, fixtureFeatures } from "../../../scripts/plan-frames/top-tracks-fixtures.ts";
import { planTrack } from "../top-tracks/audio-rules.ts";
import { DEFAULT_OPTIONS } from "../top-tracks/reel.ts";
import { buildTopTracksView, type TrackInput } from "../top-tracks/view.ts";

function inputs(): TrackInput[] {
  return FIXTURE_TRACKS.map((t) => {
    const plan = planTrack({ title: t.title, features: fixtureFeatures(t), analysis: fixtureAnalysis(t) });
    const base = { id: t.id, title: t.title, spotifyRank: t.spotifyRank, durationS: t.durationS, waveform: [], drops: t.drops };
    if (!plan.ok) return { ...base, window: null, choice: null, hook: { kind: "none" as const }, refusal: plan.refusal };
    return { ...base, window: plan.window, choice: plan.choice, hook: plan.hook.kind === "none" ? { kind: "none" as const } : { kind: plan.hook.kind, hookS: plan.hook.hookS }, refusal: null };
  });
}

const ACTS = [
  { id: "luke-dean", name: "Luke Dean" },
  { id: "enzo-siragusa", name: "Enzo Siragusa" },
];

function view(over: Partial<Parameters<typeof buildTopTracksView>[0]> = {}) {
  return buildTopTracksView({
    eventCode: "P26-BDAY",
    acts: ACTS,
    actId: "luke-dean",
    artist: "Luke Dean",
    tracks: inputs(),
    picked: FIXTURE_TRACKS.map((t) => t.id),
    options: DEFAULT_OPTIONS,
    renders: [{ id: "r1", fileName: "P26-BDAY_luke-dean_top-tracks-ranked-5tracks-cta-on-sale_r1_9x16.mp4", status: "ready", lengthS: 68.61 }],
    ...over,
  });
}

describe("TK10: the Top tracks tab", () => {
  it("reads as TK-G at the defaults", () => {
    const v = view();
    assert.equal(v.heading, "P26-BDAY · Top tracks");
    assert.equal(v.previewLabel, "9:16 · 1:09");
    assert.deepEqual(
      v.framing.map((c) => [c.text, c.narrow, c.selected]),
      [
        ["Top Luke Dean tracks ranked 1–5", "Top Luke Dean tracks ranked 1–5", true],
        ["What’s your Luke Dean level?", "What’s your Luke Dean level?", false],
        ["Luke Dean tracks that changed music forever", "… changed music forever", false],
        ["Luke Dean tracks we can’t live without", "… we can’t live without", false],
      ],
    );
    assert.equal(v.tracksHeading, "5 of 5 picked · at least 3");
    assert.equal(v.orderLine, "Order follows Spotify's top tracks");
    assert.deepEqual(
      v.pickedShort.map((r) => `${r.n} ${r.title} · ${r.short}`),
      ["1 Track one · 17.4 s, hook", "2 Track two · 13.5 s", "3 Track three · 13.5 s", "4 Track four (Club Mix) · 13.5 s", "5 Track five · 13.5 s"],
    );
    assert.deepEqual(
      v.background.map((c) => c.text),
      ["Press shot", "DJ moment", "Clip montage", "Event b-roll"],
    );
    assert.equal(v.summary, "5 tracks · 68.6 s · rows at track start · ends with the date, in the list's column · list on the left");
    assert.equal(v.summaryShort, "5 tracks · 68.6 s");
    assert.equal(v.canMake, true);
    assert.equal(v.renders[0]!.line, "P26-BDAY_luke-dean_top-tracks-ranked-5tracks-cta-on-sale_r1_9x16.mp4 · ready · 1:09");
  });

  it("lists each track's drop, hook and window under it", () => {
    const v = view();
    assert.deepEqual(v.rows[0]!.lines, ["Drop 2:24 · the last drop", "HOOK · 2:14", "2:14–2:31 · 17.4 s · 9 bars"]);
    assert.deepEqual(v.rows[2]!.lines, ["Drop 1:46 · an earlier drop (no later drop fits)", "No repeated phrase found", "1:40–1:53 · 13.5 s · 7 bars"]);
  });

  it("shows the Edit rows defaults first, Ladder only under Level, End card only with the date end", () => {
    assert.deepEqual(
      view().edit.map((r) => [r.label, r.options.map((o) => o.text), r.options.findIndex((o) => o.selected)]),
      [
        ["Tracks", ["5", "4", "3"], 0],
        ["Rows appear", ["At track start", "On the drop"], 0],
        ["End", ["With the date", "No CTA"], 0],
        ["End card", ["In the list's column", "Centred"], 0],
        ["List", ["On the left", "On the right"], 0],
      ],
    );
    const level = view({ options: { ...DEFAULT_OPTIONS, framing: "level" } });
    assert.ok(level.edit.some((r) => r.label === "Ladder"));
    const nocta = view({ options: { ...DEFAULT_OPTIONS, end: "nocta" } });
    assert.ok(!nocta.edit.some((r) => r.label === "End card"));
  });

  it("refuses a Drive-only track under Ranked and Level, and allows it under the other two", () => {
    const tracks = [...inputs(), { ...inputs()[1]!, id: "drive-only", title: "Studio dub", spotifyRank: null }];
    const ranked = view({ tracks, picked: [] });
    const row = ranked.rows.find((r) => r.id === "drive-only")!;
    assert.equal(row.tickable, false);
    assert.equal(row.lockLine, "Not on Spotify's top tracks, so it can't be ranked");
    assert.equal(view({ tracks, picked: [], options: { ...DEFAULT_OPTIONS, framing: "level" } }).rows.find((r) => r.id === "drive-only")!.tickable, false);
    const forever = view({ tracks, picked: [], options: { ...DEFAULT_OPTIONS, framing: "forever" } });
    assert.equal(forever.rows.find((r) => r.id === "drive-only")!.tickable, true);
    assert.equal(forever.orderLine, "Drag to reorder");
  });

  it("can't make the reel under 3 tracks or short of the count", () => {
    assert.equal(view({ picked: ["t1", "t2"] }).canMake, false);
    assert.equal(view({ picked: ["t1", "t2", "t3"], options: { ...DEFAULT_OPTIONS, tracks: 3 } }).canMake, true);
    assert.equal(view({ picked: ["t1", "t2", "t3"] }).tracksHeading, "3 of 5 picked · at least 3");
  });

  it("keeps Spotify's order under Ranked whatever the pick order", () => {
    assert.deepEqual(
      view({ picked: ["t3", "t1", "t2"], options: { ...DEFAULT_OPTIONS, tracks: 3 } }).pickedShort.map((r) => r.n),
      ["1", "2", "3"],
    );
  });
});
