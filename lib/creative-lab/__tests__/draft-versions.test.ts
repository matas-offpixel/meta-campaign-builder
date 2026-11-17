import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { WATERMARK, fixtureRelease as r, type WarningRow } from "../claim-approval.ts";
import { draftSound, draftVersions, draftWindow, parseDraftWindows, releaseFromRow } from "../draft-versions.ts";

/** Puzzle 4th Birthday's tiers on 10 Nov. */
const puzzle = [r(1, "Early bird", "sold_out"), r(2, "1st release", "sold_out"), r(3, "2nd release", "sold_out"), r(4, "3rd release", "selling_fast")];
const CLAIM = "EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT\n3RD RELEASE SELLING FAST";
const row = (o: Partial<WarningRow>): WarningRow => ({ id: "w1", claim: CLAIM, format: "9:16", state: "held", approved_by: null, approved_at: null, runs_from: null, runs_to: null, ...o });

describe("Puzzle's draft rounds carry two versions (Matas, 10 Nov)", () => {
  it("exactly two: no CTA, then the selling-fast roll-call from the live tiers", () => {
    const v = draftVersions(puzzle, []);
    assert.deepEqual(v.map((x) => x.id), ["v1-no-cta", "v2-roll-call"]);
    assert.equal(v[0]!.claim, null);
    assert.equal(v[0]!.watermark, null);
    assert.equal(v[1]!.claim, CLAIM);
  });

  it("the roll-call is stamped by its ticket_warnings row: held → not approved; approved and in force → none; no row → sample", () => {
    assert.equal(draftVersions(puzzle, [row({})])[1]!.watermark, WATERMARK.notApproved);
    assert.equal(draftVersions(puzzle, [row({ state: "live", approved_by: "matas", approved_at: "2026-11-10T10:00:00Z" })], new Date("2026-11-10T12:00:00Z"))[1]!.watermark, null);
    assert.equal(draftVersions(puzzle, [])[1]!.watermark, WATERMARK.sample);
    // A held row with other words isn't this claim.
    assert.equal(draftVersions(puzzle, [row({ claim: "General sale live" })])[1]!.watermark, WATERMARK.sample);
  });

  it("no version says \"General sale live\", and tiers that make no roll-call stop the round", () => {
    assert.ok(draftVersions(puzzle, []).every((x) => !/general sale live/i.test(x.claim ?? "")));
    assert.throws(() => draftVersions([r(1, "General sale", "on_sale")], []), /don't make a roll-call/);
  });

  it("an event_releases row reads as the generator's Release", () => {
    const rel = releaseFromRow({ id: "x", event_id: "e", position: 4, name: "3rd release", state: "selling_fast", capacity: 400, sold: null, remaining: null });
    assert.deepEqual([rel.position, rel.name, rel.state, rel.capacity], [4, "3rd release", "selling_fast", 400]);
  });

  it("the draft scripts draw the two versions only: no \"General sale live\" job and no stress fixture on a sheet", () => {
    for (const f of ["t1-video-drafts.mts", "t2-claim-drafts.mts", "cta-drafts.mts"]) {
      const src = readFileSync(new URL(`../../../scripts/${f}`, import.meta.url), "utf8");
      assert.match(src, /draftVersions\(/, f);
      assert.doesNotMatch(src, /a-general-sale-live|RECORD_RUNG1|LONGEST|OVERLONG|SIX_RELEASES|b-sample-roll-call|bands-off/, f);
    }
  });
});

describe("T1 draft sound (17 Nov 2026: the P26-BDAY edits went to Drive silent)", () => {
  it("keeps the clip's own sound unless its audio_status is muted", () => {
    assert.equal(draftSound({ audio_status: "original" }).muted, false);
    assert.equal(draftSound({ audio_status: "cleared" }).muted, false);
    assert.equal(draftSound({ audio_status: "replaced" }).muted, false);
    assert.equal(draftSound({}).muted, false);
    assert.equal(draftSound({ audio_status: "muted" }).muted, true);
  });

  it("the T1 draft script renders with draftSound, and only the grey test clip is hard-muted", () => {
    const src = readFileSync(new URL("../../../scripts/t1-video-drafts.mts", import.meta.url), "utf8");
    assert.match(src, /const sound = draftSound\(clip\);/);
    const hardMuted = src.split("\n").filter((line) => /muted:\s*true/.test(line));
    assert.ok(hardMuted.every((line) => /grey/i.test(line)), hardMuted.join("\n"));
    assert.equal((src.match(/muted: sound\.muted/g) ?? []).length, 3);
  });
});

describe("T1 draft windows (17 Nov 2026: r3 re-cuts land the drop 3–5 s in)", () => {
  it("parses <clip id>=<start>:<length> and refuses bad or repeated values", () => {
    const w = parseDraftWindows(["a1=11.1:18.5", "b2=7.5:20"]);
    assert.deepEqual(w.get("a1"), { startS: 11.1, lengthS: 18.5 });
    assert.deepEqual(w.get("b2"), { startS: 7.5, lengthS: 20 });
    assert.throws(() => parseDraftWindows(["a1=11.1"]));
    assert.throws(() => parseDraftWindows(["a1=-1:5"]));
    assert.throws(() => parseDraftWindows(["a1=1:0"]));
    assert.throws(() => parseDraftWindows(["a1=1:5", "a1=2:5"]));
  });

  it("an override replaces in_s and the length; it must fit the source; without one, the first `seconds` from in_s", () => {
    assert.deepEqual(draftWindow({ in_s: 0, out_s: 30 }, 46.8, 8, { startS: 11.1, lengthS: 18.5 }), { inS: 11.1, full: 18.5, dur: 18.5 });
    assert.throws(() => draftWindow({ in_s: null, out_s: null }, 27.58, 8, { startS: 8, lengthS: 20 }));
    assert.deepEqual(draftWindow({ in_s: 2, out_s: 30 }, 46.8, 8), { inS: 2, full: 28, dur: 8 });
    assert.deepEqual(draftWindow({ in_s: null, out_s: null }, 6, 8), { inS: 0, full: 6, dur: 6 });
  });
});
